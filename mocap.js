// Motion capture — a pitcher's mechanics measured from phone video. A pose model (MediaPipe's Pose Landmarker, run
// in the browser: the video never leaves the device) finds 33 body points on every frame; from those come the key
// moments of the delivery and the numbers at them. Two setups:
//   one camera, on the open side (the side the pitcher's chest faces in his set: third base for a righty, first for a
//     lefty), square to the line to the plate: stride, lead leg, trunk tilt, arm position, timing, center-of-mass
//     speed; hip-shoulder separation and rotation only as estimates (from the model's own 3D guess)
//   two cameras, open side and behind (on the line through the plate): the two views together give the turn of the
//     hips and shoulders, so separation and their rotation speeds are measured, plus trunk lean and arm slot
// Plain JavaScript with its own markup, so the same tool runs in the dashboard (Pitching › Motion Capture) and in
// Coach Mode on a phone:
//   window.MoCap.mount(container, { athlete: { id, name, throws }, onSave(record) -> Promise, history() -> [records] })
// A saved session is kept like the other pitching records (assessments table, kind "mocap"): the setup, the frame
// rate, the moments, the numbers and a thinned copy of the curves, not the video.
(function () {
  const TASKS = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
  // the larger, slower, more accurate of the pose models (better on a fast arm), and the standard one to fall back on
  const MODELS = ["https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task", "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task"];
  const MAX_FRAMES = 700;

  const el = (tag, attrs, ...kids) => {
    const n = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (v == null || v === false) return;
      if (k === "class") n.className = v;
      else if (k === "style") n.style.cssText = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    });
    kids.flat().forEach((c) => { if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c))); });
    return n;
  };
  const r1 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10);
  const deg = (rad) => (rad * 180) / Math.PI;
  const wrapDeg = (d) => { let x = ((d + 180) % 360 + 360) % 360 - 180; return x; };

  // ---- the pose model, loaded once ----------------------------------------------------------------------------
  let modelP = null;
  let clock = 0; // the model wants ever-increasing timestamps, across every video it's shown
  function model() {
    if (!modelP) {
      modelP = (async () => {
        const vision = await import(`${TASKS}/vision_bundle.mjs`);
        const files = await vision.FilesetResolver.forVisionTasks(`${TASKS}/wasm`);
        const make = (delegate, path) => vision.PoseLandmarker.createFromOptions(files, {
          baseOptions: { modelAssetPath: path, delegate }, runningMode: "VIDEO", numPoses: 1,
          minPoseDetectionConfidence: 0.4, minPosePresenceConfidence: 0.4, minTrackingConfidence: 0.4,
        });
        for (const path of MODELS) for (const delegate of ["GPU", "CPU"]) { try { return await make(delegate, path); } catch (e) { /* the next way */ } }
        throw new Error("Couldn't load the pose model. Check the connection and try again.");
      })().catch((e) => { modelP = null; throw e; });
    }
    return modelP;
  }

  // ---- reading a video ------------------------------------------------------------------------------------------
  const once = (target, ev) => new Promise((ok) => target.addEventListener(ev, ok, { once: true }));
  // Opens a chosen video so its frames can be read. It goes on the page (out of sight) at once: Safari on an iPhone
  // or iPad won't load a video that isn't. And it doesn't wait forever: a video whose picture the browser can't decode
  // (an iPhone's High Efficiency format in Chrome on Windows, often) never says it's ready, so after a while, or once
  // it's clear there's no picture, it says what to do instead.
  const CANT_PLAY = "This browser can't show that video's picture. On the iPhone or iPad, set Settings › Camera › Formats to Most Compatible and film it again, or open the dashboard in Safari (or on the phone itself) to analyze this one.";
  async function openVideo(file) {
    const v = document.createElement("video");
    v.muted = true; v.defaultMuted = true; v.playsInline = true; v.preload = "auto";
    v.setAttribute("muted", ""); v.setAttribute("playsinline", ""); v.setAttribute("webkit-playsinline", "");
    v.style.cssText = "position:fixed;left:-10000px;top:0;width:4px;height:4px;opacity:0;pointer-events:none";
    document.body.append(v);
    v.src = typeof file === "string" ? file : URL.createObjectURL(file); // a chosen file, or the link to a kept one
    v.load();
    try {
      await new Promise((ok, bad) => {
        const timer = setTimeout(() => bad(new Error((file.size || 0) > 400 * 1048576 ? `That video is ${Math.round(file.size / 1048576)} MB and didn't open. Trim it to just the pitch in Photos first (Edit, then drag the ends in), then choose it again.` : CANT_PLAY)), 25000);
        v.addEventListener("loadedmetadata", () => { clearTimeout(timer); ok(); }, { once: true });
        v.addEventListener("error", () => { clearTimeout(timer); bad(new Error(CANT_PLAY)); }, { once: true });
      });
      if (!v.videoWidth || !v.videoHeight) throw new Error(CANT_PLAY); // sound but no picture
      await seek(v, 0.01); // the first frame, decoded and ready to draw
      if (v.readyState < 2) throw new Error(CANT_PLAY);
      return v;
    } catch (e) {
      v.remove();
      throw e;
    }
  }
  // to time t (file seconds), once the frame there is ready, or after a few seconds whatever happens
  const seek = (v, t) => new Promise((ok) => {
    const done = () => { clearTimeout(timer); v.removeEventListener("seeked", done); ok(); };
    const timer = setTimeout(done, 4000);
    v.addEventListener("seeked", done);
    v.currentTime = Math.max(0, Math.min(t, (v.duration || t) - 0.001));
  });
  // the file's own frame rate: play a moment and see how far apart its frames are
  async function fileFps(v) {
    if (!v.requestVideoFrameCallback) return 30;
    const times = [];
    await new Promise((ok) => {
      const onFrame = (now, meta) => { times.push(meta.mediaTime); if (times.length < 14 && !v.ended) v.requestVideoFrameCallback(onFrame); else ok(); };
      v.requestVideoFrameCallback(onFrame);
      v.play().catch(ok);
      setTimeout(ok, 1500);
    });
    v.pause();
    const d = times.slice(1).map((t, i) => t - times[i]).filter((x) => x > 0.0005).sort((a, b) => a - b);
    const fps = d.length ? 1 / d[Math.floor(d.length / 2)] : 30;
    return [24, 25, 30, 48, 50, 60, 120, 240].reduce((best, f) => (Math.abs(f - fps) < Math.abs(best - fps) ? f : best), 30);
  }
  // every frame from t0 to t1 through the model: { t (file seconds), p: [[x px, y px, visibility] × 33], w: [[x, y, z] m × 33] }
  async function track(v, t0, t1, fps, onProgress) {
    const lm = await model();
    const step = Math.max(1 / fps, (t1 - t0) / MAX_FRAMES);
    const W = v.videoWidth, H = v.videoHeight, out = [];
    for (let t = t0, i = 0; t <= t1 + 1e-6; t += step, i++) {
      await seek(v, t);
      clock += 10;
      const res = lm.detectForVideo(v, clock);
      const p = res.landmarks && res.landmarks[0], w = res.worldLandmarks && res.worldLandmarks[0];
      out.push({ t, p: p ? p.map((q) => [q.x * W, q.y * H, q.visibility == null ? 1 : q.visibility]) : null, w: w ? w.map((q) => [q.x, q.y, q.z]) : null });
      if (i % 5 === 0) onProgress((t - t0) / Math.max(1e-6, t1 - t0));
    }
    return { frames: out, W, H, step };
  }

  // ---- from points to curves ------------------------------------------------------------------------------------
  // body points (MediaPipe's numbering)
  const P = { nose: 0, lSh: 11, rSh: 12, lEl: 13, rEl: 14, lWr: 15, rWr: 16, lHip: 23, rHip: 24, lKn: 25, rKn: 26, lAn: 27, rAn: 28, lHeel: 29, rHeel: 30, lToe: 31, rToe: 32 };
  // the throwing side and the glove side (lead leg) for a pitcher's hand
  const sidesOf = (throws) => {
    const R = throws !== "L";
    return {
      arm: R ? { sh: P.rSh, el: P.rEl, wr: P.rWr } : { sh: P.lSh, el: P.lEl, wr: P.lWr },
      glove: R ? { sh: P.lSh, el: P.lEl, wr: P.lWr } : { sh: P.rSh, el: P.rEl, wr: P.rWr },
      lead: R ? { hip: P.lHip, kn: P.lKn, an: P.lAn, heel: P.lHeel, toe: P.lToe } : { hip: P.rHip, kn: P.rKn, an: P.rAn, heel: P.rHeel, toe: P.rToe },
      drive: R ? { hip: P.rHip, kn: P.rKn, an: P.rAn, heel: P.rHeel, toe: P.rToe } : { hip: P.lHip, kn: P.lKn, an: P.lAn, heel: P.lHeel, toe: P.lToe },
    };
  };
  // fill frames the model missed or wasn't sure of, then smooth each point's path (a Gaussian, about 1/120 s wide)
  function clean(frames, key, sigmaFrames, medianFrames = 3) {
    const n = frames.length, out = frames.map(() => new Array(33));
    for (let j = 0; j < 33; j++) {
      for (let c = 0; c < 3; c++) {
        const raw = frames.map((f) => (f[key] && (key !== "p" || f.p[j][2] >= 0.3) ? f[key][j][c] : null));
        // fill gaps from their neighbors
        let last = -1;
        for (let i = 0; i < n; i++) {
          if (raw[i] == null) continue;
          if (last === -1) for (let k = 0; k < i; k++) raw[k] = raw[i];
          else for (let k = last + 1; k < i; k++) raw[k] = raw[last] + ((raw[i] - raw[last]) * (k - last)) / (i - last);
          last = i;
        }
        if (last === -1) { for (let i = 0; i < n; i++) { out[i][j] = out[i][j] || [0, 0, 0]; out[i][j][c] = NaN; } continue; }
        for (let k = last + 1; k < n; k++) raw[k] = raw[last];
        // then a running median about 30 ms wide: the model loses a fast-moving arm for a frame or three (blur, or the
        // arm crossing the body), and a median drops those jumps where an average would smear them into false speed
        const half = Math.max(1, Math.round(medianFrames / 2));
        if (half > 0) { const src = raw.slice(); for (let i = 0; i < n; i++) { const win = src.slice(Math.max(0, i - half), Math.min(n, i + half + 1)).sort((a, b) => a - b); raw[i] = win[Math.floor(win.length / 2)]; } }
        const s = Math.max(0.6, sigmaFrames), R = Math.ceil(s * 2.5), wts = [];
        for (let k = -R; k <= R; k++) wts.push(Math.exp(-(k * k) / (2 * s * s)));
        for (let i = 0; i < n; i++) {
          let sum = 0, ws = 0;
          for (let k = -R; k <= R; k++) { const ii = i + k; if (ii < 0 || ii >= n) continue; sum += raw[ii] * wts[k + R]; ws += wts[k + R]; }
          out[i][j] = out[i][j] || [0, 0, 0];
          out[i][j][c] = sum / ws;
        }
      }
    }
    return out;
  }
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, ((a[2] || 0) + (b[2] || 0)) / 2];
  // the angle at b between a and c, degrees (180 = straight)
  const angleAt = (a, b, c) => {
    const u = [a[0] - b[0], a[1] - b[1]], v = [c[0] - b[0], c[1] - b[1]];
    const d = Math.hypot(u[0], u[1]) * Math.hypot(v[0], v[1]);
    return d ? deg(Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1]) / d)))) : null;
  };
  const deriv = (xs, dt) => xs.map((x, i) => {
    const a = xs[Math.max(0, i - 1)], b = xs[Math.min(xs.length - 1, i + 1)];
    return a == null || b == null ? null : (b - a) / (dt * (Math.min(xs.length - 1, i + 1) - Math.max(0, i - 1)) || 1);
  });
  // unwrap an angle series (degrees) so it doesn't jump at ±180
  const unwrap = (xs) => { const out = []; let off = 0; xs.forEach((x, i) => { if (i && x != null && out[i - 1] != null) { const d = x + off - out[i - 1]; if (d > 180) off -= 360; else if (d < -180) off += 360; } out.push(x == null ? null : x + off); }); return out; };
  const argBest = (xs, from, to, better) => { let k = -1; for (let i = Math.max(0, from); i <= Math.min(xs.length - 1, to); i++) if (xs[i] != null && (k < 0 || better(xs[i], xs[k]))) k = i; return k; };
  // a segment model of the body's center of mass (shares of body mass, after Dempster): head, trunk, arms, legs
  const COM_PARTS = [[[P.nose], 0.081], [[P.lSh, P.rSh, P.lHip, P.rHip], 0.497], [[P.lSh, P.lEl], 0.028], [[P.rSh, P.rEl], 0.028], [[P.lEl, P.lWr], 0.022], [[P.rEl, P.rWr], 0.022], [[P.lHip, P.lKn], 0.1], [[P.rHip, P.rKn], 0.1], [[P.lKn, P.lAn], 0.061], [[P.rKn, P.rAn], 0.061]];
  const comOf = (pts) => {
    let x = 0, y = 0, m = 0;
    COM_PARTS.forEach(([ids, share]) => { const cx = ids.reduce((s, i) => s + pts[i][0], 0) / ids.length, cy = ids.reduce((s, i) => s + pts[i][1], 0) / ids.length; x += cx * share; y += cy * share; m += share; });
    return [x / m, y / m];
  };

  // ---- dots moved by hand ------------------------------------------------------------------------------------------
  // A coach can drag a body point to where the joint really is on any frame. Each fix is kept as where the point
  // belongs on that frame; the frames either side (about 25 ms) are shifted by the same amount, fading out, so the path
  // stays smooth (and the glitch filter keeps it). Only the side view's 2D points are moved: the speeds of the upper arm
  // and elbow come from the model's 3D estimate, which a drag on a picture can't correct.
  function applyEdits(tr, edits, fps) {
    const keys = Object.keys(edits || {}).map(Number);
    if (!keys.length) return tr;
    const K = Math.max(2, Math.round(fps * 0.025));
    const frames = tr.frames.map((f) => ({ ...f, p: f.p ? f.p.map((q) => q.slice()) : null }));
    const byJoint = {};
    keys.forEach((f) => Object.entries(edits[f] || {}).forEach(([j, xy]) => { (byJoint[j] = byJoint[j] || []).push([f, xy]); }));
    Object.entries(byJoint).forEach(([jj, list]) => {
      const j = Number(jj);
      const shifts = list.map(([f, xy]) => { const q = tr.frames[f] && tr.frames[f].p ? tr.frames[f].p[j] : null; return { f, x: xy[0], y: xy[1], dx: q ? xy[0] - q[0] : 0, dy: q ? xy[1] - q[1] : 0 }; });
      frames.forEach((fr, i) => {
        if (!fr.p) return;
        let best = null;
        shifts.forEach((s) => { const d = Math.abs(s.f - i); if (d <= K && (!best || d < best.d)) best = { s, d }; });
        if (!best) return;
        if (best.d === 0) { fr.p[j] = [best.s.x, best.s.y, 1]; return; }
        const w = 1 - best.d / (K + 1);
        fr.p[j] = [fr.p[j][0] + best.s.dx * w, fr.p[j][1] + best.s.dy * w, Math.max(fr.p[j][2], 0.9)];
      });
    });
    return { ...tr, frames };
  }

  // a Gaussian smoothing of one series (s frames wide), skipping gaps
  const smoothSeries = (xs, s) => xs.map((_, i) => {
    let sum = 0, ws = 0;
    for (let k = -Math.ceil(2.5 * s); k <= Math.ceil(2.5 * s); k++) { const v = xs[i + k]; if (v == null || !Number.isFinite(v)) continue; const w = Math.exp(-(k * k) / (2 * s * s)); sum += v * w; ws += w; }
    return ws ? sum / ws : null;
  });

  // ---- the analysis ---------------------------------------------------------------------------------------------
  // side: tracked open-side video; behind: tracked behind video or null. timeScale turns file seconds into real
  // seconds (a 30 fps file of 240 fps slow-mo runs 8× slow).
  function analyze({ side, behind, throws, heightIn, captureFps, sideScale, behindScale, events: manual }) {
    const S = sidesOf(throws), n = side.frames.length;
    const sig = Math.max(0.6, captureFps / 120);
    const med = Math.max(3, Math.round(captureFps * 0.03)); // frames in about 30 ms
    const pts = clean(side.frames, "p", sig, med), wpts = clean(side.frames, "w", sig, med);
    const tReal = side.frames.map((f) => (f.t - side.frames[0].t) * sideScale);
    const dt = (tReal[n - 1] - tReal[0]) / Math.max(1, n - 1);
    const fr = (sec) => Math.max(1, Math.round(sec / Math.max(dt, 1e-4))); // a time as a number of frames
    const m = manual || {};
    // the moments, each found after the one before (a moment set by hand moves the ones after it along with it):
    // peak leg lift: the lead knee at its highest
    const kneeY = pts.map((q) => q[S.lead.kn][1]);
    const LL = m.LL != null ? m.LL : argBest(kneeY, 0, Math.round(n * 0.75), (a, b) => a < b);
    // his height on screen, while he stands tall from the set to the top of his leg lift
    // (nose to ankle is about 87% of height: ankles, not toes, which perspective can push low in the picture)
    const floorY = (q) => Math.max(q[S.lead.heel][1], q[S.drive.heel][1], q[S.lead.toe][1], q[S.drive.toe][1]);
    const tall = pts.slice(0, Math.max(3, LL + 1)).map((q) => Math.max(q[S.lead.an][1], q[S.drive.an][1]) - q[P.nose][1]).sort((a, b) => a - b);
    const Hpx = tall[Math.floor(tall.length * 0.75)] / 0.87;
    // which way the plate is on screen: the way the lead foot travels
    const leadFootX = pts.map((q) => (q[S.lead.an][0] + q[S.lead.heel][0] + q[S.lead.toe][0]) / 3);
    const dir = leadFootX[n - 1] - leadFootX[0] >= 0 ? 1 : -1;
    // foot strike: the lead foot down at the end of its stride. A foot that slides out low is near the ground long
    // before it lands, so it also has to have gone almost all the way out (97% of its full stride) and be settling.
    const footY = pts.map((q) => (q[S.lead.heel][1] + q[S.lead.toe][1] + q[S.lead.an][1]) / 3);
    const groundY = Math.max(...footY.slice(LL));
    const travel = leadFootX.map((x) => dir * (x - leadFootX[LL]));
    const fullStride = Math.max(...travel.slice(LL));
    const footSpeed = deriv(leadFootX, dt).map((v) => Math.abs(v || 0));
    let FS = m.FS != null ? m.FS : -1;
    if (FS < 0) for (let i = LL + 1; i < n; i++) if (travel[i] >= 0.97 * fullStride && footY[i] >= groundY - 0.03 * Hpx && footSpeed[i] < 0.8 * Hpx) { FS = i; break; }
    if (FS < 0) FS = argBest(travel, LL, n - 1, (a, b) => a > b);
    // release: the throwing hand fastest, from 70 to 280 ms after foot strike (usual foot strike to release is 130-180)
    const wr = pts.map((q) => q[S.arm.wr]);
    const wrVy = deriv(wr.map((q) => q[1]), dt);
    const wrSpeed = smoothSeries(deriv(wr.map((q) => q[0]), dt).map((vx, i) => Math.hypot(vx || 0, wrVy[i] || 0)), sig);
    const BR = m.BR != null ? m.BR : argBest(wrSpeed, FS + fr(0.07), FS + fr(0.28), (a, b) => a > b);
    // max layback: the hand furthest back behind the elbow, between foot strike and just before release
    const layback = smoothSeries(pts.map((q) => dir * (q[S.arm.wr][0] - q[S.arm.el][0])), sig);
    const MER = m.MER != null ? m.MER : argBest(layback, FS + fr(0.03), Math.max(FS + fr(0.03), BR - fr(0.008)), (a, b) => a < b);

    // curves through the delivery
    const kneeFlex = pts.map((q) => { const a = angleAt(q[S.lead.hip], q[S.lead.kn], q[S.lead.an]); return a == null ? null : 180 - a; });
    const trunkFwd = pts.map((q) => { const h = mid(q[P.lHip], q[P.rHip]), s = mid(q[P.lSh], q[P.rSh]); return deg(Math.atan2(dir * (s[0] - h[0]), h[1] - s[1])); });
    const elbowFlex = pts.map((q) => { const a = angleAt(q[S.arm.sh], q[S.arm.el], q[S.arm.wr]); return a == null ? null : 180 - a; });
    const shAbd = pts.map((q) => { const h = mid(q[P.lHip], q[P.rHip]), s = mid(q[P.lSh], q[P.rSh]); return angleAt([h[0], h[1]], q[S.arm.sh], q[S.arm.el]); });
    const mPerPx = heightIn ? (heightIn * 0.0254) / Hpx : null;
    const comX = smoothSeries(pts.map((q) => comOf(q)[0]), sig * 2); // speeds come from differences, so smoothed more
    const comV = mPerPx ? deriv(comX, dt).map((v) => (v == null ? null : dir * v * mPerPx)) : null;

    // the turn of the hips and shoulders (degrees, in the ground plane), and so separation and rotation speeds
    let pelvis = null, trunk = null, rotSource = "estimate", behindAt = null;
    const gloveSign = throws === "L" ? 1 : -1; // from behind, a righty's glove side is to the left
    if (behind) {
      const S2 = behind;
      const bpts = clean(S2.frames, "p", sig, med);
      const bT = S2.frames.map((f) => (f.t - S2.frames[0].t) * behindScale);
      const bn = bpts.length;
      const bEarly = bpts.slice(0, Math.max(3, Math.round(bn * 0.08)));
      const bH = bEarly.reduce((s, q) => s + (floorY(q) - q[P.nose][1]), 0) / bEarly.length / 0.91;
      // line the two up: roughly at the top of the leg lift (the lead knee highest in both), then exactly at release,
      // the throwing hand's fastest moment, sharp from any side
      const bKnee = bpts.map((q) => q[S.lead.kn][1]);
      const bLL = argBest(bKnee, 0, Math.round(bn * 0.75), (a, b) => a < b);
      const rough = tReal[LL] - bT[bLL];
      const bWr = bpts.map((q) => q[S.arm.wr]);
      const bVy = deriv(bWr.map((q) => q[1]), dt);
      const bSpeed = smoothSeries(deriv(bWr.map((q) => q[0]), dt).map((vx, i) => Math.hypot(vx || 0, bVy[i] || 0)), sig);
      const near = (t) => { let k = 0; while (k < bn - 1 && bT[k] < t) k++; return k; };
      const bBR = argBest(bSpeed, near(tReal[BR] - rough - 0.15), near(tReal[BR] - rough + 0.15), (a, b) => a > b);
      const offset = bBR >= 0 ? tReal[BR] - bT[bBR] : rough;
      const at = (t) => { // the behind view's points at real time t (on the side view's clock)
        const x = t - offset;
        let k = 0;
        while (k < bn - 2 && bT[k + 1] < x) k++;
        const a = bpts[k], b = bpts[Math.min(bn - 1, k + 1)], f = bT[k + 1] > bT[k] ? Math.max(0, Math.min(1, (x - bT[k]) / (bT[k + 1] - bT[k]))) : 0;
        return a.map((p, j) => [p[0] + (b[j][0] - p[0]) * f, p[1] + (b[j][1] - p[1]) * f]);
      };
      // a line across the body: along the plate from the side view, across from the behind view, each in heights
      const lineAngle = (q, bq, l, r) => deg(Math.atan2((dir * (q[r][0] - q[l][0])) / Hpx, (bq[r][0] - bq[l][0]) / bH));
      const bAll = tReal.map((t) => at(t));
      pelvis = unwrap(pts.map((q, i) => lineAngle(q, bAll[i], P.lHip, P.rHip)));
      trunk = unwrap(pts.map((q, i) => lineAngle(q, bAll[i], P.lSh, P.rSh)));
      rotSource = "measured";
      behindAt = (i) => bAll[i]; // for the trunk lean and arm slot at release, from behind
    } else {
      pelvis = unwrap(wpts.map((q) => deg(Math.atan2(q[P.rHip][2] - q[P.lHip][2], q[P.rHip][0] - q[P.lHip][0]))));
      trunk = unwrap(wpts.map((q) => deg(Math.atan2(q[P.rSh][2] - q[P.lSh][2], q[P.rSh][0] - q[P.lSh][0]))));
    }
    const sep = pelvis.map((p, i) => (p == null || trunk[i] == null ? null : wrapDeg(p - trunk[i])));
    // the turns' speeds, from the angles smoothed a little more (a difference of noisy angles is noisier still)
    const pelvisV = deriv(smoothSeries(pelvis, sig * 2), dt), trunkV = deriv(smoothSeries(trunk, sig * 2), dt);
    const sepMaxI = argBest(sep.map((x) => (x == null ? null : Math.abs(x))), LL, BR, (a, b) => a > b);
    // each segment's peak looked for where it comes: the hips around foot strike, the trunk from foot strike to just
    // after release (the arm's and elbow's below)
    const pvI = argBest(pelvisV.map((x) => (x == null ? null : Math.abs(x))), FS - fr(0.1), BR + fr(0.02), (a, b) => a > b);
    const tvI = argBest(trunkV.map((x) => (x == null ? null : Math.abs(x))), FS - fr(0.05), BR + fr(0.03), (a, b) => a > b);
    const ms = (i, j) => (i < 0 || j < 0 ? null : Math.round((tReal[j] - tReal[i]) * 1000));
    // the arm's part of the sequence, from the pose model's 3D points: how fast the upper arm swings (its direction
    // turning, whichever way) and how fast the elbow straightens. Video can't see the shoulder's internal rotation (the
    // ~7000°/s of lab motion capture), so the upper arm's swing stands in for the shoulder.
    const v3 = (a, b) => [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const unit3 = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
    const ang3 = (u, v) => deg(Math.acos(Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1] + u[2] * v[2]))));
    const upper = wpts.map((q) => unit3(v3(q[S.arm.sh], q[S.arm.el])));
    const armV = smoothSeries(upper.map((u, i) => { const lo = Math.max(0, i - 1), hi = Math.min(n - 1, i + 1); return hi > lo ? ang3(upper[lo], upper[hi]) / ((hi - lo) * dt) : null; }), sig);
    const elbow3 = smoothSeries(wpts.map((q) => 180 - ang3(unit3(v3(q[S.arm.el], q[S.arm.sh])), unit3(v3(q[S.arm.el], q[S.arm.wr])))), sig * 2);
    const elbowV = smoothSeries(deriv(elbow3, dt).map((v) => (v == null ? null : -v)), sig); // straightening counts as +
    // the upper arm swings through around release; the elbow straightens from max layback to release
    const avI = argBest(armV, MER - fr(0.03), BR + fr(0.03), (a, b) => a > b);
    const evI = argBest(elbowV, MER - fr(0.01), BR + fr(0.015), (a, b) => a > b);
    // the kinematic sequence: each segment's peak speed and when it comes, which should run hips, trunk, arm, elbow
    const seq = [["Pelvis", pelvisV, pvI, "#2ec4b6"], ["Trunk", trunkV, tvI, "#ff4d5e"], ["Upper arm", armV, avI, "#ff9f1c"], ["Elbow extension", elbowV, evI, "#c77dff"]]
      .map(([name, ys, i, color]) => ({ name, color, i, peak: i < 0 || ys[i] == null ? null : Math.round(Math.abs(ys[i])), fromFS: ms(FS, i), beforeBR: i < 0 ? null : Math.round((tReal[BR] - tReal[i]) * 1000) }));
    const found = seq.filter((r) => r.i >= 0);
    const inOrder = found.every((r, k) => k === 0 || r.i >= found[k - 1].i);

    let lean = null, slot = null;
    if (behind) {
      const bq = behindAt(BR), h = mid(bq[P.lHip], bq[P.rHip]), s = mid(bq[P.lSh], bq[P.rSh]);
      lean = deg(Math.atan2(gloveSign * (s[0] - h[0]), h[1] - s[1]));
      const a = bq[S.arm.sh], w = bq[S.arm.wr];
      slot = deg(Math.atan2(a[1] - w[1], Math.abs(w[0] - a[0])));
    } else {
      const q = wpts[BR], a = q[S.arm.sh], w = q[S.arm.wr];
      slot = deg(Math.atan2(a[1] - w[1], Math.abs(w[2] - a[2]) || 1e-6));
    }
    const strideIn = Math.abs(pts[FS][S.lead.an][0] - pts[FS][S.drive.an][0]);
    const est = rotSource === "estimate";
    // the numbers, each with a usual range for pitchers (a guide, from published biomechanics; they vary by body and style)
    const M = [
      ["stride", "Stride length", r1((strideIn / Hpx) * 100), "% of height", "75–90", "Ankle to ankle at foot strike, as a share of his height."],
      ["kneeFS", "Lead knee at foot strike", r1(kneeFlex[FS]), "° flexed", "40–55", "How bent the front knee is when the foot lands."],
      ["kneeBR", "Lead knee at release", r1(kneeFlex[BR]), "° flexed", "25–45", "Less bent than at foot strike means the front leg firmed up (blocked)."],
      ["kneeExt", "Lead leg block", r1(kneeFlex[FS] - kneeFlex[BR]), "° straightened", "5–25", "How much the front knee straightens from foot strike to release; negative means it kept bending."],
      ["trunkBR", "Trunk forward tilt at release", r1(trunkFwd[BR]), "°", "30–45", "Lean of the trunk toward the plate from upright, seen from the side."],
      ["elbowFS", "Elbow flexion at foot strike", r1(elbowFlex[FS]), "°", "80–110", "Bend of the throwing elbow when the foot lands."],
      ["abdFS", "Shoulder abduction at foot strike", r1(shAbd[FS]), "°", "80–100", "Upper arm away from the trunk (90 = level with the shoulders)."],
      ["slot", `Arm slot at release${behind ? "" : " (estimate)"}`, r1(slot), "° above level", "", "Shoulder to hand above horizontal: about 0 sidearm, 30–60 three-quarters, 70+ over the top."],
      behind ? ["lean", "Trunk lean to glove side at release", r1(lean), "°", "15–35", "Seen from behind: how far the trunk tips toward the glove side."] : null,
      ["sepFS", `Hip-shoulder separation at foot strike${est ? " (estimate)" : ""}`, r1(Math.abs(sep[FS] == null ? NaN : sep[FS])), "°", "30–50", "How far the hips have turned ahead of the shoulders when the foot lands."],
      ["sepMax", `Peak hip-shoulder separation${est ? " (estimate)" : ""}`, r1(sepMaxI < 0 ? null : Math.abs(sep[sepMaxI])), "°", "40–60", "The most the hips get ahead of the shoulders."],
      ["pelvisV", `Peak pelvis rotation speed${est ? " (estimate)" : ""}`, pvI < 0 ? null : Math.round(Math.abs(pelvisV[pvI])), "°/s", "450–700", "How fast the hips turn at their fastest."],
      ["trunkV", `Peak trunk rotation speed${est ? " (estimate)" : ""}`, tvI < 0 ? null : Math.round(Math.abs(trunkV[tvI])), "°/s", "800–1200", "How fast the shoulders turn at their fastest."],
      ["seq", `Pelvis → trunk timing${est ? " (estimate)" : ""}`, ms(pvI, tvI), "ms", "30–60", "Time from the hips' fastest turn to the shoulders': positive means hips first, as it should be."],
      ["gain", `Trunk / pelvis speed gain${est ? " (estimate)" : ""}`, pvI < 0 || tvI < 0 || !pelvisV[pvI] ? null : Math.round((Math.abs(trunkV[tvI]) / Math.abs(pelvisV[pvI])) * 100) / 100, "×", "1.4–1.9", "How much faster the trunk turns than the hips at their peaks: energy passed up the chain."],
      ["armV", "Peak upper-arm speed (estimate)", avI < 0 ? null : Math.round(armV[avI]), "°/s", "", "How fast the upper arm swings through, from the 3D estimate (not the shoulder's internal rotation, which video can't see)."],
      ["elbowV", "Peak elbow extension speed (estimate)", evI < 0 ? null : Math.round(elbowV[evI]), "°/s", "1800–2600", "How fast the elbow straightens on the way to release, from the 3D estimate."],
      ["order", "Kinematic sequence", found.length < 2 ? null : inOrder ? "In order" : "Out of order", "", "", "Hips, then trunk, then arm, then elbow reaching their fastest, each after the one before."],
      ["llfs", "Leg lift to foot strike", ms(LL, FS), "ms", "", "From the top of the leg lift to the foot landing."],
      ["fsbr", "Foot strike to release", ms(FS, BR), "ms", "130–180", "From the foot landing to the ball coming out."],
      ["comPeak", "Peak center-of-mass speed", comV ? r1(Math.max(...comV.slice(LL, FS + 1).filter((x) => x != null))) : null, "m/s", "2.5–3.5", "How fast his body moves toward the plate at its fastest before foot strike."],
      ["comFS", "Center-of-mass speed at foot strike", comV ? r1(comV[FS]) : null, "m/s", "", "How much of that speed is left when the foot lands."],
    ].filter(Boolean).map(([key, label, value, unit, range, note]) => ({ key, label, value, unit, range, note }));
    return {
      n, tReal, dir, Hpx, pts, events: { LL, FS, MER, BR }, metrics: M, rotSource, seq, inOrder,
      series: { kneeFlex, trunkFwd, sep, pelvisV, trunkV, comV, elbowFlex, armV, elbowV },
    };
  }

  // ---- drawing ---------------------------------------------------------------------------------------------------
  const BONES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28], [27, 29], [29, 31], [27, 31], [28, 30], [30, 32], [28, 32]];
  function drawSkeleton(ctx, q, sx, sy, throws) {
    const S = sidesOf(throws), arm = new Set([S.arm.sh, S.arm.el, S.arm.wr]), lead = new Set(Object.values(S.lead));
    ctx.lineCap = "round";
    BONES.forEach(([a, b]) => {
      ctx.strokeStyle = arm.has(a) && arm.has(b) ? "#ff4d5e" : lead.has(a) && lead.has(b) ? "#3fa7ff" : "rgba(255,255,255,0.9)";
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(q[a][0] * sx, q[a][1] * sy); ctx.lineTo(q[b][0] * sx, q[b][1] * sy); ctx.stroke();
    });
    ctx.fillStyle = "#fff";
    [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28].forEach((i) => { ctx.beginPath(); ctx.arc(q[i][0] * sx, q[i][1] * sy, 3.5, 0, 2 * Math.PI); ctx.fill(); });
  }
  const EV_LABEL = { LL: "Leg lift", FS: "Foot strike", MER: "Max layback", BR: "Release" };
  // a small line chart of one curve through the delivery, with the moments marked
  function chart(title, unit, ys, tReal, events, color, extra) {
    const W = 320, H = 120, pad = 26;
    const vals = [...ys, ...(extra ? extra.ys : [])].filter((v) => v != null && Number.isFinite(v));
    if (!vals.length) return null;
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (hi - lo < 1) { hi += 0.5; lo -= 0.5; }
    const t0 = tReal[0], t1 = tReal[tReal.length - 1] || 1;
    const X = (t) => pad + ((t - t0) / (t1 - t0 || 1)) * (W - pad - 6), Y = (v) => 8 + (1 - (v - lo) / (hi - lo)) * (H - 28);
    const path = (arr) => arr.map((v, i) => (v == null || !Number.isFinite(v) ? null : `${X(tReal[i]).toFixed(1)},${Y(v).toFixed(1)}`)).filter(Boolean).join(" ");
    const NS = "http://www.w3.org/2000/svg";
    const s = document.createElementNS(NS, "svg");
    s.setAttribute("viewBox", `0 0 ${W} ${H}`); s.setAttribute("class", "mc-chart"); s.setAttribute("role", "img"); s.setAttribute("aria-label", `${title} through the delivery`);
    const add = (tag, a, text) => { const n = document.createElementNS(NS, tag); Object.entries(a).forEach(([k, v]) => n.setAttribute(k, v)); if (text != null) n.textContent = text; s.append(n); return n; };
    Object.entries(events).forEach(([k, i]) => { if (i < 0 || i == null || tReal[i] == null) return; const x = X(tReal[i]); add("line", { x1: x, x2: x, y1: 6, y2: H - 18, stroke: "var(--mc-grid)", "stroke-dasharray": "3 3" }); add("text", { x, y: H - 6, "text-anchor": "middle", "font-size": 9, fill: "var(--mc-dim)" }, { LL: "LL", FS: "FS", MER: "MER", BR: "BR" }[k]); });
    add("text", { x: 4, y: 12, "font-size": 9, fill: "var(--mc-dim)" }, `${Math.round(hi)}`);
    add("text", { x: 4, y: H - 22, "font-size": 9, fill: "var(--mc-dim)" }, `${Math.round(lo)}`);
    if (extra) add("polyline", { points: path(extra.ys), fill: "none", stroke: extra.color, "stroke-width": 2 });
    add("polyline", { points: path(ys), fill: "none", stroke: color, "stroke-width": 2 });
    const wrap = el("div", { class: "mc-chart-box" }, el("div", { class: "mc-chart-title" }, title, el("small", null, ` ${unit}`), extra ? el("small", { style: `color:${extra.color}` }, ` · ${extra.label}`) : null));
    wrap.append(s);
    return wrap;
  }

  // the kinematic sequence: pelvis, trunk, upper arm and elbow speeds on one chart around foot strike and release, each
  // segment's peak dotted, with the peaks and their timing in a table under it
  function sequenceBlock(R) {
    const S = R.series, ev = R.events, tR = R.tReal;
    const lines = [[S.pelvisV, true], [S.trunkV, true], [S.armV, false], [S.elbowV, false]].map(([ys, abs], k) => ({ ...R.seq[k], ys: ys.map((v) => (v == null ? null : abs ? Math.abs(v) : Math.max(0, v))) }));
    // from a little before foot strike to a little after release
    const fsT = tR[ev.FS], brT = tR[ev.BR];
    const from = Math.max(tR[0], fsT - Math.max(0.15, (brT - fsT) * 1.2)), to = Math.min(tR[tR.length - 1], brT + 0.12);
    const idx = tR.map((t, i) => (t >= from && t <= to ? i : -1)).filter((i) => i >= 0);
    const vals = lines.flatMap((l) => idx.map((i) => l.ys[i])).filter((v) => v != null && Number.isFinite(v));
    if (!vals.length) return null;
    const W = 640, H = 230, padL = 40, padB = 26, hi = Math.max(...vals) * 1.08 || 1;
    const X = (t) => padL + ((t - from) / (to - from || 1)) * (W - padL - 10), Y = (v) => 10 + (1 - v / hi) * (H - padB - 10);
    const NS = "http://www.w3.org/2000/svg";
    const s = document.createElementNS(NS, "svg");
    s.setAttribute("viewBox", `0 0 ${W} ${H}`); s.setAttribute("class", "mc-chart mc-seq-chart"); s.setAttribute("role", "img"); s.setAttribute("aria-label", "Kinematic sequence: pelvis, trunk, upper arm and elbow speeds through the delivery");
    const add = (tag, a, text) => { const n = document.createElementNS(NS, tag); Object.entries(a).forEach(([k, v]) => n.setAttribute(k, v)); if (text != null) n.textContent = text; s.append(n); return n; };
    const step = hi > 2000 ? 1000 : hi > 800 ? 500 : 200;
    for (let v = 0; v <= hi; v += step) { add("line", { x1: padL, x2: W - 10, y1: Y(v), y2: Y(v), stroke: "var(--mc-grid)", "stroke-width": v === 0 ? 1 : 0.5 }); add("text", { x: padL - 4, y: Y(v) + 3, "text-anchor": "end", "font-size": 10, fill: "var(--mc-dim)" }, String(v)); }
    [["FS", "Foot strike"], ["MER", "Max layback"], ["BR", "Release"]].forEach(([k, label]) => {
      const i = ev[k]; if (i == null || i < 0 || tR[i] < from || tR[i] > to) return;
      const x = X(tR[i]); add("line", { x1: x, x2: x, y1: 8, y2: H - padB, stroke: "var(--mc-dim)", "stroke-dasharray": "4 3" }); add("text", { x, y: k === "MER" ? 9 : H - 8, "text-anchor": "middle", "font-size": 10, fill: "var(--mc-dim)" }, label); // layback labeled at the top: it can sit close to release
    });
    lines.forEach((l) => add("polyline", { points: idx.map((i) => (l.ys[i] == null ? null : `${X(tR[i]).toFixed(1)},${Y(l.ys[i]).toFixed(1)}`)).filter(Boolean).join(" "), fill: "none", stroke: l.color, "stroke-width": 2.5 }));
    lines.forEach((l) => { if (l.i < 0 || l.ys[l.i] == null || tR[l.i] < from || tR[l.i] > to) return; add("circle", { cx: X(tR[l.i]), cy: Y(l.ys[l.i]), r: 4.5, fill: l.color, stroke: "#fff", "stroke-width": 1.5 }); });
    const table = el("table", { class: "mc-table mc-seq-table" },
      el("thead", null, el("tr", null, el("th", null, "Segment"), el("th", null, "Peak speed"), el("th", null, "After foot strike"), el("th", null, "Before release"))),
      el("tbody", null, lines.map((l) => el("tr", null,
        el("td", null, el("span", { class: "mc-swatch", style: `background:${l.color}` }), l.name),
        el("td", null, l.peak == null ? "–" : `${l.peak.toLocaleString()} °/s`),
        el("td", null, l.fromFS == null ? "–" : `${l.fromFS} ms`),
        el("td", null, l.beforeBR == null ? "–" : `${l.beforeBR} ms`)))));
    const est = R.rotSource === "estimate";
    return el("div", { class: "mc-seq" },
      el("div", { class: "mc-chart-title" }, "Kinematic sequence ", el("small", null, "°/s, from a little before foot strike to just after release"),
        el("span", { class: `mc-seq-flag ${R.inOrder ? "good" : "bad"}` }, R.inOrder ? "In order: hips → trunk → arm → elbow" : "Out of order")),
      el("div", { class: "mc-legend" }, lines.map((l) => el("span", null, el("span", { class: "mc-swatch", style: `background:${l.color}` }), l.name))),
      s, table,
      el("p", { class: "mc-hint" }, `Each segment should reach its fastest after the one before it and faster than it (hips, trunk, arm, elbow). ${est ? "Pelvis and trunk here are the pose model's 3D estimate from one camera; the two-camera setup measures them. " : ""}Upper arm and elbow come from the 3D estimate: the upper arm's swing stands in for the shoulder, since video can't see its internal rotation.`));
  }

  // ---- how to film -----------------------------------------------------------------------------------------------
  const HOW_TO = [
    ["Slow motion, 240 fps", "On the iPhone or iPad use Slo-Mo, set to 240 fps (Settings › Camera › Record Slo-mo). 120 fps is all right. Normal video (30 or 60 fps) blurs the arm, so the arm and rotation numbers won't hold up; leg and trunk angles are still fine."],
    ["Most Compatible format", "Settings › Camera › Formats › Most Compatible. The default (High Efficiency) won't open in every browser on a computer."],
    ["On a tripod, landscape", "Phone sideways, on a tripod or something steady, at about hip height (3 to 4 feet). No zoom past 1×, no moving the phone, and no one walking through the shot."],
    ["Open side camera", "Square to the line from the rubber to the plate, on the side his chest faces in his set (the third-base side for a righty, first-base side for a lefty), about 20 to 30 feet away, aimed at where his front foot will land."],
    ["Behind camera (two-camera setup)", "Directly behind him on the line through home plate, the same height, 20 to 30 feet back. Start both cameras before he comes set; they're lined up afterward at foot strike."],
    ["Whole body, the whole delivery", "His whole body in frame from his set through the follow-through, with a little room around him, feet included. One pitch per clip: start just before he comes set and stop after the follow-through."],
    ["Light and clothes", "Bright, even light with the sun not behind him. Fitted clothes (no baggy hoodie or jacket) and a background that isn't the same color as his uniform make the points easier to find."],
    ["Slo-Mo speed", "Check Settings › Camera › Record Slo-mo: iPhones come set to 120 fps; choose 240 if it's offered. Whatever it's on, choose the same under Recorded at here (the report warns if the timing looks off). In Photos, Edit the clip so the slow part covers the whole delivery, from leg lift to follow-through."],
    ["Filming from here", "Film it now opens the phone's camera and brings the clip straight back, but a web page can't start Slo-Mo, so it films at normal speed: fine for stride, leg and trunk angles, rough for arm and rotation timing. For those, film in the Camera app's Slo-Mo and Choose a video."],
  ];

  // ---- the tool ------------------------------------------------------------------------------------------------------
  function mount(root, opts) {
    const athlete = opts.athlete || {};
    const hKey = `mocapHeight:${athlete.id}`;
    const state = { setup: "one", throws: athlete.throws || "R", heightIn: Number(localStorage.getItem(hKey)) || opts.heightIn || "", captureFps: "auto", side: null, behind: null, result: null, busy: "" };
    root.classList.add("mc");
    const fileState = (key) => ({ file: null, video: null, fps: 30, start: 0, end: 0, tracked: null });

    const render = () => {
      root.replaceChildren(...[
        el("div", { class: "mc-head" }, el("h2", null, "Motion Capture ", el("small", null, athlete.name || "")),
          el("button", { type: "button", class: "mc-btn ghost", onclick: () => { state.showHow = !state.showHow; render(); } }, state.showHow ? "Hide filming tips" : "How to film it")),
        state.showHow ? el("ol", { class: "mc-how" }, HOW_TO.map(([t, d]) => el("li", null, el("b", null, t), " ", d))) : null,
        state.result ? results() : state.summary ? summaryView(state.summary) : setupForm(),
        historyBlock(),
      ].filter(Boolean));
    };

    function setupForm() {
      // a video for one camera: filmed now (the phone's camera opens and hands the clip straight back) or chosen from
      // the library (a Slo-Mo clip filmed in the Camera app: a web page can't start the camera in Slo-Mo)
      const pick = (key, label, hint) => {
        const f = state[key];
        const take = async (e) => {
          const file = e.target.files && e.target.files[0];
          e.target.value = "";
          if (!file) return;
          state.busy = "Opening the video…"; state.error = ""; render();
          try {
            const fs = fileState(key);
            if (state[key] && state[key].video) state[key].video.remove(); // the one it replaces
            fs.file = file; fs.video = await openVideo(file); fs.fps = await fileFps(fs.video);
            fs.start = 0; fs.end = fs.video.duration || 0;
            state[key] = fs; state.busy = "";
          } catch (err) { state.busy = ""; state.error = err.message || String(err); }
          render();
        };
        const film = el("input", { type: "file", accept: "video/*", capture: "environment", hidden: true, onchange: take });
        const choose = el("input", { type: "file", accept: "video/*", hidden: true, onchange: take });
        return el("div", { class: "mc-file" },
          el("div", { class: "mc-file-label" }, el("b", null, label), el("span", null, hint)),
          el("div", { class: "mc-row" },
            el("button", { type: "button", class: "mc-btn", disabled: !!state.busy, onclick: () => film.click() }, f ? "Film it again" : "Film it now"),
            el("button", { type: "button", class: "mc-btn ghost", disabled: !!state.busy, onclick: () => choose.click() }, f ? "Choose another video" : "Choose a video"),
            f ? el("span", { class: "mc-hint" }, f.file.name) : null),
          el("p", { class: "mc-hint" }, "Film it now opens the camera and brings the clip right back, but at normal speed (a web page can't start Slo-Mo), so the arm and rotation timing is rougher. For the best numbers, film it in the Camera app's Slo-Mo at 240 fps, then Choose a video."),
          film, choose,
          f ? trimmer(f) : null);
      };
      return el("div", { class: "mc-setup" },
        el("div", { class: "mc-row" },
          el("span", { class: "mc-seg", role: "group", "aria-label": "Camera setup" },
            el("button", { type: "button", class: `mc-seg-btn${state.setup === "one" ? " on" : ""}`, onclick: () => { state.setup = "one"; render(); } }, "One camera (open side)"),
            el("button", { type: "button", class: `mc-seg-btn${state.setup === "two" ? " on" : ""}`, onclick: () => { state.setup = "two"; render(); } }, "Two cameras (open side + behind)"))),
        el("div", { class: "mc-row" },
          el("label", null, "Throws", el("select", { onchange: (e) => { state.throws = e.target.value; } }, el("option", { value: "R", selected: state.throws === "R" }, "Right"), el("option", { value: "L", selected: state.throws === "L" }, "Left"))),
          el("label", null, "Height (in)", el("input", { type: "number", inputmode: "decimal", min: 48, max: 90, step: 0.5, value: state.heightIn, placeholder: "e.g. 74", oninput: (e) => { state.heightIn = Number(e.target.value) || ""; try { localStorage.setItem(hKey, String(state.heightIn)); } catch (x) { /* not remembered */ } } })),
          el("label", null, "Recorded at", el("select", { onchange: (e) => { state.captureFps = e.target.value; } },
            [["auto", "The file's own speed"], ["240", "240 fps slow motion"], ["120", "120 fps slow motion"]].map(([v, t]) => el("option", { value: v, selected: String(state.captureFps) === v }, t))))),
        el("p", { class: "mc-hint" }, "Height is needed for center-of-mass speed. \"Recorded at\" sets the timing: choose the slow-motion speed it was filmed at if the file plays it slowed down."),
        pick("side", "Open side video", "Square to the line to the plate, on the side his chest faces in his set"),
        state.setup === "two" ? pick("behind", "Behind video", "Directly behind him, on the line through home plate") : null,
        state.error ? el("p", { class: "mc-err" }, state.error) : null,
        el("div", { class: "mc-row" },
          el("button", { type: "button", class: "mc-btn", disabled: !state.side || (state.setup === "two" && !state.behind) || !!state.busy, onclick: run }, "Analyze the delivery"),
          state.busy ? el("span", { class: "mc-status", role: "status" }, state.busy) : null),
      );
    }

    // the part of the clip to analyze: scrub, then set its start and end
    function trimmer(f) {
      const v = f.video;
      v.className = "mc-preview"; v.controls = true; v.style.cssText = ""; // out of hiding, into the page where it's shown
      const label = el("span", { class: "mc-hint" });
      const show = () => { label.textContent = `Analyzing ${f.start.toFixed(2)}s to ${f.end.toFixed(2)}s of ${(v.duration || 0).toFixed(2)}s · the file runs at ${f.fps} fps`; };
      show();
      return el("div", { class: "mc-trim" }, v,
        el("div", { class: "mc-row" },
          el("button", { type: "button", class: "mc-btn ghost", onclick: () => { f.start = Math.min(v.currentTime, f.end - 0.05); show(); } }, "Start here"),
          el("button", { type: "button", class: "mc-btn ghost", onclick: () => { f.end = Math.max(v.currentTime, f.start + 0.05); show(); } }, "End here"),
          el("button", { type: "button", class: "mc-btn ghost", onclick: () => { f.start = 0; f.end = v.duration || 0; show(); } }, "Whole clip")),
        label,
        el("p", { class: "mc-hint" }, "Trim to the delivery: from just before he comes set to just after the follow-through."));
    }

    const scaleOf = (f) => { const cap = state.captureFps === "auto" ? f.fps : Number(state.captureFps); return f.fps / cap; };
    async function run() {
      state.error = "";
      try {
        state.busy = "Loading the pose model (the first time takes a moment)…"; render();
        await model();
        const one = async (f, name) => {
          const res = await track(f.video, f.start, f.end, f.fps, (p) => { state.busy = `Finding his body in the ${name} video… ${Math.round(p * 100)}%`; const s = root.querySelector(".mc-status"); if (s) s.textContent = state.busy; });
          if (res.frames.filter((x) => x.p).length < res.frames.length * 0.5) throw new Error(`The ${name} video: couldn't find him in most frames. Check that his whole body is in the picture and the light is good.`);
          return res;
        };
        state.edits = {}; // a fresh analysis: no dots moved yet
        state.side.tracked = await one(state.side, "open side");
        if (state.setup === "two") state.behind.tracked = await one(state.behind, "behind");
        compute();
        state.busy = "";
        state.frame = state.result.events.FS;
      } catch (err) { state.busy = ""; state.error = err.message || String(err); }
      render();
    }
    function compute(manual) {
      const cap = state.captureFps === "auto" ? state.side.fps : Number(state.captureFps);
      state.result = analyze({
        side: applyEdits(state.side.tracked, state.edits, cap), behind: state.setup === "two" ? state.behind.tracked : null, throws: state.throws, heightIn: Number(state.heightIn) || null,
        captureFps: cap, sideScale: scaleOf(state.side), behindScale: state.setup === "two" ? scaleOf(state.behind) : 1, events: manual || state.manual,
      });
      state.cap = cap;
    }

    // ---- keeping a session ------------------------------------------------------------------------------------------
    // Saving keeps the record (numbers, moments, thinned curves) with the pitcher's other records, and the tracked body
    // points (and, if wanted, the video) in the private "mocap" storage (supabase/migration_032_mocap.sql), so the full
    // report can be opened again anywhere, worked out afresh each time with the analysis as it is then.
    const STORE = "mocap";
    const sbc = () => window.supabaseClient;
    const pack = (tr) => ({
      W: tr.W, H: tr.H, t: tr.frames.map((f) => Math.round(f.t * 10000) / 10000),
      p: tr.frames.map((f) => (f.p ? f.p.map((q) => [Math.round(q[0]), Math.round(q[1]), Math.round(q[2] * 100)]) : null)),
      w: tr.frames.map((f) => (f.w ? f.w.map((q) => q.map((x) => Math.round(x * 1000))) : null)),
    });
    const unpack = (o) => ({ W: o.W, H: o.H, frames: o.t.map((t, i) => ({ t, p: o.p[i] ? o.p[i].map((q) => [q[0], q[1], q[2] / 100]) : null, w: o.w[i] ? o.w[i].map((q) => q.map((x) => x / 1000)) : null })) });
    const pathsOf = (rec) => (rec && rec.store ? [rec.store.path, rec.store.sideVideo, rec.store.behindVideo].filter(Boolean) : []);
    async function saveSession(note, keepVideo) {
      const R = state.result, S = R.series, was = state.saved;
      const id = was ? was.id : `mc-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      let store = was && was.store ? { ...was.store } : null, warn = "";
      if (!store) {
        try {
          const path = `${athlete.id}/${id}.json`;
          const body = JSON.stringify({ v: 1, side: pack(state.side.tracked), behind: state.setup === "two" && state.behind ? pack(state.behind.tracked) : null });
          const up = await sbc().storage.from(STORE).upload(path, new Blob([body], { type: "application/json" }), { contentType: "application/json", upsert: true });
          if (up.error) throw up.error;
          store = { path, sideFps: state.side.fps, behindFps: state.behind ? state.behind.fps : null };
          if (keepVideo) {
            for (const [key, f] of [["side", state.side], ["behind", state.setup === "two" ? state.behind : null]]) {
              if (!f || !f.file || !f.file.size) continue;
              const ext = (((f.file.name || "").match(/\.(\w{2,4})$/) || [])[1] || "mp4").toLowerCase();
              const vp = `${athlete.id}/${id}-${key}.${ext}`;
              const r2 = await sbc().storage.from(STORE).upload(vp, f.file, { contentType: f.file.type || (ext === "mov" ? "video/quicktime" : "video/mp4"), upsert: true });
              if (r2.error) warn = " The video didn't upload (too big for storage, most likely), so the report will reopen with the skeleton but not the video.";
              else store[`${key}Video`] = vp;
            }
          }
        } catch (e) {
          store = null;
          warn = /bucket not found/i.test((e && e.message) || "") ? " Only the summary will reopen until supabase/migration_032_mocap.sql is run." : " The tracking couldn't be stored, so only the summary will reopen later.";
        }
      }
      if (store) { store.manual = state.manual || null; store.edits = state.edits && Object.keys(state.edits).length ? state.edits : null; }
      const thin = (arr) => (arr ? arr.filter((_, i) => i % Math.max(1, Math.ceil(R.n / 120)) === 0).map((v) => (v == null ? null : Math.round(v * 10) / 10)) : null);
      const rec = {
        id, kind: "mocap", athleteId: athlete.id, date: was ? was.date : new Date().toISOString().slice(0, 10),
        setup: state.setup, throws: state.throws, heightIn: Number(state.heightIn) || null, captureFps: state.cap, rotSource: R.rotSource,
        metrics: Object.fromEntries(R.metrics.map((m) => [m.key, m.value])),
        labels: Object.fromEntries(R.metrics.map((m) => [m.key, [m.label, m.unit, m.range]])),
        events: Object.fromEntries(Object.entries(R.events).map(([kk, i]) => [kk, Math.round((R.tReal[i] - R.tReal[R.events.FS]) * 1000)])),
        series: { t: thin(R.tReal.map((t) => (t - R.tReal[R.events.FS]) * 1000)), kneeFlex: thin(S.kneeFlex), trunkFwd: thin(S.trunkFwd), sep: thin(S.sep), pelvisV: thin(S.pelvisV), trunkV: thin(S.trunkV), armV: thin(S.armV), elbowV: thin(S.elbowV), comV: thin(S.comV) },
        sequence: R.seq.map(({ name, peak, fromFS, beforeBR }) => ({ name, peak, fromFS, beforeBR })), inOrder: R.inOrder,
        note, files: [state.side.file && state.side.file.name, state.behind && state.behind.file && state.behind.file.name].filter(Boolean), store,
      };
      await opts.onSave(rec);
      state.saved = rec;
      return warn;
    }
    // a saved session, opened again: the full report when its tracking was kept, otherwise what was saved of it
    async function openSaved(rec) {
      state.error = "";
      if (!rec.store || !rec.store.path) { state.summary = rec; state.result = null; render(); window.scrollTo && root.scrollIntoView({ block: "start" }); return; }
      state.busy = "Opening the saved session…"; state.result = null; state.summary = null; render();
      try {
        const dl = await sbc().storage.from(STORE).download(rec.store.path);
        if (dl.error) throw dl.error;
        const data = JSON.parse(await dl.data.text());
        const vid = async (p) => {
          if (!p) return null;
          const s = await sbc().storage.from(STORE).createSignedUrl(p, 3600);
          if (s.error || !s.data) return null;
          try { return await openVideo(s.data.signedUrl); } catch (e) { return null; }
        };
        state.setup = rec.setup || "one"; state.throws = rec.throws || state.throws; state.heightIn = rec.heightIn || ""; state.captureFps = String(rec.captureFps || "auto");
        state.side = { file: { name: (rec.files || [])[0] || "saved video" }, video: await vid(rec.store.sideVideo), fps: rec.store.sideFps || 30, tracked: unpack(data.side), start: 0, end: 0 };
        state.behind = data.behind ? { file: { name: (rec.files || [])[1] || "saved video" }, video: await vid(rec.store.behindVideo), fps: rec.store.behindFps || 30, tracked: unpack(data.behind), start: 0, end: 0 } : null;
        state.manual = rec.store.manual || null;
        state.edits = rec.store.edits || {};
        state.saved = rec;
        compute();
        state.frame = state.result.events.FS;
        state.busy = "";
      } catch (e) {
        state.busy = ""; state.result = null; state.saved = null;
        state.error = `Couldn't open that session (${(e && e.message) || e}).`;
      }
      render();
      root.scrollIntoView({ block: "start" });
    }
    async function removeSaved(rec) {
      const q = { title: `Delete the ${rec.date || ""} session?`, text: "Its numbers, curves and any kept video are deleted. This can't be undone.", ok: "Delete", danger: true };
      const ok = window.askConfirm ? await window.askConfirm(q) : window.confirm(`${q.title} ${q.text}`);
      if (!ok) return;
      const paths = pathsOf(rec);
      if (paths.length) await sbc().storage.from(STORE).remove(paths).catch(() => null);
      try { if (opts.onDelete) await opts.onDelete(rec); } catch (e) { state.error = `Couldn't delete it (${(e && e.message) || e}).`; }
      if ((state.saved && state.saved.id === rec.id) || (state.summary && state.summary.id === rec.id)) { state.saved = null; state.summary = null; state.result = null; state.side = null; state.behind = null; state.manual = null; }
      render();
    }
    const backToStart = () => { if (state.side && state.side.video) state.side.video.remove(); if (state.behind && state.behind.video) state.behind.video.remove(); state.result = null; state.summary = null; state.saved = null; state.manual = null; state.edits = {}; state.side = null; state.behind = null; render(); };

    function results() {
      const R = state.result, f = state.side, tr = f.tracked;
      // the video stays on the page, out of sight, so its frames can still be drawn (Safari on an iPhone needs that)
      if (f.video) { f.video.controls = false; f.video.style.cssText = "position:fixed;left:-10000px;top:0;width:4px;height:4px;opacity:0;pointer-events:none"; }
      const canvas = el("canvas", { class: "mc-canvas" });
      const maxW = Math.min(900, root.clientWidth || 900);
      const k = Math.min(1, maxW / tr.W);
      canvas.width = Math.round(tr.W * k); canvas.height = Math.round(tr.H * k);
      const ctx = canvas.getContext("2d");
      const slider = el("input", { type: "range", min: 0, max: R.n - 1, step: 1, value: state.frame || 0, class: "mc-scrub", "aria-label": "Frame" });
      const caption = el("div", { class: "mc-caption" });
      let painting = Promise.resolve();
      // the frame's picture, kept so a dot being dragged can be redrawn over it without going back to the video
      const still = document.createElement("canvas");
      still.width = canvas.width; still.height = canvas.height;
      const sctx = still.getContext("2d");
      // Fix points: the joints that can be dragged, with a letter each
      const HANDLES = [[P.nose, "N"], [P.lSh, "S"], [P.rSh, "S"], [P.lEl, "E"], [P.rEl, "E"], [P.lWr, "W"], [P.rWr, "W"], [P.lHip, "H"], [P.rHip, "H"], [P.lKn, "K"], [P.rKn, "K"], [P.lAn, "A"], [P.rAn, "A"]];
      let drag = null; // { j, x, y } in video pixels while a dot is moved
      const pointsAt = (i) => { const q = R.pts[i].map((p) => p.slice()); if (drag) q[drag.j] = [drag.x, drag.y, 1]; return q; };
      const draw = (i) => {
        ctx.drawImage(still, 0, 0);
        const q = pointsAt(i);
        drawSkeleton(ctx, q, k, k, state.throws);
        if (state.fixing) {
          const sides = sidesOf(state.throws), armSet = new Set([sides.arm.sh, sides.arm.el, sides.arm.wr]);
          const moved = (state.edits && state.edits[i]) || {};
          HANDLES.forEach(([j, letter]) => {
            const x = q[j][0] * k, y = q[j][1] * k;
            ctx.beginPath(); ctx.arc(x, y, 9, 0, 2 * Math.PI);
            ctx.fillStyle = moved[j] ? "#ffd23f" : armSet.has(j) ? "#ff4d5e" : "rgba(20,20,20,0.75)"; ctx.fill();
            ctx.lineWidth = 2; ctx.strokeStyle = "#fff"; ctx.stroke();
            ctx.fillStyle = moved[j] || armSet.has(j) ? "#111" : "#fff"; ctx.font = "bold 10px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(letter, x, y + 0.5);
          });
        }
      };
      const paint = (i) => {
        state.frame = i;
        painting = painting.then(async () => {
          if (f.video) { await seek(f.video, tr.frames[i].t); sctx.drawImage(f.video, 0, 0, still.width, still.height); }
          else { sctx.fillStyle = "#111"; sctx.fillRect(0, 0, still.width, still.height); } // no video kept: the skeleton alone
          draw(i);
          const ev = Object.entries(R.events).find(([, j]) => j === i);
          const edited = state.edits && state.edits[i] ? " · dots moved here" : "";
          caption.textContent = `Frame ${i + 1} of ${R.n} · ${Math.round((R.tReal[i] - R.tReal[R.events.FS]) * 1000)} ms from foot strike${ev ? ` · ${EV_LABEL[ev[0]]}` : ""}${edited}`;
        });
      };
      // dragging a dot (Fix points on): grab the nearest joint, move it, and on letting go the numbers are worked out again
      const toVideo = (e) => { const b = canvas.getBoundingClientRect(), s = canvas.width / b.width; return [((e.clientX - b.left) * s) / k, ((e.clientY - b.top) * s) / k]; };
      canvas.addEventListener("pointerdown", (e) => {
        if (!state.fixing) return;
        const [x, y] = toVideo(e), q = R.pts[state.frame || 0];
        let best = null;
        HANDLES.forEach(([j]) => { const d = Math.hypot(q[j][0] - x, q[j][1] - y) * k; if (d < 24 && (!best || d < best.d)) best = { j, d }; });
        if (!best) return;
        e.preventDefault();
        canvas.setPointerCapture(e.pointerId);
        drag = { j: best.j, x, y };
        draw(state.frame || 0);
      });
      canvas.addEventListener("pointermove", (e) => { if (!drag) return; const [x, y] = toVideo(e); drag.x = x; drag.y = y; draw(state.frame || 0); });
      const drop = () => {
        if (!drag) return;
        const i = state.frame || 0, d = drag;
        drag = null;
        state.edits = { ...(state.edits || {}), [i]: { ...((state.edits || {})[i] || {}), [d.j]: [Math.round(d.x), Math.round(d.y)] } };
        compute(); render();
      };
      canvas.addEventListener("pointerup", drop);
      canvas.addEventListener("pointercancel", () => { drag = null; draw(state.frame || 0); });
      if (state.fixing) canvas.classList.add("fixing");
      slider.addEventListener("input", () => paint(Number(slider.value)));
      const go = (i) => { slider.value = i; paint(i); };
      setTimeout(() => paint(state.frame || 0), 0);
      const evBtns = el("div", { class: "mc-row" },
        el("button", { type: "button", class: "mc-btn ghost", onclick: () => go(Math.max(0, (state.frame || 0) - 1)) }, "◀"),
        Object.entries(R.events).map(([key, i]) => el("button", { type: "button", class: "mc-btn ghost", onclick: () => go(i) }, EV_LABEL[key])),
        el("button", { type: "button", class: "mc-btn ghost", onclick: () => go(Math.min(R.n - 1, (state.frame || 0) + 1)) }, "▶"));
      // a moment found in the wrong place can be set by hand, to the frame showing (the moments after it follow)
      const fix = el("div", { class: "mc-row mc-fix" }, el("span", { class: "mc-hint" }, "Moment in the wrong place? Go to the right frame and set it:"),
        Object.keys(R.events).map((key) => el("button", { type: "button", class: "mc-btn ghost small", onclick: () => {
          const order = ["LL", "FS", "MER", "BR"], keep = {};
          order.slice(0, order.indexOf(key)).forEach((kk) => { if (state.manual && state.manual[kk] != null) keep[kk] = state.manual[kk]; });
          state.manual = { ...keep, [key]: state.frame }; compute(); render();
        } }, `${EV_LABEL[key]} here`)),
        state.manual ? el("button", { type: "button", class: "mc-btn ghost small", onclick: () => { state.manual = null; compute(); render(); } }, "Back to automatic") : null);
      // Fix points: drag dots that missed their joint
      const nEdits = Object.keys(state.edits || {}).length;
      const fixDots = el("div", { class: "mc-row mc-fix" },
        el("button", { type: "button", class: `mc-btn ${state.fixing ? "" : "ghost"} small`, "aria-pressed": state.fixing ? "true" : "false", onclick: () => { state.fixing = !state.fixing; render(); } }, state.fixing ? "Done fixing points" : "Fix points"),
        state.fixing ? el("span", { class: "mc-hint" }, "Drag a dot onto the joint it belongs to (S shoulder, E elbow, W wrist, H hip, K knee, A ankle, N nose; the throwing arm's in red). The frames around it follow and the numbers update. Fix the frames that matter most: foot strike, max layback and release.") : null,
        state.edits && state.edits[state.frame || 0] ? el("button", { type: "button", class: "mc-btn ghost small", onclick: () => { const e2 = { ...state.edits }; delete e2[state.frame || 0]; state.edits = e2; compute(); render(); } }, "Undo fixes on this frame") : null,
        nEdits ? el("button", { type: "button", class: "mc-btn ghost small", onclick: () => { state.edits = {}; compute(); render(); } }, `Clear all fixes (${nEdits} frame${nEdits === 1 ? "" : "s"})`) : null);
      // the timing: what it was filmed at, changeable here; and a warning when foot strike to release is impossibly quick
      const fsbr = R.metrics.find((m) => m.key === "fsbr");
      const tooFast = fsbr && typeof fsbr.value === "number" && fsbr.value < 110 && state.cap >= 200;
      const timing = el("div", { class: "mc-row" },
        el("label", null, "Recorded at", el("select", { onchange: (e) => { state.captureFps = e.target.value; compute(); render(); } },
          [["auto", `The file's own speed (${state.side.fps} fps)`], ["240", "240 fps slow motion"], ["120", "120 fps slow motion"], ["60", "60 fps"]].map(([v, t]) => el("option", { value: v, selected: String(state.captureFps) === v }, t)))),
        tooFast ? el("p", { class: "mc-warn" }, `Foot strike to release is only ${fsbr.value} ms, quicker than any pitcher: this was most likely filmed at 120 fps slow motion (the iPhone's usual setting), not 240. `,
          el("button", { type: "button", class: "mc-btn small", onclick: () => { state.captureFps = "120"; compute(); render(); } }, "Use 120 fps")) : null);
      const table = metricsTable(R.metrics);
      const S = R.series;
      const charts = el("div", { class: "mc-charts" },
        chart("Lead knee flexion", "°", S.kneeFlex, R.tReal, R.events, "#3fa7ff"),
        chart("Trunk forward tilt", "°", S.trunkFwd, R.tReal, R.events, "#e0b03a"),
        chart(`Hip-shoulder separation${R.rotSource === "estimate" ? " (estimate)" : ""}`, "°", S.sep.map((x) => (x == null ? null : Math.abs(x))), R.tReal, R.events, "#c77dff"),
        chart(`Rotation speed${R.rotSource === "estimate" ? " (estimate)" : ""}`, "°/s", S.pelvisV.map((x) => (x == null ? null : Math.abs(x))), R.tReal, R.events, "#2ec4b6", { ys: S.trunkV.map((x) => (x == null ? null : Math.abs(x))), color: "#ff4d5e", label: "trunk (pelvis in teal)" }),
        S.comV ? chart("Center-of-mass speed toward the plate", "m/s", S.comV, R.tReal, R.events, "#8ac926") : null);
      const note = el("textarea", { class: "mc-note", rows: 2, placeholder: "Notes on this delivery…" });
      note.value = state.saved ? state.saved.note || "" : "";
      const keep = el("input", { type: "checkbox", checked: true });
      const saveMsg = el("span", { class: "mc-status" });
      const saved = state.saved;
      return el("div", { class: "mc-results" }, f.video, state.behind && state.behind.video,
        el("div", { class: "mc-row" },
          el("button", { type: "button", class: "mc-btn ghost", onclick: backToStart }, saved ? "← Back" : "← Another video"),
          el("span", { class: "mc-hint" }, `${saved ? `Saved session, ${saved.date} · ` : ""}${state.setup === "two" ? "Two cameras" : "One camera"} · timing at ${state.cap} fps · ${state.throws === "L" ? "lefty" : "righty"}${state.heightIn ? ` · ${state.heightIn}"` : " · no height, so no speed"}${f.video ? "" : " · no video kept, skeleton only"}`)),
        timing,
        canvas, slider, caption, evBtns, fixDots, fix,
        sequenceBlock(R),
        el("div", { class: "mc-grid" }, table, charts),
        el("p", { class: "mc-hint" }, R.rotSource === "estimate"
          ? "From one camera, hip-shoulder separation and rotation speeds are the pose model's own 3D estimate: good for spotting big changes, not for exact numbers. The two-camera setup measures them. Joint angles from phone video are good to about 5 to 10 degrees: compare sessions filmed the same way."
          : "Two cameras: the hips' and shoulders' turn comes from both views together, lined up at release. Joint angles from phone video are good to about 5 to 10 degrees: compare sessions filmed the same way."),
        opts.onSave ? el("div", { class: "mc-save" }, note,
          saved ? null : el("label", { class: "mc-keep" }, keep, " Also keep the video, to replay it with the skeleton later (needs room in storage)"),
          el("div", { class: "mc-row" },
            el("button", { type: "button", class: "mc-btn", onclick: async () => {
              saveMsg.textContent = "Saving…";
              try {
                const warn = await saveSession(note.value.trim(), keep.checked);
                saveMsg.textContent = `${saved ? "Changes saved." : "Saved."}${warn}`;
                const h = root.querySelector(".mc-history"); if (h) h.replaceWith(historyBlock());
              } catch (err) { saveMsg.textContent = `Couldn't save: ${(err && err.message) || err}`; }
            } }, saved ? "Save changes" : "Save this session"), saveMsg)) : null,
      );
    }
    // the numbers, each beside its usual range (out of it in amber)
    function metricsTable(metrics) {
      return el("table", { class: "mc-table" },
        el("thead", null, el("tr", null, el("th", null, ""), el("th", null, "His"), el("th", null, "Usual range"))),
        el("tbody", null, metrics.map((m) => {
          const [lo, hi] = (m.range || "").split("–").map(Number);
          const out = typeof m.value === "number" && Number.isFinite(lo) && Number.isFinite(hi) && (m.value < lo || m.value > hi);
          return el("tr", { title: m.note || "" }, el("td", null, m.label, m.note ? el("small", null, m.note) : null), el("td", { class: out ? "mc-out" : "" }, m.value == null ? "–" : `${m.value} ${m.unit || ""}`), el("td", null, m.range ? `${m.range} ${(m.unit || "").replace(/^° .*/, "°")}` : ""));
        })));
    }
    // a session saved before the tracking was kept: what was saved of it, numbers and the sequence
    function summaryView(rec) {
      const L = rec.labels || {}, S = rec.series || {};
      const metrics = Object.entries(rec.metrics || {}).map(([key, value]) => { const [label, unit, range] = L[key] || [key, "", ""]; return { key, label, value, unit, range }; });
      let seq = null;
      if (S.t && S.pelvisV) {
        const near = (ms) => { let k = 0, best = Infinity; S.t.forEach((x, i) => { const d = Math.abs(x - ms); if (d < best) { best = d; k = i; } }); return k; };
        const colors = ["#2ec4b6", "#ff4d5e", "#ff9f1c", "#c77dff"], blank = S.t.map(() => null);
        seq = sequenceBlock({
          tReal: S.t.map((ms) => ms / 1000), events: Object.fromEntries(Object.entries(rec.events || {}).map(([kk, ms]) => [kk, near(ms)])),
          series: { pelvisV: S.pelvisV, trunkV: S.trunkV || blank, armV: S.armV || blank, elbowV: S.elbowV || blank },
          seq: (rec.sequence || []).map((s, i) => ({ ...s, color: colors[i], i: s.fromFS == null ? -1 : near(s.fromFS) })), inOrder: !!rec.inOrder, rotSource: rec.rotSource,
        });
      }
      return el("div", { class: "mc-results" },
        el("div", { class: "mc-row" }, el("button", { type: "button", class: "mc-btn ghost", onclick: backToStart }, "← Back"),
          el("span", { class: "mc-hint" }, `Saved session, ${rec.date} · ${rec.setup === "two" ? "Two cameras" : "One camera"} · timing at ${rec.captureFps} fps`)),
        el("p", { class: "mc-hint" }, "This session was saved before the full tracking was kept, so here's what was saved of it, worked out with the analysis as it was then. Analyze the video again for the full report with the skeleton (and the newer, better-placed moments)."),
        seq, metricsTable(metrics), rec.note ? el("p", null, el("b", null, "Notes: "), rec.note) : null);
    }

    // saved sessions, newest first, with the main numbers side by side; open one for its report, or delete it
    function historyBlock() {
      const list = (opts.history ? opts.history() || [] : []).slice().sort((a, b) => (b.date || "").localeCompare(a.date || "") || String(b.id).localeCompare(String(a.id)));
      if (!list.length) return el("div", { class: "mc-history" });
      const keys = ["stride", "kneeFS", "kneeExt", "trunkBR", "sepMax", "fsbr", "comPeak"];
      const labelOf = (key) => { const r = list.find((x) => x.labels && x.labels[key]); return r ? r.labels[key][0].replace(/ \(estimate\)$/, "") : key; };
      return el("div", { class: "mc-history" }, el("h3", null, "Saved sessions"),
        el("div", { class: "mc-scroll" }, el("table", { class: "mc-table" },
          el("thead", null, el("tr", null, el("th", null, "Date"), el("th", null, "Setup"), keys.map((key) => el("th", null, labelOf(key))), el("th", null, "Notes"), el("th", null, ""))),
          el("tbody", null, list.slice(0, 20).map((r) => el("tr", null, el("td", null, r.date || ""), el("td", null, r.setup === "two" ? "2 cams" : "1 cam"),
            keys.map((key) => el("td", null, r.metrics && r.metrics[key] != null ? String(r.metrics[key]) : "–")), el("td", { class: "mc-note-cell" }, r.note || ""),
            el("td", { class: "mc-row-btns" },
              el("button", { type: "button", class: "mc-btn ghost small", onclick: () => openSaved(r) }, "Open report"),
              opts.onDelete ? el("button", { type: "button", class: "mc-btn ghost small", title: "Delete this session", "aria-label": `Delete the ${r.date} session`, onclick: () => removeSaved(r) }, "✕") : null)))))));
    }

    render();
    return { refresh: render };
  }

  window.MoCap = { mount, analyze, sequenceBlock, HOW_TO };
})();
