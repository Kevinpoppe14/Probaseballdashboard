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
  const KINDS = [["pitching", "Pitching", "a delivery"], ["hitting", "Hitting", "a swing"], ["sprint", "Sprint", "a start or a fly sprint"], ["jump", "Jump", "a jump"], ["screen", "Movement Screen", "a screen test (ROM, overhead squat)"]];
  let kind = "pitching";
  function chooseKind() {
    sheet(el("h2", null, "Motion Capture"), note("What are you filming?"),
      el("div", { class: "qa-list" }, KINDS.filter(([k]) => k === "pitching" || (window.MoCap && window.MoCap.kinds && window.MoCap.kinds[k])).map(([k, label, what]) =>
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
    sheet(el("h2", null, `Motion Capture: ${label}`), note(`Film ${what} in slow motion (tips on the next screen) and get the mechanics in numbers. Who is it?`),
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
    box.append(note("Loading…"));
    const { data, error } = await sb.from("assessments").select("id,data").eq("athlete_id", String(p.id)).eq("data->>kind", "mocap").limit(200);
    let history = error ? [] : (data || []).map((r) => r.data);
    box.replaceChildren();
    if (!window.MoCap) { box.append(note("Motion capture didn't load. Reload the page.")); return; }
    window.MoCap.mount(box, {
      kind, athlete: { id: String(p.id), name: p.name, throws: p.throws || "", bats: p.bats || "", email: p.email || "" },
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

  window.MoCapApp = { open };
})();
