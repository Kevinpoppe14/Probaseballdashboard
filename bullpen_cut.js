// Bullpen video, the parts without React, shared by the dashboard's bullpens (bullpen_video.js) and a coach's phone
// app (bullpen_app.js): keeping the video (Google Drive, or storage here), finding the pitches in one long video,
// starting each pitch's clip at the top of the leg lift and ending it just after the ball gets there, and the video
// export's panel for a pitch.
//   window.BullpenCut = { upload, removeFiles, linkOf, useDrive, scanVideo, splitByMotion, cueClips, shiftClips,
//     pitchSegment, colorOf, fmtDay, flightOf }
(function () {
  const BUCKET = "bullpen-videos";
  const sb = () => window.supabaseClient;
  const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const mb = (n) => `${Math.round(n / 1048576)} MB`;
  const pitchNos = (session) => (session.pitches || []).map((p) => p.no).sort((a, b) => a - b);

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
  // (An iPhone or iPad doesn't load a video's picture until it's asked for one, so this waits only for its length,
  // then asks for the first frame. If playing it fast hands over no frames, or stops handing them over, it steps
  // through the video instead.)
  const seekWait = (v, t) => new Promise((ok) => {
    const done = () => { clearTimeout(timer); v.removeEventListener("seeked", done); ok(); };
    const timer = setTimeout(done, 4000);
    v.addEventListener("seeked", done);
    v.currentTime = Math.max(0, Math.min(t, (v.duration || t) - 0.001));
  });
  async function openForReading(v) {
    await new Promise((ok, bad) => {
      const timer = setTimeout(() => bad(new Error("The video didn't open. On an iPhone, set Settings › Camera › Formats to Most Compatible for the next one, or try it on a computer.")), 30000);
      v.addEventListener("loadedmetadata", () => { clearTimeout(timer); ok(); }, { once: true });
      v.addEventListener("error", () => { clearTimeout(timer); bad(new Error("This browser can't play that video file. Export it as an MP4 (H.264).")); }, { once: true });
      v.load();
    });
    await seekWait(v, 0.01);
  }
  async function scanVideo(file, onProgress) {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.muted = true; v.defaultMuted = true; v.playsInline = true; v.preload = "auto";
    v.setAttribute("muted", ""); v.setAttribute("playsinline", ""); v.setAttribute("webkit-playsinline", "");
    v.style.cssText = "position:fixed;left:-10000px;top:0;width:4px;height:4px;opacity:0;pointer-events:none";
    document.body.append(v); // (Safari on an iPhone or iPad won't play a video that isn't on the page)
    v.src = url;
    try {
      await openForReading(v);
      let dur = v.duration;
      if (dur === Infinity) { // some files (browser recordings) don't say: running off the end makes it find out
        dur = await new Promise((ok) => { v.ontimeupdate = () => { v.ontimeupdate = null; ok(v.duration); }; v.currentTime = 1e9; });
        await seekWait(v, 0);
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
        await new Promise((ok) => {
          let last = Date.now(), over = false;
          const finish = () => { if (over) return; over = true; clearInterval(watch); v.pause(); ok(); };
          const onFrame = (now, meta) => { if (over) return; last = Date.now(); grab(meta.mediaTime); onProgress(Math.min(1, meta.mediaTime / dur)); if (!v.ended) v.requestVideoFrameCallback(onFrame); };
          const watch = setInterval(() => { if (Date.now() - last > 5000) finish(); }, 1000); // no frames for 5 s: step through it instead
          v.requestVideoFrameCallback(onFrame);
          v.onended = finish;
          v.onerror = finish;
          v.playbackRate = 4; // fast enough to scan a long video in a quarter of its length, slow enough to see most frames
          v.play().catch(finish);
        });
      }
      // a window that's hidden or behind another one (or a phone) hands over few frames as it plays: step through it
      if (out.length < dur * 6 || out[out.length - 1].t < dur - 2) {
        out.length = 0; prev = null;
        const step = dur > 240 ? 0.15 : 0.1;
        for (let t = 0; t < dur; t += step) {
          await seekWait(v, t);
          grab(t); onProgress(t / dur);
        }
      }
      return { dur, frames: out };
    } finally {
      v.removeAttribute("src"); v.load(); v.remove();
      URL.revokeObjectURL(url);
    }
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


  // ---- each pitch from leg lift to just after the ball gets there (a phone left recording) --------------------------
  // The busiest moments in the video (splitByMotion's way, a few more than there are pitches) are each looked at with
  // the pose model, 12 frames a second from 2.6 s before to 0.8 s after: the throwing hand is the one that moves
  // fastest, its fastest moment is the release, and the other side's knee at its highest before that is the top of
  // the leg lift. The moments that look most like a pitch (a fast hand, a high knee) are kept, one per pitch, in order,
  // so a walk back to the rubber isn't taken for one. Each pitch's clip then starts at the top of its leg lift and ends
  // `tail` seconds after the ball reaches the plate: the release plus its flight, 60.5 ft less his extension at about
  // 95.5% of the pitch's speed (TrackMan's numbers; 85 mph and 6 ft without them). A moment where he can't be found
  // keeps a clip around the motion instead (1.5 s before it to 1 s after).
  const TASKS = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
  const POSE = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task";
  let poseP = null;
  function poseModel() {
    if (!poseP) {
      poseP = (async () => {
        const vision = await import(`${TASKS}/vision_bundle.mjs`);
        const files = await vision.FilesetResolver.forVisionTasks(`${TASKS}/wasm`);
        for (const delegate of ["GPU", "CPU"]) {
          try { return await vision.PoseLandmarker.createFromOptions(files, { baseOptions: { modelAssetPath: POSE, delegate }, runningMode: "IMAGE", numPoses: 1, minPoseDetectionConfidence: 0.4, minPosePresenceConfidence: 0.4 }); } catch (e) { /* the next way */ }
        }
        throw new Error("Couldn't load the pose model. Check the connection and try again.");
      })().catch((e) => { poseP = null; throw e; });
    }
    return poseP;
  }
  const seekTo = (v, t) => new Promise((ok) => {
    const done = () => { clearTimeout(timer); v.removeEventListener("seeked", done); ok(); };
    const timer = setTimeout(done, 4000);
    v.addEventListener("seeked", done);
    v.currentTime = Math.max(0, Math.min(t, (v.duration || t) - 0.001));
  });
  // the ball's flight from release to the plate, seconds
  const flightOf = (p) => {
    const mph = Number(p && p.speed) > 30 ? Number(p.speed) : 85, ext = Number(p && p.extension) > 2 ? Number(p.extension) : 6;
    return (60.5 - ext) / (mph * 1.46667 * 0.955);
  };
  // the busiest moments, at least `gap` seconds apart, the busiest first
  function busiest(scan, count, gap) {
    const { frames } = scan;
    const sm = frames.map((f, i) => {
      let s = 0, c = 0;
      for (let j = i; j >= 0 && f.t - frames[j].t <= 0.25; j--) { s += frames[j].d; c++; }
      for (let j = i + 1; j < frames.length && frames[j].t - f.t <= 0.25; j++) { s += frames[j].d; c++; }
      return { t: f.t, m: s / c };
    });
    const peaks = sm.filter((p, i) => i > 0 && i < sm.length - 1 && p.m >= sm[i - 1].m && p.m >= sm[i + 1].m).sort((a, b) => b.m - a.m);
    const out = [];
    for (const p of peaks) { if (out.length >= count) break; if (out.every((q) => Math.abs(q.t - p.t) >= gap)) out.push(p); }
    return out;
  }
  // one moment through the pose model: { lift (top of the leg lift, s), release (s), score } or null if he wasn't found
  function readDelivery(frames) {
    const ok = (q) => q && q[2] > 0.3;
    const seen = frames.filter((f) => f.p);
    if (seen.length < frames.length * 0.5) return null;
    // his size in the picture: nose to lower ankle, the middle of the frames
    const sizes = seen.map((f) => Math.max(f.p[27][1], f.p[28][1]) - f.p[0][1]).filter((x) => x > 0).sort((a, b) => a - b);
    const size = sizes[sizes.length >> 1];
    if (!size) return null;
    // each wrist's speed between frames (heights a second), a peak only counted if a frame beside it is fast too
    const speed = (w) => {
      const s = frames.map((f, i) => {
        const a = frames[i - 1];
        if (!i || !a.p || !f.p || !ok(a.p[w]) || !ok(f.p[w])) return 0;
        return Math.hypot(f.p[w][0] - a.p[w][0], f.p[w][1] - a.p[w][1]) / size / (f.t - a.t);
      });
      return s.map((x, i) => Math.min(x, Math.max(s[i - 1] || 0, s[i + 1] || 0)));
    };
    const best = (s) => s.reduce((b, x, i) => (x > s[b] ? i : b), 0);
    const sL = speed(15), sR = speed(16), iL = best(sL), iR = best(sR);
    const right = sR[iR] >= sL[iL], iRel = right ? iR : iL, top = right ? sR[iR] : sL[iL];
    if (!(top > 0)) return null;
    const release = (frames[iRel].t + frames[iRel - 1].t) / 2;
    // the lead knee (the glove side's) above the hips, at its highest from 2.2 s to 0.25 s before the release
    const knee = right ? 25 : 26;
    let lift = null, high = -Infinity;
    frames.forEach((f) => {
      if (!f.p || !ok(f.p[knee]) || f.t < release - 2.2 || f.t > release - 0.25) return;
      const h = ((f.p[23][1] + f.p[24][1]) / 2 - f.p[knee][1]) / size;
      if (h > high) { high = h; lift = f.t; }
    });
    if (lift == null) return null;
    return { lift, release, score: top * (1 + Math.max(0, Math.min(0.6, high + 0.3))) };
  }
  // the clips for `pitches` (in the order thrown) in `file`: [{ start, end, found }] (found: by the pose model, or
  // false for one kept around the motion), with `seems` (how many moments looked like a pitch)
  async function cueClips(file, scan, pitches, { tail = 0.6, onProgress = () => {}, cancelled = () => false } = {}) {
    const n = pitches.length;
    if (!n) return { segs: [], seems: 0 };
    const gap = Math.max(3, Math.min(8, (scan.dur / n) * 0.5));
    const moments = busiest(scan, n + Math.max(3, Math.ceil(n * 0.2)), gap).sort((a, b) => a.t - b.t);
    const lm = await poseModel();
    const url = typeof file === "string" ? file : URL.createObjectURL(file);
    const v = document.createElement("video");
    v.muted = true; v.playsInline = true; v.preload = "auto";
    v.setAttribute("muted", ""); v.setAttribute("playsinline", "");
    v.style.cssText = "position:fixed;left:-10000px;top:0;width:4px;height:4px;opacity:0;pointer-events:none";
    document.body.append(v);
    v.src = url;
    try {
      await openForReading(v);
      const W = 640, H = Math.round((640 * v.videoHeight) / Math.max(1, v.videoWidth)), cv = document.createElement("canvas");
      cv.width = W; cv.height = H;
      const g = cv.getContext("2d");
      const STEP = 1 / 12, per = Math.round(3.4 / STEP) + 1;
      const found = [];
      for (let k = 0; k < moments.length; k++) {
        const m = moments[k], frames = [];
        for (let j = 0; j < per; j++) {
          if (cancelled()) throw new Error("cancelled");
          const t = m.t - 2.6 + j * STEP;
          if (t < 0 || t > scan.dur) continue;
          await seekTo(v, t);
          g.drawImage(v, 0, 0, W, H);
          const res = lm.detect(cv), q = res.landmarks && res.landmarks[0];
          frames.push({ t, p: q ? q.map((a) => [a.x * W, a.y * H, a.visibility == null ? 1 : a.visibility]) : null });
          onProgress((k + j / per) / moments.length);
        }
        const d = readDelivery(frames);
        found.push(d ? { ...d, t: m.t, m: m.m } : { t: m.t, m: m.m, score: null });
      }
      // one per pitch: the likeliest, the same release seen from two moments counted once
      const real = found.filter((f) => f.score != null).sort((a, b) => b.score - a.score);
      const kept = [];
      real.forEach((f) => { if (kept.length < n && kept.every((q) => Math.abs(q.release - f.release) > 1.5)) kept.push(f); });
      // too few found: the busiest of the rest, kept around their motion
      found.filter((f) => f.score == null).sort((a, b) => b.m - a.m).forEach((f) => { if (kept.length < n && kept.every((q) => Math.abs((q.release != null ? q.release : q.t) - f.t) > 1.5)) kept.push(f); });
      kept.sort((a, b) => (a.release != null ? a.release : a.t) - (b.release != null ? b.release : b.t));
      const segs = kept.map((f, i) => (f.score != null
        ? { start: Math.max(0, f.lift), end: Math.min(scan.dur, f.release + flightOf(pitches[i]) + tail), found: true }
        : { start: Math.max(0, f.t - 1.5), end: Math.min(scan.dur, f.t + 1), found: false }));
      return { segs, seems: real.length };
    } finally {
      v.removeAttribute("src"); v.load(); v.remove();
      if (typeof file !== "string") URL.revokeObjectURL(url);
    }
  }

  // ---- the video export's panel for one pitch (video_export.js) -------------------------------------------------------
  // its TrackMan numbers, and the ball spinning as Pitch Design draws it (the dashboard only) and where its movement
  // sits among the session's
  const TYPE_COLORS = { fastball: "#a3122a", "four-seam": "#a3122a", sinker: "#f6863b", "two-seam": "#f6863b", cutter: "#8d5524", slider: "#e6c229", sweeper: "#b38f00", slurve: "#c77dff", curveball: "#3a86ff", "knuckle curve": "#3a86ff", changeup: "#6aa84f", splitter: "#2a9d8f", knuckleball: "#999999" };
  const colorOf = (t) => (window.BullpenBall ? window.BullpenBall.colorOf(t) : TYPE_COLORS[String(t || "").toLowerCase()] || "#8a8a8a");
  const fmtDay = (key) => { const d = new Date(`${key}T00:00:00`); return isNaN(d) ? key || "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); };
  const numOrNull = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
  const inches = (v, d = 1) => (numOrNull(v) == null ? null : `${Number(v).toFixed(d)}"`);
  const ftIn = (v) => { const n = numOrNull(v); if (n == null) return null; const ft = Math.floor(Math.abs(n)), inch = Math.round((Math.abs(n) - ft) * 12); return `${n < 0 ? "-" : ""}${inch === 12 ? ft + 1 : ft}' ${inch === 12 ? 0 : inch}"`; };
  const plotWidget = (session, p) => (g, x, y, s) => {
    g.fillStyle = "rgba(255,255,255,0.04)"; g.fillRect(x, y, s, s);
    g.strokeStyle = "rgba(255,255,255,0.14)"; g.lineWidth = 1.5;
    const cx = x + s / 2, cy = y + s / 2, k = (s / 2 - 10) / 25; // ±25 inches across
    g.beginPath(); g.moveTo(x + 6, cy); g.lineTo(x + s - 6, cy); g.moveTo(cx, y + 6); g.lineTo(cx, y + s - 6); g.stroke();
    g.fillStyle = "rgba(255,255,255,0.55)"; g.font = `600 ${Math.round(s / 16)}px Arial, sans-serif`; g.textAlign = "left";
    g.fillText("IVB", cx + 6, y + s / 14 + 6); g.textAlign = "right"; g.fillText("HB", x + s - 8, cy - 8); g.textAlign = "left";
    const at = (q) => [cx + Math.max(-25, Math.min(25, numOrNull(q.hb) || 0)) * k, cy - Math.max(-25, Math.min(25, numOrNull(q.ivb) || 0)) * k];
    (session.pitches || []).filter((q) => !q.removed).forEach((q) => { if (numOrNull(q.ivb) == null || numOrNull(q.hb) == null) return; const [px, py] = at(q); g.globalAlpha = 0.45; g.fillStyle = colorOf(q.type); g.beginPath(); g.arc(px, py, s / 55, 0, 2 * Math.PI); g.fill(); });
    g.globalAlpha = 1;
    if (numOrNull(p.ivb) != null && numOrNull(p.hb) != null) { const [px, py] = at(p); g.fillStyle = colorOf(p.type); g.beginPath(); g.arc(px, py, s / 26, 0, 2 * Math.PI); g.fill(); g.strokeStyle = "#fff"; g.lineWidth = 3; g.stroke(); }
  };
  // the export's segment for pitch p, the i-th of `count`, from the video at `url`
  function pitchSegment({ session, athlete, p, i, count, url, rate = 1, ball = false, plot = true }) {
    const VE = window.VideoExport, B = window.BullpenBall, clip = session.video.clips[p.no];
    const revPerSec = numOrNull(p.spin) ? p.spin / 9600 : 0; // as Pitch Design spins it at 1x
    return {
      url, start: clip.start || 0, end: clip.end != null ? clip.end : null, rate,
      panel: (g, box, info) => VE.panel(g, box, {
        name: athlete.name, sub: [fmtDay(session.date), session.facility].filter(Boolean).join(" · "),
        tag: [p.type || "Pitch", colorOf(p.type)], tagNote: `#${p.no} · ${i + 1} of ${count}`,
        big: numOrNull(p.speed) != null ? [Number(p.speed).toFixed(1), "mph"] : null,
        rows: [["Spin", numOrNull(p.spin) != null ? `${Math.round(p.spin)} rpm` : null], ["Tilt", p.tilt || null], ["IVB", inches(p.ivb)], ["HB", inches(p.hb)],
          ["Spin eff.", numOrNull(p.spinEff) != null ? `${Math.round(p.spinEff)}%` : null], ["Extension", ftIn(p.extension)], ["Rel. height", ftIn(p.relHeight)], ["Rel. side", ftIn(p.relSide)],
          ["VAA", numOrNull(p.vaa) != null ? `${Number(p.vaa).toFixed(1)}°` : null]],
        widgets: [ball && B ? (gg, x, y, s) => B.paint(gg, x, y, s, p, info.elapsed * revPerSec * 2 * Math.PI) : null, plot ? plotWidget(session, p) : null],
      }),
    };
  }

  window.BullpenCut = { upload, removeFiles, linkOf, useDrive, scanVideo, splitByMotion, cueClips, shiftClips, pitchSegment, colorOf, fmtDay, flightOf, mb };
})();
