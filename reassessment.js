// Re-Assessment — the monthly follow-up to a full biomechanical assessment (assessment.js), on the player profile under
// Assessments. Only what the full assessment found is retested: every row with a check mark, a Fail, a Fair/Poor
// score, a flagged posture region or a note. Each item shows its last result beside boxes for today's, and is marked
// Cleared, Improved, No change or Worse. Cleared items drop off the next re-assessment; the rest carry forward, so the
// list shrinks as areas improve. A coach can add any test from the full assessment (new symptoms), and it is tracked
// the same way from then on. All the performance tests are retested every time (a blank box is "not tested", never
// zero). Each re-assessment sits beside that month's full body composition sheet.
// When re-assessments are due, and silencing a flag, are worked out by window.ReassessRules (program_rx.js), which the
// weekly email uses too.
//   Saved in the assessments table with kind "reassess": { id, athleteId, kind, date, coach, baseId, notes,
//   items: [{ path, result, added }], values: { [path]: value in the full assessment's own shape } }.
//   window.ReassessmentTab      the tab
//   window.AssessmentTrends     graphs of every number across full assessments and re-assessments (also used on the
//                               Performance Metrics tab, for the performance tests)
//   window.reassessStatusFor    the athlete's re-assessment status, for the roster flag and the Today panel
(function () {
  const { useState, useRef, useEffect, useMemo } = React;
  const L = () => window.AssessmentLayouts;
  const uid = () => `ra-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const fmt = (iso) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "");
  const fmtShort = (iso) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : "");
  const getAt = (obj, path) => path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
  const has = (v) => `${v == null ? "" : v}`.trim() !== "";
  const dualOn = (d) => !!(d && (d.c1 || d.c2));
  const dualN = (d) => (d && d.c2 ? 2 : d && d.c1 ? 1 : 0);
  const mark = (d) => (d && d.c2 ? "✓✓" : d && d.c1 ? "✓" : "");

  // ---- every test on the full assessment, as a re-assessment item ------------------------------------------
  // type says how it is recorded (the same shape as on the full form) and so how it is retested and compared.
  let catalogCache = null;
  function catalog() {
    if (catalogCache) return catalogCache;
    const A = L();
    const items = [];
    A.BODY_REGIONS.forEach((r) => items.push({ path: `bodyRegions.${r.key}`, section: "Posture", label: r.label, type: "region", def: r }));
    A.MOVEMENT_TESTS.forEach((r) => items.push({ path: `movementTests.${r.key}`, section: "Movement tests", label: r.label, note: r.note, type: r.checkbox ? "moveCheck" : "movePF", def: r }));
    A.ISOLATED_SPECIFIC.forEach((r) => items.push({ path: `isolatedSpecific.${r.key}`, section: "Isolated & specific", label: r.label, note: r.note, type: r.checkboxOnly ? "isoCheck" : "iso", def: r }));
    A.SQUAT_ANKLE_ROWS.forEach((r) => items.push({ path: `squat.ankle.${r.key}`, section: "Overhead squat", label: `Ankle: ${r.label}`, type: "squatLR" }));
    A.SQUAT_KNEE_ROWS.forEach((r) => items.push({ path: `squat.knee.${r.key}`, section: "Overhead squat", label: `Knee: ${r.label}`, type: "squatLR" }));
    A.SQUAT_PELVIS_ROWS.forEach((r) => items.push({ path: `squat.pelvis.${r.key}`, section: "Overhead squat", label: `Pelvis: ${r.label}`, type: "squatLR" }));
    items.push({ path: "squat.pelvis.depth", section: "Overhead squat", label: "Pelvic tilt (early / after 90)", type: "pelvisDepth" });
    [["lordosis", "Lordosis"], ["forwardHead", "Forward Head"], ["barDriftForward", "Bar Drift Forward"], ["barDriftBack", "Bar Drift Back"]]
      .forEach(([k, label]) => items.push({ path: `squat.upperBody.${k}`, section: "Overhead squat", label: `Upper body: ${label}`, type: "dual" }));
    items.push({ path: "squat.upperBody.score", section: "Overhead squat", label: "Upper body score", type: "score" });
    catalogCache = items;
    return items;
  }
  const itemOf = (path) => catalog().find((x) => x.path === path) || null;
  const perfTests = () => L().PERFORMANCE_TESTING;

  // an item's value on a full assessment record (pelvic tilt is two separate fields there)
  function fromFull(item, rec) {
    if (!rec) return undefined;
    if (item.type === "pelvisDepth") { const p = (rec.squat || {}).pelvis || {}; return { early: !!p.depthEarly, after90: !!p.depthAfter90 }; }
    return getAt(rec, item.path);
  }
  // was it found on that assessment (a check, a Fail, a Fair/Poor score, a flagged region, or a note)?
  function flagged(item, v) {
    if (v == null) return false;
    const notes = has(v.notes);
    switch (item.type) {
      case "region": return !!(v.flagged || Object.values(v.tags || {}).some(Boolean) || notes);
      case "movePF": return !!(has(v.fail) || dualOn(v.check) || notes);
      case "moveCheck": return !!(dualOn(v.check) || notes);
      case "iso": return !!(dualOn(v.leftCheck) || dualOn(v.rightCheck) || notes);
      case "isoCheck": return !!((v.leftCheck && v.leftCheck.c1) || (v.rightCheck && v.rightCheck.c1) || notes);
      case "squatLR": return dualOn(v.left) || dualOn(v.right);
      case "pelvisDepth": return !!(v.early || v.after90);
      case "dual": return dualOn(v);
      case "score": return v === "Fair" || v === "Poor";
      default: return false;
    }
  }
  // anything written in for it at all (so it counts as retested)
  function entered(item, v) {
    if (v == null) return false;
    if (item.type === "score") return has(v);
    if (item.type === "dual") return dualOn(v);
    if (item.type === "pelvisDepth") return !!(v.early || v.after90 || v.checked);
    if (item.type === "squatLR") return dualOn(v.left) || dualOn(v.right) || !!v.checked;
    return flagged(item, v) || has(v.pass) || has(v.left) || has(v.right) || !!v.checked;
  }
  // how much is wrong, for comparing one time with the next
  function severity(item, v) {
    if (v == null) return 0;
    switch (item.type) {
      case "region": return Object.values(v.tags || {}).filter(Boolean).length + (v.flagged ? 1 : 0);
      case "movePF": return (v.fail === "L & R" ? 2 : has(v.fail) ? 1 : 0) + dualN(v.check);
      case "moveCheck": return dualN(v.check);
      case "iso": return dualN(v.leftCheck) + dualN(v.rightCheck);
      case "isoCheck": return (v.leftCheck && v.leftCheck.c1 ? 1 : 0) + (v.rightCheck && v.rightCheck.c1 ? 1 : 0);
      case "squatLR": return dualN(v.left) + dualN(v.right);
      case "pelvisDepth": return (v.early ? 1 : 0) + (v.after90 ? 1 : 0);
      case "dual": return dualN(v);
      case "score": return v === "Poor" ? 2 : v === "Fair" ? 1 : 0;
      default: return 0;
    }
  }
  // a one-line reading of a value ("L 38 · R 45 · L ✓✓", "Fail R", "Rounded, Rotated IR")
  function describe(item, v) {
    if (v == null) return "";
    const notes = has(v.notes) ? `“${`${v.notes}`.trim()}”` : "";
    const join = (xs) => xs.filter(Boolean).join(" · ");
    switch (item.type) {
      case "region": {
        const tags = [];
        (item.def.options || []).forEach((o) => {
          if ((v.tags || {})[o.label]) tags.push(o.label);
          (o.qualifiers || []).forEach((q) => { if ((v.tags || {})[`${o.label}::${q}`]) tags.push(`${o.label} ${q}`); });
        });
        return join([tags.join(", ") || (v.flagged ? "flagged" : ""), notes]);
      }
      case "movePF": return join([has(v.pass) ? `Pass ${v.pass}` : "", has(v.fail) ? `Fail ${v.fail}` : "", mark(v.check), notes]);
      case "moveCheck": return join([mark(v.check), notes]);
      case "iso": return join([has(v.left) ? `L ${v.left}` : "", has(v.right) ? `R ${v.right}` : "", mark(v.leftCheck) ? `L ${mark(v.leftCheck)}` : "", mark(v.rightCheck) ? `R ${mark(v.rightCheck)}` : "", notes]);
      case "isoCheck": return join([v.leftCheck && v.leftCheck.c1 ? "L positive" : "", v.rightCheck && v.rightCheck.c1 ? "R positive" : "", notes]);
      case "squatLR": return join([mark(v.left) ? `L ${mark(v.left)}` : "", mark(v.right) ? `R ${mark(v.right)}` : ""]) || (v.checked ? "clear" : "");
      case "pelvisDepth": return join([v.early ? "Early" : "", v.after90 ? "After 90" : ""]) || (v.checked ? "clear" : "");
      case "dual": return mark(v);
      case "score": return has(v) ? v : "";
      default: return "";
    }
  }
  // the norm written on the form ("> 50°", "< 20° flexion"), when there is one
  const normOf = (item) => { const m = /([<>])\s*(\d+(?:\.\d+)?)/.exec(item.note || ""); return m ? { op: m[1], n: Number(m[2]) } : null; };
  // what the result looks like, from last time and today: Cleared / Improved / No change / Worse ("" if not retested)
  function suggest(item, prev, now) {
    if (!entered(item, now)) return "";
    if (item.type === "iso") {
      const norm = normOf(item);
      const sides = ["left", "right"].filter((s) => has(now[s]) && !isNaN(parseFloat(now[s])));
      if (norm && sides.length && sides.every((s) => (norm.op === ">" ? parseFloat(now[s]) > norm.n : parseFloat(now[s]) < norm.n)) && !dualOn(now.leftCheck) && !dualOn(now.rightCheck) && !has(now.notes)) return "cleared";
      const better = norm && norm.op === "<" ? -1 : 1;
      const diffs = sides.filter((s) => prev && has(prev[s]) && !isNaN(parseFloat(prev[s]))).map((s) => (parseFloat(now[s]) - parseFloat(prev[s])) * better);
      if (diffs.length) { const d = diffs.reduce((a, b) => a + b, 0); if (d > 0) return "improved"; if (d < 0) return "worse"; }
    }
    if (!flagged(item, now) || (item.type !== "region" && severity(item, now) === 0 && !has(now.notes) && !has(now.fail))) return severity(item, prev) > 0 || flagged(item, prev) ? "cleared" : "same";
    const a = severity(item, prev), b = severity(item, now);
    return b < a ? "improved" : b > a ? "worse" : "same";
  }
  const RESULTS = [["cleared", "Cleared"], ["improved", "Improved"], ["same", "No change"], ["worse", "Worse"]];

  // ---- an athlete's assessments, in order -------------------------------------------------------------------
  function recordsFor(athleteId) {
    const S = window.AthleteStore, A = L();
    const fulls = S.getAssessments(athleteId).map((r) => A.withDefaults(r, athleteId));
    const reassess = S.getReassessments ? S.getReassessments(athleteId) : [];
    return { fulls, reassess };
  }
  function statusFor(athlete) {
    if (!window.ReassessRules || !athlete) return null;
    const { fulls, reassess } = recordsFor(athlete.id);
    return window.ReassessRules.status({ fulls, reassessments: reassess, silencedUntil: athlete.reassessSilencedUntil || "", today: localDay() });
  }
  window.reassessStatusFor = statusFor;
  // the items a new re-assessment starts with: whatever the last one didn't clear, or, before the first, everything
  // the full assessment found
  function carryPaths(base, earlier) {
    const last = earlier[earlier.length - 1];
    if (last) return (last.items || []).filter((x) => x.result !== "cleared").map((x) => x.path).filter((p) => itemOf(p));
    return catalog().filter((it) => flagged(it, fromFull(it, base))).map((it) => it.path);
  }
  // the last result recorded for an item before a re-assessment: the latest earlier re-assessment that retested it,
  // else the full assessment
  function previousOf(path, base, earlier) {
    const item = itemOf(path);
    for (let i = earlier.length - 1; i >= 0; i -= 1) {
      const v = (earlier[i].values || {})[path];
      if (entered(item, v)) return { date: earlier[i].date, value: v, kind: "Re-assessment" };
    }
    return base ? { date: base.date, value: fromFull(item, base), kind: "Full assessment" } : null;
  }
  const perfPrev = (key, base, earlier) => {
    for (let i = earlier.length - 1; i >= 0; i -= 1) { const v = (earlier[i].values || {})[`performanceTesting.${key}`]; if (v && (has(v.left) || has(v.right))) return { date: earlier[i].date, value: v }; }
    const v = base && base.performanceTesting ? base.performanceTesting[key] : null;
    return v && (has(v.left) || has(v.right)) ? { date: base.date, value: v } : null;
  };

  // ---- small inputs, in the full form's own shapes ------------------------------------------------------------
  const blankOf = (item) => {
    switch (item.type) {
      case "region": return { flagged: false, notes: "", tags: {} };
      case "movePF": case "moveCheck": return { pass: "", fail: "", notes: "", check: { c1: false, c2: false } };
      case "iso": case "isoCheck": return { left: "", right: "", leftCheck: { c1: false, c2: false }, rightCheck: { c1: false, c2: false }, notes: "" };
      case "squatLR": return { left: { c1: false, c2: false }, right: { c1: false, c2: false } };
      case "pelvisDepth": return { early: false, after90: false };
      case "dual": return { c1: false, c2: false };
      case "score": return "";
      default: return {};
    }
  };
  function Dual({ value, onChange, label }) {
    const v = value || { c1: false, c2: false };
    return (
      <span className="ra-dual" title="One check = noted, two = needs correction">
        {label && <small>{label}</small>}
        <label><input type="checkbox" checked={!!v.c1} onChange={(e) => onChange({ ...v, c1: e.target.checked })} />✓</label>
        <label><input type="checkbox" checked={!!v.c2} onChange={(e) => onChange({ ...v, c2: e.target.checked })} />✓✓</label>
      </span>
    );
  }
  const LR = ({ value, onChange, title }) => (
    <select className="ra-lr" value={value || ""} title={title} onChange={(e) => onChange(e.target.value)}>
      <option value="">{title}: —</option><option value="L">{title} L</option><option value="R">{title} R</option><option value="L & R">{title} L &amp; R</option>
    </select>
  );
  function ItemInput({ item, value, onChange }) {
    const v = value == null ? blankOf(item) : value;
    const set = (patch) => onChange({ ...v, ...patch });
    const notes = <input className="ra-notes" placeholder="Notes" value={v.notes || ""} onChange={(e) => set({ notes: e.target.value })} />;
    switch (item.type) {
      case "region":
        return (
          <div className="ra-inputs">
            <span className="ra-tags">
              {(item.def.options || []).flatMap((o) => [
                ...(!(o.qualifiers || []).length ? [o.label] : []),
                ...(o.qualifiers || []).map((q) => `${o.label}::${q}`),
              ]).map((t) => (
                <button key={t} className={`ra-tag ${(v.tags || {})[t] ? "on" : ""}`} onClick={() => set({ tags: { ...(v.tags || {}), [t]: !(v.tags || {})[t] }, checked: true })}>{t.replace("::", " ")}</button>
              ))}
            </span>
            {notes}
          </div>
        );
      case "movePF": return <div className="ra-inputs"><LR title="Pass" value={v.pass} onChange={(x) => set({ pass: x })} /><LR title="Fail" value={v.fail} onChange={(x) => set({ fail: x })} /><Dual value={v.check} onChange={(x) => set({ check: x })} />{notes}</div>;
      case "moveCheck": return <div className="ra-inputs"><Dual value={v.check} onChange={(x) => set({ check: x, checked: true })} /><label className="ra-clear"><input type="checkbox" checked={!!v.checked && !dualOn(v.check)} onChange={(e) => set({ checked: e.target.checked, check: e.target.checked ? { c1: false, c2: false } : v.check })} />Clear</label>{notes}</div>;
      case "iso":
        return (
          <div className="ra-inputs">
            <input className="ra-num" inputMode="decimal" placeholder="L" value={v.left || ""} onChange={(e) => set({ left: e.target.value })} />
            <input className="ra-num" inputMode="decimal" placeholder="R" value={v.right || ""} onChange={(e) => set({ right: e.target.value })} />
            <Dual label="L" value={v.leftCheck} onChange={(x) => set({ leftCheck: x })} />
            <Dual label="R" value={v.rightCheck} onChange={(x) => set({ rightCheck: x })} />
            {notes}
          </div>
        );
      case "isoCheck":
        return (
          <div className="ra-inputs">
            <label className="ra-clear"><input type="checkbox" checked={!!(v.leftCheck && v.leftCheck.c1)} onChange={(e) => set({ leftCheck: { c1: e.target.checked, c2: false }, checked: true })} />L positive</label>
            <label className="ra-clear"><input type="checkbox" checked={!!(v.rightCheck && v.rightCheck.c1)} onChange={(e) => set({ rightCheck: { c1: e.target.checked, c2: false }, checked: true })} />R positive</label>
            <label className="ra-clear"><input type="checkbox" checked={!!v.checked && !(v.leftCheck && v.leftCheck.c1) && !(v.rightCheck && v.rightCheck.c1)} onChange={(e) => set({ checked: e.target.checked, leftCheck: { c1: false, c2: false }, rightCheck: { c1: false, c2: false } })} />Negative both sides</label>
            {notes}
          </div>
        );
      case "squatLR":
        return <div className="ra-inputs"><Dual label="L" value={v.left} onChange={(x) => set({ left: x, checked: true })} /><Dual label="R" value={v.right} onChange={(x) => set({ right: x, checked: true })} /><label className="ra-clear"><input type="checkbox" checked={!!v.checked && !dualOn(v.left) && !dualOn(v.right)} onChange={(e) => set({ checked: e.target.checked, left: { c1: false, c2: false }, right: { c1: false, c2: false } })} />Clear</label></div>;
      case "pelvisDepth":
        return <div className="ra-inputs"><label className="ra-clear"><input type="checkbox" checked={!!v.early} onChange={(e) => set({ early: e.target.checked, checked: true })} />Early</label><label className="ra-clear"><input type="checkbox" checked={!!v.after90} onChange={(e) => set({ after90: e.target.checked, checked: true })} />After 90</label><label className="ra-clear"><input type="checkbox" checked={!!v.checked && !v.early && !v.after90} onChange={(e) => set({ checked: e.target.checked, early: false, after90: false })} />Clear</label></div>;
      case "dual": return <div className="ra-inputs"><Dual value={v} onChange={(x) => onChange(x)} /></div>;
      case "score": return <div className="ra-inputs"><select className="ra-lr" value={v || ""} onChange={(e) => onChange(e.target.value)}><option value="">Score: —</option>{L().SCORE_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}</select></div>;
      default: return null;
    }
  }

  // ---- one re-assessment --------------------------------------------------------------------------------------
  function ReassessForm({ athlete, record, base, earlier, onSave, onOpenTab }) {
    const [rec, setRec] = useState(record);
    // saves a moment after each change, and straight away if the form closes or the page is left
    const pending = useRef(false), timer = useRef(null), first = useRef(true);
    const latest = useRef({ rec, onSave });
    latest.current = { rec, onSave };
    useEffect(() => {
      if (first.current) { first.current = false; return undefined; }
      pending.current = true;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => { pending.current = false; onSave(rec); }, 400);
      return () => clearTimeout(timer.current);
    }, [rec]); // eslint-disable-line
    useEffect(() => {
      const flush = () => { if (pending.current) { pending.current = false; latest.current.onSave(latest.current.rec); } };
      window.addEventListener("beforeunload", flush);
      window.addEventListener("pagehide", flush);
      return () => { window.removeEventListener("beforeunload", flush); window.removeEventListener("pagehide", flush); flush(); };
    }, []);
    const setVal = (path, v) => setRec((r) => ({ ...r, values: { ...(r.values || {}), [path]: v } }));
    const setItem = (path, patch) => setRec((r) => ({ ...r, items: r.items.map((x) => (x.path === path ? { ...x, ...patch } : x)) }));
    const removeItem = (path) => setRec((r) => ({ ...r, items: r.items.filter((x) => x.path !== path) }));
    const addItem = (path) => { if (path && !rec.items.some((x) => x.path === path)) setRec((r) => ({ ...r, items: [...r.items, { path, result: "", added: true }] })); };

    const counts = RESULTS.map(([k, label]) => [label, rec.items.filter((x) => x.result === k).length]).filter(([, n]) => n);
    const sections = [];
    rec.items.forEach((x) => { const it = itemOf(x.path); if (!it) return; let s = sections.find((g) => g.name === it.section); if (!s) { s = { name: it.section, rows: [] }; sections.push(s); } s.rows.push(x); });
    const free = catalog().filter((it) => !rec.items.some((x) => x.path === it.path));
    const freeSections = [...new Set(free.map((it) => it.section))];

    // that month's body composition sheet (within ten days) and the one before it
    const sheets = [...window.AthleteStore.getBodyCompSheets(athlete.id)].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    const near = (s) => Math.abs(window.ReassessRules.dayNo(s.date) - window.ReassessRules.dayNo(rec.date)) <= 10;
    const thisSheet = [...sheets].reverse().find((s) => s.date && near(s)) || null;
    const prevSheet = thisSheet ? [...sheets].reverse().find((s) => s.date && s.date < thisSheet.date) : sheets[sheets.length - 1] || null;
    const bc = [["Weight", "weightLb", "lb"], ["Body fat", "pctFat", "%"], ["Lean", "leanLb", "lb"], ["Fat", "fatLb", "lb"], ["Muscle", "muscleLb", "lb"]];
    const num = (x) => (x == null || isNaN(Number(x)) ? null : Number(x));
    const r1 = (x) => Math.round(x * 10) / 10;

    return (
      <div className="ra-form">
        <div className="ra-head">
          <label>Date <input type="date" value={rec.date} onChange={(e) => setRec((r) => ({ ...r, date: e.target.value }))} /></label>
          <label>Coach <input value={rec.coach || ""} placeholder="Coach" onChange={(e) => setRec((r) => ({ ...r, coach: e.target.value }))} /></label>
          {counts.length > 0 && <span className="ra-counts">{counts.map(([l, n]) => `${n} ${l.toLowerCase()}`).join(" · ")}</span>}
          <span className="ra-saved">✓ Saved automatically</span>
        </div>

        <h3>Retest <small>{rec.items.length} item{rec.items.length === 1 ? "" : "s"}: what the last assessment found. Cleared items drop off next month.</small></h3>
        {rec.items.length === 0 && <div className="facility-note">Nothing carried forward: everything has cleared. Add a test below if something new comes up.</div>}
        {sections.map((s) => (
          <div className="ra-section" key={s.name}>
            <div className="ra-section-name">{s.name}</div>
            {s.rows.map((x) => {
              const it = itemOf(x.path);
              const prev = previousOf(x.path, base, earlier);
              const now = (rec.values || {})[x.path];
              const hint = suggest(it, prev && prev.value, now);
              return (
                <div className={`ra-item ${x.result ? `is-${x.result}` : ""}`} key={x.path}>
                  <div className="ra-item-head">
                    <strong>{it.label}</strong>{it.note && <small> {it.note}</small>}
                    {x.added && <span className="ra-added">added</span>}
                    <button className="ra-remove" title="Take this off the re-assessment" onClick={() => removeItem(x.path)}>✕</button>
                  </div>
                  <div className="ra-prev">Last ({prev ? `${prev.kind.toLowerCase()} ${fmt(prev.date)}` : "—"}): <b>{prev ? describe(it, prev.value) || "—" : "—"}</b></div>
                  <ItemInput item={it} value={now} onChange={(v) => setVal(x.path, v)} />
                  <div className="ra-results">
                    {RESULTS.map(([k, label]) => (
                      <button key={k} className={`ra-result r-${k} ${x.result === k ? "on" : ""} ${!x.result && hint === k ? "hint" : ""}`} title={!x.result && hint === k ? "Suggested from what's entered" : ""} onClick={() => setItem(x.path, { result: x.result === k ? "" : k })}>{label}</button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
        <div className="ra-add">
          <select value="" onChange={(e) => addItem(e.target.value)}>
            <option value="">+ Add a test (new symptoms, or anything else to check)…</option>
            {freeSections.map((sec) => <optgroup key={sec} label={sec}>{free.filter((it) => it.section === sec).map((it) => <option key={it.path} value={it.path}>{it.label}{it.note ? ` (${it.note})` : ""}</option>)}</optgroup>)}
          </select>
        </div>

        <h3>Performance tests <small>all of them, every time; leave a box blank if it wasn't tested</small></h3>
        <div className="ra-perf">
          {perfTests().map((t) => {
            const path = `performanceTesting.${t.key}`;
            const v = (rec.values || {})[path] || { left: "", right: "", notes: "" };
            const prev = perfPrev(t.key, base, earlier);
            const set = (patch) => setVal(path, { ...v, ...patch });
            return (
              <div className="ra-perf-row" key={t.key}>
                <span className="ra-perf-name">{t.label}{t.note ? <small> {t.note}</small> : null}</span>
                {t.single
                  ? <input className="ra-num" inputMode="decimal" placeholder="—" value={v.left || ""} onChange={(e) => set({ left: e.target.value })} />
                  : <React.Fragment><input className="ra-num" inputMode="decimal" placeholder="L" value={v.left || ""} onChange={(e) => set({ left: e.target.value })} /><input className="ra-num" inputMode="decimal" placeholder="R" value={v.right || ""} onChange={(e) => set({ right: e.target.value })} /></React.Fragment>}
                <small className="ra-perf-prev">{prev ? `last ${t.single ? prev.value.left : `L ${prev.value.left || "—"} · R ${prev.value.right || "—"}`} (${fmt(prev.date)})` : "first time"}</small>
              </div>
            );
          })}
        </div>

        <h3>Body composition <small>a full body comp sheet each month, on the Body Composition tab</small></h3>
        <div className="ra-bc">
          {thisSheet ? (
            <table>
              <thead><tr><th></th>{bc.map(([l]) => <th key={l}>{l}</th>)}</tr></thead>
              <tbody>
                <tr><td>{fmt(thisSheet.date)}</td>{bc.map(([l, k, u]) => <td key={l}>{num((thisSheet.summary || {})[k]) != null ? `${r1(num(thisSheet.summary[k]))} ${u}` : "—"}</td>)}</tr>
                {prevSheet && <tr className="ra-bc-change"><td>Change since {fmt(prevSheet.date)}</td>{bc.map(([l, k, u]) => { const a = num((prevSheet.summary || {})[k]), b = num((thisSheet.summary || {})[k]); return <td key={l}>{a != null && b != null ? `${b - a >= 0 ? "+" : ""}${r1(b - a)} ${u}` : "—"}</td>; })}</tr>}
              </tbody>
            </table>
          ) : <div className="facility-note">No body comp sheet within ten days of this re-assessment yet.</div>}
          {onOpenTab && <button className="btn btn-secondary" onClick={() => onOpenTab("bodycomp")}>{thisSheet ? "Open Body Composition" : "Enter this month's body comp"}</button>}
        </div>

        <label className="facility-field wide ra-notes-all"><span>Notes</span>
          <textarea rows={2} value={rec.notes || ""} onChange={(e) => setRec((r) => ({ ...r, notes: e.target.value }))} placeholder="Anything else from today" />
        </label>
      </div>
    );
  }

  // ---- graphs: every number across the off-season -------------------------------------------------------------
  // The isolated tests' degrees and every performance test, from full assessments and re-assessments, one small
  // graph each, for those with at least two results. A blank is left out, never drawn as zero.
  function seriesFor(athleteId, only) {
    const { fulls, reassess } = recordsFor(athleteId);
    const A = L();
    const n = (x) => (has(x) && !isNaN(parseFloat(x)) ? parseFloat(x) : null);
    const charts = [];
    const add = (title, unitNote, pick, single) => {
      const points = [];
      fulls.forEach((r) => { const v = pick(r, "full"); if (v) points.push({ date: r.date, ...v }); });
      reassess.forEach((r) => { const v = pick(r, "re"); if (v) points.push({ date: r.date, ...v }); });
      points.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
      const usable = points.filter((p) => p.L != null || p.R != null);
      const enough = (k) => usable.filter((p) => p[k] != null).length >= 2;
      if (enough("L") || enough("R")) charts.push({ title, unitNote, single, data: usable.map((p) => ({ ...p, label: new Date(`${p.date}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" }) })) });
    };
    if (only !== "performance") {
      A.ISOLATED_SPECIFIC.filter((t) => !t.checkboxOnly).forEach((t) => add(t.label, t.note, (r, kind) => {
        const v = kind === "full" ? (r.isolatedSpecific || {})[t.key] : (r.values || {})[`isolatedSpecific.${t.key}`];
        return v ? { L: n(v.left), R: n(v.right) } : null;
      }));
    }
    A.PERFORMANCE_TESTING.forEach((t) => add(t.label, t.note, (r, kind) => {
      const v = kind === "full" ? (r.performanceTesting || {})[t.key] : (r.values || {})[`performanceTesting.${t.key}`];
      return v ? (t.single ? { L: n(v.left), R: null } : { L: n(v.left), R: n(v.right) }) : null;
    }, t.single));
    return charts;
  }
  function AssessmentTrends({ athleteId, only, title, hint }) {
    const R = window.Recharts;
    const charts = seriesFor(athleteId, only);
    if (!R || !charts.length) return null;
    const { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } = R;
    return (
      <div className="panel ra-trends">
        <h2>{title || "Changes over the off-season"} <small>{hint || "from full assessments and re-assessments; blanks are left out"}</small></h2>
        <div className="ra-trend-grid">
          {charts.map((c) => (
            <div className="ra-trend" key={c.title + (c.unitNote || "")}>
              <div className="ra-trend-title">{c.title}{c.unitNote ? <small> {c.unitNote}</small> : null}</div>
              <ResponsiveContainer width="100%" height={150}>
                <LineChart data={c.data} margin={{ top: 6, right: 10, bottom: 0, left: -18 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#9aa3ad" }} />
                  <YAxis tick={{ fontSize: 10, fill: "#9aa3ad" }} domain={["auto", "auto"]} />
                  <Tooltip contentStyle={{ background: "#1b1d21", border: "1px solid #333", fontSize: 12 }} />
                  <Line type="monotone" dataKey="L" name={c.single ? c.title : "Left"} stroke="#e0565f" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                  {!c.single && <Line type="monotone" dataKey="R" name="Right" stroke="#5aa9e6" strokeWidth={2} dot={{ r: 3 }} connectNulls />}
                </LineChart>
              </ResponsiveContainer>
            </div>
          ))}
        </div>
        {charts.some((c) => !c.single) && <div className="ra-legend"><span className="ra-l">Left</span><span className="ra-r">Right</span></div>}
      </div>
    );
  }
  window.AssessmentTrends = AssessmentTrends;

  // ---- the tab ---------------------------------------------------------------------------------------------------
  function ReassessmentTab({ athlete, onOpenTab }) {
    const S = window.AthleteStore;
    const [, bump] = useState(0);
    const [openId, setOpenId] = useState(null);
    const { fulls, reassess } = recordsFor(athlete.id);
    const st = statusFor(athlete);
    const base = st && st.full ? st.full : null;
    const after = base ? reassess.filter((r) => r.date >= base.date) : [];
    const open = reassess.find((r) => r.id === openId) || null;

    const startNew = () => {
      const rec = { id: uid(), athleteId: athlete.id, kind: "reassess", date: localDay(), coach: "", baseId: base.id, notes: "", items: carryPaths(base, after).map((path) => ({ path, result: "", added: false })), values: {} };
      S.saveAssessment(rec);
      setOpenId(rec.id);
      bump((x) => x + 1);
    };
    const remove = (r) => {
      if (!window.confirm(`Delete the re-assessment from ${fmt(r.date)}?`)) return;
      S.deleteAssessment(r.id);
      if (openId === r.id) setOpenId(null);
      bump((x) => x + 1);
    };
    const silence = () => { S.updateAthlete(athlete.id, { reassessSilencedUntil: window.ReassessRules.silenceUntil(st, localDay()) }); bump((x) => x + 1); };
    const unsilence = () => { S.updateAthlete(athlete.id, { reassessSilencedUntil: "" }); bump((x) => x + 1); };

    let statusLine = null;
    if (!st || st.state === "assess") {
      statusLine = <span>{st && st.reason === "old" ? `The last full assessment was ${fmt(st.full.date)}, more than 8 months ago, so a full assessment is due. ` : "Re-assessments follow a full biomechanical assessment, and there isn't one on file yet. "}<button className="btn-link" onClick={() => onOpenTab && onOpenTab("assessment")}>Go to Biomechanical</button></span>;
    } else {
      const dueText = st.daysUntil < 0 ? `was due ${fmtShort(st.due)} (${-st.daysUntil} day${st.daysUntil === -1 ? "" : "s"} ago)` : st.daysUntil === 0 ? "is due today" : `is due ${fmtShort(st.due)}`;
      statusLine = (
        <span>
          Full assessment {fmt(base.date)}{st.lastReassess ? ` · last re-assessment ${fmt(st.lastReassess.date)}` : ""} · next re-assessment {dueText}.
          {st.state === "silenced"
            ? <React.Fragment> <span className="ra-silenced">Flag silenced until {fmtShort(st.silencedUntil)}</span> <button className="btn-link" onClick={unsilence}>Turn it back on</button></React.Fragment>
            : (st.state === "reassess-due" || st.state === "reassess-soon") && <React.Fragment> <button className="btn-link" title="Skip this re-assessment: the flag comes back for the next one" onClick={silence}>Silence this flag</button></React.Fragment>}
        </span>
      );
    }

    return (
      <React.Fragment>
        <div className="panel ra-panel">
          <h2>Re-Assessment <small>monthly: retest what was found, plus all performance tests and a full body comp</small></h2>
          <div className="ra-status">{statusLine}</div>
          {base && !open && <button className="btn btn-assign" onClick={startNew}>+ New re-assessment</button>}
          {open && (
            <React.Fragment>
              <div className="ra-open-bar"><button className="btn-link" onClick={() => setOpenId(null)}>‹ All re-assessments</button></div>
              <ReassessForm
                key={open.id}
                athlete={athlete}
                record={open}
                base={fulls.find((f) => f.id === open.baseId) || base}
                earlier={reassess.filter((r) => r.id !== open.id && (!base || r.date >= base.date) && (r.date < open.date || (r.date === open.date && r.id < open.id)))}
                onSave={(r) => { S.saveAssessment(r); }}
                onOpenTab={onOpenTab}
              />
            </React.Fragment>
          )}
          {!open && reassess.length > 0 && (
            <table className="ra-list">
              <thead><tr><th>Date</th><th>Retested</th><th>Results</th><th></th></tr></thead>
              <tbody>
                {[...reassess].reverse().map((r) => {
                  const tally = RESULTS.map(([k, l]) => [l, (r.items || []).filter((x) => x.result === k).length]).filter(([, n]) => n).map(([l, n]) => `${n} ${l.toLowerCase()}`).join(" · ");
                  return (
                    <tr key={r.id}>
                      <td><button className="btn-link" onClick={() => setOpenId(r.id)}>{fmt(r.date)}</button></td>
                      <td>{(r.items || []).length} item{(r.items || []).length === 1 ? "" : "s"}</td>
                      <td>{tally || "—"}</td>
                      <td className="ra-list-actions"><button className="btn-link" onClick={() => setOpenId(r.id)}>Open</button> <button className="btn-link" onClick={() => remove(r)}>Delete</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {!open && base && <ItemHistory base={base} reassess={after} />}
        </div>
        <AssessmentTrends athleteId={athlete.id} />
      </React.Fragment>
    );
  }

  // every item ever on a re-assessment since the full assessment, month by month, until it cleared
  function ItemHistory({ base, reassess }) {
    if (!reassess.length) return null;
    const paths = [];
    catalog().forEach((it) => { if (flagged(it, fromFull(it, base))) paths.push(it.path); });
    reassess.forEach((r) => (r.items || []).forEach((x) => { if (!paths.includes(x.path)) paths.push(x.path); }));
    const label = { cleared: "Cleared", improved: "Improved", same: "No change", worse: "Worse" };
    return (
      <div className="ra-history">
        <h3>Item by item <small>since the full assessment on {fmt(base.date)}</small></h3>
        <div className="ra-history-scroll">
          <table>
            <thead><tr><th>Item</th><th>Full assessment</th>{reassess.map((r) => <th key={r.id}>{fmt(r.date)}</th>)}</tr></thead>
            <tbody>
              {paths.map((p) => {
                const it = itemOf(p);
                if (!it) return null;
                let gone = false;
                return (
                  <tr key={p}>
                    <td>{it.label}{it.note ? <small> {it.note}</small> : null}</td>
                    <td>{describe(it, fromFull(it, base)) || "—"}</td>
                    {reassess.map((r) => {
                      if (gone) return <td key={r.id} className="ra-h-gone"></td>;
                      const x = (r.items || []).find((y) => y.path === p);
                      if (!x) return <td key={r.id} className="ra-h-none">—</td>;
                      if (x.result === "cleared") gone = true;
                      const v = (r.values || {})[p];
                      return <td key={r.id} className={x.result ? `ra-h-${x.result}` : ""}>{x.result ? label[x.result] : "not retested"}{entered(it, v) && describe(it, v) ? <small> {describe(it, v)}</small> : null}</td>;
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  window.ReassessmentTab = ReassessmentTab;
})();
