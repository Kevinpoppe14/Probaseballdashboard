// Speed program builder. Speed days don't fit A1/A2 supersets, so a speed program is laid out the way the speed
// sheets are: each day in sections (Warm-up, Plyometrics, Speed / Agility / Power Endurance, ESD), each with its
// time, and inside a section, series (Acceleration Series - Prowler) holding drills, each with its sets, reps and a
// distance or time per rep (yd, ft, m, mi; s, min), totalled for each section and the day under it (reps, total
// distance in yards, total time). It looks and works like the strength
// builder: weeks one under another, each week's days side by side, "Fit week" sizing, and the week, day and
// section being worked on standing out while the rest dims.
//
// It is saved as an ordinary program (layout "speed"): weeks, days and exercises, each drill an exercise carrying
// its section and series (see window.speedSections in program_rx.js). So it is assigned, sent and logged like any
// program, and the athlete's app shows the day in its sections instead of A1/A2.
(function () {
  const { useState } = React;
  const DEFAULT_SECTIONS = ["Warm-up", "Plyometrics", "Speed / Agility / Power Endurance", "ESD"];
  const uid = () => `ex-${Math.random().toString(36).slice(2, 9)}`;
  const newDrill = (section, series) => ({ id: uid(), name: "", tempo: "", intensityUnit: "", groups: [{ sets: "", reps: "", intensity: "" }], rest: "", notes: "", linked: false, section, series: series || "", distance: "", record: false });
  // totals: reps (sets x reps), distance in yards, time
  const round = (n) => Math.round(n * 10) / 10;
  const clock = (sec) => { const s = Math.round(sec); return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : `${s}s`; };
  const newSpeedDay = (n) => ({ name: `Day ${n}`, sections: DEFAULT_SECTIONS.map((name) => ({ name, time: "" })), exercises: [] });
  const newSpeedProgram = (weeks = 4, days = 4) => ({ name: "", description: "", layout: "speed", tags: [], nextProgramIds: [], weeks: Array.from({ length: weeks }, (_, w) => ({ name: `Week ${w + 1}`, sessions: Array.from({ length: days }, (_, d) => newSpeedDay(d + 1)) })) });
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const freshIds = (day) => ({ ...clone(day), exercises: (day.exercises || []).map((e) => ({ ...clone(e), id: uid() })) });

  function SpeedProgramEditor({ initial, onSave, onCancel, onDelete, onDirty, cancelLabel, onSaveAndAssign, autoSave }) {
    const [draft, setDraft] = useState(() => {
      const d = clone(initial && (initial.weeks || []).length ? initial : { ...newSpeedProgram(), ...(initial || {}), weeks: newSpeedProgram().weeks });
      d.layout = "speed";
      d.weeks.forEach((w) => w.sessions.forEach((s) => { if (!Array.isArray(s.sections)) s.sections = window.speedSections(s).map((x) => ({ name: x.name, time: x.time })); s.exercises = (s.exercises || []).map((e) => { const n = window.speedNormalize(e); delete n.volume; delete n.category; return n; }); }));
      return d;
    });
    const draftRef = React.useRef(draft);
    draftRef.current = draft;
    const edit = (fn) => { if (onDirty) onDirty(); setDraft((d) => { const c = clone(d); fn(c); return c; }); };
    const canSave = (draft.name || "").trim().length > 0;

    // ---- where the coach is working: that week, that day and that section stand out; the rest is dimmed ----
    const [focus, setFocus] = useState(null); // { wi, si, sec }
    const at = (wi, si, sec) => setFocus((f) => (f && f.wi === wi && f.si === si && f.sec === sec ? f : { wi, si, sec }));

    // ---- size: as in the strength builder, "Fit week" shrinks each week just enough for all its days to fit across ----
    const rootRef = React.useRef(null);
    const [zoomMode, setZoomMode] = useState(() => { try { return localStorage.getItem("programZoom") || "fit"; } catch (e) { return "fit"; } });
    const setZoom = (v) => { setZoomMode(v); try { localStorage.setItem("programZoom", v); } catch (e) { /* not remembered */ } };
    React.useLayoutEffect(() => {
      const root = rootRef.current;
      if (!root) return undefined;
      const size = () => root.querySelectorAll(".program-days").forEach((el) => {
        if (zoomMode !== "fit") { el.style.zoom = zoomMode === "1" ? "" : zoomMode; return; }
        el.style.zoom = "";
        const need = el.scrollWidth, have = el.clientWidth;
        el.style.zoom = need > have ? String(Math.max(0.45, Math.floor((have / need) * 100) / 100)) : "";
      });
      size();
      window.addEventListener("resize", size);
      return () => window.removeEventListener("resize", size);
    });

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

    // ---- editing. A day's sections (names and order) are kept the same in every week; their times, and the drills,
    // are set week by week. ------------------------------------------------------------------------------------
    const sess = (d, wi, si) => d.weeks[wi].sessions[si];
    const sameDayEveryWeek = (d, si, fn) => d.weeks.forEach((w, wi) => { if (w.sessions[si]) fn(w.sessions[si], wi); });
    const addSection = (si) => {
      const name = (window.prompt("Section name (e.g. Core / MB / Upper RNT)") || "").trim();
      if (name) edit((d) => sameDayEveryWeek(d, si, (s) => { if (!s.sections.some((x) => x.name === name)) s.sections.push({ name, time: "" }); }));
    };
    const renameSection = (si, oldName, name) => edit((d) => sameDayEveryWeek(d, si, (s) => {
      s.sections.forEach((x) => { if (x.name === oldName) x.name = name; });
      s.exercises.forEach((e) => { if (e.section === oldName) e.section = name; });
    }));
    const removeSection = (si, name) => {
      const has = draftRef.current.weeks.some((w) => w.sessions[si] && w.sessions[si].exercises.some((e) => e.section === name));
      if (has && !window.confirm(`Remove ${name} and its drills from this day in every week?`)) return;
      edit((d) => sameDayEveryWeek(d, si, (s) => { s.sections = s.sections.filter((x) => x.name !== name); s.exercises = s.exercises.filter((e) => e.section !== name); }));
    };
    const moveSection = (si, name, by) => edit((d) => sameDayEveryWeek(d, si, (s) => {
      const i = s.sections.findIndex((x) => x.name === name), j = i + by;
      if (i < 0 || j < 0 || j >= s.sections.length) return;
      [s.sections[i], s.sections[j]] = [s.sections[j], s.sections[i]];
    }));
    const setTime = (wi, si, name, time) => edit((d) => { const s = sess(d, wi, si), x = s.sections.find((y) => y.name === name); if (x) x.time = time; else s.sections.push({ name, time }); });
    // a new drill goes straight after the last one of its series (or its section), so a series stays together
    const addDrill = (wi, si, section, series) => edit((d) => {
      const xs = sess(d, wi, si).exercises;
      let last = -1;
      xs.forEach((e, i) => { if (e.section === section && (series == null || (e.series || "") === series)) last = i; });
      xs.splice(last >= 0 ? last + 1 : xs.length, 0, newDrill(section, series));
    });
    const addSeries = (wi, si, section) => {
      const name = (window.prompt("Series name (e.g. Acceleration Series - Prowler)") || "").trim();
      if (name) addDrill(wi, si, section, name);
    };
    const renameSeries = (wi, si, section, oldName, name) => edit((d) => sess(d, wi, si).exercises.forEach((e) => { if (e.section === section && (e.series || "") === oldName) e.series = name; }));
    const setDrill = (wi, si, index, patch) => edit((d) => Object.assign(sess(d, wi, si).exercises[index], patch));
    const setGroup = (wi, si, index, patch) => edit((d) => Object.assign(sess(d, wi, si).exercises[index].groups[0], patch));
    const removeDrill = (wi, si, index) => edit((d) => sess(d, wi, si).exercises.splice(index, 1));
    const moveDrill = (wi, si, index, by) => edit((d) => {
      const xs = sess(d, wi, si).exercises, e = xs[index];
      const same = xs.map((x, i) => i).filter((i) => xs[i].section === e.section); // the next drill up or down in its section
      const k = same.indexOf(index) + by;
      if (k < 0 || k >= same.length) return;
      const j = same[k];
      xs[index] = xs[j]; xs[j] = e;
      if ((xs[index].series || "") !== (e.series || "")) e.series = xs[index].series || ""; // moving past a series joins it
    });
    const copyPrevWeek = (wi) => {
      const w = draftRef.current.weeks[wi];
      const filled = w.sessions.some((s) => s.exercises.some((e) => (e.name || "").trim()));
      if (filled && !window.confirm(`Replace everything in ${w.name || `week ${wi + 1}`} with a copy of ${draftRef.current.weeks[wi - 1].name || `week ${wi}`}?`)) return;
      edit((d) => { d.weeks[wi] = { name: d.weeks[wi].name, sessions: d.weeks[wi - 1].sessions.map(freshIds) }; });
    };
    const addWeek = () => edit((d) => { const last = d.weeks[d.weeks.length - 1]; d.weeks.push({ name: `Week ${d.weeks.length + 1}`, sessions: last.sessions.map(freshIds) }); });
    const removeWeek = (wi) => { if (draft.weeks.length > 1 && window.confirm(`Remove ${draft.weeks[wi].name || `week ${wi + 1}`}?`)) edit((d) => { d.weeks.splice(wi, 1); }); };
    const days = Math.max(...draft.weeks.map((w) => w.sessions.length));
    const addDay = () => edit((d) => d.weeks.forEach((w) => { if (w.sessions.length < 7) w.sessions.push(newSpeedDay(w.sessions.length + 1)); }));
    const removeDay = (si) => {
      if (days <= 1 || !window.confirm(`Remove ${(draft.weeks[0].sessions[si] || {}).name || "this day"} from every week?`)) return;
      edit((d) => d.weeks.forEach((w) => { w.sessions.splice(si, 1); }));
    };
    const renameDay = (si, name) => edit((d) => sameDayEveryWeek(d, si, (s) => { s.name = name; }));

    // each section's reps, distance and time, and the day's
    const totals = (sections) => {
      const rows = sections.map((sec) => {
        const t = { name: sec.name, reps: 0, yards: 0, seconds: 0 };
        sec.series.forEach((sr) => sr.drills.forEach(({ e }) => { if (!(e.name || "").trim()) return; const a = window.speedAmount(e); t.reps += a.reps; t.yards += a.yards; t.seconds += a.seconds; }));
        return t;
      });
      const all = rows.reduce((n, r) => ({ reps: n.reps + r.reps, yards: n.yards + r.yards, seconds: n.seconds + r.seconds }), { reps: 0, yards: 0, seconds: 0 });
      return { rows: rows.filter((r) => r.reps || r.yards || r.seconds), all };
    };

    const dayCard = (s, wi, si) => {
      const inThisWeek = focus && focus.wi === wi;
      const sections = window.speedSections(s);
      const t = totals(sections);
      return (
        <div className={`program-day spd-day ${inThisWeek && focus.si !== si ? "day-dimmed" : ""}`} key={si}
          onMouseDown={() => { if (!focus || focus.wi !== wi || focus.si !== si) at(wi, si, null); }}>
          <div className="program-session-head">
            <input className="program-session-name" value={s.name || ""} aria-label="Day name" title="The day's name is the same in every week" onChange={(e) => renameDay(si, e.target.value)} />
            <button className="btn-link" title="Remove this day from every week" disabled={days <= 1} onClick={() => removeDay(si)}>✕</button>
          </div>
          {sections.map((sec, k) => {
            const on = focus && focus.wi === wi && focus.si === si && focus.sec;
            const cls = on ? (focus.sec === sec.name ? "sec-focused" : "sec-dimmed") : "";
            return (
              <div className={`spd-section ${cls}`} key={sec.name} onMouseDown={(e) => { e.stopPropagation(); at(wi, si, sec.name); }} onFocusCapture={() => at(wi, si, sec.name)}>
                <div className="spd-section-head">
                  <input className="spd-sec-name" value={sec.name} aria-label="Section name" title="The section's name is the same in every week" onChange={(e) => renameSection(si, sec.name, e.target.value)} />
                  <input className="spd-time" value={sec.time} placeholder="Time" aria-label={`Time for ${sec.name}`} onChange={(e) => setTime(wi, si, sec.name, e.target.value)} />
                  <span className="spd-sec-tools">
                    <button className="spd-x" title="Move this section up" disabled={k === 0} onClick={() => moveSection(si, sec.name, -1)}>↑</button>
                    <button className="spd-x" title="Move this section down" disabled={k === sections.length - 1} onClick={() => moveSection(si, sec.name, 1)}>↓</button>
                    <button className="spd-x" title="Remove this section from this day in every week" onClick={() => removeSection(si, sec.name)}>✕</button>
                  </span>
                </div>
                {sec.series.map((sr, j) => (
                  <div className={`spd-series${sr.name ? " named" : ""}`} key={`${sr.name}|${j}`}>
                    {sr.name && <input className="spd-series-name" value={sr.name} aria-label="Series name" onChange={(e) => renameSeries(wi, si, sec.name, sr.name, e.target.value)} />}
                    {sr.drills.map(({ e, index }) => {
                      const g = e.groups[0] || {};
                      const parsed = window.speedParse(e.distance);
                      const unclear = (e.distance || "").trim() && !parsed;
                      return (
                        <div className="spd-drill" key={e.id}>
                          <input className="spd-name" list="exercise-library-names" value={e.name} placeholder="Drill" onChange={(ev) => setDrill(wi, si, index, { name: ev.target.value })} />
                          <input className="spd-num" value={g.sets || ""} placeholder="Sets" title="Sets" onChange={(ev) => setGroup(wi, si, index, { sets: ev.target.value })} />
                          <input className="spd-num" value={g.reps || ""} placeholder="Reps" title="Reps in each set" onChange={(ev) => setGroup(wi, si, index, { reps: ev.target.value })} />
                          <input className={`spd-dist${unclear ? " unclear" : ""}`} value={e.distance || ""} placeholder="Dist / time" title={unclear ? "Not read as a distance or time, so it isn't in the totals. Try 10 yd, 120 ft, 30 m, 6 s or 1:00." : "Distance or time for each rep: 10 yd, 120 ft, 30 m, 6 s, 2 min, 1:00"} onChange={(ev) => setDrill(wi, si, index, { distance: ev.target.value })} />
                          <input className="spd-notes" value={e.notes || ""} placeholder="Notes" onChange={(ev) => setDrill(wi, si, index, { notes: ev.target.value })} />
                          <span className="spd-tools">
                            <label title="The athlete writes in their best time"><input type="checkbox" checked={!!e.record} onChange={(ev) => setDrill(wi, si, index, { record: ev.target.checked })} /> Time</label>
                            <button className="spd-x" title="Move up" onClick={() => moveDrill(wi, si, index, -1)}>↑</button>
                            <button className="spd-x" title="Move down" onClick={() => moveDrill(wi, si, index, 1)}>↓</button>
                            <button className="spd-x" title="Remove this drill" onClick={() => removeDrill(wi, si, index)}>✕</button>
                          </span>
                        </div>
                      );
                    })}
                    {sr.name && <button className="btn-link spd-add" onClick={() => addDrill(wi, si, sec.name, sr.name)}>+ Drill in this series</button>}
                  </div>
                ))}
                <div className="spd-section-foot">
                  <button className="btn-link spd-add" onClick={() => addDrill(wi, si, sec.name, "")}>+ Drill</button>
                  <button className="btn-link spd-add" onClick={() => addSeries(wi, si, sec.name)}>+ Series</button>
                </div>
              </div>
            );
          })}
          <button className="btn-link spd-add" title="Add a section to this day in every week" onClick={() => addSection(si)}>+ Section</button>
          <table className="spd-totals">
            <thead><tr><th>Totals</th><th>Reps</th><th>Distance</th><th>Time</th></tr></thead>
            <tbody>
              {t.rows.map((r) => <tr key={r.name}><td>{r.name}</td><td>{r.reps || ""}</td><td>{r.yards ? `${round(r.yards)} yd` : ""}</td><td>{r.seconds ? clock(r.seconds) : ""}</td></tr>)}
              <tr className="spd-total-row"><td>Day</td><td>{t.all.reps || ""}</td><td>{t.all.yards ? `${round(t.all.yards)} yd` : "—"}</td><td>{t.all.seconds ? clock(t.all.seconds) : "—"}</td></tr>
            </tbody>
          </table>
        </div>
      );
    };

    return (
      <div className={`panel program-editor spd-editor ${zoomMode === "fit" ? "program-fit" : ""}`} ref={rootRef}>
        <datalist id="exercise-library-names">
          {window.AthleteStore.allExercises().map((e) => <option key={e.id} value={e.name} />)}
        </datalist>
        <div className="program-editor-top">
          <h2>{initial && initial.id ? "Edit speed program" : "New speed program"}</h2>
          <span className="program-zoom" role="group" aria-label="Size">
            {[["1", "100%"], ["0.85", "85%"], ["0.7", "70%"], ["fit", "Fit week"]].map(([v, label]) => (
              <button key={v} className={`btn btn-small-grey ${zoomMode === v ? "on" : ""}`} title={v === "fit" ? "Shrink each week so all its days fit across the screen" : `Draw the days at ${label}`} onClick={() => setZoom(v)}>{label}</button>
            ))}
          </span>
          {focus && <button className="btn btn-small-grey program-show-all" onClick={() => setFocus(null)}>Show everything at full brightness</button>}
          {autoSave && <span className="timestamp-note">{saveState === "saved" ? (savedId.current ? "Saved" : "") : saveState === "pending" ? "Saving…" : "Give it a name to save"}</span>}
          {onSaveAndAssign && <button className="btn btn-assign" disabled={!canSave} onClick={() => canSave && onSaveAndAssign(manualRec())}>Save &amp; assign to athletes or a group</button>}
          <button className="btn btn-primary" disabled={!canSave} onClick={() => canSave && onSave(manualRec())}>Save program</button>
          <button className="btn btn-secondary" onClick={onCancel}>{cancelLabel || "Close"}</button>
          {onDelete && <button className="btn-link" onClick={onDelete}>Delete</button>}
        </div>
        <div className="spd-meta">
          <input className="spd-title" value={draft.name || ""} placeholder="Program name (e.g. MLB/MiLB OS Speed Ph I)" onChange={(e) => edit((d) => { d.name = e.target.value; })} />
          <input className="spd-desc" value={draft.description || ""} placeholder="Description (optional)" onChange={(e) => edit((d) => { d.description = e.target.value; })} />
        </div>
        <p className="timestamp-note">Click into a day to work on it: its week stands out and the other weeks and days dim, and the section you're in is highlighted. A day's name and its sections are the same in every week; times, drills, sets and distances are set week by week (Copy previous week starts a week from the one before).</p>
        {draft.weeks.map((w, wi) => (
          <div className={`program-week ${focus ? (focus.wi === wi ? "focused" : "dimmed") : ""}`} key={wi}
            onMouseDown={() => { if (!focus || focus.wi !== wi) at(wi, null, null); }}>
            <div className="program-week-head">
              <input className="program-week-name" value={w.name || ""} aria-label="Week name" onChange={(e) => edit((d) => { d.weeks[wi].name = e.target.value; })} />
              {wi > 0 && <button className="btn btn-small-grey program-copy-prev-week" title={`Replace ${w.name || `week ${wi + 1}`} with a copy of the week before`} onClick={() => copyPrevWeek(wi)}>Copy previous week</button>}
              <button className="btn-link program-remove-week" disabled={draft.weeks.length === 1} title="Remove this week" aria-label="Remove this week" onClick={() => removeWeek(wi)}>✕</button>
            </div>
            <div className="program-days">
              {w.sessions.map((s, si) => dayCard(s, wi, si))}
            </div>
          </div>
        ))}
        <div className="program-day-actions spd-bottom">
          <button className="btn btn-secondary" onClick={addWeek} title="Add a week, copied from the last one">+ Add week</button>
          {days < 7 && <button className="btn btn-secondary" onClick={addDay} title="Add a day to every week">+ Add day</button>}
        </div>
      </div>
    );
  }

  window.SpeedProgramEditor = SpeedProgramEditor;
  window.SpeedKit = { newSpeedProgram, newSpeedDay, DEFAULT_SECTIONS };
})();
