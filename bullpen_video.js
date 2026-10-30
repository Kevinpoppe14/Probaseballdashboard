// Bullpen video — Edgertronic clips synced to a bullpen's pitches (bullpens.js). The clips are kept in the private
// "bullpen-videos" storage bucket (supabase/migration_031_bullpen_videos.sql) and watched through links that last an
// hour. A session's record carries video: { files: [{ path, name, size }], clips: { [pitch no]: { f, start, end } } }:
// f is which file holds the pitch, start/end (seconds) its stretch of that file when one long video holds them all.
// Two ways in:
//   one clip per pitch, as the Edgertronic saves them: matched to the pitches in order, by file name
//   one long video: scanned in the browser for its cuts (the jump from one frame to the next where a clip ends and
//     the next begins) and split there without re-encoding; each pitch just plays its own stretch
// Every pitch thrown is matched, taken-out ones too (they were still filmed). A clip that lands on the wrong pitch (a
// missed trigger, an extra clip) is fixed from the player by moving it, and every clip after it, a pitch either way.
//   window.BullpenVideo = { VideoBar, PitchVideo, CameraButton, removeFiles, hasClip }
(function () {
  const { useState, useRef, useEffect } = React;
  const BUCKET = "bullpen-videos";
  const sb = () => window.supabaseClient;
  const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const mb = (n) => `${Math.round(n / 1048576)} MB`;
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
  const pitchNos = (session) => (session.pitches || []).map((p) => p.no).sort((a, b) => a - b);
  const hasClip = (session, no) => !!(session && session.video && session.video.clips && session.video.clips[no]);

  // a watchable link for a stored clip, kept until shortly before it runs out
  const links = new Map();
  async function linkOf(file) {
    if (file.url) return file.url; // not uploaded yet (a preview)
    const hit = links.get(file.path);
    if (hit && hit.until > Date.now()) return hit.url;
    const { data, error } = await sb().storage.from(BUCKET).createSignedUrl(file.path, 3600);
    if (error || !data) throw new Error(/not found/i.test((error && error.message) || "") ? "The video file isn't in storage any more." : "Couldn't open the video. Check your connection.");
    links.set(file.path, { url: data.signedUrl, until: Date.now() + 50 * 60 * 1000 });
    return data.signedUrl;
  }
  async function upload(file, athleteId, sessionId) {
    const ext = ((file.name || "").match(/\.(\w{2,4})$/) || [])[1] || (/quicktime/i.test(file.type) ? "mov" : "mp4");
    const path = `${athleteId}/${sessionId}/${uid()}.${ext.toLowerCase()}`;
    const { error } = await sb().storage.from(BUCKET).upload(path, file, { contentType: file.type || (ext.toLowerCase() === "mov" ? "video/quicktime" : "video/mp4"), cacheControl: "31536000", upsert: false });
    if (error) {
      const m = error.message || "";
      if (/bucket not found/i.test(m)) throw new Error("Video storage isn't set up yet: run supabase/migration_031_bullpen_videos.sql in the SQL Editor.");
      if (/maximum allowed size|too large|413/i.test(m)) throw new Error(`${file.name} is ${mb(file.size)}, more than storage takes for one file. Raise the upload limit in Supabase (Storage settings) or export it smaller.`);
      if (/row-level security|unauthorized|jwt/i.test(m)) throw new Error("Sign in with your dashboard account to add video.");
      throw new Error(`Couldn't upload ${file.name}. Check your connection and try again.`);
    }
    return { path, name: file.name, size: file.size };
  }
  async function removeFiles(video) {
    const paths = ((video && video.files) || []).map((f) => f.path).filter(Boolean);
    if (paths.length) await sb().storage.from(BUCKET).remove(paths).catch(() => null);
  }

  // ---- finding the cuts in one long video ----------------------------------------------------------------------
  // The video plays, muted and fast, into a small canvas; each frame shown is compared with the one before it (mean
  // brightness change per pixel). Within a clip that change is small (a pitcher moving); at a cut the whole picture
  // jumps. Returns every frame it saw: { t, d }.
  async function scanVideo(file, onProgress) {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.muted = true; v.playsInline = true; v.preload = "auto"; v.src = url;
    try {
      await new Promise((ok, bad) => { v.onloadeddata = ok; v.onerror = () => bad(new Error("This browser can't play that video file. Export it as an MP4 (H.264).")); });
      let dur = v.duration;
      if (dur === Infinity) { // some files (browser recordings) don't say: running off the end makes it find out
        dur = await new Promise((ok) => { v.ontimeupdate = () => { v.ontimeupdate = null; ok(v.duration); }; v.currentTime = 1e9; });
        await new Promise((ok) => { v.onseeked = ok; v.currentTime = 0; });
      }
      if (!Number.isFinite(dur) || dur <= 0) throw new Error("Couldn't tell how long that video is.");
      const W = 64, H = 36, cv = document.createElement("canvas");
      cv.width = W; cv.height = H;
      const ctx = cv.getContext("2d", { willReadFrequently: true });
      const out = [];
      let prev = null;
      const grab = (t) => {
        ctx.drawImage(v, 0, 0, W, H);
        const px = ctx.getImageData(0, 0, W, H).data, g = new Float32Array(W * H);
        let d = 0;
        for (let i = 0; i < g.length; i++) { g[i] = px[i * 4] * 0.299 + px[i * 4 + 1] * 0.587 + px[i * 4 + 2] * 0.114; if (prev) d += Math.abs(g[i] - prev[i]); }
        out.push({ t, d: prev ? d / g.length : 0 });
        prev = g;
      };
      if (v.requestVideoFrameCallback) {
        await new Promise((ok, bad) => {
          const onFrame = (now, meta) => { grab(meta.mediaTime); onProgress(Math.min(1, meta.mediaTime / dur)); if (!v.ended) v.requestVideoFrameCallback(onFrame); };
          v.requestVideoFrameCallback(onFrame);
          v.onended = ok;
          v.onerror = () => bad(new Error("The video stopped playing partway through."));
          v.playbackRate = 4; // fast enough to scan a long video in a quarter of its length, slow enough to see most frames
          v.play().catch(bad);
        });
      } else {
        for (let t = 0; t < dur; t += 0.15) {
          await new Promise((ok) => { v.onseeked = ok; v.currentTime = t; });
          grab(t); onProgress(t / dur);
        }
      }
      return { dur, frames: out };
    } finally {
      v.removeAttribute("src"); v.load();
      URL.revokeObjectURL(url);
    }
  }
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

  // ---- adding video to a session ---------------------------------------------------------------------------------
  function VideoBar({ session, athlete, onSave }) {
    const nos = pitchNos(session);
    const video = session.video && session.video.files && session.video.files.length ? session.video : null;
    const matched = video ? nos.filter((n) => video.clips[n]).length : 0;
    const fileRef = useRef(null);
    const [plan, setPlan] = useState(null); // { kind: "many", files } | { kind: "one", file, scan, n }
    const [busy, setBusy] = useState("");
    const [msg, setMsg] = useState("");
    const pick = async (e) => {
      const files = [...(e.target.files || [])].filter((f) => /^video\//i.test(f.type || "video/") || /\.(mov|mp4|m4v)$/i.test(f.name));
      e.target.value = "";
      setMsg("");
      if (!files.length) return;
      if (files.length > 1 || nos.length <= 1) { setPlan({ kind: "many", files: files.sort(byName) }); return; }
      setBusy("Finding the cuts… 0%");
      try {
        const scan = await scanVideo(files[0], (p) => setBusy(`Finding the cuts… ${Math.round(p * 100)}%`));
        setPlan({ kind: "one", file: files[0], scan, n: nos.length });
      } catch (err) { setMsg(err.message || String(err)); }
      setBusy("");
    };
    const split = plan && plan.kind === "one" ? splitAt(plan.scan, plan.n) : null;
    const save = async () => {
      const files = plan.kind === "many" ? plan.files : [plan.file];
      const stored = [];
      try {
        for (let i = 0; i < files.length; i++) {
          setBusy(files.length > 1 ? `Uploading ${i + 1} of ${files.length}…` : `Uploading ${mb(files[0].size)}…`);
          stored.push(await upload(files[i], athlete.id, session.id));
        }
      } catch (err) {
        await removeFiles({ files: stored });
        setBusy(""); setMsg(err.message || String(err));
        return;
      }
      const clips = {};
      if (plan.kind === "many") nos.forEach((n, i) => { if (i < stored.length) clips[n] = { f: i }; });
      else nos.forEach((n, i) => { const s = split.segs[i]; if (s) clips[n] = { f: 0, start: Math.round(s.start * 1000) / 1000, end: Math.round(s.end * 1000) / 1000 }; });
      const old = video;
      onSave({ files: stored, clips, addedAt: new Date().toISOString(), addedBy: (window.AthleteStore.currentUserEmail && window.AthleteStore.currentUserEmail()) || "" });
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
        <span className="bp-video-label"><CamIcon /> Edgertronic video</span>
        {video
          ? <span className="timestamp-note">{video.files.length === 1 && nos.length > 1 ? "One video, split at its cuts" : `${video.files.length} clip${video.files.length === 1 ? "" : "s"}`} · {matched} of {nos.length} pitches have a clip</span>
          : !plan && !busy && <span className="timestamp-note">Add the clips (one per pitch, as the camera saves them) or one long video, and each pitch gets its own.</span>}
        {!plan && !busy && <button type="button" className="btn btn-secondary" onClick={() => fileRef.current && fileRef.current.click()}>{video ? "Replace video" : "Add video"}</button>}
        {video && !plan && !busy && <button type="button" className="btn btn-small-grey" onClick={drop}>Remove video</button>}
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
                  {split.seems !== plan.n && <span className="bp-video-warn"> The video looks like it has about {split.seems} clips. <button type="button" className="bp-link" onClick={() => setPlan({ ...plan, n: split.seems })}>Use {split.seems}</button></span>}
                  {split.seems === plan.n && split.clear < 2 && <span className="bp-video-warn"> Some cuts are faint, so check a few pitches after it's added.</span>}
                </p>
                <p className="timestamp-note">Clip lengths: {split.segs.map((s) => `${(s.end - s.start).toFixed(1)}s`).join(", ")}</p>
              </React.Fragment>
            )}
            <div className="bp-video-actions">
              <button type="button" className="btn btn-primary" onClick={save}>Add to this bullpen</button>
              <button type="button" className="btn btn-secondary" onClick={() => setPlan(null)}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    );
  }

  function CamIcon() {
    return <svg className="bp-cam-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M4 6h10.5A2.5 2.5 0 0 1 17 8.5v1.3l3.6-2.4A.9.9 0 0 1 22 8.2v7.6a.9.9 0 0 1-1.4.8L17 14.2v1.3a2.5 2.5 0 0 1-2.5 2.5H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z" /></svg>;
  }
  function CameraButton({ onClick, label, text }) {
    return <button type="button" className={`bp-cam${text ? " with-text" : ""}`} title={label} aria-label={label} onClick={onClick}><CamIcon />{text ? <span>{text}</span> : null}</button>;
  }

  // ---- watching a pitch ------------------------------------------------------------------------------------------
  // moves the clip on pitch `fromNo`, and every one after it, a pitch later (d = 1) or earlier (d = -1)
  function shiftClips(session, fromNo, d) {
    const nos = pitchNos(session), i0 = nos.indexOf(fromNo), video = session.video;
    if (i0 < 0 || (d < 0 && i0 === 0)) return null;
    const clips = { ...video.clips };
    const tail = nos.slice(i0).map((n) => video.clips[n] || null);
    nos.slice(i0).forEach((n) => { delete clips[n]; });
    tail.forEach((c, k) => { const n = nos[i0 + k + d]; if (c && n != null) clips[n] = c; });
    return { ...video, clips };
  }

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
    }, [file && (file.path || file.url)]); // eslint-disable-line
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

  window.BullpenVideo = { VideoBar, PitchVideo, CameraButton, removeFiles, hasClip, splitAt, scanVideo };
})();
