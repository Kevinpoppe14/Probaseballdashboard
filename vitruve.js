// Vitruve — bringing velocity data from Vitruve Teams into an athlete's Training Log.
//
// Vitruve Teams exports an athlete's history as a CSV (Progress → pick the athlete and exercise → export). The
// "Import Vitruve CSV" button on the Training Log reads one or more of those files, works out which column is
// the date, the exercise, the set and the rep, and keeps every other column as a metric (numbers) or a note
// (short text), whatever the export happens to contain. The coach checks a short preview and can correct the
// column choices before importing. Each day's data then shows on the Training Log as its own card, in date
// order with that day's lift.
//
// Nothing here depends on particular column names, because Vitruve's export differs by account and version.
// Rows are stored in vitruve_rows (see migration_013); importing the same file twice updates rather than doubles.
(function () {
  const { useState, useRef } = React;

  // ---- reading a file ---------------------------------------------------------------------------------
  const clean = (v) => String(v == null ? "" : v).trim();
  // "0,85" (comma decimals, common in Vitruve's Spanish-format exports) and "1,234.5" both become numbers
  const toNumber = (v) => {
    let s = clean(v);
    if (!s || !/^-?[\d.,\s]+$/.test(s)) return null;
    s = s.replace(/\s/g, "");
    if (/^-?\d+,\d+$/.test(s)) s = s.replace(",", ".");
    else s = s.replace(/,/g, "");
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  };
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  // a date in almost any form -> "YYYY-MM-DD" (local day), or null. dayFirst: 03/04/2026 means 3 April.
  const toDate = (v, dayFirst) => {
    const s = clean(v);
    if (!s) return null;
    if (/^\d{10,13}$/.test(s)) { const d = new Date(Number(s) * (s.length <= 10 ? 1000 : 1)); return isNaN(d) ? null : iso(d); }
    let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/);
    if (m) {
      // a full timestamp with a time zone is turned into the local day it happened on
      if (/[T\s]\d{1,2}:\d{2}.*(Z|[+-]\d{2}:?\d{2})$/.test(s)) { const d = new Date(s.replace(" ", "T")); if (!isNaN(d)) return iso(d); }
      return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
    }
    m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?:[,T\s].*)?$/);
    if (m) {
      const a = Number(m[1]), b = Number(m[2]);
      const year = m[3].length === 2 ? `20${m[3]}` : m[3];
      const day = dayFirst ? a : b, month = dayFirst ? b : a;
      if (month < 1 || month > 12 || day < 1 || day > 31) return null;
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
    const d = new Date(s);
    return isNaN(d) ? null : iso(d);
  };
  // true: the dates can only be day/month; false: only month/day; null: cannot tell from this file
  const dayFirstIn = (values) => {
    let verdict = null;
    values.some((v) => {
      const m = clean(v).match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})/);
      if (!m) return false;
      if (Number(m[1]) > 12) { verdict = true; return true; }
      if (Number(m[2]) > 12) { verdict = false; return true; }
      return false;
    });
    return verdict;
  };

  // which column plays which part, guessed from the header names (English and Spanish)
  const ROLE_NAMES = {
    exercise: [/^exercise( ?name)?$/i, /^ejercicio/i, /exercise|ejercicio|movement/i],
    date: [/^(date|fecha)$/i, /date|fecha/i, /^(day|d[ií]a)$/i, /time|created|timestamp/i],
    set: [/^(set|sets|serie|series)$/i, /^(set|serie) ?(number|no\.?|#|index|n[uú]m.*)$/i],
    rep: [/^(rep|reps|repetition|repetitions|repetici[oó]n|repeticiones)$/i, /^rep(etition)? ?(number|no\.?|#|index|n[uú]m.*)$/i],
    athlete: [/^(athlete|atleta|user|usuario)( ?name)?$/i, /athlete|atleta/i, /^(name|nombre)$/i],
  };
  const guessRoles = (headers) => {
    const roles = {};
    const used = new Set();
    Object.keys(ROLE_NAMES).forEach((role) => {
      ROLE_NAMES[role].some((pattern) => {
        const hit = headers.find((h) => !used.has(h) && pattern.test(h));
        if (hit) { roles[role] = hit; used.add(hit); }
        return !!hit;
      });
      if (!roles[role]) roles[role] = "";
    });
    return roles;
  };
  const readFile = (file) => new Promise((resolve) => {
    window.Papa.parse(file, {
      header: true, skipEmptyLines: "greedy",
      complete: (res) => {
        const headers = (res.meta.fields || []).map(clean).filter(Boolean);
        const rows = res.data.map((r) => { const o = {}; Object.keys(r).forEach((k) => { if (clean(k)) o[clean(k)] = r[k]; }); return o; });
        const roles = guessRoles(headers);
        const guess = roles.date ? dayFirstIn(rows.map((r) => r[roles.date])) : null;
        resolve({
          name: file.name, headers, rows, roles,
          dayFirst: guess === true, dayFirstKnown: guess !== null,
          // Vitruve's export is one file per athlete and exercise, often with no exercise column: the file name is a starting point
          exerciseName: file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim(),
        });
      },
      error: () => resolve({ name: file.name, headers: [], rows: [], roles: guessRoles([]), error: true }),
    });
  });

  // the rows of one file, ready to store
  const slug = (s) => clean(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const buildRows = (f, athleteId, by) => {
    const out = [];
    const seen = {}; // how many rows already share this date, exercise, set and rep (keeps ids steady on a re-import)
    let skipped = 0;
    const rolesUsed = new Set(Object.values(f.roles).filter(Boolean));
    f.rows.forEach((r) => {
      const date = f.roles.date ? toDate(r[f.roles.date], f.dayFirst) : null;
      if (!date) { skipped += 1; return; }
      const exercise = clean(f.roles.exercise ? r[f.roles.exercise] : f.exerciseName) || "Exercise";
      const set = f.roles.set ? clean(r[f.roles.set]) : "", rep = f.roles.rep ? clean(r[f.roles.rep]) : "";
      const metrics = {}, text = {};
      f.headers.forEach((h) => {
        if (rolesUsed.has(h)) return;
        const n = toNumber(r[h]);
        if (n != null) metrics[h] = n;
        else if (clean(r[h]) && clean(r[h]).length <= 60) text[h] = clean(r[h]);
      });
      if (!Object.keys(metrics).length && !Object.keys(text).length) { skipped += 1; return; }
      const key = `${date}|${slug(exercise)}|${set}|${rep}`;
      seen[key] = (seen[key] || 0) + 1;
      out.push({
        id: `vit|${athleteId}|${key}|${seen[key]}`,
        data: { source: "vitruve", date, exercise, set, rep, order: out.length, metrics, text, file: f.name, importedBy: by, importedAt: new Date().toISOString() },
      });
    });
    return { rows: out, skipped };
  };

  // ---- the import button and its preview --------------------------------------------------------------
  function VitruveImport({ athlete, onDone }) {
    const store = window.AthleteStore;
    const pick = useRef(null);
    const [files, setFiles] = useState(null); // files read and waiting to be checked
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState("");
    const change = (i, patch) => setFiles((fs) => fs.map((f, j) => (j === i ? { ...f, ...patch } : f)));
    const choose = async (e) => {
      const chosen = [...e.target.files];
      e.target.value = "";
      if (!chosen.length) return;
      const csv = chosen.filter((f) => /\.(csv|txt)$/i.test(f.name));
      setMsg(csv.length < chosen.length ? "Only CSV files can be read. In Vitruve, choose CSV rather than Excel when exporting." : "");
      if (csv.length) setFiles(await Promise.all(csv.map(readFile)));
    };
    const run = async () => {
      setBusy(true);
      let total = 0, skipped = 0, failed = false;
      for (const f of files) {
        if (!f.roles.date) continue;
        const built = buildRows(f, athlete.id, store.currentUserEmail());
        skipped += built.skipped;
        if (built.rows.length && !(await store.saveVitruveRows(athlete.id, built.rows))) { failed = true; break; }
        total += built.rows.length;
      }
      setBusy(false);
      if (failed) { setMsg("Could not save. If this is the first import, the Vitruve table may not be set up yet (migration_013)."); return; }
      setFiles(null);
      const done = (`Imported ${total} row${total === 1 ? "" : "s"} for ${athlete.name}.${skipped ? ` ${skipped} row${skipped === 1 ? " was" : "s were"} left out (no date, or nothing in ${skipped === 1 ? "it" : "them"}).` : ""}`);
      setMsg("");
      if (onDone) onDone(done);
    };
    const column = (f, i, role, label) => (
      <label className="facility-field"><span>{label}</span>
        <select value={f.roles[role]} onChange={(e) => change(i, { roles: { ...f.roles, [role]: e.target.value } })}>
          <option value="">(none)</option>
          {f.headers.map((h) => <option key={h} value={h}>{h}</option>)}
        </select>
      </label>
    );
    return (
      <React.Fragment>
        <input ref={pick} type="file" accept=".csv,text/csv,.txt" multiple style={{ display: "none" }} onChange={choose} />
        <button className="btn btn-secondary" onClick={() => pick.current.click()} title="Reads CSV files exported from Vitruve Teams (Progress → athlete → exercise → export)">Import Vitruve CSV</button>
        {msg && <span className="timestamp-note">{msg}</span>}
        {files && (
          <div className="vit-preview">
            <strong>Check before importing into {athlete.name}'s Training Log</strong>
            {files.map((f, i) => {
              if (f.error || !f.headers.length) return <div className="vit-file" key={i}><b>{f.name}</b><span>Could not be read as a CSV.</span></div>;
              const built = f.roles.date ? buildRows(f, athlete.id, "") : { rows: [], skipped: f.rows.length };
              const first = built.rows[0] && built.rows[0].data, last = built.rows.length ? built.rows[built.rows.length - 1].data : null;
              const dates = built.rows.map((r) => r.data.date).sort();
              const named = f.roles.athlete ? clean((f.rows[0] || {})[f.roles.athlete]) : "";
              const lastName = clean(athlete.name).split(/\s+/).pop().toLowerCase();
              return (
                <div className="vit-file" key={i}>
                  <b>{f.name}</b>
                  <div className="facility-form-grid">
                    {column(f, i, "date", "Date column")}
                    {column(f, i, "exercise", "Exercise column")}
                    {column(f, i, "set", "Set column")}
                    {column(f, i, "rep", "Rep column")}
                    {!f.roles.exercise && (
                      <label className="facility-field"><span>Exercise (this file has no exercise column)</span>
                        <input value={f.exerciseName} onChange={(e) => change(i, { exerciseName: e.target.value })} />
                      </label>
                    )}
                  </div>
                  {f.roles.date && !f.dayFirstKnown && (
                    <label className="vit-check"><input type="checkbox" checked={f.dayFirst} onChange={(e) => change(i, { dayFirst: e.target.checked })} /> Dates are written day first (03/04/2026 is 3 April)</label>
                  )}
                  {!f.roles.date
                    ? <span className="vit-warn">Pick the column that holds the date. Without it the rows cannot be lined up with the Training Log.</span>
                    : first
                      ? <span>{built.rows.length} row{built.rows.length === 1 ? "" : "s"} from {dates[0]} to {dates[dates.length - 1]}. First row: {first.date}, {first.exercise}{first.set ? `, set ${first.set}` : ""}{first.rep ? `, rep ${first.rep}` : ""}. Metrics: {Object.keys({ ...first.metrics, ...(last ? last.metrics : {}) }).join(", ") || "none found"}.{built.skipped ? ` ${built.skipped} row${built.skipped === 1 ? "" : "s"} will be left out.` : ""}</span>
                      : <span className="vit-warn">No rows could be read with these columns. Check the date column.</span>}
                  {named && lastName && !named.toLowerCase().includes(lastName) && <span className="vit-warn">This file is for “{named}”. It will be imported into {athlete.name}'s log.</span>}
                </div>
              );
            })}
            <div className="tl-actions">
              <button className="btn btn-assign" disabled={busy || !files.some((f) => f.roles.date && f.rows.length)} onClick={run}>{busy ? "Importing…" : "Import"}</button>
              <button className="btn-link" onClick={() => setFiles(null)}>Cancel</button>
            </div>
          </div>
        )}
      </React.Fragment>
    );
  }

  // ---- one day of Vitruve data on the Training Log -----------------------------------------------------
  const show = (n) => (Math.abs(n) >= 100 ? Math.round(n * 10) / 10 : Math.round(n * 1000) / 1000);
  const byNumber = (a, b) => (toNumber(a) != null && toNumber(b) != null ? toNumber(a) - toNumber(b) : String(a).localeCompare(String(b)));
  function VitruveDayCard({ date, rows, onRemove }) {
    const exercises = [];
    rows.forEach((r) => {
      let e = exercises.find((x) => x.name.toLowerCase() === r.exercise.toLowerCase());
      if (!e) { e = { name: r.exercise, rows: [] }; exercises.push(e); }
      e.rows.push(r);
    });
    return (
      <div className="panel tl-session">
        <h2>
          {new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric", year: "numeric" })}
          <small>Vitruve · {exercises.map((e) => e.name).join(", ")}</small>
          <span className="tl-badge marked">Imported from Vitruve · {rows.length} row{rows.length === 1 ? "" : "s"}</span>
        </h2>
        {exercises.map((e) => {
          const sorted = [...e.rows].sort((a, b) => byNumber(a.set || "", b.set || "") || byNumber(a.rep || "", b.rep || "") || (a.order || 0) - (b.order || 0));
          const metrics = [...new Set(sorted.flatMap((r) => Object.keys(r.metrics || {})))];
          const notes = [...new Set(sorted.flatMap((r) => Object.keys(r.text || {})))];
          const hasSet = sorted.some((r) => r.set), hasRep = sorted.some((r) => r.rep);
          const average = (m) => { const v = sorted.map((r) => (r.metrics || {})[m]).filter((x) => x != null); return v.length ? show(v.reduce((s, x) => s + x, 0) / v.length) : ""; };
          return (
            <div className="vit-ex" key={e.name}>
              <h3>{e.name}</h3>
              <div className="vit-scroll">
                <table className="tl-table vit-table">
                  <thead><tr>{hasSet && <th>Set</th>}{hasRep && <th>Rep</th>}{metrics.map((m) => <th key={m}>{m}</th>)}{notes.map((n) => <th key={n}>{n}</th>)}</tr></thead>
                  <tbody>
                    {sorted.map((r) => (
                      <tr key={r.id}>{hasSet && <td>{r.set}</td>}{hasRep && <td>{r.rep}</td>}{metrics.map((m) => <td key={m} className="tl-done">{(r.metrics || {})[m] != null ? show(r.metrics[m]) : ""}</td>)}{notes.map((n) => <td key={n}>{(r.text || {})[n] || ""}</td>)}</tr>
                    ))}
                    {sorted.length > 1 && metrics.length > 0 && (
                      <tr className="vit-avg">{(hasSet || hasRep) && <td colSpan={(hasSet ? 1 : 0) + (hasRep ? 1 : 0)}>Average</td>}{metrics.map((m) => <td key={m}>{average(m)}</td>)}{notes.map((n) => <td key={n}></td>)}</tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
        <div className="tl-actions no-print"><button className="btn-link" onClick={onRemove}>Remove this day's Vitruve data</button></div>
      </div>
    );
  }

  window.VitruveImport = VitruveImport;
  window.VitruveDayCard = VitruveDayCard;
  window.VitruveCsv = { toNumber, toDate, dayFirstIn, guessRoles, buildRows }; // exposed for checking
})();
