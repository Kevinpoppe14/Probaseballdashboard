// Throwing Progression — a week-by-week throwing outline on every athlete's profile (the far-right tab).
// Days run down the side and weeks across, as on the DST throwing progression sheet. Each day is Low (green),
// Medium (yellow), High (red) or OFF. Clicking a day steps it green -> yellow -> red -> off -> green; the pencil
// edits what the day says. Every athlete starts from the same seven-week base and can have weeks added.
// Saved on the athlete's own record as `throwingProgression`, so it needs no table of its own.
(function () {
  const { useState, useEffect, useRef } = React;

  const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const LEVELS = {
    L: { name: "Low Intensity (L)", detail: "60-90ft, 50-60% RPE, 75% Max Velo", cls: "low" },
    M: { name: "Medium Intensity (M)", detail: "90-120ft, 60-75% RPE, 85% Max Velo", cls: "med" },
    H: { name: "High Intensity (H)", detail: "120+ft, 80-100% RPE, 90%+ Max Velo", cls: "high" },
  };
  const NEXT = { L: "M", M: "H", H: "", "": "L" }; // green -> yellow -> red -> off -> green

  // The base program: weeks 1-7 of the sheet, one string per day from Sunday. "" is an off day.
  const BASE = [
    ["", "L 2x20", "", "L 2x20", "", "L 2x20", ""],
    ["L 2x25", "", "L 2x25", "", "L 2x25", "", "L 2x20"],
    ["M 2x20", "", "L 2x25", "M 2x20", "L 2x25", "", "L 3x20"],
    ["M 2x25", "L 3x20", "", "L 3x25", "M 2x25", "L 3x25", ""],
    ["M 2x25", "L 3x20", "M 2x25", "L 3x20", "", "M 3x25", "L 2x25"],
    ["H 2x15", "L 2x30", "", "M 2x25", "L 2x30", "H 2x20", "L 2x30"],
    ["", "M 2x25", "L 2x30", "H 2x20", "L 2x30", "", "M 2x25"],
  ];
  const day = (s) => (s ? { level: s[0], text: s.slice(2) } : { level: "", text: "" });
  const baseWeeks = () => BASE.map((w) => ({ days: w.map(day) }));
  const blankWeek = () => ({ days: DAYS.map(() => ({ level: "", text: "" })) });
  // what a day reads as: "L-2x25", just "M" when nothing is typed, "OFF" when it's off
  const label = (d) => (d.level ? `${d.level}${d.text ? `-${d.text}` : ""}` : "OFF");

  // ---- ACR (acute:chronic workload ratio) ---------------------------------------------------------
  // A day's throws come from what it says: "2x25" is 50, "1x20-25" is 22.5 (the middle of the range), "Pen 1x30"
  // is 30, a lone "40" is 40. Its load is throws x the intensity's weight. A week's ACR is its load (acute)
  // over the average weekly load of the four weeks ending with it (chronic), or of however many weeks exist so far.
  const DEFAULT_WEIGHTS = { L: 1, M: 2, H: 3 };
  const num = (s) => { const m = /^(\d+(?:\.\d+)?)(?:\s*-\s*(\d+(?:\.\d+)?))?$/.exec(s.trim()); return m ? (m[2] ? (parseFloat(m[1]) + parseFloat(m[2])) / 2 : parseFloat(m[1])) : NaN; };
  function throwsOf(d) {
    if (!d || !d.level) return 0;
    const t = d.text || "";
    const sets = /(\d+(?:\.\d+)?(?:\s*-\s*\d+(?:\.\d+)?)?)\s*[x×]\s*(\d+(?:\.\d+)?(?:\s*-\s*\d+(?:\.\d+)?)?)/i.exec(t);
    if (sets) return num(sets[1]) * num(sets[2]);
    const lone = /(\d+(?:\.\d+)?(?:\s*-\s*\d+(?:\.\d+)?)?)/.exec(t);
    return lone ? num(lone[1]) : 0;
  }
  // `actualOf(week, day)` gives the throws the athlete logged for that day in their throwing program (the Throws boxes
  // in the app), or null: a day with throws logged counts what was actually done, any other day what was prescribed.
  // A day's intensity weight is the progression's either way.
  function dayThrows(d, wi, di, actualOf) {
    const a = actualOf ? actualOf(wi, di) : null;
    return a != null ? a : throwsOf(d);
  }
  function weekLoads(weeks, weights, actualOf) {
    const rows = weeks.map((w, wi) => {
      let throws = 0, load = 0, unknown = 0, logged = 0;
      w.days.forEach((d, di) => {
        const a = actualOf ? actualOf(wi, di) : null;
        const n = a != null ? a : throwsOf(d);
        if (a != null) logged += 1;
        else if (d.level && !n) unknown += 1; // a throwing day with no count typed in
        throws += n;
        load += n * (parseFloat(weights[d.level || "M"]) || 0);
      });
      return { throws, load, unknown, logged };
    });
    rows.forEach((r, i) => {
      const window4 = rows.slice(Math.max(0, i - 3), i + 1);
      const chronic = window4.reduce((t, x) => t + x.load, 0) / window4.length;
      r.chronic = chronic;
      r.acr = chronic > 0 ? r.load / chronic : null;
    });
    // Exponentially weighted ACR, worked day by day: each day's average is today's load x lambda plus yesterday's
    // average x (1 - lambda), with lambda = 2 / (N + 1), N = 7 days for acute and 28 for chronic. Recent days
    // count most and older ones fade out instead of dropping off a cliff. Both averages start at week 1's
    // average daily load (so the ratio starts at 1 rather than being thrown off by starting from zero), and each
    // week shows the ratio as it stands at the end of that week.
    const daily = [];
    weeks.forEach((w, wi) => w.days.forEach((d, di) => daily.push(dayThrows(d, wi, di, actualOf) * (parseFloat(weights[d.level || "M"]) || 0))));
    const lamA = 2 / 8, lamC = 2 / 29;
    let acute = rows.length ? rows[0].load / 7 : 0, chronicE = acute;
    daily.forEach((l, k) => {
      acute = l * lamA + (1 - lamA) * acute;
      chronicE = l * lamC + (1 - lamC) * chronicE;
      if (k % 7 === 6) rows[(k - 6) / 7].ewma = chronicE > 0 ? acute / chronicE : null;
    });
    return rows;
  }
  // under 0.8 is detraining, 0.8-1.3 is the target range, 1.3-1.5 is a caution, above 1.5 is a spike
  const acrClass = (v) => (v == null ? "none" : v > 1.5 ? "spike" : v > 1.3 ? "caution" : v >= 0.8 ? "good" : "under");
  // a short fingerprint of the progression, so the builder under it starts over (re-laid out) whenever a day changes
  const hashOf = (s) => { let h = 0; for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0; return h; };
  const round = (v) => (Math.round(v * 10) / 10).toString();

  // ACR week by week, drawn over its bands: blue under 0.8, green for the target range, yellow for caution and
  // red for a spike. Each point carries its value and takes the color of the band it sits in.
  const ACR_COLORS = { under: "#6ea8dc", good: "#34a853", caution: "#fbbc04", spike: "#ea4335", none: "#888" };
  function AcrChart({ loads }) {
    const pts = loads.map((r, i) => ({ i, v: r.acr })).filter((p) => p.v != null);
    const ewma = loads.map((r, i) => ({ i, v: r.ewma })).filter((p) => p.v != null); // dashed line, squares
    if (!pts.length) return null;
    const W = Math.max(360, loads.length * 64 + 70), H = 240, L = 38, R = 14, T = 14, B = 30;
    const top = Math.max(2, Math.ceil(Math.max(...pts.concat(ewma).map((p) => p.v)) * 5) / 5 + 0.2);
    const x = (i) => L + (loads.length === 1 ? (W - L - R) / 2 : (i / (loads.length - 1)) * (W - L - R));
    const y = (v) => T + (1 - Math.min(v, top) / top) * (H - T - B);
    const band = (from, to, cls) => <rect x={L} y={y(to)} width={W - L - R} height={y(from) - y(to)} fill={ACR_COLORS[cls]} opacity="0.22" />;
    const ticks = [0, 0.8, 1.3, 1.5].concat(top >= 2 ? [2] : []);
    return (
      <div className="tp-chart-scroll">
        <svg className="tp-chart" viewBox={`0 0 ${W} ${H}`} style={{ width: W }} role="img" aria-label="ACR by week">
          {band(0, 0.8, "under")}{band(0.8, 1.3, "good")}{band(1.3, 1.5, "caution")}{band(1.5, top, "spike")}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={L} y1={y(t)} x2={W - R} y2={y(t)} className="tp-chart-grid" />
              <text x={L - 6} y={y(t) + 3} textAnchor="end" className="tp-chart-tick">{t}</text>
            </g>
          ))}
          {loads.map((r, i) => <text key={i} x={x(i)} y={H - 10} textAnchor="middle" className="tp-chart-tick">Wk {i + 1}</text>)}
          <polyline points={ewma.map((p) => `${x(p.i)},${y(p.v)}`).join(" ")} className="tp-chart-line tp-chart-ewma" />
          {ewma.map((p) => (
            <g key={`e${p.i}`}>
              <rect x={x(p.i) - 4} y={y(p.v) - 4} width="8" height="8" fill={ACR_COLORS[acrClass(p.v)]} className="tp-chart-dot" />
              <text x={x(p.i)} y={y(p.v) + 17} textAnchor="middle" className="tp-chart-value tp-chart-value-ewma">{p.v.toFixed(2)}</text>
            </g>
          ))}
          <polyline points={pts.map((p) => `${x(p.i)},${y(p.v)}`).join(" ")} className="tp-chart-line" />
          {pts.map((p) => (
            <g key={p.i}>
              <circle cx={x(p.i)} cy={y(p.v)} r="5" fill={ACR_COLORS[acrClass(p.v)]} className="tp-chart-dot" />
              <text x={x(p.i)} y={y(p.v) - 9} textAnchor="middle" className="tp-chart-value">{p.v.toFixed(2)}</text>
            </g>
          ))}
        </svg>
      </div>
    );
  }

  function DayCell({ d, title, onCycle, onText, actual }) {
    const [editing, setEditing] = useState(false);
    const inputRef = useRef(null);
    useEffect(() => { if (editing && inputRef.current) { inputRef.current.focus(); inputRef.current.select(); } }, [editing]);
    const cls = d.level ? LEVELS[d.level].cls : "off";
    if (editing) {
      const done = (v) => { setEditing(false); if (v !== d.text) onText(v); };
      return (
        <td className={`tp-cell ${cls}`}>
          <input
            ref={inputRef}
            className="tp-input"
            defaultValue={d.text}
            placeholder="e.g. 2x25"
            aria-label={`${title}: what to throw`}
            onBlur={(e) => done(e.target.value.trim())}
            onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); if (e.key === "Escape") { e.target.value = d.text; e.target.blur(); } }}
          />
        </td>
      );
    }
    return (
      <td className={`tp-cell ${cls}`}>
        <button type="button" className="tp-day" onClick={onCycle} title={`${title}: click to change the intensity`}>{label(d)}</button>
        <button type="button" className="tp-edit no-print" onClick={() => setEditing(true)} title="Edit what this day says" aria-label={`Edit ${title}`}>✎</button>
        {/* the throws the athlete logged for the day in their throwing program (what the ACR counts for it) */}
        {actual != null && <small className="tp-actual" title={`Logged in the app: ${actual} throws (the ACR counts these for this day)`}>✓ {round(actual)}</small>}
      </td>
    );
  }

  function ThrowingProgressionTab({ athlete }) {
    const store = window.AthleteStore;
    const saved = athlete.throwingProgression && Array.isArray(athlete.throwingProgression.weeks) ? athlete.throwingProgression.weeks : null;
    const [weeks, setWeeks] = useState(() => saved || baseWeeks());
    const [isSaved, setIsSaved] = useState(!!saved); // false while the athlete is still on the untouched base program
    useEffect(() => { setWeeks(saved || baseWeeks()); setIsSaved(!!saved); /* eslint-disable-next-line */ }, [athlete.id]);

    const savedWeights = (athlete.throwingProgression || {}).weights;
    const [weights, setWeights] = useState(() => ({ ...DEFAULT_WEIGHTS, ...(savedWeights || {}) }));
    useEffect(() => { setWeights({ ...DEFAULT_WEIGHTS, ...(savedWeights || {}) }); /* eslint-disable-next-line */ }, [athlete.id]);
    // when Week 1 starts (a Sunday, so each cell is a date) and the throwing program built from it, kept with it
    const metaOf = (a) => { const t = (a && a.throwingProgression) || {}; return { start: t.start || "", programId: t.programId || "" }; };
    const [meta, setMetaState] = useState(() => metaOf(athlete));
    useEffect(() => { setMetaState(metaOf(athlete)); /* eslint-disable-next-line */ }, [athlete.id]);
    const save = (next, nextWeights, nextMeta) => store.updateAthlete(athlete.id, { throwingProgression: { ...((athlete && athlete.throwingProgression) || {}), ...nextMeta, weeks: next, weights: nextWeights } });
    const commit = (next, nextWeights = weights) => {
      setWeeks(next);
      setWeights(nextWeights);
      setIsSaved(true);
      save(next, nextWeights, meta);
    };
    const setMeta = (patch) => { const m = { ...meta, ...patch }; setMetaState(m); setIsSaved(true); save(weeks, weights, m); return m; };
    // what the athlete logged: the throws they wrote in for each day of their throwing program (its Throws boxes)
    const program = meta.programId ? store.allPrograms().find((p) => p.id === meta.programId) : null;
    const plan = store.getPeriodization(athlete.id);
    const log = program && store.programLogFor ? (store.programLogFor(athlete.id, plan) || {})[program.id] || {} : {};
    const actualOf = (wi, di) => {
      const s = program && ((program.weeks || [])[wi] || { sessions: [] }).sessions.find((x) => x.tpDay === di);
      if (!s) return null;
      let n = 0, any = false;
      (s.exercises || []).forEach((e) => { const v = parseFloat(log[`${e.id}|x|throws`]); if (Number.isFinite(v)) { n += v; any = true; } });
      return any ? n : null;
    };
    const loads = weekLoads(weeks, weights, actualOf);
    const dateOf = (wi, di) => { if (!meta.start) return null; const d = new Date(`${meta.start}T12:00:00`); d.setDate(d.getDate() + wi * 7 + di); return d; };
    const md = (d) => (d ? d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "");
    const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const sundayOf = (iso) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() - d.getDay()); return isoOf(d); };

    // ---- the throwing program, built from this progression (speed_builder.js, layout "throwing") -------------------
    // One day for each throwing day here, named and colored by it; the coach fills in the drills. It is the athlete's
    // own program, and goes on their periodization chart in the Throwing row from Week 1's date, so it is the same
    // program in the Programming section and in their app. When the progression changes, its days follow.
    const Kit = window.SpeedKit, Editor = window.SpeedProgramEditor, PL = window.PeriodizationLib, BK = window.ProgramBuilderKit;
    const first = (athlete.name || "").split(/\s+/)[0] || athlete.name;
    const linkToPlan = (prog, start) => {
      if (!PL || !PL.assignProgram || !start || !prog) return;
      const p = store.getPeriodization(athlete.id);
      if (p && (p.blocks || []).some((b) => b.programId === prog.id)) return;
      const mon = new Date(`${start}T12:00:00`); mon.setDate(mon.getDate() + 1); // the plan's weeks run Monday to Sunday
      PL.assignProgram(athlete.id, prog, { startDate: isoOf(mon), laneName: "Throwing" });
    };
    // the block on the chart is as long as the program
    const fitBlock = (prog) => {
      const p = store.getPeriodization(athlete.id), n = (prog.weeks || []).length;
      const b = p && (p.blocks || []).find((x) => x.programId === prog.id);
      if (b && n && b.len !== n) store.setPeriodization(athlete.id, { ...p, weeks: Math.max(p.weeks, b.start + n), blocks: p.blocks.map((x) => (x.id === b.id ? { ...x, len: n } : x)) });
    };
    const createProgram = () => {
      if (!Kit) return;
      const last = BK ? BK.athleteLastName(athlete.name || "") : "";
      const rec = Kit.syncWithProgression(null, { weeks });
      rec.name = `${last ? `${last} - ` : ""}Throwing Program`;
      rec.athleteId = athlete.id;
      const saved = store.saveProgram(rec);
      setMeta({ programId: saved.id });
      linkToPlan(saved, meta.start);
    };
    const autoSave = (rec) => {
      const cur = store.allPrograms().find((p) => p.id === meta.programId) || {};
      const saved = store.saveProgram({ ...cur, ...rec, id: meta.programId, athleteId: athlete.id });
      fitBlock(saved);
      return saved;
    };
    // the progression changed: the program's days follow it (names, colors, days added or taken off), drills kept
    const weeksKey = JSON.stringify(weeks);
    useEffect(() => {
      if (!Kit || !meta.programId) return;
      const cur = store.allPrograms().find((p) => p.id === meta.programId);
      if (!cur) return;
      const synced = Kit.syncWithProgression(cur, { weeks });
      if (JSON.stringify(synced.weeks) !== JSON.stringify(cur.weeks)) { const saved = store.saveProgram({ ...cur, layout: "throwing", weeks: synced.weeks }); fitBlock(saved); }
      /* eslint-disable-next-line */
    }, [weeksKey, meta.programId]);
    const throwingBlock = (() => { const p = plan; const lane = p && (p.lanes || []).find((l) => /throw/i.test(l.name)); const b = lane && (p.blocks || []).filter((x) => x.lane === lane.id).sort((a, c) => a.start - c.start)[0]; return b ? { b, date: (() => { const d = new Date(`${p.startDate}T12:00:00`); d.setDate(d.getDate() + b.start * 7); return d; })() } : null; })();
    const setDay = (wi, di, patch) => commit(weeks.map((w, i) => (i !== wi ? w : { ...w, days: w.days.map((d, j) => (j !== di ? d : { ...d, ...patch })) })));
    const addWeek = () => commit([...weeks, blankWeek()]);
    const removeWeek = (wi) => {
      if (!window.confirm(`Remove Week ${wi + 1}? The weeks after it move up.`)) return;
      commit(weeks.filter((_, i) => i !== wi));
    };
    // every day back to OFF with nothing typed in; the weeks themselves stay
    const clearAll = () => {
      if (!window.confirm(`Clear the whole throwing progression for ${athlete.name}? Every day in all ${weeks.length} week${weeks.length === 1 ? "" : "s"} goes to OFF and its text is erased.`)) return;
      commit(weeks.map(() => blankWeek()));
    };
    const reset = () => {
      if (!window.confirm("Put this athlete back on the base 7-week progression? Their changes will be lost.")) return;
      commit(baseWeeks());
    };

    return (
      <div className="tp-wrap">
        <div className="panel">
          <h2>Throwing Progression <small>Click a day to change its intensity: green, yellow, red, off. Use the pencil to edit what it says.</small></h2>
          <div className="tp-scroll">
            <table className="tp-table">
              <thead>
                <tr>
                  <th />
                  {weeks.map((w, wi) => (
                    <th key={wi}>
                      Week {wi + 1}
                      {meta.start && <small className="tp-week-date">{md(dateOf(wi, 0))}</small>}
                      {weeks.length > 1 && <button type="button" className="tp-remove no-print" onClick={() => removeWeek(wi)} title={`Remove Week ${wi + 1}`} aria-label={`Remove Week ${wi + 1}`}>&times;</button>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {DAYS.map((name, di) => (
                  <tr key={name}>
                    <th className="tp-dayname">{name}</th>
                    {weeks.map((w, wi) => {
                      const d = w.days[di] || { level: "", text: "" };
                      const actual = actualOf(wi, di);
                      return (
                        <DayCell
                          key={wi}
                          d={d}
                          actual={actual}
                          title={`${name}, Week ${wi + 1}${meta.start ? ` (${md(dateOf(wi, di))})` : ""}`}
                          onCycle={() => setDay(wi, di, { level: NEXT[d.level || ""] })}
                          onText={(text) => setDay(wi, di, { text })}
                        />
                      );
                    })}
                  </tr>
                ))}
              </tbody>
              {/* ACR calculator: each week's throws, load, and load against the last four weeks' average */}
              <tfoot>
                <tr className="tp-sum">
                  <th>Throws</th>
                  {loads.map((r, i) => <td key={i} title={r.unknown ? `${r.unknown} throwing day${r.unknown === 1 ? "" : "s"} with no count, left out` : undefined}>{round(r.throws)}{r.unknown ? "*" : ""}</td>)}
                </tr>
                <tr className="tp-sum">
                  <th>Load</th>
                  {loads.map((r, i) => <td key={i} title={`4-week average: ${round(r.chronic)}`}>{round(r.load)}</td>)}
                </tr>
                <tr className="tp-sum tp-acr">
                  <th>ACR (4-wk avg)</th>
                  {loads.map((r, i) => <td key={i} className={acrClass(r.acr)} title={r.acr == null ? "No load yet" : `${round(r.load)} this week / ${round(r.chronic)} four-week average`}>{r.acr == null ? "—" : r.acr.toFixed(2)}</td>)}
                </tr>
                <tr className="tp-sum tp-acr">
                  <th>ACR (EWMA)</th>
                  {loads.map((r, i) => <td key={i} className={acrClass(r.ewma)} title="Exponentially weighted, 7-day acute over 28-day chronic, at the end of this week">{r.ewma == null ? "—" : r.ewma.toFixed(2)}</td>)}
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="tp-actions no-print">
            <button className="btn btn-primary" onClick={addWeek}>+ Add Week</button>
            <button className="btn btn-secondary" onClick={reset}>Reset to base program</button>
            <button className="btn btn-secondary" onClick={clearAll}>Clear all</button>
            <span className="timestamp-note">{isSaved ? `${weeks.length} week${weeks.length === 1 ? "" : "s"} saved for ${athlete.name}.` : "Showing the base program. It saves to this athlete as soon as you change something."}</span>
          </div>
          {/* when Week 1 starts: puts a date on every day, places the program on the chart, and tells Coach Mode what today is */}
          <div className="tp-start no-print">
            <label>Week 1 starts <input type="date" value={meta.start} onChange={(e) => { if (!e.target.value) { setMeta({ start: "" }); return; } const v = sundayOf(e.target.value); setMeta({ start: v }); if (program) linkToPlan(program, v); }} /></label>
            <small>{meta.start ? `Sunday, ${md(new Date(`${meta.start}T12:00:00`))}. Each day has its date, and Coach Mode shows today's throwing.` : "Pick the Sunday Week 1 starts (any day snaps to its Sunday)."}</small>
            {!meta.start && throwingBlock && <button className="btn-link" onClick={() => { const v = sundayOf(isoOf(throwingBlock.date)); setMeta({ start: v }); if (program) linkToPlan(program, v); }}>Use the Throwing row's start ({md(throwingBlock.date)})</button>}
          </div>

          {/* the throwing program built from this progression, under the weeks and above the ACR */}
          <div className="tp-builder">
            <h3>Throwing program <small>the drills for each throwing day above, in {first}'s app</small></h3>
            {!program && (
              <div className="tp-builder-empty no-print">
                <p>Build {first}'s throwing program from this progression: a day for each throwing day, named and colored from it (green Low, yellow Medium, red High). Fill in the drills with sets, reps, distance and ball weight; {first} logs the throws actually made (and distance or velocity where you ask for it), and the ACR above counts what was logged.</p>
                <button className="btn btn-primary" disabled={!Kit} onClick={createProgram}>Build the throwing program</button>
              </div>
            )}
            {program && !meta.start && <p className="timestamp-note">Set when Week 1 starts (above) to put this program on {first}'s periodization chart, in the Throwing row.</p>}
            {program && Editor && Kit && (
              <Editor
                key={`${program.id}|${hashOf(weeksKey)}`}
                kind="throwing"
                embedded
                initial={Kit.syncWithProgression(program, { weeks })}
                autoSave={autoSave}
              />
            )}
          </div>
          <div className="tp-acr-help">
            <strong>ACR calculator</strong>
            <p>
              ACR (4-wk avg) is a week's throwing load divided by the average weekly load of the last four weeks (including that week).
              ACR (EWMA) is the exponentially weighted version: a 7-day average over a 28-day average, worked day by day so
              recent days count most, shown as it stands at the end of each week.
              Load is throws times the intensity weight below; a day's throws are read from its text, so "2x25" counts as 50.
              {loads.some((r) => r.unknown) && " Weeks marked * have a throwing day with no count typed in, which is left out."}
            </p>
            <div className="tp-weights no-print">
              {Object.keys(LEVELS).map((k) => (
                <label key={k} className={`tp-key ${LEVELS[k].cls}`}>
                  {k} weight
                  <input
                    key={weights[k]}
                    defaultValue={weights[k]}
                    inputMode="decimal"
                    aria-label={`${LEVELS[k].name} weight`}
                    onBlur={(e) => { const v = parseFloat(e.target.value); if (v >= 0 && v !== weights[k]) commit(weeks, { ...weights, [k]: v }); else e.target.value = weights[k]; }}
                    onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }}
                  />
                </label>
              ))}
            </div>
            <AcrChart loads={loads} />
            <div className="tp-acr-key">
              <span className="tp-chart-legend"><i className="solid" />4-wk avg (circles)</span>
              <span className="tp-chart-legend"><i className="dashed" />EWMA (squares)</span>
              <span className="tp-acr-chip under">Under 0.8: Detraining</span>
              <span className="tp-acr-chip good">0.8 to 1.3: target</span>
              <span className="tp-acr-chip caution">1.3 to 1.5: caution</span>
              <span className="tp-acr-chip spike">Over 1.5: spike</span>
            </div>
          </div>
          <div className="tp-glossary">
            <strong>Glossary</strong>
            {Object.keys(LEVELS).map((k) => <span key={k} className={`tp-key ${LEVELS[k].cls}`}>{LEVELS[k].name} - {LEVELS[k].detail}</span>)}
          </div>
        </div>

        <div className="panel tp-about">
          <h2>What ACR and EWMA mean <small>and why they matter</small></h2>
          <h3>Acute:Chronic Workload Ratio (ACR)</h3>
          <p>
            ACR compares how much an athlete has thrown recently with how much they are used to throwing. The acute
            load is the last week of throwing. The chronic load is the average week over the last four, which stands
            in for what the arm is prepared for. Dividing the first by the second gives the ratio.
          </p>
          <ul>
            <li><strong>Around 1.0</strong> means this week matches what the arm has been built up to.</li>
            <li><strong>0.8 to 1.3</strong> is the target range: enough work to keep building without a jump.</li>
            <li><strong>Above 1.3</strong> means the week is well beyond recent work. Above 1.5 is a spike.</li>
            <li><strong>Below 0.8 (Detraining)</strong> means the athlete is doing much less than they are prepared for and is losing what they built.</li>
          </ul>
          <h3>Exponentially Weighted Moving Average (EWMA)</h3>
          <p>
            The four-week average treats a throw from 27 days ago the same as one from yesterday, and then drops it
            completely on day 29. EWMA fixes that by weighting each day: yesterday counts most, and every day before
            it counts a little less. The acute side follows the last week or so closely, while the chronic side moves
            slowly across about a month. The ratio reacts sooner to a hard day and does not swing when an old week
            falls out of the window.
          </p>
          <h3>Why it matters</h3>
          <p>
            Arms adapt to load that builds gradually. Most throwing problems in a build-up come from doing too much
            too soon, not from the total amount of throwing. ACR puts a number on "too soon": it shows when a planned
            week asks for more than recent weeks have prepared the athlete for, while there is still time to change it.
            It also shows the opposite, a stretch of time off that leaves an athlete under-prepared for the next hard week.
          </p>
          <p>
            Use it as a planning check, not a verdict. The ratio only knows what is entered here, so throwing done
            elsewhere is not counted, and the first few weeks of any progression read high because there is little
            history to compare against. How the athlete's arm feels and recovers still comes first.
          </p>
        </div>
      </div>
    );
  }

  window.ThrowingProgressionTab = ThrowingProgressionTab;
})();
