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
    closeKpi();
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
    $("search").value = "";
    $("results").hidden = true;
    if (kpiOpen) { if (!active) active = id; remember(); openKpi(); return; } // adding while on the KPI sheet adds a row to it
    show(id);
  }
  function remove(id) {
    picked = picked.filter((x) => x !== id);
    const f = frames.get(id);
    if (f) { f.remove(); frames.delete(id); }
    delete kpiSheet[id];
    const next = active === id ? (picked[picked.length - 1] || null) : active;
    if (kpiOpen) { active = next; remember(); openKpi(); return; }
    show(next);
  }
  function draw() {
    const list = $("list");
    $("kpi-btn").classList.toggle("on", kpiOpen);
    if (!picked.length) { list.replaceChildren(el("div", { class: "list-hint" }, "No athletes yet. Search above to add one.")); return; }
    list.replaceChildren(...picked.map((id) => {
      const a = byId(id) || { name: "Unknown athlete", sub: "" };
      return el("div", { class: `who${id === active && !kpiOpen ? " on" : ""}` },
        el("button", { class: "who-pick", onclick: () => show(id), "aria-pressed": id === active ? "true" : "false" }, el("span", null, a.name), el("small", null, a.sub)),
        el("button", { class: "who-x", title: `Take ${a.name} off the board`, "aria-label": `Take ${a.name} off the board`, onclick: () => remove(id) }, "×"));
    }));
  }

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
    kpiOpen = true;
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
  }
  function close() {
    user = null; picked = []; active = null;
    closeKpi(); kpiSheet = {}; kpiHistory = [];
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
