// Quick program drop: from the Coach tab of a coach's own phone app (athlete.html with ?staff=1), put a saved
// program on their own plan or any active athlete's, without opening the dashboard. The coach picks who, then a
// program from the library (athletes' own copies are left out), sees it week by week, picks this week or next,
// and assigns it. It goes on the plan exactly as the dashboard's Assign puts it there (periodization.js
// assignProgram): a block in the Strength row, one week per program week, starting that Monday; a plan that
// starts later is extended back, and someone with no plan gets one. The shared program itself is never changed.
//
// Blocks dropped this way are marked quickDrop, with the coach who did it (assignedBy), so the Coach tab can list
// the ones this coach dropped and take any of them off again. Everything reads and writes under the coach's own
// login (signed-in staff), so it needs them signed in; the sheet asks if they aren't.
(function () {
  const sb = window.supabaseClient;
  const Rx = window.ProgramRx;
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

  // ---- the plan, as periodization.js keeps it ----------------------------------------------------------
  const MAX_WEEKS = 60;
  const PALETTE = ["#b5283a", "#f59e0b", "#14b8a6", "#3b82f6", "#8b5cf6", "#22c55e", "#ec4899", "#6b7280"];
  const LANE = "Strength";
  const uid = () => Math.random().toString(36).slice(2, 10);
  const pad = (n) => String(n).padStart(2, "0");
  const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseISO = (s) => { const [y, m, d] = String(s).split("-").map(Number); return new Date(y, m - 1, d); };
  const addDays = (iso, n) => { const d = parseISO(iso); d.setDate(d.getDate() + n); return toISO(d); };
  const mondayIn = (weeks) => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + weeks * 7); return toISO(d); };
  const day = (iso) => parseISO(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const defaultLanes = () => [
    { id: uid(), name: "Phase", color: PALETTE[4] },
    { id: uid(), name: "Running", color: PALETTE[3] },
    { id: uid(), name: "Strength", color: PALETTE[0] },
    { id: uid(), name: "Correctives", color: PALETTE[5] },
    { id: uid(), name: "Throwing", color: PALETTE[1] },
  ];
  // a block's first and last day
  const blockDates = (startDate, b) => `${day(addDays(startDate, b.start * 7))} – ${day(addDays(startDate, (b.start + b.len) * 7 - 1))}`;

  // "added", "created" (they had no plan), "already" (that program is on their plan) or "out-of-range"
  async function assign(person, program, startDate, email) {
    const { data: row, error } = await sb.from("periodization").select("data").eq("athlete_id", String(person.id)).maybeSingle();
    if (error) throw error;
    const existing = row && row.data;
    const plan = existing ? JSON.parse(JSON.stringify(existing)) : { startDate, weeks: 16, lanes: defaultLanes(), blocks: [], goals: { physical: [] }, actionPlan: "" };
    plan.lanes = plan.lanes || [];
    plan.blocks = plan.blocks || [];
    if (plan.blocks.some((b) => b.programId === program.id)) return "already";
    let start = Math.floor(Math.round((parseISO(startDate) - parseISO(plan.startDate)) / 864e5) / 7);
    if (start < 0) { // the plan starts later: it's extended back to that week
      const shift = -start;
      plan.startDate = addDays(plan.startDate, -shift * 7);
      plan.blocks.forEach((b) => { b.start += shift; });
      plan.weeks += shift;
      start = 0;
    }
    if (start >= MAX_WEEKS) return "out-of-range";
    let lane = plan.lanes.find((l) => (l.name || "").toLowerCase() === LANE.toLowerCase());
    if (!lane) { lane = { id: uid(), name: LANE, color: PALETTE[plan.lanes.length % PALETTE.length] }; plan.lanes.push(lane); }
    const len = Math.min(Math.max(1, (program.weeks || []).length), MAX_WEEKS - start);
    plan.blocks.push({ id: uid(), lane: lane.id, start, len, label: program.name || "Program", notes: "", color: null, programId: program.id, assignedBy: email, quickDrop: true, quickDropAt: new Date().toISOString() });
    plan.weeks = Math.max(1, Math.min(MAX_WEEKS, Math.max(plan.weeks || 1, start + len)));
    const { error: saveError } = await sb.from("periodization").upsert({ athlete_id: String(person.id), data: plan, updated_at: new Date().toISOString() });
    if (saveError) throw saveError;
    return existing ? "added" : "created";
  }

  async function removeBlock(athleteId, blockId) {
    const { data: row, error } = await sb.from("periodization").select("data").eq("athlete_id", String(athleteId)).maybeSingle();
    if (error) throw error;
    if (!row || !row.data) return;
    const plan = row.data;
    plan.blocks = (plan.blocks || []).filter((b) => b.id !== blockId);
    const { error: saveError } = await sb.from("periodization").upsert({ athlete_id: String(athleteId), data: plan, updated_at: new Date().toISOString() });
    if (saveError) throw saveError;
  }

  // ---- a quick strength session (one-off) -----------------------------------------------------------------------
  // One day of a program, sent for a single date, the way Coach Mode sends a group speed session (coach.js
  // sendSpeed): a row called "Quick Strength Session" on the person's plan, with one small program per week
  // ("gstrength-<athlete>-<monday>", window.isSentProgram) holding each session sent for that week as a day.
  // Unlike speed, its exercises keep their weight boxes. Each sent day records who sent it, so it can be taken
  // off again; the week's program and its block go once their last day does.
  const ONEOFF_LANE = "Quick Strength Session";
  const OLD_LANE = "One-off Strength"; // what the row was called at first; a plan that has it gets it renamed
  async function sendOneOff(person, program, session, date, email) {
    const aid = String(person.id);
    const got = await sb.from("periodization").select("data").eq("athlete_id", aid).maybeSingle();
    if (got.error) throw got.error;
    const monday = (iso) => { const d = parseISO(iso); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return toISO(d); };
    const plan = (got.data && got.data.data) || { startDate: monday(date), weeks: 16, lanes: defaultLanes(), blocks: [], goals: { physical: [] }, actionPlan: "" };
    plan.lanes = plan.lanes || [];
    plan.blocks = plan.blocks || [];
    let wk = Math.floor(Math.round((parseISO(date) - parseISO(plan.startDate)) / 864e5) / 7);
    if (wk < 0) { // the plan starts later: it's extended back to that week
      const shift = -wk;
      plan.startDate = addDays(plan.startDate, -shift * 7);
      plan.blocks.forEach((b) => { b.start += shift; });
      plan.weeks += shift;
      wk = 0;
    }
    if (wk >= MAX_WEEKS) return "out-of-range";
    const weekStart = addDays(plan.startDate, wk * 7);
    const pid = `gstrength-${aid}-${weekStart}`;
    const have = await sb.from("programs").select("data").eq("id", pid).maybeSingle();
    if (have.error) throw have.error;
    const week = (have.data && have.data.data) || { name: `${ONEOFF_LANE} · week of ${day(weekStart)}`, folder: ONEOFF_LANE, createdBy: email, createdAt: new Date().toISOString(), weeks: [{ name: "Week 1", sessions: [] }] };
    if (!Array.isArray(week.weeks) || !week.weeks.length) week.weeks = [{ name: "Week 1", sessions: [] }];
    const sessions = week.weeks[0].sessions = week.weeks[0].sessions || [];
    const copy = JSON.parse(JSON.stringify(session));
    sessions.push({
      ...copy,
      name: `${parseISO(date).toLocaleDateString(undefined, { weekday: "short", month: "numeric", day: "numeric" })} · ${(session.name || "").trim() || program.name || "Session"}`,
      exercises: (copy.exercises || []).map((e) => ({ ...e, id: `ex-${uid()}` })), // its own ids, so nothing logged elsewhere lands on it
      oneOffId: uid(), sentBy: email, sentAt: new Date().toISOString(), date, fromProgram: program.id,
    });
    week.name = `${ONEOFF_LANE} · week of ${day(weekStart)}`;
    week.folder = ONEOFF_LANE;
    const saved = await sb.from("programs").upsert({ id: pid, data: week });
    if (saved.error) throw saved.error;
    // the row, renamed if it still has its first name, and this week's block in it
    let changed = !got.data || !got.data.data;
    let lane = plan.lanes.find((l) => [ONEOFF_LANE, OLD_LANE].map((n) => n.toLowerCase()).includes((l.name || "").toLowerCase()));
    if (lane && lane.name !== ONEOFF_LANE) {
      lane.name = ONEOFF_LANE;
      plan.blocks.forEach((b) => { if (b.lane === lane.id && b.label === OLD_LANE) b.label = ONEOFF_LANE; });
      changed = true;
    }
    if (!plan.blocks.some((b) => b.programId === pid)) {
      if (!lane) { lane = { id: uid(), name: ONEOFF_LANE, color: PALETTE[0] }; plan.lanes.push(lane); }
      plan.blocks.push({ id: uid(), lane: lane.id, start: wk, len: 1, label: ONEOFF_LANE, notes: "", color: null, programId: pid, assignedBy: email });
      plan.weeks = Math.max(1, Math.min(MAX_WEEKS, Math.max(plan.weeks || 1, wk + 1)));
      changed = true;
    }
    if (changed) {
      const put = await sb.from("periodization").upsert({ athlete_id: aid, data: plan, updated_at: new Date().toISOString() });
      if (put.error) throw put.error;
    }
    return "sent";
  }

  async function removeOneOff(pid, oneOffId) {
    const have = await sb.from("programs").select("data").eq("id", pid).maybeSingle();
    if (have.error) throw have.error;
    if (!have.data) return;
    const week = have.data.data;
    const sessions = ((week.weeks || [])[0] || {}).sessions || [];
    const at = sessions.findIndex((s) => s.oneOffId === oneOffId);
    if (at < 0) return;
    const aid = pid.replace(/^gstrength-/, "").replace(/-\d{4}-\d{2}-\d{2}$/, "");
    // A session that's been logged stays: what was logged is in the Training Log, which needs the session to show
    // it. A session can't come out from before a logged one either, since each day's "done" mark is kept by its
    // place in the week and the later one would slip into this one's place.
    const { data: logs, error: logError } = await sb.from("athlete_logs").select("key, value").eq("athlete_id", aid).eq("program_id", pid);
    if (logError) throw logError;
    const keys = (logs || []).filter((r) => r.value).map((r) => r.key);
    const isLogged = (s, i) => keys.some((k) => k === `session-0-${i}|0` || (s.exercises || []).some((e) => k.startsWith(`${e.id}|`)));
    const logged = sessions.map(isLogged);
    if (logged[at]) throw new Error("This session has already been logged, so it stays on file and in the Training Log.");
    if (logged.slice(at + 1).some(Boolean)) throw new Error("A later quick session that week has already been logged, so this one stays to keep that one in place.");
    week.weeks[0].sessions = sessions.filter((s, i) => i !== at);
    if (week.weeks[0].sessions.length) {
      const saved = await sb.from("programs").upsert({ id: pid, data: week });
      if (saved.error) throw saved.error;
      return;
    }
    // that was the week's last day: its block comes off the plan, and the empty week program goes
    const got = await sb.from("periodization").select("data").eq("athlete_id", aid).maybeSingle();
    if (got.error) throw got.error;
    if (got.data && got.data.data) {
      const plan = got.data.data;
      plan.blocks = (plan.blocks || []).filter((b) => b.programId !== pid);
      const put = await sb.from("periodization").upsert({ athlete_id: aid, data: plan, updated_at: new Date().toISOString() });
      if (put.error) throw put.error;
    }
    const gone = await sb.from("programs").delete().eq("id", pid);
    if (gone.error) throw gone.error;
  }

  // every row of a table (the database hands back at most 1,000 at a time)
  async function readAll(table, columns) {
    const rows = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from(table).select(columns).order(table === "periodization" ? "athlete_id" : "id").range(from, from + 999);
      if (error) throw error;
      rows.push(...(data || []));
      if (!data || data.length < 1000) return rows;
    }
  }

  // ---- the sheet ---------------------------------------------------------------------------------------
  let ctx = null; // { overlay, close, status, onAssignedSelf, user, people, programs, me }
  const lastFirst = (name) => { const p = (name || "").trim().split(/\s+/); return p.length > 1 ? `${p[p.length - 1]}, ${p.slice(0, -1).join(" ")}` : name || ""; };
  const firstName = (name) => (name || "").trim().split(/\s+/)[0] || "them";
  const sheet = (...kids) => {
    ctx.overlay.replaceChildren(el("div", { class: "sheet qa" }, el("button", { class: "close", "aria-label": "Close", onclick: ctx.close }, "×"), ...kids));
    ctx.overlay.className = "overlay show";
    ctx.overlay.scrollTop = 0;
  };
  const note = (text) => el("div", { class: "swap-coach" }, text);
  const errorText = (e) => (e && e.message) || "Something went wrong. Check your connection and try again.";

  async function open(options) {
    ctx = { ...(ctx || {}), ...options };
    sheet(el("h2", null, "Assign a program"), note("Loading…"));
    const { data } = await sb.auth.getSession();
    if (!data || !data.session) { signIn(); return; }
    ctx.user = data.session.user;
    try {
      if (!ctx.people) {
        const [people, programs] = await Promise.all([
          readAll("athletes", "id, name:data->>name, status:data->>status, coachUser:data->>coachUserId"),
          readAll("programs", "id, name:data->>name, folder:data->>folder, owner:data->>athleteId"),
        ]);
        ctx.people = people.filter((p) => (p.status || "active").toLowerCase() === "active" && (p.name || "").trim()).sort((a, b) => lastFirst(a.name).localeCompare(lastFirst(b.name)));
        ctx.programs = programs.filter((p) => !p.owner && !String(p.id).startsWith("gspeed-") && (p.name || "").trim()).sort((a, b) => a.name.localeCompare(b.name));
      }
      ctx.me = ctx.people.find((p) => p.coachUser && p.coachUser === ctx.user.id) || null;
      home();
    } catch (e) { sheet(el("h2", null, "Assign a program"), note(errorText(e))); }
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
    sheet(el("h2", null, "Assign a program"), note("Sign in with your dashboard account."),
      el("form", { class: "qa-signin", onsubmit: go }, email, password, msg, el("div", { class: "swap-actions" }, el("button", { class: "primary", type: "submit" }, "Sign in"))));
  }

  // who it's for, and the quick programs this coach has dropped
  function home() {
    const results = el("div", { class: "qa-list" });
    const search = el("input", { type: "search", placeholder: "Search for an athlete", "aria-label": "Search for an athlete", autocomplete: "off" });
    const show = () => {
      const q = search.value.trim().toLowerCase();
      const hits = q ? ctx.people.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 8) : [];
      results.replaceChildren(...hits.map((p) => el("button", { class: "qa-row", onclick: () => pickProgram(p) }, lastFirst(p.name))),
        q && !hits.length ? el("div", { class: "qa-empty" }, "No active athlete matches that.") : null);
    };
    search.addEventListener("input", show);
    const mine = el("div", { class: "qa-list" }, el("div", { class: "qa-empty" }, "Loading…"));
    sheet(el("h2", null, "Assign a program"),
      el("div", { class: "qa-label" }, "Who is it for?"),
      ctx.me ? el("button", { class: "qa-row qa-me", onclick: () => pickProgram(ctx.me) }, "Me", el("small", null, ctx.me.name)) : null,
      search, results,
      el("div", { class: "qa-label" }, "Quick programs you've assigned"), mine);
    loadMine(mine);
  }

  async function loadMine(box) {
    try {
      const rows = await readAll("periodization", "athlete_id, startDate:data->>startDate, blocks:data->blocks");
      const name = (id) => (ctx.people.find((p) => String(p.id) === String(id)) || {}).name || "Unknown athlete";
      const drops = [];
      rows.forEach((r) => (Array.isArray(r.blocks) ? r.blocks : []).forEach((b) => {
        if (b && b.quickDrop && b.assignedBy === ctx.user.email) drops.push({ athleteId: r.athlete_id, startDate: r.startDate, b, from: addDays(r.startDate, b.start * 7) });
      }));
      // and the quick strength sessions this coach sent: days of the "gstrength-" week programs
      const { data: weeks, error } = await sb.from("programs").select("id, data").like("id", "gstrength-%").limit(5000);
      if (error) throw error;
      (weeks || []).forEach((w) => ((((w.data || {}).weeks || [])[0] || {}).sessions || []).forEach((s) => {
        if (s.sentBy === ctx.user.email) drops.push({ athleteId: w.id.replace(/^gstrength-/, "").replace(/-\d{4}-\d{2}-\d{2}$/, ""), oneOff: { pid: w.id, s }, from: s.date || "" });
      }));
      drops.sort((x, y) => y.from.localeCompare(x.from));
      const remove = (d) => async (e) => {
        const what = d.oneOff ? `the quick strength session "${d.oneOff.s.name}"` : `"${d.b.label || "this program"}"`;
        if (!window.confirm(`Take ${what} off ${name(d.athleteId)}'s plan? Anything they logged in it stays on file.`)) return;
        e.target.disabled = true;
        try {
          if (d.oneOff) await removeOneOff(d.oneOff.pid, d.oneOff.s.oneOffId);
          else await removeBlock(d.athleteId, d.b.id);
          ctx.status("Removed");
          if (ctx.me && String(d.athleteId) === String(ctx.me.id) && ctx.onAssignedSelf) { ctx.onAssignedSelf(); return; }
          loadMine(box);
        } catch (err) { e.target.disabled = false; window.alert(errorText(err)); }
      };
      box.replaceChildren(...(drops.length ? drops.map((d) => el("div", { class: "qa-drop" },
        el("div", { class: "qa-drop-text" },
          d.oneOff ? el("b", null, el("span", { class: "qa-tag" }, "Quick session"), d.oneOff.s.name) : el("b", null, d.b.label || "Program"),
          el("small", null, `${lastFirst(name(d.athleteId))} · ${d.oneOff ? day(d.oneOff.s.date) : blockDates(d.startDate, d.b)}`)),
        el("button", { class: "qa-remove", onclick: remove(d) }, "Remove"))) : [el("div", { class: "qa-empty" }, "None yet. Programs and sessions you send from here are listed so you can take them off again.")]));
    } catch (e) { box.replaceChildren(el("div", { class: "qa-empty" }, errorText(e))); }
  }

  // the program, from the library
  function pickProgram(person) {
    const results = el("div", { class: "qa-list" });
    const search = el("input", { type: "search", placeholder: "Search programs", "aria-label": "Search programs", autocomplete: "off" });
    const show = () => {
      const q = search.value.trim().toLowerCase();
      const hits = ctx.programs.filter((p) => !q || `${p.name} ${p.folder || ""}`.toLowerCase().includes(q)).slice(0, 40);
      results.replaceChildren(...hits.map((p) => el("button", { class: "qa-row", onclick: () => preview(person, p.id) }, p.name, p.folder ? el("small", null, p.folder) : null)),
        !hits.length ? el("div", { class: "qa-empty" }, "No program matches that.") : null);
    };
    search.addEventListener("input", show);
    sheet(el("h2", null, `A program for ${person === ctx.me ? "you" : firstName(person.name)}`),
      el("button", { class: "qa-back", onclick: home }, "‹ Back"),
      search, results);
    show();
    search.focus();
  }

  // the program week by week, then this week or next, then assign
  async function preview(person, programId) {
    sheet(el("h2", null, "Preview"), note("Loading…"));
    let program;
    try {
      const { data, error } = await sb.from("programs").select("id, data").eq("id", programId).maybeSingle();
      if (error || !data) throw error || new Error("That program couldn't be found.");
      program = { id: data.id, ...data.data };
    } catch (e) { sheet(el("h2", null, "Preview"), el("button", { class: "qa-back", onclick: () => pickProgram(person) }, "‹ Back"), note(errorText(e))); return; }
    const weeks = program.weeks || [];
    let wi = 0, startIn = 0; // week shown; 0 = starts this week, 1 = next week
    const draw = () => {
      const w = weeks[wi] || { sessions: [] };
      const sessions = (w.sessions || []).filter((s) => (s.exercises || []).some((e) => (e.name || "").trim()));
      const startDate = mondayIn(startIn);
      const who = person === ctx.me ? "me" : firstName(person.name);
      const msg = el("div", { class: "swap-note" });
      const go = el("button", { class: "primary", onclick: async () => {
        go.disabled = true;
        msg.textContent = "Assigning…";
        try {
          const r = await assign(person, program, startDate, ctx.user.email);
          if (r === "already") { msg.textContent = `${person === ctx.me ? "You already have" : `${person.name} already has`} this program on ${person === ctx.me ? "your" : "their"} plan.`; go.disabled = false; return; }
          if (r === "out-of-range") { msg.textContent = "That week is past the end of the plan. Assign it from the dashboard."; go.disabled = false; return; }
          ctx.status(`Assigned: ${program.name}, from ${day(startDate)}`);
          if (person === ctx.me && ctx.onAssignedSelf) { ctx.onAssignedSelf(); return; }
          home();
        } catch (e) { msg.textContent = errorText(e); go.disabled = false; }
      } }, `Assign to ${who}`);
      sheet(el("h2", null, program.name || "Program"),
        el("button", { class: "qa-back", onclick: () => pickProgram(person) }, "‹ Back"),
        el("div", { class: "qa-sub" }, `${weeks.length} week${weeks.length === 1 ? "" : "s"}${program.folder ? ` · ${program.folder}` : ""}`),
        program.description ? el("p", { class: "qa-desc" }, program.description) : null,
        weeks.length > 1 ? el("div", { class: "qa-weeknav" },
          el("button", { class: "nav", "aria-label": "Previous week", disabled: wi === 0, onclick: () => { wi -= 1; draw(); } }, "‹"),
          el("b", null, `${w.name || `Week ${wi + 1}`}`, el("small", null, ` ${wi + 1} of ${weeks.length}`)),
          el("button", { class: "nav", "aria-label": "Next week", disabled: wi >= weeks.length - 1, onclick: () => { wi += 1; draw(); } }, "›")) : null,
        sessions.length ? sessions.map((s, si) => {
          const rows = (s.exercises || []).filter((e) => (e.name || "").trim());
          const labels = window.exerciseLabels ? window.exerciseLabels(rows) : rows.map(() => "");
          return el("div", { class: "qa-day" },
            el("div", { class: "qa-day-head" },
              el("span", { class: "qa-day-name" }, (s.name || "").trim() || `Day ${si + 1}`),
              el("button", { class: "qa-oneoff", onclick: () => oneOff(person, program, s) }, person === ctx.me ? "Do this today" : "Send as a quick session")),
            (s.warmup || "").trim() ? el("div", { class: "qa-warm" }, `Warm-up: ${s.warmup.trim()}`) : null,
            rows.map((e, ei) => el("div", { class: "qa-ex" },
              el("span", { class: "qa-ex-label" }, labels[ei] || ""),
              el("span", { class: "qa-ex-name" }, e.name.trim()),
              el("span", { class: "qa-ex-rx" }, [Rx.text(e), e.rest ? `rest ${e.rest}` : ""].filter(Boolean).join(" · ")))));
        }) : el("div", { class: "qa-empty" }, "Nothing is written in this week."),
        el("div", { class: "qa-label" }, "Starts"),
        el("div", { class: "chips qa-starts" },
          el("button", { class: `chip${startIn === 0 ? " on" : ""}`, onclick: () => { startIn = 0; draw(); } }, `This week · ${day(mondayIn(0))}`),
          el("button", { class: `chip${startIn === 1 ? " on" : ""}`, onclick: () => { startIn = 1; draw(); } }, `Next week · ${day(mondayIn(1))}`)),
        el("div", { class: "qa-sub" }, `On ${person === ctx.me ? "your" : `${person.name}'s`} plan in the ${LANE} row, ${day(startDate)} – ${day(addDays(startDate, Math.max(1, weeks.length) * 7 - 1))}.`),
        msg,
        el("div", { class: "swap-actions" }, go, el("button", { onclick: () => pickProgram(person) }, "Back")));
    };
    draw();
  }

  // one day of the program, for one date: a one-off session on their plan. For the coach themselves it's a quick
  // way to log an impromptu lift: it goes on their own plan for today (or the day they pick), and their app
  // reloads and opens on it, ready to log.
  function oneOff(person, program, session) {
    const today = toISO(new Date());
    const self = person === ctx.me;
    const date = el("input", { type: "date", value: today, min: self ? null : today, "aria-label": "Date" });
    const msg = el("div", { class: "swap-note" });
    const who = self ? "me" : firstName(person.name);
    const rows = (session.exercises || []).filter((e) => (e.name || "").trim());
    if (self) {
      const add = el("button", { class: "primary", onclick: async () => {
        if (!date.value) { msg.textContent = "Pick a date."; return; }
        add.disabled = true;
        msg.textContent = "Adding…";
        try {
          const r = await sendOneOff(person, program, session, date.value, ctx.user.email);
          if (r === "out-of-range") { msg.textContent = "That date is past the end of your plan."; add.disabled = false; return; }
          ctx.status(date.value === today ? "Added to today. Opening it…" : `Added for ${day(date.value)}`);
          if (ctx.onAssignedSelf) ctx.onAssignedSelf();
        } catch (e) { msg.textContent = errorText(e); add.disabled = false; }
      } }, date.value === today ? "Add to my day" : "Add it");
      date.addEventListener("change", () => { add.textContent = date.value === today ? "Add to my day" : "Add it"; });
      sheet(el("h2", null, "Today's lift"),
        el("button", { class: "qa-back", onclick: () => preview(person, program.id) }, "‹ Back"),
        el("div", { class: "qa-sub" }, `${(session.name || "").trim() || "This day"} from ${program.name}: ${rows.length} exercise${rows.length === 1 ? "" : "s"}. It goes in your app under "${ONEOFF_LANE}" and opens there, ready to log. Your regular program isn't changed.`),
        el("label", { class: "qa-date" }, "Date", date),
        msg,
        el("div", { class: "swap-actions" }, add, el("button", { onclick: () => preview(person, program.id) }, "Back")));
      return;
    }
    const go = el("button", { class: "primary", onclick: async () => {
      if (!date.value) { msg.textContent = "Pick a date."; return; }
      go.disabled = true;
      msg.textContent = "Sending…";
      try {
        const r = await sendOneOff(person, program, session, date.value, ctx.user.email);
        if (r === "out-of-range") { msg.textContent = "That date is past the end of the plan."; go.disabled = false; return; }
        ctx.status(`Sent: ${(session.name || "").trim() || "session"} for ${day(date.value)}`);
        if (person === ctx.me && ctx.onAssignedSelf) { ctx.onAssignedSelf(); return; }
        home();
      } catch (e) { msg.textContent = errorText(e); go.disabled = false; }
    } }, `Send to ${who}`);
    sheet(el("h2", null, "Quick strength session"),
      el("button", { class: "qa-back", onclick: () => preview(person, program.id) }, "‹ Back"),
      el("div", { class: "qa-sub" }, `${(session.name || "").trim() || "This day"} from ${program.name}: ${rows.length} exercise${rows.length === 1 ? "" : "s"}. It shows in ${person === ctx.me ? "your" : `${person.name}'s`} app under "${ONEOFF_LANE}" for that day's week, with weight boxes as usual.`),
      el("label", { class: "qa-date" }, "Date", date),
      msg,
      el("div", { class: "swap-actions" }, go, el("button", { onclick: () => preview(person, program.id) }, "Back")));
  }

  window.QuickAssign = { open };
})();
