// Saved series: a block of drills kept on its own (Core Stability 1, a T-Spine series, a band warm-up…), to be put into
// a day of any program from the builders, made a day of its own, or dropped onto someone's app for a date from the phone
// (quick_assign.js). A series is kept in the programs table as "series-<id>" with layout "series", holding its drills
// as one week of one day (window.isSeriesProgram and window.seriesDrills in program_rx.js), so it saves, syncs and
// reads like a program but is never listed, assigned or put on a plan as one.
//
// Putting a series into a program copies its drills into the day: the day can then be changed on its own, and editing
// the saved series later only changes where it goes next. In a strength day the drills follow the day's blocks (the
// series' name in the first one's note); in a day laid out in sections (re-ed, speed, throwing) they are a series of
// that name in the section picked.
(function () {
  const { useState, useMemo } = React;
  const store = () => window.AthleteStore;
  const rid = () => Math.random().toString(36).slice(2, 9);
  const blankDrill = () => ({ id: `ex-${rid()}`, name: "", tempo: "", intensityUnit: "", groups: [{ sets: "", reps: "", intensity: "" }], rest: "", notes: "" });
  const allSeries = () => store().allPrograms().filter((p) => window.isSeriesProgram(p)).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  const drillsOf = (p) => window.seriesDrills(p).filter((e) => (e.name || "").trim());
  const rxText = (e) => (window.ProgramRx && window.ProgramRx.text ? window.ProgramRx.text(e) : "");
  const isBlank = (e) => !(e.name || "").trim() && !(e.groups || []).some((g) => `${g.sets || ""}${g.reps || ""}${g.intensity || ""}`.trim());

  // the series' drills, copied for a day: their own ids (so nothing logged elsewhere lands on them), the first starting a
  // block. `section` given: a day in sections, where they become a series of that name in that section.
  function copyDrills(series, section) {
    return JSON.parse(JSON.stringify(drillsOf(series))).map((e, i) => {
      const c = { ...e, id: `ex-${rid()}`, fromSeries: series.name };
      if (section) {
        const n = window.speedNormalize ? window.speedNormalize(c) : c;
        return { distance: "", extras: [], ...n, section, series: series.name, linked: false };
      }
      delete c.section; delete c.series;
      if (i === 0) { c.linked = false; c.notes = [series.name, (c.notes || "").trim()].filter(Boolean).join(" · "); }
      return c;
    });
  }

  // ---- putting a series into a builder ------------------------------------------------------------------------------
  // Opened from a week's "+ Series". Pick a series, the day it goes into (or a new day that is just the series), which
  // weeks, and for a day in sections, the section. onInsert({ series, day: day index or "new", weeks: [week indexes], section })
  function SeriesInsertDialog({ weeks, wi, sectionsLayout, newDaySections, allowNewDay = true, onInsert, onClose }) {
    const list = useMemo(allSeries, []);
    const days = ((weeks[wi] || {}).sessions) || [];
    const [q, setQ] = useState("");
    const [pick, setPick] = useState(null);
    const [day, setDay] = useState(days.length ? "0" : "new");
    const [which, setWhich] = useState("this");
    const sectionNames = !sectionsLayout ? [] : day === "new" ? (newDaySections || []) : window.speedSections(days[Number(day)]).map((x) => x.name);
    const [sectionPick, setSection] = useState("");
    const section = sectionNames.includes(sectionPick) ? sectionPick : (sectionNames[sectionNames.length - 1] || "Series");
    const hits = list.filter((s) => { const t = q.trim().toLowerCase(); return !t || (s.name || "").toLowerCase().includes(t) || drillsOf(s).some((e) => e.name.toLowerCase().includes(t)); });
    const weekList = which === "all" ? weeks.map((w, i) => i) : which === "after" ? weeks.map((w, i) => i).filter((i) => i >= wi) : [wi];
    const go = () => { if (pick) onInsert({ series: pick, day: day === "new" ? "new" : Number(day), weeks: weekList, section: sectionsLayout ? section : null }); };
    return (
      <div className="zoom-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="zoom-modal app-ask series-insert" role="dialog" aria-label="Insert a saved series" onKeyDown={(e) => { if (e.key === "Escape") onClose(); e.stopPropagation(); }}>
          <h2>Insert a saved series</h2>
          {!list.length ? (
            <p>No series saved yet. Make one under Programs › Series (from scratch, or from a day of a program you already have).</p>
          ) : (
            <React.Fragment>
              <input autoFocus value={q} placeholder="Search series or drills" onChange={(e) => setQ(e.target.value)} />
              <div className="series-pick-list">
                {hits.map((s) => (
                  <button key={s.id} className={pick && pick.id === s.id ? "on" : ""} onClick={() => setPick(s)}>
                    <b>{s.name}</b>
                    <small>{drillsOf(s).length} drill{drillsOf(s).length === 1 ? "" : "s"}: {drillsOf(s).map((e) => e.name).join(", ")}</small>
                  </button>
                ))}
                {!hits.length && <div className="empty-state">No series matches that.</div>}
              </div>
              {pick && (
                <ol className="series-preview">
                  {drillsOf(pick).map((e) => <li key={e.id}>{e.name}{rxText(e) && <small> {rxText(e)}</small>}</li>)}
                </ol>
              )}
              <label className="series-field">Into
                <select value={day} onChange={(e) => setDay(e.target.value)}>
                  {days.map((s, i) => <option key={i} value={String(i)}>{s.name || `Day ${i + 1}`} (added at the end)</option>)}
                  {allowNewDay && <option value="new">A new day, just this series (an off day, say)</option>}
                </select>
              </label>
              {sectionsLayout && (
                <label className="series-field">Section
                  <select value={section} onChange={(e) => setSection(e.target.value)}>
                    {sectionNames.map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
              )}
              {weeks.length > 1 && (
                <label className="series-field">Weeks
                  <select value={which} onChange={(e) => setWhich(e.target.value)}>
                    <option value="this">{weeks[wi].name || `Week ${wi + 1}`} only</option>
                    {wi < weeks.length - 1 && <option value="after">{weeks[wi].name || `Week ${wi + 1}`} and every week after</option>}
                    <option value="all">Every week</option>
                  </select>
                </label>
              )}
              <p className="series-note">The drills are copied in, so you can change them in this program; the saved series stays as it is. Ctrl+Z undoes it.</p>
            </React.Fragment>
          )}
          <div className="app-ask-actions">
            {list.length > 0 && <button className="btn" disabled={!pick} onClick={go}>{pick ? `Insert ${pick.name}` : "Pick a series"}</button>}
            <button className="btn btn-secondary" onClick={onClose}>{list.length ? "Cancel" : "Close"}</button>
          </div>
        </div>
      </div>
    );
  }

  // ---- making and editing a series ----------------------------------------------------------------------------------
  // One day, in the strength builder's table (supersets, sets, reps, %, tempo, rest, notes; rows pasted from a sheet).
  function SeriesEditor({ initial, onClose }) {
    const [draft, setDraft] = useState(() => {
      const d = JSON.parse(JSON.stringify(initial || {}));
      const xs = window.seriesDrills(d);
      return { ...d, name: d.name || "", description: d.description || "", layout: "series", weeks: [{ name: "Week 1", sessions: [{ name: d.name || "Series", exercises: xs.length ? xs.map((e) => window.ProgramRx.normalize(e)) : [blankDrill()] }] }] };
    });
    const [msg, setMsg] = useState("");
    const edit = (fn) => setDraft((d) => { const c = JSON.parse(JSON.stringify(d)); fn(c); return c; });
    const named = window.seriesDrills(draft).filter((e) => (e.name || "").trim());
    const save = () => {
      if (!draft.name.trim()) { setMsg("Give the series a name."); return; }
      if (!named.length) { setMsg("Add at least one drill."); return; }
      const rec = JSON.parse(JSON.stringify(draft));
      rec.name = rec.name.trim();
      rec.weeks[0].sessions[0].name = rec.name;
      rec.weeks[0].sessions[0].exercises = rec.weeks[0].sessions[0].exercises.filter((e) => !isBlank(e));
      rec.id = rec.id || `series-${Date.now()}-${rid()}`;
      rec.layout = "series";
      store().saveProgram(rec);
      onClose(rec);
    };
    const remove = () => window.askConfirm({ title: `Delete ${draft.name || "this series"}?`, text: "Programs it was already put into keep their copy of the drills.", ok: "Delete", danger: true }).then((yes) => { if (yes) { store().deleteProgram(draft.id); onClose(null); } });
    return (
      <div className="panel series-editor">
        <datalist id="exercise-library-names">
          {store().allExercises().map((e) => <option key={e.id} value={e.name} />)}
        </datalist>
        <div className="program-editor-top">
          <h2>{draft.id ? "Edit series" : "New series"}</h2>
          <button className="btn btn-primary" onClick={save}>Save series</button>
          <button className="btn btn-secondary" onClick={() => onClose(undefined)}>Close</button>
          {draft.id && <button className="btn-link" onClick={remove}>Delete</button>}
          {msg && <span className="timestamp-note">{msg}</span>}
        </div>
        <div className="spd-meta">
          <input className="spd-title" value={draft.name} placeholder="Series name (e.g. Core Stability 1)" onChange={(e) => { const v = e.target.value; setMsg(""); edit((d) => { d.name = v; }); }} />
          <input className="spd-desc" value={draft.description} placeholder="Description (optional)" onChange={(e) => { const v = e.target.value; edit((d) => { d.description = v; }); }} />
        </div>
        <p className="timestamp-note">The drills, in order, with their sets and reps. Link drills into a superset or circuit as in any program (Add A2). Put it into a program with "+ Series" on a week in the program builder, or drop it onto someone's app for a date from the phone (Coach tools › Drop In a Series, or + Series in Coach Mode).</p>
        {window.ProgramTableWeek && (
          <window.ProgramTableWeek
            week={draft.weeks[0]}
            wi={0}
            edit={edit}
            newExercise={blankDrill}
            newSession={() => ({ name: "Series", exercises: [blankDrill()] })}
            maxDays={1}
            onNameFocus={() => {}}
            onNameBlur={() => {}}
            onProgress={null}
            reedPicker={null}
          />
        )}
      </div>
    );
  }

  // A new series from what's already in a program: a whole day, or one named series of a day laid out in sections.
  function FromProgramDay({ onPick, onCancel }) {
    const programs = useMemo(() => store().allPrograms().filter((p) => !window.isSeriesProgram(p) && !window.isSentProgram(p.id) && (p.name || "").trim()).sort((a, b) => a.name.localeCompare(b.name)), []);
    const [q, setQ] = useState("");
    const [pid, setPid] = useState("");
    const [wk, setWk] = useState(0);
    const [si, setSi] = useState(0);
    const [part, setPart] = useState("");
    const p = programs.find((x) => x.id === pid);
    const s = p && p.weeks[wk] && p.weeks[wk].sessions[si];
    const parts = s && window.isSpeedSession(s) ? window.speedSections(s).flatMap((sec) => sec.series.filter((sr) => sr.name).map((sr) => `${sec.name}|${sr.name}`)) : [];
    const take = () => {
      if (!s) return;
      const [secName, srName] = part ? part.split("|") : [];
      const xs = (s.exercises || []).filter((e) => (e.name || "").trim() && (!part || (e.section === secName && (e.series || "") === srName)));
      const drills = xs.map((e, i) => { const c = { ...JSON.parse(JSON.stringify(e)), id: `ex-${rid()}` }; delete c.section; delete c.series; delete c.fromSeries; if (i === 0) c.linked = false; return c; });
      onPick({ name: srName || (s.name && !/^day \d+$/i.test(s.name) ? s.name : ""), description: `From ${p.name}, ${p.weeks[wk].name || `Week ${wk + 1}`}, ${s.name || `Day ${si + 1}`}`, weeks: [{ name: "Week 1", sessions: [{ name: "Series", exercises: drills }] }] });
    };
    const hits = programs.filter((x) => { const t = q.trim().toLowerCase(); return !t || x.name.toLowerCase().includes(t) || (x.folder || "").toLowerCase().includes(t); }).slice(0, 40);
    return (
      <div className="new-program-choice series-from">
        <strong>Make a series from a program day</strong>
        {!p ? (
          <React.Fragment>
            <input className="facility-search" autoFocus value={q} placeholder="Search programs by name or folder" onChange={(e) => setQ(e.target.value)} />
            <div className="new-program-list">
              {hits.map((x) => (
                <button key={x.id} onClick={() => { setPid(x.id); setWk(0); setSi(0); setPart(""); }}>
                  <b>{x.name}</b><small>{(x.weeks || []).length} wk{(x.weeks || []).length === 1 ? "" : "s"}{x.folder ? ` · ${x.folder}` : ""}</small>
                </button>
              ))}
            </div>
          </React.Fragment>
        ) : (
          <React.Fragment>
            <span><b>{p.name}</b> <button className="btn-link" onClick={() => setPid("")}>change</button></span>
            <div className="series-from-row">
              {p.weeks.length > 1 && <label className="series-field">Week <select value={wk} onChange={(e) => { setWk(Number(e.target.value)); setSi(0); setPart(""); }}>{p.weeks.map((w, i) => <option key={i} value={i}>{w.name || `Week ${i + 1}`}</option>)}</select></label>}
              <label className="series-field">Day <select value={si} onChange={(e) => { setSi(Number(e.target.value)); setPart(""); }}>{(p.weeks[wk].sessions || []).map((d, i) => <option key={i} value={i}>{d.name || `Day ${i + 1}`}</option>)}</select></label>
              {parts.length > 0 && <label className="series-field">Take <select value={part} onChange={(e) => setPart(e.target.value)}><option value="">The whole day</option>{parts.map((x) => <option key={x} value={x}>{x.split("|")[1]} ({x.split("|")[0]})</option>)}</select></label>}
            </div>
            {s && <ol className="series-preview">{(s.exercises || []).filter((e) => (e.name || "").trim() && (!part || `${e.section}|${e.series || ""}` === part)).map((e) => <li key={e.id}>{e.name}{rxText(e) && <small> {rxText(e)}</small>}</li>)}</ol>}
          </React.Fragment>
        )}
        <div className="new-program-options">
          {p && <button className="btn btn-assign" onClick={take}>Use these drills</button>}
          <button className="btn-link" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    );
  }

  // ---- Programs › Series --------------------------------------------------------------------------------------------
  function SeriesLibrary({ sectionTabs }) {
    const [, bump] = useState(0);
    const [editing, setEditing] = useState(null); // null, or the series (a new one has no id)
    const [from, setFrom] = useState(false);
    const [q, setQ] = useState("");
    const list = allSeries();
    if (editing) return (<div>{sectionTabs}<SeriesEditor initial={editing} onClose={() => { setEditing(null); bump((v) => v + 1); }} /></div>);
    const shown = list.filter((s) => { const t = q.trim().toLowerCase(); return !t || (s.name || "").toLowerCase().includes(t) || drillsOf(s).some((e) => e.name.toLowerCase().includes(t)); });
    return (
      <div className="panel">
        {sectionTabs}
        <h2>Series <small>{list.length} saved</small></h2>
        <p className="timestamp-note">A series is a block of drills saved on its own (Core Stability 1, a T-Spine series, a band warm-up) to put into any program. In the program builder, "+ Series" on a week copies one into a day (strength, re-ed, speed or throwing), or makes it a day of its own. From the phone, coaches drop one onto their own app or an athlete's for a date (Coach tools › Drop In a Series, or + Series in Coach Mode).</p>
        <div className="facility-toolbar">
          <input className="facility-search" value={q} placeholder="Search series or drills" onChange={(e) => setQ(e.target.value)} />
          <button className="btn btn-secondary" style={{ marginLeft: "auto" }} onClick={() => setFrom(!from)}>From a program day</button>
          <button className="btn btn-assign" onClick={() => setEditing({})}>+ NEW SERIES</button>
        </div>
        {from && <FromProgramDay onCancel={() => setFrom(false)} onPick={(d) => { setFrom(false); setEditing(d); }} />}
        <div className="series-list">
          {shown.map((s) => (
            <div className="series-card" key={s.id}>
              <button className="series-card-main" onClick={() => setEditing(s)}>
                <b>{s.name}</b>
                <small>{drillsOf(s).length} drill{drillsOf(s).length === 1 ? "" : "s"}{s.createdBy ? ` · ${s.createdBy.split("@")[0]}` : ""}{s.description ? ` · ${s.description}` : ""}</small>
                <span>{drillsOf(s).map((e) => `${e.name}${rxText(e) ? ` ${rxText(e)}` : ""}`).join(" · ")}</span>
              </button>
            </div>
          ))}
          {!list.length && <div className="empty-state">No series yet. Start one with + New series, or take one from a day of a program you already have.</div>}
          {list.length > 0 && !shown.length && <div className="empty-state">No series matches that.</div>}
        </div>
      </div>
    );
  }

  window.SeriesKit = { all: allSeries, drills: drillsOf, copyDrills, isBlank };
  window.SeriesInsertDialog = SeriesInsertDialog;
  window.SeriesLibrary = SeriesLibrary;
})();
