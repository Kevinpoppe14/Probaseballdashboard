// Equipment access for athletes who train remotely (DST Remote Training only).
//   EquipmentAccessTab  the "Remote Equipment Access" tab on the athlete's profile: tick what they have to train
//                       with, grouped by type. The athlete fills the same list in on their phone link.
//   EquipmentFlags      lists the exercises in a program that need something the athlete doesn't have. It never
//                       blocks anything; it prompts the coach, who can "Ignore and add" (the exercise stays and
//                       the equipment goes onto the athlete's list) or "Change exercise". Shown above the program
//                       builder on the athlete's plan, and after a program is assigned to them.
// The list lives in the athlete_equipment table (see getEquipment / setEquipment in store.js).
(function () {
  const { useState, useEffect } = React;
  const EC = window.EquipmentCheck;
  const fresh = (athlete) => window.AthleteStore.allAthletes().find((a) => a.id === athlete.id) || athlete;
  const isRemote = (athlete) => !!athlete && athlete.dstLocation === EC.REMOTE_LOCATION;
  const lower = (q) => `${q}`.toLowerCase();
  const fmtWhen = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); };

  function EquipmentAccessTab({ athlete }) {
    const store = window.AthleteStore;
    const [, bump] = useState(0);
    const a = fresh(athlete);
    // pick up what the athlete has ticked on their phone since the dashboard loaded
    useEffect(() => { let live = true; store.refreshEquipment(a.id).then((ok) => { if (ok && live) bump((n) => n + 1); }); return () => { live = false; }; /* eslint-disable-next-line */ }, [a.id]);
    const eq = store.getEquipment(a.id);
    const set = Array.isArray(eq.access);
    // the list also carries the athlete's indoor turf length (see turfYards in program_rx.js); it is not equipment
    const have = (set ? eq.access : []).filter((q) => !EC.isSetting(q));
    const turf = EC.turfYards(set ? eq.access : []);
    const isListed = (q) => EC.LIST.some((x) => lower(x) === lower(q));
    // Equipment added by hand for this athlete. Each one is a check box of its own (ticked when added) and
    // stays on the list if it is unticked later.
    const custom = [...new Set([...eq.custom, ...have.filter((q) => !isListed(q))])];
    const save = (access, nextCustom = custom, yards = turf) => { store.setEquipment(a.id, { access: EC.withTurfYards(access, yards), custom: nextCustom }); bump((n) => n + 1); };
    const toggle = (q) => save(have.includes(q) ? have.filter((x) => x !== q) : [...have, q]);
    const [adding, setAdding] = useState("");
    const addCustom = () => {
      const q = adding.trim().replace(/\s+/g, " ");
      if (!q) return;
      // something already on the list, standard or added before, is just ticked
      const name = EC.LIST.find((x) => lower(x) === lower(q)) || custom.find((x) => lower(x) === lower(q)) || q;
      save(have.some((x) => lower(x) === lower(name)) ? have : [...have, name], isListed(name) || custom.includes(name) ? custom : [...custom, name]);
      setAdding("");
    };
    const removeCustom = (q) => {
      if (!window.confirm(`Take "${q}" off ${a.name}'s equipment list altogether?`)) return;
      save(have.filter((x) => x !== q), custom.filter((x) => x !== q));
    };
    const box = (q, removable) => (
      <label key={q} className={`eq-item${removable ? " eq-item-custom" : ""}${have.includes(q) ? " on" : ""}`}>
        <input type="checkbox" checked={have.includes(q)} onChange={() => toggle(q)} />
        <span>{EC.label(q)}</span>
        {/* how long their turf is; left blank, it is taken to be long enough for anything */}
        {q === "Indoor Turf" && (
          <span className="eq-yards">
            <input
              key={`turf-${turf || ""}`}
              defaultValue={turf || ""}
              inputMode="numeric"
              placeholder="length"
              aria-label="Indoor turf length in yards"
              onClick={(e) => e.stopPropagation()}
              onBlur={(e) => { const v = parseFloat(e.target.value) || null; if (v !== turf) save(v && !have.includes(q) ? [...have, q] : have, custom, v); }}
              onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }}
            />
            yd
          </span>
        )}
        {removable &&<button type="button" className="eq-item-remove" title={`Take ${q} off the list`} aria-label={`Take ${q} off the list`} onClick={(e) => { e.preventDefault(); removeCustom(q); }}>&times;</button>}
      </label>
    );
    return (
      <div className="panel eq-panel">
        <h2>Remote Equipment Access <small>What {a.name} has to train with. Programs on their plan are checked against this.</small></h2>
        {!set && <p className="eq-note">Nothing has been set yet, so no exercises are being flagged. {a.name} is asked to fill this in when they open their phone link; you can also tick it here.</p>}
        {eq.surveyedAt && <p className="eq-note">Filled in by {a.name} on their phone, {fmtWhen(eq.surveyedAt)}.{eq.source === "coach" ? " Edited by a coach since." : ""}</p>}
        {EC.GROUPS.map((g) => (
          <div className="eq-group" key={g.name}>
            <h3>{g.name} <small>{g.items.filter((q) => have.includes(q)).length} of {g.items.length}</small></h3>
            <div className="eq-grid">{g.items.map((q) => box(q, false))}</div>
          </div>
        ))}
        <div className="eq-group">
          <h3>Other Equipment <small>added by hand</small></h3>
          {custom.length > 0 && <div className="eq-grid">{custom.map((q) => box(q, true))}</div>}
          <div className="eq-add">
            <input
              value={adding}
              placeholder="Add other equipment"
              aria-label="Add other equipment"
              onChange={(e) => setAdding(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustom(); } }}
            />
            <button className="btn btn-secondary" disabled={!adding.trim()} onClick={addCustom}>Add</button>
          </div>
        </div>
        <div className="eq-actions">
          <button className="btn btn-secondary" onClick={() => save([...EC.LIST, ...custom])}>Has everything</button>
          <button className="btn btn-secondary" onClick={() => save([])}>Has none of these</button>
          <span className="timestamp-note">{set ? `${have.length} of ${EC.LIST.length + custom.length} ticked. Bodyweight exercises are never flagged.` : ""}</span>
        </div>
        <div className="field" style={{ marginTop: 14 }}>
          <label>Notes</label>
          <textarea
            rows={3}
            key={a.id}
            defaultValue={a.equipmentNotes || ""}
            placeholder="e.g. Dumbbells up to 50 lb, adjustable bench, no rack"
            onBlur={(e) => { if (e.target.value !== (a.equipmentNotes || "")) store.updateAthlete(a.id, { equipmentNotes: e.target.value }); }}
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
    const access = store.getEquipment(a.id).access;
    if (!isRemote(a) || !Array.isArray(access) || !program) return null;
    return EC.flaggedIn(program, access, store.findExerciseByName);
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
    const eq = store.getEquipment(a.id);
    if (!Array.isArray(eq.access)) {
      return quietWhenClear ? null : <div className="eq-flags eq-flags-off">Remote athlete: {a.name}'s equipment hasn't been filled in yet, so this program isn't being checked against it. They are asked for it on their phone link, or set it on the Remote Equipment Access tab.</div>;
    }
    const access = eq.access;
    const flagged = flagsFor(a, program) || [];
    if (!flagged.length) return quietWhenClear ? null : <div className="eq-flags eq-flags-ok">Equipment check: {a.name} has what every exercise in this program needs.</div>;

    const addAndIgnore = (f) => { store.setEquipment(a.id, { access: [...new Set([...access, ...f.missing])], custom: eq.custom }); bump((n) => n + 1); };
    const replacement = to.trim();
    const stillMissing = replacement ? EC.missing(replacement, store.findExerciseByName(replacement), access) : [];
    return (
      <div className="eq-flags">
        <strong>Equipment check: {flagged.length} exercise{flagged.length === 1 ? "" : "s"} in this program need{flagged.length === 1 ? "s" : ""} equipment {a.name} doesn't have.</strong>
        <ul>
          {flagged.map((f) => (
            <li key={f.name}>
              <span className="eq-flag-name">{f.name}</span>
              <span className="eq-flag-need">needs {f.missing.map(EC.label).join(", ")} · used {f.count} time{f.count === 1 ? "" : "s"}</span>
              {changing === f.name ? (
                <span className="eq-change">
                  <input list="eq-exercise-names" value={to} autoFocus placeholder="Replace with…" aria-label={`Replace ${f.name} with`} onChange={(e) => setTo(e.target.value)} />
                  <button className="btn" disabled={!replacement || replacement.toLowerCase() === f.name.toLowerCase()} onClick={() => { onChangeExercise(f.name, replacement); setChanging(null); }}>Replace in whole phase</button>
                  <button className="btn-link" onClick={() => setChanging(null)}>Cancel</button>
                  {stillMissing.length > 0 && <em>That one needs {stillMissing.map(EC.label).join(", ")} too.</em>}
                </span>
              ) : (
                <span className="eq-flag-actions">
                  <button className="btn btn-secondary" title={`Keep the exercise and add ${f.missing.join(", ")} to ${a.name}'s equipment`} onClick={() => addAndIgnore(f)}>Ignore and add {f.missing.map(EC.label).join(", ")}</button>
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
