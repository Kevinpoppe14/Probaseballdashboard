// Bullpens — a pitcher's TrackMan bullpen sessions, under the Pitching tab of their profile. Each session comes in from
// the PDF TrackMan exports ("Pitching practice": stats by pitch type, then every pitch; read by trackman_import.js)
// and is kept in the assessments table as kind: "bullpen", so it needs no table of its own (see getBullpens in
// store.js). The tab shows velocity by pitch type across sessions, and for one session its pitch types, a movement
// plot and every pitch. The Pitching Assessment's own import (pitching_assessment.js) saves here too.
(function () {
  const { useState, useRef } = React;

  const uid = () => `bp-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const fmtDate = (key) => { if (!key) return "No date"; const d = new Date(`${key}T00:00:00`); return isNaN(d) ? key : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); };
  const shortDate = (key) => { const d = new Date(`${key}T00:00:00`); return isNaN(d) ? key : `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`; };
  const nameKey = (s) => String(s || "").toLowerCase().replace(/[^a-z]/g, "");
  const r1 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10);
  const show = (v, unit) => (v == null ? "–" : `${v}${unit || ""}`);
  const ftIn = (v) => { if (v == null) return "–"; const f = Math.floor(v), i = Math.round((v - f) * 12); return i === 12 ? `${f + 1}'` : `${f}'${i ? `${i}"` : ""}`; };

  // the usual order and colors (close to TrackMan's own) for pitch types, anything else after them in gray
  const TYPE_ORDER = ["Fastball", "Four-Seam", "Sinker", "Two-Seam", "Cutter", "Slider", "Sweeper", "Slurve", "Curveball", "Knuckle Curve", "ChangeUp", "Changeup", "Splitter", "Knuckleball"];
  const TYPE_COLORS = { fastball: "#a3122a", "four-seam": "#a3122a", sinker: "#f6863b", "two-seam": "#f6863b", cutter: "#8d5524", slider: "#e6c229", sweeper: "#b38f00", slurve: "#c77dff", curveball: "#3a86ff", "knuckle curve": "#3a86ff", changeup: "#6aa84f", splitter: "#2a9d8f", knuckleball: "#999999" };
  const colorOf = (t) => TYPE_COLORS[String(t || "").toLowerCase()] || "#8a8a8a";
  const typeRank = (t) => { if (t === "Untagged") return 100; const i = TYPE_ORDER.findIndex((x) => x.toLowerCase() === String(t).toLowerCase()); return i === -1 ? 99 : i; };
  // what a pitch can be tagged as (plus whatever the session already uses, and Other… for anything else)
  const TAG_TYPES = ["Fastball", "Sinker", "Cutter", "Slider", "Sweeper", "Slurve", "Curveball", "ChangeUp", "Splitter", "Knuckleball"];
  const byType = (a, b) => typeRank(a) - typeRank(b) || String(a).localeCompare(String(b));
  const FASTBALLS = /fastball|four|sinker|two|seam/i;

  // one session's figures for each pitch type, from its pitches (TrackMan's summary only fills a gap)
  // (pitch types come from the pitches as tagged now, so retagging one moves it; an untagged pitch counts as Untagged)
  const UNTAGGED = "Untagged";
  const typeOfPitch = (p) => p.type || UNTAGGED;
  function typeStats(session) {
    const pitches = session.pitches || [];
    const types = [...new Set(pitches.length ? pitches.map(typeOfPitch) : (session.summary || []).map((r) => r.type).filter(Boolean))].sort(byType);
    return types.map((type) => {
      const ps = pitches.filter((p) => typeOfPitch(p) === type), sum = (session.summary || []).find((r) => r.type === type) || {};
      const vals = (k) => ps.map((p) => p[k]).filter((v) => typeof v === "number");
      const avg = (k) => { const v = vals(k); return v.length ? r1(v.reduce((a, b) => a + b, 0) / v.length) : null; };
      const max = (k) => { const v = vals(k); return v.length ? r1(Math.max(...v)) : null; };
      return {
        type, qty: ps.length || sum.qty || 0,
        speedAvg: avg("speed") ?? sum.speedAvg ?? null, speedMax: max("speed") ?? sum.speedMax ?? null,
        spinAvg: avg("spin") != null ? Math.round(avg("spin")) : sum.spinAvg != null ? Math.round(sum.spinAvg) : null,
        ivb: avg("ivb"), hb: avg("hb") ?? sum.hbAvg ?? null,
        relHeight: avg("relHeight") ?? sum.relHeight ?? null, relSide: avg("relSide") ?? sum.relSide ?? null,
        extension: avg("extension") ?? sum.extension ?? null, spinEff: avg("spinEff") != null ? Math.round(avg("spinEff")) : null,
      };
    });
  }

  // Saves parsed TrackMan reports as bullpen sessions for this athlete. A report already on file (same date, same
  // number of pitches, same first pitch) is skipped; one made out to someone else is only saved once confirmed.
  async function importReports(athlete, files) {
    const store = window.AthleteStore, out = { saved: [], skipped: [], failed: [] };
    for (const file of files) {
      try {
        const r = await window.TrackmanImport.parse(file);
        if (r.athleteName && nameKey(r.athleteName) !== nameKey(athlete.name)) {
          const ok = await window.askConfirm({ title: "Different name on the report", text: `${file.name} is for ${r.athleteName}, not ${athlete.name}. Save it to ${athlete.name}'s bullpens anyway?`, ok: "Save it here" });
          if (!ok) { out.skipped.push(`${file.name} (for ${r.athleteName})`); continue; }
        }
        const first = r.pitches[0] || {};
        const dup = getBullpens(athlete.id).find((b) => b.date === r.date && (b.pitches || []).length === r.pitches.length && ((b.pitches || [])[0] || {}).speed === first.speed);
        if (dup) { out.skipped.push(`${fmtDate(r.date)} (already on file)`); continue; }
        const rec = {
          id: uid(), kind: "bullpen", athleteId: athlete.id, date: r.date, sessionType: r.sessionType, facility: r.facility,
          reportName: r.athleteName, summary: r.summary, pitches: r.pitches, source: "trackman-pdf", fileName: file.name || "",
          importedAt: new Date().toISOString(), importedBy: store.currentUserEmail ? store.currentUserEmail() : "", notes: "",
        };
        store.saveAssessment(rec);
        out.saved.push(rec);
      } catch (e) {
        out.failed.push(`${file.name || "file"}: ${(e && e.message) || e}`);
      }
    }
    return out;
  }
  const getBullpens = (athleteId) => window.AthleteStore.getBullpens(athleteId);
  const resultText = (res) => [
    res.saved.length ? `Imported ${res.saved.length} bullpen${res.saved.length === 1 ? "" : "s"} (${res.saved.map((b) => shortDate(b.date)).join(", ")}).` : "",
    res.skipped.length ? `Skipped ${res.skipped.join(", ")}.` : "",
    res.failed.length ? `Couldn't read ${res.failed.join("; ")}` : "",
  ].filter(Boolean).join(" ");

  // the movement plot: horizontal break across, induced vertical break up, a small dot per pitch and a ringed dot
  // at each pitch type's average
  function MovementChart({ session, stats }) {
    const pts = (session.pitches || []).filter((p) => typeof p.hb === "number" && typeof p.ivb === "number");
    const R = Math.max(25, Math.ceil(Math.max(...pts.map((p) => Math.max(Math.abs(p.hb), Math.abs(p.ivb))), 0) / 5) * 5 + 5);
    const S = 300, P = 26;
    const x = (v) => P + ((v + R) / (2 * R)) * (S - 2 * P), y = (v) => P + ((R - v) / (2 * R)) * (S - 2 * P);
    const ticks = []; for (let t = -R + (R % 10); t <= R; t += 10) ticks.push(t);
    return (
      <svg className="bp-plot" viewBox={`0 0 ${S} ${S}`} role="img" aria-label="Movement: horizontal break by induced vertical break, one dot per pitch">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} y1={y(-R)} x2={x(t)} y2={y(R)} className={t === 0 ? "bp-axis" : "bp-grid"} />
            <line x1={x(-R)} y1={y(t)} x2={x(R)} y2={y(t)} className={t === 0 ? "bp-axis" : "bp-grid"} />
            {t !== 0 && <text x={x(t)} y={y(0) + 11} className="bp-tick" textAnchor="middle">{t}</text>}
            {t !== 0 && <text x={x(0) - 4} y={y(t) + 3} className="bp-tick" textAnchor="end">{t}</text>}
          </g>
        ))}
        <text x={S / 2} y={S - 3} className="bp-axis-label" textAnchor="middle">Horz. break (in)</text>
        <text x={9} y={S / 2} className="bp-axis-label" textAnchor="middle" transform={`rotate(-90 9 ${S / 2})`}>Induced vert. break (in)</text>
        {pts.map((p) => <circle key={p.no} cx={x(p.hb)} cy={y(p.ivb)} r={4} fill={colorOf(p.type)} fillOpacity="0.45" stroke={colorOf(p.type)} strokeWidth="1"><title>#{p.no} {p.type}: {p.ivb} IVB, {p.hb} HB, {p.speed} mph</title></circle>)}
        {stats.filter((s) => s.ivb != null && s.hb != null).map((s) => <circle key={s.type} cx={x(s.hb)} cy={y(s.ivb)} r={7} fill={colorOf(s.type)} stroke="var(--text)" strokeWidth="1.5"><title>{s.type} average: {s.ivb} IVB, {s.hb} HB</title></circle>)}
      </svg>
    );
  }

  function SessionDetail({ session, onSave }) {
    const stats = typeStats(session);
    const [notes, setNotes] = useState(session.notes || "");
    const timer = useRef(null);
    const latest = useRef(session);
    latest.current = session;
    const total = (session.pitches || []).length || stats.reduce((n, s) => n + s.qty, 0);
    const changeNotes = (v) => { setNotes(v); clearTimeout(timer.current); timer.current = setTimeout(() => onSave({ ...latest.current, notes: v }), 500); };
    // tagging pitches after the fact: one at a time from its row, or every checked row at once
    const untagged = (session.pitches || []).filter((p) => !p.type).length;
    const [showAll, setShowAll] = useState(untagged > 0);
    const [checked, setChecked] = useState([]);
    const tagOptions = [...new Set([...TAG_TYPES, ...(session.pitches || []).map((p) => p.type).filter(Boolean)])].sort(byType);
    const retag = async (nos, value) => {
      let type = value;
      if (value === "__other") {
        type = await window.askText({ title: "Tag as", text: "The pitch type's name, e.g. Gyro Slider.", placeholder: "Pitch type", ok: "Tag", maxLength: 30 });
        if (!type) return;
      }
      onSave({ ...latest.current, notes, pitches: (latest.current.pitches || []).map((p) => (nos.includes(p.no) ? { ...p, type, typeGuessed: false, retagged: true } : p)) });
      setChecked([]);
    };
    const toggle = (no) => setChecked((c) => (c.includes(no) ? c.filter((x) => x !== no) : [...c, no]));
    const tagSelect = (value, onPick, label) => (
      <select className="bp-tag" value={value} aria-label={label} onChange={(e) => onPick(e.target.value)}>
        <option value="">Untagged</option>
        {tagOptions.map((t) => <option key={t} value={t}>{t}</option>)}
        <option value="__other">Other…</option>
      </select>
    );
    return (
      <div className="panel bp-session">
        <h2>{fmtDate(session.date)} <small>{[session.sessionType, session.facility, `${total} pitches`].filter(Boolean).join(" · ")}</small></h2>
        <div className="bp-counts">
          {stats.map((s) => <span key={s.type} className="bp-count"><span className="bp-dot" style={{ background: colorOf(s.type) }} />{s.type} <b>{s.qty}</b></span>)}
        </div>
        <div className="bp-top">
          <div className="bp-table-wrap">
            <table className="assess-table bp-table">
              <thead><tr><th>Pitch type</th><th>Qty</th><th>Velo avg</th><th>Velo max</th><th>Spin</th><th>IVB</th><th>HB</th><th>Rel. ht</th><th>Rel. side</th><th>Ext.</th><th>Spin eff.</th></tr></thead>
              <tbody>
                {stats.map((s) => (
                  <tr key={s.type}>
                    <td><span className="bp-dot" style={{ background: colorOf(s.type) }} />{s.type}</td>
                    <td>{s.qty}</td><td>{show(s.speedAvg)}</td><td>{show(s.speedMax)}</td><td>{show(s.spinAvg)}</td>
                    <td>{show(s.ivb)}</td><td>{show(s.hb)}</td><td>{ftIn(s.relHeight)}</td><td>{ftIn(s.relSide)}</td><td>{ftIn(s.extension)}</td><td>{show(s.spinEff, s.spinEff != null ? "%" : "")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="timestamp-note">Velocity in mph, spin in rpm, break in inches. IVB, HB and spin efficiency are averaged from the pitches; a pitch TrackMan left blank is left out.</p>
          </div>
          <MovementChart session={session} stats={stats} />
        </div>
        {untagged > 0 && <p className="bp-untagged">{untagged} pitch{untagged === 1 ? " isn't" : "es aren't"} tagged. Pick a type for each under Every pitch, or check several and tag them at once.</p>}
        <details className="bp-pitches" open={showAll} onToggle={(e) => setShowAll(e.currentTarget.open)}>
          <summary>Every pitch ({total}){untagged > 0 ? ` · ${untagged} untagged` : ""}</summary>
          <div className="bp-bulk">
            {checked.length > 0
              ? <React.Fragment><span>Tag the {checked.length} checked as</span>{tagSelect("", (v) => retag(checked, v), "Tag the checked pitches as")}<button type="button" className="btn btn-secondary" onClick={() => setChecked([])}>Clear</button></React.Fragment>
              : <span className="timestamp-note">Change a pitch's type from its row, or check several to tag them together.</span>}
          </div>
          <div className="bp-table-wrap">
            <table className="assess-table bp-table">
              <thead><tr><th aria-label="Check"></th><th>#</th><th>Type</th><th>Velo</th><th>Spin</th><th>Tilt</th><th>IVB</th><th>HB</th><th>Ext.</th><th>Rel. ht</th><th>Rel. side</th><th>Spin eff.</th></tr></thead>
              <tbody>
                {(session.pitches || []).map((p) => (
                  <tr key={p.no} className={p.type ? "" : "bp-untagged-row"}>
                    <td><input type="checkbox" checked={checked.includes(p.no)} onChange={() => toggle(p.no)} aria-label={`Check pitch ${p.no}`} /></td>
                    <td>{p.no}</td>
                    <td className="bp-type-cell"><span className="bp-dot" style={{ background: p.type ? colorOf(p.type) : "transparent" }} />{tagSelect(p.type || "", (v) => retag([p.no], v), `Pitch ${p.no} type`)}</td>
                    <td>{show(p.speed)}</td><td>{show(p.spin)}</td><td>{show(p.tilt)}</td><td>{show(p.ivb)}</td><td>{show(p.hb)}</td>
                    <td>{ftIn(p.extension)}</td><td>{ftIn(p.relHeight)}</td><td>{ftIn(p.relSide)}</td><td>{show(p.spinEff, p.spinEff != null ? "%" : "")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
        <div className="field bp-notes"><label>Notes</label><textarea rows={3} value={notes} placeholder="What you worked on, how it felt…" onChange={(e) => changeNotes(e.target.value)} /></div>
        <p className="timestamp-note">Imported from {session.fileName || "a TrackMan report"}{session.importedAt ? ` on ${shortDate(session.importedAt.slice(0, 10))}` : ""}{session.importedBy ? ` by ${session.importedBy}` : ""}.</p>
      </div>
    );
  }

  // velocity by pitch type across the sessions: average (and max) for each, newest on the right
  function VeloTrend({ sessions }) {
    const last = sessions.slice(-8);
    const per = last.map((s) => ({ s, stats: typeStats(s) }));
    const types = [...new Set(per.flatMap((x) => x.stats.map((t) => t.type)))].sort(byType);
    if (last.length < 2) return null;
    return (
      <div className="panel">
        <h2>Velocity by session <small>average / max mph, last {last.length}</small></h2>
        <div className="bp-table-wrap">
          <table className="assess-table bp-table bp-trend">
            <thead><tr><th>Pitch type</th>{per.map((x) => <th key={x.s.id}>{shortDate(x.s.date)}</th>)}</tr></thead>
            <tbody>
              {types.map((t) => (
                <tr key={t}>
                  <td><span className="bp-dot" style={{ background: colorOf(t) }} />{t}</td>
                  {per.map((x) => { const st = x.stats.find((q) => q.type === t); return <td key={x.s.id}>{st && st.speedAvg != null ? <span>{st.speedAvg}<small> / {show(st.speedMax)}</small></span> : "–"}</td>; })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  function BullpensTab({ athlete }) {
    const store = window.AthleteStore;
    const [list, setList] = useState(() => getBullpens(athlete.id));
    const [selectedId, setSelectedId] = useState(() => { const l = getBullpens(athlete.id); return l.length ? l[l.length - 1].id : null; });
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState("");
    const fileRef = useRef(null);
    const refresh = () => { const l = getBullpens(athlete.id); setList(l); return l; };
    const selected = list.find((b) => b.id === selectedId) || null;
    const pick = async (e) => {
      const files = [...(e.target.files || [])];
      e.target.value = "";
      if (!files.length) return;
      setBusy(true); setMsg("Reading…");
      const res = await importReports(athlete, files);
      const l = refresh();
      if (res.saved.length) setSelectedId(res.saved[res.saved.length - 1].id);
      else if (!l.some((b) => b.id === selectedId) && l.length) setSelectedId(l[l.length - 1].id);
      setMsg(resultText(res) || "Nothing imported.");
      setBusy(false);
    };
    const remove = async (b) => {
      const ok = await window.askConfirm({ title: `Delete the ${fmtDate(b.date)} bullpen?`, text: "Its pitches and notes are deleted. You can import the PDF again to get it back.", ok: "Delete", danger: true });
      if (!ok) return;
      store.deleteAssessment(b.id);
      const l = refresh();
      if (selectedId === b.id) setSelectedId(l.length ? l[l.length - 1].id : null);
    };
    const save = (rec) => { store.saveAssessment(rec); refresh(); };
    return (
      <div className="bp-wrap">
        <div className="panel no-print">
          <h2>Bullpens <small>TrackMan pitching sessions</small></h2>
          <div className="assess-history">
            {!list.length && <span className="assess-row-note">No bullpens yet. Import a TrackMan report (the PDF from a Pitching practice session) to add one.</span>}
            {[...list].reverse().map((b) => (
              <span key={b.id} className={`assess-history-item${b.id === selectedId ? " active" : ""}`}>
                <button type="button" className="assess-history-btn" onClick={() => setSelectedId(b.id)} title="Open this session">{fmtDate(b.date)} · {(b.pitches || []).length} pitches</button>
                <button type="button" className="assess-history-delete" onClick={() => remove(b)} title="Delete this session">&times;</button>
              </span>
            ))}
          </div>
          <div className="assess-toolbar">
            <button className="btn btn-primary" disabled={busy} onClick={() => fileRef.current && fileRef.current.click()}>{busy ? "Importing…" : "Import TrackMan PDF"}</button>
            <input ref={fileRef} type="file" accept="application/pdf,.pdf" multiple hidden onChange={pick} />
            {msg && <span className="assess-row-note" role="status">{msg}</span>}
          </div>
          <p className="timestamp-note">Choose one or more TrackMan "Pitching practice" PDFs. Each one becomes a session here, with every pitch and its type.</p>
        </div>
        <VeloTrend sessions={list} />
        {selected && <SessionDetail key={selected.id} session={selected} onSave={save} />}
      </div>
    );
  }

  window.BullpensTab = BullpensTab;
  window.BullpenKit = { importReports, typeStats, resultText, FASTBALLS };
})();
