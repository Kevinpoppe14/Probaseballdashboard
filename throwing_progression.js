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

    const commit = (next) => {
      setWeeks(next);
      setIsSaved(true);
      store.updateAthlete(athlete.id, { throwingProgression: { weeks: next } });
    };
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
            </table>
          </div>
          <div className="tp-actions no-print">
            <button className="btn btn-primary" onClick={addWeek}>+ Add Week</button>
            <button className="btn btn-secondary" onClick={reset}>Reset to base program</button>
            <span className="timestamp-note">{isSaved ? `${weeks.length} week${weeks.length === 1 ? "" : "s"} saved for ${athlete.name}.` : "Showing the base program. It saves to this athlete as soon as you change something."}</span>
          </div>
          <div className="tp-glossary">
            <strong>Glossary</strong>
            {Object.keys(LEVELS).map((k) => <span key={k} className={`tp-key ${LEVELS[k].cls}`}>{LEVELS[k].name} - {LEVELS[k].detail}</span>)}
          </div>
        </div>
      </div>
    );
  }

  window.ThrowingProgressionTab = ThrowingProgressionTab;
})();
