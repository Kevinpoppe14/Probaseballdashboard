// "Progress across the weeks" for the program builder (index.html, StandardProgramEditor; the ↗ on a day, and
// "Progress the A series" on a label). One day of the program, every week side by side: a row per exercise
// (matched by its label, A1, A2, B1…, as the builder lines the weeks up), a column per week, with that week's sets,
// reps and intensity to change in place. It can be narrowed to one series (the A's, the B's…).
// Each row's menu fills the later weeks from the first week the exercise is in: the same every week, or one field
// stepped each week (intensity +2.5 / +5 / -5, +1 / -1 for RPE and RIR, reps +1 / -1 / -2, sets +1 / -1), leaving
// the others as they are, so steps add up (reps -1, then intensity +5). The menu above the table does the same to
// every row shown. Changes go straight into the program and Ctrl+Z (or Undo) steps back.
// Needs program_table.js (ProgramTableKit.parseIntensity).
(function () {
  const { useState, useEffect } = React;
  const bare = (l) => (l || "").replace(/\.$/, "");
  const letterOf = (l) => bare(l).replace(/\d+$/, "");
  const blank = () => ({ sets: "", reps: "", intensity: "" });
  const linesOf = (ex) => { const g = window.ProgramRx.normalize(ex).groups; return g && g.length ? g : [blank()]; };
  const ensure = (e) => { if (!Array.isArray(e.groups)) Object.assign(e, window.ProgramRx.normalize(e)); if (!e.groups.length) e.groups = [blank()]; };
  // every number in a value moved by `by` (70-75 +5 → 75-80, 8E +1 → 9E), never below zero; blank stays blank
  const shift = (v, by) => `${v || ""}`.replace(/\d+(?:\.\d+)?/g, (n) => String(Math.max(0, Math.round((Number(n) + by) * 10) / 10)));

  const TOOLS = [
    ["same", "Same as the first week, every week"],
    ["int:2.5", "Intensity +2.5 each week"],
    ["int:5", "Intensity +5 each week"],
    ["int:-5", "Intensity −5 each week"],
    ["int:1", "Intensity +1 each week (RPE / RIR)"],
    ["int:-1", "Intensity −1 each week (RPE / RIR)"],
    ["reps:1", "Reps +1 each week"],
    ["reps:-1", "Reps −1 each week"],
    ["reps:-2", "Reps −2 each week"],
    ["sets:1", "Sets +1 each week"],
    ["sets:-1", "Sets −1 each week"],
  ];
  const FIELD = { int: "intensity", reps: "reps", sets: "sets" };

  // the labels on this day in any week, in order (A1, A2, B1…), and each week's exercise at a label
  const labelKey = (l) => { const m = /^([A-Za-z]+)(\d+)/.exec(l || ""); return m ? [m[1].length, m[1].toUpperCase(), Number(m[2])] : [99, "", 0]; };
  const rowsOf = (weeks, si) => {
    const all = [...new Set(weeks.flatMap((w) => { const s = (w.sessions || [])[si]; return s ? window.exerciseLabels(s.exercises) : []; }))];
    return all.sort((a, b) => { const x = labelKey(a), y = labelKey(b); return x[0] - y[0] || x[1].localeCompare(y[1]) || x[2] - y[2]; });
  };
  const indexAt = (session, label) => (session ? window.exerciseLabels(session.exercises).indexOf(label) : -1);

  // a week's intensity, typed with its unit (75%, RPE 8, 2 RIR), saved when the box is left
  function IntBox({ ex, g, onCommit }) {
    const [txt, setTxt] = useState(null);
    const shown = window.ProgramRx.intensityText(ex, g);
    const unit = window.ProgramRx.normalize(ex).intensityUnit;
    return (
      <input className="pp-in pp-int" value={txt !== null ? txt : shown} placeholder={unit && unit !== "%" ? unit : "%"} title="Intensity with its unit: 75%, RPE 8, 2 RIR, or a weight: 135 lb, 60 kg"
        onChange={(e) => setTxt(e.target.value)} onBlur={() => { if (txt !== null && txt.trim() !== shown) onCommit(txt); setTxt(null); }} />
    );
  }

  function ProgramProgressDialog({ weeks, si, letter, onLetter, edit, undo, canUndo, onClose }) {
    const [note, setNote] = useState("");
    useEffect(() => {
      // (Ctrl+Z needs nothing here: keys in the pop-up reach the builder it's drawn from, whose Ctrl+Z undoes)
      const onKey = (e) => { if (e.key === "Escape") onClose(); };
      document.addEventListener("keydown", onKey);
      return () => document.removeEventListener("keydown", onKey);
    });
    const first = weeks.find((w) => (w.sessions || [])[si]);
    const dayName = (first && first.sessions[si].name) || `Day ${si + 1}`;
    const allRows = rowsOf(weeks, si);
    const letters = [...new Set(allRows.map(letterOf))];
    const rows = letter ? allRows.filter((l) => letterOf(l) === letter) : allRows;
    const exAt = (wk, label) => { const s = (wk.sessions || [])[si], i = indexAt(s, label); return i >= 0 ? s.exercises[i] : null; };
    const parseIntensity = window.ProgramTableKit.parseIntensity;

    const setLine = (wi, label, gi, field, v) => edit((d) => {
      const s = d.weeks[wi].sessions[si], e = s.exercises[indexAt(s, label)];
      ensure(e);
      if (field === "intensity") {
        const pi = parseIntensity(v);
        e.groups[gi].intensity = pi.value;
        if (pi.unit) e.intensityUnit = pi.unit; else if (pi.value && !e.intensityUnit) e.intensityUnit = "%";
      } else e.groups[gi][field] = v;
    });
    const addLine = (wi, label) => edit((d) => { const s = d.weeks[wi].sessions[si], e = s.exercises[indexAt(s, label)]; ensure(e); e.groups.push(blank()); });
    const dropLine = (wi, label, gi) => edit((d) => { const s = d.weeks[wi].sessions[si], e = s.exercises[indexAt(s, label)]; ensure(e); if (e.groups.length > 1) e.groups.splice(gi, 1); });

    // fill the later weeks from the first week this exercise is in
    const applyTool = (labels, tool) => {
      let changed = 0;
      edit((d) => labels.forEach((label) => {
        const base = d.weeks.findIndex((w) => exAt(w, label));
        if (base < 0) return;
        const from = exAt(d.weeks[base], label);
        const baseLines = JSON.parse(JSON.stringify(linesOf(from)));
        d.weeks.forEach((w, wi) => {
          if (wi <= base) return;
          const e = exAt(w, label);
          if (!e) return;
          const step = wi - base;
          if (tool === "same") {
            e.groups = JSON.parse(JSON.stringify(baseLines));
            e.intensityUnit = window.ProgramRx.normalize(from).intensityUnit;
          } else {
            // only that field changes (so "reps −1" then "intensity +5" both stick); a line the week doesn't have yet
            // is copied from the first week
            const [what, amount] = tool.split(":"), f = FIELD[what];
            ensure(e);
            baseLines.forEach((g, i) => {
              if (!e.groups[i]) e.groups[i] = JSON.parse(JSON.stringify(g));
              if (`${g[f] || ""}`.trim()) e.groups[i][f] = shift(g[f], Number(amount) * step);
            });
            if (what === "int") e.intensityUnit = window.ProgramRx.normalize(from).intensityUnit;
          }
          changed += 1;
        });
      }));
      const name = (TOOLS.find(([k]) => k === tool) || [])[1] || "";
      setNote(changed || labels.length ? `${name}: done from the first week each exercise is in. Ctrl+Z or Undo steps back.` : "");
    };
    const toolMenu = (labels, all) => (
      <select className="pp-tool" value="" title={all ? "Fill the later weeks of every row shown from its first week" : "Fill the later weeks from the first week"} onChange={(e) => e.target.value && applyTool(labels, e.target.value)}>
        <option value="" disabled hidden>{all ? "Progress every row…" : "Progress…"}</option>
        {TOOLS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
      </select>
    );

    return ReactDOM.createPortal(
      <div className="zoom-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="zoom-modal pp-dialog" role="dialog" aria-label={`Progress ${dayName} across the weeks`}>
          <div className="pp-head">
            <h2>Progress {dayName}{letter ? `, the ${letter} series,` : ""} across the weeks</h2>
            <button className="btn-link pp-close" title="Close (Esc)" onClick={onClose}>✕</button>
          </div>
          <div className="pp-bar">
            <span className="pp-chips" role="group" aria-label="Show">
              <button className={`pp-chip ${!letter ? "on" : ""}`} onClick={() => onLetter(null)}>Whole day</button>
              {letters.map((l) => <button key={l} className={`pp-chip ${letter === l ? "on" : ""}`} onClick={() => onLetter(l)}>{l}</button>)}
            </span>
            {toolMenu(rows, true)}
            <button className="btn btn-small-grey" disabled={!canUndo} onClick={undo} title="Undo (Ctrl+Z)">↶ Undo</button>
            {note && <span className="pp-note">{note}</span>}
          </div>
          <div className="pp-scroll">
            <table className="pp-table">
              <thead>
                <tr>
                  <th className="pp-exh">Exercise</th>
                  {weeks.map((w, wi) => <th key={wi} className="pp-wk">{w.name || `Week ${wi + 1}`}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((label) => {
                  const firstEx = weeks.map((w) => exAt(w, label)).find(Boolean);
                  return (
                    <tr key={label} className={/1\.$/.test(label) ? "pp-blockstart" : ""}>
                      <th className="pp-ex">
                        <span className="pp-label">{bare(label)}</span>
                        <span className="pp-name">{(firstEx && firstEx.name) || "—"}</span>
                        {toolMenu([label])}
                      </th>
                      {weeks.map((w, wi) => {
                        const ex = exAt(w, label);
                        if (!ex) return <td key={wi} className="pp-none">—</td>;
                        const lines = linesOf(ex);
                        const otherName = firstEx && (ex.name || "").trim() && ex.name.trim() !== (firstEx.name || "").trim();
                        return (
                          <td key={wi}>
                            {otherName && <div className="pp-other" title="A different exercise in this week">{ex.name}</div>}
                            {lines.map((g, gi) => (
                              <div className="pp-line" key={gi}>
                                <input className="pp-in pp-sets" value={g.sets || ""} placeholder="sets" title="Sets" onChange={(e) => setLine(wi, label, gi, "sets", e.target.value)} />
                                <span>×</span>
                                <input className="pp-in pp-reps" value={g.reps || ""} placeholder="reps" title="Reps" onChange={(e) => setLine(wi, label, gi, "reps", e.target.value)} />
                                <IntBox ex={ex} g={g} onCommit={(v) => setLine(wi, label, gi, "intensity", v)} />
                                {lines.length > 1 && <button className="btn-link pp-x" tabIndex={-1} title="Remove this set line" onClick={() => dropLine(wi, label, gi)}>✕</button>}
                              </div>
                            ))}
                            <button className="btn-link pp-addline" tabIndex={-1} title="Another line of sets in this week" onClick={() => addLine(wi, label)}>+ line</button>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>,
      document.body
    );
  }

  window.ProgramProgressDialog = ProgramProgressDialog;
})();
