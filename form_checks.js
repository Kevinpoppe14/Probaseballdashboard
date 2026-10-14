// Form checks — clips a remote athlete films on their phone page and sends to the coach who assigned the program
// (api/form-check.js, supabase/migration_017_form_checks.sql). Here the coach watches one and replies; the reply
// shows under that exercise on the athlete's phone. Clips are private (watched through a link that lasts an hour)
// and are deleted after a week.
//   window.FormChecks          loading and saving
//   <window.FormCheckHost />   the watch-and-reply window, opened by window.openFormCheck(id) or ?formcheck=<id>
//                              (the link in the coach's email)
//   <window.FormChecksPanel /> an athlete's checks from the past week, on their Training Log
//   window.useOpenFormChecks() the checks waiting for the signed-in coach, for the Today panel
(function () {
  const { useState, useEffect } = React;
  const sb = () => window.supabaseClient;
  const BUCKET = "form-checks";
  const CHANGED = "dst-form-checks-changed";
  const me = () => ((window.AthleteStore && window.AthleteStore.currentUserEmail()) || "").toLowerCase();
  const weekAgo = () => new Date(Date.now() - 7 * 864e5).toISOString();
  const row = (r) => ({ id: r.id, athleteId: r.athlete_id, at: r.created_at, ...(r.data || {}), data: r.data || {} });
  const fmtWhen = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); };

  const FormChecks = {
    async get(id) {
      const { data, error } = await sb().from("form_checks").select("id,athlete_id,data,created_at").eq("id", String(id)).maybeSingle();
      return error || !data ? null : row(data);
    },
    async forAthlete(athleteId) {
      const { data, error } = await sb().from("form_checks").select("id,athlete_id,data,created_at").eq("athlete_id", String(athleteId)).gt("created_at", weekAgo()).order("created_at", { ascending: false });
      return error ? [] : (data || []).map(row);
    },
    // not yet reviewed and sent to the signed-in coach
    async open() {
      const { data, error } = await sb().from("form_checks").select("id,athlete_id,data,created_at").gt("created_at", weekAgo()).order("created_at", { ascending: true }).limit(500);
      if (error) return [];
      const all = (data || []).map(row).filter((c) => !c.reviewed);
      const mine = all.filter((c) => (c.coach || "").toLowerCase().split(/,\s*/).includes(me()));
      return mine;
    },
    async save(check, changes) {
      const data = { ...check.data, ...changes };
      const { error } = await sb().from("form_checks").update({ data, updated_at: new Date().toISOString() }).eq("id", check.id);
      if (!error) window.dispatchEvent(new CustomEvent(CHANGED));
      return !error;
    },
  };
  window.FormChecks = FormChecks;
  window.openFormCheck = (id) => window.dispatchEvent(new CustomEvent("dst-open-form-check", { detail: id }));

  function FormCheckModal({ id, onClose }) {
    const [check, setCheck] = useState(null);
    const [url, setUrl] = useState("");
    const [state, setState] = useState("loading"); // loading | ready | gone
    const [reply, setReply] = useState("");
    const [note, setNote] = useState("");
    useEffect(() => {
      let live = true;
      (async () => {
        const c = await FormChecks.get(id);
        if (!live) return;
        if (!c) { setState("gone"); return; }
        setCheck(c);
        setReply(c.reply || "");
        const { data } = c.path ? await sb().storage.from(BUCKET).createSignedUrl(c.path, 3600) : { data: null };
        if (!live) return;
        setUrl((data && data.signedUrl) || "");
        setState("ready");
      })();
      return () => { live = false; };
    }, [id]);
    const save = async (changes, done) => {
      setNote("Saving…");
      if (await FormChecks.save(check, changes)) { setNote(done); setCheck((c) => ({ ...c, ...changes, data: { ...c.data, ...changes } })); }
      else setNote("Could not save. Try again.");
    };
    const sendReply = () => save({ reply: reply.trim(), repliedBy: me(), repliedAt: new Date().toISOString(), reviewed: true }, "Sent. It shows under the exercise on their phone.");
    return ReactDOM.createPortal(
      <div className="zoom-overlay exercise-overlay" onClick={onClose}>
        <div className="zoom-modal exercise-modal form-check-modal" onClick={(e) => e.stopPropagation()}>
          <button className="zoom-close" onClick={onClose} aria-label="Close">×</button>
          {state === "loading" && <div className="facility-note">Loading…</div>}
          {state === "gone" && <div className="facility-note">This form check is gone. Clips are deleted after a week.</div>}
          {state === "ready" && check && (
            <React.Fragment>
              <h2>{check.athleteName || "Form check"} <small>{check.exercise}</small></h2>
              <div className="form-check-meta">{[check.program, check.week, check.day].filter(Boolean).join(" · ")}{check.at ? ` · sent ${fmtWhen(check.at)}` : ""}</div>
              {url ? <video className="exercise-clip" src={url} controls playsInline preload="metadata" /> : <div className="facility-note">The video could not be loaded. It may have been deleted.</div>}
              {check.note && <div className="form-check-note"><strong>Their note:</strong> {check.note}</div>}
              <label className="facility-field wide"><span>Your reply (shows under {check.exercise} on their phone)</span>
                <textarea rows={3} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="e.g. Good depth. Keep your chest up out of the hole." />
              </label>
              <div className="facility-form-actions">
                <button className="btn" disabled={!reply.trim()} onClick={sendReply}>{check.reply ? "Update reply" : "Send reply"}</button>
                {!check.reviewed && <button className="btn btn-secondary" onClick={() => save({ reviewed: true }, "Marked as reviewed.")}>Mark reviewed, no reply</button>}
                {note && <span className="timestamp-note">{note}</span>}
              </div>
              {check.repliedAt && <div className="timestamp-note">Replied {fmtWhen(check.repliedAt)}{check.repliedBy ? ` by ${check.repliedBy}` : ""}</div>}
            </React.Fragment>
          )}
        </div>
      </div>,
      document.body
    );
  }

  function FormCheckHost() {
    const [id, setId] = useState(() => { try { return new URLSearchParams(window.location.search).get("formcheck"); } catch (e) { return null; } });
    useEffect(() => {
      const onOpen = (e) => setId(e.detail);
      const onKey = (e) => { if (e.key === "Escape") setId(null); };
      window.addEventListener("dst-open-form-check", onOpen);
      window.addEventListener("keydown", onKey);
      return () => { window.removeEventListener("dst-open-form-check", onOpen); window.removeEventListener("keydown", onKey); };
    }, []);
    const close = () => {
      setId(null);
      // drop ?formcheck= so a refresh doesn't open it again
      try { const u = new URL(window.location.href); if (u.searchParams.has("formcheck")) { u.searchParams.delete("formcheck"); window.history.replaceState(null, "", u.toString()); } } catch (e) { /* fine */ }
    };
    return id ? <FormCheckModal id={id} onClose={close} /> : null;
  }
  window.FormCheckHost = FormCheckHost;

  // the signed-in coach's checks waiting for review, kept current as replies are saved
  function useOpenFormChecks() {
    const [list, setList] = useState([]);
    useEffect(() => {
      let live = true;
      const load = () => FormChecks.open().then((l) => { if (live) setList(l); });
      load();
      window.addEventListener(CHANGED, load);
      return () => { live = false; window.removeEventListener(CHANGED, load); };
    }, []);
    return list;
  }
  window.useOpenFormChecks = useOpenFormChecks;

  function FormChecksPanel({ athlete }) {
    const [list, setList] = useState([]);
    useEffect(() => {
      let live = true;
      const load = () => FormChecks.forAthlete(athlete.id).then((l) => { if (live) setList(l); });
      load();
      window.addEventListener(CHANGED, load);
      return () => { live = false; window.removeEventListener(CHANGED, load); };
    }, [athlete.id]);
    if (!list.length) return null;
    return (
      <div className="panel">
        <h2>Form checks <small>clips {athlete.name} sent from their phone in the past week (deleted after 7 days)</small></h2>
        <ul className="form-check-list">
          {list.map((c) => (
            <li key={c.id}>
              <button className="btn btn-secondary" onClick={() => window.openFormCheck(c.id)}>▶ Watch</button>
              <div>
                <strong>{c.exercise}</strong> <small>{[c.week, c.day].filter(Boolean).join(" · ")} · {fmtWhen(c.at)}</small>
                {c.note && <div className="form-check-note-small">“{c.note}”</div>}
                <div className={`form-check-status ${c.reviewed ? "done" : ""}`}>{c.reply ? `Replied: ${c.reply}` : c.reviewed ? "Reviewed" : "Waiting for review"}</div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  window.FormChecksPanel = FormChecksPanel;
})();
