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
  let view = "program"; // "program" (this week's training), "plan" (the player plan) or "equipment" (remote athletes)
  let remote = false; // trains remotely: gets the equipment survey
  let equipment = { access: null, custom: [], surveyedAt: null };
  let derived = []; // refreshers for the filled-in weights and 1RM estimates currently on screen

  // The athlete's own changes to an exercise or its sets and reps: programId -> exercise id -> { name, groups, from }.
  // programById gives the program with those applied; rawProgram is what the coach wrote.
  let overrides = {};
  let effective = {};
  const rawProgram = (id) => (data.programs || []).find((p) => p.id === id) || null;
  const programById = (id) => {
    if (!(id in effective)) effective[id] = window.applyOverrides(rawProgram(id), overrides[id]);
    return effective[id];
  };
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

  // ---- changing an exercise, or its sets and reps ------------------------------------------------
  // Opened from the switch button beside an exercise name. The athlete can type another exercise (matches from
  // the exercise library are offered as they type) and edit the sets and reps. If the same exercise comes up
  // on the same day in later weeks of the program, they are asked whether to change those too.
  function openSwap(item, si, e) {
    const pid = item.program.id;
    const raw = rawProgram(pid);
    const wi = item.weekNo - 1;
    const sameName = (a, b) => (a || "").trim().toLowerCase() === (b || "").trim().toLowerCase();
    // the coach's version of this exercise, and where the same one comes up in the weeks after this one
    const rawDay = (w) => ((((raw.weeks[w] || {}).sessions || [])[si] || {}).exercises || []);
    const coach = rawDay(wi).find((x) => x.id === e.id) || e;
    const nth = rawDay(wi).filter((x) => sameName(x.name, coach.name)).indexOf(coach);
    const later = [];
    for (let w = wi + 1; w < raw.weeks.length; w += 1) {
      const m = rawDay(w).filter((x) => sameName(x.name, coach.name))[Math.max(0, nth)];
      if (m && m.id !== e.id) later.push(m.id);
    }
    const changed = !!(overrides[pid] || {})[e.id];
    const unit = Rx.normalize(e).intensityUnit;
    let groups = Rx.normalize(e).groups.map((g) => ({ sets: `${g.sets || ""}`, reps: `${g.reps || ""}`, intensity: `${g.intensity || ""}` }));
    if (!groups.length) groups = [{ sets: "", reps: "", intensity: "" }];
    let picked = null; // library entry chosen from the suggestions

    const name = el("input", { type: "text", class: "swap-name", value: e.name, autocomplete: "off", autocapitalize: "words", "aria-label": "Exercise" });
    const matches = el("div", { class: "matches" });
    const rowsEl = el("div", { class: "swap-rows" });
    const note = el("div", { class: "swap-note" });
    const actions = el("div", { class: "swap-actions" });
    let searchTimer = null, searchNo = 0;
    name.addEventListener("input", () => {
      picked = null;
      clearTimeout(searchTimer);
      const q = name.value.trim();
      if (q.length < 2) { matches.replaceChildren(); return; }
      searchTimer = setTimeout(async () => {
        const no = (searchNo += 1);
        let res;
        try { res = await sb.rpc("athlete_portal_exercises", { p_token: token, p_query: q }); } catch (err) { res = { data: [] }; }
        if (no !== searchNo) return;
        matches.replaceChildren(...(res.data || []).slice(0, 8).map((m) => el("button", { class: "match", onclick: () => { name.value = m.name; picked = m; matches.replaceChildren(); } }, m.name, m.videoUrl ? el("small", null, "video") : null)));
      }, 250);
    });
    const drawRows = () => {
      rowsEl.replaceChildren(...groups.map((g, gi) => {
        const field = (key, label, mode) => el("label", null, label, el("input", { type: "text", inputmode: mode, value: g[key], autocomplete: "off", oninput: (ev) => { g[key] = ev.target.value; } }));
        return el("div", { class: "swap-row" },
          field("sets", "Sets", "numeric"), field("reps", "Reps", "text"),
          unit ? field("intensity", unit === "%" ? "%" : unit, "decimal") : null,
          groups.length > 1 ? el("button", { class: "swap-x", "aria-label": "Remove this set", onclick: () => { groups.splice(gi, 1); drawRows(); } }, "×") : null);
      }), el("button", { class: "swap-add", onclick: () => { groups.push({ sets: "", reps: "", intensity: "" }); drawRows(); } }, "+ Add a set"));
    };
    const apply = async (ids, payload) => {
      note.textContent = "Saving…";
      let ok = false;
      try {
        const res = await sb.rpc("athlete_portal_override", { p_token: token, p_program_id: pid, p_exercise_ids: ids, p_data: payload });
        ok = !res.error && res.data === true;
      } catch (err) { ok = false; }
      if (!ok) { note.textContent = "Could not save. Check your connection and try again."; drawActions(); return; }
      const one = (overrides[pid] = overrides[pid] || {});
      ids.forEach((id) => { if (payload) one[id] = payload; else delete one[id]; });
      delete effective[pid];
      if (picked && !exerciseInfo(picked.name)) data.exercises.push(picked);
      closeVideo();
      render();
      showStatus(payload ? "Changed" : "Back to your coach's version");
    };
    // asks about the rest of the phase when the same exercise comes up again, then saves
    const choose = (payload, ask) => {
      const ids = later.filter((id) => (payload ? true : !!(overrides[pid] || {})[id]));
      if (!ids.length) { apply([e.id], payload); return; }
      note.textContent = ask;
      actions.replaceChildren(
        el("button", { class: "primary", onclick: () => apply([e.id, ...ids], payload) }, "Yes, all remaining weeks"),
        el("button", { onclick: () => apply([e.id], payload) }, "Just this week"));
    };
    function drawActions() {
      actions.replaceChildren(...[
        el("button", { class: "primary", onclick: () => {
          const nm = name.value.trim();
          const gs = groups.map((g) => ({ sets: g.sets.trim(), reps: g.reps.trim(), intensity: g.intensity.trim() })).filter((g) => g.sets || g.reps);
          if (!nm) { note.textContent = "Type an exercise name."; return; }
          if (!gs.length) { note.textContent = "Enter the sets and reps."; return; }
          choose({ name: nm, groups: gs, from: coach.name }, "Replace for the rest of this phase?");
        } }, "Save"),
        changed ? el("button", { onclick: () => choose(null, "Go back to your coach's version for the rest of this phase too?") }, "Use coach's version") : null,
        el("button", { onclick: closeVideo }, "Cancel")].filter(Boolean));
    }
    drawRows();
    drawActions();
    overlay.replaceChildren(el("div", { class: "sheet" },
      el("button", { class: "close", "aria-label": "Close", onclick: closeVideo }, "×"),
      el("h2", null, "Change exercise"),
      changed ? el("div", { class: "swap-coach" }, `Coach: ${coach.name}${Rx.text(coach) ? `, ${Rx.text(coach)}` : ""}`) : null,
      el("label", { class: "swap-label" }, "Exercise", name),
      matches,
      el("div", { class: "swap-label" }, "Sets and reps"),
      rowsEl, note, actions));
    overlay.className = "overlay show";
  }

  // What was logged for this set the last time it came up: the same exercise (by name) on the same day of an
  // earlier week of this block, looking back from last week. Returns { week, text } or null.
  function lastLogged(item, si, e, gi) {
    const pid = item.program.id, name = (e.name || "").trim().toLowerCase();
    const same = (x) => (x.name || "").trim().toLowerCase() === name;
    const today = ((item.week.sessions || [])[si] || {}).exercises || [];
    const nth = today.filter(same).indexOf(e); // which one, if the exercise is on the day more than once
    for (let wk = weekIdx - 1; wk >= item.block.start; wk -= 1) {
      const week = item.program.weeks[(wk - item.block.start) % item.program.weeks.length];
      const prev = ((((week || {}).sessions || [])[si] || {}).exercises || []).filter(same)[Math.max(0, nth)];
      if (!prev || prev.id === e.id) continue;
      const w = logged(pid, Rx.logKey(prev, gi)), r = logged(pid, Rx.repsLogKey(prev, gi));
      if (w || r) return { week: wk + 1, text: r ? `${w || "?"} x ${r}` : w };
    }
    return null;
  }

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
    const last = lastLogged(item, si, e, gi);
    return el("div", { class: `set${fail ? " fail" : ""}` },
      el("span", { class: "reps" }, Rx.repsText(g)),
      el("div", { class: "boxes" }, weight, reps),
      int ? el("span", { class: "pct" }, int) : null,
      est,
      last ? el("span", { class: "last", title: `Logged in week ${last.week}` }, `Wk ${last.week}: ${last.text}`) : null);
  }

  // ---- player plan: where the plan is now, the timeline row by row, goals and the action plan --------
  const menu = () => el("div", { class: "menu", role: "tablist" },
    [["program", "Program"], ["plan", "My Plan"]].concat(remote ? [["equipment", "Equipment"]] : []).map(([id, text]) => el("button", { class: `menu-item${view === id ? " on" : ""}`, role: "tab", "aria-selected": view === id ? "true" : "false", onclick: () => { view = id; render(); window.scrollTo(0, 0); } }, text)));
  const blockDates = (b) => {
    const a = parseISO(plan.startDate); a.setDate(a.getDate() + b.start * 7);
    const z = new Date(a); z.setDate(z.getDate() + b.len * 7 - 1);
    const f = (d) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    return `Wk ${b.start + 1}${b.len > 1 ? `–${b.start + b.len}` : ""} · ${f(a)} – ${f(z)}`;
  };
  function planView() {
    const now = currentWeek();
    const main = el("main");
    const started = new Date(new Date().toDateString()) >= parseISO(plan.startDate);
    const end = parseISO(plan.startDate); end.setDate(end.getDate() + plan.weeks * 7 - 1);
    const fmt = (d) => d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    main.append(el("div", { class: "card" },
      el("div", { class: "card-title" }, started ? `Week ${now + 1} of ${plan.weeks}` : `Starts ${fmt(parseISO(plan.startDate))}`),
      el("div", { class: "bar" }, el("span", { style: `width:${started ? Math.round(((now + 1) / plan.weeks) * 100) : 0}%` })),
      el("div", { class: "card-sub" }, `${fmt(parseISO(plan.startDate))} – ${fmt(end)}`)));

    const lanes = (plan.lanes || []).filter((l) => (plan.blocks || []).some((b) => b.lane === l.id));
    if (lanes.length) main.append(el("h2", { class: "section" }, "Timeline"));
    lanes.forEach((l) => {
      const blocks = plan.blocks.filter((b) => b.lane === l.id).sort((a, b) => a.start - b.start);
      main.append(el("div", { class: "card" },
        el("div", { class: "card-title" }, l.name),
        blocks.map((b) => {
          const state = started && b.start <= now && now < b.start + b.len ? "now" : (started && b.start + b.len <= now ? "past" : "");
          return el("div", { class: `phase ${state}`, style: `border-left-color:${b.color || l.color || "#666"}` },
            el("div", { class: "phase-name" }, b.label || "Untitled", state === "now" ? el("span", { class: "now-tag" }, "Now") : null),
            el("div", { class: "phase-when" }, blockDates(b)));
        })));
    });

    const goals = plan.goals && typeof plan.goals === "object" ? plan.goals : {};
    [["physical", "Physical Goals"], ["skill", "Skill Goals"], ["habits", "Habits"]].forEach(([key, title]) => {
      const items = Array.isArray(goals[key]) ? goals[key].filter((g) => g && (g.text || "").trim()) : [];
      if (!items.length) return;
      main.append(el("h2", { class: "section" }, title, el("small", null, `${items.filter((g) => g.done).length} of ${items.length} achieved`)));
      main.append(el("div", { class: "card" }, items.map((g, i) => el("div", { class: `goal${g.done ? " done" : ""}` },
        el("span", { class: "goal-rank" }, `${i + 1}`), el("span", { class: "goal-mark" }, g.done ? "✓" : "○"), el("span", null, g.text)))));
    });

    const facility = (data.athlete.offseasonFacility || "").trim().replace(/\.$/, "");
    const first = (data.athlete.name || "").trim().split(/\s+/)[0];
    const lead = facility && first ? `This off-season, ${first} will be training at ${facility}.` : "";
    const action = typeof plan.actionPlan === "string" ? plan.actionPlan.trim() : "";
    if (lead || action) {
      main.append(el("h2", { class: "section" }, "Action Plan"));
      main.append(el("div", { class: "card action" }, lead ? el("p", { class: "lead" }, lead) : null, action || null));
    }
    return main;
  }

  // ---- logging a session ---------------------------------------------------------------------------
  // "Log session" at the end of a day marks that day of that program week as done. The mark is kept in the
  // same log as the weights, under a key of its own, so the coach's Training Log can show it with its time.
  // If some sets have no weight yet, a sheet asks for them first; the athlete can fill them in or skip.
  const sessionKey = (item, si) => `session-${item.weekNo - 1}-${si}|0`;
  function logSession(item, si, rows) {
    const pid = item.program.id;
    const maxes = window.planMaxes(plan, programById);
    const missing = []; // { e, sets: [{ g, gi, fail, suggest }] } for every set with no weight (or no reps, on a set to failure)
    rows.forEach((e) => {
      const sets = [];
      Rx.groups(e).forEach((g, gi) => {
        const fail = Rx.failure(g);
        if (logged(pid, Rx.logKey(e, gi)) && (!fail || logged(pid, Rx.repsLogKey(e, gi)))) return;
        const max = maxes.before(e.name, weekIdx, si);
        sets.push({ g, gi, fail, suggest: max && Rx.normalize(e).intensityUnit === "%" ? Rx.weightAt(max.value, g) : null });
      });
      if (sets.length) missing.push({ e, sets });
    });
    const finish = () => { save(pid, sessionKey(item, si), "done"); closeVideo(); render(); showStatus("Session logged"); };
    if (!missing.length) { finish(); return; }

    const fields = []; // { key, input }
    const body = missing.map(({ e, sets }) => el("div", { class: "log-ex" },
      el("div", { class: "log-name" }, e.name),
      el("div", { class: "sets" }, sets.map(({ g, gi, fail, suggest }) => {
        const has = logged(pid, Rx.logKey(e, gi));
        const weight = el("input", { type: "text", inputmode: "decimal", placeholder: "wt", value: has || (suggest ? `${suggest}` : ""), "aria-label": `${e.name} ${Rx.repsText(g)} weight`, autocomplete: "off" });
        fields.push({ key: Rx.logKey(e, gi), input: weight });
        let reps = null;
        if (fail) {
          reps = el("input", { type: "text", inputmode: "numeric", placeholder: "reps", value: logged(pid, Rx.repsLogKey(e, gi)), "aria-label": `${e.name} reps reached`, autocomplete: "off" });
          fields.push({ key: Rx.repsLogKey(e, gi), input: reps });
        }
        const int = Rx.intensityText(e, g);
        return el("div", { class: `set${fail ? " fail" : ""}` },
          el("span", { class: "reps" }, Rx.repsText(g)),
          el("div", { class: "boxes" }, weight, reps),
          int ? el("span", { class: "pct" }, int) : null);
      }))));
    overlay.replaceChildren(el("div", { class: "sheet" },
      el("button", { class: "close", "aria-label": "Close", onclick: closeVideo }, "×"),
      el("h2", null, "Log session"),
      el("div", { class: "swap-coach" }, "Some sets have no weight yet. Add what you used, or skip."),
      body,
      el("div", { class: "swap-actions" },
        el("button", { class: "primary", onclick: () => { fields.forEach((f) => { const v = f.input.value.trim(); if (v) save(pid, f.key, v); }); finish(); } }, "Save and log"),
        el("button", { onclick: finish }, "Skip"),
        el("button", { onclick: closeVideo }, "Cancel"))));
    overlay.className = "overlay show";
    overlay.scrollTop = 0;
  }

  // ---- equipment survey (remote athletes) ----------------------------------------------------------
  // Athletes who train remotely tick what they have to train with. It is asked before their first look at a
  // program (and works before one is assigned), and stays reachable from the menu. Saving it lets the coach's
  // dashboard flag exercises they can't do, and emails the coach who assigned the program if any are flagged.
  const EC = window.EquipmentCheck;
  let draft = null; // { have: Set of names, custom: [names] } while the survey is open
  function equipmentView() {
    const lower = (q) => `${q}`.toLowerCase();
    if (!draft) {
      // the saved list also carries the indoor turf length (see turfYards in program_rx.js), which is not equipment
      const saved = Array.isArray(equipment.access) ? equipment.access : [];
      const access = saved.filter((q) => !EC.isSetting(q));
      const listed = (q) => EC.LIST.some((x) => lower(x) === lower(q));
      draft = { have: new Set(access), custom: [...new Set([...(equipment.custom || []), ...access.filter((q) => !listed(q))])], turf: EC.turfYards(saved) || "" };
    }
    const first = !equipment.surveyedAt;
    const main = el("main");
    main.append(el("div", { class: "card" },
      el("div", { class: "card-title" }, first ? "Before you start: what equipment do you have?" : "Your equipment"),
      el("div", { class: "card-sub" }, "Tick everything you can train with. Your coach uses this to build a program you can actually do. You can change it any time.")));
    const tile = (q) => {
      const box = el("input", { type: "checkbox" });
      box.checked = draft.have.has(q);
      const t = el("label", { class: `eq-tile${box.checked ? " on" : ""}` }, box, el("span", null, EC.label(q)));
      box.addEventListener("change", () => { if (box.checked) draft.have.add(q); else draft.have.delete(q); t.className = `eq-tile${box.checked ? " on" : ""}`; });
      // indoor turf comes with a blank for its length; left empty, it is taken to be long enough for anything
      if (q === "Indoor Turf") {
        const len = el("input", { type: "text", inputmode: "numeric", class: "eq-len", placeholder: "length", value: draft.turf, "aria-label": "Indoor turf length in yards", autocomplete: "off" });
        len.addEventListener("input", () => {
          draft.turf = len.value.trim();
          if (draft.turf && !box.checked) { box.checked = true; draft.have.add(q); t.className = "eq-tile on"; } // a length means they have turf
        });
        t.append(el("span", { class: "eq-len-wrap" }, len, "yd"));
        t.style.gridColumn = "span 2"; // room for the length box
      }
      return t;
    };
    EC.GROUPS.forEach((g) => main.append(el("h2", { class: "section" }, g.name), el("div", { class: "eq-tiles" }, g.items.map(tile))));
    const customBox = el("div", { class: "eq-tiles" }, draft.custom.map(tile));
    const add = el("input", { type: "text", class: "eq-new", placeholder: "Add new equipment", "aria-label": "Add new equipment", autocomplete: "off", autocapitalize: "words" });
    const addNew = () => {
      const q = add.value.trim().replace(/\s+/g, " ").slice(0, 60);
      if (!q) return;
      const name = EC.LIST.find((x) => lower(x) === lower(q)) || draft.custom.find((x) => lower(x) === lower(q)) || q;
      draft.have.add(name);
      if (!EC.LIST.includes(name) && !draft.custom.includes(name)) draft.custom.push(name);
      render();
    };
    add.addEventListener("keydown", (ev) => { if (ev.key === "Enter") addNew(); });
    main.append(el("h2", { class: "section" }, "Anything else?"), customBox, el("div", { class: "eq-new-row" }, add, el("button", { class: "eq-new-btn", onclick: addNew }, "Add")));
    const note = el("div", { class: "swap-note" });
    const saveBtn = el("button", { class: "session-log", onclick: async () => {
      saveBtn.disabled = true;
      note.textContent = "Saving…";
      const access = EC.withTurfYards([...draft.have], draft.have.has("Indoor Turf") ? draft.turf : null), custom = [...draft.custom];
      let ok = false;
      try { const res = await sb.rpc("athlete_portal_equipment", { p_token: token, p_access: access, p_custom: custom }); ok = !res.error && res.data === true; } catch (e) { ok = false; }
      saveBtn.disabled = false;
      if (!ok) { note.textContent = "Could not save. Check your connection and try again."; return; }
      equipment = { access, custom, surveyedAt: new Date().toISOString() };
      draft = null;
      // lets the coach who assigned the program know if any exercise needs something not ticked; nothing to wait for
      try { fetch("/api/equipment-alert", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) }).catch(() => {}); } catch (e) { /* not reachable: the dashboard still shows the flags */ }
      view = plan ? "program" : "equipment";
      render();
      window.scrollTo(0, 0);
      showStatus("Equipment saved");
    } }, first ? "Save and continue" : "Save my equipment");
    main.append(el("div", { class: "session-end" }, note, saveBtn));
    if (!plan && !first) main.append(el("div", { class: "empty" }, "Thanks. Your coach has not put a program on your plan yet; it will show up here when they do."));
    return main;
  }

  // ---- the page ----------------------------------------------------------------------------------
  function render() {
    derived = [];
    if (view === "equipment") {
      // the first time through there is no menu: the survey comes before anything else
      app.replaceChildren(el("div", { class: "top" }, el("div", { class: "brand" }, logo(), el("div", { class: "who" }, data.athlete.name || "My Equipment")), equipment.surveyedAt && plan ? menu() : null), equipmentView());
      return;
    }
    if (view === "plan") {
      app.replaceChildren(el("div", { class: "top" }, el("div", { class: "brand" }, logo(), el("div", { class: "who" }, data.athlete.name || "My Plan")), menu()), planView());
      return;
    }
    const items = itemsAt(weekIdx);
    itemIdx = Math.min(itemIdx, Math.max(0, items.length - 1));
    const item = items[itemIdx];
    const sessions = item ? (item.week.sessions || []) : [];
    dayIdx = Math.min(dayIdx, Math.max(0, sessions.length - 1));
    const go = (fn) => () => { fn(); render(); window.scrollTo(0, 0); };

    const top = el("div", { class: "top" },
      el("div", { class: "brand" }, logo(), el("div", { class: "who" }, data.athlete.name || "My Program")),
      menu(),
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
            info && (info.videoUrl || info.cues) ? el("button", { class: "name", onclick: () => openVideo(info) }, e.name) : el("span", { class: "name" }, e.name),
            el("button", { class: `swap${e._coach ? " on" : ""}`, "aria-label": `Change ${e.name} or its sets and reps`, title: "Change exercise or sets and reps", onclick: () => openSwap(item, dayIdx, e) }, "⇄")),
          e._coach ? el("div", { class: "notes" }, `You changed this. Coach: ${e._coach.name}${e._coach.text ? `, ${e._coach.text}` : ""}`) : null,
          (e.tempo || e.rest) ? el("div", { class: "meta" }, e.tempo ? el("span", { class: "tempo" }, `Tempo ${e.tempo}`) : null, e.rest ? el("span", null, `Rest ${e.rest}`) : null) : null,
          e.notes ? el("div", { class: "notes" }, e.notes) : null,
          groups.length ? el("div", { class: "sets" }, groups.map((g, gi) => setBox(item, dayIdx, e, g, gi))) : null));
      });
      // end of the day: mark the session as done
      if (rows.length) {
        const done = logged(item.program.id, sessionKey(item, dayIdx));
        main.append(el("div", { class: "session-end" },
          done
            ? el("div", { class: "session-done" }, "✓ Session logged", el("button", { class: "session-undo", onclick: () => { save(item.program.id, sessionKey(item, dayIdx), ""); render(); } }, "Undo"))
            : el("button", { class: "session-log", onclick: () => logSession(item, dayIdx, rows) }, "Log session")));
      }
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
    remote = !!(data.athlete && data.athlete.remote);
    if (data.equipment) equipment = { access: data.equipment.access || null, custom: data.equipment.custom || [], surveyedAt: data.equipment.surveyedAt || null };
    document.title = data.athlete.name ? `${data.athlete.name} · Program` : "My Program";
    if (!data.plan || !(data.plan.blocks || []).length) {
      // no program yet: a remote athlete can still fill in their equipment, so the coach can build around it
      if (remote) { view = "equipment"; render(); } else message("Your coach has not put a program on your plan yet.");
      return;
    }
    plan = { ...data.plan, weeks: Number(data.plan.weeks) || 1, programLog: {} };
    // what's been logged: the older entries kept on the plan, then the log table laid over them
    Object.entries(data.plan.programLog || {}).forEach(([pid, one]) => { plan.programLog[pid] = { ...one }; });
    (data.logs || []).forEach((r) => {
      const one = (plan.programLog[r.programId] = plan.programLog[r.programId] || {});
      if (r.value) one[r.key] = r.value; else delete one[r.key];
    });
    (data.overrides || []).forEach((r) => { (overrides[r.programId] = overrides[r.programId] || {})[r.exerciseId] = r.data; });
    data.exercises = data.exercises || [];
    if (data.rmChart && typeof data.rmChart === "object") Rx.chart = () => data.rmChart;
    else Rx.chart = () => ({ 1: 100, 2: 95, 3: 92.5, 4: 90, 5: 87.5, 6: 85, 7: 82.5, 8: 80, 9: 77.5, 10: 75, 11: 72.5, 12: 70, 13: 67.5, 14: 65, 15: 60, 16: 55, 17: 50 });
    weekIdx = currentWeek();
    // a remote athlete fills in their equipment before they see the program for the first time
    if (remote && !equipment.surveyedAt) view = "equipment";
    render();
  }
  start();
})();
