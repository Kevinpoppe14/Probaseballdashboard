// Speed program builder. Speed days don't fit A1/A2 supersets, so a speed program is laid out the way the speed
// sheets are: each day in sections (Warm-up, Plyometrics, Speed / Agility / Power Endurance, ESD), each with its
// time, and inside a section, series (Acceleration Series - Prowler) holding drills, each with sets, a distance or
// reps, a volume (yards or contacts, worked out from sets x distance unless typed) and a category that counts
// toward the day's totals (Plyometrics, Technical, Application, ESD). One day is shown at a time with its weeks
// side by side, so the progression from week to week reads across, as on the sheet.
//
// It is saved as an ordinary program (layout "speed"): weeks, days and exercises, each drill an exercise carrying
// its section and series (see window.speedSections in program_rx.js). So it is assigned, sent and logged like any
// program, and the athlete's app shows the day in its sections instead of A1/A2.
(function () {
  const { useState } = React;
  const DEFAULT_SECTIONS = ["Warm-up", "Plyometrics", "Speed / Agility / Power Endurance", "ESD"];
  const CATS = window.SPEED_CATEGORIES;
  const uid = () => `ex-${Math.random().toString(36).slice(2, 9)}`;
  const defaultCategory = (section) => (/plyo/i.test(section) ? "plyo" : /esd|endurance$/i.test(section) && !/speed/i.test(section) ? "esd" : /speed|agility/i.test(section) ? "technical" : "");
  const newDrill = (section, series) => ({ id: uid(), name: "", tempo: "", intensityUnit: "", groups: [{ sets: "", reps: "", intensity: "" }], rest: "", notes: "", linked: false, section, series: series || "", volume: "", category: defaultCategory(section), record: false });
  const newSpeedDay = (n) => ({ name: `Day ${n}`, sections: DEFAULT_SECTIONS.map((name) => ({ name, time: "" })), exercises: [] });
  const newSpeedProgram = (weeks = 4, days = 4) => ({ name: "", description: "", layout: "speed", tags: [], nextProgramIds: [], weeks: Array.from({ length: weeks }, (_, w) => ({ name: `Week ${w + 1}`, sessions: Array.from({ length: days }, (_, d) => newSpeedDay(d + 1)) })) });
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const freshIds = (day) => ({ ...clone(day), exercises: (day.exercises || []).map((e) => ({ ...clone(e), id: uid() })) });

  function SpeedProgramEditor({ initial, onSave, onCancel, onDelete, onDirty, cancelLabel, onSaveAndAssign, autoSave }) {
    const [draft, setDraft] = useState(() => {
      const d = clone(initial && (initial.weeks || []).length ? initial : { ...newSpeedProgram(), ...(initial || {}), weeks: newSpeedProgram().weeks });
      d.layout = "speed";
      d.weeks.forEach((w) => w.sessions.forEach((s) => { if (!Array.isArray(s.sections)) s.sections = window.speedSections(s).map((x) => ({ name: x.name, time: x.time })); s.exercises = s.exercises || []; }));
      return d;
    });
    const [day, setDay] = useState(0);
    const draftRef = React.useRef(draft);
    draftRef.current = draft;
    const edit = (fn) => { if (onDirty) onDirty(); setDraft((d) => { const c = clone(d); fn(c); return c; }); };
    const canSave = (draft.name || "").trim().length > 0;
    const days = Math.max(...draft.weeks.map((w) => w.sessions.length));
    const di = Math.min(day, days - 1);

    // ---- saving: the same autosave as the standard builder (a moment after each change, and on leaving) ----
    const recOf = (d) => ({ name: (d.name || "").trim(), description: (d.description || "").trim(), layout: "speed", weeks: d.weeks, nextProgramIds: d.nextProgramIds || [], tags: d.tags || [] });
    const savedId = React.useRef(initial && initial.id ? initial.id : null);
    const lastSaved = React.useRef(JSON.stringify(recOf(draft)));
    const [saveState, setSaveState] = useState("saved");
    const flush = () => {
      if (!autoSave) return;
      const rec = recOf(draftRef.current), json = JSON.stringify(rec);
      if (json === lastSaved.current) return;
      if (!rec.name) { setSaveState("needs-name"); return; }
      if (savedId.current) rec.id = savedId.current;
      const saved = autoSave(rec);
      if (saved && saved.id) savedId.current = saved.id;
      lastSaved.current = json;
      setSaveState("saved");
    };
    const flushRef = React.useRef(flush);
    flushRef.current = flush;
    React.useEffect(() => {
      if (!autoSave || JSON.stringify(recOf(draft)) === lastSaved.current) return undefined;
      setSaveState((draft.name || "").trim() ? "pending" : "needs-name");
      const t = setTimeout(() => flushRef.current(), 900);
      return () => clearTimeout(t);
    }, [draft]); // eslint-disable-line
    React.useEffect(() => {
      if (!autoSave) return undefined;
      const leave = () => flushRef.current();
      window.addEventListener("beforeunload", leave);
      window.addEventListener("pagehide", leave);
      return () => { window.removeEventListener("beforeunload", leave); window.removeEventListener("pagehide", leave); flushRef.current(); };
    }, []); // eslint-disable-line
    const manualRec = () => {
      const rec = recOf(draft);
      if (savedId.current) rec.id = savedId.current; else if (initial && initial.id) rec.id = initial.id;
      lastSaved.current = JSON.stringify(rec);
      return rec;
    };

    // ---- the day across weeks -----------------------------------------------------------------------------
    const sessionAt = (d, wi) => d.weeks[wi].sessions[di];
    const forEachWeek = (d, fn) => d.weeks.forEach((w, wi) => { if (w.sessions[di]) fn(w.sessions[di], wi); });
    const addSection = () => {
      const name = (window.prompt("Section name (e.g. Core / MB / Upper RNT)") || "").trim();
      if (!name) return;
      edit((d) => forEachWeek(d, (s) => { if (!s.sections.some((x) => x.name === name)) s.sections.push({ name, time: "" }); }));
    };
    const renameSection = (oldName, name) => edit((d) => forEachWeek(d, (s) => {
      s.sections.forEach((x) => { if (x.name === oldName) x.name = name; });
      s.exercises.forEach((e) => { if (e.section === oldName) e.section = name; });
    }));
    const removeSection = (name) => {
      const has = draftRef.current.weeks.some((w) => w.sessions[di] && w.sessions[di].exercises.some((e) => e.section === name));
      if (has && !window.confirm(`Remove ${name} and its drills from this day in every week?`)) return;
      edit((d) => forEachWeek(d, (s) => { s.sections = s.sections.filter((x) => x.name !== name); s.exercises = s.exercises.filter((e) => e.section !== name); }));
    };
    const moveSection = (name, by) => edit((d) => forEachWeek(d, (s) => {
      const i = s.sections.findIndex((x) => x.name === name), j = i + by;
      if (i < 0 || j < 0 || j >= s.sections.length) return;
      [s.sections[i], s.sections[j]] = [s.sections[j], s.sections[i]];
    }));
    // a new drill goes straight after the last one of its series (or its section), so a series stays together
    const addDrill = (wi, section, series) => edit((d) => {
      const s = sessionAt(d, wi), xs = s.exercises;
      let at = -1;
      xs.forEach((e, i) => { if (e.section === section && (series == null || (e.series || "") === series)) at = i; });
      xs.splice(at + 1 || xs.length, 0, newDrill(section, series));
    });
    const addSeries = (wi, section) => {
      const name = (window.prompt("Series name (e.g. Acceleration Series - Prowler)") || "").trim();
      if (name) addDrill(wi, section, name);
    };
    const renameSeries = (wi, section, oldName, name) => edit((d) => sessionAt(d, wi).exercises.forEach((e) => { if (e.section === section && (e.series || "") === oldName) e.series = name; }));
    const setDrill = (wi, index, patch) => edit((d) => Object.assign(sessionAt(d, wi).exercises[index], patch));
    const setGroup = (wi, index, patch) => edit((d) => Object.assign(sessionAt(d, wi).exercises[index].groups[0], patch));
    const removeDrill = (wi, index) => edit((d) => sessionAt(d, wi).exercises.splice(index, 1));
    const moveDrill = (wi, index, by) => edit((d) => {
      const xs = sessionAt(d, wi).exercises, e = xs[index];
      // the next drill up or down in the same section
      const same = xs.map((x, i) => i).filter((i) => xs[i].section === e.section);
      const k = same.indexOf(index) + by;
      if (k < 0 || k >= same.length) return;
      const j = same[k];
      xs[index] = xs[j]; xs[j] = e;
      if ((xs[index].series || "") !== (e.series || "")) e.series = xs[index].series || ""; // moving past a series joins it
    });
    const copyForward = (wi, all) => {
      const targets = draftRef.current.weeks.map((w, i) => i).filter((i) => (all ? i > wi : i === wi + 1));
      if (!targets.length) return;
      const has = targets.some((i) => (draftRef.current.weeks[i].sessions[di] || { exercises: [] }).exercises.some((e) => (e.name || "").trim()));
      if (has && !window.confirm(`Replace ${draftRef.current.weeks[wi].sessions[di].name || "this day"} in ${targets.length === 1 ? draftRef.current.weeks[targets[0]].name : `the ${targets.length} weeks after`} with this week's?`)) return;
      edit((d) => targets.forEach((i) => { const keep = d.weeks[i].sessions[di] ? d.weeks[i].sessions[di].name : sessionAt(d, wi).name; d.weeks[i].sessions[di] = { ...freshIds(sessionAt(d, wi)), name: keep }; }));
    };
    const renameDay = (name) => edit((d) => forEachWeek(d, (s) => { s.name = name; }));
    const addDay = () => { edit((d) => d.weeks.forEach((w) => { if (w.sessions.length < 7) w.sessions.push(newSpeedDay(w.sessions.length + 1)); })); setDay(days); };
    const removeDay = () => {
      if (days <= 1 || !window.confirm(`Remove ${draft.weeks[0].sessions[di] ? draft.weeks[0].sessions[di].name : "this day"} from every week?`)) return;
      edit((d) => d.weeks.forEach((w) => { w.sessions.splice(di, 1); }));
      setDay(Math.max(0, di - 1));
    };
    const addWeek = () => edit((d) => { const last = d.weeks[d.weeks.length - 1]; d.weeks.push({ name: `Week ${d.weeks.length + 1}`, sessions: last.sessions.map(freshIds) }); });
    const removeWeek = () => { if (draft.weeks.length > 1 && window.confirm(`Remove ${draft.weeks[draft.weeks.length - 1].name}?`)) edit((d) => { d.weeks.pop(); }); };

    const totals = (s) => {
      const out = {};
      CATS.forEach(([k]) => { out[k] = { sets: 0, volume: 0 }; });
      (s.exercises || []).forEach((e) => { if (!out[e.category]) return; out[e.category].sets += parseFloat((e.groups[0] || {}).sets) || 0; out[e.category].volume += window.speedVolume(e) || 0; });
      return out;
    };
    const head = draft.weeks[0].sessions[di] || newSpeedDay(di + 1);
    const sectionNames = (head.sections || []).map((x) => x.name);

    const weekColumn = (w, wi) => {
      const s = w.sessions[di];
      if (!s) return <div className="spd-week" key={wi}><div className="spd-week-head"><b>{w.name}</b></div><div className="empty-state">This week has no {head.name}.</div></div>;
      const t = totals(s);
      return (
        <div className="spd-week" key={wi}>
          <div className="spd-week-head">
            <input className="spd-week-name" value={w.name || ""} onChange={(e) => edit((d) => { d.weeks[wi].name = e.target.value; })} aria-label="Week name" />
            {wi < draft.weeks.length - 1 && <button className="btn-link" title="Copy this day to the next week" onClick={() => copyForward(wi, false)}>Copy → next week</button>}
            {wi < draft.weeks.length - 2 && <button className="btn-link" title="Copy this day to every week after this one" onClick={() => copyForward(wi, true)}>→ all after</button>}
          </div>
          {window.speedSections(s).map((sec) => (
            <div className="spd-section" key={sec.name}>
              <div className="spd-section-head">
                <b>{sec.name}</b>
                <input className="spd-time" value={sec.time} placeholder="Time" aria-label={`Time for ${sec.name}`} onChange={(e) => edit((d) => { const x = sessionAt(d, wi).sections.find((y) => y.name === sec.name); if (x) x.time = e.target.value; else sessionAt(d, wi).sections.push({ name: sec.name, time: e.target.value }); })} />
              </div>
              {sec.series.map((sr, k) => (
                <div className={`spd-series${sr.name ? " named" : ""}`} key={`${sr.name}|${k}`}>
                  {sr.name && <input className="spd-series-name" value={sr.name} aria-label="Series name" onChange={(e) => renameSeries(wi, sec.name, sr.name, e.target.value)} />}
                  {sr.drills.map(({ e, index }) => {
                    const g = e.groups[0] || {};
                    const auto = window.speedVolume({ ...e, volume: "" });
                    return (
                      <div className="spd-drill" key={e.id}>
                        <input className="spd-name" list="exercise-library-names" value={e.name} placeholder="Drill" onChange={(ev) => setDrill(wi, index, { name: ev.target.value })} />
                        <input className="spd-num" value={g.sets || ""} placeholder="Sets" title="Sets" onChange={(ev) => setGroup(wi, index, { sets: ev.target.value })} />
                        <input className="spd-dist" value={g.reps || ""} placeholder="@ yds / reps" title="Distance or reps, e.g. @7yds, 3 reps, 1x3e" onChange={(ev) => setGroup(wi, index, { reps: ev.target.value })} />
                        <input className="spd-num" value={e.volume || ""} placeholder={auto ? String(auto) : "Vol"} title="Volume (yards or contacts); left blank it is sets x distance" onChange={(ev) => setDrill(wi, index, { volume: ev.target.value })} />
                        <select className="spd-cat" value={e.category || ""} title="Counts toward this total" onChange={(ev) => setDrill(wi, index, { category: ev.target.value })}>
                          <option value="">—</option>
                          {CATS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                        </select>
                        <span className="spd-tools">
                          <label title="The athlete writes in their best time"><input type="checkbox" checked={!!e.record} onChange={(ev) => setDrill(wi, index, { record: ev.target.checked })} /> Time</label>
                          <button className="spd-x" title="Move up" onClick={() => moveDrill(wi, index, -1)}>↑</button>
                          <button className="spd-x" title="Move down" onClick={() => moveDrill(wi, index, 1)}>↓</button>
                          <button className="spd-x" title="Remove this drill" onClick={() => removeDrill(wi, index)}>×</button>
                        </span>
                        <input className="spd-notes" value={e.notes || ""} placeholder="Notes (e.g. 4 sets of 3 reps, record best sprint)" onChange={(ev) => setDrill(wi, index, { notes: ev.target.value })} />
                      </div>
                    );
                  })}
                  {sr.name && <button className="btn-link spd-add" onClick={() => addDrill(wi, sec.name, sr.name)}>+ Drill in this series</button>}
                </div>
              ))}
              <div className="spd-section-foot">
                <button className="btn-link spd-add" onClick={() => addDrill(wi, sec.name, "")}>+ Drill</button>
                <button className="btn-link spd-add" onClick={() => addSeries(wi, sec.name)}>+ Series</button>
              </div>
            </div>
          ))}
          <table className="spd-totals">
            <thead><tr><th>Totals</th><th>Sets</th><th>Volume</th></tr></thead>
            <tbody>
              {CATS.map(([k, label]) => <tr key={k}><td>{label}</td><td>{t[k].sets}</td><td>{t[k].volume}</td></tr>)}
              <tr className="spd-total-row"><td>Total</td><td>{CATS.reduce((n, [k]) => n + t[k].sets, 0)}</td><td>{CATS.reduce((n, [k]) => n + t[k].volume, 0)}</td></tr>
            </tbody>
          </table>
        </div>
      );
    };

    return (
      <div className="panel program-editor spd-editor">
        <datalist id="exercise-library-names">
          {window.AthleteStore.allExercises().map((e) => <option key={e.id} value={e.name} />)}
        </datalist>
        <div className="program-editor-top">
          <h2>{initial && initial.id ? "Edit speed program" : "New speed program"}</h2>
          {autoSave && <span className="timestamp-note">{saveState === "saved" ? (savedId.current ? "Saved" : "") : saveState === "pending" ? "Saving…" : "Give it a name to save"}</span>}
          {onSaveAndAssign && <button className="btn btn-assign" disabled={!canSave} onClick={() => canSave && onSaveAndAssign(manualRec())}>Save &amp; assign to athletes or a group</button>}
          <button className="btn btn-primary" disabled={!canSave} onClick={() => canSave && onSave(manualRec())}>Save program</button>
          <button className="btn btn-secondary" onClick={onCancel}>{cancelLabel || "Close"}</button>
          {onDelete && <button className="btn-link" onClick={onDelete}>Delete</button>}
        </div>
        <div className="spd-meta">
          <input className="spd-title" value={draft.name || ""} placeholder="Program name (e.g. MLB/MiLB OS Speed Ph I)" onChange={(e) => edit((d) => { d.name = e.target.value; })} />
          <input className="spd-desc" value={draft.description || ""} placeholder="Description (optional)" onChange={(e) => edit((d) => { d.description = e.target.value; })} />
          <span className="spd-counts">
            {draft.weeks.length} week{draft.weeks.length === 1 ? "" : "s"}
            <button className="btn btn-small-grey" onClick={addWeek} title="Add a week, copied from the last one">+ Week</button>
            {draft.weeks.length > 1 && <button className="btn btn-small-grey" onClick={removeWeek}>− Week</button>}
          </span>
        </div>
        <div className="spd-days">
          {Array.from({ length: days }, (_, i) => (
            <button key={i} className={`pill-tab ${i === di ? "active" : ""}`} onClick={() => setDay(i)}>{(draft.weeks[0].sessions[i] || {}).name || `Day ${i + 1}`}</button>
          ))}
          {days < 7 && <button className="btn-link" onClick={addDay}>+ Day</button>}
        </div>
        <div className="spd-day-tools">
          <label>Day name <input value={head.name || ""} onChange={(e) => renameDay(e.target.value)} /></label>
          <span className="spd-section-order">
            Sections:
            {sectionNames.map((n, i) => (
              <span key={n} className="spd-chip">
                {i > 0 && <button className="spd-x" title="Move earlier" onClick={() => moveSection(n, -1)}>‹</button>}
                <input value={n} size={Math.max(6, n.length)} aria-label="Section name" onChange={(e) => renameSection(n, e.target.value)} />
                {i < sectionNames.length - 1 && <button className="spd-x" title="Move later" onClick={() => moveSection(n, 1)}>›</button>}
                <button className="spd-x" title="Remove this section" onClick={() => removeSection(n)}>×</button>
              </span>
            ))}
            <button className="btn-link" onClick={addSection}>+ Section</button>
          </span>
          {days > 1 && <button className="btn-link" onClick={removeDay}>Remove this day</button>}
        </div>
        <p className="timestamp-note">Each week of {head.name || "this day"} side by side. Sections and the day's name are the same in every week; drills, sets, distances and times are set week by week (Copy → next week starts the next one from this one). In the athlete's app only that day of that week shows, in its sections.</p>
        <div className="spd-weeks">{draft.weeks.map(weekColumn)}</div>
      </div>
    );
  }

  window.SpeedProgramEditor = SpeedProgramEditor;
  window.SpeedKit = { newSpeedProgram, newSpeedDay, DEFAULT_SECTIONS };
})();
