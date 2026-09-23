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
    return { startDate: mondayOfToday(), weeks: 16, lanes: defaultLanes(), blocks: [], goals: { physical: [], skill: [] }, actionPlan: "" };
  }

  // Goals and the action plan live on the plan too, but older saved plans don't have them yet.
  const goalsOf = (plan) => ({ physical: (plan.goals && plan.goals.physical) || [], skill: (plan.goals && plan.goals.skill) || [] });
  const actionPlanOf = (plan) => plan.actionPlan || "";
  const hasGoalContent = (plan) => {
    const g = goalsOf(plan);
    return g.physical.length > 0 || g.skill.length > 0 || actionPlanOf(plan).trim().length > 0;
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
  function ReadonlyTimeline({ plan }) {
    const p = planProgress(plan);
    const lanes = plan.lanes.filter((l) => plan.blocks.some((b) => b.lane === l.id));
    const pct = (weeks) => `${(weeks / plan.weeks) * 100}%`;
    return (
      <div className="period-ro">
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
                    title={`${b.label || "Untitled"} · Wk ${b.start + 1}${b.len > 1 ? `–${b.start + b.len}` : ""}${b.notes ? `\n${b.notes}` : ""}`}
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
  function GoalList({ title, items, placeholder, onChange }) {
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
        <h3>{title}{items.length > 0 && <small>{doneCount} of {items.length} achieved</small>}</h3>
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
  // Physical Goals + Skill Goals side by side, then the coach's Action Plan underneath.
  function GoalsSection({ plan, onSave }) {
    const goals = goalsOf(plan);
    return (
      <React.Fragment>
        <div className="panel period-goals">
          <h2>Goals <small>What we're working toward this offseason</small></h2>
          <div className="goal-cols">
            <GoalList title="Physical Goals" items={goals.physical} placeholder="e.g. Add 8 lbs lean mass — press Enter" onChange={(list) => onSave({ goals: { ...goals, physical: list } })} />
            <GoalList title="Skill Goals" items={goals.skill} placeholder="e.g. Develop a usable changeup — press Enter" onChange={(list) => onSave({ goals: { ...goals, skill: list } })} />
          </div>
        </div>
        <div className="panel period-action">
          <h2>Action Plan <small>Rough plan for addressing these goals</small></h2>
          <textarea
            rows={6}
            key={actionPlanOf(plan)}
            defaultValue={actionPlanOf(plan)}
            placeholder="e.g. Phase 1 (wks 1–4): rebuild general strength base, daily shoulder care. Phase 2: add speed work, begin throwing build-up..."
            onBlur={(e) => { if (e.target.value !== actionPlanOf(plan)) onSave({ actionPlan: e.target.value }); }}
            onKeyDown={(e) => e.stopPropagation()}
          />
        </div>
      </React.Fragment>
    );
  }

  // Read-only goals + action plan (profile / team report).
  function GoalsReadOnly({ plan }) {
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
    return (
      <div className="period-goals-ro">
        {(goals.physical.length > 0 || goals.skill.length > 0) && (
          <div className="goal-cols">
            {list("Physical Goals", goals.physical)}
            {list("Skill Goals", goals.skill)}
          </div>
        )}
        {actionPlanOf(plan).trim() && (
          <div className="action-ro">
            <h3>Action Plan</h3>
            <div className="action-ro-text">{actionPlanOf(plan)}</div>
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
        {hasBlocks && <ReadonlyTimeline plan={plan} />}
        {goalsToShow && <GoalsReadOnly plan={plan} />}
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
        return { laneName: name, relStart: b.start - minStart, len: b.len, label: b.label, notes: b.notes, color: b.color || null };
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
      created.push({ id: uid(), lane: lane.id, start, len: Math.min(cb.len, MAX_WEEKS - start), label: cb.label, notes: cb.notes, color: cb.color });
    });
    const weeks = clamp(Math.max(plan.weeks, maxEnd(created)), 1, MAX_WEEKS);
    return { plan: { ...plan, lanes, weeks, blocks: [...plan.blocks, ...created] }, ids: created.map((b) => b.id) };
  }

  // ---- header: athlete photo + team logo (left), title (center), DST logo (right) -------------
  // Also used by the team report (one sheet per athlete) with its own title/subtitle; `onOpen` makes
  // the name a link to the athlete's profile.
  function PlanHeader({ athlete, plan, title = "Individualized Player Plan", subtitle, onOpen }) {
    const [photoBroken, setPhotoBroken] = useState(false);
    const initials = athlete.name.split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
    const showPhoto = !!athlete.photoUrl && !photoBroken;
    const Logo = typeof TeamLogo === "function" ? TeamLogo : null; // shared team-logo component from the main app
    return (
      <div className="panel period-header">
        <div className="ph-left">
          <div className="ph-pics">
            {athlete.team && Logo && <span className="ph-team"><Logo team={athlete.team} size={104} /></span>}
            {showPhoto ? (
              <img className="ph-photo" src={athlete.photoUrl} alt={athlete.name} onError={() => setPhotoBroken(true)} />
            ) : (
              <div className="ph-photo ph-initials">{initials}</div>
            )}
          </div>
          {onOpen ? (
            <button className="ph-name ph-name-link" onClick={onOpen} title="Open this athlete's profile">{athlete.name}</button>
          ) : (
            <div className="ph-name">{athlete.name}</div>
          )}
          {athlete.team && <div className="ph-teamname">{athlete.team}</div>}
        </div>
        <div className="ph-center">
          <h1>{title}</h1>
          <div className="ph-sub">
            {subtitle || (plan ? <React.Fragment>Offseason Periodization &middot; Week 1 starts {fmtMD(plan.startDate)} &middot; {plan.weeks} weeks</React.Fragment> : null)}
          </div>
        </div>
        <div className="ph-right">
          {/* light-lettered copy for the dark screen; the original artwork is swapped in when printing on white paper */}
          <img className="ph-logo-screen" src="assets/dst-logo-light.png" alt="Dynamic Sports Training" />
          <img className="ph-logo-print" src="assets/dst-logo.png" alt="Dynamic Sports Training" />
        </div>
      </div>
    );
  }

  // ---- the board for one athlete -------------------------------------------------------------
  function PlannerBoard({ athlete }) {
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
    const keepText = (snapshot, current) => ({ ...snapshot, goals: current.goals, actionPlan: current.actionPlan });
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
      // "Email to Athlete" snapshots this tab client-side (html2canvas) instead of calling
      // window.print() — no real print happens, so beforeprint/afterprint never fire — these let it
      // drive the same layout prep/cleanup directly (see EmailAthleteComposer in index.html).
      const onRenderPrep = () => preparePrint();
      const onRenderCleanup = () => cleanupPrint();
      window.addEventListener("beforeprint", onBefore);
      window.addEventListener("afterprint", cleanupPrint);
      window.addEventListener("dst-print-plan", onPrintRequest);
      window.addEventListener("dst-render-plan-prep", onRenderPrep);
      window.addEventListener("dst-render-plan-cleanup", onRenderCleanup);
      return () => {
        window.removeEventListener("beforeprint", onBefore);
        window.removeEventListener("afterprint", cleanupPrint);
        window.removeEventListener("dst-print-plan", onPrintRequest);
        window.removeEventListener("dst-render-plan-prep", onRenderPrep);
        window.removeEventListener("dst-render-plan-cleanup", onRenderCleanup);
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
        <PlanHeader athlete={athlete} plan={plan} />

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

        <GoalsSection plan={plan} onSave={saveText} />
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
})();
