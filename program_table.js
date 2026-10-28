// The program builder's Table view (index.html, StandardProgramEditor: the Boxes | Table switch at the top). The
// same program as the Boxes view, drawn like a spreadsheet: one table per day, one row per exercise, with the
// columns Exercise, Sets, Reps, Intensity, Tempo, Rest and Notes. Nothing about the program changes by switching.
//   - Sets, Reps and Intensity are a set line each, like the Boxes view's. An exercise with more than one line
//     (3x5 @ 70%, then 2x3 @ 80%) has a row per line under it; its "+" adds one and ✕ takes one off. Intensity is
//     typed with its unit: 75%, RPE 8, 2 RIR; a bare number keeps the exercise's unit (a percentage if it has none).
//   - The A1, A2, B1… labels are worked out as always (window.exerciseLabels): a row is in the block of the row
//     above when it's linked to it. Clicking a row's label links it to the row above, or unlinks it.
//   - Tab / Shift+Tab, Enter / Shift+Enter and the arrow keys move from cell to cell. Enter on the last row starts
//     a new one. Arriving in a cell selects what's in it, so typing replaces it.
//   - Rows copied from Google Sheets or Excel paste in with Ctrl+V: from the cell pasted into, across and down,
//     adding rows as needed. With a header row (Exercise, Sets, Reps, %, Tempo, Rest, Notes…) the columns are
//     matched by name, and a combined "Sets x Reps" column (5x5 (75%)) is split up. A first column of labels (A1,
//     A2, B1, or 1, 1, 2) sets the supersets; without one, rows between blank rows are supersetted together. A
//     row with sets but no exercise is another line of the exercise above. "Copy for Sheets" copies a day out.
//   - Tempo and Rest are always columns. "+ Column" adds Time, Distance, Speed or a box the coach names to every
//     exercise in a day (or, above the days, every day of the week) at once; its header's ✕ takes it off the day.
//     They're the same extra boxes the Boxes view's "+" adds one exercise at a time.
//   - A week's days sit side by side, the weeks one under another; the builder's size buttons (Fit week…) apply.
//     The ↗ on a day, or beside a block's label, opens "Progress across the weeks" (program_progress.js).
//   - "+ EDT" under a block's first exercise makes the block an EDT, with its minutes in a box of their own (the
//     same setting as the Boxes view's "EDT block"); the block's other rows say they're in it. Accumulate shows
//     under the exercise name and is edited in the Boxes view.
(function () {
  const { useState, useRef, useEffect } = React;
  const LABEL_RE = /^[A-Z]{1,2}\d+\.?$/i, NUM_RE = /^\d+[a-z]?\.?$/i;
  const blankGroup = () => ({ sets: "", reps: "", intensity: "" });
  const groupsOf = (ex) => { const g = window.ProgramRx.normalize(ex).groups; return g && g.length ? g : [blankGroup()]; };
  const ensureGroups = (e) => { if (!Array.isArray(e.groups)) Object.assign(e, window.ProgramRx.normalize(e)); if (!e.groups.length) e.groups = [blankGroup()]; };

  // an intensity as typed → { value, unit: "%" | "RPE" | "RIR" | null (not said) }: 75%, 70-75 %, RPE 8, 8 RPE, 2 RIR
  function parseIntensity(t) {
    let v = `${t || ""}`.trim();
    if (/rpe/i.test(v)) return { value: v.replace(/rpe/i, "").trim(), unit: "RPE" };
    if (/rir/i.test(v)) return { value: v.replace(/rir/i, "").trim(), unit: "RIR" };
    if (/%/.test(v)) return { value: v.replace(/\s*%\s*/g, "").trim(), unit: "%" };
    return { value: v, unit: null };
  }
  const setUnit = (e, unit, hasValue) => {
    if (unit) e.intensityUnit = unit;
    else if (hasValue && !e.intensityUnit) e.intensityUnit = "%"; // a bare number: a percentage
  };

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

  // a combined sets-and-reps cell from a sheet (5x5 (75%), 3x8 @ RPE 8, 3x5 (70%), 2x3 (80%)) → set lines
  function parseRx(text) {
    let unit = null;
    const groups = splitTop(text || "").map((part) => {
      let body = part, int = "";
      const m = /^(.*?)\s*(?:\(([^)]*)\)|@\s*(.+))\s*$/.exec(part);
      if (m && (m[2] != null || m[3] != null)) { body = m[1]; int = (m[2] != null ? m[2] : m[3]).trim(); } else {
        const t = /^(.*?\S)\s+(\d+(?:\.\d+)?(?:\s*-\s*\d+(?:\.\d+)?)?\s*%|RPE\s*[\d.\-]+|[\d.\-]+\s*RPE|RIR\s*[\d.\-]+|[\d.\-]+\s*RIR)$/i.exec(part);
        if (t) { body = t[1]; int = t[2]; }
      }
      const pi = parseIntensity(int);
      if (pi.unit) unit = pi.unit;
      let sets = "", reps = body.trim();
      const sm = /^(\d+)\s*[x×*]\s*(.+)$/i.exec(reps);
      if (sm) { sets = sm[1]; reps = sm[2].trim(); } else {
        const so = /^(\d+)\s*sets?$/i.exec(reps);
        if (so) { sets = so[1]; reps = ""; }
      }
      return { sets, reps, intensity: pi.value };
    });
    return { groups: groups.length ? groups : [blankGroup()], unit };
  }
  const applyRx = (e, text) => {
    const r = parseRx(text);
    e.groups = r.groups;
    setUnit(e, r.unit, r.groups.some((g) => g.intensity));
  };
  const rxText = (ex) => window.ProgramRx.groups(ex).map((g) => window.ProgramRx.groupText(ex, g)).join(", ");
  const intText = (ex, g) => window.ProgramRx.intensityText(ex, g);

  // EDT, on a block's first exercise (the same `edt` setting as the Boxes view's "EDT block"): the block is done
  // back to back for so many minutes and the athlete logs the times through. `edt` is the minutes ("" while being
  // typed), 0 for "not an EDT" (which also overrides an "EDT 10 min" written in the notes the old way).
  const edtOn = (ex) => (ex.edt !== undefined && ex.edt !== 0) || !!window.ProgramRx.edtMinutes(ex);
  const edtValue = (ex) => (ex.edt !== undefined && ex.edt !== 0 ? `${ex.edt}` : `${window.ProgramRx.edtMinutes(ex) || ""}`);
  // setting it here takes an "EDT 10 min" written in the notes the old way out of them, so the two never disagree
  const setEdt = (e, v) => {
    e.edt = v;
    const notes = `${e.notes || ""}`, cleaned = notes.replace(/\bEDT\b\s*[-–—:]?\s*\d+(?:\.\d+)?\s*(?:m|min|mins|minutes)\b\.?/i, "").replace(/\s{2,}/g, " ").replace(/^[\s,;·-]+|[\s,;·-]+$/g, "");
    if (cleaned !== notes.trim()) e.notes = cleaned;
  };
  // what's shown under the exercise name: Accumulate (edited in the Boxes view)
  const moreText = (ex) => {
    const R = window.ProgramRx;
    return ex.accumulate === true || (ex.groups || []).some((g) => R.accumulated(ex, g)) ? "Accumulate" : "";
  };

  // ---- extra columns: the boxes added with the Boxes view's "+" (Time, Distance, Speed, one named by the coach),
  // kept on each exercise as extras [{ label, value }]. A day has a column for each label any of its exercises has.
  const extrasOf = (ex) => (Array.isArray(ex.extras) ? ex.extras : []);
  const extraColsOf = (session) => {
    const seen = new Map();
    session.exercises.forEach((ex) => extrasOf(ex).forEach((x) => { const l = (x.label || "").trim(); if (l && !seen.has(l.toLowerCase())) seen.set(l.toLowerCase(), l); }));
    return [...seen.values()];
  };
  const extraIndex = (ex, label) => extrasOf(ex).findIndex((x) => (x.label || "").trim().toLowerCase() === label.toLowerCase());
  const setExtra = (ex, label, value) => {
    const i = extraIndex(ex, label);
    if (i >= 0) ex.extras[i].value = value;
    else ex.extras = [...extrasOf(ex), { label, value }];
  };
  // every exercise in the day gets the box (empty: a target to fill in, or for the athlete to write their own)
  const addColumn = (session, label) => session.exercises.forEach((ex) => { if (extraIndex(ex, label) < 0) ex.extras = [...extrasOf(ex), { label, value: "" }]; });
  const removeColumn = (session, label) => session.exercises.forEach((ex) => { if (extraIndex(ex, label) >= 0) ex.extras = ex.extras.filter((x) => (x.label || "").trim().toLowerCase() !== label.toLowerCase()); });

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
  // a header that's none of those but names one of the day's extra columns, or Time / Distance / Speed, fills that box
  const headOf = (c, extraLabels) => {
    const t = (c || "").trim(), h = HEADS.find(([re]) => re.test(t));
    if (h) return h[1];
    const x = (extraLabels || []).find((l) => l.toLowerCase() === t.toLowerCase()) || (/^(time|distance|speed)$/i.test(t) ? t[0].toUpperCase() + t.slice(1).toLowerCase() : null);
    return x ? `x:${x}` : null;
  };
  const blockKey = (l) => {
    const s = (l || "").trim().replace(/\.$/, "");
    const a = /^([A-Z]+)\d+$/i.exec(s);
    if (a) return a[1].toUpperCase();
    const n = /^(\d+)[a-z]?$/i.exec(s);
    return n ? n[1] : s;
  };
  const LINE_KEYS = ["sets", "reps", "int", "rpe", "rir"];
  // tab-separated rows → [{ name, rx, sets, reps, int, rpe, rir, tempo, rest, notes, "x:Time"…, linked?, more? }]
  // `cols` is the day's columns in order (extra columns before Notes), `startCol` the one the paste went into
  function parseSheet(text, startCol, cols) {
    const extraLabels = cols.filter((k) => k.startsWith("x:")).map((k) => k.slice(2));
    const rows = text.split("\n").map((r) => r.split("\t").map((c) => c.trim()));
    let map, body = rows;
    const head = rows[0].map((c) => headOf(c, extraLabels));
    if (head.includes("name") && head.filter(Boolean).length >= 2) { map = head; body = rows.slice(1); } else {
      // by position from the cell pasted into; a first column of A1 / B2 or 1 / 1 / 2 is the superset column
      const filled = body.filter((r) => r.some(Boolean));
      const labelCol = startCol === 0 && filled.length > 0 && filled[0].length > 1 && filled.every((r) => !r[0] || LABEL_RE.test(r[0]) || NUM_RE.test(r[0])) && filled.some((r) => r[0]);
      map = labelCol ? ["label", ...cols] : cols.slice(startCol);
    }
    const recs = [];
    let gap = false, gaps = false;
    body.forEach((r) => {
      if (!r.some(Boolean)) { gap = recs.length > 0; return; }
      const rec = {};
      map.forEach((k, i) => { if (k && r[i] !== undefined) rec[k] = r[i]; });
      // sets and reps but no exercise (and no label): another line of the exercise above, as Copy for Sheets writes it
      if (map.includes("name") && !rec.name && !rec.label && recs.length && !gap && LINE_KEYS.some((k) => rec[k])) {
        const prev = recs[recs.length - 1];
        prev.more = [...(prev.more || []), rec];
        return;
      }
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
  // one pasted line's sets, reps and intensity → a set line (a reps cell of "3x5" with no sets is split)
  const lineOf = (rec) => {
    const raw = rec.int || rec.rpe || rec.rir || "";
    const pi = parseIntensity(rec.rpe && raw && !/rpe/i.test(raw) ? `RPE ${raw}` : rec.rir && raw && !/rir/i.test(raw) ? `${raw} RIR` : raw);
    let sets = rec.sets || "", reps = rec.reps || "";
    const sm = !sets && /^(\d+)\s*[x×*]\s*(.+)$/i.exec(reps);
    if (sm) { sets = sm[1]; reps = sm[2].trim(); }
    return { group: { sets, reps, intensity: pi.value }, unit: pi.unit };
  };
  function applyRec(e, rec) {
    if (rec.name !== undefined) e.name = rec.name;
    if (rec.rx !== undefined) applyRx(e, rec.rx);
    else if (LINE_KEYS.some((k) => rec[k] !== undefined)) {
      const lines = [rec, ...(rec.more || [])].map(lineOf);
      const had = groupsOf(e);
      // pasted from the Reps column on: the sets already there are kept, and the same for the other columns
      e.groups = lines.map((l, i) => {
        const was = had[i] || blankGroup(), r = i === 0 ? rec : rec.more[i - 1];
        return { sets: r.sets !== undefined || l.group.sets ? l.group.sets : was.sets || "", reps: r.reps !== undefined ? l.group.reps : was.reps || "", intensity: [r.int, r.rpe, r.rir].some((v) => v !== undefined) ? l.group.intensity : was.intensity || "" };
      });
      const unit = lines.map((l) => l.unit).filter(Boolean).pop() || null;
      setUnit(e, unit, e.groups.some((g) => g.intensity));
    }
    ["tempo", "rest", "notes"].forEach((k) => { if (rec[k] !== undefined) e[k] = rec[k]; });
    Object.keys(rec).filter((k) => k.startsWith("x:")).forEach((k) => setExtra(e, k.slice(2), rec[k]));
    if (rec.linked !== undefined) e.linked = rec.linked;
  }

  // the Intensity cell: typed with its unit (75%, RPE 8, 2 RIR), saved when the cell is left
  function IntCell({ ex, g, cell, onCommit }) {
    const [txt, setTxt] = useState(null); // what's being typed, until the cell is left
    const shown = intText(ex, g);
    const unit = window.ProgramRx.normalize(ex).intensityUnit;
    return (
      <input
        className="pt-cell pt-short"
        value={txt !== null ? txt : shown}
        data-pt={cell}
        placeholder={unit === "RPE" ? "RPE" : unit === "RIR" ? "RIR" : "%"}
        title="Intensity with its unit: 75%, RPE 8, 2 RIR. A number on its own keeps this exercise's unit."
        onChange={(e) => setTxt(e.target.value)}
        onBlur={() => { if (txt !== null && txt.trim() !== shown) onCommit(txt); setTxt(null); }}
      />
    );
  }

  function ProgramTableWeek({ week, wi, edit, newExercise, newSession, maxDays, onNameFocus, onNameBlur, onProgress }) {
    const rootRef = useRef(null);
    const pending = useRef(null); // the cell to move into once a new row is drawn
    const [note, setNote] = useState("");
    useEffect(() => {
      if (!pending.current || !rootRef.current) return;
      const el = rootRef.current.querySelector(`[data-pt="${pending.current}"]`);
      pending.current = null;
      if (el) { el.focus(); if (el.select) el.select(); }
    });
    // a cell's data-pt is "day:exercise.line:column": the set-line cells are on their line (2.0, 2.1…), the
    // exercise's own cells (name, tempo, rest, extra columns x0, x1…, notes) on its first line
    const dayCells = (si) => [...rootRef.current.querySelectorAll(`[data-pt^="${si}:"]`)];
    const go = (el) => { if (!el) return false; el.focus(); if (el.select) el.select(); return true; };
    // a new row has the day's extra columns too, so the athlete gets the same boxes on every exercise
    const freshRow = (session) => ({ ...newExercise(), extras: extraColsOf(session).map((label) => ({ label, value: "" })) });
    const addRow = (si, focus) => {
      const n = week.sessions[si].exercises.length;
      if (focus) pending.current = `${si}:${n}.0:name`;
      edit((d) => { const s = d.weeks[wi].sessions[si]; s.exercises.push(freshRow(s)); });
    };
    // the day's columns in order, as pasted rows fill them
    const colsOf = (session) => ["name", "sets", "reps", "int", "tempo", "rest", ...extraColsOf(session).map((l) => `x:${l}`), "notes"];
    const colKey = (session, col) => { const m = /^x(\d+)$/.exec(col); return m ? `x:${extraColsOf(session)[Number(m[1])]}` : col; };
    // "+ Column": Time, Distance, Speed or a box the coach names, on every exercise of one day (si) or of the week
    const addCol = (si, what) => {
      const label = what === "custom" ? (window.prompt("Name the new column (for example Height, Load, Holds):") || "").trim().slice(0, 20) : what;
      if (!label) return;
      edit((d) => (si == null ? d.weeks[wi].sessions : [d.weeks[wi].sessions[si]]).forEach((s) => addColumn(s, label)));
      setNote(`${label} added to every exercise ${si == null ? "this week" : `in ${week.sessions[si].name || `Day ${si + 1}`}`}. Leave a box empty for the athlete to write in their own.`);
    };
    const dropCol = (si, label) => {
      const s = week.sessions[si];
      const filled = s.exercises.filter((ex) => { const i = extraIndex(ex, label); return i >= 0 && `${ex.extras[i].value || ""}`.trim(); }).length;
      if (filled && !window.confirm(`Remove the ${label} column from ${s.name || `Day ${si + 1}`}? ${filled} exercise${filled === 1 ? " has" : "s have"} something in it. (Ctrl+Z undoes it.)`)) return;
      edit((d) => removeColumn(d.weeks[wi].sessions[si], label));
    };
    const colMenu = (si) => (
      <select className="pt-addcol" value="" title={si == null ? "Add a column to every exercise on every day of this week" : "Add a column to every exercise in this day"} onChange={(e) => addCol(si, e.target.value)}>
        <option value="" disabled hidden>{si == null ? "+ Column on every day" : "+ Column"}</option>
        {["Time", "Distance", "Speed"].map((l) => <option key={l} value={l}>{l}</option>)}
        <option value="custom">Name your own…</option>
      </select>
    );

    const onKey = (e) => {
      const t = e.target, key = t && t.dataset ? t.dataset.pt : null;
      if (!key || e.altKey || e.ctrlKey || e.metaKey) return;
      const [s, row, col] = key.split(":");
      const si = Number(s), ei = Number(row.split(".")[0]), k = e.key;
      const cells = dayCells(si), i = cells.indexOf(t);
      // the same column on the next (or previous) line: a set line, or the next exercise
      const vertical = (step) => { for (let j = i + step; j >= 0 && j < cells.length; j += step) { const p = cells[j].dataset.pt.split(":"); if (p[2] === col && p[1] !== row) return cells[j]; } return null; };
      let done = false;
      if (k === "Tab") {
        done = go(cells[i + (e.shiftKey ? -1 : 1)]); // past the day's first or last cell: the browser's own Tab
      } else if ((k === "Enter" && !e.shiftKey) || (k === "ArrowDown" && col !== "name")) {
        done = go(vertical(1));
        if (!done && k === "Enter") { // past the last row: a new row, as when typing down a sheet (unless this one is empty)
          const last = ei === week.sessions[si].exercises.length - 1;
          if (last && (week.sessions[si].exercises[ei].name || "").trim()) addRow(si, true); else t.blur();
          done = true;
        }
      } else if ((k === "Enter" && e.shiftKey) || (k === "ArrowUp" && col !== "name")) {
        done = go(vertical(-1));
        if (!done && k === "Enter") { t.blur(); done = true; }
      } else if ((k === "ArrowRight" || k === "ArrowLeft") && !e.shiftKey) {
        // across the row once the cursor is at the end (or the start) of what's in the cell
        const len = (t.value || "").length;
        const edge = k === "ArrowRight" ? t.selectionEnd === len : t.selectionStart === 0;
        const to = edge ? cells[i + (k === "ArrowRight" ? 1 : -1)] : null;
        if (to && to.dataset.pt.split(":")[1] === row) done = go(to);
      }
      if (done) { e.preventDefault(); e.stopPropagation(); }
    };

    const onPaste = (e) => {
      const t = e.target, key = t && t.dataset ? t.dataset.pt : null;
      if (!key) return;
      const text = ((e.clipboardData || window.clipboardData).getData("text/plain") || "").replace(/\r\n?/g, "\n").replace(/\n+$/, "");
      if (!/[\t\n]/.test(text)) return; // a single cell: an ordinary paste into the box
      e.preventDefault();
      const [s, row, col] = key.split(":");
      const si = Number(s), ei = Number(row.split(".")[0]);
      const session = week.sessions[si], cols = colsOf(session);
      const recs = parseSheet(text, Math.max(0, cols.indexOf(colKey(session, col))), cols);
      if (!recs.length) return;
      edit((d) => {
        const ds = d.weeks[wi].sessions[si], xs = ds.exercises;
        recs.forEach((rec, i) => {
          if (!xs[ei + i]) xs[ei + i] = freshRow(ds);
          applyRec(xs[ei + i], rec);
        });
      });
      t.blur();
      setNote(`Pasted ${recs.length} row${recs.length === 1 ? "" : "s"} into ${week.sessions[si].name || `Day ${si + 1}`}. Ctrl+Z undoes it.`);
    };

    // a day as tab-separated rows, header included, to paste into Google Sheets or Excel (and back in here);
    // an exercise's second and later set lines go on rows of their own with the exercise left blank
    const copyDay = (si) => {
      const s = week.sessions[si], labels = window.exerciseLabels(s.exercises);
      const clean = (v) => `${v || ""}`.replace(/[\t\r\n]+/g, " ").trim();
      const xcols = extraColsOf(s);
      const lines = [["#", "Exercise", "Sets", "Reps", "Intensity", "Tempo", "Rest", ...xcols, "Notes"].join("\t")];
      let rows = 0;
      s.exercises.forEach((ex, ei) => {
        if (!(ex.name || "").trim() && !rxText(ex)) return;
        rows += 1;
        const xs = xcols.map((l) => { const i = extraIndex(ex, l); return i >= 0 ? ex.extras[i].value : ""; });
        groupsOf(ex).forEach((g, gi) => {
          const line = [g.sets, g.reps, intText(ex, g)];
          lines.push((gi === 0 ? [labels[ei].replace(/\.$/, ""), ex.name, ...line, ex.tempo, ex.rest, ...xs, ex.notes] : ["", "", ...line, "", "", ...xcols.map(() => ""), ""]).map(clean).join("\t"));
        });
      });
      const text = lines.join("\n");
      const ok = () => setNote(`Copied ${s.name || `Day ${si + 1}`} (${rows} exercise${rows === 1 ? "" : "s"}). Paste it into Google Sheets or Excel.`);
      const fallback = () => {
        const ta = document.createElement("textarea");
        ta.value = text; document.body.appendChild(ta); ta.select();
        try { document.execCommand("copy"); ok(); } catch (err) { setNote("Couldn't copy here. Try again."); }
        ta.remove();
      };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, fallback); else fallback();
    };

    return (
      <div className="pt-week" ref={rootRef} onKeyDown={onKey} onPaste={onPaste}>
        <div className="pt-weekbar">
          {colMenu(null)}
          {note && <span className="pt-note">{note}</span>}
        </div>
        {/* the week's days side by side (program-days: the builder's size buttons and Fit week apply) */}
        <div className="program-days pt-days">
        {week.sessions.map((session, si) => {
          const labels = window.exerciseLabels(session.exercises);
          const xcols = extraColsOf(session);
          const ex$ = (d, ei) => d.weeks[wi].sessions[si].exercises[ei];
          const setEx = (ei, k, v) => edit((d) => { ex$(d, ei)[k] = v; });
          const setLine = (ei, gi, k, v) => edit((d) => { const e = ex$(d, ei); ensureGroups(e); e.groups[gi][k] = v; });
          const cell = (ex, ei, k, props) => (
            <input {...props} className={`pt-cell ${(props && props.className) || ""}`} value={ex[k] || ""} data-pt={`${si}:${ei}.0:${k}`} onChange={(e) => setEx(ei, k, e.target.value)} />
          );
          return (
            <div className="pt-day" key={si}>
              <div className="pt-day-head">
                <input className="program-session-name" value={session.name || ""} aria-label="Day name" onChange={(e) => { const v = e.target.value; edit((d) => { d.weeks[wi].sessions[si].name = v; }); }} />
                {onProgress && <button className="btn-link pt-day-progress" title="Progress this day across the weeks: every week's sets, reps and intensity side by side" aria-label="Progress this day across the weeks" onClick={() => onProgress(si, null)}>↗</button>}
                {colMenu(si)}
                <button className="btn btn-small-grey" title="Copies this day's rows, to paste into Google Sheets or Excel" onClick={() => copyDay(si)}>Copy for Sheets</button>
                <button className="btn-link" title="Remove this day" disabled={week.sessions.length === 1} onClick={() => edit((d) => { d.weeks[wi].sessions.splice(si, 1); })}>✕</button>
              </div>
              <textarea className="program-warmup pt-warmup" rows={1} value={session.warmup || ""} placeholder="Warm-up (optional), shown above A1" onChange={(e) => { const v = e.target.value; edit((d) => { d.weeks[wi].sessions[si].warmup = v; }); }} />
              {/* wider than the day when it has many columns: the exercise column keeps at least 160px, and the table scrolls */}
              <div className="pt-scroll">
              <table className="pt-table" style={{ minWidth: 34 + 140 + 50 + 70 + 76 + 26 + 72 * 2 + 86 * xcols.length + 130 + 22 }}>
                <thead>
                  <tr>
                    <th className="pt-lab" /><th>Exercise</th><th className="pt-setsh">Sets</th><th className="pt-repsh">Reps</th><th className="pt-inth">Intensity</th><th className="pt-ln" />
                    <th className="pt-sh">Tempo</th><th className="pt-sh">Rest</th>
                    {xcols.map((l) => (
                      <th className="pt-xcol" key={l}>{l}<button className="btn-link pt-xdrop" title={`Remove the ${l} column from this day`} onClick={() => dropCol(si, l)}>✕</button></th>
                    ))}
                    <th className="pt-noteh">Notes</th><th className="pt-del" />
                  </tr>
                </thead>
                {session.exercises.map((ex, ei) => {
                  const lab = labels[ei].replace(/\.$/, ""), linked = ei > 0 && !!ex.linked, more = moreText(ex);
                  // the block's first exercise, which holds the block's EDT
                  let first = ei;
                  while (first > 0 && session.exercises[first].linked) first -= 1;
                  const blockEdt = linked && edtOn(session.exercises[first]) ? edtValue(session.exercises[first]) : null;
                  const letter = lab.replace(/\d+$/, "");
                  const groups = groupsOf(ex), n = groups.length;
                  // one tbody per exercise: a row per set line, the exercise's own cells spanning them
                  return (
                    <tbody key={ex.id || ei} className={linked ? "pt-linked" : ei > 0 ? "pt-block" : ""}>
                      {groups.map((g, gi) => (
                        <tr key={gi} className={gi > 0 ? "pt-subline" : ""}>
                          {gi === 0 && (
                            <React.Fragment>
                              <td className="pt-lab" rowSpan={n}>
                                {ei > 0 ? (
                                  <button className={`pt-label ${linked ? "on" : ""}`} title={linked ? `${lab}: supersetted with the row above. Click to make it a block of its own.` : `${lab}: click to superset it with the row above`} onClick={() => setEx(ei, "linked", !ex.linked)}>{lab}</button>
                                ) : <span className="pt-label">{lab}</span>}
                                {!linked && onProgress && <button className="pt-progress" tabIndex={-1} title={`Progress the ${letter} series across the weeks`} onClick={() => onProgress(si, letter)}>↗</button>}
                              </td>
                              <td rowSpan={n}>
                                {cell(ex, ei, "name", { className: "pt-name", list: "exercise-library-names", placeholder: "Exercise", onFocus: () => onNameFocus && onNameFocus(wi, si, ei, ex.name), onBlur: () => onNameBlur && onNameBlur(wi, si, ei) })}
                                {!linked && (edtOn(ex) ? (
                                  <div className="pt-edt" title={`EDT: ${letter}1, ${letter}2… done back to back for this many minutes. The athlete gets a countdown and logs how many times through they got.`}>
                                    ⏱ EDT
                                    <input className="pt-cell pt-edt-min" value={edtValue(ex)} data-pt={`${si}:${ei}.0:edt`} aria-label="EDT minutes" placeholder="min" onChange={(e) => { const v = e.target.value.replace(/[^\d.]/g, ""); edit((d) => setEdt(ex$(d, ei), v)); }} />
                                    min
                                    <button className="btn-link pt-edt-off" tabIndex={-1} title="Not an EDT block" onClick={() => edit((d) => setEdt(ex$(d, ei), 0))}>✕</button>
                                  </div>
                                ) : (
                                  <button className="pt-edt-add" tabIndex={-1} title={`Make the ${letter} block an EDT: done back to back for so many minutes, the athlete logs the times through`} onClick={() => { pending.current = `${si}:${ei}.0:edt`; setEx(ei, "edt", ""); }}>+ EDT</button>
                                ))}
                                {blockEdt !== null && <div className="pt-more">in the {letter} EDT{blockEdt ? ` (${blockEdt} min)` : ""}</div>}
                                {more && <div className="pt-more" title="Edited in the Boxes view">{more}</div>}
                              </td>
                            </React.Fragment>
                          )}
                          <td><input className="pt-cell pt-short" value={g.sets || ""} data-pt={`${si}:${ei}.${gi}:sets`} title="Sets (leave blank for one set)" onChange={(e) => setLine(ei, gi, "sets", e.target.value)} /></td>
                          <td><input className="pt-cell pt-short" value={g.reps || ""} data-pt={`${si}:${ei}.${gi}:reps`} title="Reps: 5, 8-10, 4E, 30sec, 3 MIN…" onChange={(e) => setLine(ei, gi, "reps", e.target.value)} /></td>
                          <td>
                            <IntCell ex={ex} g={g} cell={`${si}:${ei}.${gi}:int`} onCommit={(txt) => edit((d) => {
                              const e = ex$(d, ei), pi = parseIntensity(txt);
                              ensureGroups(e);
                              e.groups[gi].intensity = pi.value;
                              setUnit(e, pi.unit, !!pi.value);
                            })} />
                          </td>
                          <td className="pt-ln">
                            {gi > 0 && <button className="btn-link" tabIndex={-1} title="Remove this set line" onClick={() => edit((d) => { const e = ex$(d, ei); ensureGroups(e); e.groups.splice(gi, 1); })}>✕</button>}
                            {gi === n - 1 && <button className="btn-link pt-addline" tabIndex={-1} title="Another line of sets for this exercise (3x5, then 2x3…)" onClick={() => { pending.current = `${si}:${ei}.${n}:sets`; edit((d) => { const e = ex$(d, ei); ensureGroups(e); e.groups.push(blankGroup()); }); }}>+</button>}
                          </td>
                          {gi === 0 && (
                            <React.Fragment>
                              <td rowSpan={n}>{cell(ex, ei, "tempo", { className: "pt-short", maxLength: 6 })}</td>
                              <td rowSpan={n}>{cell(ex, ei, "rest", { className: "pt-short" })}</td>
                              {xcols.map((l, xi) => {
                                const i = extraIndex(ex, l);
                                return (
                                  <td key={l} rowSpan={n}>
                                    <input className="pt-cell pt-short" value={i >= 0 ? ex.extras[i].value || "" : ""} data-pt={`${si}:${ei}.0:x${xi}`} title={`${l}: a target, or leave it empty for the athlete to write in their own`} onChange={(e) => { const v = e.target.value; edit((d) => setExtra(ex$(d, ei), l, v)); }} />
                                  </td>
                                );
                              })}
                              <td rowSpan={n}>{cell(ex, ei, "notes")}</td>
                              <td className="pt-del" rowSpan={n}><button className="btn-link" title="Remove this exercise" tabIndex={-1} onClick={() => edit((d) => { d.weeks[wi].sessions[si].exercises.splice(ei, 1); })}>✕</button></td>
                            </React.Fragment>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  );
                })}
              </table>
              </div>
              <button className="btn btn-small-grey pt-add" onClick={() => addRow(si, true)}>+ Add row</button>
            </div>
          );
        })}
        {week.sessions.length < maxDays && (
          <button className="program-add-day pt-add-day" onClick={() => edit((d) => { if (d.weeks[wi].sessions.length < maxDays) d.weeks[wi].sessions.push(newSession(d.weeks[wi].sessions.length + 1)); })}>+ Add day</button>
        )}
        </div>
      </div>
    );
  }

  window.ProgramTableWeek = ProgramTableWeek;
  window.ProgramTableKit = { parseRx, rxText, parseSheet, applyRec, parseIntensity };
})();
