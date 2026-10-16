// Evolt360 import — the Result Activity Report from Evolt Insights (launch.evoltactive.com › Reports › Result
// Activity Report › Download Report), as the Excel file it downloads (a CSV of it works too). One row per scan:
// Evolt's scan Id, the date and time, the member's first name and last initial, their email and mobile, and
// the body composition figures in pounds and inches.
//
// Only people in the dashboard who aren't alumni get scans; nobody is created. Each Evolt member is matched by,
// in turn: a match a coach made on an earlier import (remembered on the athlete as evoltKeys), their email, their
// mobile, then first name + last initial when exactly one person fits. The coach sees every match before anything
// is saved and can change any of them. A scan whose Evolt Id is already on file is skipped, so the same report,
// or one overlapping an earlier one, can be imported again safely.
(function () {
  const { useState, useMemo } = React;

  // SheetJS reads the Excel file (and CSV); loaded the first time it is needed
  let sheetLib = null;
  function loadSheetLib() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (sheetLib) return sheetLib;
    sheetLib = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
      s.onload = () => (window.XLSX ? resolve(window.XLSX) : reject(new Error("The spreadsheet reader didn't load.")));
      s.onerror = () => { sheetLib = null; reject(new Error("Couldn't load the spreadsheet reader. Check your connection and try again.")); };
      document.head.append(s);
    });
    return sheetLib;
  }

  // the report's columns, by their name with everything but letters and digits taken out ("BWI ®" is "bwi",
  // "L.B.M'" is "lbm"). Where a name comes twice (L.B.M does), the first is used. A column of zeros means it
  // wasn't measured (blood pressure, pulse, A.C), so zeros there are left blank.
  const COLUMNS = {
    id: "evoltId", date: "date", firstname: "first", lastname: "last", email: "email", mobile: "mobile",
    gender: "gender", age: "age", height: "heightIn", weight: "weightLb", percentbodyfat: "bodyFatPct", bwi: "bwi",
    bioage: "bioAge", bmi: "bmi", lbm: "lbmLb", smm: "smmLb", smmrating: "smmRating", mineral: "mineralLb",
    protein: "proteinLb", whr: "whr", tbw: "tbwLb", ac: "ac", bodyfat: "bodyFatLb", subcutaneousfat: "subcutFatLb",
    visceralfat: "visceralFat", visceralfatarea: "visceralFatArea", systolic: "systolic", diastolic: "diastolic", pulse: "pulse",
  };
  const TEXT = ["evoltId", "date", "first", "last", "email", "mobile", "gender", "smmRating"];
  const ZERO_IS_BLANK = ["ac", "systolic", "diastolic", "pulse"];
  const MEASURES = Object.values(COLUMNS).filter((k) => !TEXT.includes(k) && k !== "age");
  const norm = (h) => String(h || "").toLowerCase().replace(/[^a-z0-9]/g, "");

  // "09/22/2026 14:26:48", or "2026-09-22 14:26" (how an Excel date cell comes out) -> { date, time }
  function parseWhen(raw) {
    const s = String(raw || "").trim();
    let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:[ T]+(\d{1,2}):(\d{2}))?/);
    if (m) {
      const y = m[3].length === 2 ? `20${m[3]}` : m[3];
      return { date: `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`, time: m[4] ? `${m[4].padStart(2, "0")}:${m[5]}` : "" };
    }
    m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T]+(\d{1,2}):(\d{2}))?/);
    if (m) return { date: `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`, time: m[4] ? `${m[4].padStart(2, "0")}:${m[5]}` : "" };
    return null;
  }

  // the report's first sheet -> scans, or throws with what's wrong
  function readReport(XLSX, buffer) {
    const book = XLSX.read(buffer, { type: "array", cellDates: true });
    const sheet = book.Sheets[book.SheetNames[0]];
    const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, dateNF: "yyyy-mm-dd hh:mm", defval: "" });
    const headAt = grid.findIndex((r) => r.some((c) => norm(c) === "firstname") && r.some((c) => norm(c) === "percentbodyfat"));
    if (headAt === -1) throw new Error("This doesn't look like Evolt's Result Activity Report: there's no First Name or Percent Body Fat column.");
    const where = {};
    grid[headAt].forEach((h, i) => { const k = COLUMNS[norm(h)]; if (k && !(k in where)) where[k] = i; });
    const scans = [];
    grid.slice(headAt + 1).forEach((r) => {
      const cell = (k) => (k in where ? String(r[where[k]] == null ? "" : r[where[k]]).trim() : "");
      const when = parseWhen(cell("date"));
      if (!when || !(cell("first") || cell("email"))) return; // a blank or summary row
      const scan = { evoltId: cell("evoltId"), date: when.date, time: when.time, first: cell("first"), last: cell("last"), email: cell("email").toLowerCase(), mobile: cell("mobile").replace(/\D/g, "").slice(-10), gender: cell("gender"), smmRating: cell("smmRating") };
      MEASURES.concat("age").forEach((k) => {
        const v = cell(k).replace(/,/g, "");
        if (v === "" || isNaN(Number(v))) return;
        const n = Math.round(Number(v) * 100) / 100;
        if (n === 0 && ZERO_IS_BLANK.includes(k)) return;
        scan[k] = n;
      });
      scans.push(scan);
    });
    if (!scans.length) throw new Error("The report has no scans in it. Check the date range in Evolt and download it again.");
    return scans;
  }

  // ---- matching -------------------------------------------------------------------------------------------
  const SUFFIX = /^(jr|sr|ii|iii|iv|v)\.?$/i;
  function nameParts(name) {
    const p = (name || "").trim().split(/\s+/).filter(Boolean);
    while (p.length > 2 && SUFFIX.test(p[p.length - 1])) p.pop();
    return { first: (p[0] || "").toLowerCase(), last: (p.length > 1 ? p[p.length - 1] : "").toLowerCase() };
  }
  const memberKey = (s) => (s.email && s.email.includes("@") ? s.email : s.mobile.length === 10 ? `m:${s.mobile}` : `n:${s.first.toLowerCase()}|${s.last.toLowerCase()}`);

  // who a member is: { athlete, how } or { candidates, how: "ambiguous" } or {} when nobody fits
  function matchMember(m, people) {
    const first = m.first.toLowerCase(), last = m.last.replace(/\.$/, "").toLowerCase();
    const sameFirst = (a) => nameParts(a.name).first === first;
    const pick = (list, how) => {
      if (list.length === 1) return { athlete: list[0], how };
      const named = list.filter(sameFirst); // a parent's email or number shared by brothers: the first name decides
      return named.length === 1 ? { athlete: named[0], how } : null;
    };
    const remembered = people.filter((a) => (a.evoltKeys || []).includes(m.key));
    if (remembered.length) return pick(remembered, "before") || { athlete: remembered[0], how: "before" };
    const byEmail = m.emails.length ? people.filter((a) => a.email && m.emails.includes(a.email.trim().toLowerCase())) : [];
    if (byEmail.length) { const r = pick(byEmail, "email"); if (r) return r; }
    const phone = (a) => String(a.phone || "").replace(/\D/g, "").slice(-10);
    const byPhone = m.mobiles.length ? people.filter((a) => phone(a).length === 10 && m.mobiles.includes(phone(a))) : [];
    if (byPhone.length) { const r = pick(byPhone, "phone"); if (r) return r; }
    if (!first || !last) return {};
    const byName = people.filter((a) => {
      const n = nameParts(a.name);
      return n.first === first && n.last && (last.length === 1 ? n.last.startsWith(last) : n.last === last);
    });
    if (byName.length === 1) return { athlete: byName[0], how: "name" };
    if (byName.length > 1) return { candidates: byName, how: "ambiguous" };
    return {};
  }

  const HOW = {
    before: ["good", "Matched before", "Matched to this athlete on an earlier import"],
    email: ["good", "Email", "The email on the Evolt account is this athlete's"],
    phone: ["good", "Mobile", "The mobile on the Evolt account is this athlete's"],
    name: ["warn", "Name", "First name and last initial; check it's the right person"],
    ambiguous: ["danger", "Pick one", "More than one person has this first name and last initial"],
    picked: ["info", "Picked", "Chosen here"],
  };
  // "Carter Cattan Jr." -> "Cattan Jr., Carter"
  const lastFirst = (name) => {
    const p = (name || "").trim().split(/\s+/);
    let i = p.length - 1;
    while (i > 1 && SUFFIX.test(p[i])) i -= 1;
    return p.length > 1 ? `${p.slice(i).join(" ")}, ${p.slice(0, i).join(" ")}` : name || "";
  };
  const shortDate = (d) => { const [y, mo, da] = d.split("-"); return `${Number(mo)}/${Number(da)}/${y.slice(2)}`; };

  function EvoltImporter({ onImported }) {
    const [fileName, setFileName] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [members, setMembers] = useState(null); // the report's people, each with their scans and match
    const [choice, setChoice] = useState({}); // member key -> athlete id ("" = don't import)
    const [showOthers, setShowOthers] = useState(false);
    const [result, setResult] = useState(null);

    // everyone who can be given scans: anyone in the dashboard who isn't alumni
    const people = useMemo(() => window.AthleteStore.allAthletes().filter((a) => (a.status || "active").toLowerCase() !== "alumni")
      .sort((a, b) => lastFirst(a.name).localeCompare(lastFirst(b.name))), [members]);
    // scans already on file, by Evolt Id, and by athlete + date + time for any without one
    const onFile = useMemo(() => {
      const ids = new Set(), when = new Set();
      window.AthleteStore.allAthletes().forEach((a) => window.AthleteStore.getBodyComp(a.id).forEach((s) => {
        if (s.evoltId) ids.add(String(s.evoltId));
        when.add(`${a.id}|${s.date}|${s.time || ""}`);
      }));
      return { ids, when };
    }, [members, result]);

    const handleFile = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      setError(""); setResult(null); setMembers(null); setBusy(true); setFileName(file.name);
      try {
        const XLSX = await loadSheetLib();
        const scans = readReport(XLSX, new Uint8Array(await file.arrayBuffer()));
        // one entry per Evolt member, their scans oldest first
        const byKey = new Map();
        scans.forEach((s) => {
          const key = memberKey(s);
          if (!byKey.has(key)) byKey.set(key, { key, first: s.first, last: s.last, emails: [], mobiles: [], scans: [] });
          const m = byKey.get(key);
          if (s.email && !m.emails.includes(s.email)) m.emails.push(s.email);
          if (s.mobile && !m.mobiles.includes(s.mobile)) m.mobiles.push(s.mobile);
          if (!m.scans.some((x) => x.evoltId && x.evoltId === s.evoltId)) m.scans.push(s); // the same scan twice in one file
        });
        const list = [...byKey.values()];
        const next = {};
        list.forEach((m) => {
          m.scans.sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
          m.first = m.first.charAt(0).toUpperCase() + m.first.slice(1); // "evelyn" -> "Evelyn"
          Object.assign(m, matchMember(m, people));
          next[m.key] = m.athlete ? String(m.athlete.id) : "";
        });
        setMembers(list);
        setChoice(next);
        setShowOthers(false);
      } catch (err) {
        setError((err && err.message) || "Couldn't read that file.");
      }
      setBusy(false);
      e.target.value = "";
    };

    const isNew = (s, athleteId) => !(s.evoltId ? onFile.ids.has(String(s.evoltId)) : onFile.when.has(`${athleteId}|${s.date}|${s.time || ""}`));
    const rows = members ? members.map((m) => {
      const id = choice[m.key];
      const athlete = id ? people.find((a) => String(a.id) === id) || null : null;
      const how = athlete ? (m.athlete && m.athlete.id === athlete.id ? m.how : "picked") : m.how === "ambiguous" ? "ambiguous" : "";
      return { m, athlete, how, fresh: athlete ? m.scans.filter((s) => isNew(s, athlete.id)) : [] };
    }) : [];
    const order = { before: 0, email: 1, phone: 2, picked: 3, name: 4, ambiguous: 5, "": 6 };
    const matched = rows.filter((r) => r.athlete || r.how === "ambiguous").sort((a, b) => order[a.how] - order[b.how] || lastFirst(a.athlete ? a.athlete.name : a.m.first).localeCompare(lastFirst(b.athlete ? b.athlete.name : b.m.first)));
    const others = rows.filter((r) => !r.athlete && r.how !== "ambiguous").sort((a, b) => `${a.m.first} ${a.m.last}`.localeCompare(`${b.m.first} ${b.m.last}`));
    const toSave = rows.filter((r) => r.athlete && r.fresh.length);
    const scanCount = toSave.reduce((n, r) => n + r.fresh.length, 0);
    // the same dashboard athlete picked for two Evolt members is allowed (an athlete with two Evolt accounts),
    // but worth a look, so it is pointed out
    const twice = new Set(rows.filter((r) => r.athlete).map((r) => r.athlete.id).filter((id, i, all) => all.indexOf(id) !== i));

    const doImport = () => {
      let saved = 0;
      toSave.forEach(({ m, athlete, fresh, how }) => {
        fresh.forEach((s) => {
          const entry = { athleteId: athlete.id, date: s.date, time: s.time, source: "evolt", evoltId: s.evoltId };
          MEASURES.concat("age").forEach((k) => { if (typeof s[k] === "number") entry[k] = s[k]; });
          if (s.smmRating) entry.smmRating = s.smmRating;
          window.AthleteStore.addBodyComp(entry);
          saved += 1;
        });
        // a match by name or picked here is remembered on the athlete, so the next import finds them straight away
        if ((how === "name" || how === "picked") && !(athlete.evoltKeys || []).includes(m.key)) {
          window.AthleteStore.updateAthlete(athlete.id, { evoltKeys: [...(athlete.evoltKeys || []), m.key] });
        }
      });
      setResult({ saved, athletes: toSave.length });
      onImported && onImported();
    };

    const reset = () => { setMembers(null); setChoice({}); setResult(null); setError(""); setFileName(""); };

    const memberRow = (r) => {
      const { m, athlete, how, fresh } = r;
      const [tone, label, tip] = HOW[how] || ["neutral", "Not imported", "Nobody in the dashboard fits; pick someone to import their scans"];
      const options = how === "ambiguous" && !athlete ? m.candidates : people;
      const span = m.scans.length ? `${shortDate(m.scans[0].date)}${m.scans.length > 1 ? ` – ${shortDate(m.scans[m.scans.length - 1].date)}` : ""}` : "";
      return (
        <tr key={m.key} style={{ cursor: "default" }}>
          <td><strong>{m.first} {m.last}</strong><div className="evolt-sub">{m.emails[0] || (m.mobiles[0] ? `Mobile ending ${m.mobiles[0].slice(-4)}` : "")}</div></td>
          <td>
            <select className="evolt-pick" value={choice[m.key] ?? ""} onChange={(e) => setChoice({ ...choice, [m.key]: e.target.value })}>
              <option value="">— Don't import —</option>
              {how === "ambiguous" && !athlete && m.candidates.map((a) => <option key={`c${a.id}`} value={a.id}>{lastFirst(a.name)} (possible)</option>)}
              {(how === "ambiguous" && !athlete ? people.filter((a) => !m.candidates.includes(a)) : options).map((a) => <option key={a.id} value={a.id}>{lastFirst(a.name)}</option>)}
            </select>
            {athlete && twice.has(athlete.id) && <div className="evolt-sub warn">Also picked for another Evolt member</div>}
          </td>
          <td><span className={`badge ${tone}`} title={tip}>{label}</span></td>
          <td>{m.scans.length} <span className="evolt-sub inline">{span}</span></td>
          <td>{athlete ? (fresh.length ? <strong>{fresh.length}</strong> : <span className="evolt-sub inline">already on file</span>) : "—"}</td>
        </tr>
      );
    };

    return (
      <div className="panel">
        <h2>Evolt360 — Body Composition Scans</h2>
        <ol className="evolt-steps">
          <li>In <a href="https://launch.evoltactive.com/reports" target="_blank" rel="noopener noreferrer">Evolt Insights</a>, open <strong>Reports › Result Activity Report</strong>.</li>
          <li>Set the <strong>Date Range</strong> (for everything, start it at 07/01/2022) and click <strong>Download Report</strong>.</li>
          <li>Choose the downloaded file below. Nothing is saved until you check the matches and click Import.</li>
        </ol>
        <p className="evolt-note">Only people in the dashboard who aren't alumni get scans, and nobody new is created. Members are matched by the email or mobile on their Evolt account, then by first name and last initial. A scan already on file is skipped, so the same report can be imported again safely.</p>

        {error && <div className="success-banner" style={{ background: "#3a1414", color: "var(--danger)", borderColor: "#5a1f1f" }}>{error}</div>}
        {result && (
          <div className="success-banner">
            Imported {result.saved} scan{result.saved === 1 ? "" : "s"} for {result.athletes} athlete{result.athletes === 1 ? "" : "s"}. They're on each athlete's Assessments › Body Composition tab.{" "}
            <button className="btn-link" onClick={reset}>Import another report</button>
          </div>
        )}

        {!members && !result && (
          <div className="file-drop">
            <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} disabled={busy} />
            <span style={{ color: "var(--text-dim)", fontSize: 12 }}>{busy ? `Reading ${fileName}…` : "The Excel file Evolt downloads (.xlsx), or a .csv of it."}</span>
          </div>
        )}

        {members && !result && (
          <div>
            <p className="evolt-summary">
              <strong>{fileName}</strong>: {members.reduce((n, m) => n + m.scans.length, 0)} scans from {members.length} Evolt members.{" "}
              {matched.filter((r) => r.athlete).length} matched to the dashboard{matched.some((r) => r.how === "ambiguous" && !r.athlete) ? `, ${matched.filter((r) => r.how === "ambiguous" && !r.athlete).length} to pick` : ""}.
              {" "}Check the matches (yellow ones especially), change any that are wrong, then import.
            </p>
            <div className="evolt-actions">
              <button className="btn btn-primary" disabled={!scanCount} onClick={doImport}>{scanCount ? `Import ${scanCount} new scan${scanCount === 1 ? "" : "s"} for ${toSave.length} athlete${toSave.length === 1 ? "" : "s"}` : "No new scans to import"}</button>
              <button className="btn btn-secondary" onClick={reset}>Cancel</button>
            </div>
            <table className="evolt-table">
              <thead><tr><th>Evolt member</th><th>Dashboard athlete</th><th>Matched by</th><th>Scans</th><th>New</th></tr></thead>
              <tbody>
                {matched.length ? matched.map(memberRow) : <tr><td colSpan={5} className="evolt-sub">Nobody in this report matched the dashboard. Pick athletes from the list below.</td></tr>}
              </tbody>
            </table>
            {others.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <button className="btn-link" onClick={() => setShowOthers(!showOthers)}>{showOthers ? "Hide" : "Show"} the {others.length} Evolt member{others.length === 1 ? "" : "s"} not in the dashboard</button>
                {showOthers && (
                  <table className="evolt-table" style={{ marginTop: 8 }}>
                    <thead><tr><th>Evolt member</th><th>Dashboard athlete</th><th>Matched by</th><th>Scans</th><th>New</th></tr></thead>
                    <tbody>{others.map(memberRow)}</tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  window.EvoltImporter = EvoltImporter;
  window.EvoltReport = { readReport, parseWhen, matchMember, memberKey, loadSheetLib }; // for checking an import by hand
})();
