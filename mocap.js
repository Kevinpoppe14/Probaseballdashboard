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
  const MODEL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task";
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
        const make = (delegate) => vision.PoseLandmarker.createFromOptions(files, {
          baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: "VIDEO", numPoses: 1,
          minPoseDetectionConfidence: 0.4, minPosePresenceConfidence: 0.4, minTrackingConfidence: 0.4,
        });
        try { return await make("GPU"); } catch (e) { return make("CPU"); }
      })().catch((e) => { modelP = null; throw e; });
    }
    return modelP;
  }

  // ---- reading a video ------------------------------------------------------------------------------------------
  const once = (target, ev) => new Promise((ok) => target.addEventListener(ev, ok, { once: true }));
  async function openVideo(file) {
    const v = document.createElement("video");
    v.muted = true; v.playsInline = true; v.preload = "auto"; v.crossOrigin = "anonymous";
    v.src = URL.createObjectURL(file);
    await Promise.race([once(v, "loadeddata"), new Promise((_, bad) => v.addEventListener("error", () => bad(new Error("This browser can't play that video. On the iPhone, set Settings › Camera › Formats to Most Compatible, or open the dashboard in Safari.")), { once: true }))]);
    return v;
  }
  const seek = (v, t) => new Promise((ok) => { const done = () => { v.removeEventListener("seeked", done); ok(); }; v.addEventListener("seeked", done); v.currentTime = Math.max(0, Math.min(t, (v.duration || t) - 0.001)); });
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
  function clean(frames, key, sigmaFrames) {
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

  // ---- the analysis ---------------------------------------------------------------------------------------------
  // side: tracked open-side video; behind: tracked behind video or null. timeScale turns file seconds into real
  // seconds (a 30 fps file of 240 fps slow-mo runs 8× slow).
  function analyze({ side, behind, throws, heightIn, captureFps, sideScale, behindScale, events: manual }) {
    const S = sidesOf(throws), n = side.frames.length;
    const sig = Math.max(0.6, captureFps / 120);
    const pts = clean(side.frames, "p", sig), wpts = clean(side.frames, "w", sig);
    const tReal = side.frames.map((f) => (f.t - side.frames[0].t) * sideScale);
    const dt = (tReal[n - 1] - tReal[0]) / Math.max(1, n - 1);
    // his height on screen, from the first frames (standing in his set): floor to nose is about 91% of height
    const early = pts.slice(0, Math.max(3, Math.round(n * 0.08)));
    const floorY = (q) => Math.max(q[S.lead.heel][1], q[S.drive.heel][1], q[S.lead.toe][1], q[S.drive.toe][1]);
    const Hpx = early.reduce((s, q) => s + (floorY(q) - q[P.nose][1]), 0) / early.length / 0.91;
    // which way the plate is on screen: the way the lead foot travels
    const leadFootX = pts.map((q) => (q[S.lead.an][0] + q[S.lead.heel][0]) / 2);
    const dir = leadFootX[n - 1] - leadFootX[0] >= 0 ? 1 : -1;
    // the moments: peak leg lift (lead knee highest), foot strike (lead foot down and planted), max layback (throwing
    // hand furthest back behind the elbow), release (throwing hand fastest)
    const kneeY = pts.map((q) => q[S.lead.kn][1]);
    let LL = argBest(kneeY, 0, Math.round(n * 0.75), (a, b) => a < b);
    const footY = pts.map((q) => (q[S.lead.heel][1] + q[S.lead.toe][1] + q[S.lead.an][1]) / 3);
    const groundY = Math.max(...footY.slice(LL));
    const footVx = deriv(leadFootX, dt);
    let FS = -1;
    for (let i = LL + 1; i < n; i++) if (footY[i] >= groundY - 0.015 * Hpx && Math.abs(footVx[i] || 0) < 0.6 * Hpx) { FS = i; break; }
    if (FS < 0) FS = argBest(footY, LL, n - 1, (a, b) => a > b);
    const wr = pts.map((q) => q[S.arm.wr]);
    const wrVy = deriv(wr.map((q) => q[1]), dt);
    const wrSpeed = deriv(wr.map((q) => q[0]), dt).map((vx, i) => Math.hypot(vx || 0, wrVy[i] || 0));
    const brWindow = Math.round(0.45 / Math.max(dt, 1e-4));
    let BR = argBest(wrSpeed, FS, FS + brWindow, (a, b) => a > b);
    const layback = pts.map((q) => dir * (q[S.arm.wr][0] - q[S.arm.el][0]));
    let MER = argBest(layback, FS, Math.max(FS, BR), (a, b) => a < b);
    if (manual) { if (manual.LL != null) LL = manual.LL; if (manual.FS != null) FS = manual.FS; if (manual.MER != null) MER = manual.MER; if (manual.BR != null) BR = manual.BR; }

    // curves through the delivery
    const kneeFlex = pts.map((q) => { const a = angleAt(q[S.lead.hip], q[S.lead.kn], q[S.lead.an]); return a == null ? null : 180 - a; });
    const trunkFwd = pts.map((q) => { const h = mid(q[P.lHip], q[P.rHip]), s = mid(q[P.lSh], q[P.rSh]); return deg(Math.atan2(dir * (s[0] - h[0]), h[1] - s[1])); });
    const elbowFlex = pts.map((q) => { const a = angleAt(q[S.arm.sh], q[S.arm.el], q[S.arm.wr]); return a == null ? null : 180 - a; });
    const shAbd = pts.map((q) => { const h = mid(q[P.lHip], q[P.rHip]), s = mid(q[P.lSh], q[P.rSh]); return angleAt([h[0], h[1]], q[S.arm.sh], q[S.arm.el]); });
    const mPerPx = heightIn ? (heightIn * 0.0254) / Hpx : null;
    const comX = pts.map((q) => comOf(q)[0]);
    const comV = mPerPx ? deriv(comX, dt).map((v) => (v == null ? null : dir * v * mPerPx)) : null;

    // the turn of the hips and shoulders (degrees, in the ground plane), and so separation and rotation speeds
    let pelvis = null, trunk = null, rotSource = "estimate", behindAt = null;
    const gloveSign = throws === "L" ? 1 : -1; // from behind, a righty's glove side is to the left
    if (behind) {
      const S2 = behind;
      const bpts = clean(S2.frames, "p", sig);
      const bT = S2.frames.map((f) => (f.t - S2.frames[0].t) * behindScale);
      const bn = bpts.length;
      const bEarly = bpts.slice(0, Math.max(3, Math.round(bn * 0.08)));
      const bH = bEarly.reduce((s, q) => s + (floorY(q) - q[P.nose][1]), 0) / bEarly.length / 0.91;
      // line the two up at foot strike (found the same way in the behind view, or set by hand)
      const bFootY = bpts.map((q) => (q[S.lead.heel][1] + q[S.lead.toe][1] + q[S.lead.an][1]) / 3);
      const bKnee = bpts.map((q) => q[S.lead.kn][1]);
      const bLL = argBest(bKnee, 0, Math.round(bn * 0.75), (a, b) => a < b);
      const bGround = Math.max(...bFootY.slice(bLL));
      let bFS = -1;
      for (let i = bLL + 1; i < bn; i++) if (bFootY[i] >= bGround - 0.015 * bH) { bFS = i; break; }
      if (manual && manual.bFS != null) bFS = manual.bFS;
      if (bFS < 0) bFS = bLL;
      const offset = tReal[FS] - bT[bFS];
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
    const pelvisV = deriv(pelvis, dt), trunkV = deriv(trunk, dt);
    const sepMaxI = argBest(sep.map((x) => (x == null ? null : Math.abs(x))), LL, BR, (a, b) => a > b);
    const peakTo = Math.min(n - 1, BR + Math.round(0.05 / Math.max(dt, 1e-4))); // the turns peak by just after release
    const pvI = argBest(pelvisV.map((x) => (x == null ? null : Math.abs(x))), LL, peakTo, (a, b) => a > b);
    const tvI = argBest(trunkV.map((x) => (x == null ? null : Math.abs(x))), LL, peakTo, (a, b) => a > b);
    const ms = (i, j) => (i < 0 || j < 0 ? null : Math.round((tReal[j] - tReal[i]) * 1000));

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
      ["llfs", "Leg lift to foot strike", ms(LL, FS), "ms", "", "From the top of the leg lift to the foot landing."],
      ["fsbr", "Foot strike to release", ms(FS, BR), "ms", "130–180", "From the foot landing to the ball coming out."],
      ["comPeak", "Peak center-of-mass speed", comV ? r1(Math.max(...comV.slice(LL, FS + 1).filter((x) => x != null))) : null, "m/s", "2.5–3.5", "How fast his body moves toward the plate at its fastest before foot strike."],
      ["comFS", "Center-of-mass speed at foot strike", comV ? r1(comV[FS]) : null, "m/s", "", "How much of that speed is left when the foot lands."],
    ].filter(Boolean).map(([key, label, value, unit, range, note]) => ({ key, label, value, unit, range, note }));
    return {
      n, tReal, dir, Hpx, pts, events: { LL, FS, MER, BR }, metrics: M, rotSource,
      series: { kneeFlex, trunkFwd, sep, pelvisV, trunkV, comV, elbowFlex },
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

  // ---- how to film -----------------------------------------------------------------------------------------------
  const HOW_TO = [
    ["Slow motion, 240 fps", "On the iPhone or iPad use Slo-Mo, set to 240 fps (Settings › Camera › Record Slo-mo). 120 fps is all right. Normal video (30 or 60 fps) blurs the arm, so the arm and rotation numbers won't hold up; leg and trunk angles are still fine."],
    ["Most Compatible format", "Settings › Camera › Formats › Most Compatible. The default (High Efficiency) won't open in every browser on a computer."],
    ["On a tripod, landscape", "Phone sideways, on a tripod or something steady, at about hip height (3 to 4 feet). No zoom past 1×, no moving the phone, and no one walking through the shot."],
    ["Open side camera", "Square to the line from the rubber to the plate, on the side his chest faces in his set (the third-base side for a righty, first-base side for a lefty), about 20 to 30 feet away, aimed at where his front foot will land."],
    ["Behind camera (two-camera setup)", "Directly behind him on the line through home plate, the same height, 20 to 30 feet back. Start both cameras before he comes set; they're lined up afterward at foot strike."],
    ["Whole body, the whole delivery", "His whole body in frame from his set through the follow-through, with a little room around him, feet included. One pitch per clip: start just before he comes set and stop after the follow-through."],
    ["Light and clothes", "Bright, even light with the sun not behind him. Fitted clothes (no baggy hoodie or jacket) and a background that isn't the same color as his uniform make the points easier to find."],
    ["Slo-Mo speed", "In Photos, Edit the clip so the slow part covers the whole delivery, from leg lift to follow-through. Then choose the clip here and say it was 240 fps slow motion."],
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
        state.result ? results() : setupForm(),
        historyBlock(),
      ].filter(Boolean));
    };

    function setupForm() {
      const pick = (key, label, hint) => {
        const f = state[key];
        return el("div", { class: "mc-file" },
          el("label", { class: "mc-file-label" }, el("b", null, label), el("span", null, hint),
            el("input", { type: "file", accept: "video/*", onchange: async (e) => {
              const file = e.target.files && e.target.files[0];
              if (!file) return;
              state.busy = "Opening the video…"; render();
              try {
                const fs = fileState(key);
                fs.file = file; fs.video = await openVideo(file); fs.fps = await fileFps(fs.video);
                fs.start = 0; fs.end = fs.video.duration || 0;
                state[key] = fs; state.busy = "";
              } catch (err) { state.busy = ""; state.error = err.message || String(err); }
              render();
            } })),
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
      v.className = "mc-preview"; v.controls = true;
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
        side: state.side.tracked, behind: state.setup === "two" ? state.behind.tracked : null, throws: state.throws, heightIn: Number(state.heightIn) || null,
        captureFps: cap, sideScale: scaleOf(state.side), behindScale: state.setup === "two" ? scaleOf(state.behind) : 1, events: manual || state.manual,
      });
      state.cap = cap;
    }

    function results() {
      const R = state.result, f = state.side, tr = f.tracked;
      const canvas = el("canvas", { class: "mc-canvas" });
      const maxW = Math.min(900, root.clientWidth || 900);
      const k = Math.min(1, maxW / tr.W);
      canvas.width = Math.round(tr.W * k); canvas.height = Math.round(tr.H * k);
      const ctx = canvas.getContext("2d");
      const slider = el("input", { type: "range", min: 0, max: R.n - 1, step: 1, value: state.frame || 0, class: "mc-scrub", "aria-label": "Frame" });
      const caption = el("div", { class: "mc-caption" });
      let painting = Promise.resolve();
      const paint = (i) => {
        state.frame = i;
        painting = painting.then(async () => {
          await seek(f.video, tr.frames[i].t);
          ctx.drawImage(f.video, 0, 0, canvas.width, canvas.height);
          drawSkeleton(ctx, R.pts[i], k, k, state.throws);
          const ev = Object.entries(R.events).find(([, j]) => j === i);
          caption.textContent = `Frame ${i + 1} of ${R.n} · ${Math.round((R.tReal[i] - R.tReal[R.events.FS]) * 1000)} ms from foot strike${ev ? ` · ${EV_LABEL[ev[0]]}` : ""}`;
        });
      };
      slider.addEventListener("input", () => paint(Number(slider.value)));
      const go = (i) => { slider.value = i; paint(i); };
      setTimeout(() => paint(state.frame || 0), 0);
      const evBtns = el("div", { class: "mc-row" },
        el("button", { type: "button", class: "mc-btn ghost", onclick: () => go(Math.max(0, (state.frame || 0) - 1)) }, "◀"),
        Object.entries(R.events).map(([key, i]) => el("button", { type: "button", class: "mc-btn ghost", onclick: () => go(i) }, EV_LABEL[key])),
        el("button", { type: "button", class: "mc-btn ghost", onclick: () => go(Math.min(R.n - 1, (state.frame || 0) + 1)) }, "▶"));
      // a moment found in the wrong place can be set by hand, to the frame showing
      const fix = el("div", { class: "mc-row mc-fix" }, el("span", { class: "mc-hint" }, "Moment in the wrong place? Go to the right frame and set it:"),
        Object.keys(R.events).map((key) => el("button", { type: "button", class: "mc-btn ghost small", onclick: () => { state.manual = { ...(state.manual || {}), [key]: state.frame }; compute(); render(); } }, `${EV_LABEL[key]} here`)),
        state.manual ? el("button", { type: "button", class: "mc-btn ghost small", onclick: () => { state.manual = null; compute(); render(); } }, "Back to automatic") : null);
      const table = el("table", { class: "mc-table" },
        el("thead", null, el("tr", null, el("th", null, ""), el("th", null, "His"), el("th", null, "Usual range"))),
        el("tbody", null, R.metrics.map((m) => {
          const [lo, hi] = (m.range || "").split("–").map(Number);
          const out = m.value != null && Number.isFinite(lo) && Number.isFinite(hi) && (m.value < lo || m.value > hi);
          return el("tr", { title: m.note }, el("td", null, m.label, el("small", null, m.note)), el("td", { class: out ? "mc-out" : "" }, m.value == null ? "–" : `${m.value} ${m.unit}`), el("td", null, m.range ? `${m.range} ${m.unit.replace(/^° .*/, "°")}` : ""));
        })));
      const S = R.series;
      const charts = el("div", { class: "mc-charts" },
        chart("Lead knee flexion", "°", S.kneeFlex, R.tReal, R.events, "#3fa7ff"),
        chart("Trunk forward tilt", "°", S.trunkFwd, R.tReal, R.events, "#e0b03a"),
        chart(`Hip-shoulder separation${R.rotSource === "estimate" ? " (estimate)" : ""}`, "°", S.sep.map((x) => (x == null ? null : Math.abs(x))), R.tReal, R.events, "#c77dff"),
        chart(`Rotation speed${R.rotSource === "estimate" ? " (estimate)" : ""}`, "°/s", S.pelvisV.map((x) => (x == null ? null : Math.abs(x))), R.tReal, R.events, "#2ec4b6", { ys: S.trunkV.map((x) => (x == null ? null : Math.abs(x))), color: "#ff4d5e", label: "trunk (pelvis in teal)" }),
        S.comV ? chart("Center-of-mass speed toward the plate", "m/s", S.comV, R.tReal, R.events, "#8ac926") : null);
      const note = el("textarea", { class: "mc-note", rows: 2, placeholder: "Notes on this delivery…" });
      const saveMsg = el("span", { class: "mc-status" });
      return el("div", { class: "mc-results" },
        el("div", { class: "mc-row" },
          el("button", { type: "button", class: "mc-btn ghost", onclick: () => { state.result = null; state.manual = null; render(); } }, "← Another video"),
          el("span", { class: "mc-hint" }, `${state.setup === "two" ? "Two cameras" : "One camera"} · timing at ${state.cap} fps · ${state.throws === "L" ? "lefty" : "righty"}${state.heightIn ? ` · ${state.heightIn}"` : " · no height, so no speed"}`)),
        canvas, slider, caption, evBtns, fix,
        el("div", { class: "mc-grid" }, table, charts),
        el("p", { class: "mc-hint" }, R.rotSource === "estimate"
          ? "From one camera, hip-shoulder separation and rotation speeds are the pose model's own 3D estimate: good for spotting big changes, not for exact numbers. The two-camera setup measures them. Joint angles from phone video are good to about 5 to 10 degrees: compare sessions filmed the same way."
          : "Two cameras: the hips' and shoulders' turn comes from both views together, lined up at foot strike. Joint angles from phone video are good to about 5 to 10 degrees: compare sessions filmed the same way."),
        opts.onSave ? el("div", { class: "mc-save" }, note, el("div", { class: "mc-row" },
          el("button", { type: "button", class: "mc-btn", onclick: async () => {
            saveMsg.textContent = "Saving…";
            const thin = (arr) => (arr ? arr.filter((_, i) => i % Math.max(1, Math.ceil(R.n / 120)) === 0).map((v) => (v == null ? null : Math.round(v * 10) / 10)) : null);
            const rec = {
              id: `mc-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, kind: "mocap", athleteId: athlete.id, date: new Date().toISOString().slice(0, 10),
              setup: state.setup, throws: state.throws, heightIn: Number(state.heightIn) || null, captureFps: state.cap, rotSource: R.rotSource,
              metrics: Object.fromEntries(R.metrics.map((m) => [m.key, m.value])),
              labels: Object.fromEntries(R.metrics.map((m) => [m.key, [m.label, m.unit, m.range]])),
              events: Object.fromEntries(Object.entries(R.events).map(([kk, i]) => [kk, Math.round((R.tReal[i] - R.tReal[R.events.FS]) * 1000)])),
              series: { t: thin(R.tReal.map((t) => (t - R.tReal[R.events.FS]) * 1000)), kneeFlex: thin(S.kneeFlex), trunkFwd: thin(S.trunkFwd), sep: thin(S.sep), pelvisV: thin(S.pelvisV), trunkV: thin(S.trunkV), comV: thin(S.comV) },
              note: note.value.trim(), files: [state.side.file && state.side.file.name, state.behind && state.behind.file && state.behind.file.name].filter(Boolean),
            };
            try { await opts.onSave(rec); saveMsg.textContent = "Saved."; state.savedTick = Date.now(); const h = root.querySelector(".mc-history"); if (h) h.replaceWith(historyBlock()); }
            catch (err) { saveMsg.textContent = `Couldn't save: ${err.message || err}`; }
          } }, "Save this session"), saveMsg)) : null,
      );
    }

    // saved sessions, newest first, with the main numbers side by side
    function historyBlock() {
      const list = (opts.history ? opts.history() || [] : []).slice().sort((a, b) => (b.date || "").localeCompare(a.date || "") || String(b.id).localeCompare(String(a.id)));
      if (!list.length) return el("div", { class: "mc-history" });
      const keys = ["stride", "kneeFS", "kneeExt", "trunkBR", "sepMax", "fsbr", "comPeak"];
      const labelOf = (key) => { const r = list.find((x) => x.labels && x.labels[key]); return r ? r.labels[key][0].replace(/ \(estimate\)$/, "") : key; };
      return el("div", { class: "mc-history" }, el("h3", null, "Saved sessions"),
        el("div", { class: "mc-scroll" }, el("table", { class: "mc-table" },
          el("thead", null, el("tr", null, el("th", null, "Date"), el("th", null, "Setup"), keys.map((key) => el("th", null, labelOf(key))), el("th", null, "Notes"))),
          el("tbody", null, list.slice(0, 12).map((r) => el("tr", null, el("td", null, r.date || ""), el("td", null, r.setup === "two" ? "2 cams" : "1 cam"),
            keys.map((key) => el("td", null, r.metrics && r.metrics[key] != null ? String(r.metrics[key]) : "–")), el("td", { class: "mc-note-cell" }, r.note || "")))))));
    }

    render();
    return { refresh: render };
  }

  window.MoCap = { mount, analyze, HOW_TO };
})();
