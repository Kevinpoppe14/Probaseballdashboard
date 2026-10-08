// Equipment access for athletes who train remotely (DST Remote Training only).
//   EquipmentAccessTab  a tab on the athlete's profile: tick what they have to train with.
//   EquipmentFlags      lists the exercises in a program that need something the athlete doesn't have. It never
//                       blocks anything; it prompts the coach, who can "Ignore and add" (the exercise stays and
//                       the equipment goes onto the athlete's list) or "Change exercise". Shown above the program
//                       builder on the athlete's plan, and after a program is assigned to them.
// The list is kept on the athlete's own record as `equipmentAccess` (an array), with `equipmentNotes`.
(function () {
  const { useState } = React;
  const EC = window.EquipmentCheck;
  const fresh = (athlete) => window.AthleteStore.allAthletes().find((a) => a.id === athlete.id) || athlete;
  const isRemote = (athlete) => !!athlete && athlete.dstLocation === EC.REMOTE_LOCATION;

  function EquipmentAccessTab({ athlete }) {
    const store = window.AthleteStore;
    const [, bump] = useState(0);
    const a = fresh(athlete);
    const set = Array.isArray(a.equipmentAccess);
    const have = set ? a.equipmentAccess : [];
    const save = (patch) => { store.updateAthlete(a.id, patch); bump((n) => n + 1); };
    const toggle = (q) => save({ equipmentAccess: have.includes(q) ? have.filter((x) => x !== q) : [...have, q] });
    return (
      <div className="panel eq-panel">
        <h2>Equipment Access <small>What {a.name} has to train with. Programs on their plan are checked against this.</small></h2>
        {!set && <p className="eq-note">Nothing has been set yet, so no exercises are being flagged. Tick what they have to turn the check on.</p>}
        <div className="eq-grid">
          {EC.LIST.map((q) => (
            <label key={q} className={`eq-item${have.includes(q) ? " on" : ""}`}>
              <input type="checkbox" checked={have.includes(q)} onChange={() => toggle(q)} />
              {q}
            </label>
          ))}
        </div>
        <div className="eq-actions">
          <button className="btn btn-secondary" onClick={() => save({ equipmentAccess: [...EC.LIST] })}>Has everything</button>
          <button className="btn btn-secondary" onClick={() => save({ equipmentAccess: [] })}>Has none of these</button>
          <span className="timestamp-note">{set ? `${have.length} of ${EC.LIST.length} ticked. Bodyweight exercises are never flagged.` : ""}</span>
        </div>
        <div className="field" style={{ marginTop: 14 }}>
          <label>Other equipment and notes</label>
          <textarea
            rows={3}
            key={a.id}
            defaultValue={a.equipmentNotes || ""}
            placeholder="e.g. Dumbbells up to 50 lb, adjustable bench, no rack"
            onBlur={(e) => { if (e.target.value !== (a.equipmentNotes || "")) save({ equipmentNotes: e.target.value }); }}
          />
        </div>
      </div>
    );
  }

  // Exercises in `program` that need equipment the athlete doesn't have, one entry per exercise name.
  // null when the check doesn't apply: not a remote athlete, or their equipment hasn't been set yet.
  function flagsFor(athlete, program) {
    const store = window.AthleteStore;
    const a = fresh(athlete);
    if (!isRemote(a) || !Array.isArray(a.equipmentAccess) || !program) return null;
    const byName = {};
    (program.weeks || []).forEach((w) => (w.sessions || []).forEach((s) => (s.exercises || []).forEach((e) => {
      const name = (e.name || "").trim();
      if (!name) return;
      const key = name.toLowerCase();
      if (!byName[key]) byName[key] = { name, missing: EC.missing(name, store.findExerciseByName(name), a.equipmentAccess), count: 0 };
      byName[key].count += 1;
    })));
    return Object.values(byName).filter((f) => f.missing.length).sort((x, y) => x.name.localeCompare(y.name));
  }

  // `onChangeExercise(from, to)` replaces an exercise through the whole program; when `onOpenChange` is given
  // instead, "Change exercise" hands off to it (the assign screen opens Individualize). `quietWhenClear` leaves
  // the panel out altogether when nothing is flagged.
  function EquipmentFlags({ athlete, program, onChangeExercise, onOpenChange, quietWhenClear }) {
    const store = window.AthleteStore;
    const [, bump] = useState(0);
    const [changing, setChanging] = useState(null); // name of the exercise being replaced
    const [to, setTo] = useState("");
    const a = fresh(athlete);
    if (!isRemote(a) || !program) return null;
    if (!Array.isArray(a.equipmentAccess)) {
      return quietWhenClear ? null : <div className="eq-flags eq-flags-off">Remote athlete: set {a.name}'s equipment on the Equipment Access tab to have this program checked against it.</div>;
    }
    const access = a.equipmentAccess;
    const flagged = flagsFor(a, program) || [];
    if (!flagged.length) return quietWhenClear ? null : <div className="eq-flags eq-flags-ok">Equipment check: {a.name} has what every exercise in this program needs.</div>;

    const addAndIgnore = (f) => { store.updateAthlete(a.id, { equipmentAccess: [...new Set([...access, ...f.missing])] }); bump((n) => n + 1); };
    const replacement = to.trim();
    const stillMissing = replacement ? EC.missing(replacement, store.findExerciseByName(replacement), access) : [];
    return (
      <div className="eq-flags">
        <strong>Equipment check: {flagged.length} exercise{flagged.length === 1 ? "" : "s"} in this program need{flagged.length === 1 ? "s" : ""} equipment {a.name} doesn't have.</strong>
        <ul>
          {flagged.map((f) => (
            <li key={f.name}>
              <span className="eq-flag-name">{f.name}</span>
              <span className="eq-flag-need">needs {f.missing.join(", ")} · used {f.count} time{f.count === 1 ? "" : "s"}</span>
              {changing === f.name ? (
                <span className="eq-change">
                  <input list="eq-exercise-names" value={to} autoFocus placeholder="Replace with…" aria-label={`Replace ${f.name} with`} onChange={(e) => setTo(e.target.value)} />
                  <button className="btn" disabled={!replacement || replacement.toLowerCase() === f.name.toLowerCase()} onClick={() => { onChangeExercise(f.name, replacement); setChanging(null); }}>Replace in whole phase</button>
                  <button className="btn-link" onClick={() => setChanging(null)}>Cancel</button>
                  {stillMissing.length > 0 && <em>That one needs {stillMissing.join(", ")} too.</em>}
                </span>
              ) : (
                <span className="eq-flag-actions">
                  <button className="btn btn-secondary" title={`Keep the exercise and add ${f.missing.join(", ")} to ${a.name}'s equipment`} onClick={() => addAndIgnore(f)}>Ignore and add {f.missing.join(", ")}</button>
                  <button className="btn btn-secondary" onClick={() => (onOpenChange ? onOpenChange(f.name) : (setChanging(f.name), setTo("")))}>Change exercise</button>
                </span>
              )}
            </li>
          ))}
        </ul>
        <datalist id="eq-exercise-names">
          {store.allExercises().map((x) => <option key={x.id} value={x.name} />)}
        </datalist>
      </div>
    );
  }

  window.EquipmentAccessTab = EquipmentAccessTab;
  window.EquipmentFlags = EquipmentFlags;
  window.equipmentFlagsFor = flagsFor;
  window.isRemoteAthlete = isRemote;
})();
