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
  const newDrill = (section, series) => ({ id: uid(), name: "", tempo: "", intensityUnit: "", groups: [{ sets: "", reps: "", intensity: "" }], rest: "", notes: "", linked: false, section, series: series || "", distance: "", extras: [] });
  // totals: reps (sets x reps), distance in yards, time
  const round = (n) => Math.round(n * 10) / 10;
  const clock = (sec) => { const s = Math.round(sec); return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : `${s}s`; };
  const newSpeedDay = (n) => ({ name: `Day ${n}`, sections: DEFAULT_SECTIONS.map((name) => ({ name, time: "" })), exercises: [] });
  const newSpeedProgram = (weeks = 4, days = 4) => ({ name: "", description: "", layout: "speed", tags: [], nextProgramIds: [], weeks: Array.from({ length: weeks }, (_, w) => ({ name: `Week ${w + 1}`, sessions: Array.from({ length: days }, (_, d) => newSpeedDay(d + 1)) })) });
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const freshIds = (day) => ({ ...clone(day), exercises: (day.exercises || []).map((e) => ({ ...clone(e), id: uid() })) });

  // ---- throwing programs: the same builder (layout "throwing"), with throwing sections, and each day an intensity,
  // Low (green), Medium (yellow) or High (red), as on the athlete's Throwing Progression. A program built from an
  // athlete's progression (throwing_progression.js) has a day for each throwing day there, named and colored by it
  // ("Mon · L-2x25"; `tpDay` is its day of the week, Sunday 0); those days follow the progression, and the coach
  // fills in the drills. A program made on the Programs page sets each day's intensity itself.
  const THROW_SECTIONS = ["Warm-up / Arm Care", "Plyo Ball", "Catch Play / Long Toss", "Recovery"];
  const THROW_LEVELS = { L: { name: "Low", cls: "low" }, M: { name: "Medium", cls: "med" }, H: { name: "High", cls: "high" } };
  const DAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const newThrowingDay = (n) => ({ name: `Day ${n}`, level: "", sections: THROW_SECTIONS.map((name) => ({ name, time: "" })), exercises: [] });
  const newThrowingProgram = (weeks = 4, days = 3) => ({ name: "", description: "", layout: "throwing", tags: [], nextProgramIds: [], weeks: Array.from({ length: weeks }, (_, w) => ({ name: `Week ${w + 1}`, sessions: Array.from({ length: days }, (_, d) => newThrowingDay(d + 1)) })) });
  const tpLabel = (d) => (d && d.level ? `${d.level}${d.text ? `-${d.text}` : ""}` : "OFF");
  // the boxes a throwing drill can ask the athlete to fill in from the app (a target typed here shows beside the box):
  // the throws they actually made (on every throwing drill to start with), and where it applies a distance or velocity
  const THROW_BOXES = ["Throws", "Distance", "Velo"]; // (the phone asks for distance in ft and velo in mph; plain labels, as each box is saved under its label)
  // Warm-up / arm care and recovery aren't throws: their drills get no Throws box to start with and aren't in the
  // day's throws (nor in the athlete's ACR, see throwing_progression.js). A drill's throws are sets x reps, a range of
  // reps counting as its middle ("25-30" is 27.5); reps that aren't a count ("30sec") aren't throws.
  const notThrows = (section) => /warm|arm care|recover/i.test(section || "");
  const countOf = (s) => { const m = /^(\d+(?:\.\d+)?)(?:\s*-\s*(\d+(?:\.\d+)?))?$/.exec(`${s || ""}`.trim()); return m ? (m[2] ? (parseFloat(m[1]) + parseFloat(m[2])) / 2 : parseFloat(m[1])) : NaN; };
  const drillThrows = (e) => {
    if (!e || notThrows(e.section) || !(e.name || "").trim()) return 0;
    const g = (e.groups || [])[0] || {}, reps = countOf(g.reps), sets = `${g.sets || ""}`.trim() ? countOf(g.sets) : 1;
    return Number.isFinite(reps) && Number.isFinite(sets) ? sets * reps : 0;
  };
  // A throwing program laid over an athlete's progression: a week for each of its weeks, a day for each throwing day
  // (Sunday first), named and colored from it. Days already built keep their drills; a day the progression turned OFF
  // stays only if it has drills in it (marked OFF).
  function syncWithProgression(program, tp) {
    const weeks = (tp && Array.isArray(tp.weeks)) ? tp.weeks : [];
    const out = program ? clone(program) : newThrowingProgram(0, 0);
    out.layout = "throwing";
    const old = out.weeks || [];
    out.weeks = weeks.map((w, wi) => {
      const prev = old[wi] || { sessions: [] };
      const sessions = [];
      (w.days || []).forEach((d, di) => {
        const had = (prev.sessions || []).find((s) => s.tpDay === di);
        const built = had && (had.exercises || []).some((e) => (e.name || "").trim());
        if (!(d && d.level) && !built) return;
        const s = had || newThrowingDay(sessions.length + 1);
        if (!Array.isArray(s.sections)) s.sections = THROW_SECTIONS.map((name) => ({ name, time: "" }));
        s.tpDay = di;
        s.level = (d && d.level) || "";
        s.name = `${DAY_ABBR[di]} · ${tpLabel(d)}`;
        sessions.push(s);
      });
      return { name: prev.name || `Week ${wi + 1}`, sessions };
    });
    return out;
  }

  function SpeedProgramEditor({ initial, onSave, onCancel, onDelete, onDirty, cancelLabel, onSaveAndAssign, autoSave, kind, embedded }) {
    const THROW = kind === "throwing" || !!(initial && initial.layout === "throwing");
    const blank = () => (THROW ? newThrowingProgram() : newSpeedProgram());
    const [draft, setDraft] = useState(() => {
      const d = clone(initial && (initial.weeks || []).length ? initial : { ...blank(), ...(initial || {}), weeks: blank().weeks });
      d.layout = THROW ? "throwing" : "speed";
      d.weeks.forEach((w) => w.sessions.forEach((s) => { if (!Array.isArray(s.sections)) s.sections = window.speedSections(s).map((x) => ({ name: x.name, time: x.time })); s.exercises = (s.exercises || []).map((e) => {
        const n = window.speedNormalize(e); delete n.volume; delete n.category;
        // the old "Time" tick becomes a Time box, as if added with the "+"
        if (n.record) { n.extras = Array.isArray(n.extras) ? n.extras : []; if (!n.extras.some((x) => /^time$/i.test(x.label || ""))) n.extras.push({ label: "Time", value: "" }); }
        delete n.record;
        return n;
      }); }));
      return d;
    });
    const draftRef = React.useRef(draft);
    draftRef.current = draft;
    const edit = (fn) => { if (onDirty) onDirty(); setDraft((d) => { const c = clone(d); fn(c); return c; }); };
    const canSave = (draft.name || "").trim().length > 0;

    // ---- where the coach is working: a day is followed through the program, so clicking into Day 1 lights Day 1 in
    // every week (and the section clicked into, in each of them) and dims every other day, to progress that day
    // from week to week ----
    const [focus, setFocus] = useState(null); // { si, sec }
    const at = (si, sec) => setFocus((f) => (f && f.si === si && f.sec === sec ? f : { si, sec }));

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
    const recOf = (d) => ({ name: (d.name || "").trim(), description: (d.description || "").trim(), layout: THROW ? "throwing" : "speed", weeks: d.weeks, nextProgramIds: d.nextProgramIds || [], tags: d.tags || [] });
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
    const setSectionField = (wi, si, name, field, v) => edit((d) => { const s = sess(d, wi, si), x = s.sections.find((y) => y.name === name); if (x) x[field] = v; else s.sections.push({ name, time: "", [field]: v }); });
    const setTime = (wi, si, name, time) => setSectionField(wi, si, name, "time", time);
    // boxes kept out of the way until wanted: a drill's notes ("+ Note") and a section's description ("+ Description")
    const [opened, setOpened] = useState({}); // "note|<drill id>" or "desc|<week>|<day>|<section>" -> true
    // a new drill goes straight after the last one of its series (or its section), so a series stays together
    const addDrill = (wi, si, section, series) => edit((d) => {
      const xs = sess(d, wi, si).exercises;
      let last = -1;
      xs.forEach((e, i) => { if (e.section === section && (series == null || (e.series || "") === series)) last = i; });
      const drill = newDrill(section, series);
      if (THROW && !notThrows(section)) drill.extras = [{ label: "Throws", value: "" }]; // the athlete writes in the throws they made
      xs.splice(last >= 0 ? last + 1 : xs.length, 0, drill);
    });
    const addSeries = (wi, si, section) => {
      const name = (window.prompt("Series name (e.g. Acceleration Series - Prowler)") || "").trim();
      if (name) addDrill(wi, si, section, name);
    };
    const renameSeries = (wi, si, section, oldName, name) => edit((d) => sess(d, wi, si).exercises.forEach((e) => { if (e.section === section && (e.series || "") === oldName) e.series = name; }));
    const setDrill = (wi, si, index, patch) => edit((d) => Object.assign(sess(d, wi, si).exercises[index], patch));
    const addExtra = (wi, si, index, label) => edit((d) => { const e = sess(d, wi, si).exercises[index]; e.extras = [...(Array.isArray(e.extras) ? e.extras : []), { label, value: "" }]; });
    const setExtra = (wi, si, index, xi, value) => edit((d) => { sess(d, wi, si).exercises[index].extras[xi].value = value; });
    const removeExtra = (wi, si, index, xi) => edit((d) => { sess(d, wi, si).exercises[index].extras.splice(xi, 1); });
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
    // days laid out from an athlete's throwing progression: the progression decides the weeks and days, named and
    // colored; the builder only fills them in
    const fromProgression = THROW && draft.weeks.some((w) => w.sessions.some((s) => s.tpDay != null));
    const copyPrevWeek = (wi) => {
      const w = draftRef.current.weeks[wi];
      const filled = w.sessions.some((s) => s.exercises.some((e) => (e.name || "").trim()));
      if (filled && !window.confirm(`Replace everything in ${w.name || `week ${wi + 1}`} with a copy of ${draftRef.current.weeks[wi - 1].name || `week ${wi}`}?`)) return;
      if (fromProgression) {
        // each day takes the drills of the same weekday the week before (or the day in its place), keeping its own name and color
        edit((d) => d.weeks[wi].sessions.forEach((s, k) => {
          const prev = d.weeks[wi - 1].sessions, src = prev.find((p) => p.tpDay === s.tpDay) || prev[k];
          if (src) { const c = freshIds(src); s.sections = c.sections; s.exercises = c.exercises; }
        }));
        return;
      }
      edit((d) => { d.weeks[wi] = { name: d.weeks[wi].name, sessions: d.weeks[wi - 1].sessions.map(freshIds) }; });
    };
    // ---- copying a section's drills, or a whole day, onto other days: the other days this week ("week"), this day in
    // the weeks after ("same": the same weekday, on a program laid out from the progression), or every day from this
    // week on ("after"). The copies replace what those days had there; their names and intensities stay their own.
    const COPY_TO = [["week", "To the other days this week"], ["same", fromProgression ? "To this weekday in the weeks after" : "To this day in the weeks after"], ["after", "To every day from this week on"]];
    const targetsOf = (d, wi, si, how) => {
      const src = sess(d, wi, si), out = [];
      d.weeks.forEach((w, wj) => w.sessions.forEach((s, sj) => {
        if (wj === wi && sj === si) return;
        if (how === "week" && wj !== wi) return;
        if (how === "after" && wj < wi) return;
        if (how === "same" && (wj <= wi || (src.tpDay != null ? s.tpDay !== src.tpDay : sj !== si))) return;
        out.push([wj, sj]);
      }));
      return out;
    };
    const dayWord = (n) => `${n} day${n === 1 ? "" : "s"}`;
    const copySection = (wi, si, name, how) => {
      const d0 = draftRef.current, tg = targetsOf(d0, wi, si, how);
      const n = sess(d0, wi, si).exercises.filter((e) => e.section === name && (e.name || "").trim()).length;
      if (!tg.length) { window.alert("There are no days there to copy to."); return; }
      const filled = tg.filter(([wj, sj]) => sess(d0, wj, sj).exercises.some((e) => e.section === name && (e.name || "").trim())).length;
      if (!window.confirm(`Copy ${name} (${n} drill${n === 1 ? "" : "s"}) to ${dayWord(tg.length)}?${filled ? ` ${dayWord(filled)} already ${filled === 1 ? "has" : "have"} drills in ${name}; they'll be replaced.` : ""}`)) return;
      edit((d) => {
        const s0 = sess(d, wi, si), at0 = s0.sections.findIndex((x) => x.name === name), sec0 = s0.sections[at0] || { name, time: "" };
        const drills = s0.exercises.filter((e) => e.section === name);
        tg.forEach(([wj, sj]) => {
          const s = sess(d, wj, sj);
          if (!s.sections.some((x) => x.name === name)) s.sections.splice(Math.max(0, Math.min(at0, s.sections.length)), 0, { name, time: "" });
          const x = s.sections.find((y) => y.name === name);
          x.time = sec0.time || "";
          if (sec0.description) x.description = sec0.description; else delete x.description;
          s.exercises = s.exercises.filter((e) => e.section !== name).concat(drills.map((e) => ({ ...clone(e), id: uid() })));
        });
      });
    };
    const copyDay = (wi, si, how) => {
      const d0 = draftRef.current, tg = targetsOf(d0, wi, si, how);
      if (!tg.length) { window.alert("There are no days there to copy to."); return; }
      const filled = tg.filter(([wj, sj]) => sess(d0, wj, sj).exercises.some((e) => (e.name || "").trim())).length;
      if (!window.confirm(`Copy all of ${sess(d0, wi, si).name || "this day"} (every section and drill) to ${dayWord(tg.length)}?${filled ? ` ${dayWord(filled)} already ${filled === 1 ? "has" : "have"} drills; they'll be replaced.` : ""}`)) return;
      edit((d) => {
        const src = sess(d, wi, si);
        tg.forEach(([wj, sj]) => { const s = sess(d, wj, sj), c = freshIds(src); s.sections = c.sections; s.exercises = c.exercises; });
      });
    };
    const copyMenu = (label, onPick, cls) => (
      <select className={`spd-copy ${cls || ""}`} value="" title={label} aria-label={label} onChange={(ev) => { const v = ev.target.value; ev.target.value = ""; if (v) onPick(v); }}>
        <option value="" disabled hidden>⧉</option>
        {COPY_TO.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
      </select>
    );
    const addWeek = () => edit((d) => { const last = d.weeks[d.weeks.length - 1]; d.weeks.push({ name: `Week ${d.weeks.length + 1}`, sessions: last.sessions.map(freshIds) }); });
    const removeWeek = (wi) => { if (draft.weeks.length > 1 && window.confirm(`Remove ${draft.weeks[wi].name || `week ${wi + 1}`}?`)) edit((d) => { d.weeks.splice(wi, 1); }); };
    const days = Math.max(...draft.weeks.map((w) => w.sessions.length));
    const addDay = () => edit((d) => d.weeks.forEach((w) => { if (w.sessions.length < 7) w.sessions.push(THROW ? newThrowingDay(w.sessions.length + 1) : newSpeedDay(w.sessions.length + 1)); }));
    const setLevel = (wi, si, level) => edit((d) => { sess(d, wi, si).level = level; });
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
      const dayCls = focus ? (focus.si === si ? "day-focused" : "day-dimmed") : "";
      const sections = window.speedSections(s);
      const t = totals(sections);
      const linked = THROW && s.tpDay != null; // named and colored by the athlete's throwing progression
      const lvl = THROW ? (THROW_LEVELS[s.level] ? s.level : "") : null;
      return (
        <div className={`program-day spd-day ${dayCls} ${THROW ? `thr-day thr-${lvl ? THROW_LEVELS[lvl].cls : "off"}` : ""}`} key={si}
          onMouseDown={() => { if (!focus || focus.si !== si) at(si, null); }}>
          <div className="program-session-head">
            {linked
              ? <span className="program-session-name thr-day-name" title="From the throwing progression: change it there">{s.name}</span>
              : <input className="program-session-name" value={s.name || ""} aria-label="Day name" title="The day's name is the same in every week" onChange={(e) => renameDay(si, e.target.value)} />}
            {copyMenu("Copy this whole day (every section and drill) to other days", (how) => copyDay(wi, si, how), "spd-copy-day")}
            {!linked && <button className="btn-link" title="Remove this day from every week" disabled={days <= 1} onClick={() => removeDay(si)}>✕</button>}
          </div>
          {/* a throwing day's intensity, this week: Low, Medium, High or off (from the progression on a day laid out from it) */}
          {THROW && !linked && (
            <div className="thr-levels" role="group" aria-label="Intensity">
              {["L", "M", "H", ""].map((k) => (
                <button key={k || "off"} className={`thr-lvl thr-${k ? THROW_LEVELS[k].cls : "off"} ${lvl === k ? "on" : ""}`} title={k ? `${THROW_LEVELS[k].name} intensity this week` : "Off this week"} onClick={() => setLevel(wi, si, k)}>{k || "Off"}</button>
              ))}
            </div>
          )}
          {sections.map((sec, k) => {
            const on = focus && focus.si === si && focus.sec;
            const cls = on ? (focus.sec === sec.name ? "sec-focused" : "sec-dimmed") : "";
            return (
              <div className={`spd-section ${cls}`} key={sec.name} onMouseDown={(e) => { e.stopPropagation(); at(si, sec.name); }} onFocusCapture={() => at(si, sec.name)}>
                <div className="spd-section-head">
                  <input className="spd-sec-name" value={sec.name} aria-label="Section name" title="The section's name is the same in every week" onChange={(e) => renameSection(si, sec.name, e.target.value)} />
                  <input className="spd-time" value={sec.time} placeholder="Time" aria-label={`Time for ${sec.name}`} onChange={(e) => setTime(wi, si, sec.name, e.target.value)} />
                  <span className="spd-sec-tools">
                    {copyMenu(`Copy ${sec.name} (its drills, time and description) to other days`, (how) => copySection(wi, si, sec.name, how))}
                    <button className="spd-x" title="Move this section up" disabled={k === 0} onClick={() => moveSection(si, sec.name, -1)}>↑</button>
                    <button className="spd-x" title="Move this section down" disabled={k === sections.length - 1} onClick={() => moveSection(si, sec.name, 1)}>↓</button>
                    <button className="spd-x" title="Remove this section from this day in every week" onClick={() => removeSection(si, sec.name)}>✕</button>
                  </span>
                </div>
                {/* a description for the top of the section in the app (this week's), kept to a link until there is one */}
                {sec.description || opened[`desc|${wi}|${si}|${sec.name}`]
                  ? <textarea className="spd-sec-desc" rows={2} value={sec.description} placeholder="Description (shows at the top of this section in the app)" autoFocus={!sec.description} onChange={(e) => setSectionField(wi, si, sec.name, "description", e.target.value)} />
                  : <button className="btn-link spd-add" onClick={() => setOpened((o) => ({ ...o, [`desc|${wi}|${si}|${sec.name}`]: true }))}>+ Description</button>}
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
                          <input className={`spd-dist${unclear ? " unclear" : ""}`} value={e.distance || ""} placeholder={THROW ? "Dist (ft)" : "Dist / time"} title={unclear ? "Not read as a distance or time, so it isn't in the totals. Try 10 yd, 120 ft, 30 m, 6 s or 1:00." : THROW ? "Distance for each throw (90 ft, 120 ft), or a time (30 s)" : "Distance or time for each rep: 10 yd, 120 ft, 30 m, 6 s, 2 min, 1:00"} onChange={(ev) => setDrill(wi, si, index, { distance: ev.target.value })} />
                          {/* a throwing drill's ball weight, in ounces or grams (weighted and plyo balls) */}
                          {THROW && (() => {
                            const m = /^(\d+(?:\.\d+)?)\s*(oz|g)$/i.exec((e.weight || "").trim());
                            const amount = m ? m[1] : "", unit = m ? m[2].toLowerCase() : (/g$/i.test(e.weight || "") ? "g" : "oz");
                            const put = (a, u) => setDrill(wi, si, index, { weight: String(a).trim() ? `${String(a).trim()} ${u}` : "" });
                            return (
                              <span className="thr-weight" title="Ball weight (weighted or plyo balls); leave empty for a regular baseball">
                                <input className="spd-num" value={amount} placeholder="Wt" inputMode="decimal" aria-label="Ball weight" onChange={(ev) => put(ev.target.value.replace(/[^\d.]/g, ""), unit)} />
                                <select value={unit} aria-label="Weight unit" onChange={(ev) => put(amount, ev.target.value)}><option value="oz">oz</option><option value="g">g</option></select>
                              </span>
                            );
                          })()}
                          {/* boxes added with the "+" (Time, Height...): a target here, or left empty; the athlete fills in their own in the app */}
                          {(e.extras || []).map((x, xi) => (
                            <span className="spd-extra" key={xi}>
                              <span className="spd-extra-label">{x.label}</span>
                              <input value={x.value || ""} placeholder="Target, or leave for the athlete" title={`${x.label}: a target for the athlete, or leave it empty. The athlete writes in their own ${x.label.toLowerCase()} in the app.`} onChange={(ev) => setExtra(wi, si, index, xi, ev.target.value)} />
                              <button className="spd-x" title={`Remove ${x.label}`} onClick={() => removeExtra(wi, si, index, xi)}>✕</button>
                            </span>
                          ))}
                          {(e.notes || opened[`note|${e.id}`]) && <input className="spd-notes" value={e.notes || ""} placeholder="Notes" autoFocus={!e.notes} onChange={(ev) => setDrill(wi, si, index, { notes: ev.target.value })} />}
                          <span className="spd-tools">
                            <select className="pe-more spd-more" value="" title="Add a box (time, height, distance, speed, or one you name) or a note" onChange={(ev) => {
                              const v = ev.target.value;
                              if (v === "note") setOpened((o) => ({ ...o, [`note|${e.id}`]: true }));
                              else if (v === "custom") { const label = (window.prompt("Name the new box (for example Height, Load, Holds):") || "").trim().slice(0, 20); if (label) addExtra(wi, si, index, label); }
                              else if (v) addExtra(wi, si, index, v);
                            }}>
                              <option value="" disabled hidden>+</option>
                              {(THROW ? THROW_BOXES : ["Time", "Height", "Distance", "Speed"]).filter((l) => !(e.extras || []).some((x) => (x.label || "").toLowerCase() === l.toLowerCase())).map((l) => <option key={l} value={l}>{l}</option>)}
                              <option value="custom">Custom…</option>
                              {!e.notes && !opened[`note|${e.id}`] && <option value="note">Note</option>}
                            </select>
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
          {THROW ? (
            // a throwing day's prescribed throws (sets x reps), by section and for the day; warm-up / arm care and recovery left out
            (() => {
              const rows = sections.filter((sec) => !notThrows(sec.name)).map((sec) => ({ name: sec.name, n: sec.series.reduce((t, sr) => t + sr.drills.reduce((u, { e }) => u + drillThrows(e), 0), 0) })).filter((r) => r.n);
              const all = rows.reduce((t, r) => t + r.n, 0);
              return (
                <table className="spd-totals">
                  <thead><tr><th>Totals</th><th>Throws</th></tr></thead>
                  <tbody>
                    {rows.map((r) => <tr key={r.name}><td>{r.name}</td><td>{round(r.n)}</td></tr>)}
                    <tr className="spd-total-row"><td>Day</td><td>{all ? round(all) : "—"}</td></tr>
                  </tbody>
                  {sections.some((sec) => notThrows(sec.name) && sec.series.some((sr) => sr.drills.some(({ e }) => (e.name || "").trim()))) && (
                    <tfoot><tr><td colSpan={2} className="spd-totals-note">Warm-up / arm care and recovery aren't counted as throws.</td></tr></tfoot>
                  )}
                </table>
              );
            })()
          ) : (
            <table className="spd-totals">
              <thead><tr><th>Totals</th><th>Reps</th><th>Distance</th><th>Time</th></tr></thead>
              <tbody>
                {t.rows.map((r) => <tr key={r.name}><td>{r.name}</td><td>{r.reps || ""}</td><td>{r.yards ? `${round(r.yards)} yd` : ""}</td><td>{r.seconds ? clock(r.seconds) : ""}</td></tr>)}
                <tr className="spd-total-row"><td>Day</td><td>{t.all.reps || ""}</td><td>{t.all.yards ? `${round(t.all.yards)} yd` : "—"}</td><td>{t.all.seconds ? clock(t.all.seconds) : "—"}</td></tr>
              </tbody>
            </table>
          )}
        </div>
      );
    };

    return (
      <div className={`${embedded ? "" : "panel "}program-editor spd-editor ${THROW ? "thr-editor" : ""} ${zoomMode === "fit" ? "program-fit" : ""}`} ref={rootRef}>
        <datalist id="exercise-library-names">
          {window.AthleteStore.allExercises().map((e) => <option key={e.id} value={e.name} />)}
        </datalist>
        <div className="program-editor-top">
          <h2>{THROW ? (initial && initial.id ? "Edit throwing program" : "New throwing program") : initial && initial.id ? "Edit speed program" : "New speed program"}</h2>
          <span className="program-zoom" role="group" aria-label="Size">
            {[["1", "100%"], ["0.85", "85%"], ["0.7", "70%"], ["fit", "Fit week"]].map(([v, label]) => (
              <button key={v} className={`btn btn-small-grey ${zoomMode === v ? "on" : ""}`} title={v === "fit" ? "Shrink each week so all its days fit across the screen" : `Draw the days at ${label}`} onClick={() => setZoom(v)}>{label}</button>
            ))}
          </span>
          {/* always there (hidden until something is dimmed), so its showing up never moves the program mid-click */}
          <button className="btn btn-small-grey program-show-all" style={focus ? undefined : { visibility: "hidden" }} disabled={!focus} tabIndex={focus ? undefined : -1} onClick={() => setFocus(null)}>Show everything at full brightness</button>
          {autoSave && <span className="timestamp-note">{saveState === "saved" ? (savedId.current ? "Saved" : "") : saveState === "pending" ? "Saving…" : "Give it a name to save"}</span>}
          {onSaveAndAssign && <button className="btn btn-assign" disabled={!canSave} onClick={() => canSave && onSaveAndAssign(manualRec())}>Save &amp; assign to athletes or a group</button>}
          {onSave && <button className="btn btn-primary" disabled={!canSave} onClick={() => canSave && onSave(manualRec())}>Save program</button>}
          {onCancel && <button className="btn btn-secondary" onClick={onCancel}>{cancelLabel || "Close"}</button>}
          {onDelete && <button className="btn-link" onClick={onDelete}>Delete</button>}
        </div>
        <div className="spd-meta">
          <input className="spd-title" value={draft.name || ""} placeholder={THROW ? "Program name (e.g. Off-Season Throwing Ph I)" : "Program name (e.g. MLB/MiLB OS Speed Ph I)"} onChange={(e) => edit((d) => { d.name = e.target.value; })} />
          <input className="spd-desc" value={draft.description || ""} placeholder="Description (optional)" onChange={(e) => edit((d) => { d.description = e.target.value; })} />
        </div>
        {THROW
          ? <p className="timestamp-note">{fromProgression
            ? "One day for each throwing day on the progression above, named and colored from it (green Low, yellow Medium, red High): change a day's intensity or throws up there and it follows here. Fill in each day's drills: sets x reps (the prescribed throws), the distance, and a ball weight in oz or g for weighted balls. Each drill asks the athlete for the throws they made; add Distance (ft) or Velo (mph) with the + where it applies, with a target if you like. Use ⧉ on a section or a day to copy it to the other days this week, the same day in later weeks, or every day from this week on."
            : "Each day has an intensity for the week (green Low, yellow Medium, red High, or off), which colors it here and in the athlete's app. Drills take sets x reps (the prescribed throws), a distance, and a ball weight in oz or g; each asks the athlete for the throws they made, and the + adds Distance or Velo (mph) where it applies. Use ⧉ on a section or a day to copy it to other days."}</p>
          : <p className="timestamp-note">Click into a day to work on it: that day lights up in every week and the other days dim, so you can progress it through the program, and the section you're in is highlighted in each week. A day's name and its sections are the same in every week; times, drills, sets and distances are set week by week (Copy previous week starts a week from the one before).</p>}
        {draft.weeks.map((w, wi) => (
          <div className="program-week" key={wi}>
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
        {/* a program laid out from the progression gets its weeks and days from there */}
        {!fromProgression && (
          <div className="program-day-actions spd-bottom">
            <button className="btn btn-secondary" onClick={addWeek} title="Add a week, copied from the last one">+ Add week</button>
            {days < 7 && <button className="btn btn-secondary" onClick={addDay} title="Add a day to every week">+ Add day</button>}
          </div>
        )}
      </div>
    );
  }

  window.SpeedProgramEditor = SpeedProgramEditor;
  window.SpeedKit = { newSpeedProgram, newSpeedDay, DEFAULT_SECTIONS, newThrowingProgram, newThrowingDay, syncWithProgression, THROW_LEVELS, DAY_ABBR };
})();
