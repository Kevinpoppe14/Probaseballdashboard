// OVR import: the sprint and agility export from OVR (timing gates), as a CSV or Excel file. One row per sprint, or
// per split of a sprint that has more than one (5-10-5): Athlete, Sport, Position, Group(s), Date, Exercise,
// Sprint #, Split #, Distance (yd), In-Beam Start, Speed (mph), Split Time (s), Total Time (s), Trigger Start,
// Set Note.
//
// Each athlete's day of one drill becomes one testing result, the same record Coach Mode's Group Testing saves
// (kpi_entries): every sprint is a trial (its full time, from its last split), with the day's best and average.
// Drills that record a speed get a second result for top speed (mph). They show on the athlete's Training Log in
// the dashboard and under Testing on their phone app. Each drill is added to the shared testing list (app_meta
// "kpiDefs") as "<Drill> (OVR)", so Coach Mode can use it too.
//
// Only people in the dashboard who aren't alumni get results; nobody is created. Athletes are matched by name
// (ignoring case, spacing and punctuation), or by a match a coach made on an earlier import (remembered on the
// athlete as ovrNames). The coach sees every match before anything is saved and can change any of them. A
// result is saved under the athlete, drill and date, so importing the same export again updates it rather than
// adding a copy.
(function () {
  const { useState, useMemo } = React;
  const sb = () => window.supabaseClient;

  // the export's columns, by their name with everything but letters and digits taken out
  const COLUMNS = {
    athlete: "athlete", sport: "sport", position: "position", groups: "groups", date: "date", exercise: "exercise",
    sprint: "sprint", split: "split", distanceyd: "distance", inbeamstart: "inBeam", speedmph: "speed",
    splittimes: "splitTime", totaltimes: "totalTime", triggerstart: "trigger", setnote: "note",
  };
  const norm = (h) => String(h || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const num = (v) => { const s = String(v == null ? "" : v).replace(/,/g, "").trim(); return s !== "" && !isNaN(Number(s)) ? Number(s) : null; };
  const round3 = (v) => Math.round(v * 1000) / 1000;
  const slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const nameKey = (s) => String(s || "").toLowerCase().replace(/[^a-z]/g, "");

  // the file -> rows, or throws with what's wrong
  function readExport(XLSX, buffer) {
    // a CSV is read as plain text (raw), so "2026-07-29" stays that day instead of becoming a timestamp that can
    // land on the day before; an Excel file (a zip, starting "PK") keeps its own date cells
    const isExcel = buffer[0] === 0x50 && buffer[1] === 0x4b;
    const book = XLSX.read(buffer, isExcel ? { type: "array", cellDates: true } : { type: "array", raw: true });
    const sheet = book.Sheets[book.SheetNames[0]];
    const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, dateNF: "yyyy-mm-dd", defval: "" });
    const headAt = grid.findIndex((r) => r.some((c) => norm(c) === "athlete") && r.some((c) => norm(c) === "exercise") && r.some((c) => norm(c) === "totaltimes"));
    if (headAt === -1) throw new Error("This doesn't look like an OVR export: there's no Athlete, Exercise or Total Time (s) column.");
    const where = {};
    grid[headAt].forEach((h, i) => { const k = COLUMNS[norm(h)]; if (k && !(k in where)) where[k] = i; });
    const rows = [];
    grid.slice(headAt + 1).forEach((r) => {
      const cell = (k) => (k in where ? String(r[where[k]] == null ? "" : r[where[k]]).trim() : "");
      const when = window.EvoltReport && window.EvoltReport.parseWhen(cell("date"));
      if (!when || !cell("athlete") || !cell("exercise")) return; // a blank or summary row
      rows.push({
        athlete: cell("athlete").replace(/\s+/g, " "), date: when.date, exercise: cell("exercise").replace(/\s+/g, " "),
        sprint: num(cell("sprint")) || 1, split: num(cell("split")) || 1, distance: num(cell("distance")),
        speed: num(cell("speed")), splitTime: num(cell("splitTime")), totalTime: num(cell("totalTime")),
        inBeam: /^y/i.test(cell("inBeam")), trigger: /^y/i.test(cell("trigger")), note: cell("note"),
        group: cell("groups"), position: cell("position"),
      });
    });
    if (!rows.length) throw new Error("The export has no sprints in it. Check the date range in OVR and export it again.");
    return rows;
  }

  // rows -> one session per athlete, date and drill: each sprint's full time (its last split) and top speed
  function sessionsOf(rows) {
    const byKey = new Map();
    rows.forEach((r) => {
      const key = `${nameKey(r.athlete)}|${r.date}|${r.exercise}`;
      if (!byKey.has(key)) byKey.set(key, { athlete: r.athlete, date: r.date, exercise: r.exercise, sprints: new Map(), inBeam: false, distance: null, notes: [] });
      const s = byKey.get(key);
      if (!s.sprints.has(r.sprint)) s.sprints.set(r.sprint, { split: 0, time: null, speed: null });
      const sp = s.sprints.get(r.sprint);
      const t = r.totalTime != null ? r.totalTime : r.splitTime;
      if (r.split >= sp.split && t != null) { sp.split = r.split; sp.time = t; }
      if (r.speed != null) sp.speed = Math.max(sp.speed || 0, r.speed);
      if (r.inBeam) s.inBeam = true;
      if (r.distance != null) s.distance = r.distance;
      if (r.note && !s.notes.includes(r.note)) s.notes.push(r.note);
    });
    return [...byKey.values()].map((s) => {
      const list = [...s.sprints.entries()].sort((a, b) => a[0] - b[0]).map((x) => x[1]);
      return { ...s, times: list.map((x) => x.time).filter((v) => v != null).map(round3), speeds: list.map((x) => x.speed).filter((v) => v != null).map(round3) };
    }).filter((s) => s.times.length || s.speeds.length);
  }

  // the testing list entries for a drill: its time, and its top speed when the drill records one
  const timeDef = (exercise) => ({ id: `ovr-${slug(exercise)}`, name: `${exercise} (OVR)`, unit: "sec", better: "lower" });
  const speedDef = (exercise) => ({ id: `ovr-${slug(exercise)}-mph`, name: `${exercise} top speed (OVR)`, unit: "mph", better: "higher" });

  const SUFFIX = /^(jr|sr|ii|iii|iv|v)\.?$/i;
  const lastFirst = (name) => {
    const p = (name || "").trim().split(/\s+/);
    let i = p.length - 1;
    while (i > 1 && SUFFIX.test(p[i])) i -= 1;
    return p.length > 1 ? `${p.slice(i).join(" ")}, ${p.slice(0, i).join(" ")}` : name || "";
  };
  const shortDate = (d) => { const [y, mo, da] = d.split("-"); return `${Number(mo)}/${Number(da)}/${y.slice(2)}`; };
  const HOW = {
    before: ["good", "Matched before", "Matched to this athlete on an earlier import"],
    name: ["good", "Name", "The same name as in the dashboard"],
    ambiguous: ["danger", "Pick one", "More than one person in the dashboard has this name"],
    picked: ["info", "Picked", "Chosen here"],
  };
  function matchAthlete(name, people) {
    const key = nameKey(name);
    const before = people.filter((a) => (a.ovrNames || []).includes(key));
    if (before.length) return { athlete: before[0], how: "before" };
    const same = people.filter((a) => nameKey(a.name) === key);
    if (same.length === 1) return { athlete: same[0], how: "name" };
    if (same.length > 1) return { candidates: same, how: "ambiguous" };
    return {};
  }

  function OvrImporter({ onImported }) {
    const [fileName, setFileName] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [people0, setPeople0] = useState(null); // the export's athletes, each with their sessions and match
    const [choice, setChoice] = useState({}); // name key -> athlete id ("" = don't import)
    const [showOthers, setShowOthers] = useState(false);
    const [onFile, setOnFile] = useState(new Set()); // ids of OVR results already saved
    const [result, setResult] = useState(null);

    const people = useMemo(() => window.AthleteStore.allAthletes().filter((a) => (a.status || "active").toLowerCase() !== "alumni")
      .sort((a, b) => lastFirst(a.name).localeCompare(lastFirst(b.name))), [people0]);

    const handleFile = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      setError(""); setResult(null); setPeople0(null); setBusy(true); setFileName(file.name);
      try {
        const XLSX = await window.EvoltReport.loadSheetLib();
        const sessions = sessionsOf(readExport(XLSX, new Uint8Array(await file.arrayBuffer())));
        const byName = new Map();
        sessions.forEach((s) => {
          const key = nameKey(s.athlete);
          if (!byName.has(key)) byName.set(key, { key, name: s.athlete, sessions: [] });
          byName.get(key).sessions.push(s);
        });
        const list = [...byName.values()];
        const next = {};
        list.forEach((p) => {
          p.sessions.sort((a, b) => a.date.localeCompare(b.date) || a.exercise.localeCompare(b.exercise));
          Object.assign(p, matchAthlete(p.name, people));
          next[p.key] = p.athlete ? String(p.athlete.id) : "";
        });
        // which results are already on file, so the button can say what's new and what's an update
        const { data } = await sb().from("kpi_entries").select("id").like("id", "kpi|%|ovr-%").limit(20000);
        setOnFile(new Set((data || []).map((r) => r.id)));
        setPeople0(list);
        setChoice(next);
        setShowOthers(false);
      } catch (err) {
        setError((err && err.message) || "Couldn't read that file.");
      }
      setBusy(false);
      e.target.value = "";
    };

    // the results each session makes for an athlete: [{ id, data }]
    const entriesFor = (aid, s, by) => {
      const out = [];
      const stats = (vals, better) => ({ trials: vals, best: better === "lower" ? Math.min(...vals) : Math.max(...vals), avg: round3(vals.reduce((n, v) => n + v, 0) / vals.length) });
      const extra = { source: "ovr", drill: s.exercise, distanceYd: s.distance, inBeamStart: s.inBeam, note: s.notes.join(" · "), by, at: new Date().toISOString() };
      if (s.times.length) { const d = timeDef(s.exercise), st = stats(s.times, "lower"); out.push({ id: `kpi|${aid}|${d.id}|${s.date}`, def: d, data: { kpiId: d.id, kpiName: d.name, unit: d.unit, better: d.better, date: s.date, ...st, value: st.best, ...extra } }); }
      if (s.speeds.length) { const d = speedDef(s.exercise), st = stats(s.speeds, "higher"); out.push({ id: `kpi|${aid}|${d.id}|${s.date}`, def: d, data: { kpiId: d.id, kpiName: d.name, unit: d.unit, better: d.better, date: s.date, ...st, value: st.best, ...extra } }); }
      return out;
    };

    const rows = people0 ? people0.map((p) => {
      const id = choice[p.key];
      const athlete = id ? people.find((a) => String(a.id) === id) || null : null;
      const how = athlete ? (p.athlete && p.athlete.id === athlete.id ? p.how : "picked") : p.how === "ambiguous" ? "ambiguous" : "";
      const entries = athlete ? p.sessions.flatMap((s) => entriesFor(String(athlete.id), s, "")) : [];
      return { p, athlete, how, entries, fresh: entries.filter((x) => !onFile.has(x.id)).length };
    }) : [];
    const order = { before: 0, name: 1, picked: 2, ambiguous: 3, "": 4 };
    const matched = rows.filter((r) => r.athlete || r.how === "ambiguous").sort((a, b) => order[a.how] - order[b.how] || lastFirst(a.p.name).localeCompare(lastFirst(b.p.name)));
    const others = rows.filter((r) => !r.athlete && r.how !== "ambiguous").sort((a, b) => lastFirst(a.p.name).localeCompare(lastFirst(b.p.name)));
    const toSave = rows.filter((r) => r.athlete && r.entries.length);
    const total = toSave.reduce((n, r) => n + r.entries.length, 0);
    const updates = toSave.reduce((n, r) => n + (r.entries.length - r.fresh), 0);
    const drills = people0 ? [...new Set(people0.flatMap((p) => p.sessions.map((s) => s.exercise)))].sort() : [];

    const doImport = async () => {
      setBusy(true); setError("");
      try {
        const by = window.AthleteStore.currentUserEmail ? window.AthleteStore.currentUserEmail() || "" : "";
        const now = new Date().toISOString();
        const out = toSave.flatMap((r) => r.p.sessions.flatMap((s) => entriesFor(String(r.athlete.id), s, by).map((x) => ({ id: x.id, athlete_id: String(r.athlete.id), data: x.data, updated_at: now, def: x.def }))));
        // the drills, on the shared testing list
        const { data: meta, error: metaErr } = await sb().from("app_meta").select("value").eq("key", "kpiDefs").maybeSingle();
        if (metaErr) throw metaErr;
        const defs = meta && Array.isArray(meta.value) ? meta.value.slice() : [];
        let added = 0;
        out.forEach((x) => { if (!defs.some((d) => d.id === x.def.id)) { defs.push(x.def); added += 1; } });
        if (added) {
          defs.sort((a, b) => a.name.localeCompare(b.name));
          const { error: e2 } = await sb().from("app_meta").upsert({ key: "kpiDefs", value: defs });
          if (e2) throw e2;
        }
        for (let i = 0; i < out.length; i += 500) {
          const { error: e3 } = await sb().from("kpi_entries").upsert(out.slice(i, i + 500).map((x) => ({ id: x.id, athlete_id: x.athlete_id, data: x.data, updated_at: x.updated_at })));
          if (e3) throw e3;
        }
        // a name matched by picking is remembered on the athlete, so the next import finds them straight away
        toSave.forEach(({ p, athlete, how }) => {
          if (how === "picked" && !(athlete.ovrNames || []).includes(p.key)) window.AthleteStore.updateAthlete(athlete.id, { ovrNames: [...(athlete.ovrNames || []), p.key] });
        });
        setResult({ saved: out.length, athletes: toSave.length, drillsAdded: added });
        onImported && onImported();
      } catch (err) {
        setError((err && err.message) || "Couldn't save the results. Check your connection and try again.");
      }
      setBusy(false);
    };

    const reset = () => { setPeople0(null); setChoice({}); setResult(null); setError(""); setFileName(""); };

    const personRow = (r) => {
      const { p, athlete, how, entries, fresh } = r;
      const [tone, label, tip] = HOW[how] || ["neutral", "Not imported", "Nobody in the dashboard has this name; pick someone to import their results"];
      const span = `${shortDate(p.sessions[0].date)}${p.sessions.length > 1 ? ` – ${shortDate(p.sessions[p.sessions.length - 1].date)}` : ""}`;
      const sprints = p.sessions.reduce((n, s) => n + Math.max(s.times.length, s.speeds.length), 0);
      return (
        <tr key={p.key} style={{ cursor: "default" }}>
          <td><strong>{p.name}</strong><div className="evolt-sub">{[...new Set(p.sessions.map((s) => s.exercise))].join(", ")}</div></td>
          <td>
            <select className="evolt-pick" value={choice[p.key] ?? ""} onChange={(e) => setChoice({ ...choice, [p.key]: e.target.value })}>
              <option value="">— Don't import —</option>
              {how === "ambiguous" && !athlete && p.candidates.map((a) => <option key={`c${a.id}`} value={a.id}>{lastFirst(a.name)} (possible)</option>)}
              {people.filter((a) => !(how === "ambiguous" && !athlete && p.candidates.includes(a))).map((a) => <option key={a.id} value={a.id}>{lastFirst(a.name)}</option>)}
            </select>
          </td>
          <td><span className={`badge ${tone}`} title={tip}>{label}</span></td>
          <td>{sprints} <span className="evolt-sub inline">{p.sessions.length} session{p.sessions.length === 1 ? "" : "s"} · {span}</span></td>
          <td>{athlete ? (fresh ? <strong>{fresh} new</strong> : <span className="evolt-sub inline">{entries.length} to update</span>) : "—"}</td>
        </tr>
      );
    };

    return (
      <div className="panel">
        <h2>OVR — Sprint &amp; Agility Testing</h2>
        <ol className="evolt-steps">
          <li>In OVR, export the sprint data (the CSV with Athlete, Date, Exercise, Sprint #, Split #, Speed (mph), Split Time (s) and Total Time (s)).</li>
          <li>Choose the file below (.csv, or the same as an Excel file). Nothing is saved until you check the matches and click Import.</li>
        </ol>
        <p className="evolt-note">
          Each athlete's day of a drill becomes one testing result: every sprint a trial (its full time; for a drill with splits, like the
          5-10-5, the total), with the day's best and average. Drills that record speed also get a top speed result (mph). Results show on
          the athlete's Training Log and under Testing in their app, and each drill is added to Coach Mode's testing list as "&lt;Drill&gt; (OVR)".
          Only people in the dashboard who aren't alumni get results, and nobody new is created. Importing the same export again updates
          those results rather than adding copies.
        </p>

        {error && <div className="success-banner" style={{ background: "#3a1414", color: "var(--danger)", borderColor: "#5a1f1f" }}>{error}</div>}
        {result && (
          <div className="success-banner">
            Imported {result.saved} result{result.saved === 1 ? "" : "s"} for {result.athletes} athlete{result.athletes === 1 ? "" : "s"}
            {result.drillsAdded ? `, and added ${result.drillsAdded} drill${result.drillsAdded === 1 ? "" : "s"} to the testing list` : ""}.{" "}
            <button className="btn-link" onClick={reset}>Import another export</button>
          </div>
        )}

        {!people0 && !result && (
          <div className="file-drop">
            <input type="file" accept=".csv,.xlsx,.xls" onChange={handleFile} disabled={busy} />
            <span style={{ color: "var(--text-dim)", fontSize: 12 }}>{busy ? `Reading ${fileName}…` : "The CSV OVR exports (or an Excel copy of it)."}</span>
          </div>
        )}

        {people0 && !result && (
          <div>
            <p className="evolt-summary">
              <strong>{fileName}</strong>: {people0.reduce((n, p) => n + p.sessions.length, 0)} sessions from {people0.length} athletes, drills: {drills.join(", ")}.{" "}
              {matched.filter((r) => r.athlete).length} matched to the dashboard{matched.some((r) => r.how === "ambiguous" && !r.athlete) ? `, ${matched.filter((r) => r.how === "ambiguous" && !r.athlete).length} to pick` : ""}.
              {" "}Check the matches, change any that are wrong, then import.
            </p>
            <div className="evolt-actions">
              <button className="btn btn-primary" disabled={!total || busy} onClick={doImport}>
                {busy ? "Saving…" : total ? `Import ${total} result${total === 1 ? "" : "s"} for ${toSave.length} athlete${toSave.length === 1 ? "" : "s"}${updates ? ` (${updates} update${updates === 1 ? "" : "s"})` : ""}` : "Nothing to import"}
              </button>
              <button className="btn btn-secondary" onClick={reset} disabled={busy}>Cancel</button>
            </div>
            <table className="evolt-table">
              <thead><tr><th>OVR athlete</th><th>Dashboard athlete</th><th>Matched by</th><th>Sprints</th><th>Results</th></tr></thead>
              <tbody>
                {matched.length ? matched.map(personRow) : <tr><td colSpan={5} className="evolt-sub">Nobody in this export matched the dashboard. Pick athletes from the list below.</td></tr>}
              </tbody>
            </table>
            {others.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <button className="btn-link" onClick={() => setShowOthers(!showOthers)}>{showOthers ? "Hide" : "Show"} the {others.length} OVR athlete{others.length === 1 ? "" : "s"} not in the dashboard</button>
                {showOthers && (
                  <table className="evolt-table" style={{ marginTop: 8 }}>
                    <thead><tr><th>OVR athlete</th><th>Dashboard athlete</th><th>Matched by</th><th>Sprints</th><th>Results</th></tr></thead>
                    <tbody>{others.map(personRow)}</tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  window.OvrImporter = OvrImporter;
  window.OvrExport = { readExport, sessionsOf, matchAthlete }; // for checking an import by hand
})();
