// The program builder's Table view (index.html, StandardProgramEditor: the Boxes | Table switch at the top). The
// same program as the Boxes view, drawn like a spreadsheet: one table per day, one row per exercise, with the
// columns Exercise, Sets, Reps, Intensity, Tempo, Rest and Notes. Nothing about the program changes by switching.
//   - Sets, Reps and Intensity are a set line each, like the Boxes view's. An exercise with more than one line
//     (3x5 @ 70%, then 2x3 @ 80%) has a row per line under it; the "+" in the Sets cell adds one and ✕ takes one off. Intensity is
//     typed with its unit: 75%, RPE 8, 2 RIR; a bare number keeps the exercise's unit (a percentage if it has none).
//   - The A1, A2, B1… labels are worked out as always (window.exerciseLabels): a row is in the block of the row
//     above when it's linked to it. Clicking a row's label links it to the row above, or unlinks it.
//   - Tab / Shift+Tab, Enter / Shift+Enter and the arrow keys move from cell to cell. Enter on the last row starts
//     a new one. Arriving in a cell selects what's in it, so typing replaces it.
//   - Rows copied from Google Sheets or Excel paste in with Ctrl+V: from the cell pasted into, across and down,
//     adding rows as needed. With a header row (Exercise, Sets, Reps, %, Tempo, Rest, Notes…) the columns are
//     matched by name, and a combined "Sets x Reps" column (5x5 (75%)) is split up. A first column of labels (A1,
//     A2, B1, or 1, 1, 2) sets the supersets; without one, rows between blank rows are supersetted together. A
//     row with sets but no exercise is another line of the exercise above.
//   - Dragging across cells (or Shift+click) highlights a block, as in a sheet: Ctrl+C copies it to paste into a
//     sheet or another day, Ctrl+V pastes at its top-left cell, Ctrl+X cuts and Delete clears it.
//   - A day starts with just Sets, Reps and Intensity. Tempo, Rest and Notes are columns where the day uses them,
//     or once "+ Column" adds them. The exercise name and notes wrap onto more lines rather than being cut off.
//   - "+ Column" also adds Time, Distance, Speed or a box the coach names to every
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
  // a block's color, by its letter (A, B, C…), the same in every day
  const BLOCK_COLORS = ["#ef4444", "#3b82f6", "#22c55e", "#f59e0b", "#a855f7", "#14b8a6", "#ec4899", "#84cc16"];
  const letterIndex = (l) => [...`${l || "A"}`.toUpperCase()].reduce((n, c) => n * 26 + (c.charCodeAt(0) - 64), 0) - 1;
  const blankGroup = () => ({ sets: "", reps: "", intensity: "" });
  const groupsOf = (ex) => { const g = window.ProgramRx.normalize(ex).groups; return g && g.length ? g : [blankGroup()]; };
  const ensureGroups = (e) => { if (!Array.isArray(e.groups)) Object.assign(e, window.ProgramRx.normalize(e)); if (!e.groups.length) e.groups = [blankGroup()]; };

  // an intensity as typed → { value, unit: "%" | "RPE" | "RIR" | "lb" | "kg" | null (not said) }: 75%, 70-75 %,
  // RPE 8, 8 RPE, 2 RIR, or a weight: 135 lb, 135lbs, 135#, 60 kg
  function parseIntensity(t) {
    let v = `${t || ""}`.trim();
    if (/rpe/i.test(v)) return { value: v.replace(/rpe/i, "").trim(), unit: "RPE" };
    if (/rir/i.test(v)) return { value: v.replace(/rir/i, "").trim(), unit: "RIR" };
    if (/%/.test(v)) return { value: v.replace(/\s*%\s*/g, "").trim(), unit: "%" };
    if (/\d\s*(lbs?|#|pounds?)\.?$/i.test(v)) return { value: v.replace(/\s*(lbs?|#|pounds?)\.?$/i, "").trim(), unit: "lb" };
    if (/\d\s*(kgs?|kilos?)\.?$/i.test(v)) return { value: v.replace(/\s*(kgs?|kilos?)\.?$/i, "").trim(), unit: "kg" };
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
      // sets and reps but no exercise (and no label): another line of the exercise above, as a copied block of an exercise with two set lines comes out
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
  function IntCell({ ex, g, cell, cls, onCommit }) {
    const [txt, setTxt] = useState(null); // what's being typed, until the cell is left
    const shown = intText(ex, g);
    const unit = window.ProgramRx.normalize(ex).intensityUnit;
    return (
      <input
        className={`pt-cell pt-short${cls || ""}`}
        value={txt !== null ? txt : shown}
        data-pt={cell}
        placeholder={unit && unit !== "%" ? unit : "%"}
        title="Intensity with its unit: 75%, RPE 8, 2 RIR, or a weight: 135 lb, 60 kg. A number on its own keeps this exercise's unit."
        onChange={(e) => setTxt(e.target.value)}
        onBlur={() => { if (txt !== null && txt.trim() !== shown) onCommit(txt); setTxt(null); }}
      />
    );
  }

  // a cell whose words wrap onto more lines (the exercise name, the notes): the text itself until it's clicked or
  // moved into, then a box to type in (keeping the library's suggestions for a name)
  function WrapCell({ value, cell, cls, placeholder, list, onChange, onFocus, onBlur }) {
    const [editing, setEditing] = useState(false);
    const ref = useRef(null);
    useEffect(() => { if (editing && ref.current) { ref.current.focus(); ref.current.select(); } }, [editing]);
    if (editing) {
      return <input ref={ref} className={`pt-cell ${cls || ""}`} value={value || ""} data-pt={cell} list={list} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} onFocus={onFocus} onBlur={(e) => { setEditing(false); if (onBlur) onBlur(e); }} />;
    }
    return (
      <div className={`pt-cell pt-wrap ${cls || ""}`} tabIndex={0} data-pt={cell} data-v={value || ""} onFocus={() => setEditing(true)}>
        {value || <span className="pt-ph">{placeholder}</span>}
      </div>
    );
  }

  // Tempo, Rest and Notes are columns only where a day uses them (a value in any of its exercises) or "+ Column"
  // added them (kept on the day as tableCols), so a day built from scratch is just Sets, Reps and Intensity
  const OPTIONAL = [["tempo", "Tempo"], ["rest", "Rest"], ["notes", "Notes"]];
  const shownOf = (session) => {
    const on = session.tableCols || [];
    return OPTIONAL.reduce((o, [k]) => ({ ...o, [k]: on.includes(k) || session.exercises.some((e) => `${e[k] || ""}`.trim()) }), {});
  };

  function ProgramTableWeek({ week, wi, edit, newExercise, newSession, maxDays, onNameFocus, onNameBlur, onProgress, reedPicker }) {
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
    const colsOf = (session) => { const sh = shownOf(session); return ["name", "sets", "reps", "int", ...(sh.tempo ? ["tempo"] : []), ...(sh.rest ? ["rest"] : []), ...extraColsOf(session).map((l) => `x:${l}`), ...(sh.notes ? ["notes"] : [])]; };
    const colKey = (session, col) => { const m = /^x(\d+)$/.exec(col); return m ? `x:${extraColsOf(session)[Number(m[1])]}` : col; };
    // "+ Column": Tempo, Rest or Notes, or Time, Distance, Speed or a box the coach names, on every exercise of one
    // day (si) or of the week
    const addCol = (si, what) => {
      const where = si == null ? "this week" : `in ${week.sessions[si].name || `Day ${si + 1}`}`;
      if (OPTIONAL.some(([k]) => k === what)) {
        edit((d) => (si == null ? d.weeks[wi].sessions : [d.weeks[wi].sessions[si]]).forEach((s) => { s.tableCols = [...new Set([...(s.tableCols || []), what])]; }));
        return;
      }
      const add = (label) => {
        if (!label) return;
        edit((d) => (si == null ? d.weeks[wi].sessions : [d.weeks[wi].sessions[si]]).forEach((s) => addColumn(s, label)));
        setNote(`${label} added to every exercise ${where}. Leave a box empty for the athlete to write in their own.`);
      };
      if (what === "custom") window.askText({ title: "New column", text: `Added to every exercise ${where}.`, placeholder: "Height, Load, Holds…", maxLength: 20 }).then(add);
      else add(what);
    };
    const dropCol = (si, label) => {
      const s = week.sessions[si];
      const filled = s.exercises.filter((ex) => { const i = extraIndex(ex, label); return i >= 0 && `${ex.extras[i].value || ""}`.trim(); }).length;
      const drop = () => edit((d) => removeColumn(d.weeks[wi].sessions[si], label));
      if (!filled) { drop(); return; }
      window.askConfirm({ title: `Remove the ${label} column?`, text: `${filled} exercise${filled === 1 ? " has" : "s have"} something in it in ${s.name || `Day ${si + 1}`}. Ctrl+Z undoes it.`, ok: "Remove", danger: true }).then((yes) => { if (yes) drop(); });
    };
    // Tempo, Rest or Notes off a day: their values are cleared too (asked first when there are any)
    const dropBase = (si, k, title) => {
      const s = week.sessions[si];
      const filled = s.exercises.filter((e) => `${e[k] || ""}`.trim()).length;
      const drop = () => edit((d) => { const ds = d.weeks[wi].sessions[si]; ds.tableCols = (ds.tableCols || []).filter((x) => x !== k); ds.exercises.forEach((e) => { e[k] = ""; }); });
      if (!filled) { drop(); return; }
      window.askConfirm({ title: `Remove the ${title} column?`, text: `${filled} exercise${filled === 1 ? " has" : "s have"} something in it in ${s.name || `Day ${si + 1}`}, which will be cleared. Ctrl+Z undoes it.`, ok: "Remove", danger: true }).then((yes) => { if (yes) drop(); });
    };
    const colMenu = (si) => (
      <select className="pt-addcol" value="" title={si == null ? "Add a column to every exercise on every day of this week" : "Add a column to every exercise in this day"} onChange={(e) => addCol(si, e.target.value)}>
        <option value="" disabled hidden>{si == null ? "+ Column on every day" : "+ Column"}</option>
        {OPTIONAL.filter(([k]) => si == null || !shownOf(week.sessions[si])[k]).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
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

    // rows copied from a sheet, pasted from one cell across and down (adding rows as needed)
    const pasteAt = (si, row, col, text) => {
      const ei = Number(row.split(".")[0]);
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
      setNote(`Pasted ${recs.length} row${recs.length === 1 ? "" : "s"} into ${session.name || `Day ${si + 1}`}. Ctrl+Z undoes it.`);
    };
    const clipText = (e) => ((e.clipboardData || window.clipboardData).getData("text/plain") || "").replace(/\r\n?/g, "\n").replace(/\n+$/, "");
    const onPaste = (e) => {
      const t = e.target, key = t && t.dataset ? t.dataset.pt : null;
      if (!key) return;
      const text = clipText(e);
      if (!/[\t\n]/.test(text)) return; // a single cell: an ordinary paste into the box
      e.preventDefault();
      const [s, row, col] = key.split(":");
      t.blur();
      pasteAt(Number(s), row, col, text);
    };

    // ---- highlighting a block of cells, as in a sheet: drag across them (or click one, then Shift+click another).
    // Ctrl+C copies them as rows and columns, ready to paste into Google Sheets, Excel or another day; Ctrl+V pastes
    // at the block's top-left cell; Ctrl+X cuts; Delete clears them; Esc or a click elsewhere lets go.
    // The block is { si, a: [row, col], b: [row, col] }, rows being the day's set lines in order and columns the
    // day's columns (rowKeysOf / colIdsOf). A cell of the exercise itself (name, tempo…) is on its first line.
    const [sel, setSel] = useState(null);
    const drag = useRef(null);
    const rowKeysOf = (session) => session.exercises.flatMap((ex, ei) => groupsOf(ex).map((g, gi) => `${ei}.${gi}`));
    const colIdsOf = (session) => colsOf(session).map((k) => (k.startsWith("x:") ? `x${extraColsOf(session).indexOf(k.slice(2))}` : k));
    const posOf = (el) => {
      const p = el && el.dataset && el.dataset.pt ? el.dataset.pt.split(":") : null;
      const s = p ? week.sessions[Number(p[0])] : null;
      if (!s) return null;
      const r = rowKeysOf(s).indexOf(p[1]), c = colIdsOf(s).indexOf(p[2]);
      return r < 0 || c < 0 ? null : { si: Number(p[0]), r, c };
    };
    const box = (b) => ({ r0: Math.min(b.a[0], b.b[0]), r1: Math.max(b.a[0], b.b[0]), c0: Math.min(b.a[1], b.b[1]), c1: Math.max(b.a[1], b.b[1]) });
    const multi = !!sel && (sel.a[0] !== sel.b[0] || sel.a[1] !== sel.b[1]);
    const cellAt = (si, row, col) => rootRef.current && rootRef.current.querySelector(`[data-pt="${si}:${row}:${col}"]`);
    // what each highlighted cell shows, as tab-separated rows; a block that starts at the Exercise column brings
    // the labels (A1, A2…) along in front, so the supersets survive a trip through a sheet
    const selText = () => {
      const s = week.sessions[sel.si], rk = rowKeysOf(s), ci = colIdsOf(s), R = box(sel), out = [], labels = window.exerciseLabels(s.exercises);
      for (let r = R.r0; r <= R.r1; r += 1) {
        const [ei, gi] = rk[r].split(".").map(Number);
        const line = R.c0 === 0 ? [gi === 0 ? labels[ei].replace(/\.$/, "") : ""] : [];
        for (let c = R.c0; c <= R.c1; c += 1) { const el = cellAt(sel.si, rk[r], ci[c]); line.push(el ? `${el.tagName === "INPUT" ? el.value : el.dataset.v || ""}`.replace(/[\t\r\n]+/g, " ") : ""); }
        out.push(line.join("\t"));
      }
      return out.join("\n");
    };
    const clearSel = () => {
      const s = week.sessions[sel.si], rk = rowKeysOf(s), ci = colIdsOf(s), R = box(sel), labels = extraColsOf(s);
      edit((d) => {
        const ds = d.weeks[wi].sessions[sel.si];
        for (let r = R.r0; r <= R.r1; r += 1) for (let c = R.c0; c <= R.c1; c += 1) {
          const [ei, gi] = rk[r].split(".").map(Number), col = ci[c], e = ds.exercises[ei];
          if (!e) continue;
          if (col === "sets" || col === "reps" || col === "int") { ensureGroups(e); if (e.groups[gi]) e.groups[gi][col === "int" ? "intensity" : col] = ""; }
          else if (gi === 0) { const m = /^x(\d+)$/.exec(col); if (m) { if (labels[Number(m[1])]) setExtra(e, labels[Number(m[1])], ""); } else e[col] = ""; }
        }
      });
    };
    const onMouseDown = (e) => {
      const p = posOf(e.target.closest && e.target.closest("[data-pt]"));
      if (!p) { if (sel) setSel(null); return; }
      if (e.shiftKey && sel && sel.si === p.si) { // Shift+click: from the cell already picked to this one
        e.preventDefault();
        if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
        setSel({ ...sel, b: [p.r, p.c] });
        return;
      }
      drag.current = { si: p.si, a: [p.r, p.c], moved: false };
      setSel({ si: p.si, a: [p.r, p.c], b: [p.r, p.c] });
    };
    const onMouseOver = (e) => {
      const d = drag.current;
      if (!d) return;
      const p = posOf(e.target.closest && e.target.closest("[data-pt]"));
      if (!p || p.si !== d.si || (!d.moved && p.r === d.a[0] && p.c === d.a[1])) return;
      if (!d.moved) { // the drag has left the first cell: a block of cells, not text inside the box
        d.moved = true;
        rootRef.current.classList.add("pt-dragging");
        if (document.activeElement && rootRef.current.contains(document.activeElement)) document.activeElement.blur();
      }
      const s = window.getSelection && window.getSelection();
      if (s && s.rangeCount) s.removeAllRanges();
      setSel({ si: d.si, a: d.a, b: [p.r, p.c] });
    };
    useEffect(() => {
      const up = () => { drag.current = null; if (rootRef.current) rootRef.current.classList.remove("pt-dragging"); };
      const down = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setSel(null); };
      document.addEventListener("mouseup", up);
      document.addEventListener("mousedown", down);
      return () => { document.removeEventListener("mouseup", up); document.removeEventListener("mousedown", down); };
    }, []);
    useEffect(() => {
      if (!multi) return undefined;
      const free = () => !document.activeElement || document.activeElement === document.body;
      // first, so the builder's own Ctrl+C / Ctrl+V (for ticked days) leaves these to the copy and paste below
      const keys = (e) => {
        if (!free()) return;
        const k = (e.key || "").toLowerCase();
        if ((e.ctrlKey || e.metaKey) && (k === "c" || k === "v" || k === "x")) e.stopPropagation();
        else if (k === "escape") setSel(null);
        else if (k === "delete" || k === "backspace") { e.preventDefault(); clearSel(); }
      };
      const copy = (e) => { if (!free()) return; e.clipboardData.setData("text/plain", selText()); e.preventDefault(); const R = box(sel); setNote(`Copied ${R.r1 - R.r0 + 1} row${R.r1 > R.r0 ? "s" : ""} × ${R.c1 - R.c0 + 1} column${R.c1 > R.c0 ? "s" : ""}. Paste it into a sheet, or click a cell here and press Ctrl+V.`); };
      const cut = (e) => { if (!free()) return; e.clipboardData.setData("text/plain", selText()); e.preventDefault(); clearSel(); };
      const paste = (e) => {
        if (!free()) return;
        const text = clipText(e);
        if (!text) return;
        e.preventDefault();
        const s = week.sessions[sel.si], R = box(sel);
        pasteAt(sel.si, rowKeysOf(s)[R.r0], colIdsOf(s)[R.c0], text);
      };
      window.addEventListener("keydown", keys, true);
      document.addEventListener("copy", copy);
      document.addEventListener("cut", cut);
      document.addEventListener("paste", paste);
      return () => { window.removeEventListener("keydown", keys, true); document.removeEventListener("copy", copy); document.removeEventListener("cut", cut); document.removeEventListener("paste", paste); };
    });
    // the class a highlighted cell gets
    const selCls = (si, rk, ci, row, col) => {
      if (!multi || sel.si !== si) return "";
      const r = rk.indexOf(row), c = ci.indexOf(col), R = box(sel);
      return r >= R.r0 && r <= R.r1 && c >= R.c0 && c <= R.c1 ? " pt-sel" : "";
    };

    return (
      <div className="pt-week" ref={rootRef} onKeyDown={onKey} onPaste={onPaste} onMouseDown={onMouseDown} onMouseOver={onMouseOver}>
        <div className="pt-weekbar">
          {week.sessions.length < maxDays && (
            <button className="btn btn-small-grey pt-add-day" onClick={() => edit((d) => { if (d.weeks[wi].sessions.length < maxDays) d.weeks[wi].sessions.push(newSession(d.weeks[wi].sessions.length + 1)); })}>+ Add day</button>
          )}
          {colMenu(null)}
          {note && <span className="pt-note">{note}</span>}
        </div>
        {/* the week's days side by side (program-days: the builder's size buttons and Fit week apply) */}
        <div className="program-days pt-days">
        {week.sessions.map((session, si) => {
          const labels = window.exerciseLabels(session.exercises);
          const xcols = extraColsOf(session);
          const ex$ = (d, ei) => d.weeks[wi].sessions[si].exercises[ei];
          // typing in Tempo, Rest or Notes keeps that column on the day, so clearing the last value doesn't take it away
          const setEx = (ei, k, v) => edit((d) => {
            ex$(d, ei)[k] = v;
            const ds = d.weeks[wi].sessions[si];
            if (OPTIONAL.some(([o]) => o === k) && !(ds.tableCols || []).includes(k)) ds.tableCols = [...(ds.tableCols || []), k];
          });
          const setLine = (ei, gi, k, v) => edit((d) => { const e = ex$(d, ei); ensureGroups(e); e.groups[gi][k] = v; });
          const rk = rowKeysOf(session), ci = colIdsOf(session), sh = shownOf(session);
          const sc = (row, col) => selCls(si, rk, ci, row, col);
          const baseHead = (k, title, cls) => <th className={cls}>{title}<button className="btn-link pt-xdrop" title={`Remove the ${title} column from this day`} onClick={() => dropBase(si, k, title)}>✕</button></th>;
          const cell = (ex, ei, k, props) => (
            <input {...props} className={`pt-cell ${(props && props.className) || ""}${sc(`${ei}.0`, k)}`} value={ex[k] || ""} data-pt={`${si}:${ei}.0:${k}`} onChange={(e) => setEx(ei, k, e.target.value)} />
          );
          return (
            <div className="pt-day" key={si}>
              <div className="pt-day-head">
                <input className="program-session-name" value={session.name || ""} aria-label="Day name" onChange={(e) => { const v = e.target.value; edit((d) => { d.weeks[wi].sessions[si].name = v; }); }} />
                {onProgress && <button className="btn-link pt-day-progress" title="Progress this day across the weeks: every week's sets, reps and intensity side by side" aria-label="Progress this day across the weeks" onClick={() => onProgress(si, null)}>↗</button>}
                {colMenu(si)}
                <button className="btn-link" title="Remove this day" disabled={week.sessions.length === 1} onClick={() => edit((d) => { d.weeks[wi].sessions.splice(si, 1); })}>✕</button>
              </div>
              <textarea className="program-warmup pt-warmup" rows={1} value={session.warmup || ""} placeholder="Warm-up (optional), shown above A1" onChange={(e) => { const v = e.target.value; edit((d) => { d.weeks[wi].sessions[si].warmup = v; }); }} />
              {/* wider than the day when it has many columns: the exercise column keeps at least 160px, and the table scrolls */}
              <div className="pt-scroll">
              <table className="pt-table" style={{ minWidth: 34 + 140 + 72 + 70 + 76 + 72 * ((sh.tempo ? 1 : 0) + (sh.rest ? 1 : 0)) + 86 * xcols.length + (sh.notes ? 130 : 0) + 22 }}>
                <thead>
                  <tr>
                    <th className="pt-lab" /><th>Exercise</th><th className="pt-setsh">Sets</th><th className="pt-repsh">Reps</th><th className="pt-inth">Intensity</th>
                    {sh.tempo && baseHead("tempo", "Tempo", "pt-sh")}
                    {sh.rest && baseHead("rest", "Rest", "pt-sh")}
                    {xcols.map((l) => (
                      <th className="pt-xcol" key={l}>{l}<button className="btn-link pt-xdrop" title={`Remove the ${l} column from this day`} onClick={() => dropCol(si, l)}>✕</button></th>
                    ))}
                    {sh.notes && baseHead("notes", "Notes", "pt-noteh")}
                    <th className="pt-del" />
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
                    // each block (A1, A2…; then B1, B2…) in a color of its own, boxed: the box's top on its first exercise,
                    // its bottom on its last
                    <tbody key={ex.id || ei} className={`pt-boxed${linked ? " pt-linked" : ei > 0 ? " pt-block" : ""}${!linked ? " pt-bstart" : ""}${!(session.exercises[ei + 1] && session.exercises[ei + 1].linked) ? " pt-bend" : ""}`} style={{ "--blk": BLOCK_COLORS[letterIndex(letter) % BLOCK_COLORS.length] }}>
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
                                <WrapCell value={ex.name} cell={`${si}:${ei}.0:name`} cls={`pt-name${sc(`${ei}.0`, "name")}`} list="exercise-library-names" placeholder="Exercise" onChange={(v) => setEx(ei, "name", v)} onFocus={() => onNameFocus && onNameFocus(wi, si, ei, ex.name)} onBlur={() => onNameBlur && onNameBlur(wi, si, ei)} />
                                {/* a Re-Ed placeholder ("Re-Ed", "Corrective"…) in an athlete's program: pick one of their re-ed drills */}
                                {reedPicker && reedPicker(wi, si, ei, ex, "pt-reed")}
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
                                {/* a superset partner that goes with only some of the first exercise's sets (ProgramRx.withSetsText) */}
                                {linked && (ex.withSets != null ? (
                                  <div className="pt-edt pt-with" title={`Which of ${letter}1's sets this goes with, for example 1-2 (and the next row 3-4). The athlete sees "With sets 1–2".`}>
                                    with sets
                                    <input className="pt-cell pt-edt-min" value={ex.withSets} data-pt={`${si}:${ei}.0:with`} aria-label="With sets" placeholder="1-2" onChange={(e) => { const v = e.target.value.replace(/[^\d\s,–-]/g, ""); edit((d) => { ex$(d, ei).withSets = v; }); }} />
                                    <button className="btn-link pt-edt-off" tabIndex={-1} title="Goes with every set" onClick={() => edit((d) => { delete ex$(d, ei).withSets; })}>✕</button>
                                  </div>
                                ) : (
                                  <button className="pt-edt-add" tabIndex={-1} title={`This goes with only some of ${letter}1's sets (say 1-2, with the next row taking 3-4), so ${letter}1 stays one series`} onClick={() => { pending.current = `${si}:${ei}.0:with`; edit((d) => { ex$(d, ei).withSets = ""; }); }}>+ with sets</button>
                                ))}
                                {more && <div className="pt-more" title="Edited in the Boxes view">{more}</div>}
                              </td>
                            </React.Fragment>
                          )}
                          {/* the sets cell also adds a set line (+, on the last one) and takes one off (✕) */}
                          <td>
                            <div className="pt-setcell">
                              <input className={`pt-cell pt-short${sc(`${ei}.${gi}`, "sets")}`} value={g.sets || ""} data-pt={`${si}:${ei}.${gi}:sets`} title="Sets (leave blank for one set)" onChange={(e) => setLine(ei, gi, "sets", e.target.value)} />
                              <span className="pt-ln">
                                {gi === n - 1 && <button className="btn-link pt-addline" tabIndex={-1} title="Another line of sets for this exercise (3x5, then 2x3…)" onClick={() => { pending.current = `${si}:${ei}.${n}:sets`; edit((d) => { const e = ex$(d, ei); ensureGroups(e); e.groups.push(blankGroup()); }); }}>+</button>}
                                {gi > 0 && <button className="btn-link" tabIndex={-1} title="Remove this set line" onClick={() => edit((d) => { const e = ex$(d, ei); ensureGroups(e); e.groups.splice(gi, 1); })}>✕</button>}
                              </span>
                            </div>
                          </td>
                          <td><input className={`pt-cell pt-short${sc(`${ei}.${gi}`, "reps")}`} value={g.reps || ""} data-pt={`${si}:${ei}.${gi}:reps`} title="Reps: 5, 8-10, 4E, 30sec, 3 MIN…" onChange={(e) => setLine(ei, gi, "reps", e.target.value)} /></td>
                          <td>
                            <IntCell ex={ex} g={g} cell={`${si}:${ei}.${gi}:int`} cls={sc(`${ei}.${gi}`, "int")} onCommit={(txt) => edit((d) => {
                              const e = ex$(d, ei), pi = parseIntensity(txt);
                              ensureGroups(e);
                              e.groups[gi].intensity = pi.value;
                              setUnit(e, pi.unit, !!pi.value);
                            })} />
                          </td>
                          {gi === 0 && (
                            <React.Fragment>
                              {sh.tempo && <td rowSpan={n}>{cell(ex, ei, "tempo", { className: "pt-short", maxLength: 10, title: "Tempo: eccentric, iso, concentric. 30* = 3 seconds down, no pause, explosive up; *5* (or 050) = a 5-second iso; 6-1 = descending isos from 6 seconds to 1, 6-1-6 down and back up." })}</td>}
                              {sh.rest && <td rowSpan={n}>{cell(ex, ei, "rest", { className: "pt-short" })}</td>}
                              {xcols.map((l, xi) => {
                                const i = extraIndex(ex, l);
                                return (
                                  <td key={l} rowSpan={n}>
                                    <input className={`pt-cell pt-short${sc(`${ei}.0`, `x${xi}`)}`} value={i >= 0 ? ex.extras[i].value || "" : ""} data-pt={`${si}:${ei}.0:x${xi}`} title={`${l}: a target, or leave it empty for the athlete to write in their own`} onChange={(e) => { const v = e.target.value; edit((d) => setExtra(ex$(d, ei), l, v)); }} />
                                  </td>
                                );
                              })}
                              {sh.notes && <td rowSpan={n}><WrapCell value={ex.notes} cell={`${si}:${ei}.0:notes`} cls={sc(`${ei}.0`, "notes")} placeholder="" onChange={(v) => setEx(ei, "notes", v)} /></td>}
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
        </div>
      </div>
    );
  }

  window.ProgramTableWeek = ProgramTableWeek;
  window.ProgramTableKit = { parseRx, rxText, parseSheet, applyRec, parseIntensity, WrapCell };
})();
