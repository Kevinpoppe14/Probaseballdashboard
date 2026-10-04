// Periodization planner — an interactive week-by-week offseason planner for one athlete at a time.
// Lives on the Player Plans page (Periodization tab). Rows ("lanes") are training categories
// (Phase, Running, Strength, Correctives, Throwing, ...) and each block is a labelled bar that
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
      { id: uid(), name: "Phase", color: PALETTE[4] },
      { id: uid(), name: "Running", color: PALETTE[3] },
      { id: uid(), name: "Strength", color: PALETTE[0] },
      { id: uid(), name: "Correctives", color: PALETTE[5] },
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
        const program = programById(b.programId);
        const lane = plan.lanes.find((l) => l.id === b.lane);
        if (!program || !lane || !(program.weeks || []).length) return null;
        const n = (weekIdx - b.start) % program.weeks.length;
        return { block: b, lane, program, week: program.weeks[n], weekNo: n + 1 };
      })
      .filter(Boolean)
      .sort((a, b) => plan.lanes.indexOf(a.lane) - plan.lanes.indexOf(b.lane));
  }

  // Superset labels for a session's exercises: A1, A2, B1... An exercise marked `linked` joins the group of the
  // exercise above it; any other exercise starts the next letter.
  function exerciseLabels(exercises) {
    let group = -1, n = 0;
    return (exercises || []).map((e, i) => {
      if (i > 0 && e.linked) n += 1;
      else { group += 1; n = 1; }
      const letter = (group >= 26 ? String.fromCharCode(64 + Math.floor(group / 26)) : "") + String.fromCharCode(65 + (group % 26));
      return `${letter}${n}.`;
    });
  }
  window.exerciseLabels = exerciseLabels;

  // ---- exercise prescription ---------------------------------------------------------------------
  // An exercise is prescribed as one or more set groups, each { sets, reps, intensity }, with one intensity unit for
  // the exercise (%, RIR or RPE). It reads "5 (50%)  3 (60%)  3x1 (70%)": reps, or sets x reps, then the intensity.
  // The weight itself is never part of the program; the athlete writes it in when doing the work.
  // Older programs stored a single sets / reps / load per exercise; normalize() turns those into one set group.
  const ProgramRx = {
    UNITS: ["%", "RIR", "RPE", ""],
    normalize(e) {
      if (Array.isArray(e.groups)) return e;
      const { sets, reps, load, loadUnit, ...rest } = e;
      const pct = loadUnit === "% 1RM" || loadUnit === "RPE";
      return { ...rest, tempo: e.tempo || "", intensityUnit: loadUnit === "RPE" ? "RPE" : "%", groups: [{ sets: sets || "", reps: reps || "", intensity: pct ? load || "" : "" }] };
    },
    groups(e) {
      return ProgramRx.normalize(e).groups.filter((g) => `${g.sets || ""}${g.reps || ""}`.trim());
    },
    intensityText(e, g) {
      const v = `${g.intensity || ""}`.trim();
      if (!v) return "";
      const unit = ProgramRx.normalize(e).intensityUnit;
      if (unit === "%") return `${v.replace(/%$/, "")}%`;
      if (unit === "RIR") return `${v} RIR`;
      if (unit === "RPE") return `RPE ${v}`;
      return ""; // "No intensity": nothing shown even if a number was typed earlier
    },
    groupText(e, g) {
      const sets = `${g.sets || ""}`.trim(), reps = `${g.reps || ""}`.trim();
      const base = sets && sets !== "1" ? (reps ? `${sets}x${reps}` : `${sets} sets`) : reps;
      const int = ProgramRx.intensityText(e, g);
      return `${base}${int ? ` (${int})` : ""}`;
    },
    text(e) {
      return ProgramRx.groups(e).map((g) => ProgramRx.groupText(e, g)).join("  ");
    },
    // where an athlete's written-in weight for one set group is kept
    logKey: (e, gi) => `${e.id}|${gi}`,
  };
  window.ProgramRx = ProgramRx;

  // One program week: a table of exercises per session. With `onLog`, each set group gets a box for the weight
  // the athlete actually used (`log` holds what's been entered so far).
  function ProgramWeekView({ week, log, onLog }) {
    return (
      <div className="program-view">
        {(week.sessions || []).map((s, si) => {
          const rows = (s.exercises || []).filter((e) => (e.name || "").trim());
          const labels = exerciseLabels(rows);
          return (
            <div className="program-view-session" key={si}>
              <h4>{s.name || `Session ${si + 1}`}</h4>
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
                        </td>
                        <td>
                          <div className="program-rx">
                            {ProgramRx.groups(e).map((g, gi) => (
                              <span className="program-rx-group" key={gi}>
                                <span>{ProgramRx.groupText(e, g)}</span>
                                {onLog && (
                                  <input
                                    className="program-rx-weight"
                                    key={(log || {})[ProgramRx.logKey(e, gi)] || ""}
                                    defaultValue={(log || {})[ProgramRx.logKey(e, gi)] || ""}
                                    placeholder="wt"
                                    aria-label="Weight used"
                                    onKeyDown={(ev) => ev.stopPropagation()}
                                    onBlur={(ev) => { const v = ev.target.value.trim(); if (v !== ((log || {})[ProgramRx.logKey(e, gi)] || "")) onLog(ProgramRx.logKey(e, gi), v); }}
                                  />
                                )}
                              </span>
                            ))}
                            {ProgramRx.groups(e).length === 0 && "—"}
                          </div>
                        </td>
                        <td>{e.rest || "—"}</td>
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
  function ProgramModal({ program, currentNo, onClose, athlete, log, onLog }) {
    // Same one-page PDF as the program builder's export, with this athlete's name (and the Cubs logo for Cubs-only athletes).
    const exportPdf = async () => {
      const name = athlete ? athlete.name : "";
      const cubs = !!athlete && !!window.isCubsOnlyAthlete && window.isCubsOnlyAthlete(athlete);
      const { pdf, fits } = await window.buildProgramPdf(program, name, cubs);
      if (!fits) window.alert("This program is too long to fit on one page at a readable size, so the bottom of the page is cut off. Try fewer weeks per program.");
      pdf.save(`${[name, program.name].filter(Boolean).join(" - ").replace(/[\\/:*?"<>|]/g, "")}.pdf`);
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
          {window.buildProgramPdf && <button className="btn program-modal-pdf" onClick={exportPdf}>Export PDF{athlete ? ` for ${athlete.name}` : ""}</button>}
          {program.description && <p className="program-modal-desc">{program.description}</p>}
          {(program.weeks || []).map((w, wi) => (
            <div className={`program-modal-week ${currentNo === wi + 1 ? "current" : ""}`} key={wi}>
              <h3>{w.name || `Week ${wi + 1}`}{currentNo === wi + 1 && <small>This week</small>}</h3>
              <ProgramWeekView week={w} log={log} onLog={onLog} />
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
    const name = (laneName || "Strength").trim() || "Strength";
    let lane = plan.lanes.find((l) => l.name.toLowerCase() === name.toLowerCase());
    if (!lane) { lane = { id: uid(), name, color: PALETTE[plan.lanes.length % PALETTE.length] }; plan.lanes.push(lane); }
    const len = Math.min(Math.max(1, (program.weeks || []).length), MAX_WEEKS - start);
    plan.blocks.push({ id: uid(), lane: lane.id, start, len, label: program.name, notes: "", color: null, programId: program.id });
    plan.weeks = clamp(Math.max(plan.weeks, start + len), 1, MAX_WEEKS);
    plan.blocks = plan.blocks.filter((b) => b.start < MAX_WEEKS);
    store.setPeriodization(athleteId, plan);
    return existing ? "added" : "created";
  }

  // The program week each attached block is on: this week while the plan is running, week 1 before it starts.
  function PlanPrograms({ plan, onLog }) {
    const p = planProgress(plan);
    if (p.state === "complete") return null;
    const items = programWeeksAt(plan, p.state === "active" ? p.week - 1 : 0);
    if (!items.length) return null;
    return (
      <div className="panel period-programs no-print">
        <h2>
          {p.state === "active" ? "This week's program" : "First week's program"}{" "}
          <small>{p.state === "active" ? `Week ${p.week} of ${plan.weeks}` : `Plan starts ${fmtMD(plan.startDate)}`}</small>
        </h2>
        {items.map(({ block, lane, program, week, weekNo }) => (
          <div className="period-program" key={block.id}>
            <h3>
              {lane.name}: {block.label || "Untitled"}{" "}
              <small>{program.name} · {week.name || `Week ${weekNo}`} ({weekNo} of {program.weeks.length})</small>
            </h3>
            <ProgramWeekView week={week} log={(plan.programLog || {})[program.id] || {}} onLog={onLog ? (key, val) => onLog(program.id, key, val) : undefined} />
          </div>
        ))}
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
    const opened = openBlock && plan.blocks.find((b) => b.id === openBlock);
    const openedProgram = opened && programById(opened.programId);
    return (
      <div className="period-ro">
        {openedProgram && <ProgramModal program={openedProgram} athlete={athlete} log={(plan.programLog || {})[openedProgram.id] || {}} onLog={athlete ? (key, val) => {
          const store = window.AthleteStore;
          const cur = store.getPeriodization(athlete.id);
          if (!cur) return;
          const all = { ...(cur.programLog || {}) };
          const one = { ...(all[openedProgram.id] || {}) };
          if (val) one[key] = val; else delete one[key];
          all[openedProgram.id] = one;
          store.setPeriodization(athlete.id, { ...cur, programLog: all });
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
        {hasBlocks && <PlanProgress plan={plan} name={(getRoster().find((a) => a.id === athleteId) || {}).name} />}
        {hasBlocks && <ReadonlyTimeline plan={plan} athlete={getRoster().find((a) => a.id === athleteId)} />}
        {goalsToShow && <GoalsReadOnly plan={plan} lead={offseasonLead(getRoster().find((a) => a.id === athleteId))} />}
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
  function PlannerBoard({ athlete, headerExtra }) {
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
      setPast((p) => [...p.slice(-99), current]);
      setFuture([]);
      apply(next);
    };
    // Undo/redo only rewind the timeline — goals and the action plan are typed text with their own
    // editing, so they always carry over from the current plan instead of being rolled back.
    const keepText = (snapshot, current) => ({ ...snapshot, goals: current.goals, actionPlan: current.actionPlan, programLog: current.programLog });
    const undo = () => {
      if (!past.length) return;
      const current = planRef.current;
      const prev = keepText(past[past.length - 1], current);
      setPast(past.slice(0, -1));
      setFuture((f) => [current, ...f]);
      apply(prev);
      setSel((s) => s.filter((id) => prev.blocks.some((b) => b.id === id)));
    };
    const redo = () => {
      if (!future.length) return;
      const current = planRef.current;
      const next = keepText(future[0], current);
      setFuture(future.slice(1));
      setPast((p) => [...p, current]);
      apply(next);
      setSel((s) => s.filter((id) => next.blocks.some((b) => b.id === id)));
    };
    // Goal / action-plan edits save straight away without going into the undo history.
    const saveText = (patch) => apply({ ...planRef.current, ...patch });
    // The weight an athlete used for one set group of a linked program, kept on their plan as programLog[programId][key].
    const logWeight = (programId, key, val) => {
      const all = { ...(planRef.current.programLog || {}) };
      const one = { ...(all[programId] || {}) };
      if (val) one[key] = val; else delete one[key];
      all[programId] = one;
      saveText({ programLog: all });
    };

    const [openProgramBlock, setOpenProgramBlock] = useState(null); // id of the block whose program pop-up is open
    const laneById = (id) => plan.lanes.find((l) => l.id === id);
    const blockColor = (b) => b.color || (laneById(b.lane) ? laneById(b.lane).color : PALETTE[7]);
    const shownBlocks = draft || plan.blocks;
    const selectedBlocks = plan.blocks.filter((b) => sel.includes(b.id));

    const updateBlocks = (ids, patchFn) => {
      commit({ ...planRef.current, blocks: planRef.current.blocks.map((b) => (ids.includes(b.id) ? { ...b, ...patchFn(b) } : b)) });
    };
    const updateBlock = (id, patch) => updateBlocks([id], () => patch);

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
      const blocks = source.blocks.map((b) => ({ ...b, id: uid(), lane: laneMap[b.lane] }));
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
        <PlanHeader athlete={athlete} plan={plan} extra={headerExtra} />

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
              <button className="btn btn-secondary" onClick={printPlan} title="Prints just this plan, scaled to fit one portrait sheet">Print / Save PDF</button>
              {typeof EmailToAthleteButton === "function" && (
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
                      <span className="period-lane-name" title="Double-click to rename" onDoubleClick={() => setRenamingLane(lane.id)}>{lane.name}</span>
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
                              title={`Open the program: ${programById(b.programId).name}`}
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
              <select value={single.programId || ""} onChange={(e) => updateBlock(single.id, { programId: e.target.value || null })}>
                <option value="">— None —</option>
                {single.programId && !programById(single.programId) && <option value={single.programId}>(deleted program)</option>}
                {allPrograms().map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              {single.programId && programById(single.programId) && (
                <button className="btn-link" style={{ marginTop: 6 }} onClick={() => setOpenProgramBlock(single.id)}>Open program</button>
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

        <PlanPrograms plan={plan} onLog={logWeight} />
        {(() => {
          const b = openProgramBlock && plan.blocks.find((x) => x.id === openProgramBlock);
          const program = b && programById(b.programId);
          return program ? <ProgramModal program={program} athlete={athlete} currentNo={currentProgramWeek(plan, b, program)} onClose={() => setOpenProgramBlock(null)} log={(plan.programLog || {})[program.id] || {}} onLog={(key, val) => logWeight(program.id, key, val)} /> : null;
        })()}

        <GoalsSection plan={plan} onSave={saveText} lead={offseasonLead(athlete)} />
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
