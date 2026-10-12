// Coach Mode — several athletes' programs side by side, for a coach running a session from a tablet, a phone
// or a browser. The coach signs in with their dashboard account, adds whichever athletes they want (anyone on
// any roster), and taps between them. Each athlete's program is the same page the athlete sees on their own
// phone link (athlete.html), shown in a frame in "coach" mode: it reads and writes under the coach's login, so
// weights, reps and sessions logged here are recorded as entered by a coach. No link or token is involved.
//
// Which athletes are on the board is remembered on this device only (per signed-in coach).
(function () {
  const sb = window.supabaseClient;
  const $ = (id) => document.getElementById(id);
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

  let user = null;
  let athletes = []; // everyone, as { id, name, sub, cubs }
  let picked = []; // ids on the board, in the order they were added
  let active = null; // id being shown
  const frames = new Map(); // id -> the athlete's page, kept alive while they are on the board

  const storeKey = () => `coachBoard:${user.id}`;
  const remember = () => { try { localStorage.setItem(storeKey(), JSON.stringify({ picked, active })); } catch (e) { /* private window: the board just won't be remembered */ } };
  const recall = () => { try { return JSON.parse(localStorage.getItem(storeKey()) || "null") || {}; } catch (e) { return {}; } };
  const byId = (id) => athletes.find((a) => a.id === id);
  const lastFirst = (name) => { const p = (name || "").trim().split(/\s+/); return p.length > 1 ? `${p[p.length - 1]}, ${p.slice(0, -1).join(" ")}` : name || ""; };

  // ---- the athlete list and the picked athlete's page ----------------------------------------------
  function show(id) {
    active = id;
    closeKpi(); closeSpeed();
    const stage = $("stage");
    if (!id) { stage.replaceChildren(el("div", { class: "empty" }, picked.length ? "Pick an athlete." : "Add an athlete to see their program.")); frames.forEach((f) => f.remove()); frames.clear(); draw(); remember(); return; }
    stage.querySelectorAll(".empty").forEach((n) => n.remove());
    if (!frames.has(id)) {
      const a = byId(id);
      const frame = el("iframe", { src: `athlete.html?coach=1&aid=${encodeURIComponent(id)}${a && a.cubs ? "&team=cubs" : ""}`, title: a ? a.name : "Athlete" });
      frames.set(id, frame);
      stage.append(frame);
    }
    frames.forEach((f, fid) => { f.hidden = fid !== id; });
    draw();
    remember();
  }
  function add(id) {
    if (!picked.includes(id)) picked.push(id);
    loadDone();
    $("search").value = "";
    $("results").hidden = true;
    if (kpiOpen) { if (!active) active = id; remember(); openKpi(); return; } // adding while on the KPI sheet adds a row to it
    if (speedOpen) { if (!active) active = id; remember(); openSpeed(); return; } // adding while on the speed session adds them to its list
    show(id);
  }
  function remove(id) {
    picked = picked.filter((x) => x !== id);
    const f = frames.get(id);
    if (f) { f.remove(); frames.delete(id); }
    delete kpiSheet[id];
    const next = active === id ? (picked[picked.length - 1] || null) : active;
    if (kpiOpen) { active = next; remember(); openKpi(); return; }
    if (speedOpen) { active = next; remember(); openSpeed(); return; }
    show(next);
  }
  function draw() {
    const list = $("list");
    $("kpi-btn").classList.toggle("on", kpiOpen);
    $("speed-btn").classList.toggle("on", speedOpen);
    if (!picked.length) { list.replaceChildren(el("div", { class: "list-hint" }, "No athletes yet. Search above to add one.")); return; }
    list.replaceChildren(...picked.map((id) => {
      const a = byId(id) || { name: "Unknown athlete", sub: "" };
      const done = doneToday.has(id);
      return el("div", { class: `who${id === active && !kpiOpen && !speedOpen ? " on" : ""}${done ? " done" : ""}`, title: done ? "Finished a workout today" : null },
        el("button", { class: "who-pick", onclick: () => show(id), "aria-pressed": id === active ? "true" : "false" }, el("span", null, done ? "✓ " : "", a.name), el("small", null, done ? `Done today${a.sub ? ` · ${a.sub}` : ""}` : a.sub)),
        el("button", { class: "who-x", title: `Take ${a.name} off the board`, "aria-label": `Take ${a.name} off the board`, onclick: () => remove(id) }, "×"));
    }));
  }

  // ---- who has finished today ------------------------------------------------------------------------
  // An athlete is marked done once a session of theirs has been logged today (the Log session button, here or
  // on their own phone). Checked when the board changes, when a session is logged in the frame, when the page
  // comes back into view, and every half minute.
  let doneToday = new Set();
  async function loadDone() {
    if (!user || !picked.length) { doneToday = new Set(); draw(); return; }
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const { data, error } = await sb.from("athlete_logs").select("athlete_id").in("athlete_id", picked).like("key", "session-%").eq("value", "done").gte("updated_at", start.toISOString()).limit(2000);
    if (error || !data) return; // keep what is showing
    doneToday = new Set(data.map((r) => String(r.athlete_id)));
    draw();
  }
  window.addEventListener("message", (e) => { if (e.origin === window.location.origin && e.data === "coach-session-changed") loadDone(); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) loadDone(); });
  setInterval(() => { if (!document.hidden) loadDone(); }, 30000);

  // ---- KPI sheet: results for something the group did that is not in anyone's program ------------------
  // A sheet with the athletes on the board down the side and trials across: pick the KPI (or make a new one)
  // and the day, type each athlete's trials, and Save. Each athlete gets one entry per KPI per day holding the
  // trials with their best and average, so saving the same day again updates it. Beside the trials the sheet
  // shows that session's best and average, and the athlete's PR and average from every earlier session.
  // KPIs to pick from are shared by all coaches (app_meta "kpiDefs"); results are in kpi_entries and show on
  // the athlete's Training Log in the dashboard.
  const KPI_STARTERS = [
    { id: "10-yard-start", name: "10-Yard Start", unit: "sec", better: "lower" },
    { id: "30-yard-sprint", name: "30-Yard Sprint", unit: "sec", better: "lower" },
    { id: "60-yard-sprint", name: "60-Yard Sprint", unit: "sec", better: "lower" },
    { id: "vertical-jump", name: "Vertical Jump", unit: "in", better: "higher" },
    { id: "broad-jump", name: "Broad Jump", unit: "in", better: "higher" },
  ];
  const localDay = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const round2 = (v) => Math.round(v * 100) / 100;
  const mean = (list) => list.reduce((s, v) => s + v, 0) / list.length;
  const numbersIn = (list) => (list || []).map((v) => parseFloat(String(v).trim())).filter((v) => Number.isFinite(v));
  const trialsOf = (entry) => (Array.isArray(entry.trials) && entry.trials.length ? entry.trials : [entry.value]).filter((v) => Number.isFinite(v));

  let kpiOpen = false;
  let kpiEl = null;
  let kpiDefs = [];
  let kpiId = null;
  let kpiDate = localDay();
  let kpiTrials = 3; // trial columns showing
  let kpiHistory = []; // every saved entry for the athletes on the board, as { athleteId, ...data }
  let kpiSheet = {}; // athlete id -> what is typed in each trial box
  let kpiNew = false; // the "new KPI" form is open

  async function loadKpiDefs() {
    const { data, error } = await sb.from("app_meta").select("value").eq("key", "kpiDefs").maybeSingle();
    if (error) throw error;
    kpiDefs = data && Array.isArray(data.value) && data.value.length ? data.value : KPI_STARTERS.slice();
    kpiDefs.sort((a, b) => a.name.localeCompare(b.name));
  }
  async function loadKpiHistory() {
    if (!picked.length) { kpiHistory = []; return; }
    const { data, error } = await sb.from("kpi_entries").select("id,athlete_id,data").in("athlete_id", picked).limit(10000);
    if (error) throw error;
    kpiHistory = data.map((r) => ({ ...r.data, id: r.id, athleteId: String(r.athlete_id) }));
  }
  const kpiSaved = (aid) => kpiHistory.find((e) => e.athleteId === aid && e.kpiId === kpiId && e.date === kpiDate);
  // fills each athlete's row from what is already saved for this KPI and day; `reset` throws away what is typed
  function fillKpiSheet(reset) {
    if (reset) { kpiSheet = {}; kpiTrials = 3; }
    picked.forEach((aid) => {
      if (kpiSheet[aid]) return;
      const saved = kpiSaved(aid);
      kpiSheet[aid] = saved ? trialsOf(saved).map(String) : [];
      kpiTrials = Math.max(kpiTrials, kpiSheet[aid].length);
    });
  }
  function kpiStats(aid, def) {
    const pick = def.better === "lower" ? Math.min : Math.max;
    const now = numbersIn(kpiSheet[aid]);
    const past = kpiHistory.filter((e) => e.athleteId === aid && e.kpiId === def.id && e.date !== kpiDate);
    const pastTrials = past.flatMap(trialsOf);
    const best = now.length ? pick(...now) : null, pr = pastTrials.length ? pick(...pastTrials) : null;
    return {
      now, best, avg: now.length ? round2(mean(now)) : null,
      pr, pastAvg: pastTrials.length ? round2(mean(pastTrials)) : null, sessions: past.length,
      newPr: best != null && pr != null && (def.better === "lower" ? best < pr : best > pr),
    };
  }

  async function openKpi() {
    kpiOpen = true; closeSpeed();
    const stage = $("stage");
    stage.querySelectorAll(".empty").forEach((n) => n.remove());
    frames.forEach((f) => { f.hidden = true; });
    if (!kpiEl) kpiEl = el("div", { class: "kpi" });
    if (!kpiEl.isConnected) stage.append(kpiEl);
    draw();
    if (!kpiEl.firstChild) kpiEl.replaceChildren(el("div", { class: "kpi-note" }, "Loading…"));
    try {
      if (!kpiDefs.length) await loadKpiDefs();
      await loadKpiHistory();
    } catch (e) {
      kpiEl.replaceChildren(el("div", { class: "kpi-note" }, "Could not load KPIs. Check your connection and try again."));
      return;
    }
    if (!kpiOpen) return;
    fillKpiSheet(false);
    drawKpi();
  }
  function closeKpi() {
    kpiOpen = false;
    if (kpiEl) kpiEl.remove();
  }

  function drawKpi(status) {
    const def = kpiDefs.find((k) => k.id === kpiId) || kpiDefs[0];
    kpiId = def.id;
    const change = (fn) => { fn(); fillKpiSheet(true); drawKpi(); };
    const select = el("select", { "aria-label": "KPI", onchange: (e) => change(() => { kpiId = e.target.value; }) },
      kpiDefs.map((k) => el("option", { value: k.id, selected: k.id === kpiId }, `${k.name}${k.unit ? ` (${k.unit})` : ""}`)));
    const date = el("input", { type: "date", value: kpiDate, max: localDay(), "aria-label": "Date", onchange: (e) => change(() => { kpiDate = e.target.value || localDay(); }) });
    const head = el("div", { class: "kpi-head" },
      el("label", null, "KPI", select),
      el("label", null, "Date", date),
      el("button", { class: "kpi-ghost", onclick: () => { kpiNew = !kpiNew; drawKpi(); } }, kpiNew ? "Cancel" : "+ New KPI"));

    let form = null;
    if (kpiNew) {
      const name = el("input", { type: "text", placeholder: "e.g. 5-10-5 Shuttle", maxlength: "60" });
      const unit = el("input", { type: "text", placeholder: "sec, in, mph…", maxlength: "12" });
      const better = el("select", null, el("option", { value: "lower" }, "Lower is better (times)"), el("option", { value: "higher" }, "Higher is better (heights, speeds)"));
      const err = el("span", { class: "kpi-err", role: "alert" });
      form = el("form", { class: "kpi-new", onsubmit: async (e) => {
        e.preventDefault();
        const n = name.value.trim();
        if (!n) { err.textContent = "Give the KPI a name."; return; }
        try {
          await loadKpiDefs(); // someone else may have added one since this page loaded
          const same = kpiDefs.find((k) => k.name.toLowerCase() === n.toLowerCase());
          if (same) kpiId = same.id;
          else {
            const made = { id: `${n.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${Date.now().toString(36)}`, name: n, unit: unit.value.trim(), better: better.value };
            kpiDefs.push(made);
            kpiDefs.sort((a, b) => a.name.localeCompare(b.name));
            const { error } = await sb.from("app_meta").upsert({ key: "kpiDefs", value: kpiDefs });
            if (error) throw error;
            kpiId = made.id;
          }
        } catch (ex) { err.textContent = "Could not save the KPI. Try again."; return; }
        kpiNew = false;
        fillKpiSheet(true);
        drawKpi();
      } },
        el("label", null, "Name", name), el("label", null, "Unit", unit), el("label", null, "Best result", better),
        el("button", { type: "submit", class: "kpi-save" }, "Add KPI"), err);
    }

    if (!picked.length) { kpiEl.replaceChildren(...[head, form, el("div", { class: "kpi-note" }, "Add athletes to the board, then enter their results here.")].filter(Boolean)); return; }

    const show1 = (v) => (v == null ? "–" : `${v}`);
    const rows = picked.map((aid) => {
      const a = byId(aid) || { name: "Unknown athlete" };
      const best = el("td", { class: "kpi-num" }), avg = el("td", { class: "kpi-num" });
      const pr = el("td", { class: "kpi-num past" }), pastAvg = el("td", { class: "kpi-num past" });
      const fill = () => {
        const s = kpiStats(aid, def);
        best.replaceChildren(...[show1(s.best), s.newPr ? el("em", null, "PR") : null].filter(Boolean));
        avg.textContent = show1(s.avg);
        pr.textContent = show1(s.pr);
        pastAvg.replaceChildren(...[show1(s.pastAvg), s.sessions ? el("small", null, `${s.sessions} session${s.sessions === 1 ? "" : "s"}`) : null].filter(Boolean));
      };
      fill();
      const cells = Array.from({ length: kpiTrials }, (_, i) => el("td", null, el("input", {
        type: "text", inputmode: "decimal", autocomplete: "off", value: kpiSheet[aid][i] || "", "data-col": i, "aria-label": `${a.name} trial ${i + 1}`,
        oninput: (e) => { kpiSheet[aid][i] = e.target.value; fill(); },
        // Enter goes down the column, as in a spreadsheet
        onkeydown: (e) => { if (e.key !== "Enter") return; e.preventDefault(); const next = e.target.closest("tr").nextElementSibling; const box = next && next.querySelector(`input[data-col="${i}"]`); if (box) box.focus(); else e.target.blur(); },
      })));
      return el("tr", null, el("th", { scope: "row" }, a.name), cells, best, avg, pr, pastAvg);
    });
    const table = el("table", { class: "kpi-sheet" },
      el("thead", null, el("tr", null,
        el("th", null, "Athlete"),
        Array.from({ length: kpiTrials }, (_, i) => el("th", null, `Trial ${i + 1}`)),
        el("th", null, "Best"), el("th", null, "Avg"), el("th", { class: "past" }, "PR"), el("th", { class: "past" }, "Past avg"))),
      el("tbody", null, rows));

    const note = el("span", { class: "kpi-status", role: "status" }, status || "");
    const save = el("button", { class: "kpi-save", onclick: async () => {
      const by = user.email || "";
      const out = picked.map((aid) => ({ aid, s: kpiStats(aid, def) })).filter((r) => r.s.now.length).map(({ aid, s }) => ({
        id: `kpi|${aid}|${def.id}|${kpiDate}`, athlete_id: aid, updated_at: new Date().toISOString(),
        data: { kpiId: def.id, kpiName: def.name, unit: def.unit || "", better: def.better, date: kpiDate, trials: s.now, best: s.best, avg: s.avg, value: s.best, by, at: new Date().toISOString() },
      }));
      if (!out.length) { note.textContent = "Nothing to save yet: type at least one result."; return; }
      save.disabled = true;
      note.textContent = "Saving…";
      const { error } = await sb.from("kpi_entries").upsert(out);
      if (error) { save.disabled = false; note.textContent = "Could not save. Check your connection and try again."; return; }
      try { await loadKpiHistory(); } catch (e) { /* the sheet still shows what was typed */ }
      drawKpi(`Saved ${def.name} for ${out.length} athlete${out.length === 1 ? "" : "s"}.`);
    } }, "Save results");

    kpiEl.replaceChildren(...[head, form,
      el("div", { class: "kpi-scroll" }, table),
      el("div", { class: "kpi-foot" },
        el("button", { class: "kpi-ghost", onclick: () => { kpiTrials += 1; drawKpi(); } }, "+ Add trial"),
        kpiTrials > 1 ? el("button", { class: "kpi-ghost", onclick: () => { kpiTrials -= 1; picked.forEach((aid) => { kpiSheet[aid].length = Math.min(kpiSheet[aid].length, kpiTrials); }); drawKpi(); } }, "− Remove last trial") : null,
        save, note),
      el("p", { class: "kpi-hint" }, `Best and Avg are for this session${def.unit ? ` (${def.unit})` : ""}. PR and Past avg come from every earlier session. Rows left blank are not saved. Results show on each athlete’s Training Log.`),
    ].filter(Boolean));
  }

  // ---- Speed: a group's speed session for the day -----------------------------------------------------
  // A coach writes the day's speed session for a group (e.g. "DST North Pro Group"): a list of drills with what
  // to do for each. It is for leading the group, not for entering results (Group Testing does that), and it is
  // never shown in the athlete app. "Log for all" records the session as done for every athlete on the board,
  // and it lands on each one's Training Log beside their lift. Each athlete's entry is keyed by athlete and
  // session, so with several groups through in a day the coach swaps the athletes on the board and logs again:
  // anyone already logged is left alone and nobody is recorded twice.
  // Groups are shared by all coaches (app_meta "speedGroups"); sessions are in speed_sessions, one per group
  // per day; who did them is in speed_logs.
  let speedOpen = false;
  let speedEl = null;
  let speedGroups = null; // [{ id, name }], null until loaded
  let speedGroupId = null;
  let speedDate = localDay();
  let speedKey = ""; // the group and day the three below belong to
  let speedSession = null; // the saved session, or null when there is none for that group and day
  let speedDraft = null; // a copy being edited
  let speedLogged = new Set(); // athlete ids already logged for this session
  let speedRecent = []; // other sessions, newest first, to copy from
  let speedNewGroup = false; // the "new group" form is open
  const speedTicks = new Set(); // drills ticked off while leading (this device only, not saved)

  const speedId = () => `speed|${speedGroupId}|${speedDate}`;
  const speedGroupKey = () => `coachSpeedGroup:${user.id}`;
  const dayText = (d) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
  const copyItems = (items) => (items || []).map((it) => ({ name: it.name || "", detail: it.detail || "", notes: it.notes || "" }));

  async function loadSpeedGroups() {
    const { data, error } = await sb.from("app_meta").select("value").eq("key", "speedGroups").maybeSingle();
    if (error) throw error;
    speedGroups = (data && Array.isArray(data.value) ? data.value : []).slice().sort((a, b) => a.name.localeCompare(b.name));
  }
  async function loadSpeed() {
    if (!speedGroups.some((g) => g.id === speedGroupId)) {
      let last = null;
      try { last = localStorage.getItem(speedGroupKey()); } catch (e) { /* private window */ }
      speedGroupId = (speedGroups.find((g) => g.id === last) || speedGroups[0] || {}).id || null;
    }
    if (!speedGroupId) { speedSession = null; speedDraft = null; speedLogged = new Set(); speedRecent = []; speedKey = ""; return; }
    const id = speedId();
    const [one, logs, recent] = await Promise.all([
      sb.from("speed_sessions").select("id,data").eq("id", id).maybeSingle(),
      sb.from("speed_logs").select("athlete_id").eq("data->>sessionId", id).limit(2000),
      sb.from("speed_sessions").select("id,data").order("updated_at", { ascending: false }).limit(40),
    ]);
    const failed = one.error || logs.error || recent.error;
    if (failed) throw failed;
    if (speedKey !== id) { speedDraft = null; speedKey = id; } // a different group or day: drop what was being edited
    speedSession = one.data ? one.data.data : null;
    speedLogged = new Set(logs.data.map((r) => String(r.athlete_id)));
    speedRecent = recent.data.filter((r) => r.id !== id && r.data && (r.data.items || []).length).map((r) => r.data);
  }

  async function openSpeed() {
    speedOpen = true; closeKpi(); speedOpen = true;
    const stage = $("stage");
    stage.querySelectorAll(".empty").forEach((n) => n.remove());
    frames.forEach((f) => { f.hidden = true; });
    if (!speedEl) speedEl = el("div", { class: "kpi speed" });
    if (!speedEl.isConnected) stage.append(speedEl);
    draw();
    if (!speedEl.firstChild) speedEl.replaceChildren(el("div", { class: "kpi-note" }, "Loading…"));
    try {
      if (!speedGroups) await loadSpeedGroups();
      await loadSpeed();
    } catch (e) {
      speedEl.replaceChildren(el("div", { class: "kpi-note" }, "Could not load speed sessions. Check your connection and try again."));
      return;
    }
    if (speedOpen) drawSpeed();
  }
  function closeSpeed() {
    speedOpen = false;
    if (speedEl) speedEl.remove();
  }

  // ---- sending a session to one athlete's own app ----------------------------------------------------
  // For an athlete doing the group's session on their own (a remote athlete, say). Group sessions are not in
  // the athlete app, so this copies the session into the athlete's own plan, where the app does show it: a row
  // called "Group Speed" on their chart, with one small program per week holding each session sent for that
  // week as a day. Sending the same session again replaces that day instead of adding another.
  // Returns a sentence saying what happened.
  const SPEED_LANE = "Group Speed";
  const dayOf = (iso) => { const [y, m, d] = String(iso).split("-").map(Number); return new Date(y, m - 1, d); };
  const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const shortId = () => Math.random().toString(36).slice(2, 10);
  async function sendSpeed(aid, s) {
    const who = (byId(aid) || { name: "This athlete" }).name;
    const got = await sb.from("periodization").select("data").eq("athlete_id", aid).maybeSingle();
    if (got.error) throw got.error;
    const plan = got.data && got.data.data;
    if (!plan || !plan.startDate) return `${who} has no plan yet. Start their periodization in the dashboard first, then send again.`;
    const wk = Math.floor(Math.round((dayOf(s.date) - dayOf(plan.startDate)) / 864e5) / 7);
    if (wk < 0) return `${dayText(s.date)} is before ${who}'s plan starts, so it was not sent.`;
    if (wk >= 60) return `${dayText(s.date)} is past the end of ${who}'s plan, so it was not sent.`;
    const weekStart = dayOf(plan.startDate); weekStart.setDate(weekStart.getDate() + wk * 7);

    // the week's program for this athlete: made the first time, then added to
    const pid = `gspeed-${aid}-${isoOf(weekStart)}`;
    const have = await sb.from("programs").select("data").eq("id", pid).maybeSingle();
    if (have.error) throw have.error;
    const program = (have.data && have.data.data) || { name: `Group Speed · week of ${weekStart.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`, folder: SPEED_LANE, createdBy: user.email || "", createdAt: new Date().toISOString(), weeks: [{ name: "Week 1", sessions: [] }] };
    if (!Array.isArray(program.weeks) || !program.weeks.length) program.weeks = [{ name: "Week 1", sessions: [] }];
    const sessions = program.weeks[0].sessions = program.weeks[0].sessions || [];
    const day = {
      name: `${dayOf(s.date).toLocaleDateString(undefined, { weekday: "short", month: "numeric", day: "numeric" })}${s.title ? ` · ${s.title}` : ""}`,
      speedSessionId: speedId(),
      exercises: s.items.map((it) => ({ id: `ex-${shortId()}`, name: it.name, tempo: "", intensityUnit: "", groups: [{ sets: "", reps: it.detail || "", intensity: "" }], rest: "", notes: it.notes || "" })),
    };
    const at = sessions.findIndex((x) => x.speedSessionId === day.speedSessionId);
    if (at >= 0) sessions[at] = day; else sessions.push(day);
    const saved = await sb.from("programs").upsert({ id: pid, data: program });
    if (saved.error) throw saved.error;

    // and its place on their chart, if it is not there already
    plan.lanes = Array.isArray(plan.lanes) ? plan.lanes : [];
    plan.blocks = Array.isArray(plan.blocks) ? plan.blocks : [];
    if (!plan.blocks.some((b) => b.programId === pid)) {
      let lane = plan.lanes.find((l) => (l.name || "").toLowerCase() === SPEED_LANE.toLowerCase());
      if (!lane) { lane = { id: shortId(), name: SPEED_LANE, color: "#3b82f6" }; plan.lanes.push(lane); }
      plan.blocks.push({ id: shortId(), lane: lane.id, start: wk, len: 1, label: SPEED_LANE, notes: "", color: null, programId: pid, assignedBy: user.email || "" });
      plan.weeks = Math.max(plan.weeks || 1, wk + 1);
      const put = await sb.from("periodization").upsert({ athlete_id: aid, data: plan });
      if (put.error) throw put.error;
    }
    return at >= 0 ? `Updated in ${who}'s app.` : `Sent to ${who}'s app. It shows under "${SPEED_LANE}" for that week.`;
  }
  function sendPanel(s) {
    if (!picked.length) return null;
    const who = el("select", { "aria-label": "Athlete" }, picked.map((aid) => el("option", { value: aid, selected: aid === active }, (byId(aid) || { name: "Unknown athlete" }).name)));
    const said = el("span", { class: "kpi-status", role: "status" });
    const send = el("button", { class: "kpi-ghost", onclick: async () => {
      send.disabled = true;
      said.textContent = "Sending…";
      try { said.textContent = await sendSpeed(who.value, s); }
      catch (e) { said.textContent = "Could not send. Check your connection and try again."; }
      send.disabled = false;
    } }, "Send to their app");
    return el("div", { class: "speed-log" },
      el("h3", null, "Send to one athlete’s app"),
      el("div", { class: "kpi-foot" }, el("label", null, "Athlete", who), send, said),
      el("p", { class: "kpi-hint" }, "For an athlete doing this session on their own, such as a remote athlete. It is added to their plan in a row called Group Speed, so it shows on their phone link for that week. Athletes training with the group do not need this."));
  }

  function drawSpeed(status) {
    const group = speedGroups.find((g) => g.id === speedGroupId) || null;
    const reload = async (msg) => {
      try { await loadSpeed(); } catch (e) { drawSpeed("Could not load. Check your connection and try again."); return; }
      drawSpeed(msg);
    };
    const note = el("span", { class: "kpi-status", role: "status" }, status || "");

    // ---- which group, which day
    const head = el("div", { class: "kpi-head" },
      speedGroups.length ? el("label", null, "Group", el("select", { "aria-label": "Group", onchange: (e) => { speedGroupId = e.target.value; try { localStorage.setItem(speedGroupKey(), speedGroupId); } catch (ex) { /* private window */ } reload(); } },
        speedGroups.map((g) => el("option", { value: g.id, selected: g.id === speedGroupId }, g.name)))) : null,
      speedGroups.length ? el("label", null, "Date", el("input", { type: "date", value: speedDate, "aria-label": "Date", onchange: (e) => { speedDate = e.target.value || localDay(); reload(); } })) : null,
      el("button", { class: "kpi-ghost", onclick: () => { speedNewGroup = !speedNewGroup; drawSpeed(); } }, speedNewGroup ? "Cancel" : "+ New group"));

    let groupForm = null;
    if (speedNewGroup) {
      const name = el("input", { type: "text", placeholder: "e.g. DST North Pro Group", maxlength: "60" });
      const err = el("span", { class: "kpi-err", role: "alert" });
      groupForm = el("form", { class: "kpi-new", onsubmit: async (e) => {
        e.preventDefault();
        const n = name.value.trim();
        if (!n) { err.textContent = "Give the group a name."; return; }
        try {
          await loadSpeedGroups(); // someone else may have added one since this page loaded
          let g = speedGroups.find((x) => x.name.toLowerCase() === n.toLowerCase());
          if (!g) {
            g = { id: `${n.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${Date.now().toString(36)}`, name: n };
            speedGroups.push(g);
            speedGroups.sort((a, b) => a.name.localeCompare(b.name));
            const { error } = await sb.from("app_meta").upsert({ key: "speedGroups", value: speedGroups });
            if (error) throw error;
          }
          speedGroupId = g.id;
          try { localStorage.setItem(speedGroupKey(), g.id); } catch (ex) { /* private window */ }
        } catch (ex) { err.textContent = "Could not save the group. Try again."; return; }
        speedNewGroup = false;
        reload();
      } }, el("label", null, "Group name", name), el("button", { type: "submit", class: "kpi-save" }, "Add group"), err);
    }

    if (!group) {
      speedEl.replaceChildren(...[head, groupForm, el("div", { class: "kpi-note" }, "Make a group to start programming speed sessions for it.")].filter(Boolean));
      return;
    }

    const copyFrom = (label) => (speedRecent.length ? el("label", null, label, el("select", { onchange: (e) => {
      const from = speedRecent[Number(e.target.value)];
      if (!from) return;
      speedDraft = { title: from.title || "", items: copyItems(from.items), notes: from.notes || "" };
      drawSpeed();
    } }, el("option", { value: "" }, "Choose a session…"), speedRecent.map((s, i) => el("option", { value: i }, `${s.group} · ${dayText(s.date)}${s.title ? ` · ${s.title}` : ""}`)))) : null);

    let body;
    if (speedDraft) {
      // ---- writing or changing the session
      const d = speedDraft;
      const field = (it, key, placeholder, cls) => el("input", { type: "text", class: cls, placeholder, value: it[key], "aria-label": placeholder, oninput: (e) => { it[key] = e.target.value; } });
      const rows = d.items.map((it, i) => el("div", { class: "speed-row" },
        el("span", { class: "speed-n" }, i + 1),
        field(it, "name", "Drill", "speed-name"), field(it, "detail", "Sets, reps, distance", "speed-detail"), field(it, "notes", "Coaching notes", "speed-notes"),
        el("button", { class: "speed-move", title: "Move up", "aria-label": `Move drill ${i + 1} up`, disabled: i === 0, onclick: () => { d.items.splice(i - 1, 0, d.items.splice(i, 1)[0]); drawSpeed(); } }, "↑"),
        el("button", { class: "speed-move", title: "Remove", "aria-label": `Remove drill ${i + 1}`, onclick: () => { d.items.splice(i, 1); drawSpeed(); } }, "×")));
      const save = el("button", { class: "kpi-save", onclick: async () => {
        const items = copyItems(d.items).map((it) => ({ name: it.name.trim(), detail: it.detail.trim(), notes: it.notes.trim() })).filter((it) => it.name);
        if (!items.length) { note.textContent = "Add at least one drill."; return; }
        const data = { groupId: group.id, group: group.name, date: speedDate, title: d.title.trim(), items, notes: d.notes.trim(), by: user.email || "", at: new Date().toISOString() };
        save.disabled = true;
        note.textContent = "Saving…";
        const { error } = await sb.from("speed_sessions").upsert({ id: speedId(), data, updated_at: data.at });
        if (error) { save.disabled = false; note.textContent = "Could not save. Check your connection and try again."; return; }
        speedSession = data; speedDraft = null;
        drawSpeed("Session saved.");
      } }, "Save session");
      body = el("div", { class: "speed-edit" },
        el("label", null, "Session name (optional)", el("input", { type: "text", class: "speed-title", placeholder: "e.g. Acceleration day", value: d.title, maxlength: "80", oninput: (e) => { d.title = e.target.value; } })),
        rows,
        el("div", { class: "kpi-foot" },
          el("button", { class: "kpi-ghost", onclick: () => { d.items.push({ name: "", detail: "", notes: "" }); drawSpeed(); const boxes = speedEl.querySelectorAll(".speed-name"); if (boxes.length) boxes[boxes.length - 1].focus(); } }, "+ Add drill"),
          copyFrom("Or copy from")),
        el("label", null, "Session notes (optional)", el("textarea", { class: "speed-area", rows: "2", oninput: (e) => { d.notes = e.target.value; } }, d.notes)),
        el("div", { class: "kpi-foot" }, save, el("button", { class: "kpi-ghost", onclick: () => { speedDraft = null; drawSpeed(); } }, "Cancel"), note));
    } else if (!speedSession) {
      // ---- nothing written for this group and day yet
      body = el("div", null,
        el("div", { class: "kpi-note" }, `No speed session for ${group.name} on ${dayText(speedDate)} yet.`),
        el("div", { class: "kpi-foot" },
          el("button", { class: "kpi-save", onclick: () => { speedDraft = { title: "", items: [{ name: "", detail: "", notes: "" }], notes: "" }; drawSpeed(); } }, "Build session"),
          copyFrom("Or copy from"), note));
    } else {
      // ---- leading the session, and logging it as done
      const s = speedSession;
      const todo = picked.filter((aid) => !speedLogged.has(aid));
      const logAll = el("button", { class: "kpi-save", disabled: !todo.length, onclick: async () => {
        const at = new Date().toISOString();
        const rowsOut = todo.map((aid) => ({ id: `speedlog|${aid}|${speedId()}`, athlete_id: aid, updated_at: at, data: { sessionId: speedId(), groupId: s.groupId, group: s.group, date: s.date, title: s.title || "", items: s.items, notes: s.notes || "", by: user.email || "", at } }));
        logAll.disabled = true;
        note.textContent = "Logging…";
        // ignoreDuplicates: an athlete someone else logged a moment ago is left as they are, never written twice
        const { error } = await sb.from("speed_logs").upsert(rowsOut, { onConflict: "id", ignoreDuplicates: true });
        if (error) { logAll.disabled = false; note.textContent = "Could not log. Check your connection and try again."; return; }
        const already = picked.length - todo.length;
        reload(`Logged for ${todo.length} athlete${todo.length === 1 ? "" : "s"}.${already ? ` ${already} already logged, left as ${already === 1 ? "it was" : "they were"}.` : ""}`);
      } }, !picked.length ? "Log for all" : todo.length ? `Log for all ${todo.length} not yet logged` : "Everyone on the board is logged");
      const unlog = async (aid, name) => {
        if (!window.confirm(`Take this speed session off ${name}'s training log?`)) return;
        const { error } = await sb.from("speed_logs").delete().eq("id", `speedlog|${aid}|${speedId()}`);
        reload(error ? "Could not remove it. Try again." : `Removed for ${name}.`);
      };
      body = el("div", null,
        el("h2", { class: "speed-h" }, s.title || "Speed session", el("small", null, `${s.group} · ${dayText(s.date)}`)),
        el("ol", { class: "speed-list" }, s.items.map((it, i) => {
          const key = `${speedId()}|${i}`;
          const li = el("li", { class: speedTicks.has(key) ? "ticked" : "" },
            el("label", null,
              el("input", { type: "checkbox", checked: speedTicks.has(key), onchange: (e) => { if (e.target.checked) speedTicks.add(key); else speedTicks.delete(key); li.classList.toggle("ticked", e.target.checked); } }),
              el("span", null, el("strong", null, it.name), it.detail ? el("b", null, it.detail) : null, it.notes ? el("small", null, it.notes) : null)));
          return li;
        })),
        s.notes ? el("p", { class: "speed-notes-text" }, s.notes) : null,
        el("div", { class: "kpi-foot" }, el("button", { class: "kpi-ghost", onclick: () => { speedDraft = { title: s.title || "", items: copyItems(s.items), notes: s.notes || "" }; drawSpeed(); } }, "Edit session")),
        el("div", { class: "speed-log" },
          el("h3", null, "Log as done"),
          picked.length
            ? el("div", { class: "speed-who" }, picked.map((aid) => {
              const a = byId(aid) || { name: "Unknown athlete" };
              return speedLogged.has(aid)
                ? el("button", { class: "logged", title: "Logged. Tap to take it off their training log.", onclick: () => unlog(aid, a.name) }, `✓ ${a.name}`)
                : el("span", null, a.name);
            }))
            : el("div", { class: "kpi-note" }, "Add the athletes in this group to the board, then log the session for all of them."),
          el("div", { class: "kpi-foot" }, logAll, note),
          el("p", { class: "kpi-hint" }, "This puts the session on the Training Log of every athlete on the board. For the next group, swap the athletes on the board and log again: anyone already logged is skipped, so no one is recorded twice.")),
        sendPanel(s));
    }

    speedEl.replaceChildren(...[head, groupForm, body].filter(Boolean));
  }

  // ---- adding: type a few letters, pick from the matches ---------------------------------------------
  function search() {
    const q = $("search").value.trim().toLowerCase();
    const box = $("results");
    if (!q) { box.hidden = true; return; }
    const hits = athletes.filter((a) => !picked.includes(a.id) && `${a.name} ${a.sub}`.toLowerCase().includes(q)).slice(0, 12);
    box.replaceChildren(...(hits.length
      ? hits.map((a) => el("button", { class: "result", onclick: () => add(a.id) }, lastFirst(a.name), el("small", null, a.sub)))
      : [el("div", { class: "result none" }, athletes.some((a) => picked.includes(a.id) && a.name.toLowerCase().includes(q)) ? "Already on the board." : "No athlete matches that.")]));
    box.hidden = false;
  }

  async function loadAthletes() {
    const all = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from("athletes").select("id,data").range(from, from + 999);
      if (error) throw error;
      all.push(...data);
      if (data.length < 1000) break;
    }
    athletes = all.map((r) => {
      const d = r.data || {};
      const coach = d.rosterGroup === "coaches";
      const cubsRoster = d.rosterGroup === "cubs-40man";
      const where = coach ? "Coach" : d.dstLocation || (cubsRoster ? "Chicago Cubs" : "");
      const status = (d.status || "active").toLowerCase();
      return {
        id: String(r.id),
        name: d.name || "Unnamed",
        sub: [where, d.position && d.position !== "Unassigned" ? d.position : "", status !== "active" ? status : ""].filter(Boolean).join(" · "),
        cubs: cubsRoster && !d.dstLocation, // Cubs-only players get the Cubs look, as on their own link
      };
    }).sort((a, b) => lastFirst(a.name).localeCompare(lastFirst(b.name)));
  }

  // ---- signing in ------------------------------------------------------------------------------------
  async function open(session) {
    user = session.user;
    $("login").hidden = true;
    $("board").hidden = false;
    $("me").textContent = user.email || "";
    try { await loadAthletes(); }
    catch (e) { $("stage").replaceChildren(el("div", { class: "empty" }, "Could not load the roster. Check your connection and reload.")); return; }
    const saved = recall();
    picked = (saved.picked || []).filter((id) => byId(id)); // anyone removed from the roster since drops off
    show(picked.includes(saved.active) ? saved.active : picked[0] || null);
    loadDone();
  }
  function close() {
    user = null; picked = []; active = null;
    closeKpi(); closeSpeed(); kpiSheet = {}; kpiHistory = [];
    frames.forEach((f) => f.remove()); frames.clear();
    $("board").hidden = true;
    $("login").hidden = false;
  }

  $("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("login-btn").disabled = true;
    $("login-err").textContent = "";
    const { error } = await sb.auth.signInWithPassword({ email: $("email").value.trim(), password: $("password").value });
    $("login-btn").disabled = false;
    if (error) $("login-err").textContent = error.message || "Sign-in failed.";
    else $("password").value = "";
  });
  $("signout").addEventListener("click", () => sb.auth.signOut());
  $("kpi-btn").addEventListener("click", () => { if (kpiOpen) show(active); else openKpi(); });
  $("speed-btn").addEventListener("click", () => { if (speedOpen) show(active); else openSpeed(); });
  $("search").addEventListener("input", search);
  $("search").addEventListener("focus", search);
  $("search").addEventListener("keydown", (e) => {
    if (e.key === "Escape") { $("results").hidden = true; e.target.blur(); }
    if (e.key === "Enter") { const first = $("results").querySelector("button.result"); if (first) first.click(); }
  });
  document.addEventListener("click", (e) => { if (!e.target.closest(".add")) $("results").hidden = true; });

  sb.auth.getSession().then(({ data }) => { if (data && data.session) open(data.session); else close(); });
  sb.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT") close();
    else if (event === "SIGNED_IN" && session && !user) open(session);
  });
})();
