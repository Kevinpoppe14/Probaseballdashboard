// Quick program drop: from the Coach tab of a coach's own phone app (athlete.html with ?staff=1), put a saved
// program on their own plan or any active athlete's, without opening the dashboard. The coach picks who, then a
// program from the library (athletes' own copies are left out), sees it week by week, picks this week or next,
// and assigns it. It goes on the plan exactly as the dashboard's Assign puts it there (periodization.js
// assignProgram): a block in the Strength row, one week per program week, starting that Monday; a plan that
// starts later is extended back, and someone with no plan gets one. The shared program itself is never changed.
//
// Blocks dropped this way are marked quickDrop, with the coach who did it (assignedBy), so the Coach tab can list
// the ones this coach dropped and take any of them off again. Assigning ends on a screen with Undo and Change, and
// any program can be moved to start another week or swapped for a different one (manage). Everything reads and writes under the coach's own
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
  // replaces what's in a box, the way el() fills one: lists are spread and nothing-to-show (null, false) is skipped
  const fill = (box, ...kids) => box.replaceChildren(...kids.flat(Infinity).filter((c) => c != null && c !== false));

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
  let lastBlockId = null, lastBlockStart = null; // the block assigned, or the one already there ("already")
  // set when the coach's own plan changes while the sheet is open, so the app reloads to show it however the
  // sheet is closed (window.QuickAssign.takeChange, used by athlete.js)
  let selfChanged = false;
  async function assign(person, program, startDate, email) {
    const { data: row, error } = await sb.from("periodization").select("data").eq("athlete_id", String(person.id)).maybeSingle();
    if (error) throw error;
    const existing = row && row.data;
    const plan = existing ? JSON.parse(JSON.stringify(existing)) : { startDate, weeks: 16, lanes: defaultLanes(), blocks: [], goals: { physical: [] }, actionPlan: "" };
    plan.lanes = plan.lanes || [];
    plan.blocks = plan.blocks || [];
    const have = plan.blocks.find((b) => b.programId === program.id);
    if (have) { lastBlockId = have.id; lastBlockStart = addDays(plan.startDate, have.start * 7); return "already"; }
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
    lastBlockId = uid(); // so the Assigned screen can undo or change this block
    plan.blocks.push({ id: lastBlockId, lane: lane.id, start, len, label: program.name || "Program", notes: "", color: null, programId: program.id, assignedBy: email, quickDrop: true, quickDropAt: new Date().toISOString() });
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

  // a block moved to start the week of startDate (a Monday): "moved", "gone" (not on the plan) or "out-of-range".
  // A plan that starts later is extended back, as assign() does. What was logged in it stays with the program.
  async function moveBlock(athleteId, blockId, startDate) {
    const { data: row, error } = await sb.from("periodization").select("data").eq("athlete_id", String(athleteId)).maybeSingle();
    if (error) throw error;
    const plan = row && row.data;
    const b = plan && (plan.blocks || []).find((x) => x.id === blockId);
    if (!b) return "gone";
    let start = Math.floor(Math.round((parseISO(startDate) - parseISO(plan.startDate)) / 864e5) / 7);
    if (start < 0) {
      const shift = -start;
      plan.startDate = addDays(plan.startDate, -shift * 7);
      plan.blocks.forEach((x) => { x.start += shift; });
      plan.weeks += shift;
      start = 0;
    }
    if (start + b.len > MAX_WEEKS) return "out-of-range";
    b.start = start;
    plan.weeks = Math.max(1, Math.min(MAX_WEEKS, Math.max(plan.weeks || 1, start + b.len)));
    const { error: saveError } = await sb.from("periodization").upsert({ athlete_id: String(athleteId), data: plan, updated_at: new Date().toISOString() });
    if (saveError) throw saveError;
    return "moved";
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
    fill(ctx.overlay, el("div", { class: "sheet qa" }, el("button", { class: "close", "aria-label": "Close", onclick: ctx.close }, "×"), ...kids));
    ctx.overlay.className = "overlay show";
    ctx.overlay.scrollTop = 0;
  };
  const note = (text) => el("div", { class: "swap-coach" }, text);
  const errorText = (e) => (e && e.message) || "Something went wrong. Check your connection and try again.";

  async function open(options) {
    ctx = { ...(ctx || {}), ...options };
    sheet(el("h2", null, ctx.mode === "build" ? "Create Quick Session" : "Assign Existing Program"), note("Loading…"));
    const { data } = await sb.auth.getSession();
    if (!data || !data.session) { signIn(); return; }
    ctx.user = data.session.user;
    try {
      if (!ctx.people) {
        const [people, programs] = await Promise.all([
          readAll("athletes", "id, name:data->>name, status:data->>status, coachUser:data->>coachUserId"),
          readAll("programs", "id, name:data->>name, folder:data->>folder, owner:data->>athleteId, tags:data->tags"),
        ]);
        ctx.people = people.filter((p) => (p.status || "active").toLowerCase() === "active" && (p.name || "").trim()).sort((a, b) => lastFirst(a.name).localeCompare(lastFirst(b.name)));
        ctx.programs = programs.filter((p) => !p.owner && !window.isSentProgram(p.id) && (p.name || "").trim()).sort((a, b) => a.name.localeCompare(b.name));
      }
      ctx.me = ctx.people.find((p) => p.coachUser && p.coachUser === ctx.user.id) || null;
      // opened from the Change button on a program in the coach's own app: straight to changing it
      if (ctx.manage) { const id = ctx.manage; ctx.manage = null; if (ctx.me) { manage(ctx.me, id); return; } }
      if (ctx.mode === "build") { ctx.mode = null; build(); } else home();
    } catch (e) { sheet(el("h2", null, "Assign Existing Program"), note(errorText(e))); }
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

  // who it's for, and the quick programs this coach has dropped
  function home() {
    ctx.replacing = null; // back here, nothing is being swapped out
    const results = el("div", { class: "qa-list" });
    const search = el("input", { type: "search", placeholder: "Search for an athlete", "aria-label": "Search for an athlete", autocomplete: "off" });
    const show = () => {
      const q = search.value.trim().toLowerCase();
      const hits = q ? ctx.people.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 8) : [];
      fill(results, ...hits.map((p) => el("button", { class: "qa-row", onclick: () => pickProgram(p) }, lastFirst(p.name))),
        q && !hits.length ? el("div", { class: "qa-empty" }, "No active athlete matches that.") : null);
    };
    search.addEventListener("input", show);
    const mine = el("div", { class: "qa-list" }, el("div", { class: "qa-empty" }, "Loading…"));
    sheet(el("h2", null, "Assign Existing Program"),
      el("button", { class: "qa-row qa-build", onclick: () => build() }, "Create Quick Session", el("small", null, "Write a session from scratch, for you or an athlete")),
      el("div", { class: "qa-label" }, "Or assign a saved program. Who is it for?"),
      ctx.me ? el("button", { class: "qa-row qa-me", onclick: () => pickProgram(ctx.me) }, "Me", el("small", null, ctx.me.name)) : null,
      search, results,
      el("div", { class: "qa-label" }, "Programs and quick sessions you've sent"), mine);
    loadMine(mine);
  }

  // ---- a quick session written from scratch ------------------------------------------------------------
  // For a coach logging their own workout without a program, or sending one to an athlete (one away from home
  // with different equipment, say): exercises typed in (the library's names are offered), sets, reps, an
  // optional %, a note, and supersets (A1, A2 ...). It goes on the plan the same way as one day sent from a program
  // (sendOneOff), so it logs to the Training Log and counts toward maxes like any session. What's typed is kept
  // while the page is open, in case the sheet is closed before it's saved.
  let libraryNames = null;
  async function build() {
    if (!libraryNames) {
      try {
        const rows = await readAll("exercises", "id, name:data->>name");
        libraryNames = [...new Set(rows.map((r) => (r.name || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
      } catch (e) { libraryNames = []; }
    }
    const today = toISO(new Date());
    const blankRow = (linked) => ({ name: "", sets: "", reps: "", pct: "", notes: "", linked: !!linked });
    const d = ctx.draft = ctx.draft || { date: today, title: "", rows: [blankRow()] };
    const lib = el("datalist", { id: "qa-library" }, libraryNames.map((n) => el("option", { value: n })));
    const msg = el("div", { class: "swap-note" });
    const list = el("div", { class: "qa-build-rows" });
    const field = (row, key, attrs) => {
      const i = el("input", { value: row[key], autocomplete: "off", ...attrs });
      i.addEventListener("input", () => { row[key] = i.value; });
      return i;
    };
    const focusRow = (ri) => { const inputs = list.querySelectorAll(".qa-build-name"); if (inputs[ri]) inputs[ri].focus(); };
    // The rows in blocks, as the program builder lays them out: A1, A2 (a superset), then B1. Each block ends with
    // a button for its next exercise (A2., A3. ...); the last button starts the next block.
    const drawRows = () => {
      const letters = window.exerciseLabels ? window.exerciseLabels(d.rows.map((r) => ({ name: r.name || "x", linked: r.linked }))) : [];
      const blocks = [];
      d.rows.forEach((row, ri) => { if (!blocks.length || !(ri > 0 && row.linked)) blocks.push([]); blocks[blocks.length - 1].push(ri); });
      const card = (ri) => {
        const row = d.rows[ri];
        return el("div", { class: "qa-build-row" },
          el("div", { class: "qa-build-top" },
            el("span", { class: "qa-ex-label" }, letters[ri] || ""),
            field(row, "name", { placeholder: "Exercise", list: "qa-library", "aria-label": "Exercise", class: "qa-build-name" }),
            d.rows.length > 1 ? el("button", { class: "qa-build-x", type: "button", "aria-label": "Remove this exercise", onclick: () => {
              d.rows.splice(ri, 1);
              if (d.rows[ri] && (ri === 0 || !row.linked) && d.rows[ri].linked) d.rows[ri].linked = false; // the next one starts the block now
              if (d.rows[0]) d.rows[0].linked = false;
              drawRows();
            } }, "×") : null),
          el("div", { class: "qa-build-rx" },
            el("label", null, "Sets", field(row, "sets", { inputmode: "numeric", "aria-label": "Sets" })),
            el("label", null, "Reps", field(row, "reps", { "aria-label": "Reps" })),
            el("label", null, "% (optional)", field(row, "pct", { inputmode: "decimal", "aria-label": "Percent" }))),
          field(row, "notes", { placeholder: "Note (optional)", class: "qa-build-note", "aria-label": "Note" }));
      };
      fill(list, ...blocks.map((rows, bi) => {
        const letter = (/^[A-Z]+/.exec(letters[rows[0]] || "") || [String.fromCharCode(65 + bi)])[0];
        const last = rows[rows.length - 1];
        return el("div", { class: "qa-block" },
          rows.map(card),
          el("button", { class: "qa-add-in", type: "button", onclick: () => { d.rows.splice(last + 1, 0, blankRow(true)); drawRows(); focusRow(last + 1); } }, `+ Add ${letter}${rows.length + 1}.`));
      }));
      nextBlock.textContent = `+ Add ${String.fromCharCode(65 + Math.min(25, blocks.length))} block`;
    };
    const nextBlock = el("button", { class: "qa-add", type: "button", onclick: () => { d.rows.push(blankRow(false)); drawRows(); focusRow(d.rows.length - 1); } });
    const date = el("input", { type: "date", value: d.date, "aria-label": "Date" });
    const title = el("input", { value: d.title, placeholder: "Session name (optional), e.g. Hotel gym lower", autocomplete: "off", "aria-label": "Session name" });
    date.addEventListener("change", () => { d.date = date.value; addMine.textContent = d.date === today ? "Add to my day" : "Add to my plan"; });
    title.addEventListener("input", () => { d.title = title.value; });

    // the session as it will be saved, or a reason it can't be yet
    const sessionOf = () => {
      const rows = d.rows.filter((r) => r.name.trim());
      if (!rows.length) return "Add at least one exercise.";
      if (rows.some((r) => !`${r.sets}${r.reps}`.trim())) return "Give each exercise its sets or reps.";
      if (!d.date) return "Pick a date.";
      return {
        name: d.title.trim() || "Quick session",
        exercises: rows.map((r, i) => ({
          id: `ex-${uid()}`, name: r.name.trim().replace(/\s+/g, " "), tempo: "", rest: "", notes: r.notes.trim(), linked: i > 0 && r.linked,
          intensityUnit: rows.some((x) => `${x.pct}`.trim()) ? "%" : "",
          groups: [{ sets: `${r.sets}`.trim(), reps: `${r.reps}`.trim(), intensity: `${r.pct}`.trim().replace(/%$/, "") }],
        })),
      };
    };
    const saveFor = async (people, button) => {
      const session = sessionOf();
      if (typeof session === "string") { msg.textContent = session; return false; }
      button.disabled = true;
      msg.textContent = "Saving…";
      try {
        for (const person of people) {
          const r = await sendOneOff(person, { id: null, name: "Quick session" }, session, d.date, ctx.user.email);
          if (r === "out-of-range") throw new Error(`${person === ctx.me ? "That date is" : `${day(d.date)} is`} past the end of ${person === ctx.me ? "your" : `${person.name}'s`} plan.`);
        }
        return true;
      } catch (e) { msg.textContent = errorText(e); button.disabled = false; return false; }
    };

    // Add to my day: on the coach's own plan, and their app opens on it
    const addMine = el("button", { class: "primary", onclick: async () => {
      if (!(await saveFor([ctx.me], addMine))) return;
      ctx.draft = null;
      ctx.status(d.date === today ? "Added to today. Opening it…" : `Added for ${day(d.date)}`);
      if (ctx.onAssignedSelf) ctx.onAssignedSelf(); else home();
    } }, d.date === today ? "Add to my day" : "Add to my plan");
    // Share: to one athlete or several
    const share = el("button", { class: "primary", onclick: () => {
      const session = sessionOf();
      if (typeof session === "string") { msg.textContent = session; return; }
      shareSheet();
    } }, "Share");
    const discard = el("button", { onclick: () => { if (d.rows.some((r) => r.name.trim()) && !window.confirm("Discard this session?")) return; ctx.draft = null; home(); } }, "Discard");

    function shareSheet() {
      const picked = new Set();
      const search = el("input", { type: "search", placeholder: "Search for an athlete", "aria-label": "Search for an athlete", autocomplete: "off" });
      const results = el("div", { class: "qa-list" });
      const chosen = el("div", { class: "qa-chosen" });
      const smsg = el("div", { class: "swap-note" });
      const send = el("button", { class: "primary" });
      const draw = () => {
        const q = search.value.trim().toLowerCase();
        const hits = q ? ctx.people.filter((p) => p !== ctx.me && p.name.toLowerCase().includes(q)).slice(0, 8) : [];
        fill(results, ...hits.map((p) => el("button", { class: `qa-row${picked.has(p) ? " on" : ""}`, onclick: () => { if (picked.has(p)) picked.delete(p); else picked.add(p); search.value = ""; draw(); search.focus(); } }, `${picked.has(p) ? "✓ " : ""}${lastFirst(p.name)}`)),
          q && !hits.length ? el("div", { class: "qa-empty" }, "No active athlete matches that.") : null);
        fill(chosen, ...[...picked].map((p) => el("span", { class: "exercise-tag qa-chip" }, p.name, el("button", { type: "button", class: "exercise-alias-x", "aria-label": `Remove ${p.name}`, onclick: () => { picked.delete(p); draw(); } }, "×"))));
        send.disabled = !picked.size;
        send.textContent = picked.size ? `Send to ${picked.size === 1 ? firstName([...picked][0].name) : `${picked.size} athletes`}` : "Pick who to send it to";
      };
      search.addEventListener("input", draw);
      send.addEventListener("click", async () => {
        const people = [...picked];
        const ok = await saveFor(people, send);
        if (!ok) { smsg.textContent = msg.textContent; return; }
        ctx.draft = null;
        ctx.status(`Sent to ${people.length === 1 ? people[0].name : `${people.length} athletes`} for ${day(d.date)}`);
        home();
      });
      draw();
      sheet(el("h2", null, "Share"),
        el("button", { class: "qa-back", onclick: build }, "‹ Back to the session"),
        el("div", { class: "qa-sub" }, `${d.title.trim() || "Quick session"} for ${day(d.date)}: it goes in each athlete's app under "${ONEOFF_LANE}", ready to log.`),
        search, results,
        el("div", { class: "qa-label" }, "Sending to"), chosen,
        smsg,
        el("div", { class: "swap-actions" }, send, el("button", { onclick: build }, "Back")));
      search.focus();
    }

    drawRows();
    sheet(el("h2", null, "Create Quick Session"), lib,
      el("button", { class: "qa-back", onclick: home }, "‹ Programs and sent sessions"),
      el("label", { class: "qa-date" }, "Date", date),
      title,
      el("div", { class: "qa-label" }, "Exercises"),
      list,
      nextBlock,
      el("div", { class: "qa-sub" }, "Add to my day puts it on your plan and opens it, ready to log. Share sends it to one athlete or more. Either way it logs to the Training Log like any session."),
      msg,
      el("div", { class: "swap-actions qa-build-actions" }, ctx.me ? addMine : null, share, discard));
  }

  async function loadMine(box) {
    try {
      const rows = await readAll("periodization", "athlete_id, startDate:data->>startDate, blocks:data->blocks");
      const name = (id) => (ctx.people.find((p) => String(p.id) === String(id)) || {}).name || "Unknown athlete";
      const personOf = (id) => ctx.people.find((p) => String(p.id) === String(id)) || { id, name: name(id) };
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
      fill(box, ...(drops.length ? drops.map((d) => el("div", { class: "qa-drop" },
        el("div", { class: "qa-drop-text" },
          d.oneOff ? el("b", null, el("span", { class: "qa-tag" }, "Quick session"), d.oneOff.s.name) : el("b", null, d.b.label || "Program"),
          el("small", null, `${lastFirst(name(d.athleteId))} · ${d.oneOff ? day(d.oneOff.s.date) : blockDates(d.startDate, d.b)}`)),
        // a program can be moved or swapped (manage); a quick session is only taken off
        d.oneOff ? null : el("button", { class: "qa-change", onclick: () => manage(personOf(d.athleteId), d.b.id) }, "Change"),
        el("button", { class: "qa-remove", onclick: remove(d) }, "Remove"))) :[el("div", { class: "qa-empty" }, "None yet. Programs and sessions you send from here are listed so you can take them off again.")]));
    } catch (e) { fill(box, el("div", { class: "qa-empty" }, errorText(e))); }
  }

  // the program, from the library. With nothing typed it's laid out by folder: each top folder (Strength ...) with
  // its own programs listed under it, and each of its subfolders (Strength › Pen & Paper Strength Programs) a row
  // that opens to show its programs. Typing searches every folder (name, folder and tags). Each program shows its tags.
  const openFolders = new Set();
  function pickProgram(person) {
    const results = el("div", { class: "qa-list" });
    const search = el("input", { type: "search", placeholder: "Search programs or tags", "aria-label": "Search programs", autocomplete: "off" });
    const tagsOf = (p) => (Array.isArray(p.tags) ? p.tags : []).filter(Boolean);
    const row = (p, where) => el("button", { class: "qa-row qa-prog", onclick: () => preview(person, p.id) },
      p.name,
      where ? el("small", null, where) : null,
      tagsOf(p).length ? el("span", { class: "qa-tags" }, tagsOf(p).map((t) => el("span", { class: "qa-tagchip" }, t))) : null);
    const show = () => {
      const q = search.value.trim().toLowerCase();
      if (q) {
        const hits = ctx.programs.filter((p) => `${p.name} ${p.folder || ""} ${tagsOf(p).join(" ")}`.toLowerCase().includes(q)).slice(0, 40);
        fill(results, ...hits.map((p) => row(p, p.folder ? p.folder.replace(/\//g, " › ") : "")),
          !hits.length ? el("div", { class: "qa-empty" }, "No program matches that.") : null);
        return;
      }
      const tops = new Map(); // top folder -> { own: programs, subs: Map(subfolder path -> programs) }
      ctx.programs.forEach((p) => {
        const parts = (p.folder || "").split("/").map((x) => x.trim()).filter(Boolean);
        const top = parts[0] || "";
        if (!tops.has(top)) tops.set(top, { own: [], subs: new Map() });
        const t = tops.get(top);
        if (parts.length < 2) t.own.push(p);
        else { const sub = parts.slice(1).join(" › "); if (!t.subs.has(sub)) t.subs.set(sub, []); t.subs.get(sub).push(p); }
      });
      const names = [...tops.keys()].sort((a, b) => (a ? (b ? a.localeCompare(b) : -1) : 1)); // programs with no folder last
      fill(results, ...names.map((top) => {
        const t = tops.get(top);
        return el("div", { class: "qa-folder" },
          el("div", { class: "qa-label" }, top || "Other programs"),
          t.own.map((p) => row(p)),
          [...t.subs.keys()].sort((a, b) => a.localeCompare(b)).map((sub) => {
            const key = `${top}/${sub}`, open = openFolders.has(key), list = t.subs.get(sub);
            return el("div", { class: "qa-sub-folder" },
              el("button", { class: `qa-folder-row${open ? " open" : ""}`, onclick: () => { if (open) openFolders.delete(key); else openFolders.add(key); show(); } },
                el("span", { class: "qa-folder-caret", "aria-hidden": "true" }, open ? "▾" : "▸"), el("span", null, sub), el("small", null, `${list.length}`)),
              open ? el("div", { class: "qa-folder-items" }, list.map((p) => row(p))) : null);
          }));
      }), !ctx.programs.length ? el("div", { class: "qa-empty" }, "No programs in the library yet.") : null);
    };
    search.addEventListener("input", show);
    const rep = replacingFor(person);
    sheet(el("h2", null, `A program for ${person === ctx.me ? "you" : firstName(person.name)}`),
      el("button", { class: "qa-back", onclick: home }, "‹ Back"),
      rep ? el("div", { class: "qa-sub" }, `Replacing ${rep.label}. It comes off once the new one is assigned. Pick the same program to just change its start week.`) : null,
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
      // assigning first asks whether to individualize it for them (individualizeAsk, below)
      const go = el("button", { class: "primary", onclick: () => individualizeAsk(person, program, startDate, draw) }, `Assign to ${who}`);
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

  // ---- individualizing a program before it's assigned --------------------------------------------------
  // After the preview, Assign asks whether to individualize the program for this person. No assigns it as it is.
  // Yes lists every exercise in it, day by day; the coach highlights the ones to change, then for each one can
  // change the exercise and, week by week, keep the sets, reps and % or change them. It's saved the way the
  // dashboard's Individualize saves it (index.html ProgramIndividualize): a new program "<Last name> - <Program>"
  // tied to the athlete (athleteId, basedOn), with its own exercise ids, which the dashboard files into their
  // athlete folder; that copy goes on their plan. The library program isn't changed.
  const lastNameOf = (name) => { const p = (name || "").trim().split(/\s+/).filter((x) => !/^(jr\.?|sr\.?|ii|iii|iv)$/i.test(x)); return p[p.length - 1] || (name || "").trim(); };
  const groupsText = (e) => Rx.text(e) || "—";
  async function doAssign(person, program, startDate, msg, button) {
    button.disabled = true;
    msg.textContent = "Assigning…";
    try {
      const rep = replacingFor(person);
      // replacing a program with the same one is just a new start date
      if (rep && rep.programId === program.id) {
        const m = await moveBlock(person.id, rep.blockId, startDate);
        if (m === "out-of-range") { msg.textContent = "That week is past the end of the plan."; button.disabled = false; return; }
        ctx.replacing = null;
        assigned(person, program.name, startDate, rep.blockId, "moved");
        return;
      }
      const r = await assign(person, program, startDate, ctx.user.email);
      if (r === "already") {
        // say when it starts, and offer to change it (another week, a different program, or off)
        const blockId = lastBlockId, mine = person === ctx.me;
        if (mine) selfChanged = true; // the app may be showing an older copy of the plan: closing reloads it
        fill(msg, `${mine ? "You already have" : `${person.name} already has`} ${program.name} on ${mine ? "your" : "their"} plan, starting ${day(lastBlockStart)}. `,
          el("button", { class: "qa-change", onclick: () => manage(person, blockId) }, "Change it"));
        button.disabled = false;
        return;
      }
      if (r === "out-of-range") { msg.textContent = "That week is past the end of the plan. Assign it from the dashboard."; button.disabled = false; return; }
      await assigned(person, program.name, startDate, lastBlockId);
    } catch (e) { msg.textContent = errorText(e); button.disabled = false; }
  }

  // ---- after assigning: undo, change, or done ------------------------------------------------------------
  // Assigning ends on a screen saying what went on whose plan, with Undo (takes it straight back off), Change
  // (another start week or a different program) and Done. When it was replacing another program, that one comes
  // off now, once the new one is safely on.
  const replacingFor = (person) => (ctx.replacing && String(ctx.replacing.personId) === String(person.id) ? ctx.replacing : null);
  async function assigned(person, name, startDate, blockId, how) {
    const rep = replacingFor(person);
    ctx.replacing = null;
    let note2 = "";
    if (rep && rep.blockId !== blockId) {
      try { await removeBlock(person.id, rep.blockId); note2 = `${rep.label} came off the plan.`; }
      catch (e) { note2 = `${rep.label} couldn't be taken off (${errorText(e)}). Remove it from the list of programs you've sent.`; }
    }
    const mine = person === ctx.me;
    if (mine) selfChanged = true; // closing the sheet any way (×, a tap outside) reloads the app so it shows
    const done = () => { if (mine && ctx.onAssignedSelf) ctx.onAssignedSelf(); else home(); }; // a coach's own app reloads to show it
    const msg = el("div", { class: "swap-note" });
    const undo = el("button", { onclick: async () => {
      undo.disabled = true;
      msg.textContent = "Taking it off…";
      try {
        await removeBlock(person.id, blockId);
        ctx.status(`Undone: ${name} is off ${mine ? "your" : `${person.name}'s`} plan`);
        // straight back to choosing, for another program or another week
        pickProgram(person);
      } catch (e) { msg.textContent = errorText(e); undo.disabled = false; }
    } }, "Undo");
    ctx.status(how === "moved" ? `Moved: ${name}, from ${day(startDate)}` : `Assigned: ${name}, from ${day(startDate)}`);
    sheet(el("h2", null, how === "moved" ? "Moved" : "Assigned"),
      el("div", { class: "qa-done" },
        el("b", null, name),
        el("small", null, `On ${mine ? "your" : `${person.name}'s`} plan from ${day(startDate)}.`)),
      note2 ? el("div", { class: "qa-sub" }, note2) : null,
      el("div", { class: "qa-sub" }, "Wrong one, or the wrong week? Undo takes it straight back off; Change picks another start week or swaps it for a different program."),
      msg,
      el("div", { class: "swap-actions qa-build-actions" },
        el("button", { class: "primary", onclick: done }, "Done"),
        el("button", { onclick: () => manage(person, blockId, () => assigned(person, name, startDate, blockId, how)) }, "Change"),
        undo));
  }

  // ---- changing or taking back an assigned program --------------------------------------------------------
  // From the Assigned screen, the list of programs this coach has sent, or the Change button on a program in a
  // coach's own app: start it another week, swap it for a different program, or take it off. Swapping picks the
  // new program the usual way and takes the old one off only once the new one is assigned, so backing out leaves
  // the plan as it was. Anything already logged in it stays on file.
  async function manage(person, blockId, back) {
    back = back || home;
    sheet(el("h2", null, "Change program"), note("Loading…"));
    let plan;
    try {
      const { data, error } = await sb.from("periodization").select("data").eq("athlete_id", String(person.id)).maybeSingle();
      if (error) throw error;
      plan = data && data.data;
    } catch (e) { sheet(el("h2", null, "Change program"), el("button", { class: "qa-back", onclick: back }, "‹ Back"), note(errorText(e))); return; }
    const b = plan && (plan.blocks || []).find((x) => x.id === blockId);
    if (!b) { sheet(el("h2", null, "Change program"), el("button", { class: "qa-back", onclick: back }, "‹ Back"), note("That program isn't on the plan anymore.")); return; }
    const mine = person === ctx.me;
    const label = b.label || "this program";
    const current = addDays(plan.startDate, b.start * 7);
    const monday = (iso) => { const d = parseISO(iso); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return toISO(d); };
    let pick = current;
    const msg = el("div", { class: "swap-note" });
    const draw = () => {
      const chip = (iso, text) => el("button", { class: `chip${pick === iso ? " on" : ""}`, onclick: () => { pick = iso; draw(); } }, text);
      const date = el("input", { type: "date", value: pick, "aria-label": "Start week" });
      date.addEventListener("change", () => { if (date.value) { pick = monday(date.value); draw(); } });
      const move = el("button", { class: "primary", disabled: pick === current, onclick: async () => {
        move.disabled = true;
        msg.textContent = "Moving…";
        try {
          const r = await moveBlock(person.id, blockId, pick);
          if (r === "gone") { msg.textContent = "That program isn't on the plan anymore."; return; }
          if (r === "out-of-range") { msg.textContent = "That week is past the end of the plan."; move.disabled = false; return; }
          assigned(person, label, pick, blockId, "moved");
        } catch (e) { msg.textContent = errorText(e); move.disabled = false; }
      } }, pick === current ? "Pick another week" : `Start it ${day(pick)}`);
      const remove = el("button", { class: "qa-remove", onclick: async () => {
        if (!window.confirm(`Take ${label} off ${mine ? "your" : `${person.name}'s`} plan? Anything logged in it stays on file.`)) return;
        remove.disabled = true;
        msg.textContent = "Taking it off…";
        try {
          await removeBlock(person.id, blockId);
          ctx.status(`Removed: ${label}`);
          if (mine && ctx.onAssignedSelf) { ctx.onAssignedSelf(); return; }
          home();
        } catch (e) { msg.textContent = errorText(e); remove.disabled = false; }
      } }, "Remove it");
      sheet(el("h2", null, "Change program"),
        el("button", { class: "qa-back", onclick: back }, "‹ Back"),
        el("div", { class: "qa-done" }, el("b", null, label), el("small", null, `${mine ? "Your" : `${person.name}'s`} plan · ${blockDates(plan.startDate, b)}`)),
        el("div", { class: "qa-label" }, "Start it another week"),
        el("div", { class: "chips qa-starts" },
          chip(current, `Now · ${day(current)}`),
          [["This week", mondayIn(0)], ["Next week", mondayIn(1)], ["In 2 weeks", mondayIn(2)]].filter(([, iso]) => iso !== current).map(([t, iso]) => chip(iso, `${t} · ${day(iso)}`))),
        el("label", { class: "qa-date" }, "Or the week of", date),
        el("div", { class: "swap-actions" }, move),
        el("div", { class: "qa-label" }, "Or"),
        el("button", { class: "qa-row", onclick: () => { ctx.replacing = { personId: person.id, blockId, programId: b.programId, label }; pickProgram(person); } },
          "Choose a different program", el("small", null, `${label} comes off once the new one is assigned`)),
        msg,
        el("div", { class: "swap-actions" }, remove));
    };
    draw();
  }
  function individualizeAsk(person, program, startDate, back) {
    const msg = el("div", { class: "swap-note" });
    const who = person === ctx.me ? "you" : firstName(person.name);
    const no = el("button", { onclick: () => doAssign(person, program, startDate, msg, no) }, "No, assign as is");
    sheet(el("h2", null, `Individualize it for ${who}?`),
      el("button", { class: "qa-back", onclick: back }, "‹ Back to the preview"),
      el("div", { class: "qa-sub" }, `Change exercises, or sets and reps week by week, before ${program.name} goes on ${person === ctx.me ? "your" : `${person.name}'s`} plan from ${day(startDate)}. ${person === ctx.me ? "You get your" : "They get their"} own copy; the program in the library isn't changed.`),
      msg,
      el("div", { class: "swap-actions qa-build-actions" }, el("button", { class: "primary", onclick: () => individualizePick(person, program, startDate, back, new Set()) }, "Yes, individualize"), no));
  }
  // every exercise spot in the program, once, in the order it first appears: an exercise is the same one from week
  // to week when it has the same name on the same day in the same place (A1, B2 ...), as the dashboard counts them
  function spotsOf(weeks) {
    const spots = [];
    weeks.forEach((w, wi) => (w.sessions || []).forEach((s, si) => {
      const labels = window.exerciseLabels ? window.exerciseLabels(s.exercises || []) : [];
      (s.exercises || []).forEach((e, ei) => {
        const name = (e.name || "").trim();
        if (!name) return;
        const label = (labels[ei] || "").replace(/\.$/, "");
        const key = `${si}|${label}|${name.toLowerCase()}`;
        let spot = spots.find((x) => x.key === key);
        if (!spot) { spot = { key, si, label, name, day: (s.name || "").trim() || `Day ${si + 1}`, at: [] }; spots.push(spot); }
        spot.at.push({ wi, ei });
      });
    }));
    return spots;
  }
  const normalWeeks = (program) => (program.weeks || []).map((w) => ({ ...w, sessions: (w.sessions || []).map((s) => ({ ...s, exercises: (s.exercises || []).map((e) => Rx.normalize(e)) })) }));
  function individualizePick(person, program, startDate, back, picked) {
    const weeks = normalWeeks(program);
    const spots = spotsOf(weeks);
    const next = el("button", { class: "primary" });
    const count = () => { next.disabled = !picked.size; next.textContent = picked.size ? `Next: ${picked.size} to change` : "Highlight what needs changing"; };
    const days = [];
    spots.forEach((sp) => { let g = days.find((d) => d.si === sp.si); if (!g) { g = { si: sp.si, day: sp.day, spots: [] }; days.push(g); } g.spots.push(sp); });
    next.addEventListener("click", () => individualizeEdit(person, program, startDate, back, weeks, spots.filter((sp) => picked.has(sp.key))));
    count();
    sheet(el("h2", null, "What needs changing?"),
      el("button", { class: "qa-back", onclick: () => individualizeAsk(person, program, startDate, back) }, "‹ Back"),
      el("div", { class: "qa-sub" }, "Tap every exercise that needs changing for them: the exercise itself, or its sets and reps. The rest stays as written."),
      days.map((g) => el("div", { class: "qa-day" },
        el("div", { class: "qa-day-name" }, g.day),
        g.spots.map((sp) => {
          const b = el("button", { class: `qa-spot${picked.has(sp.key) ? " on" : ""}`, onclick: () => {
            if (picked.has(sp.key)) picked.delete(sp.key); else picked.add(sp.key);
            b.classList.toggle("on", picked.has(sp.key));
            count();
          } }, el("span", { class: "qa-ex-label" }, sp.label ? `${sp.label}.` : ""), el("span", { class: "qa-spot-name" }, sp.name), el("span", { class: "qa-spot-check", "aria-hidden": "true" }, "✓"));
          return b;
        }))),
      el("div", { class: "swap-actions" }, next, el("button", { onclick: () => individualizeAsk(person, program, startDate, back) }, "Back")));
  }
  function individualizeEdit(person, program, startDate, back, weeks, spots) {
    const lib = el("datalist", { id: "qa-indiv-library" }, (libraryNames || []).map((n) => el("option", { value: n })));
    if (!libraryNames) {
      readAll("exercises", "id, name:data->>name").then((rows) => {
        libraryNames = [...new Set(rows.map((r) => (r.name || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
        fill(lib, ...libraryNames.map((n) => el("option", { value: n })));
      }).catch(() => {});
    }
    // per spot: a replacement name, and per week the sets/reps being changed to (no entry = kept as written)
    const edits = new Map(spots.map((sp) => [sp.key, { name: "", weeks: new Map() }]));
    const msg = el("div", { class: "swap-note" });
    const input = (g, key, attrs) => { const i = el("input", { value: g[key] || "", autocomplete: "off", ...attrs }); i.addEventListener("input", () => { g[key] = i.value; }); return i; };
    const weekRow = (sp, wi, ei) => {
      const e = weeks[wi].sessions[sp.si].exercises[ei];
      const ed = edits.get(sp.key);
      const box = el("div", { class: "qa-week" });
      const weekName = weeks[wi].name || `Week ${wi + 1}`;
      const draw = () => {
        const now = ed.weeks.get(wi);
        if (!now) {
          fill(box, el("span", { class: "qa-week-name" }, weekName), el("span", { class: "qa-week-rx" }, groupsText(e)),
            el("button", { class: "qa-week-btn", type: "button", onclick: () => { ed.weeks.set(wi, JSON.parse(JSON.stringify(e.groups && e.groups.length ? e.groups : [{ sets: "", reps: "", intensity: "" }]))); draw(); } }, "Change"));
          return;
        }
        const unit = Rx.normalize(e).intensityUnit;
        fill(box, 
          el("div", { class: "qa-week-head" }, el("span", { class: "qa-week-name" }, weekName), el("small", null, `was ${groupsText(e)}`),
            el("button", { class: "qa-week-btn", type: "button", onclick: () => { ed.weeks.delete(wi); draw(); } }, "Keep as written")),
          ...now.map((g, gi) => el("div", { class: "qa-build-rx" },
            el("label", null, "Sets", input(g, "sets", { inputmode: "numeric", "aria-label": "Sets" })),
            el("label", null, "Reps", input(g, "reps", { "aria-label": "Reps" })),
            unit ? el("label", null, unit, input(g, "intensity", { inputmode: "decimal", "aria-label": unit })) : null,
            now.length > 1 ? el("button", { class: "qa-build-x", type: "button", "aria-label": "Remove this set", onclick: () => { now.splice(gi, 1); draw(); } }, "×") : null)),
          el("button", { class: "qa-add-in", type: "button", onclick: () => { now.push({ sets: "", reps: "", intensity: "" }); draw(); } }, "+ Add a set"));
      };
      draw();
      return box;
    };
    const backToPick = () => individualizePick(person, program, startDate, back, new Set(spots.map((sp) => sp.key)));
    const assignIt = el("button", { class: "primary", onclick: async () => {
      // the athlete's copy: the program with the changes made, every exercise with a new id
      const out = JSON.parse(JSON.stringify(weeks));
      out.forEach((w, wi) => (w.sessions || []).forEach((s, si) => (s.exercises || []).forEach((e, ei) => {
        e.id = `ex-${uid()}`;
        const sp = spots.find((x) => x.si === si && x.at.some((a) => a.wi === wi && a.ei === ei));
        if (!sp) return;
        const ed = edits.get(sp.key);
        if (ed.name.trim()) e.name = ed.name.trim().replace(/\s+/g, " ");
        const groups = ed.weeks.get(wi);
        if (groups) e.groups = groups.filter((g) => `${g.sets || ""}${g.reps || ""}`.trim());
      })));
      assignIt.disabled = true;
      msg.textContent = "Saving…";
      try {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        const own = { name: `${lastNameOf(person.name)} - ${program.name}`, description: program.description || "", weeks: out, folder: program.folder || "", basedOn: program.id, athleteId: /^\d+$/.test(String(person.id)) ? Number(person.id) : person.id, nextProgramIds: program.nextProgramIds || [], createdBy: ctx.user.email, createdAt: new Date().toISOString() };
        const saved = await sb.from("programs").upsert({ id, data: own });
        if (saved.error) throw saved.error;
        // on their plan as the shared one would have been, its block named without their last name in front
        const r = await assign(person, { ...own, id, name: program.name }, startDate, ctx.user.email);
        if (r === "out-of-range") { msg.textContent = "That week is past the end of the plan."; assignIt.disabled = false; return; }
        await assigned(person, own.name, startDate, lastBlockId);
      } catch (e) { msg.textContent = errorText(e); assignIt.disabled = false; }
    } }, `Assign to ${person === ctx.me ? "me" : firstName(person.name)}`);
    sheet(el("h2", null, "Individualize"), lib,
      el("button", { class: "qa-back", onclick: backToPick }, "‹ Back to the exercise list"),
      el("div", { class: "qa-sub" }, `Saves as "${lastNameOf(person.name)} - ${program.name}". Each week keeps its sets and reps unless you change them.`),
      spots.map((sp) => {
        const ed = edits.get(sp.key);
        const name = el("input", { placeholder: `Keep ${sp.name}, or type a replacement`, list: "qa-indiv-library", autocomplete: "off", "aria-label": `Replacement for ${sp.name}`, class: "qa-indiv-name" });
        name.addEventListener("input", () => { ed.name = name.value; });
        return el("div", { class: "qa-block" },
          el("div", { class: "qa-indiv-head" }, el("span", { class: "qa-ex-label" }, sp.label ? `${sp.label}.` : ""), el("b", null, sp.name), el("small", null, sp.day)),
          name,
          sp.at.map(({ wi, ei }) => weekRow(sp, wi, ei)));
      }),
      msg,
      el("div", { class: "swap-actions" }, assignIt, el("button", { onclick: backToPick }, "Back")));
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

  window.QuickAssign = { open, takeChange: () => { const c = selfChanged; selfChanged = false; return c; } };
})();
