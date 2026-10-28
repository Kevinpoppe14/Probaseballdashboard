// The program builder's Table view (index.html, StandardProgramEditor: the Boxes | Table switch at the top). The
// same program as the Boxes view, drawn like a spreadsheet: one table per day, one row per exercise, with the
// columns Exercise, Sets × Reps, Tempo, Rest and Notes. Nothing about the program changes by switching views.
//   - Sets × Reps is one cell, typed the way a sheet would have it: 5x5 (75%), 4x4E, 3x30sec, 3x8 @ RPE 8, or
//     more than one scheme with commas: 3x5 (70%), 2x3 (80%). It's turned into the program's set lines when the
//     cell is left.
//   - The A1, A2, B1… labels are worked out as always (window.exerciseLabels): a row is in the block of the row
//     above when it's linked to it. Clicking a row's label links it to the row above, or unlinks it.
//   - Tab / Shift+Tab, Enter / Shift+Enter and the arrow keys move from cell to cell. Enter on the last row starts
//     a new one. Arriving in a cell selects what's in it, so typing replaces it.
//   - Rows copied from Google Sheets or Excel paste in with Ctrl+V: from the cell pasted into, across and down,
//     adding rows as needed. With a header row (Exercise, Sets, Reps, %, Tempo, Rest, Notes…) the columns are
//     matched by name. A first column of labels (A1, A2, B1, or 1, 1, 2) sets the supersets; without one, rows
//     between blank rows are supersetted together. "Copy for Sheets" copies a day the other way.
//   - Time, Distance and other added boxes, EDT and Accumulate show under the Sets × Reps cell; they're edited in
//     the Boxes view.
(function () {
  const { useState, useRef, useEffect } = React;
  const COLS = ["name", "rx", "tempo", "rest", "notes"];
  const LABEL_RE = /^[A-Z]{1,2}\d+\.?$/i, NUM_RE = /^\d+[a-z]?\.?$/i;

  // "3x5 (70, 75%), 2x3" → ["3x5 (70, 75%)", "2x3"]: split at commas, semicolons or two spaces outside brackets
  function splitTop(text) {
    const out = [];
    let depth = 0, cur = "";
    for (let i = 0; i < text.length; i += 1) {
      const c = text[i];
      if (c === "(" || c === "[") depth += 1;
      if ((c === ")" || c === "]") && depth > 0) depth -= 1;
      if (depth === 0 && (c === "," || c === ";" || (c === " " && text[i + 1] === " "))) { out.push(cur); cur = ""; continue; }
      cur += c;
    }
    out.push(cur);
    return out.map((s) => s.trim()).filter(Boolean);
  }

  // the Sets × Reps cell → { groups: [{ sets, reps, intensity }], unit: "%" | "RPE" | "RIR" | null (not said) }
  function parseRx(text) {
    let unit = null;
    const groups = splitTop(text || "").map((part) => {
      let body = part, int = "";
      const m = /^(.*?)\s*(?:\(([^)]*)\)|@\s*(.+))\s*$/.exec(part);
      if (m && (m[2] != null || m[3] != null)) { body = m[1]; int = (m[2] != null ? m[2] : m[3]).trim(); } else {
        const t = /^(.*?\S)\s+(\d+(?:\.\d+)?(?:\s*-\s*\d+(?:\.\d+)?)?\s*%|RPE\s*[\d.\-]+|[\d.\-]+\s*RPE|RIR\s*[\d.\-]+|[\d.\-]+\s*RIR)$/i.exec(part);
        if (t) { body = t[1]; int = t[2]; }
      }
      if (int) {
        if (/rpe/i.test(int)) { unit = "RPE"; int = int.replace(/rpe/i, "").trim(); }
        else if (/rir/i.test(int)) { unit = "RIR"; int = int.replace(/rir/i, "").trim(); }
        else if (/%/.test(int)) { unit = "%"; int = int.replace(/\s*%\s*/g, "").trim(); }
      }
      let sets = "", reps = body.trim();
      const sm = /^(\d+)\s*[x×*]\s*(.+)$/i.exec(reps);
      if (sm) { sets = sm[1]; reps = sm[2].trim(); } else {
        const so = /^(\d+)\s*sets?$/i.exec(reps);
        if (so) { sets = so[1]; reps = ""; }
      }
      return { sets, reps, intensity: int };
    });
    return { groups: groups.length ? groups : [{ sets: "", reps: "", intensity: "" }], unit };
  }
  const applyRx = (e, text) => {
    const r = parseRx(text);
    e.groups = r.groups;
    if (r.unit) e.intensityUnit = r.unit;
    else if (r.groups.some((g) => g.intensity) && !e.intensityUnit) e.intensityUnit = "%"; // a bare number: a percentage
  };
  const rxText = (ex) => window.ProgramRx.groups(ex).map((g) => window.ProgramRx.groupText(ex, g)).join(", ");

  // what's shown under the Sets × Reps cell: the extra boxes, EDT and Accumulate (edited in the Boxes view)
  const moreText = (ex, blockFirst) => {
    const R = window.ProgramRx;
    const edt = blockFirst ? (ex.edt !== undefined && ex.edt !== 0 && `${ex.edt}` !== "" ? Number(ex.edt) : R.edtMinutes(ex)) : 0;
    const acc = ex.accumulate === true || (ex.groups || []).some((g) => R.accumulated(ex, g));
    return [R.extrasText(ex), edt ? `EDT ${edt} min` : "", acc ? "Accumulate" : ""].filter(Boolean).join(" · ");
  };

  // ---- pasting rows from a sheet ----------------------------------------------------------------------------
  const HEADS = [
    [/^(#|no\.?|order|label|ss|superset|block|group)$/i, "label"],
    [/^(exercises?|movements?|names?|lifts?|exercise name)$/i, "name"],
    [/^(sets?\s*[x×]\s*reps?|sets?\s*\/\s*reps?|scheme|prescription|custom|rx|volume|dosage)$/i, "rx"],
    [/^sets?$/i, "sets"],
    [/^reps?$/i, "reps"],
    [/^(%|%\s*1rm|intensity|load|percent(age)?|%\s*max)$/i, "int"],
    [/^rpe$/i, "rpe"],
    [/^rir$/i, "rir"],
    [/^tempo$/i, "tempo"],
    [/^rest(\s*\(.*\))?$/i, "rest"],
    [/^(notes?|cues?|comments?|coaching cues|coaching notes)$/i, "notes"],
  ];
  const headOf = (c) => { const h = HEADS.find(([re]) => re.test((c || "").trim())); return h ? h[1] : null; };
  const blockKey = (l) => {
    const s = (l || "").trim().replace(/\.$/, "");
    const a = /^([A-Z]+)\d+$/i.exec(s);
    if (a) return a[1].toUpperCase();
    const n = /^(\d+)[a-z]?$/i.exec(s);
    return n ? n[1] : s;
  };
  // tab-separated rows → [{ name, rx, sets, reps, int, rpe, rir, tempo, rest, notes, linked? }]
  function parseSheet(text, startCol) {
    const rows = text.split("\n").map((r) => r.split("\t").map((c) => c.trim()));
    let map, body = rows;
    const head = rows[0].map(headOf);
    if (head.includes("name") && head.filter(Boolean).length >= 2) { map = head; body = rows.slice(1); } else {
      // by position from the cell pasted into; a first column of A1 / B2 or 1 / 1 / 2 is the superset column
      const filled = body.filter((r) => r.some(Boolean));
      const labelCol = startCol === 0 && filled.length > 0 && filled[0].length > 1 && filled.every((r) => LABEL_RE.test(r[0]) || NUM_RE.test(r[0]));
      map = labelCol ? ["label", ...COLS] : COLS.slice(startCol);
    }
    const recs = [];
    let gap = false, gaps = false;
    body.forEach((r) => {
      if (!r.some(Boolean)) { gap = recs.length > 0; return; }
      const rec = {};
      map.forEach((k, i) => { if (k && r[i] !== undefined) rec[k] = r[i]; });
      if (gap) { rec.afterGap = true; gaps = true; }
      gap = false;
      recs.push(rec);
    });
    const labelled = map.includes("label");
    recs.forEach((rec, i) => {
      if (labelled) rec.linked = i > 0 && !!rec.label && blockKey(rec.label) === blockKey(recs[i - 1].label);
      else if (gaps) rec.linked = i > 0 && !rec.afterGap;
    });
    return recs;
  }
  function applyRec(e, rec) {
    if (rec.name !== undefined) e.name = rec.name;
    if (rec.rx !== undefined) applyRx(e, rec.rx);
    else if (["sets", "reps", "int", "rpe", "rir"].some((k) => rec[k] !== undefined)) {
      const raw = rec.int || rec.rpe || rec.rir || "";
      const int = !raw ? "" : rec.rpe && !/rpe/i.test(raw) ? `RPE ${raw}` : rec.rir && !/rir/i.test(raw) ? `${raw} RIR` : raw;
      const reps = rec.reps || "";
      applyRx(e, /[x×]/i.test(reps) && !rec.sets ? `${reps}${int ? ` (${int})` : ""}` : `${rec.sets ? `${rec.sets}x` : ""}${reps}${int ? ` (${int})` : ""}`);
    }
    ["tempo", "rest", "notes"].forEach((k) => { if (rec[k] !== undefined) e[k] = rec[k]; });
    if (rec.linked !== undefined) e.linked = rec.linked;
  }

  // the Sets × Reps cell: typed freely, turned into set lines when it's left
  function RxCell({ ex, cell, onCommit }) {
    const [txt, setTxt] = useState(null); // what's being typed, until the cell is left
    const shown = rxText(ex);
    return (
      <input
        className="pt-cell pt-rx"
        value={txt !== null ? txt : shown}
        data-pt={cell}
        placeholder="3x8 (70%)"
        title="Sets x reps, then the intensity: 5x5 (75%), 4x4E, 3x30sec, 3x8 @ RPE 8. More than one with commas: 3x5 (70%), 2x3 (80%)"
        onChange={(e) => setTxt(e.target.value)}
        onBlur={() => { if (txt !== null && txt.trim() !== shown) onCommit(txt); setTxt(null); }}
      />
    );
  }

  function ProgramTableWeek({ week, wi, edit, newExercise, newSession, maxDays, onNameFocus, onNameBlur }) {
    const rootRef = useRef(null);
    const pending = useRef(null); // the cell to move into once a new row is drawn
    const [note, setNote] = useState("");
    useEffect(() => {
      if (!pending.current || !rootRef.current) return;
      const el = rootRef.current.querySelector(`[data-pt="${pending.current}"]`);
      pending.current = null;
      if (el) { el.focus(); if (el.select) el.select(); }
    });
    const dayCells = (si) => [...rootRef.current.querySelectorAll(`[data-pt^="${si}:"]`)];
    const go = (el) => { if (!el) return false; el.focus(); if (el.select) el.select(); return true; };
    const at = (si, ei, col) => rootRef.current.querySelector(`[data-pt="${si}:${ei}:${col}"]`);
    const addRow = (si, focus) => {
      const n = week.sessions[si].exercises.length;
      if (focus) pending.current = `${si}:${n}:name`;
      edit((d) => { d.weeks[wi].sessions[si].exercises.push(newExercise()); });
    };

    const onKey = (e) => {
      const t = e.target, key = t && t.dataset ? t.dataset.pt : null;
      if (!key || e.altKey || e.ctrlKey || e.metaKey) return;
      const [s, r, col] = key.split(":");
      const si = Number(s), ei = Number(r), rows = week.sessions[si].exercises.length, k = e.key;
      let done = false;
      if (k === "Tab") {
        const cells = dayCells(si);
        done = go(cells[cells.indexOf(t) + (e.shiftKey ? -1 : 1)]); // past the day's first or last cell: the browser's own Tab
      } else if ((k === "Enter" && !e.shiftKey) || (k === "ArrowDown" && col !== "name")) {
        if (ei < rows - 1) done = go(at(si, ei + 1, col));
        else if (k === "Enter") { // past the last row: a new row, as when typing down a sheet (unless this one is empty)
          if ((week.sessions[si].exercises[ei].name || "").trim()) addRow(si, true); else t.blur();
          done = true;
        }
      } else if ((k === "Enter" && e.shiftKey) || (k === "ArrowUp" && col !== "name")) {
        if (ei > 0) done = go(at(si, ei - 1, col));
        else if (k === "Enter") { t.blur(); done = true; }
      } else if ((k === "ArrowRight" || k === "ArrowLeft") && !e.shiftKey) {
        // across the row once the cursor is at the end (or the start) of what's in the cell
        const len = (t.value || "").length;
        const edge = k === "ArrowRight" ? t.selectionEnd === len : t.selectionStart === 0;
        if (edge) {
          const cells = dayCells(si), to = cells[cells.indexOf(t) + (k === "ArrowRight" ? 1 : -1)];
          if (to && to.dataset.pt.split(":")[1] === r) done = go(to);
        }
      }
      if (done) { e.preventDefault(); e.stopPropagation(); }
    };

    const onPaste = (e) => {
      const t = e.target, key = t && t.dataset ? t.dataset.pt : null;
      if (!key) return;
      const text = ((e.clipboardData || window.clipboardData).getData("text/plain") || "").replace(/\r\n?/g, "\n").replace(/\n+$/, "");
      if (!/[\t\n]/.test(text)) return; // a single cell: an ordinary paste into the box
      e.preventDefault();
      const [s, r, col] = key.split(":");
      const si = Number(s), ei = Number(r);
      const recs = parseSheet(text, Math.max(0, COLS.indexOf(col)));
      if (!recs.length) return;
      edit((d) => {
        const xs = d.weeks[wi].sessions[si].exercises;
        recs.forEach((rec, i) => {
          if (!xs[ei + i]) xs[ei + i] = newExercise();
          applyRec(xs[ei + i], rec);
        });
      });
      t.blur();
      setNote(`Pasted ${recs.length} row${recs.length === 1 ? "" : "s"} into ${week.sessions[si].name || `Day ${si + 1}`}. Ctrl+Z undoes it.`);
    };

    // a day as tab-separated rows, header included, to paste into Google Sheets or Excel (and back in here)
    const copyDay = (si) => {
      const s = week.sessions[si], labels = window.exerciseLabels(s.exercises);
      const clean = (v) => `${v || ""}`.replace(/[\t\r\n]+/g, " ").trim();
      const lines = [["#", "Exercise", "Sets x Reps", "Tempo", "Rest", "Notes"].join("\t")];
      s.exercises.forEach((ex, ei) => { if ((ex.name || "").trim() || rxText(ex)) lines.push([labels[ei].replace(/\.$/, ""), ex.name, rxText(ex), ex.tempo, ex.rest, ex.notes].map(clean).join("\t")); });
      const text = lines.join("\n");
      const ok = () => setNote(`Copied ${s.name || `Day ${si + 1}`} (${lines.length - 1} row${lines.length === 2 ? "" : "s"}). Paste it into Google Sheets or Excel.`);
      const fallback = () => {
        const ta = document.createElement("textarea");
        ta.value = text; document.body.appendChild(ta); ta.select();
        try { document.execCommand("copy"); ok(); } catch (err) { setNote("Couldn't copy here. Try again."); }
        ta.remove();
      };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, fallback); else fallback();
    };

    return (
      <div className="pt-days" ref={rootRef} onKeyDown={onKey} onPaste={onPaste}>
        {note && <div className="pt-note">{note}</div>}
        {week.sessions.map((session, si) => {
          const labels = window.exerciseLabels(session.exercises);
          const setEx = (ei, k, v) => edit((d) => { d.weeks[wi].sessions[si].exercises[ei][k] = v; });
          const cell = (ex, ei, k, props) => (
            <input {...props} className={`pt-cell ${(props && props.className) || ""}`} value={ex[k] || ""} data-pt={`${si}:${ei}:${k}`} onChange={(e) => setEx(ei, k, e.target.value)} />
          );
          return (
            <div className="pt-day" key={si}>
              <div className="pt-day-head">
                <input className="program-session-name" value={session.name || ""} aria-label="Day name" onChange={(e) => { const v = e.target.value; edit((d) => { d.weeks[wi].sessions[si].name = v; }); }} />
                <button className="btn btn-small-grey" title="Copies this day's rows, to paste into Google Sheets or Excel" onClick={() => copyDay(si)}>Copy for Sheets</button>
                <button className="btn-link" title="Remove this day" disabled={week.sessions.length === 1} onClick={() => edit((d) => { d.weeks[wi].sessions.splice(si, 1); })}>✕</button>
              </div>
              <textarea className="program-warmup pt-warmup" rows={1} value={session.warmup || ""} placeholder="Warm-up (optional), shown above A1" onChange={(e) => { const v = e.target.value; edit((d) => { d.weeks[wi].sessions[si].warmup = v; }); }} />
              <table className="pt-table">
                <thead>
                  <tr><th className="pt-lab" /><th>Exercise</th><th>Sets × Reps</th><th>Tempo</th><th>Rest</th><th>Notes</th><th className="pt-del" /></tr>
                </thead>
                <tbody>
                  {session.exercises.map((ex, ei) => {
                    const lab = labels[ei].replace(/\.$/, ""), linked = ei > 0 && !!ex.linked, more = moreText(ex, !linked);
                    return (
                      <tr key={ex.id || ei} className={linked ? "pt-linked" : ei > 0 ? "pt-block" : ""}>
                        <td className="pt-lab">
                          {ei > 0 ? (
                            <button className={`pt-label ${linked ? "on" : ""}`} title={linked ? `${lab}: supersetted with the row above. Click to make it a block of its own.` : `${lab}: click to superset it with the row above`} onClick={() => setEx(ei, "linked", !ex.linked)}>{lab}</button>
                          ) : <span className="pt-label">{lab}</span>}
                        </td>
                        <td>
                          {cell(ex, ei, "name", { className: "pt-name", list: "exercise-library-names", placeholder: "Exercise", onFocus: () => onNameFocus && onNameFocus(wi, si, ei, ex.name), onBlur: () => onNameBlur && onNameBlur(wi, si, ei) })}
                        </td>
                        <td>
                          <RxCell ex={ex} cell={`${si}:${ei}:rx`} onCommit={(txt) => edit((d) => applyRx(d.weeks[wi].sessions[si].exercises[ei], txt))} />
                          {more && <div className="pt-more" title="Edited in the Boxes view">{more}</div>}
                        </td>
                        <td>{cell(ex, ei, "tempo", { className: "pt-short", maxLength: 6, placeholder: "" })}</td>
                        <td>{cell(ex, ei, "rest", { className: "pt-short", placeholder: "" })}</td>
                        <td>{cell(ex, ei, "notes", { placeholder: "" })}</td>
                        <td className="pt-del"><button className="btn-link" title="Remove this row" tabIndex={-1} onClick={() => edit((d) => { d.weeks[wi].sessions[si].exercises.splice(ei, 1); })}>✕</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <button className="btn btn-small-grey pt-add" onClick={() => addRow(si, true)}>+ Add row</button>
            </div>
          );
        })}
        {week.sessions.length < maxDays && (
          <button className="program-add-day pt-add-day" onClick={() => edit((d) => { if (d.weeks[wi].sessions.length < maxDays) d.weeks[wi].sessions.push(newSession(d.weeks[wi].sessions.length + 1)); })}>+ Add day</button>
        )}
      </div>
    );
  }

  window.ProgramTableWeek = ProgramTableWeek;
  window.ProgramTableKit = { parseRx, rxText, parseSheet, applyRec };
})();
