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
(function () {
  const { useState, useRef, useEffect } = React;
  const BUCKET = "bullpen-videos";
  const sb = () => window.supabaseClient;
  const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const mb = (n) => `${Math.round(n / 1048576)} MB`;
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
  const pitchNos = (session) => (session.pitches || []).map((p) => p.no).sort((a, b) => a - b);
  const hasClip = (session, no) => !!(session && session.video && session.video.clips && session.video.clips[no]);

  // ---- Google Drive (api/drive-video.js) -----------------------------------------------------------------------------
  // Once it's set up, new video goes to the company's Google Drive (any size, a folder per athlete) instead of storage
  // here; a file kept there is { drive: id, name, size }. Video already in storage stays there and plays as before.
  async function driveApi(body) {
    const { data } = await sb().auth.getSession();
    const token = data && data.session && data.session.access_token;
    if (!token) throw new Error("Sign in with your dashboard account to add video.");
    const res = await fetch("/api/drive-video", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || `Google Drive didn't answer (${res.status}).`);
    return out;
  }
  let driveOn = null; // whether Drive is set up: asked once
  const useDrive = () => driveOn || (driveOn = driveApi({ action: "status" }).then((r) => !!r.configured, () => false));
  let readToken = null;
  const driveToken = async () => {
    if (readToken && readToken.expiresAt - Date.now() > 120000) return readToken.accessToken;
    readToken = await driveApi({ action: "token" });
    return readToken.accessToken;
  };
  // sent straight to Drive from here, 32 MB at a time (a dropped connection picks up where it got to)
  async function driveUpload(file, athleteId, athleteName, sessionId, onProgress) {
    const type = file.type || (/\.mov$/i.test(file.name) ? "video/quicktime" : "video/mp4");
    const { uploadUrl } = await driveApi({ action: "start", name: file.name || "video.mp4", mimeType: type, size: file.size, athleteId, athleteName, sessionId });
    const CHUNK = 32 * 1024 * 1024;
    const put = (from, to, tries = 0) => new Promise((ok, bad) => {
      const x = new XMLHttpRequest();
      x.open("PUT", uploadUrl);
      if (file.size) x.setRequestHeader("Content-Range", `bytes ${from}-${to - 1}/${file.size}`);
      x.upload.onprogress = (e) => onProgress && onProgress((from + e.loaded) / file.size);
      x.onload = () => ok(x);
      x.onerror = () => (tries < 3 ? setTimeout(() => put(from, to, tries + 1).then(ok, bad), 2000 * (tries + 1)) : bad(new Error(`Couldn't upload ${file.name} to Google Drive. Check your connection and try again.`)));
      x.send(file.slice(from, to));
    });
    let from = 0;
    for (;;) {
      const x = await put(from, Math.min(file.size, from + CHUNK));
      if (x.status === 200 || x.status === 201) { const f = JSON.parse(x.responseText); return { drive: f.id, name: file.name, size: file.size }; }
      if (x.status !== 308) throw new Error(`Google Drive stopped the upload of ${file.name} (${x.status}).`);
      const got = x.getResponseHeader("Range"); // "bytes=0-N": what it has so far
      from = got ? Number(got.split("-")[1]) + 1 : from;
    }
  }

  // a watchable link for a stored clip: storage's lasts an hour (kept until shortly before it runs out); a Drive
  // file is brought down once with a token (Drive won't take one in a link) and played from memory
  const links = new Map();
  async function linkOf(file) {
    if (file.url) return file.url; // not uploaded yet (a preview), or a file on this device
    if (file.drive) {
      if (!links.has(file.drive)) {
        const p = (async () => {
          const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.drive)}?alt=media&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${await driveToken()}` } });
          if (res.status === 404) throw new Error("The video isn't in Google Drive any more.");
          if (!res.ok) throw new Error("Couldn't open the video from Google Drive. Check your connection.");
          return URL.createObjectURL(await res.blob());
        })();
        links.set(file.drive, p);
        p.catch(() => links.delete(file.drive));
      }
      return links.get(file.drive);
    }
    const hit = links.get(file.path);
    if (hit && hit.until > Date.now()) return hit.url;
    const { data, error } = await sb().storage.from(BUCKET).createSignedUrl(file.path, 3600);
    if (error || !data) throw new Error(/not found/i.test((error && error.message) || "") ? "The video file isn't in storage any more." : "Couldn't open the video. Check your connection.");
    links.set(file.path, { url: data.signedUrl, until: Date.now() + 50 * 60 * 1000 });
    return data.signedUrl;
  }
  // into Google Drive once it's set up, otherwise into storage here
  async function upload(file, athlete, sessionId, onProgress) {
    if (await useDrive()) return driveUpload(file, athlete.id, athlete.name, sessionId, onProgress);
    const athleteId = athlete.id;
    const ext = ((file.name || "").match(/\.(\w{2,4})$/) || [])[1] || (/quicktime/i.test(file.type) ? "mov" : "mp4");
    const path = `${athleteId}/${sessionId}/${uid()}.${ext.toLowerCase()}`;
    const { error } = await sb().storage.from(BUCKET).upload(path, file, { contentType: file.type || (ext.toLowerCase() === "mov" ? "video/quicktime" : "video/mp4"), cacheControl: "31536000", upsert: false });
    if (error) {
      const m = error.message || "";
      if (/bucket not found/i.test(m)) throw new Error("Video storage isn't set up yet: run supabase/migration_031_bullpen_videos.sql in the SQL Editor.");
      if (/maximum allowed size|too large|413/i.test(m)) throw new Error(`${file.name} is ${mb(file.size)}, more than storage here takes for one file. Set up Google Drive video storage (api/drive-video.js) for any size, or export it smaller.`);
      if (/row-level security|unauthorized|jwt/i.test(m)) throw new Error("Sign in with your dashboard account to add video.");
      throw new Error(`Couldn't upload ${file.name}. Check your connection and try again.`);
    }
    return { path, name: file.name, size: file.size };
  }
  async function removeFiles(video) {
    const files = (video && video.files) || [];
    const paths = files.map((f) => f.path).filter(Boolean), ids = files.map((f) => f.drive).filter(Boolean);
    if (paths.length) await sb().storage.from(BUCKET).remove(paths).catch(() => null);
    if (ids.length) await driveApi({ action: "delete", ids }).catch(() => null); // to the Drive's trash
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
      if (v.requestVideoFrameCallback && document.visibilityState === "visible") {
        await new Promise((ok, bad) => {
          const onFrame = (now, meta) => { grab(meta.mediaTime); onProgress(Math.min(1, meta.mediaTime / dur)); if (!v.ended) v.requestVideoFrameCallback(onFrame); };
          v.requestVideoFrameCallback(onFrame);
          v.onended = ok;
          v.onerror = () => bad(new Error("The video stopped playing partway through."));
          v.playbackRate = 4; // fast enough to scan a long video in a quarter of its length, slow enough to see most frames
          v.play().catch(bad);
        });
      }
      // a window that's hidden or behind another one hands over few frames as it plays: step through it instead
      if (out.length < dur * 6) {
        out.length = 0; prev = null;
        for (let t = 0; t < dur; t += 0.1) {
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
  // A phone left recording the whole bullpen has no cuts to find: each pitch is where the picture moves most (the
  // delivery), the n busiest moments at least a few seconds apart, each taken from `before` seconds ahead of it to
  // `after` seconds past it.
  function splitByMotion(scan, n, before = 2.5, after = 1.5) {
    const { frames, dur } = scan;
    const sm = frames.map((f, i) => {
      let s = 0, c = 0;
      for (let j = i; j >= 0 && f.t - frames[j].t <= 0.25; j--) { s += frames[j].d; c++; }
      for (let j = i + 1; j < frames.length && frames[j].t - f.t <= 0.25; j++) { s += frames[j].d; c++; }
      return { t: f.t, m: s / c };
    });
    const minGap = Math.max(3, Math.min(8, (dur / Math.max(1, n)) * 0.5));
    const peaks = sm.filter((p, i) => i > 0 && i < sm.length - 1 && p.m >= sm[i - 1].m && p.m >= sm[i + 1].m).sort((a, b) => b.m - a.m);
    const picked = [];
    for (const p of peaks) { if (picked.length >= n) break; if (picked.every((q) => Math.abs(q.t - p.t) >= minGap)) picked.push(p); }
    picked.sort((a, b) => a.t - b.t);
    return { segs: picked.map((p) => ({ start: Math.max(0, p.t - before), end: Math.min(dur, p.t + after) })), clear: 99, seems: picked.length };
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
        setPlan({ kind: "one", file: files[0], scan, n: nos.length });
      } catch (err) { setMsg(err.message || String(err)); }
      setBusy("");
    };
    const split = plan && plan.kind === "one" ? (camera === "phone" ? splitByMotion(plan.scan, plan.n) : splitAt(plan.scan, plan.n)) : null;
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
                    ? <span className="bp-video-warn"> Each pitch is found by the motion of the delivery (2.5 s before it to 1.5 s after){split.seems < plan.n ? `, and only ${split.seems} were found` : ""}: check a few after it's added, and move clips from the player if one is off.</span>
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
  const fmtDay = (key) => { const d = new Date(`${key}T00:00:00`); return isNaN(d) ? key || "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); };
  const numOrNull = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
  const inches = (v, d = 1) => (numOrNull(v) == null ? null : `${Number(v).toFixed(d)}"`);
  const ftIn = (v) => { const n = numOrNull(v); if (n == null) return null; const ft = Math.floor(Math.abs(n)), inch = Math.round((Math.abs(n) - ft) * 12); return `${n < 0 ? "-" : ""}${inch === 12 ? ft + 1 : ft}' ${inch === 12 ? 0 : inch}"`; };
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
    const color = (t) => (B ? B.colorOf(t) : "#c8102e");
    // where this pitch's movement sits among the session's
    const plotWidget = (p) => (g, x, y, s) => {
      g.fillStyle = "rgba(255,255,255,0.04)"; g.fillRect(x, y, s, s);
      g.strokeStyle = "rgba(255,255,255,0.14)"; g.lineWidth = 1.5;
      const cx = x + s / 2, cy = y + s / 2, k = (s / 2 - 10) / 25; // ±25 inches across
      g.beginPath(); g.moveTo(x + 6, cy); g.lineTo(x + s - 6, cy); g.moveTo(cx, y + 6); g.lineTo(cx, y + s - 6); g.stroke();
      g.fillStyle = "rgba(255,255,255,0.55)"; g.font = `600 ${Math.round(s / 16)}px Arial, sans-serif`; g.textAlign = "left";
      g.fillText("IVB", cx + 6, y + s / 14 + 6); g.textAlign = "right"; g.fillText("HB", x + s - 8, cy - 8); g.textAlign = "left";
      const at = (q) => [cx + Math.max(-25, Math.min(25, numOrNull(q.hb) || 0)) * k, cy - Math.max(-25, Math.min(25, numOrNull(q.ivb) || 0)) * k];
      (session.pitches || []).filter((q) => !q.removed).forEach((q) => { if (numOrNull(q.ivb) == null || numOrNull(q.hb) == null) return; const [px, py] = at(q); g.globalAlpha = 0.45; g.fillStyle = color(q.type); g.beginPath(); g.arc(px, py, s / 55, 0, 2 * Math.PI); g.fill(); });
      g.globalAlpha = 1;
      if (numOrNull(p.ivb) != null && numOrNull(p.hb) != null) { const [px, py] = at(p); g.fillStyle = color(p.type); g.beginPath(); g.arc(px, py, s / 26, 0, 2 * Math.PI); g.fill(); g.strokeStyle = "#fff"; g.lineWidth = 3; g.stroke(); }
    };
    const go = async () => {
      setErr(""); setMade(null); stop.current = false;
      setBusy({ text: "Getting the clips…", f: 0 });
      try {
        const segments = [];
        for (let i = 0; i < chosen.length; i++) {
          const p = chosen[i], clip = session.video.clips[p.no], file = session.video.files[clip.f];
          const url = await linkOf(file);
          const revPerSec = numOrNull(p.spin) ? p.spin / 9600 : 0; // as Pitch Design spins it at 1x
          segments.push({
            url, start: clip.start || 0, end: clip.end != null ? clip.end : null, rate,
            panel: (g, box, info) => VE.panel(g, box, {
              name: athlete.name, sub: [fmtDay(session.date), session.facility].filter(Boolean).join(" · "),
              tag: [p.type || "Pitch", color(p.type)], tagNote: `#${p.no} · ${i + 1} of ${chosen.length}`,
              big: numOrNull(p.speed) != null ? [Number(p.speed).toFixed(1), "mph"] : null,
              rows: [["Spin", numOrNull(p.spin) != null ? `${Math.round(p.spin)} rpm` : null], ["Tilt", p.tilt || null], ["IVB", inches(p.ivb)], ["HB", inches(p.hb)],
                ["Spin eff.", numOrNull(p.spinEff) != null ? `${Math.round(p.spinEff)}%` : null], ["Extension", ftIn(p.extension)], ["Rel. height", ftIn(p.relHeight)], ["Rel. side", ftIn(p.relSide)],
                ["VAA", numOrNull(p.vaa) != null ? `${Number(p.vaa).toFixed(1)}°` : null]],
              widgets: [ball && B ? (gg, x, y, s) => B.paint(gg, x, y, s, p, info.elapsed * revPerSec * 2 * Math.PI) : null, plot ? plotWidget(p) : null],
            }),
          });
        }
        const blob = await VE.render({
          layout, fill, segments, cancelled: () => stop.current,
          title: title ? { lines: [athlete.name || "", `Bullpen · ${fmtDay(session.date)}`, `${chosen.length} pitch${chosen.length === 1 ? "" : "es"}${session.facility ? ` · ${session.facility}` : ""}`] } : null,
          onProgress: (text, f) => setBusy({ text, f }),
        });
        const name = VE.fileName(athlete.name, `bullpen-${layout}`, session.date, blob);
        setMade({ blob, name });
        setBusy(null);
        VE.download(blob, name, { share: VE.isPhone() });
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
                  {made && <button type="button" className="btn btn-secondary" onClick={() => VE.download(made.blob, made.name, { share: VE.isPhone() })}>Download again</button>}
                  {made && <span className="assess-row-note" role="status">Done: {made.name} ({Math.max(1, Math.round(made.blob.size / 1048576))} MB)</span>}
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
