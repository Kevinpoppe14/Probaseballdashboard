// The athlete's phone page: this week's program, a box to log the weight (and reps reached on sets to failure)
// for each set, and the exercise videos. Opened from a private link whose token sits after the "#", so it is
// never sent to the web server. All data comes from, and goes to, the two athlete_portal_* database functions
// (supabase/migration_007_athlete_portal.sql); nothing else in the database is reachable from here.
(function () {
  const Rx = window.ProgramRx;
  const sb = window.supabaseClient;
  const app = document.getElementById("app");
  const statusEl = document.getElementById("status");
  const overlay = document.getElementById("overlay");
  const token = (window.location.hash || "").replace(/^#/, "").trim();
  // Links for Cubs-only players carry ?team=cubs, which only changes the logo and colors.
  const cubs = new URLSearchParams(window.location.search).get("team") === "cubs";
  if (cubs) {
    document.body.classList.add("cubs");
    document.querySelector('meta[name="theme-color"]').setAttribute("content", "#06122b");
  }
  const logo = () => (cubs
    ? el("img", { src: "https://www.mlbstatic.com/team-logos/112.svg", alt: "Chicago Cubs" })
    : el("img", { src: "assets/dst-logo-light.png", alt: "Dynamic Sports Training" }));

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
  const message = (text) => { app.replaceChildren(el("div", { class: "empty" }, text)); };

  let data = null; // what athlete_portal_get returned
  let plan = null; // data.plan with programLog holding everything logged so far
  let weekIdx = 0, itemIdx = 0, dayIdx = 0;
  let derived = []; // refreshers for the filled-in weights and 1RM estimates currently on screen

  const programById = (id) => (data.programs || []).find((p) => p.id === id) || null;
  const parseISO = (s) => { const [y, m, d] = String(s).split("-").map(Number); return new Date(y, m - 1, d); };
  const currentWeek = () => {
    const days = Math.round((new Date(new Date().toDateString()) - parseISO(plan.startDate)) / 864e5);
    return Math.max(0, Math.min(plan.weeks - 1, Math.floor(days / 7)));
  };
  // the programs in play during one plan week, in the order of the plan's rows (see programWeeksAt in periodization.js)
  const itemsAt = (wk) => (plan.blocks || [])
    .filter((b) => b.programId && b.start <= wk && wk < b.start + b.len)
    .map((b) => {
      const program = programById(b.programId);
      const lane = (plan.lanes || []).find((l) => l.id === b.lane);
      if (!program || !lane || !(program.weeks || []).length) return null;
      const n = (wk - b.start) % program.weeks.length;
      return { block: b, lane, program, week: program.weeks[n], weekNo: n + 1 };
    })
    .filter(Boolean)
    .sort((a, b) => plan.lanes.indexOf(a.lane) - plan.lanes.indexOf(b.lane));
  const weekDates = (wk) => {
    const a = parseISO(plan.startDate); a.setDate(a.getDate() + wk * 7);
    const b = new Date(a); b.setDate(b.getDate() + 6);
    const f = (d) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    return `${f(a)} – ${f(b)}`;
  };

  // ---- saving ------------------------------------------------------------------------------------
  const pending = new Map(); // "programId key" -> { programId, key, value } not yet saved
  let flushing = false, statusTimer = null;
  const showStatus = (text, bad) => {
    statusEl.textContent = text;
    statusEl.className = `status show${bad ? " bad" : ""}`;
    clearTimeout(statusTimer);
    if (!bad) statusTimer = setTimeout(() => { statusEl.className = "status"; }, 1500);
  };
  async function flush() {
    if (flushing || !pending.size) return;
    flushing = true;
    for (const [id, p] of [...pending]) {
      let ok = false;
      try {
        const res = await sb.rpc("athlete_portal_log", { p_token: token, p_program_id: p.programId, p_key: p.key, p_value: p.value });
        ok = !res.error && res.data === true;
      } catch (e) { ok = false; }
      if (!ok) { showStatus("Not saved yet. Check your connection; it will retry.", true); break; }
      if (pending.get(id) === p) pending.delete(id);
    }
    flushing = false;
    if (!pending.size) showStatus("Saved");
    else setTimeout(flush, 5000);
  }
  window.addEventListener("online", flush);
  window.addEventListener("beforeunload", (e) => { if (pending.size) { e.preventDefault(); e.returnValue = ""; } });
  const logged = (programId, key) => ((plan.programLog || {})[programId] || {})[key] || "";
  const save = (programId, key, value) => {
    if (value === logged(programId, key)) return;
    const one = (plan.programLog[programId] = plan.programLog[programId] || {});
    if (value) one[key] = value; else delete one[key];
    pending.set(`${programId} ${key}`, { programId, key, value });
    flush();
    derived.forEach((fn) => fn());
  };

  // ---- exercise video ----------------------------------------------------------------------------
  const exerciseInfo = (name) => (data.exercises || []).find((x) => (x.name || "").trim().toLowerCase() === (name || "").trim().toLowerCase()) || null;
  const closeVideo = () => { overlay.className = "overlay"; overlay.replaceChildren(); };
  const openVideo = (info) => {
    const embed = window.videoEmbedOf(info.videoUrl);
    overlay.replaceChildren(el("div", { class: "sheet" },
      el("button", { class: "close", "aria-label": "Close", onclick: closeVideo }, "×"),
      el("h2", null, info.name),
      embed
        ? el("div", { class: `video${embed.vertical ? " vertical" : ""}` }, el("iframe", { src: embed.src, title: info.name, allow: "accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture", allowfullscreen: true, referrerpolicy: "strict-origin-when-cross-origin" }))
        : info.videoUrl ? el("a", { href: info.videoUrl, target: "_blank", rel: "noopener" }, "Open the video") : null,
      info.cues ? el("div", { class: "cues" }, info.cues) : null));
    overlay.className = "overlay show";
  };
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeVideo(); });

  // ---- one set group -----------------------------------------------------------------------------
  function setBox(item, si, e, g, gi) {
    const pid = item.program.id;
    const fail = Rx.failure(g);
    const wKey = Rx.logKey(e, gi), rKey = Rx.repsLogKey(e, gi);
    const int = Rx.intensityText(e, g);
    const weight = el("input", { type: "text", inputmode: "decimal", placeholder: "wt", "aria-label": "Weight used", autocomplete: "off" });
    const reps = fail ? el("input", { type: "text", inputmode: "numeric", placeholder: "reps", "aria-label": `Reps reached${fail.each ? " each side" : ""}`, autocomplete: "off" }) : null;
    const est = el("span", { class: "est" });
    let auto = null;
    // works out the filled-in weight and the estimate again; never touches a box the athlete is typing in
    const refresh = () => {
      const max = window.planMaxes(plan, programById).before(e.name, weekIdx, si);
      const suggest = max && Rx.normalize(e).intensityUnit === "%" ? Rx.weightAt(max.value, g) : null;
      const has = logged(pid, wKey);
      auto = suggest && !has ? suggest : null;
      if (document.activeElement !== weight) { weight.value = has || (auto ? `${auto}` : ""); weight.className = auto ? "auto" : ""; }
      if (reps && document.activeElement !== reps) reps.value = logged(pid, rKey);
      const used = has || (auto ? `${auto}` : "");
      const value = fail ? Rx.estimate1RM(used, logged(pid, rKey)) : null;
      est.textContent = value ? `Est. 1RM ${value}` : "";
    };
    weight.addEventListener("focus", () => { weight.className = ""; weight.select(); });
    weight.addEventListener("blur", () => {
      const v = weight.value.trim();
      if (!logged(pid, wKey) && auto && v === `${auto}`) { refresh(); return; } // untouched filled-in weight stays automatic
      save(pid, wKey, v);
      refresh();
    });
    if (reps) {
      reps.addEventListener("focus", () => reps.select());
      reps.addEventListener("blur", () => { save(pid, rKey, reps.value.trim()); refresh(); });
    }
    [weight, reps].forEach((i) => i && i.addEventListener("keydown", (ev) => { if (ev.key === "Enter") i.blur(); }));
    derived.push(refresh);
    refresh();
    return el("div", { class: `set${fail ? " fail" : ""}` },
      el("span", { class: "reps" }, Rx.repsText(g)),
      el("div", { class: "boxes" }, weight, reps),
      int ? el("span", { class: "pct" }, int) : null,
      est);
  }

  // ---- the page ----------------------------------------------------------------------------------
  function render() {
    derived = [];
    const items = itemsAt(weekIdx);
    itemIdx = Math.min(itemIdx, Math.max(0, items.length - 1));
    const item = items[itemIdx];
    const sessions = item ? (item.week.sessions || []) : [];
    dayIdx = Math.min(dayIdx, Math.max(0, sessions.length - 1));
    const go = (fn) => () => { fn(); render(); window.scrollTo(0, 0); };

    const top = el("div", { class: "top" },
      el("div", { class: "brand" }, logo(), el("div", { class: "who" }, data.athlete.name || "My Program")),
      el("div", { class: "weekbar" },
        el("button", { class: "nav", "aria-label": "Previous week", disabled: weekIdx <= 0, onclick: go(() => { weekIdx -= 1; dayIdx = 0; }) }, "‹"),
        el("h1", null, `Week ${weekIdx + 1} of ${plan.weeks}${weekIdx === currentWeek() ? " · This week" : ""}`, el("small", null, weekDates(weekIdx))),
        el("button", { class: "nav", "aria-label": "Next week", disabled: weekIdx >= plan.weeks - 1, onclick: go(() => { weekIdx += 1; dayIdx = 0; }) }, "›")));

    const parts = [top];
    if (items.length > 1) {
      parts.push(el("div", { class: "chips" }, items.map((it, i) => el("button", { class: `chip${i === itemIdx ? " on" : ""}`, onclick: go(() => { itemIdx = i; dayIdx = 0; }) }, it.lane.name))));
    }
    if (sessions.length > 1) {
      parts.push(el("div", { class: "chips days" }, sessions.map((s, i) => el("button", { class: `chip${i === dayIdx ? " on" : ""}`, onclick: go(() => { dayIdx = i; }) }, s.name || `Day ${i + 1}`))));
    }

    const main = el("main");
    if (!item) main.append(el("div", { class: "empty" }, "Nothing is scheduled for this week."));
    else {
      main.append(el("p", { class: "program-name" }, `${item.program.name} · ${item.week.name || `Week ${item.weekNo}`} (${item.weekNo} of ${item.program.weeks.length})`));
      const s = sessions[dayIdx];
      const rows = s ? (s.exercises || []).filter((e) => (e.name || "").trim()) : [];
      if (s && (s.warmup || "").trim()) main.append(el("div", { class: "warmup" }, el("strong", null, "Warm-up: "), s.warmup));
      if (!rows.length) main.append(el("div", { class: "empty" }, "No exercises for this day."));
      const labels = window.exerciseLabels(rows);
      let group = null;
      rows.forEach((e, ei) => {
        if (!group || !(ei > 0 && e.linked)) { group = el("div", { class: "group" }); main.append(group); } // a superset shares one card
        const info = exerciseInfo(e.name);
        const groups = Rx.groups(e);
        group.append(el("div", { class: "ex" },
          el("div", { class: "ex-head" },
            el("span", { class: "label" }, labels[ei]),
            info && (info.videoUrl || info.cues) ? el("button", { class: "name", onclick: () => openVideo(info) }, e.name) : el("span", { class: "name" }, e.name)),
          (e.tempo || e.rest) ? el("div", { class: "meta" }, e.tempo ? el("span", { class: "tempo" }, `Tempo ${e.tempo}`) : null, e.rest ? el("span", null, `Rest ${e.rest}`) : null) : null,
          e.notes ? el("div", { class: "notes" }, e.notes) : null,
          groups.length ? el("div", { class: "sets" }, groups.map((g, gi) => setBox(item, dayIdx, e, g, gi))) : null));
      });
    }
    parts.push(main);
    app.replaceChildren(...parts);
  }

  async function start() {
    if (!token) { message("This link is missing its code. Ask your coach to send it again."); return; }
    let res;
    try { res = await sb.rpc("athlete_portal_get", { p_token: token }); }
    catch (e) { res = { error: e }; }
    if (res.error) { message("Could not load your program. Check your connection and try again."); return; }
    if (!res.data) { message("This link is no longer active. Ask your coach for a new one."); return; }
    data = res.data;
    if (!data.plan || !(data.plan.blocks || []).length) { message("Your coach has not put a program on your plan yet."); return; }
    plan = { ...data.plan, weeks: Number(data.plan.weeks) || 1, programLog: {} };
    // what's been logged: the older entries kept on the plan, then the log table laid over them
    Object.entries(data.plan.programLog || {}).forEach(([pid, one]) => { plan.programLog[pid] = { ...one }; });
    (data.logs || []).forEach((r) => {
      const one = (plan.programLog[r.programId] = plan.programLog[r.programId] || {});
      if (r.value) one[r.key] = r.value; else delete one[r.key];
    });
    if (data.rmChart && typeof data.rmChart === "object") Rx.chart = () => data.rmChart;
    else Rx.chart = () => ({ 1: 100, 2: 95, 3: 92.5, 4: 90, 5: 87.5, 6: 85, 7: 82.5, 8: 80, 9: 77.5, 10: 75, 11: 72.5, 12: 70, 13: 67.5, 14: 65, 15: 60, 16: 55, 17: 50 });
    document.title = data.athlete.name ? `${data.athlete.name} · Program` : "My Program";
    weekIdx = currentWeek();
    render();
  }
  start();
})();
