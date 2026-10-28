// Periodization planner — an interactive week-by-week offseason planner for one athlete at a time.
// Lives on the Player Plans page (Periodization tab). Rows ("lanes") are training categories
// (Strength, Speed, Re-Education, Arm Care, Throwing, ...) and each block is a labelled bar that
// spans one or more weeks. Loaded as its own <script type="text/babel"> before the main app and
// exposes window.PeriodizationPlanner.
//
// Mouse:   drag on an empty lane to create a block  ·  drag a block to move it (across weeks and
//          lanes)  ·  drag a block's left/right edge to resize  ·  double-click to rename  ·
//          double-click an empty week to add a 1-week block  ·  Shift/Ctrl-click to multi-select
// Keys:    Ctrl+C / X / V copy, cut, paste (the clipboard works across athletes)  ·  Ctrl+D
//          duplicate  ·  Ctrl+Z / Y undo, redo  ·  Ctrl+A select all  ·  Delete removes  ·
//          arrow keys nudge by a week  ·  Enter renames  ·  Esc deselects
(function () {
  const { useState, useMemo, useRef, useEffect } = React;

  const WEEK_W = 76;   // px per week column
  const LABEL_W = 138; // px for the lane-name column
  const ROW_H = 34;    // px per stacked block row inside a lane
  const MAX_WEEKS = 60;
  const PALETTE = ["#b5283a", "#f59e0b", "#14b8a6", "#3b82f6", "#8b5cf6", "#22c55e", "#ec4899", "#6b7280"];
  const CLIP_KEY = "dst-period-clipboard";
  const LAST_ATHLETE_KEY = "dst-period-athlete";

  const uid = () => Math.random().toString(36).slice(2, 10);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // ---- dates ---------------------------------------------------------------------------------
  const pad = (n) => String(n).padStart(2, "0");
  const toISO = (dt) => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
  const parseISO = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); };
  const addDaysISO = (iso, n) => { const dt = parseISO(iso); dt.setDate(dt.getDate() + n); return toISO(dt); };
  const fmtMD = (iso) => parseISO(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const mondayOfToday = () => { const dt = new Date(); dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7)); return toISO(dt); };

  // ---- plan model ----------------------------------------------------------------------------
  // plan = { startDate, weeks, lanes: [{id,name,color}], blocks: [{id,lane,start,len,label,notes,color}] }
  // `start` is a 0-based week index, `len` is a number of weeks (>= 1).
  function defaultLanes() {
    return [
      { id: uid(), name: "Strength", color: PALETTE[0] },
      { id: uid(), name: "Speed", color: PALETTE[3] },
      { id: uid(), name: "Re-Education", color: PALETTE[5] },
      { id: uid(), name: "Arm Care", color: PALETTE[4] },
      { id: uid(), name: "Throwing", color: PALETTE[1] },
    ];
  }

  function newPlan() {
    return { startDate: mondayOfToday(), weeks: 16, lanes: defaultLanes(), blocks: [], goals: { physical: [] }, actionPlan: "" };
  }

  // Physical Goals is the only goal column every plan starts with. Skill Goals and Habits are
  // opt-in — a coach adds either one only when it's relevant to that athlete, rather than every
  // plan defaulting to three columns whether they're used or not.
  const OPTIONAL_GOAL_COLUMNS = [
    { key: "skill", label: "Skill Goals", placeholder: "e.g. Develop a usable changeup — press Enter" },
    { key: "habits", label: "Habits", placeholder: "e.g. Sleep 8+ hours a night — press Enter" },
  ];

  // Goals and the action plan live on the plan too, but older saved plans don't have them yet.
  // A missing key means that column was never added (an older plan that already had a non-null
  // skill array — even an empty one — keeps showing that column, so nothing already visible to a
  // coach disappears because of this change).
  const goalsOf = (plan) => {
    const g = (plan && plan.goals) || {};
    const out = { physical: g.physical || [] };
    OPTIONAL_GOAL_COLUMNS.forEach((c) => { if (g[c.key]) out[c.key] = g[c.key]; });
    return out;
  };
  const actionPlanOf = (plan) => plan.actionPlan || "";
  const hasGoalContent = (plan) => {
    const g = goalsOf(plan);
    return Object.keys(g).some((k) => g[k].length > 0) || actionPlanOf(plan).trim().length > 0;
  };

  // Automatic overview of the plan: dates, goals in priority order, then each timeline row's blocks.
  // Shown in the Action Plan until a coach edits it, which saves their own text instead.
  function planOverview(plan) {
    const paras = [];
    const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
    const joinList = (xs) => xs.length <= 2 ? xs.join(" and ") : `${xs.slice(0, -1).join(", ")}, and ${xs[xs.length - 1]}`;
    if (plan.blocks.length) {
      paras.push(`This offseason plan runs from ${fmtMD(plan.startDate)} to ${fmtMD(addDaysISO(plan.startDate, plan.weeks * 7 - 1))}, ${plural(plan.weeks, "week")} in total.`);
    }
    const g = goalsOf(plan);
    const goalCols = [["physical goals", g.physical], ...OPTIONAL_GOAL_COLUMNS.filter((c) => g[c.key]).map((c) => [c.label.toLowerCase(), g[c.key]])];
    goalCols.forEach(([title, items]) => {
      if (!items.length) return;
      const texts = items.map((x) => `${x.text}${x.done ? " (achieved)" : ""}`);
      paras.push(`The ${title}, in priority order, ${items.length === 1 ? "is" : "are"} ${joinList(texts)}.`);
    });
    const wk = (b) => `${b.len > 1 ? "weeks" : "week"} ${b.start + 1}${b.len > 1 ? `–${b.start + b.len}` : ""}`;
    plan.lanes.forEach((lane) => {
      const bs = plan.blocks.filter((b) => b.lane === lane.id).sort((a, b) => a.start - b.start);
      if (!bs.length) return;
      paras.push(`Under ${lane.name.toLowerCase()}, the plan moves through ${joinList(bs.map((b) => `${b.label || "Untitled"} (${wk(b)})`))}.`);
    });
    return paras.join("\n\n");
  }
  const actionPlanText = (plan) => actionPlanOf(plan).trim() ? actionPlanOf(plan) : planOverview(plan);

  // Opening sentence of the Action Plan, built from the athlete's off-season facility / contact.
  // It sits above the text rather than inside it, so it always matches the profile and isn't saved with edits.
  const offseasonLead = (athlete) => {
    const facility = ((athlete && athlete.offseasonFacility) || "").trim().replace(/\.$/, "");
    if (!facility) return "";
    const first = ((athlete && athlete.name) || "").trim().split(/\s+/)[0];
    return `This off-season, ${first} will be training at ${facility}.`;
  };

  // Lay out blocks that overlap within a lane on separate stacked rows.
  function packRows(blocks) {
    const sorted = [...blocks].sort((a, b) => a.start - b.start || b.len - a.len);
    const rowEnds = [];
    const rows = {};
    sorted.forEach((b) => {
      let r = rowEnds.findIndex((end) => end <= b.start);
      if (r === -1) { r = rowEnds.length; rowEnds.push(0); }
      rowEnds[r] = b.start + b.len;
      rows[b.id] = r;
    });
    return { rows, count: Math.max(1, rowEnds.length) };
  }

  const maxEnd = (blocks) => blocks.reduce((m, b) => Math.max(m, b.start + b.len), 0);

  // ---- progress: where is the athlete in the plan right now? ---------------------------------
  // week = 0 before the start date, 1..weeks while the plan is running, and `complete` after it ends.
  function planProgress(plan, today = new Date()) {
    const start = parseISO(plan.startDate);
    const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const days = Math.round((t0 - start) / 864e5);
    const totalDays = plan.weeks * 7;
    if (days < 0) return { state: "upcoming", week: 0, days, daysUntil: -days, pct: 0 };
    if (days >= totalDays) return { state: "complete", week: plan.weeks, days, pct: 100 };
    return { state: "active", week: Math.floor(days / 7) + 1, days, pct: (days / totalDays) * 100 };
  }

  // Blocks (with their row) covering the current week — what the athlete should be doing right now.
  function activeBlocksNow(plan, progress) {
    if (progress.state !== "active") return [];
    const wk = progress.week - 1;
    return plan.blocks
      .filter((b) => b.start <= wk && wk < b.start + b.len)
      .map((b) => ({ block: b, lane: plan.lanes.find((l) => l.id === b.lane) }))
      .filter((x) => x.lane)
      .sort((a, b) => plan.lanes.indexOf(a.lane) - plan.lanes.indexOf(b.lane));
  }

  const blockColorIn = (plan, b) => b.color || ((plan.lanes.find((l) => l.id === b.lane) || {}).color) || PALETTE[7];

  // ---- programs attached to blocks (programs are built on the Programs tab) ---------------------
  const allPrograms = () => (window.AthleteStore.allPrograms ? window.AthleteStore.allPrograms() : []);
  const programById = (id) => (id ? allPrograms().find((p) => p.id === id) : null) || null;

  // Program weeks in play during one plan week. Week 1 of the program lines up with the block's first
  // week; a program shorter than its block starts over from its first week.
  function programWeeksAt(plan, weekIdx) {
    return plan.blocks
      .filter((b) => b.programId && b.start <= weekIdx && weekIdx < b.start + b.len)
      .map((b) => {
        const program = (plan._lookup || programById)(b.programId);
        const lane = plan.lanes.find((l) => l.id === b.lane);
        if (!program || !lane || !(program.weeks || []).length) return null;
        const n = (weekIdx - b.start) % program.weeks.length;
        return { block: b, lane, program, week: program.weeks[n], weekNo: n + 1 };
      })
      .filter(Boolean)
      .sort((a, b) => plan.lanes.indexOf(a.lane) - plan.lanes.indexOf(b.lane));
  }

  // Superset labels, the prescription helpers and the estimated-max logic are shared with the athlete phone page
  // (see program_rx.js).
  const exerciseLabels = window.exerciseLabels;
  const ProgramRx = window.ProgramRx;
  const planMaxes = (plan) => window.planMaxes(plan, plan._lookup || programById);

  // One program week: a table of exercises per session. With `onLog`, each set group gets a box for the weight
  // the athlete actually used (`log` holds what's been entered so far).
  // Failure sets (BM / TF) also get a box for the reps reached and show the 1RM estimated from them. With `maxes`
  // (see planMaxes) and `planWeek` (the plan week this program week falls on), % sets of an exercise that has an
  // earlier estimated max are filled in with the weight worked out from it. A filled-in weight stays automatic,
  // and follows later failure sets, until someone types over it.
  function ProgramWeekView({ week, log, onLog, maxes, planWeek, onUndo }) {
    const logged = (key) => (log || {})[key] || "";
    const save = (key, auto) => (ev) => {
      const v = ev.target.value.trim();
      if (!logged(key) && auto && v === `${auto}`) return; // untouched automatic weight: nothing to keep
      if (v !== logged(key)) onLog(key, v);
    };
    return (
      <div className="program-view">
        {(week.sessions || []).map((s, si) => {
          const rows = (s.exercises || []).filter((e) => (e.name || "").trim());
          const labels = exerciseLabels(rows);
          return (
            <div className="program-view-session" key={si}>
              <h4>{s.name || `Session ${si + 1}`}</h4>
              {(s.warmup || "").trim() && <div className="program-view-warmup"><strong>Warm-up:</strong> {s.warmup}</div>}
              {rows.length === 0 ? <div className="program-view-empty">No exercises entered.</div> : (
                <table className="program-view-table">
                  <thead><tr><th>Exercise</th><th>{onLog ? "Sets, reps and weight used" : "Sets and reps"}</th><th>Rest</th><th>Notes</th></tr></thead>
                  <tbody>
                    {rows.map((e, ei) => (
                      <tr key={e.id || ei} className={ei > 0 && e.linked ? "superset-linked" : ""}>
                        <td>
                          <strong className="superset-label">{labels[ei]}</strong>{" "}
                          {window.AthleteStore.findExerciseByName && window.AthleteStore.findExerciseByName(e.name) && window.openExercise
                            ? <button className="exercise-link" title="View this exercise" onClick={() => window.openExercise(e.name)}>{e.name}</button>
                            : e.name}
                          {e.tempo && <span className="program-tempo" title="Tempo: eccentric, pause, concentric (* = explosive)">{e.tempo}</span>}
                          {/* the athlete changed this exercise, or its sets and reps, on their phone */}
                          {e._coach && (
                            <div className="program-changed">
                              Changed by athlete. Coach: {e._coach.name}{e._coach.text ? `, ${e._coach.text}` : ""}
                              {onUndo && <button className="btn-link" onClick={() => onUndo(e.id)}>Undo</button>}
                            </div>
                          )}
                        </td>
                        <td>
                          <div className="program-rx">
                            {ProgramRx.groups(e).map((g, gi) => {
                              const fail = ProgramRx.failure(g);
                              const wKey = ProgramRx.logKey(e, gi), rKey = ProgramRx.repsLogKey(e, gi);
                              const max = maxes && planWeek != null ? maxes.before(e.name, planWeek, si) : null;
                              const suggest = max && ProgramRx.normalize(e).intensityUnit === "%" ? ProgramRx.weightAt(max.value, g) : null;
                              const auto = onLog && suggest && !logged(wKey) ? suggest : null;
                              const usedWeight = logged(wKey) || (auto ? `${auto}` : "");
                              const est = fail ? ProgramRx.estimate1RM(usedWeight, logged(rKey)) : null;
                              return (
                                <span className={`program-rx-group ${fail ? "failure" : ""}`} key={gi}>
                                  <span className="program-rx-reps" title={fail ? `${fail.kind === "BM" ? "Beast Mode" : "Technical Failure"}${fail.each ? ", each side" : ""}: go to failure` : undefined}>{ProgramRx.repsText(g)}</span>
                                  {onLog && (
                                    <span className="program-rx-inputs">
                                      <input
                                        className={`program-rx-weight ${auto ? "auto" : ""}`}
                                        key={logged(wKey) || `a${auto || ""}`}
                                        defaultValue={logged(wKey) || (auto ? `${auto}` : "")}
                                        placeholder="wt"
                                        title={suggest ? (max.tm ? `${suggest} is ${ProgramRx.intensityText(e, g)} of an initial training max of ${max.value} (${max.weight} at ${max.pct}%), until a BM or TF set gives an estimated max. Type over it to change.` : `${suggest} is ${ProgramRx.intensityText(e, g)} of an estimated ${max.value} max (${max.weight} x ${max.reps}). Type over it to change.`) : undefined}
                                        aria-label="Weight used"
                                        onKeyDown={(ev) => ev.stopPropagation()}
                                        onBlur={save(wKey, auto)}
                                      />
                                      {fail && (
                                        <input
                                          className="program-rx-weight program-rx-got"
                                          key={`r${logged(rKey)}`}
                                          defaultValue={logged(rKey)}
                                          placeholder="reps"
                                          aria-label={`Reps reached${fail.each ? " each side" : ""}`}
                                          onKeyDown={(ev) => ev.stopPropagation()}
                                          onBlur={save(rKey)}
                                        />
                                      )}
                                    </span>
                                  )}
                                  {/* the prescribed intensity sits under the weight box, as on the training sheets */}
                                  {ProgramRx.intensityText(e, g) && <span className="program-rx-pct">{ProgramRx.intensityText(e, g)}</span>}
                                  {est && <span className="program-rx-est" title={`${usedWeight} x ${logged(rKey)} to failure`}>Est. 1RM {est}</span>}
                                </span>
                              );
                            })}
                            {ProgramRx.groups(e).length === 0 && "—"}
                          </div>
                        </td>
                        <td>{[e.rest, ProgramRx.extrasText(e), ProgramRx.tagText(e)].filter(Boolean).join(" · ") || "—"}</td>
                        <td>{e.notes || ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  // The whole program in a pop-up, opened by clicking into a block that has one linked.
  // `currentNo` (1-based) marks the program week the athlete is on right now, when there is one.
  function ProgramModal({ program, currentNo, onClose, athlete, log, onLog, maxes, startWeek }) {
    // Same one-page PDF as the program builder's export, with this athlete's name (and the Cubs logo for Cubs-only athletes).
    const exportPdf = async () => {
      const name = athlete ? athlete.name : "";
      const cubs = !!athlete && !!window.isCubsOnlyAthlete && window.isCubsOnlyAthlete(athlete);
      await window.openProgramPdf(program, name, cubs);
    };
    useEffect(() => {
      const onKey = (e) => { if (e.key === "Escape") onClose(); };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }, []);
    return ReactDOM.createPortal(
      <div className="zoom-overlay program-modal-overlay" onClick={onClose}>
        <div className="zoom-modal program-modal" onClick={(e) => e.stopPropagation()}>
          <button className="zoom-close" onClick={onClose} aria-label="Close">×</button>
          <h2>{program.name}</h2>
          {window.buildProgramPdf && <button className="btn program-modal-pdf" onClick={exportPdf}>Print / Save PDF{athlete ? ` for ${athlete.name}` : ""}</button>}
          {program.description && <p className="program-modal-desc">{program.description}</p>}
          {(program.weeks || []).map((w, wi) => (
            <div className={`program-modal-week ${currentNo === wi + 1 ? "current" : ""}`} key={wi}>
              <h3>{w.name || `Week ${wi + 1}`}{currentNo === wi + 1 && <small>This week</small>}</h3>
              <ProgramWeekView week={w} log={log} onLog={onLog} maxes={maxes} planWeek={startWeek != null ? startWeek + wi : undefined} />
            </div>
          ))}
          {!(program.weeks || []).length && <div className="program-view-empty">This program has no weeks yet.</div>}
        </div>
      </div>,
      document.body
    );
  }

  // Which week of its program a block is on today (1-based), or null when the plan isn't on that block now.
  function currentProgramWeek(plan, block, program) {
    const p = planProgress(plan);
    const n = (program.weeks || []).length;
    if (p.state !== "active" || !n) return null;
    const wk = p.week - 1;
    if (wk < block.start || wk >= block.start + block.len) return null;
    return ((wk - block.start) % n) + 1;
  }

  // Puts a program on an athlete's periodization chart as a block starting the week of `startDate`, one week
  // per program week, in the row named `laneName` (added if the plan doesn't have it). An athlete with no plan
  // gets a new one starting that week; a plan that starts later is extended back to that week.
  // Returns "added", "created" (new plan), "already" (this program is already on the chart) or "out-of-range".
  function assignProgram(athleteId, program, { startDate, laneName }) {
    const store = window.AthleteStore;
    const existing = store.getPeriodization(athleteId);
    const plan = existing ? JSON.parse(JSON.stringify(existing)) : { ...newPlan(), startDate };
    if (plan.blocks.some((b) => b.programId === program.id)) return "already";
    let start = Math.floor(Math.round((parseISO(startDate) - parseISO(plan.startDate)) / 864e5) / 7);
    if (start < 0) {
      const shift = -start;
      plan.startDate = addDaysISO(plan.startDate, -shift * 7);
      plan.blocks.forEach((b) => { b.start += shift; });
      plan.weeks += shift;
      start = 0;
    }
    if (start >= MAX_WEEKS) return "out-of-range";
    // no row named: the program's own kind of row (Speed, Throwing, Re-Education, Strength; window.programLaneName)
    const name = (laneName || "").trim() || window.programLaneName(program, plan.lanes.map((l) => l.name));
    let lane = plan.lanes.find((l) => l.name.toLowerCase() === name.toLowerCase());
    if (!lane) { lane = { id: uid(), name, color: PALETTE[plan.lanes.length % PALETTE.length] }; plan.lanes.push(lane); }
    const len = Math.min(Math.max(1, (program.weeks || []).length), MAX_WEEKS - start);
    // assignedBy: the coach to email if this athlete (when remote) turns out not to have the equipment for it
    plan.blocks.push({ id: uid(), lane: lane.id, start, len, label: program.name, notes: "", color: null, programId: program.id, assignedBy: window.AthleteStore.currentUserEmail() });
    plan.weeks = clamp(Math.max(plan.weeks, start + len), 1, MAX_WEEKS);
    plan.blocks = plan.blocks.filter((b) => b.start < MAX_WEEKS);
    store.setPeriodization(athleteId, plan);
    return existing ? "added" : "created";
  }

  // ---- each block and its program kept in step ----------------------------------------------------------
  // A block on the chart is one program of the athlete's workbook. Its text is the program's name (with the
  // athlete's last name in front, "Supak - Strength Ph.1") and its length is the program's number of weeks: change
  // either one and the other follows. Shared library programs are never changed from an athlete's plan; the first
  // change makes the athlete's own copy and moves what they logged against the shared one across to it.
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const lastNameFor = (athlete) => (window.ProgramBuilderKit ? window.ProgramBuilderKit.athleteLastName(athlete.name || "") : "") || "";
  const nameFor = (athlete, n) => {
    const last = lastNameFor(athlete), clean = (n || "").trim();
    return !last || clean.toLowerCase().startsWith(last.toLowerCase()) ? clean : `${last} - ${clean}`;
  };
  // the program name as the block shows it: without an athlete's last name in front
  const blockLabelFor = (athlete, n) => {
    const last = lastNameFor(athlete);
    return last ? (n || "").replace(new RegExp(`^${escRe(last)}\\s*-\\s*`, "i"), "").trim() : (n || "").trim();
  };
  const isOwnProgram = (program, athlete) => !!program && String(program.athleteId) === String(athlete.id);
  const freshExerciseId = () => `ex-${Math.random().toString(36).slice(2, 9)}`;
  // a deep copy of some weeks with new exercise ids (for a new program, so nothing logged elsewhere matches it)
  const cloneWeeks = (weeks) => JSON.parse(JSON.stringify(weeks || [])).map((w) => ({ ...w, sessions: (w.sessions || []).map((s) => ({ ...s, exercises: (s.exercises || []).map((e) => ({ ...e, id: freshExerciseId() })) })) }));
  // `weeks` made `len` long: added weeks copy the last one (new exercise ids, "Week n" renumbered), cut weeks dropped
  function weeksToLength(weeks, len) {
    const out = (weeks || []).slice(0, len);
    if (!out.length) out.push(window.ProgramBuilderKit.newWeek(1));
    while (out.length < len) {
      const copy = cloneWeeks([out[out.length - 1]])[0];
      copy.name = /^week\s*\d+/i.test(copy.name || "") ? copy.name.replace(/^week\s*\d+/i, `Week ${out.length + 1}`) : `Week ${out.length + 1}`;
      out.push(copy);
    }
    return out;
  }
  // whether anything is logged in program weeks `from` (0-based) onward, for this athlete
  function loggedFrom(athleteId, plan, program, from) {
    const log = window.AthleteStore.programLogFor(athleteId, plan)[program.id] || {};
    const keys = Object.keys(log).filter((k) => log[k]);
    if (!keys.length) return false;
    const ids = new Set();
    (program.weeks || []).slice(from).forEach((w) => (w.sessions || []).forEach((s) => (s.exercises || []).forEach((e) => ids.add(String(e.id)))));
    return keys.some((k) => ids.has(k.split("|")[0]) || Number((/^session-(\d+)-/.exec(k) || [])[1]) >= from);
  }
  // Saves `changes` to a block's program: in place when it is the athlete's own and used by no other block,
  // otherwise as the athlete's own copy (their log and phone changes carried across). Returns the saved program.
  function saveForBlock(athlete, plan, block, program, changes) {
    const store = window.AthleteStore;
    const sharedHere = plan.blocks.some((b) => b.id !== block.id && b.programId === program.id);
    if (isOwnProgram(program, athlete) && !sharedHere) return store.saveProgram({ ...program, ...changes });
    const { id, ...rest } = program;
    const saved = store.saveProgram({ ...rest, name: nameFor(athlete, program.name), ...changes, athleteId: athlete.id, basedOn: program.id, folder: program.folder || "" });
    store.carryAthleteRecords(athlete.id, program.id, saved.id, plan);
    return saved;
  }
  // Later blocks in the same row that a block now runs into (and didn't before) slide right to the next open
  // week, each pushing the next in turn. `before` is the block as it was. Returns the new list of blocks.
  function pushLaterBlocks(blocks, block, before) {
    const out = blocks.map((b) => ({ ...b }));
    const later = out.filter((b) => b.lane === block.lane && b.id !== block.id && b.start >= block.start)
      .filter((b) => !before || b.start >= before.start + before.len) // already overlapping on purpose: left alone
      .sort((a, b) => a.start - b.start);
    let end = block.start + block.len;
    later.forEach((b) => { if (b.start < end) b.start = end; end = Math.max(end, b.start + b.len); });
    return out;
  }

  // The week at a glance: every block running in one plan week side by side, one column per row of the chart
  // (Strength, Speed, Correctives, Throwing…), lined up by day number. Day 1 is usually a Monday but programs
  // needn't agree, so days are matched by number; a day's own name (a throwing day's weekday, say) shows in its
  // cell. A column heading opens that block's tab in the builder.
  function CombinedWeek({ plan, onOpen }) {
    const p = planProgress(plan);
    const [wk, setWk] = useState(p.state === "active" ? p.week - 1 : 0);
    const laneAt = (b) => plan.lanes.findIndex((l) => l.id === b.lane);
    const cols = plan.blocks.filter((b) => b.start <= wk && wk < b.start + b.len)
      .sort((a, b) => laneAt(a) - laneAt(b) || a.start - b.start)
      .map((b) => {
        const lane = plan.lanes.find((l) => l.id === b.lane) || { name: "Other" };
        const program = programById(b.programId);
        const n = program && (program.weeks || []).length ? (wk - b.start) % program.weeks.length : null;
        return { b, lane, program, week: n == null ? null : program.weeks[n], weekNo: n == null ? null : n + 1 };
      });
    const days = Math.max(0, ...cols.map((c) => (c.week ? (c.week.sessions || []).length : 0)));
    const monday = parseISO(plan.startDate); monday.setDate(monday.getDate() + wk * 7);
    const fmt = (d) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const sunday = new Date(monday); sunday.setDate(sunday.getDate() + 6);
    return (
      <div className="ppt-combined">
        <div className="ppt-combined-bar">
          <button className="btn btn-secondary" disabled={wk <= 0} onClick={() => setWk(wk - 1)} aria-label="Previous week">‹</button>
          <strong>Week {wk + 1} of {plan.weeks}</strong>
          <small>{fmt(monday)} – {fmt(sunday)}{p.state === "active" && wk === p.week - 1 ? " · this week" : ""}</small>
          <button className="btn btn-secondary" disabled={wk >= plan.weeks - 1} onClick={() => setWk(wk + 1)} aria-label="Next week">›</button>
        </div>
        {!cols.length ? <div className="facility-note">Nothing is scheduled in week {wk + 1}.</div> : (
          <div className="ppt-combined-scroll">
            <div className="ppt-combined-grid" style={{ gridTemplateColumns: `64px repeat(${cols.length}, minmax(190px, 1fr))` }}>
              <div />
              {cols.map((c) => (
                <button key={c.b.id} className="ppt-combined-head" style={{ borderTopColor: blockColorIn(plan, c.b) }} title="Open this program in the builder" onClick={() => onOpen(c.b)}>
                  <strong>{c.lane.name}</strong>
                  <span>{c.b.label || "Untitled"}</span>
                  <small>{c.program ? `program week ${c.weekNo} of ${c.program.weeks.length}` : "no program yet"}</small>
                </button>
              ))}
              {Array.from({ length: days }, (_, di) => (
                <React.Fragment key={di}>
                  <div className="ppt-combined-day">Day {di + 1}</div>
                  {cols.map((c) => {
                    const s = c.week && (c.week.sessions || [])[di];
                    const named = s ? (s.exercises || []).filter((e) => (e.name || "").trim()) : [];
                    const labels = exerciseLabels(named);
                    return (
                      <div key={c.b.id} className="ppt-combined-cell">
                        {s && <div className="ppt-combined-sname">{s.name || `Day ${di + 1}`}</div>}
                        {named.map((e, i) => (
                          <div key={e.id || i} className="ppt-combined-ex">
                            <b>{labels[i]}</b> {e.name}
                            <small>{[ProgramRx.groups(e).map((g) => ProgramRx.groupText(e, g)).filter(Boolean).join(", "), e.tempo ? `Tempo ${e.tempo}` : "", e.rest ? `Rest ${e.rest}` : "", ProgramRx.extrasText(e)].filter(Boolean).join(" · ")}</small>
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </React.Fragment>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // A search box for picking a saved program: type to narrow the list of program names, pick one, and `onPick` gets
  // the program. Black (white in light mode) with a magnifying glass, like the builder's other boxes.
  function ProgramSearch({ onPick, placeholder = "Insert existing program" }) {
    const [text, setText] = useState("");
    const listId = useMemo(() => `program-search-${Math.random().toString(36).slice(2, 8)}`, []);
    const programs = allPrograms().filter((p) => !window.isSentProgram(p.id)); // not the sessions sent to single athletes
    const pick = (value) => {
      const p = programs.find((x) => (x.name || "").trim().toLowerCase() === value.trim().toLowerCase());
      if (!p) return false;
      setText("");
      onPick(p);
      return true;
    };
    return (
      <span className="program-search">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>
        <input
          list={listId} value={text} placeholder={placeholder} aria-label={placeholder}
          onChange={(e) => { const v = e.target.value; if (!pick(v)) setText(v); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (!pick(text)) { const first = programs.find((x) => (x.name || "").toLowerCase().includes(text.trim().toLowerCase())); if (first && text.trim()) { setText(""); onPick(first); } } } }}
        />
        <datalist id={listId}>{programs.map((p) => <option key={p.id} value={p.name} />)}</datalist>
      </span>
    );
  }

  // Changes made in the app (an exercise swapped, or its sets and reps changed, by the athlete on their phone or by a
  // coach in Coach Mode) are kept apart from the program (athlete_overrides). When the block's program is opened in
  // the builder they are folded into it, as the athlete's own copy when the program is a shared one, and cleared from
  // the app's list, so the builder shows what the athlete actually does and stays the one place it is written.
  function AppChangesSync({ athlete, plan, block, program, isBusy, onLinkProgram, onMerged }) {
    useEffect(() => {
      let live = true;
      const store = window.AthleteStore;
      const fold = () => {
        if (!live || (isBusy && isBusy())) return; // not while the builder has unsaved typing (it would save over the change)
        const current = programById(program.id);
        if (!current) return;
        const ov = store.overridesFor(athlete.id)[current.id] || {};
        const ids = Object.keys(ov).filter((id) => ov[id] && `${ov[id].name || ""}`.trim());
        if (!ids.length) return;
        const weeks = (window.applyOverrides(current, ov).weeks || []).map((w) => ({
          ...w, sessions: (w.sessions || []).map((s) => ({ ...s, exercises: (s.exercises || []).map(({ _coach, ...e }) => e) })),
        }));
        const saved = saveForBlock(athlete, plan, block, current, { weeks });
        ids.forEach((id) => {
          store.removeAthleteOverride(athlete.id, current.id, id);
          if (saved.id !== current.id) store.removeAthleteOverride(athlete.id, saved.id, id); // copied across with the log
        });
        if (saved.id !== current.id) onLinkProgram(block.id, saved.id);
        onMerged(ids.length);
      };
      // pick up anything changed on a phone since the dashboard loaded, then fold it in
      Promise.resolve(store.refreshAthleteLogs ? store.refreshAthleteLogs(athlete.id) : null).catch(() => {}).then(fold);
      return () => { live = false; };
    }, [block.id, program.id]); // eslint-disable-line
    return null;
  }

  // Programs by section, inside an athlete's periodization. Each row of the chart (Phase, Running, Strength,
  // Correctives, Throwing…) is a section; its blocks, in order, are the tabs. A tab opens that block's program,
  // or the program builder to make one. Anything built or changed here is saved to the Programs list as the
  // athlete's own program, named with their last name in front, and linked to the block.
  // The panel is the program builder itself: the open tab's program is always editable, like a sheet with one
  // tab per block. `nav` ({ laneId, blockId }) and `dirty` are held by the board, so clicking a row name or a
  // block's Program button on the chart can jump straight to that program.
  function PlanProgramTabs({ plan, athlete, onLinkProgram, nav, onNav, dirty, setDirty, panelRef, extRev = 0 }) {
    const kit = window.ProgramBuilderKit;
    const store = window.AthleteStore;
    const lanes = plan.lanes.filter((l) => plan.blocks.some((b) => b.lane === l.id));
    const [rev, setRev] = useState(0); // bumped to reload the builder from what's saved
    const [indivFor, setIndivFor] = useState(null); // block whose program is open in the Individualize screen
    const [weekView, setWeekView] = useState(false); // the week at a glance, above the builder
    const [appNote, setAppNote] = useState(""); // says so when changes made in the app were folded into the program
    const dirtyRef = useRef(dirty);
    dirtyRef.current = dirty;
    const [printNote, setPrintNote] = useState("");
    if (!kit || !lanes.length) return null;
    // Print all: every program on the plan in one PDF, row by row (in the chart's order) and phase by phase
    const printAll = async () => {
      const laneAt = (b) => plan.lanes.findIndex((l) => l.id === b.lane);
      const seen = new Set();
      const list = plan.blocks.filter((b) => programById(b.programId)).sort((a, b) => laneAt(a) - laneAt(b) || a.start - b.start)
        .map((b) => programById(b.programId)).filter((x) => !seen.has(x.id) && seen.add(x.id));
      if (!list.length) { setPrintNote("No programs on this plan yet."); return; }
      setPrintNote("Building the PDF…");
      try {
        const cubs = !!window.isCubsOnlyAthlete && window.isCubsOnlyAthlete(athlete);
        const r = await window.openProgramsPdf(list, athlete.name, cubs, `${athlete.name} - All phases`);
        setPrintNote(`${r.programs} program${r.programs === 1 ? "" : "s"} on ${r.pages} page${r.pages === 1 ? "" : "s"}${dirty ? ". Unsaved changes in the builder aren't included." : "."}`);
      } catch (e) { setPrintNote("Could not build the PDF. Try again."); }
    };

    const p = planProgress(plan);
    const wk = p.state === "active" ? p.week - 1 : null;
    const lane = lanes.find((l) => l.id === nav.laneId) || lanes.find((l) => /strength/i.test(l.name)) || lanes[0];
    const blocks = plan.blocks.filter((b) => b.lane === lane.id).sort((a, b) => a.start - b.start);
    const isNow = (b) => wk != null && b.start <= wk && wk < b.start + b.len;
    const block = blocks.find((b) => b.id === nav.blockId) || blocks.find(isNow) || blocks[0];
    const program = block ? programById(block.programId) : null;
    const weeksText = (b) => `Wk ${b.start + 1}${b.len > 1 ? `–${b.start + b.len}` : ""}`;

    const last = kit.athleteLastName(athlete.name);
    const withLast = (n) => ((n || "").toLowerCase().startsWith(last.toLowerCase()) ? n : `${last} - ${n}`);
    const own = !!program && String(program.athleteId) === String(athlete.id);

    const save = (rec) => {
      const next = { ...rec, name: withLast(rec.name), athleteId: athlete.id, folder: (program && program.folder) || "" };
      // a shared program is never changed from here: the athlete gets their own copy instead
      if (!own) { delete next.id; if (program) next.basedOn = program.id; }
      const saved = store.saveProgram(next);
      if (program && saved.id !== program.id) store.carryAthleteRecords(athlete.id, program.id, saved.id, plan); // what they logged moves to their copy
      // the block follows the program: its name, and a week on the chart for each program week
      onLinkProgram(block.id, saved.id);
      setDirty(false);
      setRev((r) => r + 1);
    };
    // The builder saving itself as it is edited (see autoSave in ProgramEditor): like save, but the builder stays as
    // it is, so typing carries on. `rec.id` is the program the builder last saved to (the block's own, or the shared
    // one it opened with, which gets copied for the athlete the first time).
    const autoSave = (rec) => {
      const current = rec.id ? programById(rec.id) : null;
      const next = { ...(current || {}), ...rec, name: withLast(rec.name), athleteId: athlete.id, folder: ((current || program || {}).folder) || "" };
      if (!isOwnProgram(current, athlete)) { delete next.id; if (current) next.basedOn = current.id; }
      const saved = store.saveProgram(next);
      if (current && saved.id !== current.id) store.carryAthleteRecords(athlete.id, current.id, saved.id, plan);
      onLinkProgram(block.id, saved.id);
      setDirty(false);
      return saved;
    };
    // A new program for this block that starts as a copy of the one on the block before it in this row, made as
    // long as this block, ready to edit ("Copy previous phase").
    const prevBlock = block ? blocks[blocks.indexOf(block) - 1] : null;
    const prevProgram = prevBlock ? programById(prevBlock.programId) : null;
    const copyPrevious = () => {
      if (!prevProgram || (dirty && !window.confirm("Copy the previous phase and lose your unsaved changes in the builder?"))) return;
      const label = (block.label || "").trim() || `${blockLabelFor(athlete, prevProgram.name)} (copy)`;
      const saved = store.saveProgram({
        name: nameFor(athlete, label), description: prevProgram.description || "", folder: prevProgram.folder || "", tags: prevProgram.tags || [],
        weeks: weeksToLength(cloneWeeks(prevProgram.weeks), block.len), athleteId: athlete.id, basedOn: prevProgram.id,
      });
      onLinkProgram(block.id, saved.id);
      setDirty(false);
      setRev((r) => r + 1);
    };
    // Insert existing program: a copy of a saved program becomes this phase's program, as the athlete's own, named
    // "Lastname - Program name" (another athlete's last name in front is dropped first). The block takes its name
    // and length. On a phase that already has a program, it replaces it after asking.
    const insertProgram = (src) => {
      if (!src) return;
      if (program && !window.confirm(`Replace “${program.name}” on ${block.label || "this phase"} with a copy of “${src.name}”?`)) return;
      const people = typeof getPeople === "function" ? getPeople() : getRoster();
      const owner = src.athleteId ? people.find((a) => String(a.id) === String(src.athleteId)) : null;
      const { id, ...rest } = src;
      const saved = store.saveProgram({ ...rest, name: nameFor(athlete, owner ? blockLabelFor(owner, src.name) : src.name), weeks: cloneWeeks(src.weeks), athleteId: athlete.id, basedOn: src.id, folder: src.folder || "" });
      onLinkProgram(block.id, saved.id);
      setDirty(false);
      setRev((r) => r + 1);
    };
    const reload = () => { setDirty(false); setRev((r) => r + 1); };
    // Equipment check (remote athletes): swaps one exercise for another everywhere in this block's program,
    // which is the whole phase, and saves it (as the athlete's own copy when the program is a shared one).
    const changeExercise = (from, to) => {
      if (dirty && !window.confirm("Replace the exercise and lose your unsaved changes in the builder?")) return;
      const same = (n) => (n || "").trim().toLowerCase() === from.trim().toLowerCase();
      save({ ...program, weeks: (program.weeks || []).map((w) => ({ ...w, sessions: (w.sessions || []).map((s) => ({ ...s, exercises: (s.exercises || []).map((e) => (same(e.name) ? { ...e, name: to } : e)) })) })) });
    };

    return (
      <div className="panel period-program-tabs no-print" ref={panelRef} tabIndex={-1}>
        <h2 className="ppt-title">
          <span>Programming Workbook</span>
          {/* the quick swap-exercises / sets-and-reps screen, available any time after a program is assigned */}
          {block && program && kit.ProgramIndividualize && indivFor !== block.id && (
            <button
              className="btn ppt-individualize"
              title="Swap exercises and adjust sets and reps for this athlete"
              onClick={() => { if (!dirty || window.confirm("Open Individualize and lose your unsaved changes in the builder?")) { setDirty(false); setIndivFor(block.id); } }}
            >
              Individualize
            </button>
          )}
          <button className={`btn btn-secondary ppt-weekview ${weekView ? "active" : ""}`} title="Every program running in one week, side by side" onClick={() => setWeekView((v) => !v)}>{weekView ? "Hide week view" : "Week view"}</button>
          {window.openProgramsPdf && <button className="btn btn-secondary ppt-printall" title="Every program on this plan in one PDF" onClick={printAll}>Print all</button>}
        </h2>
        <p className="ppt-intro">Every phase on the periodization timeline has its program here, one tab per phase: pick a row, then a phase. Build each one or start from a saved program, and changes save as you go. Week view shows everything running in a week side by side, and Print all exports every phase to one PDF.</p>
        {printNote && <div className="timestamp-note ppt-print-note">{printNote}</div>}
        {weekView && <CombinedWeek plan={plan} onOpen={(b) => { onNav({ laneId: b.lane, blockId: b.id }); setWeekView(false); }} />}
        <div className="pill-tabs ppt-sections">
          {lanes.map((l) => (
            <button key={l.id} className={`pill-tab ppt-section ${l.id === lane.id ? "active" : ""}`} style={{ "--tab-color": l.color || PALETTE[7] }} onClick={() => onNav({ laneId: l.id, blockId: null })}>
              <span className="ppt-dot" />{l.name}
            </button>
          ))}
        </div>
        {/* one tab per phase, in the block's own color; a phase with no program yet is outlined, still to build */}
        <div className="ppt-blocks" style={{ "--tab-line": lane.color || PALETTE[7] }}>
          {blocks.map((b, i) => {
            const has = !!programById(b.programId);
            return (
              <button key={b.id} className={`ppt-block ${block && b.id === block.id ? "active" : ""} ${isNow(b) ? "now" : ""} ${has ? "" : "empty"}`} style={{ "--tab-color": blockColorIn(plan, b) }} onClick={() => onNav({ laneId: lane.id, blockId: b.id })}>
                <span className="ppt-block-top"><span className="ppt-block-no">{i + 1}</span>{isNow(b) && <span className="ppt-now">Now</span>}</span>
                <strong>{b.label || "Untitled"}</strong>
                <small>{weeksText(b)} · {has ? "program" : "to build"}</small>
              </button>
            );
          })}
        </div>

        {block && program && indivFor === block.id && (
          <kit.ProgramIndividualize
            key={`${block.id}-${program.id}`}
            program={program}
            athlete={athlete}
            skipLink
            onDone={(saved) => {
              if (saved && saved.id !== program.id) { store.carryAthleteRecords(athlete.id, program.id, saved.id, plan); onLinkProgram(block.id, saved.id); }
              setIndivFor(null);
              setRev((r) => r + 1);
            }}
          />
        )}

        {block && indivFor !== block.id && (
          <div className="ppt-note">
            {!program && (
              <React.Fragment>
                <span>No program for <strong>{block.label || "this block"}</strong> yet. Build it below ({block.len} week{block.len === 1 ? "" : "s"}, to match the block), or</span>
                {prevProgram && <button className="btn btn-secondary" title={`Start from a copy of ${prevProgram.name}, then edit it`} onClick={copyPrevious}>Copy previous phase</button>}
                <ProgramSearch onPick={insertProgram} />
                {/* a suggestion only: what the program on the block before this one lists as its next phase */}
                {(() => {
                  const prev = blocks[blocks.indexOf(block) - 1];
                  const prevProgram = prev && programById(prev.programId);
                  const next = prevProgram && window.suggestedNextPrograms ? window.suggestedNextPrograms(prevProgram) : [];
                  if (!next.length) return null;
                  return (
                    <span className="ppt-suggest">
                      Suggested after {prevProgram.name}:
                      {next.map((x) => <button className="btn btn-secondary" key={x.id} onClick={() => insertProgram(x)}>Use “{x.name}”</button>)}
                    </span>
                  );
                })()}
              </React.Fragment>
            )}
            {program && !own && <span>Shared program. Saving here makes {athlete.name}'s own copy, “{withLast(program.name)}”, and leaves the shared one unchanged.</span>}
            {program && <ProgramSearch onPick={insertProgram} />}
            {program && <button className="btn-link" style={{ marginLeft: "auto" }} onClick={() => { if (!dirty || window.confirm("Unlink this program and lose your unsaved changes?")) { onLinkProgram(block.id, null); reload(); } }}>Unlink from this block</button>}
          </div>
        )}

        {/* changes made in the app (by the athlete or in Coach Mode) are folded into this program when it opens */}
        {block && program && <AppChangesSync key={`${block.id}-${program.id}`} athlete={athlete} plan={plan} block={block} program={program} isBusy={() => dirtyRef.current} onLinkProgram={onLinkProgram} onMerged={(n) => { setAppNote(`${n} change${n === 1 ? "" : "s"} made in the app (by ${athlete.name.split(" ")[0] || "the athlete"} or in Coach Mode) ${n === 1 ? "is" : "are"} now part of this program.`); setRev((r) => r + 1); }} />}
        {appNote && <div className="ppt-app-note">{appNote}</div>}
        {/* remote athletes only: exercises in this program that need equipment they don't have */}
        {block && program && indivFor !== block.id && window.EquipmentFlags && (
          <window.EquipmentFlags key={`eq-${program.id}-${rev}`} athlete={athlete} program={program} onChangeExercise={changeExercise} />
        )}

        {/* reloaded (rev) after a save from here or a program swapped in, and (extRev) when the timeline changes the program or an empty block; it saves itself as it is edited */}
        {block && indivFor !== block.id && (
          <kit.ProgramEditor
            key={`${block.id}-${rev}-${extRev}`}
            initial={(() => {
              // a Throwing row's program is a throwing program: the one built from the athlete's Throwing Progression is
              // laid out from it (its days named and colored from there), and a new one starts as a throwing program
              const tp = athlete.throwingProgression, Kit = window.SpeedKit;
              if (program && Kit && program.layout === "throwing" && tp && tp.programId === program.id) return Kit.syncWithProgression(program, tp);
              if (program) return program;
              if (Kit && /throw/i.test(lane.name || "")) {
                const fresh = Kit.newThrowingProgram(Math.max(1, block.len), 3);
                return { ...fresh, name: withLast(block.label || lane.name) };
              }
              // and a Re-Ed / Correctives row's starts as a re-education program (sections and series)
              if (Kit && Kit.newReedProgram && /re-?ed|correct/i.test(lane.name || "")) {
                const fresh = Kit.newReedProgram(Math.max(1, block.len), 3);
                return { ...fresh, name: withLast(block.label || lane.name) };
              }
              return { name: withLast(block.label || lane.name), description: "", weeks: weeksToLength([kit.newWeek(1)], block.len) };
            })()}
            onSave={save}
            autoSave={autoSave}
            pdfAthlete={athlete}
            onCancel={null}
            onDelete={null}
            onDirty={() => { if (!dirty) setDirty(true); }}
          />
        )}
      </div>
    );
  }

  // A plan with everything logged against its programs filled in (see programLogFor in store.js).
  // `_lookup` finds a program as this athlete does it, with any exercise or sets / reps changes they made on
  // their phone applied (see applyOverrides in program_rx.js).
  const withLogs = (plan, athleteId) => ({
    ...plan,
    programLog: window.AthleteStore.programLogFor(athleteId, plan),
    _lookup: (id) => window.applyOverrides(programById(id), window.AthleteStore.overridesFor(athleteId)[id]),
  });

  // The athlete's private link to their program on their phone (athlete.html): create it, copy it to text to
  // them, or reset / remove it. A Cubs-only player's link opens the page in Cubs colors with the Cubs logo.
  function AthletePhoneLink({ athlete }) {
    const S = window.AthleteStore;
    const [token, setToken] = useState(() => S.getAthleteLink(athlete.id));
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState("");
    useEffect(() => { setToken(S.getAthleteLink(athlete.id)); setNote(""); }, [athlete.id]);
    const cubs = !!window.isCubsOnlyAthlete && window.isCubsOnlyAthlete(athlete); // Cubs-only players get the Cubs look
    const staff = athlete.rosterGroup === "coaches"; // a coach's own link also offers a way into Coach Mode
    const params = [cubs ? "team=cubs" : "", staff ? "staff=1" : ""].filter(Boolean).join("&");
    const url = token ? `${window.location.origin}/athlete.html${params ? `?${params}` : ""}#${token}` : "";
    const make = async () => {
      setBusy(true);
      const t = await S.createAthleteLink(athlete.id, athlete.name);
      setBusy(false);
      if (t) { setToken(t); setNote(""); } else setNote("Could not save the link. Try again.");
    };
    const copy = async () => {
      try { await navigator.clipboard.writeText(url); setNote("Copied. Text it to the athlete."); }
      catch (e) { setNote("Select the link and copy it."); }
    };
    return (
      <div className="panel athlete-link no-print">
        <h2>Phone link <small>{athlete.name} opens their program and logs weights from this link, with no login</small></h2>
        {!token ? (
          <button className="btn" disabled={busy} onClick={make}>{busy ? "Creating…" : "Create phone link"}</button>
        ) : (
          <div className="athlete-link-row">
            <input readOnly value={url} aria-label="Athlete phone link" onFocus={(ev) => ev.target.select()} />
            <button className="btn" onClick={copy}>Copy</button>
            <a className="btn" href={url} target="_blank" rel="noopener">Open</a>
            <button className="btn" disabled={busy} onClick={() => { if (confirm("Make a new link? The old one will stop working.")) make(); }}>Reset</button>
            <button className="btn" disabled={busy} onClick={async () => { if (!confirm("Remove this athlete's phone link? It will stop working.")) return; setBusy(true); const ok = await S.removeAthleteLink(athlete.id); setBusy(false); if (ok) setToken(null); }}>Remove</button>
          </div>
        )}
        {note && <div className="athlete-link-note">{note}</div>}
      </div>
    );
  }

  // Automated one-paragraph "where are they now" caption, built from the plan and today's date:
  // current week, current phase (the block in the "Phase" row), what's next, and how much is left.
  function planCaption(plan, name) {
    const p = planProgress(plan);
    const who = (name || "").trim().split(/\s+/)[0] || "The athlete";
    const startTxt = fmtMD(plan.startDate);
    const endTxt = fmtMD(addDaysISO(plan.startDate, plan.weeks * 7 - 1));
    const phaseLane = plan.lanes.find((l) => /phase/i.test(l.name)) || null;
    const phases = phaseLane ? plan.blocks.filter((b) => b.lane === phaseLane.id).sort((a, b) => a.start - b.start) : [];
    const label = (b) => b.label || "Untitled";
    const weeksTxt = (b) => `week${b.len > 1 ? "s" : ""} ${b.start + 1}${b.len > 1 ? `–${b.start + b.len}` : ""}`;
    const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

    if (p.state === "upcoming") {
      let s = `${who}'s plan hasn't started yet — week 1 begins ${startTxt} (in ${plural(p.daysUntil, "day")}) and runs ${plural(plan.weeks, "week")} through ${endTxt}.`;
      const opener = phases.find((b) => b.start === 0);
      if (opener) s += ` It opens with the ${label(opener)} phase.`;
      return s;
    }
    if (p.state === "complete") {
      const lastPhase = phases.length ? phases[phases.length - 1] : null;
      return `${who} has completed all ${plural(plan.weeks, "week")} of the plan (${startTxt} – ${endTxt}).${lastPhase ? ` The final phase was ${label(lastPhase)}.` : ""}`;
    }

    const wk = p.week - 1; // 0-based index of the current week
    const cur = phases.filter((b) => b.start <= wk && wk < b.start + b.len).pop();
    let s = `${who} is in week ${p.week} of ${plan.weeks}`;
    if (cur) s += `, in the ${label(cur)} phase (${weeksTxt(cur)}; week ${wk - cur.start + 1} of ${cur.len} of the phase)`;
    s += ".";
    const next = phases.find((b) => b.start > wk);
    if (next) {
      const daysTo = next.start * 7 - p.days;
      s += ` Next up: ${label(next)}, starting ${fmtMD(addDaysISO(plan.startDate, next.start * 7))} (week ${next.start + 1}, in ${plural(daysTo, "day")}).`;
    } else if (cur) {
      s += ` This is the final phase, running through ${fmtMD(addDaysISO(plan.startDate, (cur.start + cur.len) * 7 - 1))}.`;
    }
    const left = plan.weeks - p.week;
    s += left > 0 ? ` ${plural(left, "week")} ${left === 1 ? "remains" : "remain"} (${Math.round(p.pct)}% of the plan complete).` : " This is the last week of the plan.";
    if (!cur) {
      const now = activeBlocksNow(plan, p);
      if (now.length) s += ` Current focus: ${now.map((x) => `${x.lane.name} – ${label(x.block)}`).join("; ")}.`;
    }
    return s;
  }

  // Segmented progress bar (one segment per week), an automated caption, and a "this week" summary.
  function PlanProgress({ plan, name }) {
    const p = planProgress(plan);
    const endDate = addDaysISO(plan.startDate, plan.weeks * 7 - 1);
    const now = activeBlocksNow(plan, p);
    let headline;
    if (p.state === "upcoming") headline = `Week 0 — starts ${fmtMD(plan.startDate)} (${p.daysUntil} day${p.daysUntil === 1 ? "" : "s"} away)`;
    else if (p.state === "complete") headline = `Complete — all ${plan.weeks} weeks done`;
    else headline = `Week ${p.week} of ${plan.weeks}`;
    return (
      <div className="period-progress">
        <div className="period-progress-top">
          <strong className="period-progress-week">{headline}</strong>
          <span className="period-progress-range">{fmtMD(plan.startDate)} – {fmtMD(endDate)}{p.state === "active" ? ` · ${Math.round(p.pct)}% through` : ""}</span>
        </div>
        <div className="period-progress-bar">
          {Array.from({ length: plan.weeks }, (_, i) => {
            const cls = p.state === "complete" || (p.state === "active" && i < p.week - 1) ? "done" : p.state === "active" && i === p.week - 1 ? "current" : "";
            return <span key={i} className={`period-seg ${cls}`} title={`Week ${i + 1} · ${fmtMD(addDaysISO(plan.startDate, i * 7))}`} />;
          })}
        </div>
        <p className="auto-caption">{planCaption(plan, name)}</p>
        {now.length > 0 && (
          <div className="period-now">
            <span className="period-now-title">This week:</span>
            {now.map(({ block, lane }) => (
              <span className="period-now-chip" key={block.id} title={block.notes || ""}>
                <i style={{ background: blockColorIn(plan, block) }} />
                {lane.name}: {block.label || "Untitled"}
              </span>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Read-only, fluid-width copy of the timeline for the player profile and team report.
  function ReadonlyTimeline({ plan, athlete }) {
    const p = planProgress(plan);
    const lanes = plan.lanes.filter((l) => plan.blocks.some((b) => b.lane === l.id));
    const pct = (weeks) => `${(weeks / plan.weeks) * 100}%`;
    const [openBlock, setOpenBlock] = useState(null); // block whose linked program is open in a pop-up
    const [, setLogTick] = useState(0);
    const opened = openBlock && plan.blocks.find((b) => b.id === openBlock);
    const openedProgram = opened && (athlete ? withLogs(plan, athlete.id)._lookup : programById)(opened.programId);
    const logPlan = athlete ? withLogs(plan, athlete.id) : plan;
    return (
      <div className="period-ro">
        {openedProgram && <ProgramModal program={openedProgram} athlete={athlete} maxes={planMaxes(logPlan)} startWeek={opened.start} log={(logPlan.programLog || {})[openedProgram.id] || {}} onLog={athlete ? (key, val) => {
          window.AthleteStore.setAthleteLog(athlete.id, openedProgram.id, key, val);
          setLogTick((n) => n + 1);
        } : undefined} currentNo={currentProgramWeek(plan, opened, openedProgram)} onClose={() => setOpenBlock(null)} />}
        <div className="period-ro-row period-ro-head">
          <div className="period-ro-label" />
          <div className="period-ro-track period-ro-weeks">
            {Array.from({ length: plan.weeks }, (_, i) => (
              <span key={i} className={p.state === "active" && p.week === i + 1 ? "now" : ""} title={`Week ${i + 1} · ${fmtMD(addDaysISO(plan.startDate, i * 7))}`}>{i + 1}</span>
            ))}
          </div>
        </div>
        {lanes.map((lane) => {
          const laneBlocks = plan.blocks.filter((b) => b.lane === lane.id);
          const { rows, count } = packRows(laneBlocks);
          return (
            <div className="period-ro-row" key={lane.id}>
              <div className="period-ro-label"><i style={{ background: lane.color }} />{lane.name}</div>
              <div className="period-ro-track" style={{ height: count * 26 + 6 }}>
                {p.state === "active" && <div className="period-ro-now" style={{ left: pct(p.week - 1), width: pct(1) }} />}
                {laneBlocks.map((b) => (
                  <div
                    key={b.id}
                    className="period-ro-block"
                    style={{ left: `calc(${pct(b.start)} + 1px)`, width: `calc(${pct(b.len)} - 2px)`, top: (rows[b.id] || 0) * 26 + 3, background: blockColorIn(plan, b) }}
                    title={`${b.label || "Untitled"} · Wk ${b.start + 1}${b.len > 1 ? `–${b.start + b.len}` : ""}${b.notes ? `\n${b.notes}` : ""}${programById(b.programId) ? "\nClick to open the program" : ""}`}
                    onClick={programById(b.programId) ? () => setOpenBlock(b.id) : undefined}
                    data-has-program={programById(b.programId) ? "1" : undefined}
                  >
                    {b.label || <em>Untitled</em>}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // ---- goals + action plan -------------------------------------------------------------------
  // One editable list of goals (type + Enter to add, tick to mark achieved, edit in place, x to remove).
  // Order = priority: drag the grip on the left of a goal to reorder; #1 is the top priority.
  function GoalList({ title, items, placeholder, onChange, onRemove }) {
    const [draft, setDraft] = useState("");
    const [order, setOrder] = useState(null); // ids in their live (mid-drag) order, or null when not dragging
    const rowRefs = useRef({});
    const dragRef = useRef(null);
    const itemsRef = useRef(items);
    const onChangeRef = useRef(onChange);
    itemsRef.current = items;
    onChangeRef.current = onChange;

    const add = () => {
      const t = draft.trim();
      if (!t) return;
      onChange([...items, { id: uid(), text: t, done: false }]);
      setDraft("");
    };

    // Reordering: pressing the grip starts a drag; as the pointer crosses other rows the dragged
    // goal swaps into that slot (live preview); releasing saves the new order.
    useEffect(() => {
      const onMove = (e) => {
        const d = dragRef.current;
        if (!d) return;
        const ids = d.order;
        let target = ids.length - 1;
        for (let i = 0; i < ids.length; i++) {
          const el = rowRefs.current[ids[i]];
          if (!el) continue;
          const r = el.getBoundingClientRect();
          if (e.clientY < r.top + r.height / 2) { target = i; break; }
        }
        const from = ids.indexOf(d.id);
        if (target === from) return;
        const next = ids.filter((id) => id !== d.id);
        next.splice(target, 0, d.id);
        d.order = next;
        setOrder(next);
      };
      const onUp = () => {
        const d = dragRef.current;
        dragRef.current = null;
        if (!d) return;
        const byId = {};
        itemsRef.current.forEach((g) => { byId[g.id] = g; });
        const reordered = d.order.map((id) => byId[id]).filter(Boolean);
        const changed = reordered.some((g, i) => g.id !== itemsRef.current[i].id);
        setOrder(null);
        if (changed) onChangeRef.current(reordered);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      return () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
    }, []);

    const startDrag = (e, id) => {
      if (e.button !== 0 || items.length < 2) return;
      e.preventDefault();
      const ids = items.map((g) => g.id);
      dragRef.current = { id, order: ids };
      setOrder(ids);
    };

    const shown = order ? order.map((id) => items.find((g) => g.id === id)).filter(Boolean) : items;
    const doneCount = items.filter((g) => g.done).length;
    return (
      <div className="goal-col">
        <h3>
          {title}{items.length > 0 && <small>{doneCount} of {items.length} achieved</small>}
          {onRemove && (
            <button
              type="button"
              className="btn-link no-print goal-col-remove"
              title={`Remove the ${title} column${items.length ? " (and its goals)" : ""}`}
              onClick={() => { if (!items.length || window.confirm(`Remove ${title}? This also deletes its ${items.length} goal${items.length === 1 ? "" : "s"}.`)) onRemove(); }}
            >
              Remove
            </button>
          )}
        </h3>
        {items.length > 0 ? (
          <div className="goal-body">
            <div className="priority-bracket" title="Drag goals up or down — the top goal is the highest priority"><span>Priority</span></div>
            <div className="goal-items">
              {shown.map((g, i) => (
                <div
                  className={`goal-item ${g.done ? "done" : ""} ${dragRef.current && dragRef.current.id === g.id ? "dragging" : ""}`}
                  key={g.id}
                  ref={(el) => { if (el) rowRefs.current[g.id] = el; else delete rowRefs.current[g.id]; }}
                >
                  <span
                    className={`goal-grip no-print ${items.length < 2 ? "disabled" : ""}`}
                    title={items.length < 2 ? "Add another goal to reorder" : "Drag to change priority"}
                    onPointerDown={(e) => startDrag(e, g.id)}
                  >⋮⋮</span>
                  <span className="goal-rank" title={`Priority ${i + 1}`}>{i + 1}</span>
                  <input type="checkbox" checked={!!g.done} title="Mark achieved" onChange={(e) => onChange(items.map((x) => (x.id === g.id ? { ...x, done: e.target.checked } : x)))} />
                  <input
                    className="goal-text"
                    key={g.id + g.text}
                    defaultValue={g.text}
                    onBlur={(e) => {
                      const t = e.target.value.trim();
                      if (!t) onChange(items.filter((x) => x.id !== g.id));
                      else if (t !== g.text) onChange(items.map((x) => (x.id === g.id ? { ...x, text: t } : x)));
                    }}
                    onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); e.stopPropagation(); }}
                  />
                  <button className="goal-x no-print" title="Remove goal" onClick={() => onChange(items.filter((x) => x.id !== g.id))}>×</button>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="goal-empty">No goals entered yet.</p>
        )}
        <div className="goal-add no-print">
          <input placeholder={placeholder} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); e.stopPropagation(); }} />
          <button className="btn btn-secondary" onClick={add} disabled={!draft.trim()}>Add</button>
        </div>
      </div>
    );
  }
  // Physical Goals is always there; Skill Goals and Habits are columns a coach can add (or
  // remove) as needed — see OPTIONAL_GOAL_COLUMNS. The coach's Action Plan sits underneath.
  function GoalsSection({ plan, onSave, lead }) {
    const goals = goalsOf(plan);
    const addColumn = (key) => onSave({ goals: { ...goals, [key]: [] } });
    const removeColumn = (key) => {
      const next = { ...goals };
      delete next[key];
      onSave({ goals: next });
    };
    const toAdd = OPTIONAL_GOAL_COLUMNS.filter((c) => !goals[c.key]);
    return (
      <React.Fragment>
        <div className="panel period-goals">
          <h2>Goals <small>What we're working toward this offseason</small></h2>
          <div className="goal-cols">
            <GoalList title="Physical Goals" items={goals.physical} placeholder="e.g. Add 8 lbs lean mass — press Enter" onChange={(list) => onSave({ goals: { ...goals, physical: list } })} />
            {OPTIONAL_GOAL_COLUMNS.map((c) => goals[c.key] && (
              <GoalList
                key={c.key}
                title={c.label}
                items={goals[c.key]}
                placeholder={c.placeholder}
                onChange={(list) => onSave({ goals: { ...goals, [c.key]: list } })}
                onRemove={() => removeColumn(c.key)}
              />
            ))}
          </div>
          {toAdd.length > 0 && (
            <div className="goal-add-col no-print">
              {toAdd.map((c) => (
                <button key={c.key} type="button" className="btn btn-secondary" onClick={() => addColumn(c.key)}>+ Add {c.label}</button>
              ))}
            </div>
          )}
        </div>
        <div className="panel period-action">
          <h2>
            Action Plan <small>{actionPlanOf(plan) ? "Your edited plan" : "Automatic overview of the timeline and goals — edit to make it your own"}</small>
            {actionPlanOf(plan) && (
              <button
                type="button"
                className="btn-link no-print goal-col-remove"
                title="Discard your edits and show the automatic overview again"
                onClick={() => { if (window.confirm("Replace your action plan with the automatic overview of the timeline and goals?")) onSave({ actionPlan: "" }); }}
              >
                Use automatic overview
              </button>
            )}
          </h2>
          {lead && <p className="action-lead">{lead}</p>}
          <textarea
            rows={8}
            key={actionPlanText(plan)}
            defaultValue={actionPlanText(plan)}
            placeholder="Describe how you'll address these goals..."
            onBlur={(e) => { if (e.target.value !== actionPlanOf(plan) && e.target.value !== planOverview(plan)) onSave({ actionPlan: e.target.value }); }}
            onKeyDown={(e) => e.stopPropagation()}
          />
        </div>
      </React.Fragment>
    );
  }

  // Read-only goals + action plan (profile / team report).
  function GoalsReadOnly({ plan, lead }) {
    const goals = goalsOf(plan);
    const list = (title, items) => items.length > 0 && (
      <div className="goal-col">
        <h3>{title}<small>{items.filter((g) => g.done).length} of {items.length} achieved</small></h3>
        <div className="goal-body">
          <div className="priority-bracket"><span>Priority</span></div>
          <div className="goal-items">
            {items.map((g, i) => (
              <div className={`goal-item ro ${g.done ? "done" : ""}`} key={g.id}>
                <span className="goal-rank">{i + 1}</span>
                <span className="goal-mark">{g.done ? "✓" : "○"}</span>
                <span className="goal-text-ro">{g.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
    const hasAnyGoals = Object.keys(goals).some((k) => goals[k].length > 0);
    return (
      <div className="period-goals-ro">
        {hasAnyGoals && (
          <div className="goal-cols">
            {list("Physical Goals", goals.physical)}
            {OPTIONAL_GOAL_COLUMNS.map((c) => goals[c.key] && <React.Fragment key={c.key}>{list(c.label, goals[c.key])}</React.Fragment>)}
          </div>
        )}
        {(lead || actionPlanText(plan).trim()) && (
          <div className="action-ro">
            <h3>Action Plan</h3>
            {lead && <p className="action-lead">{lead}</p>}
            {actionPlanText(plan).trim() && <div className="action-ro-text">{actionPlanText(plan)}</div>}
          </div>
        )}
      </div>
    );
  }

  // Saved plan for one athlete: progress bar + timeline + goals. Renders nothing if there's nothing saved.
  // `bare` returns just the contents (no card / title); `showGoals={false}` leaves out goals + action plan.
  function PeriodizationView({ athleteId, onEdit, compact = false, bare = false, showGoals = true }) {
    const plan = window.AthleteStore.getPeriodization(athleteId);
    const hasBlocks = !!plan && plan.blocks.length > 0;
    const goalsToShow = showGoals && !!plan && hasGoalContent(plan);
    if (!plan || (!hasBlocks && !goalsToShow)) return null;
    const body = (
      <React.Fragment>
        {hasBlocks && <PlanProgress plan={plan} name={(getPeople().find((a) => a.id === athleteId) || {}).name} />}
        {hasBlocks && <ReadonlyTimeline plan={plan} athlete={getPeople().find((a) => a.id === athleteId)} />}
        {goalsToShow && <GoalsReadOnly plan={plan} lead={offseasonLead(getPeople().find((a) => a.id === athleteId))} />}
      </React.Fragment>
    );
    if (bare) return body;
    if (compact) {
      return (
        <div className="period-view-compact">
          <div className="period-view-head">
            <strong>Offseason Periodization</strong>
            {onEdit && <button className="btn-link no-print" onClick={() => onEdit(athleteId)}>Edit plan &rarr;</button>}
          </div>
          {body}
        </div>
      );
    }
    return (
      <div className="panel">
        <h2>
          Offseason Periodization
          {onEdit && <button className="btn-link no-print" style={{ marginLeft: 12 }} onClick={() => onEdit(athleteId)}>Edit plan &rarr;</button>}
        </h2>
        {body}
      </div>
    );
  }

  // ---- clipboard (kept in memory and localStorage so it survives switching athletes/reloads) --
  let memoryClip = null;
  function getClipboard() {
    if (memoryClip) return memoryClip;
    try { const raw = localStorage.getItem(CLIP_KEY); if (raw) memoryClip = JSON.parse(raw); } catch (e) { /* ignore */ }
    return memoryClip;
  }
  function setClipboard(clip) {
    memoryClip = clip;
    try { localStorage.setItem(CLIP_KEY, JSON.stringify(clip)); } catch (e) { /* ignore */ }
  }

  // Build clipboard data from selected blocks (lanes are matched by name when pasting elsewhere).
  function makeClip(plan, blocks, fromName) {
    const minStart = Math.min(...blocks.map((b) => b.start));
    const laneColors = {};
    return {
      fromName,
      blocks: blocks.map((b) => {
        const lane = plan.lanes.find((l) => l.id === b.lane);
        const name = lane ? lane.name : "Other";
        if (lane) laneColors[name] = lane.color;
        return { laneName: name, relStart: b.start - minStart, len: b.len, label: b.label, notes: b.notes, color: b.color || null, programId: b.programId || null };
      }),
      laneColors,
    };
  }

  // Returns { plan, ids } with the clipboard blocks pasted at week `target`.
  function pasteInto(plan, clip, target) {
    const lanes = [...plan.lanes];
    const laneFor = (name) => {
      let lane = lanes.find((l) => l.name.toLowerCase() === name.toLowerCase());
      if (!lane) {
        lane = { id: uid(), name, color: (clip.laneColors && clip.laneColors[name]) || PALETTE[lanes.length % PALETTE.length] };
        lanes.push(lane);
      }
      return lane;
    };
    const created = [];
    clip.blocks.forEach((cb) => {
      const start = target + cb.relStart;
      if (start >= MAX_WEEKS) return;
      const lane = laneFor(cb.laneName);
      created.push({ id: uid(), lane: lane.id, start, len: Math.min(cb.len, MAX_WEEKS - start), label: cb.label, notes: cb.notes, color: cb.color, ...(cb.programId ? { programId: cb.programId } : {}) });
    });
    const weeks = clamp(Math.max(plan.weeks, maxEnd(created)), 1, MAX_WEEKS);
    return { plan: { ...plan, lanes, weeks, blocks: [...plan.blocks, ...created] }, ids: created.map((b) => b.id) };
  }

  // ---- header: athlete photo + team logo (left), title (center), DST logo (right) -------------
  // Also used by the team report (one sheet per athlete) with its own title/subtitle; `onOpen` makes
  // the name a link to the athlete's profile.
  function PlanHeader({ athlete, plan, title = "Individualized Player Plan", subtitle, onOpen, extra }) {
    const [photoBroken, setPhotoBroken] = useState(false);
    const initials = athlete.name.split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
    const showPhoto = !!athlete.photoUrl && !photoBroken;
    const Logo = typeof TeamLogo === "function" ? TeamLogo : null; // shared team-logo component from the main app
    // A Cubs 40-man athlete who isn't also a DST client (no dstLocation on file) has their plan
    // run by the Cubs' own strength & conditioning staff, not DST, so this plan/report (also used
    // as-is for the team report's per-athlete sheet) is branded as theirs instead.
    const isCubsOnly = athlete.rosterGroup === "cubs-40man" && !athlete.dstLocation;
    return (
      <div className={`panel period-header${isCubsOnly ? " period-header-cubs" : ""}`}>
        <div className="ph-left">
          <div className="ph-pics">
            {athlete.team && Logo && <span className="ph-team"><Logo team={athlete.team} size={104} /></span>}
            <div className="ph-photo-col">
              {showPhoto ? (
                <img className="ph-photo" src={athlete.photoUrl} alt={athlete.name} onError={() => setPhotoBroken(true)} />
              ) : (
                <div className="ph-photo ph-initials">{initials}</div>
              )}
              {onOpen ? (
                <button className="ph-name ph-name-link" onClick={onOpen} title="Open this athlete's profile">{athlete.name}</button>
              ) : (
                <div className="ph-name">{athlete.name}</div>
              )}
              {athlete.team && <div className="ph-teamname">{athlete.team}</div>}
            </div>
            {extra && <div className="ph-extra">{extra}</div>}
          </div>
        </div>
        <div className="ph-center">
          <h1>{title}</h1>
          <div className="ph-sub">
            {subtitle || (plan ? <React.Fragment>Offseason Periodization &middot; Week 1 starts {fmtMD(plan.startDate)} &middot; {plan.weeks} weeks</React.Fragment> : null)}
          </div>
        </div>
        {!isCubsOnly && (
          <div className="ph-right">
            {/* light-lettered copy for the dark screen; the original artwork is swapped in when printing on white paper */}
            <img className="ph-logo-screen" src="assets/dst-logo-light.png" alt="Dynamic Sports Training" />
            <img className="ph-logo-print" src="assets/dst-logo.png" alt="Dynamic Sports Training" />
          </div>
        )}
      </div>
    );
  }

  // ---- the board for one athlete -------------------------------------------------------------
  function PlannerBoard({ athlete, headerExtra, mode = "plan", openNav = null, onOpenProgram = null }) {
    const store = window.AthleteStore;
    const [plan, setPlanState] = useState(() => store.getPeriodization(athlete.id) || newPlan());
    const [past, setPast] = useState([]);
    const [future, setFuture] = useState([]);
    const [sel, setSel] = useState([]);
    const [cursorWeek, setCursorWeek] = useState(null);
    const [draft, setDraft] = useState(null);   // preview blocks while dragging
    const [ghost, setGhost] = useState(null);   // preview of a block being created
    const [editingId, setEditingId] = useState(null);
    const [renamingLane, setRenamingLane] = useState(null);
    const [clip, setClip] = useState(getClipboard());
    const [templateName, setTemplateName] = useState("");
    const [tick, setTick] = useState(0); // refreshes template / athlete lists after saving

    const planRef = useRef(plan);
    const selRef = useRef(sel);
    const dragRef = useRef(null);
    const draftRef = useRef(null);
    const ghostRef = useRef(null);
    const wrapRef = useRef(null);
    const tracksRef = useRef({});
    selRef.current = sel;

    // ---- state changes ----
    const apply = (next) => {
      planRef.current = next;
      setPlanState(next);
      store.setPeriodization(athlete.id, next);
    };
    // NB: read planRef.current into a local *before* calling apply(), because the state updater
    // functions below run later, by which point planRef.current already holds the new plan.
    const commit = (next) => {
      const current = planRef.current;
      const synced = syncPrograms(current, next);
      if (!synced) return; // backed out of shortening a program with something logged
      setPast((p) => [...p.slice(-99), current]);
      setFuture([]);
      apply(synced);
    };
    // Keeps every block and its program in step after a change to the chart (see saveForBlock): a block made
    // longer or shorter gives its program as many weeks (asking first when weeks with something logged would go)
    // and slides later blocks in its row out of the way; renaming a block renames its program when the program is
    // the athlete's own. Returns the plan to save, or null when the coach backs out.
    function syncPrograms(prev, next) {
      let blocks = next.blocks;
      let touched = false; // a program (or an empty block) changed here, so the builder below reloads it
      for (const changed of next.blocks) {
        const before = prev.blocks.find((x) => x.id === changed.id);
        if (!before) continue;
        const b = blocks.find((x) => x.id === changed.id);
        if (b.len > before.len) blocks = pushLaterBlocks(blocks, b, before);
        const program = b.programId ? programById(b.programId) : null;
        if (!program) { if (b.len !== before.len || (b.label || "") !== (before.label || "")) touched = true; continue; } // an empty tab's builder starts from the block
        const changes = {};
        const weeks = (program.weeks || []).length;
        if (b.len !== before.len && weeks !== b.len) {
          if (b.len < weeks && loggedFrom(athlete.id, next, program, b.len)
            && !window.confirm(`Shorten "${program.name}" to ${b.len} week${b.len === 1 ? "" : "s"}? Something is already logged in the week${weeks - b.len === 1 ? "" : "s"} that would be removed.`)) return null;
          changes.weeks = weeksToLength(program.weeks, b.len);
        }
        const label = (b.label || "").trim();
        if (label && label !== (before.label || "").trim() && isOwnProgram(program, athlete) && nameFor(athlete, label) !== program.name) changes.name = nameFor(athlete, label);
        if (Object.keys(changes).length) {
          const saved = saveForBlock(athlete, { ...next, blocks }, b, program, changes);
          touched = true;
          if (saved.id !== program.id) blocks = blocks.map((x) => (x.id === b.id ? { ...x, programId: saved.id } : x));
        }
      }
      if (touched) setProgRev((r) => r + 1);
      blocks = blocks.filter((b) => b.start < MAX_WEEKS).map((b) => ({ ...b, len: Math.min(b.len, MAX_WEEKS - b.start) }));
      return { ...next, blocks, weeks: clamp(Math.max(next.weeks, maxEnd(blocks)), 1, MAX_WEEKS) };
    }
    // Undo/redo only rewind the timeline — goals and the action plan are typed text with their own
    // editing, so they always carry over from the current plan instead of being rolled back.
    const keepText = (snapshot, current) => ({ ...snapshot, goals: current.goals, actionPlan: current.actionPlan, programLog: current.programLog });
    const undo = () => {
      if (!past.length) return;
      const current = planRef.current;
      const prev = syncPrograms(current, keepText(past[past.length - 1], current)); // the programs follow the blocks back
      if (!prev) return;
      setPast(past.slice(0, -1));
      setFuture((f) => [current, ...f]);
      apply(prev);
      setSel((s) => s.filter((id) => prev.blocks.some((b) => b.id === id)));
    };
    const redo = () => {
      if (!future.length) return;
      const current = planRef.current;
      const next = syncPrograms(current, keepText(future[0], current));
      if (!next) return;
      setFuture(future.slice(1));
      setPast((p) => [...p, current]);
      apply(next);
      setSel((s) => s.filter((id) => next.blocks.some((b) => b.id === id)));
    };
    // Goal / action-plan edits save straight away without going into the undo history.
    const saveText = (patch) => apply({ ...planRef.current, ...patch });
    // Program builder panel under the chart: which section (row) and tab (block) is open, and whether it has
    // unsaved edits. Clicking a row name or a block's Program button on the chart jumps to it. The builder lives on
    // the profile's Programming tab (mode "programming"); on the Player Plan (mode "plan") those clicks open that
    // tab at the row or block instead (`onOpenProgram`), and `openNav` is where the Programming tab starts.
    const [progNav, setProgNav] = useState(() => openNav || { laneId: null, blockId: null });
    const [progDirty, setProgDirty] = useState(false);
    const [progRev, setProgRev] = useState(0); // bumped when the timeline changes a program, so the builder reloads it
    const progPanelRef = useRef(null);
    const laneClickTimer = useRef(null);
    const goProgram = (next, scroll) => {
      if (mode !== "programming") { if (onOpenProgram) onOpenProgram(next); return; }
      const same = next.laneId === progNav.laneId && next.blockId === progNav.blockId;
      // no need to ask about unsaved changes: the builder saves itself as it closes
      if (!same) { setProgDirty(false); setProgNav(next); }
      if (scroll && progPanelRef.current) progPanelRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    // opened from the Player Plan at a block: bring the builder into view
    useEffect(() => { if (mode === "programming" && openNav && openNav.blockId && progPanelRef.current) progPanelRef.current.scrollIntoView({ block: "start" }); }, []); // eslint-disable-line
    const setOpenProgramBlock = (blockId) => {
      const b = planRef.current.blocks.find((x) => x.id === blockId);
      if (b) goProgram({ laneId: b.lane, blockId: b.id }, true);
    };
    // A plain click on a bubble (not a drag or a resize) switches the builder below to that row and block, where the
    // builder is on this page (Programming); the page stays where it is. Read by the pointer handlers through a ref.
    const bubbleClickRef = useRef(null);
    bubbleClickRef.current = (blockId) => {
      if (mode !== "programming") return;
      const b = planRef.current.blocks.find((x) => x.id === blockId);
      if (b) goProgram({ laneId: b.lane, blockId: b.id }, false);
    };
    const laneById = (id) => plan.lanes.find((l) => l.id === id);
    const blockColor = (b) => b.color || (laneById(b.lane) ? laneById(b.lane).color : PALETTE[7]);
    const shownBlocks = draft || plan.blocks;
    const selectedBlocks = plan.blocks.filter((b) => sel.includes(b.id));

    const updateBlocks = (ids, patchFn) => {
      commit({ ...planRef.current, blocks: planRef.current.blocks.map((b) => (ids.includes(b.id) ? { ...b, ...patchFn(b) } : b)) });
    };
    const updateBlock = (id, patch) => updateBlocks([id], () => patch);
    // Links a program to a block (or unlinks it, with null). The block takes the program's name (without the
    // athlete's last name) and its number of weeks, sliding later blocks in its row along if it grows.
    const linkProgram = (blockId, programId) => {
      const program = programId ? programById(programId) : null;
      const patch = { programId: programId || null };
      if (program) {
        patch.assignedBy = window.AthleteStore.currentUserEmail();
        patch.label = blockLabelFor(athlete, program.name);
        if ((program.weeks || []).length) patch.len = program.weeks.length;
      }
      const b = planRef.current.blocks.find((x) => x.id === blockId);
      if (b && Object.keys(patch).every((k) => k === "assignedBy" ? !!b.assignedBy || !patch.assignedBy : b[k] === patch[k])) return; // nothing changes (an autosave of the same program)
      // The athlete's own copy of the block's program, just made by saving it (program.basedOn is the one the block
      // had): not a step to undo on the chart, and the chart's undo history follows it to the copy. Undo putting the
      // block back on the program it was copied from made the next save copy it again, piling up duplicates.
      if (program && b && b.programId && program.basedOn === b.programId) {
        const relink = (p) => ({ ...p, blocks: (p.blocks || []).map((x) => (x.id === blockId && x.programId === b.programId ? { ...x, programId: program.id } : x)) });
        setPast((ps) => ps.map(relink));
        setFuture((fs) => fs.map(relink));
        const current = planRef.current;
        const synced = syncPrograms(current, { ...current, blocks: current.blocks.map((x) => (x.id === blockId ? { ...x, ...patch } : x)) });
        if (synced) apply(synced);
        return;
      }
      updateBlock(blockId, patch);
    };

    // ---- editing actions ----
    const copySel = () => {
      if (!selectedBlocks.length) return;
      const c = makeClip(plan, selectedBlocks, athlete.name);
      setClipboard(c);
      setClip(c);
    };
    const deleteSel = () => {
      if (!sel.length) return;
      commit({ ...plan, blocks: plan.blocks.filter((b) => !sel.includes(b.id)) });
      setSel([]);
      setEditingId(null);
    };
    const cutSel = () => { copySel(); deleteSel(); };
    const doPaste = (clipData, target) => {
      if (!clipData || !clipData.blocks.length) return;
      const res = pasteInto(planRef.current, clipData, target);
      commit(res.plan);
      setSel(res.ids);
      setCursorWeek(null);
    };
    // Paste at the highlighted week if there is one, otherwise right after the current selection.
    const pasteAtCursor = () => {
      const c = getClipboard();
      if (!c) return;
      const target = cursorWeek != null ? cursorWeek : selectedBlocks.length ? maxEnd(selectedBlocks) : 0;
      doPaste(c, target);
    };
    const duplicateSel = () => {
      if (!selectedBlocks.length) return;
      doPaste(makeClip(plan, selectedBlocks, athlete.name), maxEnd(selectedBlocks));
    };
    const nudge = (dw) => {
      if (!selectedBlocks.length) return;
      const minS = Math.min(...selectedBlocks.map((b) => b.start));
      const mxE = maxEnd(selectedBlocks);
      const d = clamp(dw, -minS, plan.weeks - mxE);
      if (d) updateBlocks(sel, (b) => ({ start: b.start + d }));
    };

    // ---- lanes ----
    const addLane = () => {
      const unused = PALETTE.find((c) => !plan.lanes.some((l) => l.color === c));
      const lane = { id: uid(), name: "New row", color: unused || PALETTE[plan.lanes.length % PALETTE.length] };
      commit({ ...plan, lanes: [...plan.lanes, lane] });
      setRenamingLane(lane.id);
    };
    const renameLane = (id, name) => {
      setRenamingLane(null);
      const clean = name.trim();
      if (!clean) return;
      commit({ ...plan, lanes: plan.lanes.map((l) => (l.id === id ? { ...l, name: clean } : l)) });
    };
    const recolorLane = (id) => {
      commit({
        ...plan,
        lanes: plan.lanes.map((l) => (l.id === id ? { ...l, color: PALETTE[(PALETTE.indexOf(l.color) + 1) % PALETTE.length] } : l)),
      });
    };
    const deleteLane = (lane) => {
      const count = plan.blocks.filter((b) => b.lane === lane.id).length;
      if (count && !window.confirm(`Delete the "${lane.name}" row and its ${count} block${count === 1 ? "" : "s"}?`)) return;
      commit({ ...plan, lanes: plan.lanes.filter((l) => l.id !== lane.id), blocks: plan.blocks.filter((b) => b.lane !== lane.id) });
      setSel((s) => s.filter((id) => !plan.blocks.some((b) => b.id === id && b.lane === lane.id)));
    };

    // ---- plan-level settings ----
    const setStartDate = (v) => { if (v) commit({ ...plan, startDate: v }); };
    const setWeeks = (v) => {
      const n = clamp(Math.round(Number(v) || 0), Math.max(1, maxEnd(plan.blocks)), MAX_WEEKS);
      if (n !== plan.weeks) commit({ ...plan, weeks: n });
    };

    // ---- templates / copy from another athlete ----
    const templates = useMemo(() => store.getPeriodTemplates(), [tick]);
    const otherPlans = useMemo(
      () => store.allPeriodizationAthleteIds()
        .filter((id) => id !== athlete.id)
        .map((id) => ({ id, athlete: getRoster().find((a) => a.id === id), plan: store.getPeriodization(id) }))
        .filter((x) => x.athlete && x.plan && x.plan.blocks.length),
      [tick, plan]
    );
    const loadPlan = (source) => {
      if (plan.blocks.length && !window.confirm("Replace this athlete's current plan with the selected one? (You can undo with Ctrl+Z.)")) return;
      const laneMap = {};
      const lanes = source.lanes.map((l) => { const id = uid(); laneMap[l.id] = id; return { ...l, id }; });
      // Programs that belonged to another athlete come along as this athlete's own copies (renamed with their last
      // name, ready to edit); shared library programs stay linked as they are. Each is copied once.
      const copies = {};
      const programFor = (pid) => {
        const src = pid ? programById(pid) : null;
        if (!src || !src.athleteId || String(src.athleteId) === String(athlete.id)) return pid || null;
        if (!copies[pid]) {
          const owner = getRoster().find((a) => String(a.id) === String(src.athleteId)) || { name: "" };
          const { id, ...rest } = src;
          copies[pid] = store.saveProgram({ ...rest, name: nameFor(athlete, blockLabelFor(owner, src.name)), weeks: cloneWeeks(src.weeks), athleteId: athlete.id, basedOn: src.id }).id;
        }
        return copies[pid];
      };
      const blocks = source.blocks.map((b) => ({ ...b, id: uid(), lane: laneMap[b.lane], programId: programFor(b.programId) }));
      commit({ ...plan, weeks: source.weeks, lanes, blocks });
      setSel([]);
    };
    const saveTemplate = () => {
      const name = templateName.trim();
      if (!name) return;
      store.addPeriodTemplate({ name, weeks: plan.weeks, lanes: plan.lanes, blocks: plan.blocks });
      setTemplateName("");
      setTick((t) => t + 1);
    };
    const onLoadChoice = (value) => {
      if (!value) return;
      const [kind, id] = value.split(":");
      if (kind === "t") { const t = templates.find((x) => x.id === id); if (t) loadPlan(t); }
      if (kind === "a") { const o = otherPlans.find((x) => String(x.id) === id); if (o) loadPlan(o.plan); }
    };
    const deleteTemplate = (id) => {
      if (!window.confirm("Delete this template?")) return;
      store.deletePeriodTemplate(id);
      setTick((t) => t + 1);
    };

    // ---- pointer drag (create / move / resize) ----
    const laneIndexAtY = (y) => {
      const lanes = planRef.current.lanes;
      let best = 0;
      for (let i = 0; i < lanes.length; i++) {
        const el = tracksRef.current[lanes[i].id];
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (y >= r.top) best = i;
        if (y >= r.top && y <= r.bottom) return i;
      }
      return best;
    };

    useEffect(() => {
      const onMove = (e) => {
        const d = dragRef.current;
        if (!d) return;
        const dx = e.clientX - d.x0;
        const dy = e.clientY - d.y0;
        if (!d.moved && Math.hypot(dx, dy) < 4) return;
        d.moved = true;
        const p = planRef.current;
        if (d.mode === "create") {
          const w = clamp(Math.floor((e.clientX - d.trackLeft) / WEEK_W), 0, p.weeks - 1);
          const a = Math.min(d.anchor, w);
          const b = Math.max(d.anchor, w);
          const g = { laneId: d.laneId, start: a, len: b - a + 1 };
          ghostRef.current = g;
          setGhost(g);
          return;
        }
        const dw = Math.round(dx / WEEK_W);
        let next;
        if (d.mode === "move") {
          const minS = Math.min(...d.origs.map((b) => b.start));
          const mxE = Math.max(...d.origs.map((b) => b.start + b.len));
          const shift = clamp(dw, -minS, p.weeks - mxE);
          const laneShift = laneIndexAtY(e.clientY) - d.grabLane;
          const byId = {};
          d.origs.forEach((b) => { byId[b.id] = b; });
          next = p.blocks.map((b) => {
            const o = byId[b.id];
            if (!o) return b;
            const li = clamp(p.lanes.findIndex((l) => l.id === o.lane) + laneShift, 0, p.lanes.length - 1);
            return { ...b, start: o.start + shift, lane: p.lanes[li].id };
          });
        } else if (d.mode === "resize-r") {
          const o = d.origs[0];
          const len = clamp(o.len + dw, 1, p.weeks - o.start);
          next = p.blocks.map((b) => (b.id === o.id ? { ...b, len } : b));
        } else {
          const o = d.origs[0];
          const start = clamp(o.start + dw, 0, o.start + o.len - 1);
          next = p.blocks.map((b) => (b.id === o.id ? { ...b, start, len: o.start + o.len - start } : b));
        }
        draftRef.current = next;
        setDraft(next);
      };

      const onUp = () => {
        const d = dragRef.current;
        dragRef.current = null;
        if (!d) return;
        if (d.mode === "create") {
          const g = ghostRef.current;
          if (d.moved && g) {
            const block = { id: uid(), lane: g.laneId, start: g.start, len: g.len, label: "", notes: "", color: null };
            commit({ ...planRef.current, blocks: [...planRef.current.blocks, block] });
            setSel([block.id]);
            setEditingId(block.id);
          }
          ghostRef.current = null;
          setGhost(null);
        } else if (d.moved && draftRef.current) {
          commit({ ...planRef.current, blocks: draftRef.current });
        } else if (d.collapseOnClick) {
          setSel([d.origs.find((b) => b.id === d.id).id]);
        }
        // a click on a bubble, not a drag: the builder below opens that block
        if (!d.moved && d.mode === "move" && bubbleClickRef.current) bubbleClickRef.current(d.id);
        draftRef.current = null;
        setDraft(null);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      return () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      // eslint-disable-next-line
    }, []);

    const focusBoard = () => { if (wrapRef.current) wrapRef.current.focus(); };

    // Printing the plan (only when it is the open tab / page): show just the plan, on one portrait
    // Letter sheet. The plan is laid out at its natural width, measured, then scaled down to fit.
    // Other tabs and pages are never touched by this.
    const printState = useRef(null);
    const preparePrint = () => {
      const el = wrapRef.current;
      if (!el || el.offsetParent === null || printState.current) return; // hidden tab, or already prepared
      // The whole plan is laid out ~1000px wide and scaled to the page; the (much wider) week grid is
      // shrunk on its own to fit that width, so the text everywhere else stays as large as possible.
      const naturalW = 1000;
      const gridEl = el.querySelector(".period-grid");
      const gridW = LABEL_W + planRef.current.weeks * WEEK_W;
      el.style.zoom = "";
      el.style.width = `${naturalW}px`;
      if (gridEl) gridEl.style.zoom = String(Math.min(1, (naturalW - 6) / gridW));
      // Text areas don't grow with their text, so open the action plan to its full height for the printout.
      const areas = [...el.querySelectorAll("textarea")].map((ta) => {
        const saved = { ta, height: ta.style.height, overflow: ta.style.overflow };
        ta.style.overflow = "hidden";
        ta.style.height = "auto";
        ta.style.height = `${ta.scrollHeight + 4}px`;
        return saved;
      });
      el.classList.add("measuring"); // hides the on-screen-only controls so we measure what will print
      const naturalH = el.scrollHeight;
      el.classList.remove("measuring");
      const PAGE_W = 725; // usable width / height of a Letter portrait sheet (0.35in margins), in CSS px,
      const PAGE_H = 925; // with headroom (borders/margins differ a little in print) so nothing spills onto page 2
      el.style.zoom = String(Math.min(1, PAGE_W / naturalW, PAGE_H / naturalH));
      const pageStyle = document.createElement("style");
      pageStyle.textContent = "@page { size: letter portrait; margin: 0.35in; }";
      document.head.appendChild(pageStyle);
      document.body.classList.add("print-plan-only");
      printState.current = { el, gridEl, areas, pageStyle };
    };
    const cleanupPrint = () => {
      const s = printState.current;
      if (!s) return;
      printState.current = null;
      document.body.classList.remove("print-plan-only");
      if (s.pageStyle.parentNode) s.pageStyle.parentNode.removeChild(s.pageStyle);
      s.el.style.zoom = "";
      s.el.style.width = "";
      if (s.gridEl) s.gridEl.style.zoom = "";
      s.areas.forEach((a) => { a.ta.style.height = a.height; a.ta.style.overflow = a.overflow; });
    };
    const printPlan = () => { preparePrint(); window.print(); };
    const printPlanRef = useRef(printPlan);
    printPlanRef.current = printPlan;
    useEffect(() => {
      if (mode !== "plan") return undefined; // the Programming tab doesn't print the plan
      const onBefore = () => preparePrint();       // also covers Ctrl+P while the plan is open
      const onPrintRequest = () => printPlanRef.current(); // the profile's own Print button asks for this
      window.addEventListener("beforeprint", onBefore);
      window.addEventListener("afterprint", cleanupPrint);
      window.addEventListener("dst-print-plan", onPrintRequest);
      return () => {
        window.removeEventListener("beforeprint", onBefore);
        window.removeEventListener("afterprint", cleanupPrint);
        window.removeEventListener("dst-print-plan", onPrintRequest);
        cleanupPrint();
      };
      // eslint-disable-next-line
    }, []);

    const onTrackDown = (e, lane) => {
      if (e.button !== 0 || e.target !== e.currentTarget) return;
      focusBoard();
      const rect = e.currentTarget.getBoundingClientRect();
      const w = clamp(Math.floor((e.clientX - rect.left) / WEEK_W), 0, plan.weeks - 1);
      setCursorWeek(w);
      if (!e.shiftKey && !e.ctrlKey && !e.metaKey) setSel([]);
      setEditingId(null);
      dragRef.current = { mode: "create", laneId: lane.id, anchor: w, trackLeft: rect.left, x0: e.clientX, y0: e.clientY, moved: false };
    };

    const onTrackDouble = (e, lane) => {
      if (e.target !== e.currentTarget) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const w = clamp(Math.floor((e.clientX - rect.left) / WEEK_W), 0, plan.weeks - 1);
      const block = { id: uid(), lane: lane.id, start: w, len: 1, label: "", notes: "", color: null };
      commit({ ...plan, blocks: [...plan.blocks, block] });
      setSel([block.id]);
      setEditingId(block.id);
    };

    const onBlockDown = (e, b, mode) => {
      e.stopPropagation();
      if (e.button !== 0) return;
      focusBoard();
      if (mode === "move" && (e.shiftKey || e.ctrlKey || e.metaKey)) {
        setSel((s) => (s.includes(b.id) ? s.filter((id) => id !== b.id) : [...s, b.id]));
        return;
      }
      const alreadySelected = sel.includes(b.id);
      const nextSel = alreadySelected && mode === "move" ? sel : [b.id];
      if (!alreadySelected || mode !== "move") setSel(nextSel);
      const origs = plan.blocks.filter((x) => nextSel.includes(x.id)).map((x) => ({ ...x }));
      dragRef.current = {
        mode,
        id: b.id,
        origs: mode === "move" ? origs : origs.filter((x) => x.id === b.id),
        grabLane: plan.lanes.findIndex((l) => l.id === b.lane),
        x0: e.clientX,
        y0: e.clientY,
        moved: false,
        collapseOnClick: mode === "move" && alreadySelected && sel.length > 1,
      };
    };

    // ---- keyboard ----
    const onKeyDown = (e) => {
      const tag = e.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      // keys pressed in the program builder below are the builder's (its own Ctrl+Z undoes the program), never the chart's
      if (progPanelRef.current && progPanelRef.current.contains(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === "c") { if (selectedBlocks.length) { e.preventDefault(); copySel(); } }
      else if (mod && k === "x") { if (selectedBlocks.length) { e.preventDefault(); cutSel(); } }
      else if (mod && k === "v") { e.preventDefault(); pasteAtCursor(); }
      else if (mod && k === "d") { e.preventDefault(); duplicateSel(); }
      else if (mod && k === "a") { e.preventDefault(); setSel(plan.blocks.map((b) => b.id)); }
      else if (mod && k === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if (mod && k === "y") { e.preventDefault(); redo(); }
      else if (k === "delete" || k === "backspace") { if (sel.length) { e.preventDefault(); deleteSel(); } }
      else if (k === "escape") { setSel([]); setEditingId(null); setCursorWeek(null); }
      else if (k === "arrowleft") { e.preventDefault(); nudge(-1); }
      else if (k === "arrowright") { e.preventDefault(); nudge(1); }
      else if (k === "enter") { if (sel.length === 1) { e.preventDefault(); setEditingId(sel[0]); } }
    };

    // ---- render ----
    const weekStarts = Array.from({ length: plan.weeks }, (_, i) => addDaysISO(plan.startDate, i * 7));
    const progress = planProgress(plan);
    const single = selectedBlocks.length === 1 ? selectedBlocks[0] : null;
    const gridWidth = LABEL_W + plan.weeks * WEEK_W;
    const rangeText = (b) => `Wk ${b.start + 1}${b.len > 1 ? `–${b.start + b.len}` : ""} (${fmtMD(weekStarts[b.start] || plan.startDate)} – ${fmtMD(addDaysISO(plan.startDate, (b.start + b.len) * 7 - 1))})`;

    return (
      <div className="period-wrap" ref={wrapRef} tabIndex={0} onKeyDown={onKeyDown}>
        {/* the Programming tab shows just the timeline and the program builder; the rest is on the Player Plan */}
        {mode === "plan" && <PlanHeader athlete={athlete} plan={plan} extra={headerExtra} />}

        {mode === "plan" && <AthletePhoneLink athlete={athlete} />}

        {/* goals and the action plan come first on screen; printed, they stay after the timeline (see .period-goals-slot) */}
        {mode === "plan" && (<div className="period-goals-slot">
          <GoalsSection plan={plan} onSave={saveText} lead={offseasonLead(athlete)} />
        </div>)}

        <div className="panel period-toolbar no-print">
          <div className="period-toolbar-row">
            <div className="field">
              <label>Start of week 1</label>
              <input type="date" value={plan.startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="field" style={{ maxWidth: 90 }}>
              <label>Weeks</label>
              <input type="number" min={Math.max(1, maxEnd(plan.blocks))} max={MAX_WEEKS} value={plan.weeks} onChange={(e) => setWeeks(e.target.value)} />
            </div>
            <div className="period-btn-group">
              <button className="btn btn-secondary" onClick={undo} disabled={!past.length} title="Undo (Ctrl+Z)">Undo</button>
              <button className="btn btn-secondary" onClick={redo} disabled={!future.length} title="Redo (Ctrl+Y)">Redo</button>
            </div>
            <div className="period-btn-group">
              <button className="btn btn-secondary" onClick={copySel} disabled={!sel.length} title="Copy (Ctrl+C)">Copy</button>
              <button className="btn btn-secondary" onClick={cutSel} disabled={!sel.length} title="Cut (Ctrl+X)">Cut</button>
              <button
                className="btn btn-secondary"
                onClick={pasteAtCursor}
                disabled={!clip}
                title={clip ? `Paste ${clip.blocks.length} block${clip.blocks.length === 1 ? "" : "s"} copied from ${clip.fromName} (Ctrl+V) — goes at the highlighted week, or right after the selection` : "Nothing copied yet"}
              >
                Paste
              </button>
              <button className="btn btn-secondary" onClick={duplicateSel} disabled={!sel.length} title="Duplicate (Ctrl+D)">Duplicate</button>
              <button className="btn btn-secondary" onClick={deleteSel} disabled={!sel.length} title="Delete (Del)">Delete</button>
            </div>
            <div className="period-btn-group">
              <button className="btn btn-secondary" onClick={addLane}>+ Add row</button>
              {/* printing and emailing the plan belong to the Player Plan, not the Programming tab */}
              {mode === "plan" && <button className="btn btn-secondary" onClick={printPlan} title="Prints just this plan, scaled to fit one portrait sheet">Print / Save PDF</button>}
              {mode === "plan" && typeof EmailToAthleteButton === "function" && (
                <EmailToAthleteButton athlete={athlete} tab="plan" tabLabel="Player Plan" />
              )}
            </div>
          </div>
          <div className="period-toolbar-row">
            <div className="field" style={{ minWidth: 240 }}>
              <label>Load a plan into this athlete</label>
              <select value="" onChange={(e) => onLoadChoice(e.target.value)}>
                <option value="">— choose a template or another athlete —</option>
                {templates.length > 0 && (
                  <optgroup label="Templates">
                    {templates.map((t) => <option key={t.id} value={`t:${t.id}`}>{t.name}</option>)}
                  </optgroup>
                )}
                {otherPlans.length > 0 && (
                  <optgroup label="Other athletes' plans">
                    {otherPlans.map((o) => <option key={o.id} value={`a:${o.id}`}>{o.athlete.name}</option>)}
                  </optgroup>
                )}
              </select>
            </div>
            <div className="field" style={{ minWidth: 200 }}>
              <label>Save this plan as a template</label>
              <div style={{ display: "flex", gap: 6 }}>
                <input placeholder="Template name" value={templateName} onChange={(e) => setTemplateName(e.target.value)} />
                <button className="btn btn-secondary" onClick={saveTemplate} disabled={!templateName.trim() || !plan.blocks.length}>Save</button>
              </div>
            </div>
            {templates.length > 0 && (
              <div className="period-template-chips">
                {templates.map((t) => (
                  <span className="period-chip" key={t.id}>{t.name}<button title="Delete template" onClick={() => deleteTemplate(t.id)}>×</button></span>
                ))}
              </div>
            )}
          </div>
          <p className="period-help">
            Drag across an empty row to create a block &middot; drag a block to move it (across weeks and rows) &middot; drag its edges to resize &middot;
            double-click to rename &middot; Shift-click to select several &middot; Ctrl+C / Ctrl+V to copy &amp; paste (works across athletes) &middot;
            Ctrl+Z to undo &middot; Delete to remove &middot; arrow keys nudge a week.
          </p>
        </div>

        {/* one red-outlined section holding the progress bar and the timeline together */}
        <div className="panel period-visual">
          <div className="period-visual-top">
            <PlanProgress plan={plan} name={athlete.name} />
            <p className="period-saved no-print">
              {plan.blocks.length || hasGoalContent(plan)
                ? `✓ Saved automatically — goals, action plan and timeline show on ${athlete.name}'s player profile and above their performance metrics on the team report.`
                : `Add goals or at least one block and the plan will show on ${athlete.name}'s player profile and team report.`}
            </p>
          </div>

        <div className="period-scroll">
          <div className="period-grid" style={{ width: gridWidth }}>
            <div className="period-head">
              <div className="period-lane-label period-corner" style={{ width: LABEL_W }}>{athlete.name}</div>
              <div style={{ display: "flex" }}>
                {weekStarts.map((d, i) => (
                  <div
                    key={i}
                    className={`period-week ${cursorWeek === i ? "cursor" : ""} ${progress.state === "active" && progress.week === i + 1 ? "now" : ""}`}
                    style={{ width: WEEK_W }}
                    onClick={() => { setCursorWeek(i); focusBoard(); }}
                    title="Click to set where Paste goes"
                  >
                    <strong>Wk {i + 1}</strong>
                    <span>{fmtMD(d)}</span>
                  </div>
                ))}
              </div>
            </div>

            {plan.lanes.map((lane) => {
              const laneBlocks = shownBlocks.filter((b) => b.lane === lane.id);
              const { rows, count } = packRows(laneBlocks);
              const rowCount = ghost && ghost.laneId === lane.id ? Math.max(count, 1) : count;
              return (
                <div className="period-lane" key={lane.id}>
                  <div className="period-lane-label" style={{ width: LABEL_W }}>
                    <button className="period-dot" style={{ background: lane.color }} title="Click to change this row's color" onClick={() => recolorLane(lane.id)} />
                    {renamingLane === lane.id ? (
                      <input
                        autoFocus
                        defaultValue={lane.name}
                        onFocus={(e) => e.target.select()}
                        onBlur={(e) => renameLane(lane.id, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") { e.target.blur(); focusBoard(); }
                          if (e.key === "Escape") { setRenamingLane(null); focusBoard(); }
                          e.stopPropagation();
                        }}
                      />
                    ) : (
                      <span
                        className="period-lane-name"
                        title="Click to open this section's programs · double-click to rename"
                        onClick={() => { clearTimeout(laneClickTimer.current); laneClickTimer.current = setTimeout(() => goProgram({ laneId: lane.id, blockId: null }, true), 260); }}
                        onDoubleClick={() => { clearTimeout(laneClickTimer.current); setRenamingLane(lane.id); }}
                      >{lane.name}</span>
                    )}
                    <button className="period-lane-x no-print" title="Delete this row" onClick={() => deleteLane(lane)}>×</button>
                  </div>
                  <div
                    className="period-track"
                    ref={(el) => { if (el) tracksRef.current[lane.id] = el; else delete tracksRef.current[lane.id]; }}
                    style={{
                      width: plan.weeks * WEEK_W,
                      height: rowCount * ROW_H + 8,
                      backgroundSize: `${WEEK_W}px 100%`,
                    }}
                    onPointerDown={(e) => onTrackDown(e, lane)}
                    onDoubleClick={(e) => onTrackDouble(e, lane)}
                  >
                    {progress.state === "active" && <div className="period-today" style={{ left: (progress.days / 7) * WEEK_W }} title="Today" />}
                    {cursorWeek != null && <div className="period-cursor" style={{ left: cursorWeek * WEEK_W, width: WEEK_W }} />}
                    {laneBlocks.map((b) => {
                      const selected = sel.includes(b.id);
                      return (
                        <div
                          key={b.id}
                          className={`period-block ${selected ? "selected" : ""}`}
                          style={{ left: b.start * WEEK_W + 2, width: b.len * WEEK_W - 4, top: (rows[b.id] || 0) * ROW_H + 5, background: blockColor(b) }}
                          title={`${b.label || "Untitled"} · ${rangeText(b)}${b.notes ? `\n${b.notes}` : ""}`}
                          onPointerDown={(e) => onBlockDown(e, b, "move")}
                          onDoubleClick={(e) => { e.stopPropagation(); setEditingId(b.id); }}
                        >
                          <span className="period-handle l" onPointerDown={(e) => onBlockDown(e, b, "resize-l")} />
                          {editingId === b.id ? (
                            <input
                              className="period-inline-input"
                              autoFocus
                              defaultValue={b.label}
                              placeholder="Label"
                              onPointerDown={(e) => e.stopPropagation()}
                              onFocus={(e) => e.target.select()}
                              onBlur={(e) => { setEditingId(null); if (e.target.value !== b.label) updateBlock(b.id, { label: e.target.value }); }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") { e.target.blur(); focusBoard(); }
                                if (e.key === "Escape") { setEditingId(null); focusBoard(); }
                                e.stopPropagation();
                              }}
                            />
                          ) : (
                            <span className="period-block-label">{b.label || <em>Untitled</em>}</span>
                          )}
                          {b.notes ? <span className="period-note-dot" /> : null}
                          {b.programId && programById(b.programId) && (
                            <button
                              className="period-block-program no-print"
                              title={`Edit the program: ${programById(b.programId).name}`}
                              onPointerDown={(e) => e.stopPropagation()}
                              onDoubleClick={(e) => e.stopPropagation()}
                              onClick={(e) => { e.stopPropagation(); setOpenProgramBlock(b.id); }}
                            >
                              Program
                            </button>
                          )}
                          <span className="period-handle r" onPointerDown={(e) => onBlockDown(e, b, "resize-r")} />
                        </div>
                      );
                    })}
                    {ghost && ghost.laneId === lane.id && (
                      <div className="period-ghost" style={{ left: ghost.start * WEEK_W + 2, width: ghost.len * WEEK_W - 4, top: 5 }} />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        </div>

        {single && (
          <div className="panel period-editor no-print">
            <h2>Edit block <small>{rangeText(single)}</small></h2>
            <div className="period-editor-grid">
              <div className="field">
                <label>Label</label>
                <input key={single.id + "l" + single.label} defaultValue={single.label} placeholder="e.g. Acceleration mechanics" onBlur={(e) => e.target.value !== single.label && updateBlock(single.id, { label: e.target.value })} onKeyDown={(e) => e.key === "Enter" && e.target.blur()} />
              </div>
              <div className="field">
                <label>Row</label>
                <select value={single.lane} onChange={(e) => updateBlock(single.id, { lane: e.target.value })}>
                  {plan.lanes.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Starts (week)</label>
                <input type="number" min={1} max={plan.weeks} value={single.start + 1}
                  onChange={(e) => { const s = clamp((Number(e.target.value) || 1) - 1, 0, plan.weeks - 1); updateBlock(single.id, { start: s, len: Math.min(single.len, plan.weeks - s) }); }} />
              </div>
              <div className="field">
                <label>Length (weeks)</label>
                <input type="number" min={1} max={plan.weeks - single.start} value={single.len}
                  onChange={(e) => updateBlock(single.id, { len: clamp(Number(e.target.value) || 1, 1, plan.weeks - single.start) })} />
              </div>
            </div>
            <div className="field" style={{ marginTop: 10 }}>
              <label>Notes (sets / reps / volume / intent, anything for this block)</label>
              <textarea key={single.id + "n" + single.notes} rows={3} defaultValue={single.notes} onBlur={(e) => e.target.value !== single.notes && updateBlock(single.id, { notes: e.target.value })} />
            </div>
            <div className="field" style={{ marginTop: 10 }}>
              <label>Program (built on the Programs tab)</label>
              <select value={single.programId || ""} onChange={(e) => updateBlock(single.id, { programId: e.target.value || null, assignedBy: window.AthleteStore.currentUserEmail() })}>
                <option value="">— None —</option>
                {single.programId && !programById(single.programId) && <option value={single.programId}>(deleted program)</option>}
                {allPrograms().map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              {single.programId && programById(single.programId) && (
                <button className="btn-link" style={{ marginTop: 6 }} onClick={() => setOpenProgramBlock(single.id)}>{mode === "programming" ? "Edit program in the builder below" : "Open its program on the Programming tab"}</button>
              )}
            </div>
            <div className="period-swatches">
              <span>Color</span>
              <button className={`period-swatch clear ${!single.color ? "on" : ""}`} title="Use the row's color" onClick={() => updateBlock(single.id, { color: null })}>row</button>
              {PALETTE.map((c) => (
                <button key={c} className={`period-swatch ${single.color === c ? "on" : ""}`} style={{ background: c }} onClick={() => updateBlock(single.id, { color: c })} />
              ))}
            </div>
          </div>
        )}

        {selectedBlocks.length > 1 && (
          <div className="panel period-editor no-print">
            <h2>{selectedBlocks.length} blocks selected</h2>
            <div className="period-swatches">
              <span>Color all</span>
              {PALETTE.map((c) => (
                <button key={c} className="period-swatch" style={{ background: c }} onClick={() => updateBlocks(sel, () => ({ color: c }))} />
              ))}
            </div>
          </div>
        )}

        {mode === "programming" && <PlanProgramTabs plan={plan} athlete={athlete} onLinkProgram={linkProgram} nav={progNav} onNav={(next) => goProgram(next, false)} dirty={progDirty} setDirty={setProgDirty} panelRef={progPanelRef} extRev={progRev} />}
      </div>
    );
  }

  // ---- page: pick an athlete, then show their board -----------------------------------------
  function PeriodizationPlanner() {
    const store = window.AthleteStore;
    const roster = getRoster()
      .filter((a) => (a.status || "active").toLowerCase() !== "alumni")
      .sort((a, b) => a.name.localeCompare(b.name));
    const [athleteId, setAthleteId] = useState(() => {
      try { return Number(localStorage.getItem(LAST_ATHLETE_KEY)) || null; } catch (e) { return null; }
    });
    const athlete = roster.find((a) => a.id === athleteId) || null;
    const withPlans = store.allPeriodizationAthleteIds()
      .map((id) => roster.find((a) => a.id === id))
      .filter((a) => a && (store.getPeriodization(a.id).blocks.length || hasGoalContent(store.getPeriodization(a.id))));

    const choose = (id) => {
      setAthleteId(id);
      try { localStorage.setItem(LAST_ATHLETE_KEY, String(id || "")); } catch (e) { /* ignore */ }
    };

    return (
      <div>
        <div className="panel no-print">
          <h2>Player Plans <small>Periodization, goals and action plan &mdash; running, strength, correctives, throwing and more</small></h2>
          <div className="field" style={{ maxWidth: 340 }}>
            <label>Athlete</label>
            <select value={athleteId || ""} onChange={(e) => choose(Number(e.target.value) || null)}>
              <option value="">— choose an athlete —</option>
              {roster.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          {withPlans.length > 0 && (
            <p className="timestamp-note" style={{ marginBottom: 0 }}>
              Plans on file:{" "}
              {withPlans.map((a, i) => (
                <React.Fragment key={a.id}>
                  {i > 0 && ", "}
                  <button className="btn-link" onClick={() => choose(a.id)}>{a.name}</button>
                </React.Fragment>
              ))}
            </p>
          )}
        </div>
        {athlete ? (
          <PlannerBoard key={athlete.id} athlete={athlete} />
        ) : (
          <div className="panel"><div className="empty-state">Choose an athlete above to start (or continue) their offseason plan.</div></div>
        )}
      </div>
    );
  }

  window.PeriodizationPlanner = PeriodizationPlanner;
  window.PeriodizationView = PeriodizationView;
  window.PlanSheetHeader = PlanHeader; // the athlete header used on the plan and on each team-report sheet
  window.PeriodizationBoard = PlannerBoard; // the full editable plan for one athlete (used as a tab on the player profile)
  // planProgress alone (not a component) for the roster page's program-status flag — see
  // ProgramStatusBadge in index.html — so it doesn't have to re-derive "what week is it" itself.
  window.PeriodizationLib = { planProgress, assignProgram, mondayOfToday };
})();
