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
  function weekLoads(weeks, weights) {
    const rows = weeks.map((w) => {
      let throws = 0, load = 0, unknown = 0;
      w.days.forEach((d) => {
        const n = throwsOf(d);
        if (d.level && !n) unknown += 1; // a throwing day with no count typed in
        throws += n;
        load += n * (parseFloat(weights[d.level]) || 0);
      });
      return { throws, load, unknown };
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
    weeks.forEach((w) => w.days.forEach((d) => daily.push(throwsOf(d) * (parseFloat(weights[d.level]) || 0))));
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

  function DayCell({ d, title, onCycle, onText }) {
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
    const commit = (next, nextWeights = weights) => {
      setWeeks(next);
      setWeights(nextWeights);
      setIsSaved(true);
      store.updateAthlete(athlete.id, { throwingProgression: { weeks: next, weights: nextWeights } });
    };
    const loads = weekLoads(weeks, weights);
    const setDay = (wi, di, patch) => commit(weeks.map((w, i) => (i !== wi ? w : { ...w, days: w.days.map((d, j) => (j !== di ? d : { ...d, ...patch })) })));
    const addWeek = () => commit([...weeks, blankWeek()]);
    const removeWeek = (wi) => {
      if (!window.confirm(`Remove Week ${wi + 1}? The weeks after it move up.`)) return;
      commit(weeks.filter((_, i) => i !== wi));
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
                      return (
                        <DayCell
                          key={wi}
                          d={d}
                          title={`${name}, Week ${wi + 1}`}
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
            <span className="timestamp-note">{isSaved ? `${weeks.length} week${weeks.length === 1 ? "" : "s"} saved for ${athlete.name}.` : "Showing the base program. It saves to this athlete as soon as you change something."}</span>
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
