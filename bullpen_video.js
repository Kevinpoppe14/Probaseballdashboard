// Bullpen video — Edgertronic or phone clips synced to a bullpen's pitches (bullpens.js). The clips are kept in the
// company's Google Drive once that's set up (api/drive-video.js: any size, a folder per athlete), otherwise in the
// private "bullpen-videos" storage bucket (supabase/migration_031_bullpen_videos.sql), watched through links that last
// an hour. A session's record carries video: { files: [{ path | drive, name, size }], clips: { [pitch no]: { f, start, end } } }:
// f is which file holds the pitch, start/end (seconds) its stretch of that file when one long video holds them all.
// Two ways in:
//   one clip per pitch, as the Edgertronic saves them: matched to the pitches in order, by file name
//   one long video: scanned in the browser for its cuts (the jump from one frame to the next where a clip ends and
//     the next begins) and split there without re-encoding; each pitch just plays its own stretch
// Every pitch thrown is matched, taken-out ones too (they were still filmed). A clip that lands on the wrong pitch (a
// missed trigger, an extra clip) is fixed from the player by moving it, and every clip after it, a pitch either way.
//   window.BullpenVideo = { VideoBar, PitchVideo, CameraButton, removeFiles, hasClip }
// (keeping the video, finding the pitches and the export's panel are in bullpen_cut.js, shared with the phone app)
(function () {
  const { useState, useRef, useEffect } = React;
  const mb = (n) => `${Math.round(n / 1048576)} MB`;
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
  const pitchNos = (session) => (session.pitches || []).map((p) => p.no).sort((a, b) => a - b);
  const hasClip = (session, no) => !!(session && session.video && session.video.clips && session.video.clips[no]);
  // the parts without React, shared with the phone app (bullpen_cut.js)
  const { upload, removeFiles, linkOf, useDrive, scanVideo, splitByMotion, cueClips, shiftClips, fmtDay } = window.BullpenCut;

  // the n - 1 biggest jumps, no two too close together, as n stretches of the video. Each stretch starts on the first
  // frame seen after its cut and ends on the last one seen before the next, so no pitch shows a flash of another.
  // `clear` is how much the weakest cut taken stands out from the strongest one left out (under ~2: check them).
  // A jump is scored against the frames around it (how many times the usual change there), since slow-motion
  // footage of one pitcher against one background can have cuts that are small in themselves but sudden.
  function splitAt(scan, n) {
    const { frames, dur } = scan;
    const minGap = Math.max(1, (dur / Math.max(1, n)) * 0.4);
    const around = (i) => {
      const xs = [];
      for (let k = i - 6; k <= i + 6; k++) if (k !== i && k > 0 && k < frames.length) xs.push(frames[k].d);
      xs.sort((a, b) => a - b);
      return xs.length ? xs[Math.floor(xs.length / 2)] : 0;
    };
    const peaks = frames.map((f, i) => ({ i, t: f.t, d: f.d, s: f.d / (around(i) + 0.5) }))
      .filter((p) => p.i > 0 && p.d >= frames[p.i - 1].d && p.d >= (frames[p.i + 1] ? frames[p.i + 1].d : 0) && p.t >= minGap && p.t <= dur - minGap)
      .sort((a, b) => b.s - a.s);
    const far = (list, p) => list.every((c) => Math.abs(c.t - p.t) >= minGap);
    const cuts = [];
    for (const p of peaks) {
      if (cuts.length >= n - 1) break;
      if (far(cuts, p)) cuts.push(p);
    }
    const left = peaks.find((p) => !cuts.includes(p) && far(cuts, p));
    const weakest = cuts.length ? Math.min(...cuts.map((c) => c.s)) : 0;
    cuts.sort((a, b) => a.t - b.t);
    const segs = [];
    let start = 0;
    cuts.forEach((c) => { segs.push({ start, end: frames[c.i - 1].t }); start = c.t; });
    segs.push({ start, end: dur });
    // how many clips the video itself seems to have: jumps many times the change around them
    const big = [];
    peaks.forEach((p) => { if (p.s > 5 && p.d > 2 && far(big, p)) big.push(p); });
    return { segs, clear: left && left.s > 0 ? weakest / left.s : 99, seems: big.length + 1 };
  }
  const CAMERAS = [["edgertronic", "Edgertronic"], ["phone", "Phone"]];

  // ---- adding video to a session ---------------------------------------------------------------------------------
  function VideoBar({ session, athlete, onSave }) {
    const nos = pitchNos(session);
    const video = session.video && session.video.files && session.video.files.length ? session.video : null;
    const matched = video ? nos.filter((n) => video.clips[n]).length : 0;
    const fileRef = useRef(null);
    const [plan, setPlan] = useState(null); // { kind: "many", files } | { kind: "one", file, scan, n }
    const [busy, setBusy] = useState("");
    const [msg, setMsg] = useState("");
    const [camera, setCamera] = useState((video && video.camera) || "edgertronic");
    const [exporting, setExporting] = useState(false);
    const pick = async (e) => {
      const files = [...(e.target.files || [])].filter((f) => /^video\//i.test(f.type || "video/") || /\.(mov|mp4|m4v)$/i.test(f.name));
      e.target.value = "";
      setMsg("");
      if (!files.length) return;
      if (files.length > 1 || nos.length <= 1) { setPlan({ kind: "many", files: files.sort(byName) }); return; }
      const finding = camera === "phone" ? "Finding the pitches" : "Finding the cuts";
      setBusy(`${finding}… 0%`);
      try {
        const scan = await scanVideo(files[0], (p) => setBusy(`${finding}… ${Math.round(p * 100)}%`));
        // a phone video: each pitch from the top of its leg lift to 0.6 s after the ball gets there (the pose model)
        let cued = null;
        if (camera === "phone") {
          const thrown = (session.pitches || []).slice().sort((a, b) => a.no - b.no);
          setBusy("Finding each leg lift and release… 0%");
          cued = await cueClips(files[0], scan, thrown, { onProgress: (p) => setBusy(`Finding each leg lift and release… ${Math.round(p * 100)}%`) }).then((c) => ({ ...c, n: thrown.length, clear: 99 }), () => null);
        }
        setPlan({ kind: "one", file: files[0], scan, n: nos.length, cued });
      } catch (err) { setMsg(err.message || String(err)); }
      setBusy("");
    };
    const split = plan && plan.kind === "one" ? (camera === "phone" ? (plan.cued && plan.cued.n === plan.n ? plan.cued : splitByMotion(plan.scan, plan.n)) : splitAt(plan.scan, plan.n)) : null;
    // each pitch's clip: the files in order, or the stretches of the one video
    const clipsFor = (files) => {
      const clips = {};
      if (plan.kind === "many") nos.forEach((n, i) => { if (i < files.length) clips[n] = { f: i }; });
      else nos.forEach((n, i) => { const s = split.segs[i]; if (s) clips[n] = { f: 0, start: Math.round(s.start * 1000) / 1000, end: Math.round(s.end * 1000) / 1000 }; });
      return clips;
    };
    // Export without uploading: the video stays on this device, read from the file chosen (any size), only for
    // making the MP4; nothing is added to the bullpen
    const [local, setLocal] = useState(null);
    const exportLocal = () => {
      const files = (plan.kind === "many" ? plan.files : [plan.file]).map((f) => ({ url: URL.createObjectURL(f), name: f.name, size: f.size }));
      setLocal({ files, clips: clipsFor(files), camera });
    };
    const closeLocal = () => { local.files.forEach((f) => URL.revokeObjectURL(f.url)); setLocal(null); };
    const save = async () => {
      const files = plan.kind === "many" ? plan.files : [plan.file];
      const stored = [];
      try {
        for (let i = 0; i < files.length; i++) {
          const where = (await useDrive()) ? " to Google Drive" : "";
          const label = files.length > 1 ? `Uploading ${i + 1} of ${files.length}${where}` : `Uploading ${mb(files[0].size)}${where}`;
          setBusy(`${label}…`);
          stored.push(await upload(files[i], athlete, session.id, (f) => setBusy(`${label}… ${Math.round(f * 100)}%`)));
        }
      } catch (err) {
        await removeFiles({ files: stored });
        setBusy(""); setMsg(err.message || String(err));
        return;
      }
      const clips = clipsFor(stored);
      const old = video;
      onSave({ files: stored, clips, camera, addedAt: new Date().toISOString(), addedBy: (window.AthleteStore.currentUserEmail && window.AthleteStore.currentUserEmail()) || "" });
      if (old) removeFiles(old);
      setPlan(null); setBusy("");
      setMsg(`Video added: ${Object.keys(clips).length} of ${nos.length} pitches have a clip. Click 🎥 on a pitch to watch it.`);
    };
    const drop = async () => {
      const ok = await window.askConfirm({ title: "Remove this bullpen's video?", text: "The clips are deleted from storage. The pitches and their numbers stay.", ok: "Remove video", danger: true });
      if (!ok) return;
      onSave(null);
      removeFiles(video);
      setMsg("Video removed.");
    };
    return (
      <div className="bp-video-bar no-print">
        <span className="bp-video-label"><CamIcon /> {video ? `${(CAMERAS.find((c) => c[0] === (video.camera || "edgertronic")) || CAMERAS[0])[1]} video` : "Video"}</span>
        {video
          ? <span className="timestamp-note">{video.files.length === 1 && nos.length > 1 ? (video.camera === "phone" ? "One video, split at each delivery" : "One video, split at its cuts") : `${video.files.length} clip${video.files.length === 1 ? "" : "s"}`} · {matched} of {nos.length} pitches have a clip</span>
          : !plan && !busy && <span className="timestamp-note">Add the clips (one per pitch) or one long video, and each pitch gets its own. A phone left recording the whole bullpen is split at each delivery. To make a video without uploading (any size), choose the file, then Export without uploading.</span>}
        {!plan && !busy && (
          <select className="bp-tag" value={camera} aria-label="Which camera" title="Which camera filmed it: an Edgertronic video is split at its cuts, a phone's at each delivery" onChange={(e) => setCamera(e.target.value)}>
            {CAMERAS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        )}
        {!plan && !busy && <button type="button" className="btn btn-secondary" onClick={() => fileRef.current && fileRef.current.click()}>{video ? "Replace video" : "Add video"}</button>}
        {video && !plan && !busy && window.VideoExport && <button type="button" className="btn btn-primary" title="Make an MP4 of the pitches with their TrackMan numbers beside them, to download" onClick={() => setExporting(true)}>Export video</button>}
        {video && !plan && !busy && <button type="button" className="btn btn-small-grey" onClick={drop}>Remove video</button>}
        {exporting && <ExportDialog session={session} athlete={athlete} onClose={() => setExporting(false)} />}
        <input ref={fileRef} type="file" accept="video/*,.mov,.mp4,.m4v" multiple hidden onChange={pick} />
        {busy && <span className="assess-row-note" role="status">{busy}</span>}
        {msg && !busy && <span className="assess-row-note" role="status">{msg}</span>}
        {plan && !busy && (
          <div className="bp-video-plan">
            {plan.kind === "many" ? (
              <p>
                <b>{plan.files.length} clip{plan.files.length === 1 ? "" : "s"} for {nos.length} pitch{nos.length === 1 ? "" : "es"}</b>, matched in order by file name ({plan.files[0].name}{plan.files.length > 1 ? ` to ${plan.files[plan.files.length - 1].name}` : ""}; {mb(plan.files.reduce((n, f) => n + f.size, 0))}).
                {plan.files.length !== nos.length && <span className="bp-video-warn"> The counts don't match: the first {Math.min(plan.files.length, nos.length)} pitches get a clip{plan.files.length > nos.length ? " and the extra clips go unused" : ""}. If one was missed, move clips from the player afterward.</span>}
              </p>
            ) : (
              <React.Fragment>
                <p>
                  <b>{plan.file.name}</b> ({mb(plan.file.size)}, {Math.round(plan.scan.dur)} s): split into
                  {" "}<input type="number" className="bp-video-n" min={1} max={300} value={plan.n} aria-label="Clips in the video" onChange={(e) => setPlan({ ...plan, n: Math.max(1, Math.min(300, Number(e.target.value) || 1)) })} />{" "}
                  clips for {nos.length} pitches.
                  {camera === "phone"
                    ? <span className="bp-video-warn"> {split === plan.cued ? `Each pitch runs from the top of its leg lift to 0.6 s after the ball gets there (${split.segs.filter((s) => s.found).length} found that way${split.segs.some((s) => !s.found) ? ", the rest around the motion" : ""})` : "Each pitch is found by the motion of the delivery (2.5 s before it to 1.5 s after)"}{split.seems < plan.n ? `, and only ${split.seems} were found` : ""}: check a few after it's added, and move clips from the player if one is off.</span>
                    : <React.Fragment>
                      {split.seems !== plan.n && <span className="bp-video-warn"> The video looks like it has about {split.seems} clips. <button type="button" className="bp-link" onClick={() => setPlan({ ...plan, n: split.seems })}>Use {split.seems}</button></span>}
                      {split.seems === plan.n && split.clear < 2 && <span className="bp-video-warn"> Some cuts are faint, so check a few pitches after it's added.</span>}
                    </React.Fragment>}
                </p>
                <p className="timestamp-note">Clip lengths: {split.segs.map((s) => `${(s.end - s.start).toFixed(1)}s`).join(", ")}</p>
              </React.Fragment>
            )}
            <div className="bp-video-actions">
              <button type="button" className="btn btn-primary" onClick={save}>Add to this bullpen</button>
              {window.VideoExport && <button type="button" className="btn btn-secondary" title="Make an MP4 with the TrackMan numbers straight from this file, without uploading it (any size; nothing is kept)" onClick={exportLocal}>Export without uploading</button>}
              <button type="button" className="btn btn-secondary" onClick={() => setPlan(null)}>Cancel</button>
            </div>
            {local && <ExportDialog session={{ ...session, video: local }} athlete={athlete} onClose={closeLocal} />}
          </div>
        )}
      </div>
    );
  }

  // ---- an MP4 of the bullpen, to download ----------------------------------------------------------------------------
  // The pitches picked, one after another, each with its TrackMan numbers in a panel (on the right, or along the bottom
  // for a phone), the DST logo, and for an Edgertronic video the pitch's ball spinning as Pitch Design draws it and
  // where its movement sits among the session's. Made in the browser when asked (video_export.js) and downloaded;
  // nothing is stored.
  // the pitch numbers typed ("3, 7, 12-15"), or null for any
  const parseNos = (text) => {
    const s = String(text || "").trim();
    if (!s) return null;
    const out = new Set();
    s.split(/[,\s]+/).forEach((part) => { const m = part.match(/^(\d+)(?:-(\d+))?$/); if (!m) return; const a = Number(m[1]), b = Number(m[2] || m[1]); for (let k = Math.min(a, b); k <= Math.max(a, b); k++) out.add(k); });
    return out;
  };
  function ExportDialog({ session, athlete, onClose }) {
    const B = window.BullpenBall, VE = window.VideoExport;
    const phone = (session.video && session.video.camera) === "phone";
    const live = (session.pitches || []).filter((p) => !p.removed && hasClip(session, p.no)).sort((a, b) => a.no - b.no);
    const types = [...new Set(live.map((p) => p.type || "Untagged"))];
    const [layout, setLayout] = useState(VE && VE.isPhone() ? "vertical" : "horizontal");
    const [onTypes, setOnTypes] = useState(() => new Set(types));
    const [only, setOnly] = useState("");
    const [rate, setRate] = useState(1);
    const [ball, setBall] = useState(!phone);
    const [plot, setPlot] = useState(true);
    const [title, setTitle] = useState(true);
    const [fill, setFill] = useState(false);
    // a tall video (a phone held upright) suits the vertical shape: start there unless it's been picked
    const picked = useRef(false);
    useEffect(() => {
      const first = live[0] && session.video.files[session.video.clips[live[0].no].f];
      if (!first) return undefined;
      let off = false;
      linkOf(first).then((u) => {
        const v = document.createElement("video");
        v.preload = "metadata"; v.muted = true;
        v.onloadedmetadata = () => { if (!off && !picked.current && v.videoHeight > v.videoWidth) setLayout("vertical"); v.removeAttribute("src"); v.load(); };
        v.src = u;
      }, () => {});
      return () => { off = true; };
    }, []); // eslint-disable-line
    const [busy, setBusy] = useState(null); // { text, f }
    const [err, setErr] = useState("");
    const [made, setMade] = useState(null); // { blob, name }
    const stop = useRef(false);
    const nos = parseNos(only);
    const chosen = live.filter((p) => onTypes.has(p.type || "Untagged") && (!nos || nos.has(p.no)));
    const color = window.BullpenCut.colorOf;
    const go = async () => {
      setErr(""); setMade(null); stop.current = false;
      setBusy({ text: "Getting the clips…", f: 0 });
      try {
        const segments = [];
        for (let i = 0; i < chosen.length; i++) {
          const p = chosen[i], file = session.video.files[session.video.clips[p.no].f];
          segments.push(window.BullpenCut.pitchSegment({ session, athlete, p, i, count: chosen.length, url: await linkOf(file), rate, ball, plot }));
        }
        const blob = await VE.render({
          layout, fill, segments, cancelled: () => stop.current,
          title: title ? { lines: [athlete.name || "", `Bullpen · ${fmtDay(session.date)}`, `${chosen.length} pitch${chosen.length === 1 ? "" : "es"}${session.facility ? ` · ${session.facility}` : ""}`] } : null,
          onProgress: (text, f) => setBusy({ text, f }),
        });
        const name = VE.fileName(athlete.name, `bullpen-${layout}`, session.date, blob);
        setBusy(null);
        // (a phone that won't open its share sheet this long after the tap gets a Save video button instead)
        const how = await VE.download(blob, name, { share: VE.isPhone() });
        setMade({ blob, name, tap: how === "tap" });
      } catch (e) {
        setBusy(null);
        if ((e && e.message) !== "cancelled") setErr((e && e.message) || String(e));
      }
    };
    const box = (label, on, set, title2) => <label className="bp-video-loop" title={title2}><input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} /> {label}</label>;
    return ReactDOM.createPortal(
      <div className="bp-zoom" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
        <div className="bp-zoom-card bp-export-card" role="dialog" aria-label="Export a video of this bullpen">
          <div className="bp-zoom-head">
            <h3 className="bp-video-title">Export video <small>{athlete.name} · {fmtDay(session.date)}</small></h3>
            <button type="button" className="bp-mod-btn bp-zoom-close" disabled={!!busy} onClick={onClose}>✕ Close</button>
          </div>
          {!VE || !VE.supported() ? <p className="assess-row-note">This browser can't make videos. Use Chrome or Edge on a computer, Chrome on Android, or a recent iPhone.</p> : (
            <div className="bp-export">
              <div className="bp-export-row">
                <b>Shape</b>
                <span className="bp-export-seg">
                  {[["horizontal", "Horizontal", "16:9, numbers on the right: a computer or TV"], ["vertical", "Vertical", "9:16, numbers along the bottom: a phone"]].map(([k, l, t]) => <button key={k} type="button" className={`bp-mod-btn${layout === k ? " on" : ""}`} aria-pressed={layout === k} title={t} onClick={() => { picked.current = true; setLayout(k); }}>{l}</button>)}
                </span>
              </div>
              <div className="bp-export-row">
                <b>Pitches</b>
                {types.map((t) => <label key={t} className="bp-video-loop" style={{ color: color(t) }}><input type="checkbox" checked={onTypes.has(t)} onChange={(e) => { const n = new Set(onTypes); if (e.target.checked) n.add(t); else n.delete(t); setOnTypes(n); }} /> {t} ({live.filter((p) => (p.type || "Untagged") === t).length})</label>)}
                <input className="bp-export-only" value={only} placeholder="Only #: 3, 7, 12-15" aria-label="Only these pitch numbers" onChange={(e) => setOnly(e.target.value)} />
              </div>
              <div className="bp-export-row">
                <b>Show</b>
                {box("Title card", title, setTitle, "Two seconds of his name, the date and the pitches first")}
                {box("The ball spinning", ball, setBall, "Each pitch's spin as Pitch Design draws it (made for Edgertronic video)")}
                {box("Movement plot", plot, setPlot, "Where this pitch's IVB and HB sit among the session's")}
                {box("Fill the frame", fill, setFill, "Zoom the video in to fill its area, trimming the edges, instead of showing all of it with bars beside it")}
                <select className="bp-tag" value={rate} aria-label="Speed" onChange={(e) => setRate(Number(e.target.value))}>
                  <option value={1}>Speed as filmed</option><option value={0.5}>½ speed</option><option value={0.25}>¼ speed</option>
                </select>
              </div>
              <p className="timestamp-note">{chosen.length} pitch{chosen.length === 1 ? "" : "es"} with video. It's made on this {VE.isPhone() ? "phone" : "computer"} (about as long as the video runs, a little longer if this window is behind another; keep this tab open) and goes to your downloads. Nothing is saved to the dashboard.</p>
              {busy ? (
                <div className="bp-export-busy">
                  <progress max={1} value={busy.f || 0} /> <span className="assess-row-note" role="status">{busy.text} {Math.round((busy.f || 0) * 100)}%</span>
                  <button type="button" className="btn btn-small-grey" onClick={() => { stop.current = true; }}>Cancel</button>
                </div>
              ) : (
                <div className="bp-video-actions">
                  <button type="button" className="btn btn-primary" disabled={!chosen.length} onClick={go}>Make the video</button>
                  {made && <button type="button" className={`btn ${made.tap ? "btn-primary" : "btn-secondary"}`} onClick={async () => { if ((await VE.download(made.blob, made.name, { share: VE.isPhone() })) === "done") setMade({ ...made, tap: false }); }}>{VE.isPhone() ? "Save video" : "Download again"}</button>}
                  {made && <span className="assess-row-note" role="status">{made.tap ? `Ready: tap Save video, then Save Video in the share sheet to put it in Photos (${Math.max(1, Math.round(made.blob.size / 1048576))} MB).` : `Done: ${made.name} (${Math.max(1, Math.round(made.blob.size / 1048576))} MB)`}</span>}
                </div>
              )}
              {err && <p className="assess-row-note" style={{ color: "var(--danger)" }}>{err}</p>}
            </div>
          )}
        </div>
      </div>,
      document.body
    );
  }

  function CamIcon() {
    return <svg className="bp-cam-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M4 6h10.5A2.5 2.5 0 0 1 17 8.5v1.3l3.6-2.4A.9.9 0 0 1 22 8.2v7.6a.9.9 0 0 1-1.4.8L17 14.2v1.3a2.5 2.5 0 0 1-2.5 2.5H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z" /></svg>;
  }
  function CameraButton({ onClick, label, text }) {
    return <button type="button" className={`bp-cam${text ? " with-text" : ""}`} title={label} aria-label={label} onClick={onClick}><CamIcon />{text ? <span>{text}</span> : null}</button>;
  }

  // ---- watching a pitch ------------------------------------------------------------------------------------------

  function PitchVideo({ session, no, onNo, onClose, onChange, describe }) {
    const ref = useRef(null);
    const [src, setSrc] = useState("");
    const [err, setErr] = useState("");
    const [rate, setRate] = useState(1);
    const [loop, setLoop] = useState(true);
    const nos = pitchNos(session).filter((n) => hasClip(session, n));
    const clip = hasClip(session, no) ? session.video.clips[no] : null;
    const file = clip ? session.video.files[clip.f] : null;
    useEffect(() => {
      let off = false;
      setErr("");
      if (!file) { setSrc(""); return undefined; }
      linkOf(file).then((u) => { if (!off) setSrc(u); }, (e) => { if (!off) setErr(e.message || String(e)); });
      return () => { off = true; };
    }, [file && (file.path || file.drive || file.url)]); // eslint-disable-line
    // to the pitch's own stretch, and keep it there
    const start = clip && clip.start != null ? clip.start : 0;
    const end = clip && clip.end != null ? clip.end : null;
    const toStart = () => { const v = ref.current; if (v && v.readyState >= 1) { v.currentTime = start; v.play().catch(() => {}); } };
    useEffect(() => { toStart(); }, [no, src]); // eslint-disable-line
    useEffect(() => { if (ref.current) ref.current.playbackRate = rate; }, [rate, src]);
    const onTime = () => {
      const v = ref.current;
      if (!v || end == null) return;
      if (v.currentTime >= end - 0.02) { if (loop) v.currentTime = start; else { v.pause(); v.currentTime = end - 0.02; } }
      else if (v.currentTime < start - 0.05) v.currentTime = start;
    };
    const step = (frames) => { const v = ref.current; if (!v) return; v.pause(); v.currentTime = Math.max(start, Math.min(end != null ? end : v.duration || 0, v.currentTime + frames / 30)); };
    const i = nos.indexOf(no);
    const go = (d) => { if (nos.length) onNo(nos[(i + d + nos.length) % nos.length]); };
    useEffect(() => {
      const key = (e) => {
        if (e.target && /input|select|textarea/i.test(e.target.tagName)) return;
        if (e.key === "Escape") onClose();
        else if (e.key === "ArrowRight") go(1);
        else if (e.key === "ArrowLeft") go(-1);
        else if (e.key === ".") step(1);
        else if (e.key === ",") step(-1);
      };
      document.addEventListener("keydown", key);
      return () => document.removeEventListener("keydown", key);
    });
    const shift = (d) => {
      const next = shiftClips(session, no, d);
      if (!next) return;
      onChange(next);
      const all = pitchNos(session), n = all[all.indexOf(no) + d];
      if (n != null) onNo(n); // follow the clip to the pitch it's on now
    };
    return ReactDOM.createPortal(
      <div className="bp-zoom" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="bp-zoom-card bp-video-card" role="dialog" aria-label={`Pitch ${no} video`}>
          <div className="bp-zoom-head">
            <h3 className="bp-video-title">Pitch #{no}{describe ? <small> {describe(no)}</small> : null}</h3>
            <button type="button" className="bp-mod-btn bp-zoom-close" onClick={onClose}>✕ Close</button>
          </div>
          <div className="bp-video-stage">
            {nos.length > 1 && <button type="button" className="bp-zoom-step" aria-label="Previous pitch with video" onClick={() => go(-1)}>‹</button>}
            {err ? <p className="assess-row-note">{err}</p>
              : !clip ? <p className="assess-row-note">This pitch has no clip.</p>
              : src ? <video key={src} ref={ref} className="bp-video" src={src} controls muted playsInline autoPlay onLoadedMetadata={toStart} onTimeUpdate={onTime} />
              : <p className="assess-row-note">Loading…</p>}
            {nos.length > 1 && <button type="button" className="bp-zoom-step" aria-label="Next pitch with video" onClick={() => go(1)}>›</button>}
          </div>
          <div className="bp-video-ctl">
            <button type="button" className="bp-mod-btn" onClick={() => step(-1)} title="Back a frame (,)">◀ Frame</button>
            <button type="button" className="bp-mod-btn" onClick={() => step(1)} title="Forward a frame (.)">Frame ▶</button>
            <select className="bp-tag" value={rate} aria-label="Playback speed" onChange={(e) => setRate(Number(e.target.value))}>
              <option value={0.25}>Speed ¼×</option><option value={0.5}>Speed ½×</option><option value={1}>Speed 1×</option><option value={2}>Speed 2×</option>
            </select>
            <label className="bp-video-loop"><input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} /> Loop</label>
            {onChange && clip && (
              <span className="bp-video-shift">
                <span className="timestamp-note">Wrong pitch? Move this clip and every one after it:</span>
                <button type="button" className="bp-mod-btn" disabled={pitchNos(session).indexOf(no) === 0} onClick={() => shift(-1)}>← A pitch earlier</button>
                <button type="button" className="bp-mod-btn" onClick={() => shift(1)}>A pitch later →</button>
              </span>
            )}
          </div>
          <p className="timestamp-note">← → step through the pitches with video, , and . step a frame, Esc closes.</p>
        </div>
      </div>,
      document.body
    );
  }

  window.BullpenVideo = { VideoBar, PitchVideo, CameraButton, ExportDialog, removeFiles, hasClip, splitAt, splitByMotion, scanVideo, linkOf };
})();
