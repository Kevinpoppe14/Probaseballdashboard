// Motion capture from the Coach tab of a coach's own phone app (athlete.html, "Coach tools"): sign in with the
// dashboard account if need be, pick a pitcher, then film or choose his delivery and analyze it full screen with the
// same tool as the dashboard's Pitching › Motion Capture (mocap.js). Sessions save to the pitcher's record, so they
// show on his profile.
//   window.MoCapApp.open({ overlay, close })   overlay and close are the app's sheet layer and its close
(function () {
  const sb = window.supabaseClient;
  const el = (tag, attrs, ...kids) => {
    const n = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (v == null || v === false) return;
      if (k === "class") n.className = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    });
    kids.flat().forEach((c) => { if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c))); });
    return n;
  };
  const lastFirst = (name) => { const p = (name || "").trim().split(/\s+/); return p.length > 1 ? `${p[p.length - 1]}, ${p.slice(0, -1).join(" ")}` : name || ""; };
  let ctx = null;
  let pitchers = null; // active pitchers, once read

  const sheet = (...kids) => {
    ctx.overlay.replaceChildren(el("div", { class: "sheet" }, el("button", { class: "close", "aria-label": "Close", onclick: ctx.close }, "×"), ...kids));
    ctx.overlay.className = "overlay show";
  };
  const note = (text) => el("div", { class: "swap-coach" }, text);

  async function open(options) {
    ctx = { ...(ctx || {}), ...options };
    sheet(el("h2", null, "Motion Capture"), note("Loading…"));
    const { data } = await sb.auth.getSession();
    if (!data || !data.session) { signIn(); return; }
    try {
      if (!pitchers) {
        const rows = [];
        for (let from = 0; ; from += 1000) {
          const { data: page, error } = await sb.from("athletes").select("id, name:data->>name, status:data->>status, position:data->>position, throws:data->>throws, bats:data->>bats, email:data->>email, group:data->>rosterGroup").range(from, from + 999);
          if (error) throw error;
          rows.push(...page);
          if (page.length < 1000) break;
        }
        pitchers = rows.filter((p) => (p.status || "active").toLowerCase() === "active" && (p.name || "").trim())
          .sort((a, b) => lastFirst(a.name).localeCompare(lastFirst(b.name)));
      }
      chooseKind();
    } catch (e) { sheet(el("h2", null, "Motion Capture"), note("Couldn't load the pitchers. Check your connection and try again.")); }
  }

  function signIn() {
    const email = el("input", { type: "email", autocomplete: "username", placeholder: "Email", "aria-label": "Email" });
    const password = el("input", { type: "password", autocomplete: "current-password", placeholder: "Password", "aria-label": "Password" });
    const msg = el("div", { class: "swap-note" });
    const go = async (e) => {
      e.preventDefault();
      msg.textContent = "Signing in…";
      const { error } = await sb.auth.signInWithPassword({ email: email.value.trim(), password: password.value });
      if (error) { msg.textContent = error.message || "Sign-in failed."; return; }
      open({});
    };
    sheet(el("h2", null, "Sign in"), note("Sign in with your dashboard account."),
      el("form", { class: "qa-signin", onsubmit: go }, email, password, msg, el("div", { class: "swap-actions" }, el("button", { class: "primary", type: "submit" }, "Sign in"))));
  }

  // which movement: pitching (pitchers and coaches), hitting, a sprint or a jump (anyone)
  // (and a sprint assessment: timing gates, sled sprints and sprint videos, sprint_assessment.js)
  const KINDS = [["pitching", "Pitching", "a delivery"], ["hitting", "Hitting", "a swing"], ["sprint", "Sprint", "a start or a fly sprint"], ["jump", "Jump", "a jump"], ["screen", "Movement Screen", "a screen test (ROM, overhead squat)"], ["sprintassess", "Sprint Assessment", "timing gate times, sled sprints and sprint videos"]];
  let kind = "pitching";
  const offered = (k) => k === "pitching" || (k === "sprintassess" ? !!window.SprintAssessment : !!(window.MoCap && window.MoCap.kinds && window.MoCap.kinds[k]));
  function chooseKind() {
    sheet(el("h2", null, "Motion Capture"), note("What are you filming?"),
      el("div", { class: "qa-list" }, KINDS.filter(([k]) => offered(k)).map(([k, label, what]) =>
        el("button", { class: "qa-row", onclick: () => { kind = k; pick(); } }, el("b", null, label), el("small", null, ` · ${what}`)))));
  }
  // who: type a few letters
  function pick() {
    const [, label, what] = KINDS.find(([k]) => k === kind);
    const who = kind === "pitching" ? "pitcher or coach" : "athlete";
    const pool = kind === "pitching" ? pitchers.filter((p) => /pitcher/i.test(p.position || "") || p.group === "coaches") : pitchers;
    const results = el("div", { class: "qa-list" });
    const search = el("input", { type: "search", placeholder: `Search for a ${who}`, "aria-label": `Search for a ${who}`, autocomplete: "off" });
    const show = () => {
      const q = search.value.trim().toLowerCase();
      const hits = (q ? pool.filter((p) => p.name.toLowerCase().includes(q)) : pool).slice(0, q ? 12 : 8);
      results.replaceChildren(...hits.map((p) => el("button", { class: "qa-row", onclick: () => capture(p) }, lastFirst(p.name))),
        ...(q && !hits.length ? [el("div", { class: "qa-empty" }, `No active ${who} matches that.`)] : []));
    };
    search.addEventListener("input", show);
    sheet(el("h2", null, `Motion Capture: ${label}`), note(kind === "sprintassess" ? "Type in the timing gate times, distances and sled sprints, and link the sprint videos. Who is it?" : `Film ${what} in slow motion (tips on the next screen) and get the mechanics in numbers. Who is it?`),
      el("button", { class: "qa-row", onclick: chooseKind }, "‹ Another movement"), search, results);
    show();
    setTimeout(() => search.focus(), 50);
  }

  // the tool, full screen
  async function capture(p) {
    ctx.close();
    const box = el("div");
    const layer = el("div", { class: "mc-app-layer" },
      el("div", { class: "mc-app-bar" }, el("button", { class: "mc-app-back", onclick: () => { layer.remove(); document.body.classList.remove("mc-app-open"); open({}); } }, "‹ Back"),
        el("button", { class: "mc-app-close", "aria-label": "Close", onclick: () => { layer.remove(); document.body.classList.remove("mc-app-open"); } }, "×")),
      box);
    document.body.append(layer);
    document.body.classList.add("mc-app-open");
    if (kind === "sprintassess") mountAssessFor(box, p); else mountFor(box, p, kind);
  }

  // A sprint assessment for athlete p in `box` (sprint_assessment.js), on a phone or tablet: his assessments, his saved
  // sprint clips, his force plate jumps, the other athletes' assessments and latest CMJs (to rank him), read first;
  // saves go straight to his record. "Open" on a clip opens it in the sprint motion capture, Back returns here.
  async function mountAssessFor(box, p) {
    box.replaceChildren(note("Loading…"));
    if (!window.SprintAssessment) { box.replaceChildren(note("Sprint assessment didn't load. Reload the page.")); return; }
    const id = String(p.id), since = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
    const safe = (q) => q.then((r) => (r.error ? [] : r.data || []), () => []);
    // a force plate jump's numbers the assessment uses, not the whole Hawkin record (a phone reads every athlete's)
    const RAW = ["Avg. Propulsive Force(N)", "Peak Propulsive Force(N)", "Time To Takeoff(s)", "Avg. Braking Force(N)", "Braking Phase(s)", "Stiffness(N/m)", "L|R Avg. Braking RFD(%)"];
    const SLIM = ["athleteId:data->>athleteId", "date:data->>date", "testType:data->>testType", "systemWeight:data->systemWeight", "rsiModified:data->rsiModified", "relativePeakPower:data->relativePeakPower", "jumpHeight:data->jumpHeight", "brakingRfd:data->brakingRfd", ...RAW.map((k, i) => `r${i}:data->raw->"${k}"`)].join(",");
    const unslim = (rows) => rows.map((t) => ({ ...t, raw: Object.fromEntries(RAW.map((k, i) => [k, t[`r${i}`]])) }));
    const [mine, all, clips, tests, cmjs, body] = await Promise.all([
      safe(sb.from("assessments").select("id,data").eq("athlete_id", id).eq("data->>kind", "sprintassess").limit(500)),
      safe(sb.from("assessments").select("athlete_id,data").eq("data->>kind", "sprintassess").limit(2000)),
      safe(sb.from("assessments").select("id,data").eq("athlete_id", id).eq("data->>kind", "mocap").eq("data->>motion", "sprint").limit(300)),
      safe(sb.from("force_tests").select(SLIM).eq("data->>athleteId", id).ilike("data->>testType", "%counter%").limit(500)).then(unslim),
      safe(sb.from("force_tests").select(SLIM).ilike("data->>testType", "%counter%").gte("data->>date", since).limit(5000)).then(unslim),
      bodyNumbers(p.id),
    ]);
    let list = mine.map((r) => ({ ...r.data, id: r.data.id || r.id }));
    const others = all.filter((r) => String(r.athlete_id) !== id).map((r) => ({ ...r.data, athleteId: r.data.athleteId != null ? r.data.athleteId : r.athlete_id }));
    const clipRecs = clips.map((r) => ({ ...r.data, id: r.data.id || r.id }));
    const latest = {};
    cmjs.filter((t) => !/single|rebound/i.test(t.testType || "")).forEach((t) => { const k = String(t.athleteId); if (!latest[k] || (t.date || "") > (latest[k].date || "")) latest[k] = t; });
    const athleteId = /^\d+$/.test(id) ? Number(id) : id;
    box.replaceChildren();
    window.SprintAssessment.mount(box, {
      athlete: { id: athleteId, name: p.name },
      weightLb: body.weightLb,
      list: () => list,
      all: () => [...list, ...others],
      save: (rec) => {
        const record = { ...rec, athleteId };
        list = [...list.filter((r) => r.id !== record.id), record];
        sb.from("assessments").upsert({ id: record.id, athlete_id: id, data: record }).then((r) => { if (r.error) window.alert("The sprint assessment didn't save: check your connection and try again."); });
      },
      remove: (rec) => {
        list = list.filter((r) => r.id !== rec.id);
        sb.from("assessments").delete().eq("id", rec.id).then((r) => { if (r.error) window.alert("Couldn't delete it: check your connection and try again."); });
      },
      clips: () => clipRecs,
      openClip: (c) => {
        // the clip in the sprint motion capture, with a way back to the assessment
        const back = el("button", { class: "mc-app-back", onclick: () => mountAssessFor(box, p) }, "‹ Back to the sprint assessment");
        box.replaceChildren(back, el("div"));
        mountFor(box.lastChild, p, "sprint", c.id);
      },
      forceTests: () => tests,
      latestCmjs: () => Object.values(latest),
    });
  }

  // His height (from his profile) and his latest weight: the most recent of a force plate test (a CMJ's system
  // weight), a body comp scan and a pre-weight logged in his program. Anything that can't be read is left blank.
  async function bodyNumbers(athleteId) {
    const id = String(athleteId);
    const safe = (q) => q.then((r) => (r.error ? [] : r.data || []), () => []);
    const [me, plate, scans, logs] = await Promise.all([
      safe(sb.from("athletes").select("height:data->heightIn").eq("id", id).limit(1)),
      safe(sb.from("force_tests").select("date:data->>date,w:data->systemWeight").eq("data->>athleteId", id).limit(2000)),
      safe(sb.from("body_comp").select("date:data->>date,lb:data->weightLb,kg:data->weightKg").eq("data->>athleteId", id).limit(2000)),
      safe(sb.from("athlete_logs").select("key,value").eq("athlete_id", id).like("key", "bw-%").neq("value", "").limit(2000)),
    ]);
    const all = [];
    plate.forEach((r) => { const w = Number(r.w); if (r.date && w > 300) all.push({ date: String(r.date).slice(0, 10), lb: w / 4.44822, from: "force plate test" }); });
    scans.forEach((r) => { const lb = Number(r.lb) || Number(r.kg) * 2.20462; if (r.date && lb > 50) all.push({ date: String(r.date).slice(0, 10), lb, from: "body comp scan" }); });
    logs.forEach((r) => { const m = /^bw-(\d{4})(\d{2})(\d{2})\|0$/.exec(r.key), lb = parseFloat(r.value); if (m && lb > 50) all.push({ date: `${m[1]}-${m[2]}-${m[3]}`, lb, from: "logged weight in his program" }); });
    all.sort((a, b) => a.date.localeCompare(b.date));
    const last = all[all.length - 1];
    return { heightIn: Number(me[0] && me[0].height) || null, weightLb: last ? Math.round(last.lb) : null, weightFrom: last ? `${last.from} (${last.date})` : "" };
  }
  // a height entered in motion capture, onto the profile of someone who had none
  async function saveHeight(athleteId, heightIn) {
    const { data, error } = await sb.from("athletes").select("data").eq("id", String(athleteId)).single();
    if (error || !data) throw new Error("couldn't read the profile");
    if (data.data && data.data.heightIn) return;
    const res = await sb.from("athletes").update({ data: { ...(data.data || {}), heightIn } }).eq("id", String(athleteId));
    if (res.error) throw new Error("couldn't save the height");
  }

  // the tool in `box` for athlete p ({ id, name, throws, bats, email }) and movement `which`, his sessions read
  // first; saves go to his record. Coach Mode's Motion Capture screen (coach.js) uses this too.
  async function mountFor(box, p, which, openId = null) { // openId: open at that saved session
    box.replaceChildren(note("Loading…"));
    const [{ data, error }, body] = await Promise.all([
      sb.from("assessments").select("id,data").eq("athlete_id", String(p.id)).eq("data->>kind", "mocap").limit(200),
      bodyNumbers(p.id),
    ]);
    let history = error ? [] : (data || []).map((r) => r.data);
    box.replaceChildren();
    if (!window.MoCap) { box.append(note("Motion capture didn't load. Reload the page.")); return; }
    window.MoCap.mount(box, {
      kind: which, openId,
      athlete: { id: String(p.id), name: p.name, throws: p.throws || "", bats: p.bats || "", email: p.email || "", heightIn: body.heightIn, weightLb: body.weightLb, weightFrom: body.weightFrom },
      saveHeight: (h) => saveHeight(p.id, h),
      history: () => history,
      onSave: async (rec) => {
        // the dashboard keeps an athlete's id as a number inside each record
        const record = { ...rec, athleteId: /^\d+$/.test(String(p.id)) ? Number(p.id) : p.id };
        const res = await sb.from("assessments").upsert({ id: rec.id, athlete_id: String(p.id), data: record });
        if (res.error) throw new Error("check your connection and try again");
        history = [...history.filter((h) => h.id !== record.id), record];
      },
      // results sent to his biomechanical assessment: his latest from the last two weeks, or a new one dated today
      fillAssessment: async (entries) => {
        const { data, error } = await sb.from("assessments").select("id, data").eq("athlete_id", String(p.id)).limit(500);
        if (error) throw new Error("check your connection and try again");
        const today = new Date().toISOString().slice(0, 10), recent = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
        const last = (data || []).map((r) => ({ ...r.data, id: r.data.id || r.id })).filter((r) => !r.kind && r.date).sort((a, b) => a.date.localeCompare(b.date)).pop();
        const athleteId = /^\d+$/.test(String(p.id)) ? Number(p.id) : p.id;
        const base = last && last.date >= recent ? last : { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, athleteId, date: today, coach: "" };
        const rec = window.MoCap.lib.applyToAssessment(base, entries);
        const res = await sb.from("assessments").upsert({ id: rec.id, athlete_id: String(p.id), data: rec });
        if (res.error) throw new Error("check your connection and try again");
        return base === last ? `the ${last.date} assessment` : `a new assessment dated ${today}`;
      },
      // another pitcher's session, re-run from here: saved to him
      saveAny: async (rec) => {
        const res = await sb.from("assessments").upsert({ id: rec.id, athlete_id: String(rec.athleteId), data: rec });
        if (res.error) throw new Error("check your connection and try again");
      },
      onDelete: async (rec) => {
        const res = await sb.from("assessments").delete().eq("id", rec.id);
        if (res.error) throw new Error("check your connection and try again");
        history = history.filter((h) => h.id !== rec.id);
      },
    });
  }

  window.MoCapApp = { open, mountFor, mountAssessFor, bodyNumbers };
})();
