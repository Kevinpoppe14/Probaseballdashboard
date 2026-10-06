// Pitching Assessment — a digital version of the "Assessment" tab of the DST Pitching Assessment sheet
// (DST Mechanical Analysis). Shown as a tab on a pitcher's profile and works like the Biomechanical Assessment
// (assessment.js): an athlete can have several, each dated, saved as you go. Records live in the same
// assessments table, marked kind: "pitching" so the two kinds never mix (see getPitchingAssessments in store.js).
(function () {
  const { useState, useEffect, useRef } = React;

  const uid = () => `pa-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const fmtDate = (key) => { if (!key) return "No date"; const d = new Date(`${key}T00:00:00`); return isNaN(d) ? key : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); };
  const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  // Mechanical checkpoints, grouped and ordered as on the sheet: `left` groups fill the first column, the rest the second.
  const GROUPS = [
    { key: "setup", name: "Setup & First Move", left: true, tests: ["Starting position (feet, posture, etc.)", "Leg lift & Initial weight Shift"] },
    { key: "backleg", name: "Back Leg", left: true, tests: ["Engages rear glute", "Pushing / Over extending back leg", "Vertical shin angle vs. early hip IR", "Stays in heel / not rising on toes early", "Directionality of drive (open, closed, etc)", "Comes out of drive early", "Lunging / overstriding", "Back knee drives down into landing", "Foot maintains ground contact at release", "Lateral vs. vertical ground reaction force"] },
    { key: "arm", name: "Throwing Arm", left: true, tests: ["Throwing uphill / shoulder tilt", "Arm swing captures momentum", "Overly pronated / supinated", "Overly flexed / extended wrist", "Elbow in line with shoulders at landing", "Late / Early Flip Up", "Elbow flexion 90 +/- 10 degrees", "Full Scap Retraction / Abduction", "Arm drag", "Limited layback", "Elbow pushes forward", "Straight elbow, neutral wrist at release", "Arm works independently of torso"] },
    { key: "misc", name: "Miscellaneous", left: true, tests: ["Overall Tempo", "Overall Rhythm", "Overall Kinematic Sequencing", "Properly Timed Intent", "Cervical position / dissociation"] },
    { key: "pelvis", name: "Pelvis", tests: ["Hips clear into landing", "Rotating down vs. spinning into landing", "Moves independently of torso"] },
    { key: "torso", name: "Torso", tests: ["Excessive counter rotation", "Early torso rotation", "Torso doesn't segment from pelvis", "Bow-flex-bow", "Scapular dig (engaging lateral line)", "Arm lag / reflexive pec fire", "Arm slot matches torso rotation", "Rotates perpendicular to spine", "Excessive tilt / rotation into release"] },
    { key: "glove", name: "Glove Arm", tests: ["Early supination / swimming", "Works in opposition to arm side", "Retraction / abduction at landing", "Rotates into plane of shoulder rotation"] },
    { key: "leadleg", name: "Lead Leg", tests: ["Leaks open early", "Front foot contact (toe, heel, etc.)", "Rotates down into landing", "Pawback mechanism", "Knee stabilization - frontal plane", "Knee stabilization - transverse plane"] },
    { key: "decel", name: "Deceleration", tests: ["Forearm pronates through the ball", "Shoulder Internally rotates", "Scap Releases into Protraction", "Thoracic Flexion-Rotation", "No violent recoil or arm slam"] },
  ];
  const checkKey = (g, test) => `${g.key}:${slug(test)}`;
  // The sheet's five columns run from Good to Red Flag, with Possible Issue in the middle.
  const RATINGS = [
    { v: 1, label: "Good", color: "#2e9e4f" },
    { v: 2, label: "Between Good and Possible Issue", color: "#9bc53d" },
    { v: 3, label: "Possible Issue", color: "#e6b800" },
    { v: 4, label: "Between Possible Issue and Red Flag", color: "#e67e22" },
    { v: 5, label: "Red Flag", color: "#c0392b" },
  ];
  const PITCHES = ["4Seam", "2 Seam/SNK", "Cutter", "Changeup", "Splitter", "Curveball", "Slider", "Sweeper", "Slurve", "Other", "Other"];
  const PITCH_COLORS = ["#e63946", "#f4a261", "#8d5524", "#2a9d8f", "#3a86ff", "#8338ec", "#ffbe0b", "#06d6a0", "#ff006e", "#999999", "#555555"];
  const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

  function newPitchingAssessment(athleteId) {
    return {
      id: uid(), kind: "pitching", athleteId, date: todayKey(), coach: "", grade: "",
      checks: {}, // checkpoint key -> 1 (Good) .. 5 (Red Flag)
      injuryHistory: "",
      pitches: PITCHES.map((name) => ({ name, ivb: "", hzb: "" })),
      primaryFocus: "", secondaryFocus: "", drills: ["", "", "", ""],
      velo: { initialPulldown: "", initialMound: "", exitPulldown: "", exitMound: "" },
      throwing: {}, // weekday -> what they typically throw that day
      plyos: "", plyosNote: "",
    };
  }
  // Fills in anything missing from an older record, so a field added later never breaks a saved assessment.
  const withDefaults = (rec, athleteId) => {
    const base = newPitchingAssessment(athleteId);
    const out = { ...base, ...rec, velo: { ...base.velo, ...(rec.velo || {}) }, throwing: { ...(rec.throwing || {}) }, checks: { ...(rec.checks || {}) } };
    out.pitches = base.pitches.map((p, i) => ({ ...p, ...((rec.pitches || [])[i] || {}) }));
    out.drills = base.drills.map((d, i) => (rec.drills || [])[i] || "");
    return out;
  };

  // One checkpoint's rating: five boxes from Good to Red Flag. Click one to pick it; click it again to clear.
  function RatingCells({ value, onChange }) {
    return RATINGS.map((r) => (
      <td key={r.v} className="pa-rate-cell">
        <button
          type="button"
          className={`pa-rate${value === r.v ? " on" : ""}`}
          style={value === r.v ? { background: r.color, borderColor: r.color } : undefined}
          title={r.label}
          aria-label={r.label}
          aria-pressed={value === r.v}
          onClick={() => onChange(value === r.v ? 0 : r.v)}
        >{value === r.v ? "✓" : ""}</button>
      </td>
    ));
  }

  function CheckGroup({ group, rec, set }) {
    return (
      <React.Fragment>
        {group.tests.map((t, i) => (
          <tr key={t}>
            {i === 0 && <th className="pa-group" rowSpan={group.tests.length}>{group.name}</th>}
            <td className="pa-test">{t}</td>
            <RatingCells value={rec.checks[checkKey(group, t)] || 0} onChange={(v) => set(["checks", checkKey(group, t)], v)} />
          </tr>
        ))}
      </React.Fragment>
    );
  }

  function CheckTable({ groups, rec, set }) {
    return (
      <table className="assess-table pa-table">
        <thead>
          <tr><th>Mechanical Checkpoints</th><th>Test</th><th className="pa-h-good">Good</th><th /><th className="pa-h-issue">Possible Issue</th><th /><th className="pa-h-flag">Red Flag</th></tr>
        </thead>
        <tbody>{groups.map((g) => <CheckGroup key={g.key} group={g} rec={rec} set={set} />)}</tbody>
      </table>
    );
  }

  // Pitch movement plot: horizontal break across, induced vertical break up, one dot per pitch with both numbers.
  function MovementPlot({ pitches }) {
    const S = 300, P = 28, R = 30; // size, padding, axis range (+/- inches)
    const x = (v) => P + ((v + R) / (2 * R)) * (S - 2 * P);
    const y = (v) => P + ((R - v) / (2 * R)) * (S - 2 * P);
    const ticks = [-30, -20, -10, 0, 10, 20, 30];
    const points = pitches.map((p, i) => ({ ...p, i, h: parseFloat(p.hzb), v: parseFloat(p.ivb) })).filter((p) => !isNaN(p.h) && !isNaN(p.v));
    const clamp = (v) => Math.max(-R, Math.min(R, v));
    return (
      <svg className="pa-plot" viewBox={`0 0 ${S} ${S}`} role="img" aria-label="Pitch movement plot: horizontal break by induced vertical break">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} y1={y(-R)} x2={x(t)} y2={y(R)} className={t === 0 ? "pa-axis" : "pa-grid"} />
            <line x1={x(-R)} y1={y(t)} x2={x(R)} y2={y(t)} className={t === 0 ? "pa-axis" : "pa-grid"} />
            {t !== 0 && <text x={x(t)} y={y(0) + 11} className="pa-tick" textAnchor="middle">{t}</text>}
            {t !== 0 && <text x={x(0) - 4} y={y(t) + 3} className="pa-tick" textAnchor="end">{t}</text>}
          </g>
        ))}
        <text x={S / 2} y={S - 4} className="pa-axis-label" textAnchor="middle">HZB (in)</text>
        <text x={10} y={S / 2} className="pa-axis-label" textAnchor="middle" transform={`rotate(-90 10 ${S / 2})`}>IVB (in)</text>
        {points.map((p) => (
          <g key={p.i}>
            <circle cx={x(clamp(p.h))} cy={y(clamp(p.v))} r={6} fill={PITCH_COLORS[p.i]} stroke="#000" strokeWidth="0.75" />
            <text x={x(clamp(p.h)) + 8} y={y(clamp(p.v)) + 3} className="pa-point-label">{p.name}</text>
          </g>
        ))}
      </svg>
    );
  }

  function PitchingForm({ record, athlete, onSave }) {
    const [rec, setRec] = useState(record);
    const saveTimer = useRef(null);
    const first = useRef(true);
    useEffect(() => {
      if (first.current) { first.current = false; return; } // nothing changed yet
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => onSave(rec), 400);
      return () => clearTimeout(saveTimer.current);
      // eslint-disable-next-line
    }, [rec]);
    const set = (path, value) => {
      setRec((prev) => {
        const next = JSON.parse(JSON.stringify(prev));
        let obj = next;
        for (let i = 0; i < path.length - 1; i++) obj = obj[path[i]];
        if (value === 0 && path[0] === "checks") delete obj[path[path.length - 1]];
        else obj[path[path.length - 1]] = value;
        return next;
      });
    };
    const text = (path, props) => {
      const v = path.reduce((o, k) => (o == null ? "" : o[k]), rec) || "";
      return <input value={v} onChange={(e) => set(path, e.target.value)} {...props} />;
    };
    const area = (path, rows) => <textarea rows={rows} value={path.reduce((o, k) => o[k], rec) || ""} onChange={(e) => set(path, e.target.value)} />;

    // what stands out: every checkpoint marked past Possible Issue, worst first
    const flagged = [];
    GROUPS.forEach((g) => g.tests.forEach((t) => { const v = rec.checks[checkKey(g, t)]; if (v >= 3) flagged.push({ g: g.name, t, v }); }));
    flagged.sort((a, b) => b.v - a.v);
    const rated = Object.keys(rec.checks).length, total = GROUPS.reduce((n, g) => n + g.tests.length, 0);

    return (
      <div className="assess-form pa-form">
        <div className="panel assess-header">
          <div className="assess-print-logo"><img src="assets/dst-logo.png" alt="Dynamic Sports Training" /></div>
          <div className="assess-header-grid pa-header-grid">
            <div className="field"><label>Name</label><input value={athlete.name} disabled /></div>
            <div className="field"><label>Date</label><input type="date" value={rec.date} onChange={(e) => set(["date"], e.target.value)} /></div>
            <div className="field"><label>Position</label><input value={athlete.position || ""} disabled /></div>
            <div className="field"><label>Grade</label>{text(["grade"])}</div>
            <div className="field"><label>Coach</label>{text(["coach"], { placeholder: "Coach name" })}</div>
          </div>
        </div>

        <div className="assess-columns pa-columns">
          <div className="assess-col">
            <div className="panel">
              <h2>DST Mechanical Analysis <small>{rated} of {total} rated</small></h2>
              <CheckTable groups={GROUPS.filter((g) => g.left)} rec={rec} set={set} />
            </div>
          </div>
          <div className="assess-col">
            <div className="panel">
              <h2>DST Mechanical Analysis <small>continued</small></h2>
              <CheckTable groups={GROUPS.filter((g) => !g.left)} rec={rec} set={set} />
            </div>
            <div className="panel">
              <h2>Flags <small>checkpoints marked Possible Issue or worse</small></h2>
              {flagged.length === 0 ? <p className="assess-row-note">Nothing flagged yet.</p> : (
                <ul className="pa-flags">
                  {flagged.map((f) => (
                    <li key={f.g + f.t}><span className="pa-dot" style={{ background: RATINGS[f.v - 1].color }} />{f.g}: {f.t} <small>{f.v === 5 ? "Red Flag" : f.v === 3 ? "Possible Issue" : "Between"}</small></li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>

        <div className="assess-columns pa-columns pa-plan">
          <div className="assess-col">
            <div className="panel">
              <h2>Pitch Movement Plot</h2>
              <div className="pa-movement">
                <MovementPlot pitches={rec.pitches} />
                <table className="assess-table pa-pitches">
                  <thead><tr><th>Pitch Selection</th><th>IVB</th><th>HZB Break</th></tr></thead>
                  <tbody>
                    {rec.pitches.map((p, i) => (
                      <tr key={i}>
                        <td><span className="pa-dot" style={{ background: PITCH_COLORS[i] }} />{i >= 9 ? text(["pitches", i, "name"], { "aria-label": "Pitch name" }) : p.name}</td>
                        <td>{text(["pitches", i, "ivb"], { inputMode: "decimal", "aria-label": `${p.name} IVB` })}</td>
                        <td>{text(["pitches", i, "hzb"], { inputMode: "decimal", "aria-label": `${p.name} HZB` })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="panel">
              <h2>Injury History</h2>
              {area(["injuryHistory"], 4)}
            </div>
          </div>
          <div className="assess-col">
            <div className="panel">
              <h2>Development Plan</h2>
              <div className="field"><label>Primary Focus</label>{area(["primaryFocus"], 3)}</div>
              <div className="field"><label>Secondary Focus</label>{area(["secondaryFocus"], 3)}</div>
              {rec.drills.map((d, i) => <div className="field" key={i}><label>Drill Focus {i + 1}</label>{text(["drills", i])}</div>)}
            </div>
            <div className="panel">
              <h2>Velocity</h2>
              <div className="pa-velo">
                <div className="field"><label>Initial Velo: Pulldown</label>{text(["velo", "initialPulldown"], { inputMode: "decimal" })}</div>
                <div className="field"><label>Initial Velo: Mound</label>{text(["velo", "initialMound"], { inputMode: "decimal" })}</div>
                <div className="field"><label>Exit Velo: Pulldown</label>{text(["velo", "exitPulldown"], { inputMode: "decimal" })}</div>
                <div className="field"><label>Exit Velo: Mound</label>{text(["velo", "exitMound"], { inputMode: "decimal" })}</div>
              </div>
            </div>
            <div className="panel">
              <h2>Typical Throwing</h2>
              <div className="pa-week">
                {DAYS.map((d) => <div className="field" key={d}><label>{d}</label>{text(["throwing", d])}</div>)}
              </div>
              <div className="field" style={{ marginTop: 10 }}>
                <label>Familiarity with Plyos</label>
                <div className="pa-plyos">
                  {["1", "2", "3", "4", "5"].map((n) => (
                    <button type="button" key={n} className={`pill-tab ${rec.plyos === n ? "active" : ""}`} onClick={() => set(["plyos"], rec.plyos === n ? "" : n)}>{n}</button>
                  ))}
                  {text(["plyosNote"], { placeholder: "Notes" })}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  function PitchingAssessmentTab({ athlete }) {
    const store = window.AthleteStore;
    const [list, setList] = useState(() => store.getPitchingAssessments(athlete.id));
    const [selectedId, setSelectedId] = useState(() => { const l = store.getPitchingAssessments(athlete.id); return l.length ? l[l.length - 1].id : null; });
    const found = list.find((a) => a.id === selectedId) || null;
    const record = found ? withDefaults(found, athlete.id) : null;
    const wrapRef = useRef(null);
    const refresh = () => setList(store.getPitchingAssessments(athlete.id));
    const handleSave = (next) => { store.saveAssessment(next); refresh(); };
    const addNew = () => {
      const rec = newPitchingAssessment(athlete.id);
      store.saveAssessment(rec);
      refresh();
      setSelectedId(rec.id);
    };
    const remove = (id) => {
      if (!window.confirm("Delete this pitching assessment? This can't be undone.")) return;
      store.deleteAssessment(id);
      const next = store.getPitchingAssessments(athlete.id);
      setList(next);
      setSelectedId((prev) => (prev === id ? (next.length ? next[next.length - 1].id : null) : prev));
    };

    // Prints on landscape pages: everything else on the page is hidden (the same print rules the Biomechanical
    // Assessment uses) and the form is laid out at the page's width.
    const printing = useRef(null);
    const preparePrint = () => {
      const wrap = wrapRef.current;
      if (!wrap || wrap.offsetParent === null || printing.current) return; // hidden tab, or already prepared
      const pageStyle = document.createElement("style");
      pageStyle.textContent = "@page { size: letter landscape; margin: 0.35in; }";
      document.head.appendChild(pageStyle);
      document.body.classList.add("print-assessment-only");
      wrap.classList.add("pa-printing");
      printing.current = { wrap, pageStyle };
    };
    const cleanupPrint = () => {
      const s = printing.current;
      if (!s) return;
      printing.current = null;
      document.body.classList.remove("print-assessment-only");
      s.wrap.classList.remove("pa-printing");
      if (s.pageStyle.parentNode) s.pageStyle.parentNode.removeChild(s.pageStyle);
    };
    useEffect(() => {
      window.addEventListener("beforeprint", preparePrint);
      window.addEventListener("afterprint", cleanupPrint);
      return () => { window.removeEventListener("beforeprint", preparePrint); window.removeEventListener("afterprint", cleanupPrint); cleanupPrint(); };
      // eslint-disable-next-line
    }, []);

    return (
      <div className="assess-wrap pa-wrap" ref={wrapRef}>
        <div className="panel no-print">
          <h2>Pitching Assessment <small>Digital version of the DST Mechanical Analysis sheet</small></h2>
          <div className="assess-history">
            {!list.length && <span className="assess-row-note">No pitching assessments yet. Click "+ New Pitching Assessment" to start one.</span>}
            {[...list].reverse().map((a) => (
              <span key={a.id} className={`assess-history-item${a.id === selectedId ? " active" : ""}`}>
                <button type="button" className="assess-history-btn" onClick={() => setSelectedId(a.id)} title="Open this assessment">
                  {fmtDate(a.date)}{a.coach ? ` — ${a.coach}` : ""}
                </button>
                <button type="button" className="assess-history-delete" onClick={() => remove(a.id)} title="Delete this assessment">&times;</button>
              </span>
            ))}
          </div>
          <div className="assess-toolbar">
            <button className="btn btn-primary" onClick={addNew}>+ New Pitching Assessment</button>
            {record && <button className="btn btn-secondary" onClick={() => { preparePrint(); window.print(); }}>Print / Save PDF</button>}
          </div>
          {list.length > 0 && <p className="timestamp-note">{list.length} pitching assessment{list.length === 1 ? "" : "s"} on file for {athlete.name}.</p>}
        </div>

        {record ? (
          <React.Fragment>
            <div className="assess-print-title print-only-block">
              <h1 className="report-title">{athlete.name} &mdash; Pitching Assessment</h1>
              <div className="report-subtitle">{fmtDate(record.date)}{record.coach ? ` · Coach: ${record.coach}` : ""}</div>
            </div>
            <PitchingForm key={record.id} record={record} athlete={athlete} onSave={handleSave} />
          </React.Fragment>
        ) : (
          <div className="panel"><div className="empty-state">No pitching assessments yet for {athlete.name}. Click "+ New Pitching Assessment" to start one.</div></div>
        )}
      </div>
    );
  }

  window.PitchingAssessmentTab = PitchingAssessmentTab;
})();
