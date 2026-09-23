// Movement/Physical Assessment — a digital version of the "New Assessment" paper form (shared by
// Hayden Letts), so a coach can type results in during the session instead of handwriting them.
// Lives as its own tab on the player profile (window.AssessmentTab). An athlete can have several
// dated assessments over time; each one is a single record covering every section of the paper form.
// Printing/exporting matches the original paper form: a single landscape sheet with the two
// columns side by side, each scaled independently to make full use of its half of the page
// (see preparePrint in AssessmentTab below).
(function () {
  const { useState, useRef, useEffect } = React;

  const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const todayKey = () => new Date().toISOString().slice(0, 10);

  // ---- field layouts (drive both the editable form and the read-only/print view) --------------
  const MOVEMENT_TESTS = [
    { key: "overheadSquat", label: "Overhead Squat" },
    { key: "singleLegBalance", label: "Single-Leg Balance", note: "L/R, 10sec open/closed" },
    { key: "overheadReach", label: "Overhead Reach", note: "L/R" },
    { key: "spinalFlexion", label: "Spinal Flexion", checkbox: true },
    { key: "spinalExtension", label: "Spinal Extension", checkbox: true },
    { key: "apleyScratchTest", label: "Apley Scratch Test", note: "L/R" },
    { key: "pushUp", label: "Push-Up", checkbox: true },
    { key: "seatedThoracicRotation", label: "Seated Thoracic Rotation", note: "L/R" },
    { key: "modifiedThomasTest", label: "Modified Thomas Test", note: "L/R" },
    { key: "activeStraightLegRaise", label: "Active Straight Leg Raise", note: "L/R" },
    { key: "proneHipExtension", label: "Prone Hip Extension", note: "L/R" },
  ];

  const ISOLATED_SPECIFIC = [
    { key: "hipErSupine", label: "Hip ER", note: "supine, > 50°" },
    { key: "hipIrSupine", label: "Hip IR", note: "supine, > 40°" },
    { key: "hipErProne", label: "Hip ER", note: "prone, > supine ROM" },
    { key: "hipIrProne", label: "Hip IR", note: "prone, > supine ROM" },
    { key: "hipAbd", label: "Hip Abd", note: "ROM >45°, Manual Strength" },
    { key: "hipAdd", label: "Hip Add", note: "Manual Strength" },
    { key: "hamstringLength9090", label: "Hamstring Length", note: "90/90, < 20° flexion" },
    { key: "hamstringLengthPslr", label: "Hamstring Length", note: "pSLR, > 45°" },
    { key: "shoulderErRom", label: "Shoulder ER ROM", note: "90/90, > 90° + L/R diff" },
    { key: "shoulderIrRom", label: "Shoulder IR ROM", note: "90/90, > 45° + 180° total" },
    { key: "elbowExtRom", label: "Elbow Extension ROM", note: "supine, < 5-8°" },
    { key: "elbowFlexRom", label: "Elbow Flexion ROM", note: "supine, > 130°" },
    { key: "shoulderFlexRom", label: "Shoulder Flexion ROM", note: "seated, > 170°" },
    { key: "shoulderImpingement", label: "Shoulder Impingement", checkboxOnly: true },
    { key: "ankleDorsiflexion", label: "Ankle Dorsiflexion", note: "HK, > 4\"" },
  ];

  // Each finding is its own clickable toggle button (multiple can be active per row); a finding
  // that had a "(R/L)" etc. qualifier in the paper form gets its own set of toggle buttons too,
  // spelled out as Right/Left rather than the abbreviation.
  const BODY_REGIONS = [
    { key: "headNeck", label: "Head/Neck", options: [
      { label: "Forward" },
      { label: "Tilted" },
    ] },
    { key: "shoulder", label: "Shoulder", options: [
      { label: "Rounded" },
      { label: "Rotated", qualifiers: ["IR", "ER"] },
    ] },
    { key: "scapula", label: "Scapula", options: [
      { label: "Tilt", qualifiers: ["Right", "Left"] },
      { label: "Elevated", qualifiers: ["Right", "Left"] },
      { label: "Depressed", qualifiers: ["Right", "Left"] },
    ] },
    { key: "thoracic", label: "Thoracic", options: [
      { label: "Kyphotic" }, { label: "Flat" }, { label: "Rotated", qualifiers: ["Right", "Left"] },
    ] },
    { key: "ribCage", label: "Rib Cage", options: [
      { label: "Flared" }, { label: "Rotated", qualifiers: ["Right", "Left"] },
    ] },
    { key: "lumbar", label: "Lumbar", options: [
      { label: "Lordotic" }, { label: "Flat" },
    ] },
    { key: "pelvis", label: "Pelvis", options: [
      { label: "Tilt", qualifiers: ["Ant", "Post"] },
      { label: "Elevated", qualifiers: ["Right", "Left"] },
    ] },
    { key: "hip", label: "Hip", options: [
      { label: "Flexed" }, { label: "Extended" },
    ] },
    { key: "knee", label: "Knee", options: [
      { label: "Valgus" }, { label: "Varus" }, { label: "Flex" }, { label: "Hyperext" },
    ] },
    { key: "footAnkle", label: "Foot/Ankle", options: [
      { label: "Pron" }, { label: "Sup" }, { label: "Inver" }, { label: "Ever" },
    ] },
  ];

  const SQUAT_ANKLE_ROWS = [
    { key: "eversionPronation", label: "Eversion (Pronation)" },
    { key: "externalRotation", label: "External Rotation" },
    { key: "toeExtension", label: "Toe Extension" },
  ];
  const SQUAT_KNEE_ROWS = [
    { key: "adduction", label: "Adduction" },
    { key: "femoralIntRotation", label: "Femoral Int Rotation" },
    { key: "lateralDeviation", label: "Lateral Deviation" },
  ];
  const SQUAT_PELVIS_ROWS = [
    { key: "frontalPlaneWeightShift", label: "Frontal Plane Weight Shift" },
    { key: "rotationalWeightShift", label: "Rotational Weight Shift" },
  ];
  const SCORE_OPTIONS = ["Good", "Fair", "Poor"];

  const PERFORMANCE_TESTING = [
    { key: "hhdGrip", label: "HHD Grip" },
    { key: "hhd9090Er", label: "HHD 90/90 ER" },
    { key: "hhd9090Ir", label: "HHD 90/90 IR" },
    { key: "hhdErNeutral", label: "HHD ER Neutral" },
    { key: "hhdScaption", label: "HHD Scaption" },
    { key: "cmj", label: "CMJ", single: true },
    { key: "sj", label: "SJ", single: true },
    { key: "multiRebound", label: "Multi-rebound" },
    { key: "test505Cod", label: "505 COD Test" },
    { key: "tenYdStart", label: "10yd Start", single: true },
    { key: "flying5", label: "Flying 5", note: "(20-25yd)", single: true },
  ];

  // ---- record shape --------------------------------------------------------------------------
  // "Dual check" fields replace a blank fill-in spot for the ankle/x-mark convention used on the
  // paper form: one mark means a finding is present, two means it needs correction.
  const emptyDual = () => ({ c1: false, c2: false });
  const emptyLR = () => ({ left: "", right: "", notes: "" });
  const emptyPF = () => ({ pass: "", fail: "", notes: "", check: emptyDual() });
  const emptyLRDual = () => ({ left: emptyDual(), right: emptyDual() });
  // Isolated + Specific keeps its open number/ROM entry, plus an optional dual-check per side.
  const emptyIsolated = () => ({ left: "", right: "", leftCheck: emptyDual(), rightCheck: emptyDual(), notes: "" });

  // A stray "L/R" from before the Pass/Fail columns became a dropdown reads the same as "L & R".
  const normalizePF = (v) => (v === "L/R" ? "L & R" : v || "");

  function newAssessment(athleteId) {
    const byKey = (list, factory) => { const o = {}; list.forEach((r) => { o[r.key] = factory(); }); return o; };
    return {
      id: uid(),
      athleteId,
      date: todayKey(),
      coach: "",
      visualNotes: "",
      // Click-to-mark dots on each body diagram view — { x, y } as a percent of the image, so
      // marks stay put regardless of how big the diagram renders (on screen vs. scaled for print).
      bodyMarkers: { front: [], "side-right": [], "side-left": [], back: [] },
      bodyRegions: byKey(BODY_REGIONS, () => ({ flagged: false, notes: "", tags: {} })),
      movementTests: byKey(MOVEMENT_TESTS, emptyPF),
      isolatedSpecific: byKey(ISOLATED_SPECIFIC, emptyIsolated),
      squat: {
        ankle: byKey(SQUAT_ANKLE_ROWS, emptyLRDual),
        knee: byKey(SQUAT_KNEE_ROWS, emptyLRDual),
        pelvis: { ...byKey(SQUAT_PELVIS_ROWS, emptyLRDual), depthEarly: false, depthAfter90: false },
        upperBody: { lordosis: emptyDual(), forwardHead: emptyDual(), barDriftForward: emptyDual(), barDriftBack: emptyDual(), score: "" },
      },
      keyTakeawaysAttention: "",
      keyTakeawaysNoted: "",
      performanceTesting: byKey(PERFORMANCE_TESTING, emptyLR),
    };
  }

  // The old combined Key Takeaways field read "Needs attention:\n- ...\n\nNoted:\n- ...", produced
  // by the pre-split generateFindingsSummary. Recognizes exactly that shape and pulls the two
  // sections apart; anything else (a coach's own free-form text) is left alone so it isn't
  // mistakenly torn apart.
  function splitLegacyTakeaways(text) {
    const t = text || "";
    if (!/^\s*needs attention:/i.test(t) || !/\n\s*noted:/i.test(t)) return null;
    const attMatch = t.match(/needs attention:\s*\n([\s\S]*?)(?=\n\s*noted:\s*\n|$)/i);
    const notedMatch = t.match(/noted:\s*\n([\s\S]*)$/i);
    return {
      attention: attMatch ? attMatch[1].trim() : "",
      noted: notedMatch ? notedMatch[1].trim() : "",
    };
  }

  // Fills in any section a record made before a field layout change is missing, so old
  // assessments keep working after this file is updated.
  function withDefaults(record, athleteId) {
    const blank = newAssessment(athleteId);
    const mergeByKey = (list, saved, factory) => { const o = {}; list.forEach((r) => { o[r.key] = { ...factory(), ...(saved && saved[r.key]) }; }); return o; };
    const mergedMovementTests = mergeByKey(MOVEMENT_TESTS, record.movementTests, emptyPF);
    Object.keys(mergedMovementTests).forEach((k) => {
      mergedMovementTests[k].pass = normalizePF(mergedMovementTests[k].pass);
      mergedMovementTests[k].fail = normalizePF(mergedMovementTests[k].fail);
    });
    // The Key Takeaways box used to be one combined field before it split into side-by-side Needs
    // Attention / Noted columns. Pull whichever text an older (or already-once-migrated) record has
    // into the Noted side by default, then split it apart if it's still in the old combined shape —
    // covers both a record from before the split ever existed and one saved right after the split
    // shipped, before this parser did.
    let keyTakeawaysAttention = record.keyTakeawaysAttention !== undefined ? record.keyTakeawaysAttention : "";
    let keyTakeawaysNoted = record.keyTakeawaysNoted !== undefined ? record.keyTakeawaysNoted : (record.keyTakeaways || "");
    if (!keyTakeawaysAttention.trim()) {
      const split = splitLegacyTakeaways(keyTakeawaysNoted);
      if (split) { keyTakeawaysAttention = split.attention; keyTakeawaysNoted = split.noted; }
    }
    return {
      ...blank,
      ...record,
      keyTakeawaysAttention,
      keyTakeawaysNoted,
      bodyMarkers: { ...blank.bodyMarkers, ...(record.bodyMarkers || {}) },
      bodyRegions: mergeByKey(BODY_REGIONS, record.bodyRegions, () => ({ flagged: false, notes: "", tags: {} })),
      movementTests: mergedMovementTests,
      isolatedSpecific: mergeByKey(ISOLATED_SPECIFIC, record.isolatedSpecific, emptyIsolated),
      squat: {
        ankle: mergeByKey(SQUAT_ANKLE_ROWS, record.squat && record.squat.ankle, emptyLRDual),
        knee: mergeByKey(SQUAT_KNEE_ROWS, record.squat && record.squat.knee, emptyLRDual),
        pelvis: { ...blank.squat.pelvis, ...(record.squat && record.squat.pelvis) },
        upperBody: { ...blank.squat.upperBody, ...(record.squat && record.squat.upperBody) },
      },
      performanceTesting: mergeByKey(PERFORMANCE_TESTING, record.performanceTesting, emptyLR),
    };
  }

  function fmtDate(key) {
    if (!key) return "";
    const d = new Date(`${key}T00:00:00`);
    if (isNaN(d.getTime())) return key;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }

  // ---- auto-drafting Key Takeaways from whatever's been checked/typed elsewhere ----------------
  // A dual-check's meaning is already "1 mark = noted, 2 marks = needs correction" everywhere it's
  // used, so reading it back out the same way is what makes this summary meaningful rather than
  // just restating raw data.
  function dualStatus(v) {
    if (!v || typeof v !== "object") return null;
    if (v.c2) return "attention";
    if (v.c1) return "noted";
    return null;
  }

  function summarizeBodyRegions(rec) {
    const lines = [];
    BODY_REGIONS.forEach((r) => {
      const state = rec.bodyRegions[r.key];
      if (!state) return;
      const tags = state.tags || {};
      const selected = [];
      r.options.forEach((o) => {
        if (tags[o.label]) selected.push(o.label);
        (o.qualifiers || []).forEach((q) => { if (tags[`${o.label}::${q}`]) selected.push(q); });
      });
      if (state.flagged || selected.length) {
        lines.push(`${r.label}${selected.length ? " — " + selected.join(", ") : " flagged"}`);
      }
    });
    return lines;
  }

  function summarizeSquat(rec) {
    const noted = [];
    const attention = [];
    const push = (label, side, v) => {
      const s = dualStatus(v);
      const suffix = side ? ` (${side})` : "";
      if (s === "attention") attention.push(`${label}${suffix}`);
      else if (s === "noted") noted.push(`${label}${suffix}`);
    };
    SQUAT_ANKLE_ROWS.forEach((r) => {
      push(`Ankle — ${r.label}`, "L", rec.squat.ankle[r.key].left);
      push(`Ankle — ${r.label}`, "R", rec.squat.ankle[r.key].right);
    });
    SQUAT_KNEE_ROWS.forEach((r) => {
      push(`Knee — ${r.label}`, "L", rec.squat.knee[r.key].left);
      push(`Knee — ${r.label}`, "R", rec.squat.knee[r.key].right);
    });
    SQUAT_PELVIS_ROWS.forEach((r) => {
      push(`Pelvis — ${r.label}`, "L", rec.squat.pelvis[r.key].left);
      push(`Pelvis — ${r.label}`, "R", rec.squat.pelvis[r.key].right);
    });
    if (rec.squat.pelvis.depthEarly === true) noted.push("Pelvic Tilt — Early");
    if (rec.squat.pelvis.depthAfter90 === true) noted.push("Pelvic Tilt — After 90");
    push("Upper Body — Lordosis", "", rec.squat.upperBody.lordosis);
    push("Upper Body — Forward Head", "", rec.squat.upperBody.forwardHead);
    push("Upper Body — Bar Drift", "Forward", rec.squat.upperBody.barDriftForward);
    push("Upper Body — Bar Drift", "Back", rec.squat.upperBody.barDriftBack);
    if (rec.squat.upperBody.score === "Poor") attention.push("Upper Body Score: Poor");
    else if (rec.squat.upperBody.score === "Fair") noted.push("Upper Body Score: Fair");
    return { noted, attention };
  }

  function summarizeMovementTests(rec) {
    const noted = [];
    const attention = [];
    MOVEMENT_TESTS.forEach((r) => {
      const v = rec.movementTests[r.key];
      if (!v) return;
      if (r.checkbox) {
        const s = dualStatus(v.check);
        if (s === "attention") attention.push(r.label);
        else if (s === "noted") noted.push(r.label);
      } else if (v.fail) {
        attention.push(`${r.label} — Fail (${v.fail})`);
      }
    });
    return { noted, attention };
  }

  function summarizeIsolated(rec) {
    const noted = [];
    const attention = [];
    ISOLATED_SPECIFIC.forEach((r) => {
      const v = rec.isolatedSpecific[r.key];
      if (!v) return;
      if (r.checkboxOnly) {
        // A positive impingement sign (or similar) is itself the finding — treat it as something
        // to act on rather than just a note.
        if (v.leftCheck && v.leftCheck.c1 === true) attention.push(`${r.label} (L)`);
        if (v.rightCheck && v.rightCheck.c1 === true) attention.push(`${r.label} (R)`);
        return;
      }
      const sL = dualStatus(v.leftCheck);
      const sR = dualStatus(v.rightCheck);
      if (sL === "attention") attention.push(`${r.label} (L)`);
      else if (sL === "noted") noted.push(`${r.label} (L)`);
      if (sR === "attention") attention.push(`${r.label} (R)`);
      else if (sR === "noted") noted.push(`${r.label} (R)`);
    });
    return { noted, attention };
  }

  // Pulls together whatever's currently checked/flagged across the whole form into a "needs
  // attention" / "noted" draft — meant to be a starting point the coach edits from, not a final
  // summary, so it's only ever inserted on request (see the Key Takeaways panel's button) rather
  // than silently rewriting whatever they've already typed.
  function generateFindingsSummary(rec) {
    const squat = summarizeSquat(rec);
    const move = summarizeMovementTests(rec);
    const iso = summarizeIsolated(rec);
    const attention = [...squat.attention, ...move.attention, ...iso.attention];
    const noted = [...summarizeBodyRegions(rec), ...squat.noted, ...move.noted, ...iso.noted];
    return {
      attention: attention.length ? attention.map((l) => `- ${l}`).join("\n") : "",
      noted: noted.length ? noted.map((l) => `- ${l}`).join("\n") : "",
    };
  }

  // ---- small form controls ---------------------------------------------------------------------
  function Cell({ value, onChange, placeholder, width }) {
    return (
      <React.Fragment>
        <input
          className="assess-cell"
          style={width ? { width } : undefined}
          value={value || ""}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
        {/* Print-only stand-in for the input above — a single-line box clips long notes, so print
            shows the same value as a wrapping block instead, sized to the module (see
            .assess-cell-print / .print-paginated), the same swap-for-print trick already used for
            checkboxes, the Pass/Fail select, and the body-region tags. */}
        <span className="assess-cell-print">{value || " "}</span>
      </React.Fragment>
    );
  }

  // A textarea that starts small (like a normal notes field) and grows to fit what's typed,
  // instead of either clipping long text or reserving a big fixed block up front.
  function AutoGrowTextarea({ value, onChange, rows, placeholder, className }) {
    const ref = useRef(null);
    useEffect(() => {
      const el = ref.current;
      if (!el) return;
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }, [value]);
    return (
      <textarea
        ref={ref}
        rows={rows}
        placeholder={placeholder}
        className={`assess-autogrow ${className || ""}`}
        value={value}
        onChange={onChange}
      />
    );
  }

  // Replaces an open typing spot with the paper form's check/x convention: one mark means a
  // finding is present, two means it needs correction. Two independent checkboxes so a coach can
  // tick one now and come back to add the second if it turns out to need correction. On screen
  // that's real checkboxes; on paper it prints as a plain ✓ / ✓✓ mark instead — at the heavy
  // scale-down needed to fit this form on one page, browsers floor how small a native checkbox can
  // render, and with dozens of them on the page that floor alone was enough to push it to a second
  // page, so print gets a simple text mark instead (same trick as the Good/Fair/Poor ScoreToggle).
  function DualCheck({ value, onChange, title }) {
    const v = value && typeof value === "object" ? value : emptyDual();
    const count = (v.c1 ? 1 : 0) + (v.c2 ? 1 : 0);
    return (
      <React.Fragment>
        {/* No "no-print" here on purpose: that class also hides content during the pre-print
            height *measurement* pass, which would under-count real height and defeat the
            one-page fit. Screen vs. print is switched in CSS, scoped to the print media query. */}
        <div className="assess-dualcheck" title={title || "One check = noted, two checks = needs correction"}>
          <input type="checkbox" checked={!!v.c1} onChange={(e) => onChange({ ...v, c1: e.target.checked })} />
          <input type="checkbox" checked={!!v.c2} onChange={(e) => onChange({ ...v, c2: e.target.checked })} />
        </div>
        <span className={`assess-dualcheck-mark print-only${count ? " assess-mark-set" : ""}`}>{count === 2 ? "✓✓" : count === 1 ? "✓" : "—"}</span>
      </React.Fragment>
    );
  }

  // Same screen-vs-print split as DualCheck: a native <select> hits the same browser-enforced
  // minimum render size at this page's heavy scale-down, so print shows its value as plain text.
  function LRSelect({ value, onChange, variant }) {
    const variantClass = variant ? ` assess-lrselect-${variant}` : "";
    return (
      <React.Fragment>
        <select className={`assess-cell assess-lrselect${variantClass}`} value={value || ""} onChange={(e) => onChange(e.target.value)}>
          <option value=""></option>
          <option value="L">L</option>
          <option value="R">R</option>
          <option value="L & R">L & R</option>
        </select>
        <span className={`assess-lrselect-print${variantClass} print-only${value ? " assess-mark-set" : ""}`}>{value || "—"}</span>
      </React.Fragment>
    );
  }

  // A row of toggle buttons for a body region's findings — the paper form's "pick whichever
  // apply, slash-separated" list becomes individually clickable pills, multiple selectable at
  // once. A finding with its own qualifier (e.g. Tilted -> Right/Left) gets its own small set of
  // pills right after it, independently toggleable. `tags` is a flat map keyed by the option's
  // label, or "OptionLabel::QualifierLabel" for a qualifier pill.
  function TagRow({ options, tags, onToggle }) {
    const selected = [];
    options.forEach((o) => {
      if (tags[o.label]) selected.push(o.label);
      (o.qualifiers || []).forEach((q) => { if (tags[`${o.label}::${q}`]) selected.push(q); });
    });
    return (
      <React.Fragment>
        <div className="assess-tagrow">
          {options.map((o) => (
            <React.Fragment key={o.label}>
              <button type="button" className={`assess-tag ${tags[o.label] ? "active" : ""}`} onClick={() => onToggle(o.label)}>{o.label}</button>
              {(o.qualifiers || []).map((q) => (
                <button key={q} type="button" className={`assess-tag assess-tag-qualifier ${tags[`${o.label}::${q}`] ? "active" : ""}`} onClick={() => onToggle(`${o.label}::${q}`)}>{q}</button>
              ))}
            </React.Fragment>
          ))}
        </div>
        <span className={`assess-tagrow-print print-only${selected.length ? " assess-mark-set" : ""}`}>{selected.length ? selected.join(", ") : "—"}</span>
      </React.Fragment>
    );
  }

  // One half of the Performance Testing table (it's rendered twice, side by side, so 10 rows
  // read as two even columns of 5 instead of one long list).
  function PerformanceTable({ rows, rec, set }) {
    return (
      <table className="assess-table">
        <thead><tr><th>Performance Testing</th><th style={{ width: 56 }}>Left</th><th style={{ width: 56 }}>Right</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td>{r.label}{r.note && <div className="assess-row-note">{r.note}</div>}</td>
              {r.single ? (
                <td colSpan={2}><Cell width="100%" value={rec.performanceTesting[r.key].left} onChange={(v) => set(["performanceTesting", r.key, "left"], v)} /></td>
              ) : (
                <React.Fragment>
                  <td><Cell width="100%" value={rec.performanceTesting[r.key].left} onChange={(v) => set(["performanceTesting", r.key, "left"], v)} /></td>
                  <td><Cell width="100%" value={rec.performanceTesting[r.key].right} onChange={(v) => set(["performanceTesting", r.key, "right"], v)} /></td>
                </React.Fragment>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  // Who created this assessment and who last touched it, stamped server-side by Supabase (see
  // supabase/migration_002_activity_tracking.sql) — a signature line, not shown at all for
  // assessments saved before that migration ran (no _activity) or while working offline.
  function AssessmentSignature({ activity }) {
    if (!activity || (!activity.createdBy && !activity.updatedBy)) return null;
    const fmt = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "");
    const parts = [];
    if (activity.createdBy) parts.push(`Created by ${activity.createdBy}${activity.createdAt ? ` on ${fmt(activity.createdAt)}` : ""}`);
    if (activity.updatedBy && activity.updatedAt !== activity.createdAt) {
      parts.push(`Last updated by ${activity.updatedBy}${activity.updatedAt ? ` on ${fmt(activity.updatedAt)}` : ""}`);
    }
    return <p className="activity-signature no-print">{parts.join(" · ")}</p>;
  }

  function ScoreToggle({ value, onChange }) {
    return (
      <div className="assess-score-toggle no-print">
        {SCORE_OPTIONS.map((o) => (
          <button key={o} className={`pill-tab ${value === o ? "active" : ""}`} onClick={() => onChange(value === o ? "" : o)}>{o}</button>
        ))}
      </div>
    );
  }

  // Reference silhouettes for the paper form's four views — cropped directly from the actual
  // "New Assessment" sheet (Hayden Letts shared a screenshot of the diagram row), not to scale,
  // just enough to note left/right findings against. Click a spot on the diagram to circle it
  // (e.g. click the ankle to flag the ankle); click an existing circle again to remove it. Marks
  // are stored as percent-of-image coordinates so they stay put at any render size, print included.
  const BODY_OUTLINE_SRC = {
    front: "assets/body-front.png",
    "side-right": "assets/body-side-right.png",
    "side-left": "assets/body-side-left.png",
    back: "assets/body-back.png",
  };
  const BODY_MARKER_HIT_PCT = 6; // clicking within this % radius of an existing mark removes it instead

  function BodyOutline({ label, view, marks, onChange }) {
    const imgRef = useRef(null);
    const handleClick = (e) => {
      const el = imgRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;
      const hitIdx = (marks || []).findIndex((m) => Math.hypot(m.x - x, m.y - y) < BODY_MARKER_HIT_PCT);
      if (hitIdx !== -1) onChange(marks.filter((_, i) => i !== hitIdx));
      else onChange([...(marks || []), { x, y }]);
    };
    return (
      <div className="assess-body-outline">
        <div className="assess-body-imgwrap" onClick={handleClick} title="Click to circle a spot; click a circle to remove it">
          <img ref={imgRef} src={BODY_OUTLINE_SRC[view]} alt={`${label} body outline`} className="assess-body-img" draggable={false} />
          {(marks || []).map((m, i) => (
            <span key={i} className="assess-body-marker" style={{ left: `${m.x}%`, top: `${m.y}%` }} />
          ))}
        </div>
        <div className="assess-body-outline-label">{label}</div>
      </div>
    );
  }

  // ---- the editable form for one assessment record --------------------------------------------
  // Owns its own state (seeded from the `record` prop) so a burst of edits — e.g. ticking a
  // checkbox and typing in the next field right after — always builds on the true latest value via
  // the functional setState form, rather than risking two edits both starting from the same
  // not-yet-rerendered prop and one clobbering the other. The parent remounts this (via `key`)
  // when the selected assessment changes, and receives saves through `onSave`, debounced.
  function AssessmentForm({ record, athlete, onSave }) {
    const [rec, setRec] = useState(record);
    const saveTimer = useRef(null);
    // Whichever section was clicked into most recently gets a gold outline, so it's obvious at a
    // glance which part of the form you're working in — event delegation on the outer wrapper
    // instead of a handler per panel, since which one lit up is just "closest data-panel ancestor
    // of whatever was clicked."
    const [activePanel, setActivePanel] = useState(null);
    const handleFormClick = (e) => {
      const panel = e.target.closest("[data-panel]");
      if (panel) setActivePanel(panel.getAttribute("data-panel"));
    };
    const panelClass = (name) => `panel${activePanel === name ? " assess-panel-active" : ""}`;

    // Team logo + athlete photo in the header, same idea as the Player Plan's header (PlanHeader in
    // periodization.js) — reuses its .ph-* classes/component so both features look consistent.
    const [photoBroken, setPhotoBroken] = useState(false);
    const initials = athlete.name.split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
    const showPhoto = !!athlete.photoUrl && !photoBroken;
    const Logo = typeof TeamLogo === "function" ? TeamLogo : null;

    useEffect(() => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => onSave(rec), 400);
      return () => clearTimeout(saveTimer.current);
      // eslint-disable-next-line
    }, [rec]);

    const set = (path, value) => {
      setRec((prev) => {
        const next = JSON.parse(JSON.stringify(prev));
        let obj = next;
        for (let i = 0; i < path.length - 1; i++) obj = obj[path[i]];
        obj[path[path.length - 1]] = value;
        return next;
      });
    };

    return (
      <div className="assess-form" onClick={handleFormClick}>
        <div className={`${panelClass("header")} assess-header`} data-panel="header">
          {/* Print-only — matches the original paper form's letterhead. Living inside the header
              panel (rather than as a floating footer) means its height is automatically included
              wherever this panel's own height gets measured for the print page-fit, no separate
              accounting needed. */}
          <div className="assess-print-logo"><img src="assets/dst-logo.png" alt="Dynamic Sports Training" /></div>
          <div className="assess-header-top">
            {/* Team logo + athlete photo, same idea (and .ph-* classes) as the Player Plan's header. */}
            <div className="ph-pics assess-header-pics">
              {athlete.team && Logo && <span className="ph-team"><Logo team={athlete.team} size={36} /></span>}
              {showPhoto ? (
                <img className="ph-photo assess-header-photo" src={athlete.photoUrl} alt={athlete.name} onError={() => setPhotoBroken(true)} />
              ) : (
                <div className="ph-photo assess-header-photo ph-initials">{initials}</div>
              )}
            </div>
            <div className="assess-header-grid">
              <div className="field"><label>Name</label><input value={athlete.name} disabled /></div>
              <div className="field"><label>Date</label><input type="date" value={rec.date} onChange={(e) => set(["date"], e.target.value)} /></div>
              <div className="field"><label>Coach</label><input value={rec.coach} placeholder="Coach name" onChange={(e) => set(["coach"], e.target.value)} /></div>
            </div>
          </div>
        </div>

        <div className="assess-columns">
          {/* ---- left column ---- */}
          <div className="assess-col">
            <div className={panelClass("visual")} data-panel="visual">
              <h2>Visual / Postural Assessment</h2>
              <div className="assess-outlines">
                <BodyOutline label="Front" view="front" marks={rec.bodyMarkers.front} onChange={(v) => set(["bodyMarkers", "front"], v)} />
                <BodyOutline label="Side" view="side-right" marks={rec.bodyMarkers["side-right"]} onChange={(v) => set(["bodyMarkers", "side-right"], v)} />
                <BodyOutline label="Side" view="side-left" marks={rec.bodyMarkers["side-left"]} onChange={(v) => set(["bodyMarkers", "side-left"], v)} />
                <BodyOutline label="Back" view="back" marks={rec.bodyMarkers.back} onChange={(v) => set(["bodyMarkers", "back"], v)} />
              </div>
              <div className="field no-print" style={{ marginTop: 10 }}>
                <label>Visual notes</label>
                <AutoGrowTextarea rows={2} value={rec.visualNotes} onChange={(e) => set(["visualNotes"], e.target.value)} />
              </div>
              {rec.visualNotes && <p className="assess-print-only-text print-only-block">{rec.visualNotes}</p>}

              <table className="assess-table" style={{ marginTop: 14 }}>
                <thead>
                  <tr><th>Body Region</th><th style={{ width: 46 }}>Flag</th><th>Positive + Negative Observations</th><th>Notes &amp; Comments</th></tr>
                </thead>
                <tbody>
                  {BODY_REGIONS.map((r) => {
                    const tags = rec.bodyRegions[r.key].tags || {};
                    return (
                      <tr key={r.key} className={rec.bodyRegions[r.key].flagged ? "assess-flagged" : ""}>
                        <td>{r.label}</td>
                        <td style={{ textAlign: "center" }}>
                          <input type="checkbox" checked={rec.bodyRegions[r.key].flagged} onChange={(e) => set(["bodyRegions", r.key, "flagged"], e.target.checked)} />
                        </td>
                        <td>
                          <TagRow options={r.options} tags={tags} onToggle={(tagKey) => set(["bodyRegions", r.key, "tags", tagKey], !tags[tagKey])} />
                        </td>
                        <td><Cell value={rec.bodyRegions[r.key].notes} onChange={(v) => set(["bodyRegions", r.key, "notes"], v)} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className={panelClass("squat")} data-panel="squat">
              <h2>Overhead Squat <small>joint-by-joint breakdown &mdash; 1 check = noted, 2 checks = needs correction</small></h2>
              {[["Ankle Joint", "ankle", SQUAT_ANKLE_ROWS], ["Knee Joint", "knee", SQUAT_KNEE_ROWS]].map(([title, sec, rows]) => (
                <div key={sec} className="assess-subsection">
                  <div className="assess-subhead">{title}</div>
                  {/* Findings side by side as columns, L/R as the two rows — reads left-to-right
                      like the paper form's row of checks, instead of stacking each finding. */}
                  <table className="assess-table assess-table-big assess-table-transposed">
                    <thead><tr><th>&nbsp;</th>{rows.map((r) => <th key={r.key}>{r.label}</th>)}</tr></thead>
                    <tbody>
                      <tr>
                        <td>L</td>
                        {rows.map((r) => (
                          <td key={r.key} style={{ textAlign: "center" }}><DualCheck value={rec.squat[sec][r.key].left} onChange={(v) => set(["squat", sec, r.key, "left"], v)} /></td>
                        ))}
                      </tr>
                      <tr>
                        <td>R</td>
                        {rows.map((r) => (
                          <td key={r.key} style={{ textAlign: "center" }}><DualCheck value={rec.squat[sec][r.key].right} onChange={(v) => set(["squat", sec, r.key, "right"], v)} /></td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
              ))}

              <div className="assess-subsection">
                <div className="assess-subhead">Pelvis</div>
                <table className="assess-table assess-table-big assess-table-transposed">
                  <thead>
                    <tr>
                      <th>&nbsp;</th>
                      {SQUAT_PELVIS_ROWS.map((r) => <th key={r.key}>{r.label}</th>)}
                      <th>Pelvic Tilt</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>L</td>
                      {SQUAT_PELVIS_ROWS.map((r) => (
                        <td key={r.key} style={{ textAlign: "center" }}><DualCheck value={rec.squat.pelvis[r.key].left} onChange={(v) => set(["squat", "pelvis", r.key, "left"], v)} /></td>
                      ))}
                      {/* Depth of Pelvic Tilt isn't a left/right finding — it spans both rows instead of
                          repeating, and both options (Early / After 90) share the one cell rather
                          than each getting their own column. Just one plain check per option
                          (present or not), not the noted/needs-correction dual-check the other
                          findings use. */}
                      <td rowSpan={2} style={{ textAlign: "center" }}>
                        <div className="assess-pelvic-tilt">
                          <label><input type="checkbox" checked={rec.squat.pelvis.depthEarly === true} onChange={(e) => set(["squat", "pelvis", "depthEarly"], e.target.checked)} /> Early</label>
                          <label><input type="checkbox" checked={rec.squat.pelvis.depthAfter90 === true} onChange={(e) => set(["squat", "pelvis", "depthAfter90"], e.target.checked)} /> After 90</label>
                        </div>
                      </td>
                    </tr>
                    <tr>
                      <td>R</td>
                      {SQUAT_PELVIS_ROWS.map((r) => (
                        <td key={r.key} style={{ textAlign: "center" }}><DualCheck value={rec.squat.pelvis[r.key].right} onChange={(v) => set(["squat", "pelvis", r.key, "right"], v)} /></td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="assess-subsection">
                <div className="assess-subhead">Upper Body</div>
                <table className="assess-table assess-table-big">
                  <thead><tr><th colSpan={2} style={{ width: "50%" }}>Standing (PVC Overhead)</th><th colSpan={2} style={{ width: "50%" }}>Bar Drift (Active)</th></tr>
                    <tr><th style={{ width: "25%" }}>Lordosis</th><th style={{ width: "25%" }}>Forward Head</th><th style={{ width: "25%" }}>Forward</th><th style={{ width: "25%" }}>Back</th></tr></thead>
                  <tbody>
                    <tr>
                      <td style={{ textAlign: "center" }}><DualCheck value={rec.squat.upperBody.lordosis} onChange={(v) => set(["squat", "upperBody", "lordosis"], v)} /></td>
                      <td style={{ textAlign: "center" }}><DualCheck value={rec.squat.upperBody.forwardHead} onChange={(v) => set(["squat", "upperBody", "forwardHead"], v)} /></td>
                      <td style={{ textAlign: "center" }}><DualCheck value={rec.squat.upperBody.barDriftForward} onChange={(v) => set(["squat", "upperBody", "barDriftForward"], v)} /></td>
                      <td style={{ textAlign: "center" }}><DualCheck value={rec.squat.upperBody.barDriftBack} onChange={(v) => set(["squat", "upperBody", "barDriftBack"], v)} /></td>
                    </tr>
                  </tbody>
                </table>
                <div className="assess-score-row">
                  <span>Score:</span>
                  <ScoreToggle value={rec.squat.upperBody.score} onChange={(v) => set(["squat", "upperBody", "score"], v)} />
                  <strong className="print-only">{rec.squat.upperBody.score || "—"}</strong>
                </div>
              </div>
            </div>

            <div className={panelClass("performance")} data-panel="performance">
              <h2>Performance Testing</h2>
              <div className="assess-perf-columns">
                <PerformanceTable rows={PERFORMANCE_TESTING.slice(0, 6)} rec={rec} set={set} />
                <PerformanceTable rows={PERFORMANCE_TESTING.slice(6)} rec={rec} set={set} />
              </div>
            </div>
          </div>

          {/* ---- right column ---- */}
          <div className="assess-col">
            <div className={panelClass("movement")} data-panel="movement">
              <h2>Movement Test</h2>
              <table className="assess-table">
                <thead><tr><th>Movement Test</th><th style={{ width: 74 }}>Pass</th><th style={{ width: 74 }}>Fail</th><th>Notes (Compensation, Pain, Limitation)</th></tr></thead>
                <tbody>
                  {MOVEMENT_TESTS.map((r) => (
                    <tr key={r.key}>
                      <td>{r.label}{r.note && <div className="assess-row-note">{r.note}</div>}</td>
                      {r.checkbox ? (
                        <td colSpan={2} style={{ textAlign: "center" }}><DualCheck value={rec.movementTests[r.key].check} onChange={(v) => set(["movementTests", r.key, "check"], v)} /></td>
                      ) : (
                        <React.Fragment>
                          <td><LRSelect variant="pass" value={rec.movementTests[r.key].pass} onChange={(v) => set(["movementTests", r.key, "pass"], v)} /></td>
                          <td><LRSelect variant="fail" value={rec.movementTests[r.key].fail} onChange={(v) => set(["movementTests", r.key, "fail"], v)} /></td>
                        </React.Fragment>
                      )}
                      <td><Cell width="100%" value={rec.movementTests[r.key].notes} onChange={(v) => set(["movementTests", r.key, "notes"], v)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className={panelClass("isolated")} data-panel="isolated">
              <h2>Isolated + Specific <small>type a measurement, or use the checks &mdash; 1 = noted, 2 = needs correction</small></h2>
              <table className="assess-table">
                <thead><tr><th>Isolated + Specific</th><th style={{ width: 74 }}>Left</th><th style={{ width: 74 }}>Right</th><th>Notes &amp; Observations</th></tr></thead>
                <tbody>
                  {ISOLATED_SPECIFIC.map((r) => (
                    <tr key={r.key}>
                      <td>{r.label}{r.note && <div className="assess-row-note">{r.note}</div>}</td>
                      {r.checkboxOnly ? (
                        <React.Fragment>
                          {/* Just present/not-present per side — no measurement to type in, and not
                              the noted/needs-correction dual-check the other rows use. */}
                          <td style={{ textAlign: "center" }}>
                            <input type="checkbox" checked={rec.isolatedSpecific[r.key].leftCheck.c1 === true} onChange={(e) => set(["isolatedSpecific", r.key, "leftCheck", "c1"], e.target.checked)} />
                          </td>
                          <td style={{ textAlign: "center" }}>
                            <input type="checkbox" checked={rec.isolatedSpecific[r.key].rightCheck.c1 === true} onChange={(e) => set(["isolatedSpecific", r.key, "rightCheck", "c1"], e.target.checked)} />
                          </td>
                        </React.Fragment>
                      ) : (
                        <React.Fragment>
                          <td>
                            <div className="assess-cell-stack">
                              <Cell width="100%" value={rec.isolatedSpecific[r.key].left} onChange={(v) => set(["isolatedSpecific", r.key, "left"], v)} />
                              <DualCheck value={rec.isolatedSpecific[r.key].leftCheck} onChange={(v) => set(["isolatedSpecific", r.key, "leftCheck"], v)} />
                            </div>
                          </td>
                          <td>
                            <div className="assess-cell-stack">
                              <Cell width="100%" value={rec.isolatedSpecific[r.key].right} onChange={(v) => set(["isolatedSpecific", r.key, "right"], v)} />
                              <DualCheck value={rec.isolatedSpecific[r.key].rightCheck} onChange={(v) => set(["isolatedSpecific", r.key, "rightCheck"], v)} />
                            </div>
                          </td>
                        </React.Fragment>
                      )}
                      <td><Cell width="100%" value={rec.isolatedSpecific[r.key].notes} onChange={(v) => set(["isolatedSpecific", r.key, "notes"], v)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className={panelClass("takeaways")} data-panel="takeaways">
              <h2>Key Takeaways &amp; Critical Areas of Focus</h2>
              <div className="field no-print" style={{ marginBottom: 8 }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    const summary = generateFindingsSummary(rec);
                    if (!summary.attention && !summary.noted) { window.alert("Nothing checked or flagged yet to summarize — fill in some findings first."); return; }
                    if (summary.attention) {
                      const existing = (rec.keyTakeawaysAttention || "").trim();
                      set(["keyTakeawaysAttention"], existing ? `${existing}\n${summary.attention}` : summary.attention);
                    }
                    if (summary.noted) {
                      const existing = (rec.keyTakeawaysNoted || "").trim();
                      set(["keyTakeawaysNoted"], existing ? `${existing}\n${summary.noted}` : summary.noted);
                    }
                  }}
                >
                  Auto-fill from findings
                </button>
                <div className="assess-row-note" style={{ marginTop: 4 }}>Drafts a summary from what's checked/flagged elsewhere in the form — added below anything already here, so nothing gets overwritten. Edit or delete freely after.</div>
              </div>
              <div className="assess-perf-columns">
                <div className="field">
                  <label>Needs Attention</label>
                  <AutoGrowTextarea
                    rows={2}
                    placeholder="Findings that need correction or follow-up..."
                    value={rec.keyTakeawaysAttention}
                    onChange={(e) => set(["keyTakeawaysAttention"], e.target.value)}
                  />
                </div>
                <div className="field">
                  <label>Noted</label>
                  <AutoGrowTextarea
                    rows={2}
                    placeholder="Findings worth keeping an eye on..."
                    value={rec.keyTakeawaysNoted}
                    onChange={(e) => set(["keyTakeawaysNoted"], e.target.value)}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ---- the tab: pick/create a dated assessment, edit it, print it ------------------------------
  function AssessmentTab({ athlete }) {
    const store = window.AthleteStore;
    const [list, setList] = useState(() => store.getAssessments(athlete.id));
    const [selectedId, setSelectedId] = useState(() => { const l = store.getAssessments(athlete.id); return l.length ? l[l.length - 1].id : null; });
    const found = list.find((a) => a.id === selectedId) || null;
    // Backfills any section missing from an older record (e.g. after this file adds a field),
    // so past assessments never crash the form — just show blank for whatever's new.
    const record = found ? withDefaults(found, athlete.id) : null;
    const wrapRef = useRef(null);

    // "Fit to Screen": an on-screen-only zoom-out so the whole two-column form is visible without
    // scrolling, for a quick glance — a plain CSS zoom on the whole wrapper, computed from how much
    // taller the form actually is than the space left in the window. Kept out of preparePrint's way
    // (see there) since printing does its own independent per-column zoom.
    const [fitScreen, setFitScreen] = useState(false);
    const fitZoomRef = useRef("");
    // A ref twin of `fitScreen`, kept for the beforeprint/afterprint listeners below — those are
    // registered once (empty-deps effect) and would otherwise always see the `fitScreen` value from
    // that first render, not whatever it's actually set to by the time a print happens.
    const fitScreenRef = useRef(false);
    useEffect(() => { fitScreenRef.current = fitScreen; }, [fitScreen]);
    useEffect(() => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      if (!fitScreen) { fitZoomRef.current = ""; wrap.style.zoom = ""; return; }
      const applyFit = () => {
        wrap.style.zoom = "";
        const top = wrap.getBoundingClientRect().top;
        const available = window.innerHeight - top - 16;
        const natural = wrap.scrollHeight;
        const zoom = Math.min(1, Math.max(0.3, available / natural));
        fitZoomRef.current = String(zoom);
        wrap.style.zoom = fitZoomRef.current;
      };
      applyFit();
      window.addEventListener("resize", applyFit);
      return () => window.removeEventListener("resize", applyFit);
    }, [fitScreen, selectedId]);

    const refresh = () => setList(store.getAssessments(athlete.id));

    // AssessmentForm debounces on its own; this just persists and refreshes the picker's
    // date/coach labels once the save actually happens.
    const handleSave = (next) => {
      store.saveAssessment(next);
      refresh();
    };

    const addNew = () => {
      const rec = newAssessment(athlete.id);
      store.saveAssessment(rec);
      refresh();
      setSelectedId(rec.id);
    };

    const remove = (id) => {
      if (!window.confirm("Delete this assessment? This can't be undone.")) return;
      store.deleteAssessment(id);
      const next = store.getAssessments(athlete.id);
      setList(next);
      // Only fall back to the most recent assessment if the one just deleted was the one being
      // viewed — deleting an older entry from the list shouldn't yank the coach off what they're
      // currently looking at.
      setSelectedId((prev) => (prev === id ? (next.length ? next[next.length - 1].id : null) : prev));
    };

    // Print as a single landscape sheet — the Name/Date/Coach header full-width across the top,
    // then the two columns side by side underneath, matching the original paper form's own
    // one-page layout. Each column is scaled independently (its own zoom) so a short column isn't
    // forced down to the taller one's size, and vice versa. Fitting a block to its box is
    // iterative: widening it also shortens it (wider columns wrap less text), which leaves slack
    // to widen further — a single "widen once" pass locks in a width-bound zoom and under-fills
    // the height, so this re-measures a few times to converge on a width whose aspect ratio
    // matches the box it's fitting into.
    const printState = useRef(null);
    const preparePrint = () => {
      const wrap = wrapRef.current;
      if (!wrap || wrap.offsetParent === null || printState.current) return; // hidden tab, or already prepared
      const header = wrap.querySelector(".assess-header");
      const cols = wrap.querySelectorAll(".assess-col");
      if (!header || cols.length !== 2) return;
      const [col0, col1] = cols;
      wrap.style.zoom = ""; // clear any "Fit to Screen" zoom — it would otherwise compound with the print zoom below
      const PAGE_W = 970; // usable width/height of a Letter landscape sheet (0.35in margins) is ~989×749
      const PAGE_H = 705; // CSS px; kept well under that so small rounding differences between the
                          // screen measurement and the print rendering can't push a row onto a 2nd sheet
      const COL_GAP = 24; // print-only gap between the two side-by-side columns

      wrap.classList.add("measuring"); // hides screen-only controls so we measure what will print
      wrap.classList.add("print-paginated"); // switches the columns to a print-only fixed-width flex row — needed during THIS measurement too, not just at print time, so what's measured matches what prints
      [header, col0, col1].forEach((el) => { el.style.zoom = ""; el.style.width = ""; });

      // Fits one or more elements (sized together as a single block) to a box of the given
      // width×height. CSS `zoom` rescales an element's whole internal coordinate system, so text
      // re-wraps based on its *effective* (post-zoom) width, not its pre-zoom declared width —
      // measuring at zoom:1 and applying zoom afterward measures the wrong thing (usually a
      // shorter, less-wrapped layout than what actually prints, which is what left an earlier
      // version's pages visibly under-filled). So every candidate is measured with that same zoom
      // already applied, holding width×zoom = the target width (the effective width the page will
      // actually render at). Rendered height should then scale roughly linearly with zoom at that
      // fixed effective width, but border/font rounding at a fractional zoom (and the occasional
      // line wrapping differently right at some candidate) makes it not quite linear — a direct
      // multiplicative correction can overshoot at one of those wrapping thresholds and spiral
      // away from the answer instead of converging, so this bisects on zoom instead: that can only
      // narrow the bracket, never diverge, at the cost of a few more iterations.
      const fitToPage = (els, widthTarget, heightTarget, measureHeight) => {
        const measureAt = (zoom) => {
          const w = Math.max(1, Math.round(widthTarget / zoom));
          els.forEach((el) => {
            el.style.width = `${w}px`;
            el.style.zoom = zoom === 1 ? "" : String(zoom);
            // AutoGrowTextarea sets an explicit pixel height that only reacts to its own value
            // changing, not to a width change like this one — left alone it goes stale mid-search
            // (still sized for whatever width it last saw) and throws the whole measurement off.
            el.querySelectorAll("textarea").forEach((ta) => {
              ta.style.height = "auto";
              // A few extra px of headroom: Chrome's print rasterizer rounds text-box heights very
              // slightly differently than the live on-screen zoom does, and a textarea sitting
              // right at its measured height is exactly where that gap clips the last line.
              ta.style.height = `${ta.scrollHeight + 6}px`;
            });
          });
          return measureHeight();
        };
        if (measureAt(1) <= heightTarget) return 1; // fits at full size already — no need to shrink
        let lo = 0.05;
        let hi = 1;
        for (let i = 0; i < 14; i++) {
          const mid = (lo + hi) / 2;
          if (measureAt(mid) <= heightTarget) lo = mid; else hi = mid;
        }
        measureAt(lo); // leave the DOM sized at the feasible answer we converged on
        return lo;
      };

      // Header spans the full page width above both columns — just three text fields, so it
      // always fits at full size, but this measures it rather than assuming that so a future field
      // added here still gets shrunk if it ever needs to be.
      fitToPage([header], PAGE_W, PAGE_H, () => header.getBoundingClientRect().height);
      const headerH = header.getBoundingClientRect().height;
      const colBudgetH = PAGE_H - headerH - 16; // 16px breathing room between the header and the columns
      const colW = (PAGE_W - COL_GAP) / 2;

      fitToPage([col0], colW, colBudgetH, () => col0.getBoundingClientRect().height);
      fitToPage([col1], colW, colBudgetH, () => col1.getBoundingClientRect().height);

      wrap.classList.remove("measuring");
      const pageStyle = document.createElement("style");
      pageStyle.textContent = "@page { size: letter landscape; margin: 0.35in; }";
      document.head.appendChild(pageStyle);
      document.body.classList.add("print-assessment-only");
      printState.current = { wrap, header, col0, col1, pageStyle };
    };
    const cleanupPrint = () => {
      const s = printState.current;
      if (!s) return;
      printState.current = null;
      document.body.classList.remove("print-assessment-only");
      s.wrap.classList.remove("print-paginated");
      if (s.pageStyle.parentNode) s.pageStyle.parentNode.removeChild(s.pageStyle);
      [s.header, s.col0, s.col1].forEach((el) => { el.style.zoom = ""; el.style.width = ""; });
      s.wrap.style.zoom = fitScreenRef.current ? fitZoomRef.current : ""; // restore "Fit to Screen", if it was on
    };
    const printAssessment = () => { preparePrint(); window.print(); };
    useEffect(() => {
      window.addEventListener("beforeprint", preparePrint); // also covers Ctrl+P while this tab is open
      window.addEventListener("afterprint", cleanupPrint);
      // Headless PDF rendering (the "Email to Athlete" feature) has no button to click and can't
      // rely on 'beforeprint' firing the same way a real browser print does under automation, so it
      // triggers this same prep directly instead.
      window.addEventListener("dst-render-assessment-prep", preparePrint);
      return () => {
        window.removeEventListener("beforeprint", preparePrint);
        window.removeEventListener("afterprint", cleanupPrint);
        window.removeEventListener("dst-render-assessment-prep", preparePrint);
        cleanupPrint();
      };
      // eslint-disable-next-line
    }, []);

    return (
      <div className="assess-wrap" ref={wrapRef}>
        <div className="panel no-print">
          <h2>Biomechanical Assessment <small>Digital version of the New Assessment form &mdash; prints/exports as a single landscape page</small></h2>
          {/* One button per saved assessment — click to pull it up, click the × to delete it —
              instead of picking a date out of a dropdown. Newest logged assessment first. */}
          <div className="assess-history">
            {!list.length && <span className="assess-row-note">No assessments yet — click "+ New Assessment" to start one.</span>}
            {[...list].reverse().map((a) => (
              <span key={a.id} className={`assess-history-item${a.id === selectedId ? " active" : ""}`}>
                <button type="button" className="assess-history-btn" onClick={() => setSelectedId(a.id)} title="Open this assessment">
                  {fmtDate(a.date)}{a.coach ? ` — ${a.coach}` : ""}
                </button>
                <button type="button" className="assess-history-delete" onClick={() => remove(a.id)} title="Delete this assessment">&times;</button>
              </span>
            ))}
          </div>
          <div className="assess-toolbar">
            <button className="btn btn-primary" onClick={addNew}>+ New Assessment</button>
            {record && <button className="btn btn-secondary" onClick={printAssessment} title="Prints this assessment as a single landscape page, with each column scaled to fill its half of the sheet">Print / Save PDF</button>}
            {record && (
              <button
                className="btn btn-secondary"
                onClick={() => setFitScreen((v) => !v)}
                title="Zooms the whole form out just enough to see both columns without scrolling"
              >
                {fitScreen ? "Actual Size" : "Fit to Screen"}
              </button>
            )}
            {record && typeof EmailToAthleteButton === "function" && (
              <EmailToAthleteButton athlete={athlete} tab="assessment" tabLabel="Biomechanical Assessment" />
            )}
          </div>
          {list.length > 0 && <p className="timestamp-note">{list.length} assessment{list.length === 1 ? "" : "s"} on file for {athlete.name}.</p>}
          {record && <AssessmentSignature activity={record._activity} />}
        </div>

        {record ? (
          <React.Fragment>
            <div className="assess-print-title print-only-block">
              <h1 className="report-title">{athlete.name} &mdash; Biomechanical Assessment</h1>
              <div className="report-subtitle">{fmtDate(record.date)}{record.coach ? ` · Coach: ${record.coach}` : ""}</div>
            </div>
            <AssessmentForm key={record.id} record={record} athlete={athlete} onSave={handleSave} />
          </React.Fragment>
        ) : (
          <div className="panel"><div className="empty-state">No assessments yet for {athlete.name} &mdash; click "+ New Assessment" to start one.</div></div>
        )}
      </div>
    );
  }

  window.AssessmentTab = AssessmentTab;
})();
