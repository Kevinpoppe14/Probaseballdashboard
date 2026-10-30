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
//   window.MoCap.mount(container, { athlete: { id, name, throws, email }, onSave(record) -> Promise, onDelete(record), history() -> [records] })
// A saved session is kept like the other pitching records (assessments table, kind "mocap"): the setup, the frame
// rate, the moments, the numbers and a thinned copy of the curves, not the video.
(function () {
  const TASKS = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
  // the larger, slower, more accurate of the pose models (better on a fast arm), and the standard one to fall back on
  const MODELS = ["https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task", "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task"];
  const MAX_FRAMES = 900; // at most this many frames of a clip are analyzed (a long high-speed clip is thinned evenly)
  // Which analysis and which tracking a saved session's numbers come from. Raise ANALYSIS_V when a change to analyze()
  // changes the numbers, and TRACK_V when a change to track() changes where the points land: sessions saved before
  // then show as older, and can be re-run (Saved sessions › Re-run, or Re-track from their kept video).
  // (A session saved before these were kept counts as 1 of each.)
  const ANALYSIS_V = 2, TRACK_V = 1;

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
  function model() {
    if (!modelP) {
      modelP = (async () => {
        const vision = await import(`${TASKS}/vision_bundle.mjs`);
        const files = await vision.FilesetResolver.forVisionTasks(`${TASKS}/wasm`);
        const make = (delegate, path) => vision.PoseLandmarker.createFromOptions(files, {
          baseOptions: { modelAssetPath: path, delegate }, runningMode: "IMAGE", numPoses: 1,
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
  // The file's own frame rate, from how often its picture changes: step through a stretch of it in 1/480 s steps and
  // time the changes (playing it and counting frames is unreliable: a busy or background page skips frames). Tried at
  // a few places in case one is still; falls back to 30.
  async function fileFps(v) {
    const c = document.createElement("canvas"); c.width = 48; c.height = 27;
    const g = c.getContext("2d", { willReadFrequently: true });
    const look = () => { g.drawImage(v, 0, 0, 48, 27); const p = g.getImageData(0, 0, 48, 27).data; let h = 0; for (let i = 0; i < p.length; i += 8) h = (h * 31 + p[i]) >>> 0; return h; };
    const dur = v.duration || 0;
    const snap = (fps) => [24, 25, 30, 48, 50, 60, 120, 240].reduce((best, f) => (Math.abs(f - fps) < Math.abs(best - fps) ? f : best), 30);
    for (const at of [0.5, 0.35, 0.65, 0.2]) {
      const t0 = dur * at, changes = [];
      let last = null;
      for (let k = 0; k <= 96 && t0 + k / 480 < dur; k++) {
        const t = t0 + k / 480;
        await seek(v, t);
        const h = look();
        if (last !== null && h !== last) changes.push(t);
        last = h;
      }
      if (changes.length >= 4) { const span = (changes[changes.length - 1] - changes[0]) / (changes.length - 1); return snap(1 / span); }
    }
    return 30;
  }
  // ---- tape on the bat ------------------------------------------------------------------------------------------
  // A strip of bright tape on the end of the barrel, found by its color: the colors it can be, as ranges of hue
  // (degrees), saturation and brightness (0 to 1), each well away from skin, dirt, grass and a gray or white uniform
  const TAPES = {
    green: (h, s, v) => h >= 75 && h <= 165 && s > 0.45 && v > 0.4,
    pink: (h, s, v) => h >= 290 && h <= 345 && s > 0.4 && v > 0.45,
    orange: (h, s, v) => h >= 12 && h <= 38 && s > 0.65 && v > 0.55,
    yellow: (h, s, v) => h >= 45 && h <= 68 && s > 0.55 && v > 0.6,
  };
  const hsv = (r, g, b) => {
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let h = 0;
    if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [(h * 60 + 360) % 360, mx ? d / mx : 0, mx / 255];
  };
  // the tape in one frame: within `radius` of `near` (the hands), the densest patch of its color (nearest where it was
  // last frame, if it was found), as [x, y, pixels matched]; null if there's too little of it
  function findTape(v, test, near, radius, prev, scratch) {
    const W = v.videoWidth || v.width, H = v.videoHeight || v.height; // (a video, or a still for testing)
    const x0 = Math.max(0, near[0] - radius), y0 = Math.max(0, near[1] - radius), x1 = Math.min(W, near[0] + radius), y1 = Math.min(H, near[1] + radius);
    const bw = x1 - x0, bh = y1 - y0;
    if (bw < 8 || bh < 8) return null;
    const k = Math.min(1, 360 / Math.max(bw, bh)), cw = Math.max(2, Math.round(bw * k)), ch = Math.max(2, Math.round(bh * k));
    scratch.width = cw; scratch.height = ch;
    const g = scratch.getContext("2d", { willReadFrequently: true });
    g.drawImage(v, x0, y0, bw, bh, 0, 0, cw, ch);
    const d = g.getImageData(0, 0, cw, ch).data, cell = 6, gx = Math.ceil(cw / cell), counts = new Map(), hits = [];
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const o = (y * cw + x) * 4, [hh, ss, vv] = hsv(d[o], d[o + 1], d[o + 2]);
      if (!test(hh, ss, vv)) continue;
      hits.push([x, y]);
      const key = Math.floor(y / cell) * gx + Math.floor(x / cell);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    if (hits.length < 3) return null;
    let best = null;
    counts.forEach((c, key) => {
      const cx = ((key % gx) + 0.5) * cell / k + x0, cy = (Math.floor(key / gx) + 0.5) * cell / k + y0;
      const score = c - (prev ? (Math.hypot(cx - prev[0], cy - prev[1]) / radius) * 6 : 0);
      if (!best || score > best.score) best = { score, cx, cy };
    });
    let sx = 0, sy = 0, n = 0;
    hits.forEach(([x, y]) => { const X = x / k + x0, Y = y / k + y0; if (Math.hypot(X - best.cx, Y - best.cy) < (cell * 2.5) / k) { sx += X; sy += Y; n++; } });
    return n >= 3 ? [sx / n, sy / n, n] : null;
  }

  // Every frame from t0 to t1 through the model: { t (file seconds), p: [[x px, y px, visibility] × 33], w: [[x, y, z] m
  // × 33] }. Each frame is looked at fresh (the model's own frame-to-frame following lags a fast arm, or loses it when
  // the hand leaves the area it was watching), on a crop around where he was the frame before, with plenty of room for
  // the arm to reach into, so he fills more of what the model sees. If he isn't found there, the whole frame is tried.
  // (`times`, given, are the exact moments to look at: a session tracked again looks at the same frames it did before,
  // so its moments set by hand and its fixed points still line up)
  // (`tape`, given, is the color of tape on the end of the bat: each frame it's looked for near the hands too, b: [x, y,
  // how many pixels matched], for the barrel's path, speed and angle in a swing)
  async function track(v, t0, t1, fps, onProgress, times, tape) {
    const lm = await model();
    const tapeTest = tape && TAPES[tape], scratch = tapeTest ? document.createElement("canvas") : null;
    let lastB = null;
    const step = times ? (times.length > 1 ? times[1] - times[0] : 1 / fps) : Math.max(1 / fps, (t1 - t0) / MAX_FRAMES);
    if (!times) { times = []; for (let t = t0; t <= t1 + 1e-6; t += step) times.push(t); }
    t0 = times[0]; t1 = times[times.length - 1];
    const W = v.videoWidth, H = v.videoHeight, out = [];
    const crop = document.createElement("canvas"), cctx = crop.getContext("2d");
    let box = null;
    for (let i = 0; i < times.length; i++) {
      const t = times[i];
      await seek(v, t);
      let res = null, bx = 0, by = 0, bw = W, bh = H;
      if (box) {
        ({ x: bx, y: by, w: bw, h: bh } = box);
        const sc = Math.min(1, 1024 / Math.max(bw, bh));
        crop.width = Math.max(16, Math.round(bw * sc)); crop.height = Math.max(16, Math.round(bh * sc));
        cctx.drawImage(v, bx, by, bw, bh, 0, 0, crop.width, crop.height);
        res = lm.detect(crop);
        if (!(res.landmarks && res.landmarks[0])) res = null;
      }
      if (!res) { bx = 0; by = 0; bw = W; bh = H; res = lm.detect(v); }
      const p = res.landmarks && res.landmarks[0], w = res.worldLandmarks && res.worldLandmarks[0];
      const pts = p ? p.map((q) => [bx + q.x * bw, by + q.y * bh, q.visibility == null ? 1 : q.visibility]) : null;
      let b = null;
      if (tapeTest && pts) {
        // within reach of a bat from the hands: about 62% of his height (the bat's 45% and some room)
        const tall = (Math.max(pts[27][1], pts[28][1]) - pts[0][1]) / 0.87 || H * 0.6;
        b = findTape(v, tapeTest, [(pts[15][0] + pts[16][0]) / 2, (pts[15][1] + pts[16][1]) / 2], tall * 0.62, lastB, scratch);
        if (b) lastB = b;
      }
      out.push({ t, p: pts, w: w ? w.map((q) => [q.x, q.y, q.z]) : null, b });
      // where to look next frame: a square around his body, 1.8 times its size, so a fast arm or a long stride stays in
      if (pts) {
        const seen = pts.filter((q) => q[2] > 0.3);
        const xs = seen.map((q) => q[0]), ys = seen.map((q) => q[1]);
        if (xs.length > 8) {
          const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
          const side = Math.min(Math.max(W, H), Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * 1.8);
          const x = Math.max(0, Math.min(W - side, cx - side / 2)), y = Math.max(0, Math.min(H - side, cy - side / 2));
          box = { x, y, w: Math.min(side, W - x), h: Math.min(side, H - y) };
        } else box = null;
      } else box = null;
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
        const half = Math.max(1, Math.floor(medianFrames / 2));
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
  // A coach can drag a body point to where the joint really is on any frame. The fix is laid on after the smoothing,
  // so the point lands exactly where it was put; the frames either side (about 25 ms) are shifted the same way, fading
  // out, so the path stays smooth. Only the side view's 2D points move: the upper arm's speed comes from the model's
  // 3D estimate, which a drag on a picture can't correct.
  function applyEdits(pts, edits, K) {
    const byJoint = {};
    Object.keys(edits || {}).forEach((f) => Object.entries(edits[f] || {}).forEach(([j, xy]) => { (byJoint[j] = byJoint[j] || []).push([Number(f), xy]); }));
    Object.entries(byJoint).forEach(([jj, list]) => {
      const j = Number(jj);
      const shifts = list.filter(([f]) => pts[f]).map(([f, xy]) => ({ f, x: xy[0], y: xy[1], dx: xy[0] - pts[f][j][0], dy: xy[1] - pts[f][j][1] }));
      const moves = pts.map(() => null);
      pts.forEach((q, i) => {
        let best = null;
        shifts.forEach((s) => { const d = Math.abs(s.f - i); if (d <= K && (!best || d < best.d)) best = { s, d }; });
        if (best) moves[i] = best;
      });
      moves.forEach((b, i) => {
        if (!b) return;
        if (b.d === 0) { pts[i][j] = [b.s.x, b.s.y, 1]; return; }
        const w = 1 - b.d / (K + 1);
        pts[i][j] = [pts[i][j][0] + b.s.dx * w, pts[i][j][1] + b.s.dy * w, pts[i][j][2]];
      });
    });
  }

  // a Gaussian smoothing of one series (s frames wide), skipping gaps
  const smoothSeries = (xs, s) => xs.map((_, i) => {
    let sum = 0, ws = 0;
    for (let k = -Math.ceil(2.5 * s); k <= Math.ceil(2.5 * s); k++) { const v = xs[i + k]; if (v == null || !Number.isFinite(v)) continue; const w = Math.exp(-(k * k) / (2 * s * s)); sum += v * w; ws += w; }
    return ws ? sum / ws : null;
  });

  // ---- the analysis ---------------------------------------------------------------------------------------------
  // ---- inferred: what the ground pushes with, and what the mechanics say about arm stress and velo ---------------------
  // Ground force (shared with hitting, mocap_kinds.js): whatever speeds the body's center of mass up or slows it down, or
  // holds it up against gravity, is the ground pushing on him, F = m(a + g). From the side view it's the total of both
  // feet, vertical and toward the target, in body weights (and pounds with his weight): an estimate, the double
  // difference of points from video being noisy, so it's smoothed hard.
  function groundForce({ pts, dt, sig, dir, mPerPx }) {
    if (!mPerPx) return null;
    const cx = smoothSeries(pts.map((q) => comOf(q)[0]), sig * 4), cy = smoothSeries(pts.map((q) => comOf(q)[1]), sig * 4);
    const acc = (xs) => smoothSeries(deriv(deriv(xs, dt), dt), sig * 2);
    return {
      vert: acc(cy).map((a) => (a == null ? null : 1 - (a * mPerPx) / 9.81)), // y grows down the picture
      horiz: acc(cx).map((a) => (a == null ? null : (dir * a * mPerPx) / 9.81)), // + pushing him toward the target
    };
  }
  // the peak ground forces in a movement's windows, as numbers (body weights, and pounds with his weight)
  function forceMetrics(g, weightKg, list) {
    const out = [], lb = weightKg ? weightKg / 0.4536 : null;
    if (!g) return out;
    list.forEach(([key, label, which, a, b, most, note]) => {
      const xs = g[which], i = argBest(xs, a, b, most === "max" ? (x, y) => x > y : (x, y) => x < y), bw = i < 0 ? null : xs[i];
      out.push({ key, label: `${label} (estimate)`, value: bw == null ? null : Math.round(Math.abs(bw) * 100) / 100, unit: "× body weight", range: "", note });
      if (lb && bw != null) out.push({ key: `${key}Lb`, label: `${label} (estimate)`, value: Math.round(Math.abs(bw) * lb), unit: "lb", range: "", note: "" });
    });
    return out;
  }
  // A pitch's: ground force before and after foot strike, and two checklists from its numbers. Arm stress: positions and
  // timing tied in research to more elbow and shoulder load (arm position at foot strike, the trunk turning early, the
  // sequence out of order, a front leg that gives, a big lean to the glove side). Velo: the numbers that go with
  // throwing hard, against their usual ranges. Both are flags to look at, not a diagnosis.
  function inferred({ pts, dt, sig, dir, mPerPx, weightKg, FS, BR, LL, fr, metrics, rotSource }) {
    const val = (k) => { const m = metrics.find((x) => x.key === k); return m ? m.value : null; };
    metrics.push(...forceMetrics(groundForce({ pts, dt, sig, dir, mPerPx }), weightKg, [
      ["grfV", "Peak vertical ground force after foot strike", "vert", FS, BR + fr(0.05), "max", "Both feet together, from his center of mass: mostly the front leg landing and bracing."],
      ["grfBrake", "Peak braking force", "horiz", FS, BR, "min", "The ground slowing him toward the plate after foot strike: the front leg blocking."],
      ["grfDrive", "Peak drive force", "horiz", LL, FS, "max", "The ground pushing him toward the plate before foot strike: the back leg driving."],
    ]));
    const inRange = (v, lo, hi) => v != null && typeof v === "number" && v >= lo && v <= hi;
    const est = rotSource === "estimate" ? " (estimate)" : "";
    const stress = [
      ["Shoulder abduction at foot strike", val("abdFS"), "80–100°", inRange(val("abdFS"), 80, 100), "An arm too low or too high when the foot lands loads the shoulder and elbow more."],
      ["Elbow flexion at foot strike", val("elbowFS"), "80–110°", inRange(val("elbowFS"), 80, 110), "The arm's position at foot strike, as above."],
      [`Pelvis → trunk timing${est}`, val("seq"), "20 ms or more", val("seq") != null && val("seq") >= 20, "The trunk turning early (with or before the hips) goes with more elbow varus torque and shoulder load."],
      ["Kinematic sequence", val("order"), "In order", val("order") === "In order", "Out of order, the arm makes up for what the body didn't pass on."],
      ["Lead leg block", val("kneeExt"), "0° or more", val("kneeExt") != null && val("kneeExt") >= 0, "A front knee that keeps bending leaks energy, and the arm makes it up."],
      val("lean") != null ? ["Trunk lean to the glove side", val("lean"), "35° or less", val("lean") <= 35, "A big lean to the glove side adds velo, and elbow load with it."] : null,
    ].filter(Boolean).filter((r) => r[1] != null);
    const velo = [
      ["Stride length", val("stride"), 75, 90, "% of height"], ["Lead leg block", val("kneeExt"), 5, 25, "°"], ["Trunk forward tilt at release", val("trunkBR"), 30, 45, "°"],
      [`Peak hip-shoulder separation${est}`, val("sepMax"), 40, 60, "°"], [`Peak pelvis rotation speed${est}`, val("pelvisV"), 450, 9999, "°/s"],
      [`Peak trunk rotation speed${est}`, val("trunkV"), 800, 9999, "°/s"], [`Trunk / pelvis speed gain${est}`, val("gain"), 1.4, 9999, "×"], ["Peak center-of-mass speed", val("comPeak"), 2.5, 9999, "m/s"],
    ].filter((r) => r[1] != null && typeof r[1] === "number");
    const flags = stress.filter((r) => !r[3]).length, good = velo.filter((r) => r[1] >= r[2] && r[1] <= r[3]).length;
    if (stress.length) metrics.push({ key: "stressFlags", label: "Arm stress flags", value: `${flags} of ${stress.length}`, unit: "", range: "", note: "Positions and timing tied to more elbow and shoulder load (the table below)." });
    if (velo.length) metrics.push({ key: "veloInd", label: "Velo indicators in range", value: `${good} of ${velo.length}`, unit: "", range: "", note: "The numbers that go with throwing hard, at or past their usual range (the table below)." });
    return {
      tables: [
        stress.length ? { title: "Arm stress indicators", cols: ["", "His", "Look for", "", "Why"], rows: stress.map(([label, v, target, ok, why]) => [label, typeof v === "number" ? Math.round(v * 10) / 10 : v, target, ok ? "OK" : "Flag", why]) } : null,
        velo.length ? { title: "Velo indicators", cols: ["", "His", "Usual range", ""], rows: velo.map(([label, v, lo, hi, unit]) => [label, `${Math.round(v * 10) / 10} ${unit}`, hi >= 9999 ? `${lo}+ ${unit}` : `${lo}–${hi} ${unit}`, v >= lo && v <= hi ? "In range" : v < lo ? "Below" : "Above"]) } : null,
      ].filter(Boolean),
    };
  }

  // side: tracked open-side video; behind: tracked behind video or null. timeScale turns file seconds into real
  // seconds (a 30 fps file of 240 fps slow-mo runs 8× slow).
  function analyze({ side, behind, throws, heightIn, captureFps, sideScale, behindScale, events: manual, edits, elbowDepth = true, weightKg }) {
    const S = sidesOf(throws), n = side.frames.length;
    const tReal = side.frames.map((f) => (f.t - side.frames[0].t) * sideScale);
    const dt = (tReal[n - 1] - tReal[0]) / Math.max(1, n - 1);
    // smoothing goes by the frames actually analyzed each real second (a long high-speed clip is thinned)
    const perSec = dt > 0 ? 1 / dt : captureFps;
    const sig = Math.max(0.6, perSec / 120);
    const med = Math.max(3, Math.round(perSec * 0.02)); // frames in about 20 ms: enough to drop a glitch, too short to dull the arm
    const pts = clean(side.frames, "p", sig, med), wpts = clean(side.frames, "w", sig, med);
    if (edits && Object.keys(edits).length) applyEdits(pts, edits, Math.max(2, Math.round(perSec * 0.025)));
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
    // (the stride is taken within 1.1 s of the leg lift: after the pitch the front foot can creep on, or he walks off)
    const strideEnd = Math.min(n - 1, LL + fr(1.1));
    const fullStride = Math.max(...travel.slice(LL, strideEnd + 1));
    const footSpeed = deriv(leadFootX, dt).map((v) => Math.abs(v || 0));
    let FS = m.FS != null ? m.FS : -1;
    if (FS < 0) for (let i = LL + 1; i <= strideEnd; i++) if (travel[i] >= 0.97 * fullStride && footY[i] >= groundY - 0.03 * Hpx && footSpeed[i] < 0.8 * Hpx) { FS = i; break; }
    if (FS < 0) FS = argBest(travel, LL, strideEnd, (a, b) => a > b);
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
    // the elbow straightening, from the side view's own elbow angle: from the open side the forearm lays back toward second
    // base and then reaches toward the plate in the picture's plane, so the picture follows it (and moved dots count),
    // where the model's 3D guess of the forearm from one camera gets the whip wrong and peaks too early
    const elbowV = smoothSeries(deriv(smoothSeries(elbowFlex, sig * 1.5), dt).map((v) => (v == null ? null : -v)), sig); // straightening counts as +
    // the upper arm swings through around release; the elbow straightens from max layback to release
    const avI = argBest(armV, MER - fr(0.03), BR + fr(0.03), (a, b) => a > b);
    const evI = argBest(elbowV, MER - fr(0.01), BR + fr(0.015), (a, b) => a > b);
    // An earlier elbow peak (before the real one, which comes between max layback and release) is usually depth: the
    // forearm turning toward or away from the camera makes the elbow look like it straightens. When there is one, the
    // curve can start from the dip between the two (elbowDepth), so only the real extension shows.
    let elbowFirst = null;
    if (evI > 0 && elbowV[evI] > 0) {
      const p1 = argBest(elbowV, FS - fr(0.1), evI - fr(0.02), (a, b) => a > b);
      const dip = p1 >= 0 ? argBest(elbowV, p1, evI, (a, b) => a < b) : -1;
      if (p1 >= 0 && dip > p1 && dip < evI && elbowV[p1] > 0.25 * elbowV[evI] && elbowV[p1] - elbowV[dip] > 0.15 * elbowV[evI]) {
        elbowFirst = { i: p1, dip, ms: Math.round((tReal[p1] - tReal[FS]) * 1000), peak: Math.round(elbowV[p1]) };
        if (elbowDepth) for (let i = 0; i < dip; i++) elbowV[i] = null;
      }
    }
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
      ["elbowV", "Peak elbow extension speed (estimate)", evI < 0 ? null : Math.round(elbowV[evI]), "°/s", "1800–2600", "How fast the elbow straightens on the way to release, from the elbow angle seen from the side."],
      ["order", "Kinematic sequence", found.length < 2 ? null : inOrder ? "In order" : "Out of order", "", "", "Hips, then trunk, then arm, then elbow reaching their fastest, each after the one before."],
      ["llfs", "Leg lift to foot strike", ms(LL, FS), "ms", "", "From the top of the leg lift to the foot landing."],
      ["fsbr", "Foot strike to release", ms(FS, BR), "ms", "130–180", "From the foot landing to the ball coming out."],
      ["comPeak", "Peak center-of-mass speed", comV ? r1(Math.max(...comV.slice(LL, FS + 1).filter((x) => x != null))) : null, "m/s", "2.5–3.5", "How fast his body moves toward the plate at its fastest before foot strike."],
      ["comFS", "Center-of-mass speed at foot strike", comV ? r1(comV[FS]) : null, "m/s", "", "How much of that speed is left when the foot lands."],
    ].filter(Boolean).map(([key, label, value, unit, range, note]) => ({ key, label, value, unit, range, note }));
    const extra = inferred({ pts, dt, sig, dir, mPerPx, weightKg, FS, BR, LL, fr, metrics: M, rotSource });
    return {
      tables: extra.tables,
      n, tReal, dir, Hpx, pts, wpts, events: { LL, FS, MER, BR }, metrics: M, rotSource, seq, inOrder, elbowFirst,
      series: { kneeFlex, trunkFwd, sep, pelvisV, trunkV, comV, elbowFlex, armV, elbowV },
    };
  }

  // ---- drawing ---------------------------------------------------------------------------------------------------
  const BONES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28], [27, 29], [29, 31], [27, 31], [28, 30], [30, 32], [28, 32]];
  // `hidden`: joints not to draw (an arm behind the body, where the model only guesses), and the lines to them
  function drawSkeleton(ctx, q, sx, sy, throws, hidden) {
    const S = sidesOf(throws), arm = new Set([S.arm.sh, S.arm.el, S.arm.wr]), lead = new Set(Object.values(S.lead));
    ctx.lineCap = "round";
    BONES.forEach(([a, b]) => {
      if (hidden && (hidden.has(a) || hidden.has(b))) return;
      ctx.strokeStyle = arm.has(a) && arm.has(b) ? "#ff4d5e" : lead.has(a) && lead.has(b) ? "#3fa7ff" : "rgba(255,255,255,0.9)";
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(q[a][0] * sx, q[a][1] * sy); ctx.lineTo(q[b][0] * sx, q[b][1] * sy); ctx.stroke();
    });
    ctx.fillStyle = "#fff";
    [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28].forEach((i) => { if (hidden && hidden.has(i)) return; ctx.beginPath(); ctx.arc(q[i][0] * sx, q[i][1] * sy, 3.5, 0, 2 * Math.PI); ctx.fill(); });
  }
  // ---- the skeleton in 3D ------------------------------------------------------------------------------------------
  // The pose model's 3D body points (meters, around the hips), carried down the mound by how far the hips travel in the
  // side view, and turned so the plate is always ahead (+x), up is +y and z is across (+z the first-base side for a
  // righty filmed from the open side). Mirrored, a lefty throws like a righty (left and right points swapped too), so
  // two bodies line up joint for joint. sameHeight scales everyone to 6'1" so bodies of different sizes overlay.
  const SWAP = [[1, 4], [2, 5], [3, 6], [7, 8], [9, 10], ...Array.from({ length: 11 }, (_, k) => [11 + 2 * k, 12 + 2 * k])];
  function bodyOf(R, throws, heightIn, { mirror = false, sameHeight = true } = {}) {
    const S = sidesOf(throws), dir = R.dir, ev = R.events, t = R.tReal;
    // the movement's four moments in order (leg lift, foot strike, max layback, release for a pitch), the first where
    // the ground is found, and the one its clock starts from
    const [k0, k1, k2, k3] = phaseKeysOf(R), i0 = ev[R.groundKey || k0];
    const real = heightIn ? heightIn * 0.0254 : 1.85, target = sameHeight ? 1.85 : real;
    const w0 = R.wpts[i0];
    // the model's own idea of his height: standing at the first moment, or from his legs' length (a sprinter never stands)
    const wH = Math.max(0.5, R.wLegs ? R.wLegs / 0.49 : (w0[S.drive.an][1] - w0[P.nose][1]) / 0.87);
    const kw = target / wH, kt = target / R.Hpx;
    const hip = (q) => mid(q[P.lHip], q[P.rHip]), h0 = hip(R.pts[i0]);
    const swap = Array.from({ length: 33 }, (_, j) => j);
    if (mirror) SWAP.forEach(([a, b]) => { swap[a] = b; swap[b] = a; });
    const frames = R.wpts.map((w, i) => {
      const h = hip(R.pts[i]), tx = dir * (h[0] - h0[0]) * kt, ty = -(h[1] - h0[1]) * kt;
      const q = w.map((p) => [dir * p[0] * kw + tx, -p[1] * kw + ty, dir * p[2] * kw * (mirror ? -1 : 1)]);
      return swap.map((j) => q[j]);
    });
    // the ground: under the lower foot at that first moment (the back foot at the top of a pitcher's leg lift)
    const g = Math.min(...[27, 28, 29, 30, 31, 32].map((j) => frames[i0][j][1]));
    frames.forEach((q) => q.forEach((p) => { p[1] -= g; }));
    // the movement's phase, -1 to 4: its moments at 0, 1, 2 and 3 (a pitch: leg lift, foot strike, max layback,
    // release), the time between stretched
    const knots = [t[ev[k0]] - 0.6, t[ev[k0]], t[ev[k1]], t[ev[k2]], t[ev[k3]], t[ev[k3]] + 0.5];
    const timeOfPhase = (ph) => { const k = Math.max(0, Math.min(4, Math.floor(ph + 1))); return knots[k] + (knots[k + 1] - knots[k]) * (ph + 1 - k); };
    const phaseOfTime = (x) => { let k = 0; while (k < 4 && x > knots[k + 1]) k++; return k - 1 + (x - knots[k]) / (knots[k + 1] - knots[k] || 1e-6); };
    // a fractional frame at time x, or null outside the clip
    const indexAt = (x) => {
      if (x < t[0] - 1e-6 || x > t[t.length - 1] + 1e-6) return null;
      let lo = 0, hi = t.length - 1;
      while (hi - lo > 1) { const m2 = (lo + hi) >> 1; if (t[m2] <= x) lo = m2; else hi = m2; }
      return lo + (t[hi] > t[lo] ? Math.max(0, Math.min(1, (x - t[lo]) / (t[hi] - t[lo]))) : 0);
    };
    const at = (fi) => { const a = Math.floor(fi), b = Math.min(frames.length - 1, a + 1), f = fi - a; return frames[a].map((p, j) => p.map((x, c) => x + (frames[b][j][c] - x) * f)); };
    return { frames, t, ev, i0: ev[k0], i3: ev[k3], zeroI: zeroOf(R), throws: mirror ? (throws === "L" ? "R" : "L") : throws, height: target, timeOfPhase, phaseOfTime, indexAt, at };
  }
  const sub3 = (a, b) => [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm3 = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const angle3 = (u, v) => { const d = Math.hypot(...u) * Math.hypot(...v); return d ? deg(Math.acos(Math.max(-1, Math.min(1, dot3(u, v) / d)))) : null; };
  // the body's position in numbers, from the 3D points at one moment
  const POSE_NUMS = [["knee", "Lead knee flexion", "°"], ["elbow", "Elbow flexion", "°"], ["abd", "Shoulder abduction", "°"], ["tilt", "Trunk forward tilt", "°"], ["lean", "Trunk lean to glove side", "°"], ["sep", "Hip-shoulder separation", "°"], ["stride", "Stride", "% of height"]];
  function poseNumbers(q, throws, height) {
    const S = sidesOf(throws), hm = mid(q[P.lHip], q[P.rHip]), sm = mid(q[P.lSh], q[P.rSh]), tr = sub3(hm, sm);
    const flat = (a, b) => deg(Math.atan2(b[2] - a[2], b[0] - a[0]));
    const glove = throws === "L" ? -1 : 1;
    return {
      knee: 180 - angle3(sub3(q[S.lead.kn], q[S.lead.hip]), sub3(q[S.lead.kn], q[S.lead.an])),
      elbow: 180 - angle3(sub3(q[S.arm.el], q[S.arm.sh]), sub3(q[S.arm.el], q[S.arm.wr])),
      abd: angle3(sub3(sm, hm), sub3(q[S.arm.sh], q[S.arm.el])),
      tilt: deg(Math.atan2(tr[0], tr[1])),
      lean: deg(Math.atan2(glove * tr[2], tr[1])),
      sep: Math.abs(wrapDeg(flat(q[P.lHip], q[P.rHip]) - flat(q[P.lSh], q[P.rSh]))),
      stride: (Math.hypot(q[S.lead.an][0] - q[S.drive.an][0], q[S.lead.an][2] - q[S.drive.an][2]) / height) * 100,
    };
  }
  // a camera turned `yaw` around the vertical (0 = from the open side for a righty, 90 = from behind), tilted `pitch`
  // down and rolled `roll`, all degrees; orthographic, so sizes don't change with depth
  function camera3D(view, W, H, center) {
    const ry = (view.yaw * Math.PI) / 180, rp = (Math.max(-89, Math.min(89, view.pitch)) * Math.PI) / 180, rr = (view.roll * Math.PI) / 180;
    const d = [Math.sin(ry) * Math.cos(rp), -Math.sin(rp), Math.cos(ry) * Math.cos(rp)];
    const r0 = norm3(cross3([0, 1, 0], d)), u0 = cross3(d, r0);
    const r = r0.map((x, i) => x * Math.cos(rr) + u0[i] * Math.sin(rr)), u = u0.map((x, i) => x * Math.cos(rr) - r0[i] * Math.sin(rr));
    const s = (Math.min(W / 3.8, H / 2.7)) * (view.zoom || 1);
    return (p) => { const q = [p[0] - center[0], p[1] - center[1], p[2] - center[2]]; return [W / 2 + dot3(q, r) * s, H / 2 - dot3(q, u) * s]; };
  }
  // one body: in its own colors (throwing arm red, lead leg blue), or all in one color for a delivery compared with it
  function drawBody3D(ctx, q, proj, throws, style) {
    const S = sidesOf(throws), arm = new Set([S.arm.sh, S.arm.el, S.arm.wr]), lead = new Set(Object.values(S.lead));
    const xy = q.map(proj);
    ctx.save();
    ctx.globalAlpha = style.alpha || 1; ctx.lineWidth = style.width || 3; ctx.lineCap = "round"; ctx.setLineDash(style.dash || []);
    const neck = proj(mid(q[P.lSh], q[P.rSh]));
    [...BONES, [0, -1]].forEach(([a, b]) => {
      ctx.strokeStyle = style.color || (arm.has(a) && arm.has(b) ? "#ff4d5e" : lead.has(a) && lead.has(b) ? "#3fa7ff" : "rgba(255,255,255,0.92)");
      const pb = b < 0 ? neck : xy[b];
      ctx.beginPath(); ctx.moveTo(xy[a][0], xy[a][1]); ctx.lineTo(pb[0], pb[1]); ctx.stroke();
    });
    ctx.setLineDash([]);
    ctx.fillStyle = style.color || "#fff";
    ctx.beginPath(); ctx.arc(xy[0][0], xy[0][1], (style.width || 3) * 2, 0, 2 * Math.PI); ctx.fill();
    ctx.restore();
  }
  // ---- the report as a PDF -----------------------------------------------------------------------------------------
  // jsPDF, already on the dashboard; loaded here when the phone app first needs it
  let jspdfP = null;
  const jsPdf = () => {
    if (window.jspdf) return Promise.resolve(window.jspdf.jsPDF);
    if (!jspdfP) jspdfP = new Promise((ok, bad) => { const s = document.createElement("script"); s.src = "https://unpkg.com/jspdf@2.5.2/dist/jspdf.umd.min.js"; s.onload = () => ok(window.jspdf.jsPDF); s.onerror = () => { jspdfP = null; bad(new Error("Couldn't load the PDF maker. Check the connection and try again.")); }; document.head.append(s); });
    return jspdfP;
  };
  // a chart (SVG) as a picture on white, its theme colors swapped for print ones
  const svgToCanvas = (svg, scale = 2) => new Promise((ok, bad) => {
    const vb = svg.viewBox.baseVal, W = vb.width, H = vb.height;
    const copy = svg.cloneNode(true);
    copy.querySelectorAll(".mc-cursor").forEach((n) => n.remove()); // not the line that follows playback
    const txt = new XMLSerializer().serializeToString(copy).replace(/var\(--mc-grid\)/g, "#d4d4d4").replace(/var\(--mc-dim\)/g, "#666666").replace(/var\(--mc-text\)/g, "#111111").replace("<svg", `<svg width="${W}" height="${H}"`);
    const img = new Image();
    img.onload = () => { const c = document.createElement("canvas"); c.width = W * scale; c.height = H * scale; const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height); ok(c); };
    img.onerror = () => bad(new Error("Couldn't draw a chart for the report."));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(txt)}`;
  });
  // the PDF's own fonts have no arrows or the like
  const pdfSafe = (s) => String(s == null ? "" : s).replace(/→/g, "to").replace(/[≈~]/g, "about ").replace(/[^\x20-\x7E\xA0-\xFF–—‘’“”•…]/g, "");
  // what a saved session keeps of an analysis: the numbers with their labels, the moments (ms from foot strike), a
  // thinned copy of the curves, the sequence, and which analysis made them
  function summaryOf(R) {
    const S = R.series, z = R.tReal[zeroOf(R)];
    const thin = (arr) => (arr ? arr.filter((_, i) => i % Math.max(1, Math.ceil(R.n / 120)) === 0).map((v) => (v == null ? null : Math.round(v * 10) / 10)) : null);
    return {
      rotSource: R.rotSource || null,
      metrics: Object.fromEntries(R.metrics.map((m) => [m.key, m.value])),
      labels: Object.fromEntries(R.metrics.map((m) => [m.key, [m.label, m.unit, m.range]])),
      events: Object.fromEntries(Object.entries(R.events).map(([kk, i]) => [kk, Math.round((R.tReal[i] - z) * 1000)])),
      series: { t: thin(R.tReal.map((t) => (t - z) * 1000)), ...Object.fromEntries(Object.entries(S).map(([k, v]) => [k, thin(v)])) },
      sequence: R.seq ? R.seq.map(({ name, peak, fromFS, beforeBR }) => ({ name, peak, fromFS, beforeBR })) : null, inOrder: R.seq ? R.inOrder : null,
      analysisV: ANALYSIS_V,
    };
  }
  const setupName = (s) => (s === "two" ? "Two cameras" : s === "edger" ? "Edgertronic" : "One camera");
  const EV_LABEL = { LL: "Leg lift", FS: "Foot strike", MER: "Max layback", BR: "Release" };
  // An analysis says what its moments are (a pitch's by default): their names, the four that pace the movement (the 3D
  // skeleton's phases, the report's frames), and the one its times count from
  const evLabelsOf = (R) => R.evLabels || EV_LABEL;
  const phaseKeysOf = (R) => R.phaseKeys || ["LL", "FS", "MER", "BR"];
  const zeroKeyOf = (R) => R.zeroKey || "FS";
  const zeroOf = (R) => R.events[zeroKeyOf(R)];
  const zeroNameOf = (R) => (evLabelsOf(R)[zeroKeyOf(R)] || "foot strike").toLowerCase();
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
  // (onSeek, given, makes a click on the chart jump the video there; the block's setCursor(i) moves a line to frame i)
  function sequenceBlock(R, onSeek) {
    const S = R.series, ev = R.events, tR = R.tReal;
    const lines = [[S.pelvisV, true], [S.trunkV, true], [S.armV, false], [S.elbowV, false]].map(([ys, abs], k) => ({ ...R.seq[k], ys: ys.map((v) => (v == null ? null : abs ? Math.abs(v) : Math.max(0, v))) }));
    // from a little before foot strike to a little after release (or the movement's own pair: a swing's foot plant and contact)
    const [wk0, wk1] = R.seqWindow || ["FS", "BR"];
    const fsT = tR[ev[wk0]], brT = tR[ev[wk1]];
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
    const marks = R.seqMarks || [["FS", "Foot strike"], ["MER", "Max layback"], ["BR", "Release"]];
    marks.forEach(([k, label], m) => {
      const i = ev[k]; if (i == null || i < 0 || tR[i] < from || tR[i] > to) return;
      const top = m > 0 && m < marks.length - 1; // a middle moment labeled at the top: it can sit close to the last
      const x = X(tR[i]); add("line", { x1: x, x2: x, y1: 8, y2: H - padB, stroke: "var(--mc-dim)", "stroke-dasharray": "4 3" }); add("text", { x, y: top ? 9 : H - 8, "text-anchor": "middle", "font-size": 10, fill: "var(--mc-dim)" }, label);
    });
    lines.forEach((l) => add("polyline", { points: idx.map((i) => (l.ys[i] == null ? null : `${X(tR[i]).toFixed(1)},${Y(l.ys[i]).toFixed(1)}`)).filter(Boolean).join(" "), fill: "none", stroke: l.color, "stroke-width": 2.5 }));
    lines.forEach((l) => { if (l.i < 0 || l.ys[l.i] == null || tR[l.i] < from || tR[l.i] > to) return; add("circle", { cx: X(tR[l.i]), cy: Y(l.ys[l.i]), r: 4.5, fill: l.color, stroke: "#fff", "stroke-width": 1.5 }); });
    // where the video is: a line that follows playback and the frame slider
    const cursor = add("line", { x1: -10, x2: -10, y1: 6, y2: H - padB, stroke: "var(--mc-text)", "stroke-width": 1.5, opacity: 0.85, class: "mc-cursor" });
    const setCursor = (i) => { const t = tR[i]; if (t == null || t < from || t > to) { cursor.setAttribute("x1", -10); cursor.setAttribute("x2", -10); return; } const x = X(t); cursor.setAttribute("x1", x); cursor.setAttribute("x2", x); };
    if (onSeek) {
      s.style.cursor = "pointer";
      s.addEventListener("click", (e) => {
        const b = s.getBoundingClientRect(), x = ((e.clientX - b.left) / b.width) * W;
        const t = from + ((x - padL) / (W - padL - 10)) * (to - from);
        let best = 0; tR.forEach((tt, i) => { if (Math.abs(tt - t) < Math.abs(tR[best] - t)) best = i; });
        onSeek(best);
      });
    }
    const table = el("table", { class: "mc-table mc-seq-table" },
      el("thead", null, el("tr", null, el("th", null, "Segment"), el("th", null, "Peak speed"), el("th", null, `After ${(marks[0][1] || "").toLowerCase()}`), el("th", null, `Before ${(marks[marks.length - 1][1] || "").toLowerCase()}`))),
      el("tbody", null, lines.map((l) => el("tr", null,
        el("td", null, el("span", { class: "mc-swatch", style: `background:${l.color}` }), l.name),
        el("td", null, l.peak == null ? "–" : `${l.peak.toLocaleString()} °/s`),
        el("td", null, l.fromFS == null ? "–" : `${l.fromFS} ms`),
        el("td", null, l.beforeBR == null ? "–" : `${l.beforeBR} ms`)))));
    const est = R.rotSource === "estimate";
    const block = el("div", { class: "mc-seq" },
      el("div", { class: "mc-chart-title" }, "Kinematic sequence ", el("small", null, `°/s, from a little before ${(marks[0][1] || "").toLowerCase()} to just after ${(marks[marks.length - 1][1] || "").toLowerCase()}`),
        el("span", { class: `mc-seq-flag ${R.inOrder ? "good" : "bad"}` }, R.inOrder ? `In order: ${lines.map((l) => l.name.toLowerCase()).join(" → ")}` : "Out of order")),
      el("div", { class: "mc-legend" }, lines.map((l) => el("span", null, el("span", { class: "mc-swatch", style: `background:${l.color}` }), l.name))),
      s, table,
      el("p", { class: "mc-hint" }, R.seqNote || `Each segment should reach its fastest after the one before it and faster than it (hips, trunk, arm, elbow). ${est ? "Pelvis and trunk here are the pose model's 3D estimate from one camera; the two-camera setup measures them. " : ""}The upper arm comes from the 3D estimate (its swing stands in for the shoulder, since video can't see its internal rotation); the elbow from its angle seen from the side.`));
    block.setCursor = setCursor;
    return block;
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
    ["Edgertronic", "An Edgertronic (or any high-speed camera) at 500 to 1000 fps makes the arm's numbers the most trustworthy: it hardly moves between frames. Frame him wide enough for his whole body from the set through the follow-through (not tight on the hand, as for spin), from the open side, square to the line to the plate, then choose Edgertronic and enter the frame rate it was set to."],
    ["Filming from here", "Film it now opens the phone's camera and brings the clip straight back, but a web page can't start Slo-Mo, so it films at normal speed: fine for stride, leg and trunk angles, rough for arm and rotation timing. For those, film in the Camera app's Slo-Mo and Choose a video."],
  ];

  // ---- the movements ----------------------------------------------------------------------------------------------
  // Each movement it measures: its name, the hand it asks for (if any), its camera setups, a choice of variant if it has
  // one (a sprint's phase, the kind of jump), its filming tips, how its videos are described, its analysis, and the
  // numbers the saved sessions list shows. Pitching is here; hitting, sprinting and jumping come from mocap_kinds.js.
  // A session saves its movement as `motion` (none means pitching, as every session was before).
  const KINDS = {
    pitching: {
      label: "Pitching", hand: { label: "Throws", key: "throws" },
      setups: [["one", "One camera (open side)"], ["edger", "Edgertronic (open side)"], ["two", "Two cameras (open side + behind)"]],
      howTo: HOW_TO,
      sideLabel: "Open side video", sideHint: "Square to the line to the plate, on the side his chest faces in his set",
      edgerHint: "From the open side, square to the line to the plate, with his whole body in frame (not zoomed in on the hand)",
      behindHint: "Directly behind him, on the line through home plate",
      trimHint: "Trim to the delivery: from just before he comes set to just after the follow-through.",
      analyze: (a) => analyze(a),
      historyKeys: ["stride", "kneeFS", "kneeExt", "trunkBR", "sepMax", "fsbr", "comPeak", "stressFlags", "veloInd"],
    },
  };
  const kindOf = (rec) => KINDS[(rec && rec.motion) || "pitching"] || KINDS.pitching;

  // ---- the tool ------------------------------------------------------------------------------------------------------
  function mount(root, opts) {
    const athlete = opts.athlete || {};
    const kindName = KINDS[opts.kind] ? opts.kind : "pitching", kind = KINDS[kindName];
    const hKey = `mocapHeight:${athlete.id}`;
    const state = { setup: "one", throws: kind.hand ? athlete[kind.hand.key] || athlete.throws || "R" : "R", variant: kind.variants ? kind.variants.options[0][0] : null, extras: Object.fromEntries((kind.extras || []).map((x) => [x.key, x.default])), heightIn: Number(localStorage.getItem(hKey)) || opts.heightIn || "", weightLb: athlete.weightLb ? Math.round(athlete.weightLb) : "", captureFps: "auto", edgerFps: 1000, playSpeed: 1, side: null, behind: null, result: null, busy: "" };
    // his saved sessions of this movement
    const history = () => (opts.history ? opts.history() || [] : []).filter((r) => (r.motion || "pitching") === kindName);
    const variantName = (v) => (kind.variants && v ? (kind.variants.options.find((o) => o[0] === v) || [v, v])[1] : "");
    root.classList.add("mc");
    const fileState = (key) => ({ file: null, video: null, fps: 30, start: 0, end: 0, tracked: null });

    const render = () => {
      if (state.stopPlay) { const sp = state.stopPlay; state.stopPlay = null; try { sp(); } catch (e) { /* the old view is gone anyway */ } }
      root.replaceChildren(...[
        el("div", { class: "mc-head" }, el("h2", null, `Motion Capture${kindName === "pitching" ? "" : `: ${kind.label}`} `, el("small", null, athlete.name || "")),
          el("button", { type: "button", class: "mc-btn ghost", onclick: () => { state.showHow = !state.showHow; render(); } }, state.showHow ? "Hide filming tips" : "How to film it")),
        state.showHow ? el("ol", { class: "mc-how" }, kind.howTo.map(([t, d]) => el("li", null, el("b", null, t), " ", d))) : null,
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
            state.setup === "edger" ? null : el("button", { type: "button", class: "mc-btn", disabled: !!state.busy, onclick: () => film.click() }, f ? "Film it again" : "Film it now"),
            el("button", { type: "button", class: "mc-btn ghost", disabled: !!state.busy, onclick: () => choose.click() }, f ? "Choose another video" : "Choose a video"),
            f ? el("span", { class: "mc-hint" }, f.file.name) : null),
          el("p", { class: "mc-hint" }, "Film it now opens the camera and brings the clip right back, but at normal speed (a web page can't start Slo-Mo), so the arm and rotation timing is rougher. For the best numbers, film it in the Camera app's Slo-Mo at 240 fps, then Choose a video."),
          film, choose,
          f ? trimmer(f) : null);
      };
      return el("div", { class: "mc-setup" },
        el("div", { class: "mc-row" },
          el("span", { class: "mc-seg", role: "group", "aria-label": "Camera setup" },
            kind.setups.map(([key, label]) => el("button", { type: "button", class: `mc-seg-btn${state.setup === key ? " on" : ""}`, onclick: () => { if (key === "edger") { state.setup = "edger"; state.captureFps = String(state.edgerFps); render(); } else toPhone(key); } }, label)))),
        // the movement's own settings (a swing's bat tape and bat length)
        kind.extras ? el("div", { class: "mc-row" }, kind.extras.map((x) => el("label", null, x.label, x.options
          ? el("select", { onchange: (e) => { state.extras = { ...state.extras, [x.key]: e.target.value }; } }, x.options.map(([v, t]) => el("option", { value: v, selected: (state.extras || {})[x.key] === v }, t)))
          : el("input", { type: "number", inputmode: "decimal", step: x.step || 1, value: (state.extras || {})[x.key] ?? "", oninput: (e) => { state.extras = { ...state.extras, [x.key]: Number(e.target.value) || null }; } })))) : null,
        kind.extrasHint ? el("p", { class: "mc-hint" }, kind.extrasHint) : null,
        kind.variants ? el("div", { class: "mc-row" }, el("span", { class: "mc-seg", role: "group", "aria-label": kind.variants.label },
          kind.variants.options.map(([v, label]) => el("button", { type: "button", class: `mc-seg-btn${state.variant === v ? " on" : ""}`, onclick: () => { state.variant = v; render(); } }, label)))) : null,
        el("div", { class: "mc-row" },
          kind.hand ? el("label", null, kind.hand.label, el("select", { onchange: (e) => { state.throws = e.target.value; } }, el("option", { value: "R", selected: state.throws === "R" }, "Right"), el("option", { value: "L", selected: state.throws === "L" }, "Left"))) : null,
          el("label", null, "Height (in)", el("input", { type: "number", inputmode: "decimal", min: 48, max: 90, step: 0.5, value: state.heightIn, placeholder: "e.g. 74", oninput: (e) => { state.heightIn = Number(e.target.value) || ""; try { localStorage.setItem(hKey, String(state.heightIn)); } catch (x) { /* not remembered */ } } })),
          el("label", null, "Weight (lb)", el("input", { type: "number", inputmode: "decimal", min: 60, max: 400, step: 1, value: state.weightLb, placeholder: "e.g. 195", oninput: (e) => { state.weightLb = Number(e.target.value) || ""; } })),
          state.setup === "edger"
            ? el("label", null, "Edgertronic frame rate (fps)", el("input", { type: "number", inputmode: "numeric", min: 120, max: 20000, step: 10, value: state.edgerFps, oninput: (e) => { state.edgerFps = Number(e.target.value) || 1000; state.captureFps = String(state.edgerFps); } }))
            : el("label", null, "Recorded at", el("select", { onchange: (e) => { state.captureFps = e.target.value; } },
              [["auto", "The file's own speed"], ["240", "240 fps slow motion"], ["120", "120 fps slow motion"], ["60", "60 fps"]].map(([v, t]) => el("option", { value: v, selected: String(state.captureFps) === v }, t))))),
        el("p", { class: "mc-hint" }, kind.heightHint || "Height is needed for center-of-mass speed. \"Recorded at\" sets the timing: choose the slow-motion speed it was filmed at if the file plays it slowed down."),
        state.setup === "edger"
          ? pick("side", "Edgertronic video", kind.edgerHint)
          : pick("side", kind.sideLabel, kind.sideHint),
        state.setup === "two" ? pick("behind", "Behind video", kind.behindHint) : null,
        state.error ? el("p", { class: "mc-err" }, state.error) : null,
        el("div", { class: "mc-row" },
          el("button", { type: "button", class: "mc-btn", disabled: !state.side || (state.setup === "two" && !state.behind) || !!state.busy, onclick: run }, kind.analyzeLabel || "Analyze the delivery"),
          state.busy ? el("span", { class: "mc-status", role: "status" }, state.busy) : null),
      );
    }

    // the part of the clip to analyze: scrub, then set its start and end
    function trimmer(f) {
      const v = f.video;
      v.className = "mc-preview"; v.controls = true; v.style.cssText = ""; // out of hiding, into the page where it's shown
      const label = el("span", { class: "mc-hint" });
      const show = () => { label.textContent = `Analyzing ${f.start.toFixed(2)}s to ${f.end.toFixed(2)}s of ${(v.duration || 0).toFixed(2)}s · the file plays at`; };
      // the file's own frame rate, as measured, and changeable if the measure is off
      const fileRate = el("select", { class: "mc-filefps", "aria-label": "The file's frame rate", onchange: (e) => { f.fps = Number(e.target.value); } },
        [...new Set([24, 25, 30, 50, 60, 120, 240, f.fps])].sort((a, b) => a - b).map((r) => el("option", { value: r, selected: r === f.fps }, `${r} fps`)));
      show();
      return el("div", { class: "mc-trim" }, v,
        el("div", { class: "mc-row" },
          el("button", { type: "button", class: "mc-btn ghost", onclick: () => { f.start = Math.min(v.currentTime, f.end - 0.05); show(); } }, "Start here"),
          el("button", { type: "button", class: "mc-btn ghost", onclick: () => { f.end = Math.max(v.currentTime, f.start + 0.05); show(); } }, "End here"),
          el("button", { type: "button", class: "mc-btn ghost", onclick: () => { f.start = 0; f.end = v.duration || 0; show(); } }, "Whole clip")),
        el("div", { class: "mc-row" }, label, fileRate),
        el("p", { class: "mc-hint" }, kind.trimHint));
    }

    // back to a phone setup: the Edgertronic's frame rate doesn't carry over
    const toPhone = (setup) => { state.setup = setup; if (Number(state.captureFps) >= 500) state.captureFps = "auto"; render(); };
    const scaleOf = (f) => { const cap = state.captureFps === "auto" ? f.fps : Number(state.captureFps); return f.fps / cap; };
    async function run() {
      state.error = "";
      try {
        state.busy = "Loading the pose model (the first time takes a moment)…"; render();
        await model();
        const one = async (f, name) => {
          const res = await track(f.video, f.start, f.end, f.fps, (p) => { state.busy = `Finding his body in the ${name} video… ${Math.round(p * 100)}%`; const s = root.querySelector(".mc-status"); if (s) s.textContent = state.busy; }, null, (state.extras || {}).tape || null);
          if (res.frames.filter((x) => x.p).length < res.frames.length * 0.5) throw new Error(`The ${name} video: couldn't find him in most frames. Check that his whole body is in the picture and the light is good.`);
          return res;
        };
        state.edits = {}; // a fresh analysis: no dots moved yet
        state.side.tracked = await one(state.side, "open side");
        if (state.setup === "two") state.behind.tracked = await one(state.behind, "behind");
        compute();
        state.busy = "";
        state.frame = zeroOf(state.result);
      } catch (err) { state.busy = ""; state.error = err.message || String(err); }
      render();
    }
    function compute(manual) {
      const cap = state.captureFps === "auto" ? state.side.fps : Number(state.captureFps);
      state.result = kind.analyze({ variant: state.variant, extras: state.extras || {},
        side: state.side.tracked, edits: state.edits, weightKg: state.weightLb ? state.weightLb * 0.4536 : null, elbowDepth: state.elbowDepth !== false, behind: state.setup === "two" ? state.behind.tracked : null, throws: state.throws, heightIn: Number(state.heightIn) || null,
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
      ...(tr.frames.some((f) => f.b) ? { b: tr.frames.map((f) => (f.b ? [Math.round(f.b[0]), Math.round(f.b[1]), f.b[2]] : null)) } : {}), // the bat's tape, when it was looked for
    });
    const unpack = (o) => ({ W: o.W, H: o.H, frames: o.t.map((t, i) => ({ t, p: o.p[i] ? o.p[i].map((q) => [q[0], q[1], q[2] / 100]) : null, w: o.w[i] ? o.w[i].map((q) => q.map((x) => x / 1000)) : null, b: o.b ? o.b[i] : null })) });
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
      if (store) { store.manual = state.manual || null; store.edits = state.edits && Object.keys(state.edits).length ? state.edits : null; store.elbowDepth = state.elbowDepth !== false; }
      const rec = {
        id, kind: "mocap", motion: kindName, variant: state.variant, extras: state.extras || {}, athleteId: athlete.id, date: was ? was.date : new Date().toISOString().slice(0, 10),
        setup: state.setup, throws: state.throws, heightIn: Number(state.heightIn) || null, weightLb: Number(state.weightLb) || null, captureFps: state.cap,
        ...summaryOf(R), trackV: was ? was.trackV || 1 : TRACK_V,
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
        state.setup = rec.setup || "one"; state.variant = rec.variant || state.variant; state.extras = rec.extras || state.extras; state.throws = rec.throws || state.throws; state.heightIn = rec.heightIn || ""; state.weightLb = rec.weightLb || state.weightLb; state.captureFps = String(rec.captureFps || "auto");
        state.side = { file: { name: (rec.files || [])[0] || "saved video" }, video: await vid(rec.store.sideVideo), fps: rec.store.sideFps || 30, tracked: unpack(data.side), start: 0, end: 0 };
        state.behind = data.behind ? { file: { name: (rec.files || [])[1] || "saved video" }, video: await vid(rec.store.behindVideo), fps: rec.store.behindFps || 30, tracked: unpack(data.behind), start: 0, end: 0 } : null;
        state.manual = rec.store.manual || null;
        state.edits = rec.store.edits || {};
        state.elbowDepth = rec.store.elbowDepth !== false;
        state.saved = rec;
        compute();
        state.frame = zeroOf(state.result);
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
    // ---- the skeleton alone in 3D, and other deliveries over it -----------------------------------------------------
    // Turn it any way (drag it, or the three dials). Lay his other sessions or other pitchers' over it: each one, their
    // mean or median, lined up at the same moment of the delivery (by phase: leg lift, foot strike, max layback and
    // release matched; or by the clock from foot strike or release), and pinned to his at a joint if wanted (the back
    // heel, say). The numbers at the frame showing compare his with the group's.
    const SK_COLORS = ["#3fa7ff", "#2ec4b6", "#c77dff", "#ff9f1c", "#8ac926", "#ff70a6", "#70d6ff", "#e0b03a", "#b5e48c", "#f4a261"];
    const SK_LOCKS = [["", "Nothing (hips together at leg lift)"], ["driveHeel", "Back heel"], ["driveToe", "Back toe"], ["leadHeel", "Front heel"], ["hips", "Hip center"], ["armSh", "Throwing shoulder"], ["nose", "Head"]];
    const SK_VIEWS = [["Open side", 0, 6], ["Behind", 90, 6], ["From the plate", -90, 6], ["Glove side", 180, 6], ["Overhead", 90, 89]];
    const loaded = {}; // record id -> { A } its analysis, { busy } or { error }, kept while the page is open
    const lockPoint = (q, throws, lock) => {
      const S = sidesOf(throws);
      if (lock === "hips") return mid(q[P.lHip], q[P.rHip]);
      const j = { driveHeel: S.drive.heel, driveToe: S.drive.toe, leadHeel: S.lead.heel, armSh: S.arm.sh, nose: P.nose }[lock];
      return j == null ? null : q[j];
    };
    // every saved session in the database, with whose it is (read once, when other pitchers are first asked for)
    async function directory() {
      if (state.dir) return state.dir;
      const rows = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await sbc().from("assessments").select("id, athlete_id, data").eq("data->>kind", "mocap").range(from, from + 999);
        if (error) throw error;
        rows.push(...data);
        if (data.length < 1000) break;
      }
      const ids = [...new Set(rows.map((r) => String(r.athlete_id)))], names = {};
      if (ids.length) { const { data } = await sbc().from("athletes").select("id, name:data->>name").in("id", ids); (data || []).forEach((a) => { names[String(a.id)] = a.name; }); }
      state.dir = { recs: rows.map((r) => ({ ...r.data, id: r.data.id || r.id, _athlete: String(r.athlete_id), _name: names[String(r.athlete_id)] || "Unknown" })).filter((r) => r.store && r.store.path && (r.motion || "pitching") === kindName) };
      return state.dir;
    }
    function skeleton3D(R) {
      const sk = state.sk = state.sk || { yaw: state.throws === "L" ? 180 : 0, pitch: 6, roll: 0, zoom: 1, lock: "", line: "phase", show: "each+mean", me: true, mirror: true, sameHeight: true, own: true, others: false, othersAll: true, picked: [], sameHand: false, from: "", to: "", hidden: {}, q: "" };
      const box = el("div", { class: "mc-3d" });
      const evL = evLabelsOf(R), keys4 = phaseKeysOf(R), zName = zeroNameOf(R), endName = (evL[keys4[3]] || "release").toLowerCase();
      let frame = state.frame || 0, canvas = null, numsBox = null;
      const alive = () => box.isConnected;
      const inDates = (r) => (!sk.from || (r.date || "") >= sk.from) && (!sk.to || (r.date || "") <= sk.to);
      const mine = () => history().filter((r) => r.store && r.store.path && !(state.saved && r.id === state.saved.id)).map((r) => ({ ...r, _name: athlete.name || "This pitcher", _mine: true }));
      const theirs = () => (state.dir ? state.dir.recs : []).filter((r) => r._athlete !== String(athlete.id) && (sk.othersAll || sk.picked.includes(r._athlete)) && (!sk.sameHand || (r.throws || "R") === state.throws));
      // a sprint or a jump only beside its own kind (acceleration beside acceleration, a broad jump beside broad jumps)
      const sameVariant = (r) => !kind.variants || (r.variant || kind.variants.options[0][0]) === state.variant;
      const chosen = () => [...(sk.own ? mine() : []), ...(sk.others ? theirs() : [])].filter(inDates).filter(sameVariant).sort((a, b) => (a.date || "").localeCompare(b.date || "")).slice(0, 40);
      const load = (rec) => {
        if (loaded[rec.id]) return;
        loaded[rec.id] = { busy: true };
        (async () => {
          const dl = await sbc().storage.from(STORE).download(rec.store.path);
          if (dl.error) throw dl.error;
          const data = JSON.parse(await dl.data.text());
          const cap = Number(rec.captureFps) || rec.store.sideFps || 30;
          return kindOf(rec).analyze({ variant: rec.variant, extras: rec.extras || {}, side: unpack(data.side), behind: null, throws: rec.throws || "R", heightIn: rec.heightIn || null, weightKg: rec.weightLb ? rec.weightLb * 0.4536 : null, captureFps: cap, sideScale: (rec.store.sideFps || 30) / cap, behindScale: 1, events: rec.store.manual, edits: rec.store.edits, elbowDepth: rec.store.elbowDepth !== false });
        })().then((A) => { loaded[rec.id] = { A }; }, (e) => { loaded[rec.id] = { error: (e && e.message) || String(e) }; }).then(() => { if (alive()) build(); });
      };
      let me = null, others = [];
      const bodies = () => {
        me = bodyOf(R, state.throws, state.heightIn, { sameHeight: sk.sameHeight });
        others = chosen().map((rec, k) => {
          const L = loaded[rec.id];
          const body = L && L.A ? bodyOf(L.A, rec.throws || "R", rec.heightIn, { sameHeight: sk.sameHeight, mirror: sk.mirror && (rec.throws || "R") !== state.throws }) : null;
          return { rec, body, color: SK_COLORS[k % SK_COLORS.length], L };
        });
      };
      // each body at the frame of his showing, lined up and pinned
      const posed = (fi = frame) => {
        const tRef = me.t[fi], myQ = me.frames[fi];
        const tFor = (B) => (sk.line === "phase" ? B.timeOfPhase(me.phaseOfTime(tRef)) : sk.line === "br" ? B.t[B.i3] + (tRef - me.t[me.i3]) : B.t[B.zeroI] + (tRef - me.t[me.zeroI]));
        const myLock = sk.lock ? lockPoint(myQ, me.throws, sk.lock) : null;
        const list = others.filter((o) => o.body && !sk.hidden[o.rec.id]).map((o) => {
          const fi = o.body.indexAt(tFor(o.body));
          if (fi == null) return { ...o, q: null };
          let q = o.body.at(fi);
          if (myLock) { const p = lockPoint(q, o.body.throws, sk.lock), dx = myLock[0] - p[0], dy = myLock[1] - p[1], dz = myLock[2] - p[2]; q = q.map((v) => [v[0] + dx, v[1] + dy, v[2] + dz]); }
          return { ...o, q };
        });
        const seen = list.filter((o) => o.q);
        let group = null;
        if (seen.length && /mean|median/.test(sk.show)) {
          const med = /median/.test(sk.show);
          const stat = (xs) => { if (!med) return xs.reduce((s, x) => s + x, 0) / xs.length; const s = xs.slice().sort((a, b) => a - b), m2 = s.length >> 1; return s.length % 2 ? s[m2] : (s[m2 - 1] + s[m2]) / 2; };
          group = { q: myQ.map((_, j) => [0, 1, 2].map((c) => stat(seen.map((o) => o.q[j][c])))), med, n: seen.length,
            nums: Object.fromEntries(POSE_NUMS.map(([key]) => { const xs = seen.map((o) => poseNumbers(o.q, o.body.throws, o.body.height)[key]).filter(Number.isFinite); return [key, xs.length ? stat(xs) : null]; })) };
        }
        return { myQ, list, group };
      };
      // the scene at frame fi onto canvas c (the one showing, or one for the report)
      const draw3D = (c, fi) => {
        const ctx = c.getContext("2d"), W = c.width, H = c.height;
        ctx.fillStyle = "#111"; ctx.fillRect(0, 0, W, H);
        const span = me.frames.slice(me.i0, me.i3 + 1).map((q) => mid(q[P.lHip], q[P.rHip]));
        const center = [span.reduce((s, p) => s + p[0], 0) / span.length, 0.95, span.reduce((s, p) => s + p[2], 0) / span.length];
        const proj = camera3D(sk, W, H, center);
        // the ground, in half meters, and which way the plate is
        ctx.strokeStyle = "rgba(255,255,255,0.12)"; ctx.lineWidth = 1;
        for (let x = -1.5; x <= 3.01; x += 0.5) { const a = proj([center[0] + x, 0, center[2] - 1.5]), b = proj([center[0] + x, 0, center[2] + 1.5]); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
        for (let z = -1.5; z <= 1.51; z += 0.5) { const a = proj([center[0] - 1.5, 0, center[2] + z]), b = proj([center[0] + 3, 0, center[2] + z]); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
        const pl = proj([center[0] + 3.2, 0, center[2]]);
        ctx.fillStyle = "rgba(255,255,255,0.55)"; ctx.font = "12px sans-serif"; ctx.textAlign = "center"; ctx.fillText("to the plate →", pl[0], pl[1] + 14);
        const P3 = posed(fi);
        if (/each/.test(sk.show)) P3.list.forEach((o) => { if (o.q) drawBody3D(ctx, o.q, proj, o.body.throws, { color: o.color, width: 2, alpha: 0.75 }); });
        if (P3.group) drawBody3D(ctx, P3.group.q, proj, me.throws, { color: P3.group.med ? "#7fd8ff" : "#ffd23f", width: 4, alpha: 0.95, dash: P3.group.med ? [8, 5] : null });
        if (sk.me) drawBody3D(ctx, P3.myQ, proj, me.throws, { width: 3.5 });
        return P3;
      };
      const paint3D = () => {
        if (!canvas || !me) return;
        const P3 = draw3D(canvas, frame);
        if (numsBox) numsBox.replaceChildren(numbersTable(P3));
      };
      const numbersTable = (P3) => {
        const mine3 = poseNumbers(P3.myQ, me.throws, me.height), g = P3.group;
        const f = (v) => (v == null || !Number.isFinite(v) ? "–" : String(Math.round(v)));
        return el("table", { class: "mc-table" },
          el("thead", null, el("tr", null, el("th", null, `At this frame (${Math.round((me.t[frame] - me.t[me.zeroI]) * 1000)} ms from ${zName})`), el("th", null, "This session"),
            g ? el("th", null, `Group ${g.med ? "median" : "mean"} (${g.n})`) : null, g ? el("th", null, "Difference") : null)),
          el("tbody", null, POSE_NUMS.map(([key, label, unit]) => el("tr", null, el("td", null, label, key === "lean" || key === "sep" ? el("small", null, "from the 3D estimate") : null),
            el("td", null, `${f(mine3[key])} ${unit}`), g ? el("td", null, `${f(g.nums[key])} ${unit}`) : null,
            g ? el("td", null, g.nums[key] == null ? "–" : `${mine3[key] - g.nums[key] >= 0 ? "+" : ""}${f(mine3[key] - g.nums[key])}`) : null))));
      };
      const dial = (label, key, min, max) => el("label", { class: "mc-dial" }, label, el("input", { type: "range", min, max, step: 1, value: sk[key], oninput: (e) => { sk[key] = Number(e.target.value); paint3D(); } }));
      const check = (label, key, after) => el("label", { class: "mc-keep" }, el("input", { type: "checkbox", checked: !!sk[key], onchange: (e) => { sk[key] = e.target.checked; if (after) after(); build(); } }), ` ${label}`);
      const select = (label, key, options) => el("label", null, label, el("select", { onchange: (e) => { sk[key] = e.target.value; build(); } }, options.map(([v, t]) => el("option", { value: v, selected: sk[key] === v }, t))));
      function build() {
        bodies();
        const list = chosen();
        list.forEach(load);
        const maxW = Math.min(900, root.clientWidth || 900);
        canvas = el("canvas", { class: "mc-canvas mc-canvas3d" });
        canvas.width = maxW; canvas.height = Math.round(maxW * 0.62);
        let dragAt = null;
        canvas.addEventListener("pointerdown", (e) => { dragAt = [e.clientX, e.clientY]; try { canvas.setPointerCapture(e.pointerId); } catch (x) { /* fine without */ } });
        canvas.addEventListener("pointermove", (e) => {
          if (!dragAt) return;
          sk.yaw = ((sk.yaw - (e.clientX - dragAt[0]) * 0.4 + 540) % 360) - 180; sk.pitch = Math.max(-89, Math.min(89, sk.pitch + (e.clientY - dragAt[1]) * 0.4));
          dragAt = [e.clientX, e.clientY];
          box.querySelectorAll(".mc-dial input").forEach((inp, k) => { inp.value = [sk.yaw, sk.pitch, sk.roll][k]; });
          paint3D();
        });
        const endDrag = () => { dragAt = null; };
        canvas.addEventListener("pointerup", endDrag); canvas.addEventListener("pointercancel", endDrag);
        canvas.addEventListener("wheel", (e) => { e.preventDefault(); sk.zoom = Math.max(0.4, Math.min(4, sk.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1))); paint3D(); }, { passive: false });
        numsBox = el("div", { class: "mc-scroll" });
        const flip = state.throws === "L" ? 180 : 0;
        // whose: other pitchers, every one or those picked
        let whoBox = null;
        if (sk.others) {
          if (!state.dir) {
            whoBox = el("div", { class: "mc-hint" }, state.dirError || "Finding the other sessions…");
            if (!state.dirError) directory().then(() => { if (alive()) build(); }, (e) => { state.dirError = `Couldn't read the other sessions (${(e && e.message) || e}).`; if (alive()) build(); });
          } else {
            const people = [...new Map(state.dir.recs.filter((r) => r._athlete !== String(athlete.id)).map((r) => [r._athlete, r._name])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
            const search = el("input", { type: "search", placeholder: "Add a pitcher…", value: sk.q, "aria-label": "Add a pitcher to compare" });
            const hits = el("div", { class: "mc-row" });
            const showHits = () => { const q = search.value.trim().toLowerCase(); sk.q = search.value; hits.replaceChildren(...(q ? people.filter(([id, name]) => name.toLowerCase().includes(q) && !sk.picked.includes(id)).slice(0, 8).map(([id, name]) => el("button", { type: "button", class: "mc-btn ghost small", onclick: () => { sk.picked = [...sk.picked, id]; sk.othersAll = false; sk.q = ""; build(); } }, `+ ${name}`)) : [])); };
            search.addEventListener("input", showHits);
            whoBox = el("div", { class: "mc-who" },
              el("span", { class: "mc-seg", role: "group", "aria-label": "Which pitchers" },
                el("button", { type: "button", class: `mc-seg-btn${sk.othersAll ? " on" : ""}`, onclick: () => { sk.othersAll = true; build(); } }, `All pitchers (${people.length})`),
                el("button", { type: "button", class: `mc-seg-btn${sk.othersAll ? "" : " on"}`, onclick: () => { sk.othersAll = false; build(); } }, "Chosen pitchers")),
              sk.othersAll ? null : el("div", { class: "mc-row" }, search,
                sk.picked.map((id) => el("button", { type: "button", class: "mc-btn small", title: "Take off", onclick: () => { sk.picked = sk.picked.filter((x) => x !== id); build(); } }, `${(people.find((p) => p[0] === id) || [id, "?"])[1]} ✕`))),
              hits);
            if (sk.q) setTimeout(showHits, 0);
          }
        }
        const legend = list.length ? el("div", { class: "mc-legend" }, others.map((o) => el("label", { class: "mc-keep" },
          el("input", { type: "checkbox", checked: !sk.hidden[o.rec.id], onchange: (e) => { sk.hidden = { ...sk.hidden, [o.rec.id]: !e.target.checked }; paint3D(); } }),
          el("span", { class: "mc-swatch", style: `background:${o.color}` }),
          ` ${o.rec._mine ? "His" : o.rec._name}, ${o.rec.date || ""} · ${setupName(o.rec.setup)}${(o.rec.throws || "R") !== state.throws ? (sk.mirror ? " · mirrored" : " · other hand") : ""}`,
          o.L && o.L.busy ? el("small", null, " loading…") : o.L && o.L.error ? el("small", { class: "mc-err" }, ` couldn't open (${o.L.error})`) : null)))
          : el("p", { class: "mc-hint" }, sk.own || sk.others ? "No saved sessions with tracking match these choices yet." : "Pick his other sessions or other pitchers to lay over this one.");
        box.replaceChildren(
          el("div", { class: "mc-row" }, SK_VIEWS.map(([name, yaw, pitch]) => el("button", { type: "button", class: "mc-btn ghost small", onclick: () => { sk.yaw = ((yaw + (yaw % 180 === 0 ? flip : 0) + 540) % 360) - 180; sk.pitch = pitch; sk.roll = 0; build(); } }, name)),
            el("button", { type: "button", class: "mc-btn ghost small", "aria-label": "Zoom in", onclick: () => { sk.zoom = Math.min(4, sk.zoom * 1.2); paint3D(); } }, "+"),
            el("button", { type: "button", class: "mc-btn ghost small", "aria-label": "Zoom out", onclick: () => { sk.zoom = Math.max(0.4, sk.zoom / 1.2); paint3D(); } }, "−")),
          el("div", { class: "mc-row" }, dial("Turn", "yaw", -180, 180), dial("Tilt", "pitch", -89, 89), dial("Roll", "roll", -180, 180)),
          canvas,
          el("p", { class: "mc-hint" }, "Drag to turn it, scroll or + / − to zoom. It moves with the frame above (play it, or step through the moments). From the pose model's 3D estimate from one camera: the depth (toward and away from the camera) is the least sure part."),
          el("div", { class: "mc-row" },
            check("This session", "me"),
            select("Show", "show", [["each", "Each skeleton"], ["each+mean", "Each, and their mean"], ["each+median", "Each, and their median"], ["mean", "Mean only"], ["median", "Median only"]]),
            select("Pin them at", "lock", SK_LOCKS),
            select("Line them up by", "line", [["phase", `The moments (${keys4.map((k) => (evL[k] || k).toLowerCase()).join(", ")})`], ["fs", `Time from ${zName}`], ["br", `Time from ${endName}`]])),
          el("div", { class: "mc-row" }, check("Mirror the other hand to his", "mirror"), check("Scale everyone to the same height", "sameHeight")),
          el("div", { class: "mc-compare" }, el("b", null, "Compare with"),
            el("div", { class: "mc-row" }, check(`His other sessions (${mine().length})`, "own"), check("Other pitchers", "others"), sk.others ? check("Same hand only", "sameHand") : null,
              el("label", null, "From", el("input", { type: "date", value: sk.from, onchange: (e) => { sk.from = e.target.value; build(); } })),
              el("label", null, "to", el("input", { type: "date", value: sk.to, onchange: (e) => { sk.to = e.target.value; build(); } }))),
            whoBox, legend,
            list.length >= 40 ? el("p", { class: "mc-hint" }, "Showing the first 40: narrow the dates or pick pitchers for the rest.") : null),
          numsBox);
        paint3D();
      }
      build();
      // for the report: the scene at a frame, the numbers there, and what it was compared with
      const report = (fi, W, H) => {
        const c = document.createElement("canvas"); c.width = W; c.height = H;
        const P3 = draw3D(c, fi), g = P3.group;
        return { canvas: c, mine: poseNumbers(P3.myQ, me.throws, me.height), group: g ? { nums: g.nums, med: g.med, n: g.n } : null };
      };
      const describe = () => {
        const shown = others.filter((o) => o.body && !sk.hidden[o.rec.id]);
        if (!shown.length) return "";
        const own = shown.filter((o) => o.rec._mine).length, theirs = shown.length - own, who = new Set(shown.filter((o) => !o.rec._mine).map((o) => o.rec._athlete)).size;
        const dates = shown.map((o) => o.rec.date).filter(Boolean).sort();
        const parts = [own ? `${own} of his other session${own === 1 ? "" : "s"}` : "", theirs ? `${theirs} session${theirs === 1 ? "" : "s"} from ${who} other pitcher${who === 1 ? "" : "s"}` : ""].filter(Boolean);
        const line = sk.line === "phase" ? "the moments of the movement" : sk.line === "br" ? `time from ${endName}` : `time from ${zName}`;
        const pin = sk.lock ? `, pinned at the ${SK_LOCKS.find((l) => l[0] === sk.lock)[1].toLowerCase()}` : "";
        return `Compared with ${parts.join(" and ")}${dates.length ? ` (${dates[0]} to ${dates[dates.length - 1]})` : ""}, lined up by ${line}${pin}.`;
      };
      return { node: box, setFrame: (i) => { frame = i; paint3D(); }, report, describe };
    }

    // ---- saved sessions worked out again --------------------------------------------------------------------------
    // Re-run: a session's kept points through the analysis as it is now (quick); its moments set by hand, fixed points
    // and settings stay. Re-track: its kept video through the pose model again first, at the same frames (a minute or
    // two each), for when the tracking itself has improved. Either way its saved numbers, curves and sequence are replaced.
    const isOld = (rec) => (rec.analysisV || 1) < ANALYSIS_V;
    const trackOld = (rec) => (rec.trackV || 1) < TRACK_V;
    const canRerun = (rec) => !!(rec.store && rec.store.path);
    const canRetrack = (rec) => canRerun(rec) && !!rec.store.sideVideo && (rec.setup !== "two" || !!rec.store.behindVideo);
    async function rerun(rec, retrack, onProgress) {
      const dl = await sbc().storage.from(STORE).download(rec.store.path);
      if (dl.error) throw dl.error;
      const data = JSON.parse(await dl.data.text());
      let side = unpack(data.side), behind = data.behind ? unpack(data.behind) : null, trackV = rec.trackV || 1;
      if (retrack) {
        await model();
        const again = async (tr, path, name) => {
          const s = await sbc().storage.from(STORE).createSignedUrl(path, 3600);
          if (s.error || !s.data) throw new Error(`couldn't open the ${name} video`);
          const v = await openVideo(s.data.signedUrl);
          try {
            const out = await track(v, 0, 0, 30, (p) => onProgress && onProgress(`${name} video, ${Math.round(p * 100)}%`), tr.frames.map((f) => f.t), (rec.extras || {}).tape || null);
            return { W: out.W, H: out.H, frames: out.frames };
          } finally { v.remove(); }
        };
        side = await again(side, rec.store.sideVideo, "open side");
        if (behind && rec.store.behindVideo) behind = await again(behind, rec.store.behindVideo, "behind");
        const body = JSON.stringify({ v: 1, side: pack(side), behind: behind ? pack(behind) : null });
        const up = await sbc().storage.from(STORE).upload(rec.store.path, new Blob([body], { type: "application/json" }), { contentType: "application/json", upsert: true });
        if (up.error) throw up.error;
        trackV = TRACK_V;
      }
      const cap = Number(rec.captureFps) || rec.store.sideFps || 30;
      const R = kindOf(rec).analyze({ variant: rec.variant, extras: rec.extras || {},
        side, behind: rec.setup === "two" ? behind : null, throws: rec.throws || "R", heightIn: rec.heightIn || null, weightKg: rec.weightLb ? rec.weightLb * 0.4536 : null, captureFps: cap,
        sideScale: (rec.store.sideFps || 30) / cap, behindScale: (rec.store.behindFps || 30) / cap, events: rec.store.manual, edits: rec.store.edits, elbowDepth: rec.store.elbowDepth !== false,
      });
      const { _athlete, _name, _mine, ...kept } = rec; // eslint-disable-line no-unused-vars
      const athleteId = kept.athleteId != null ? kept.athleteId : _athlete ? (/^\d+$/.test(_athlete) ? Number(_athlete) : _athlete) : athlete.id;
      return { ...kept, athleteId, ...summaryOf(R), trackV, rerunAt: new Date().toISOString() };
    }
    // one after another, saying how far along it is; another pitcher's session is saved to him (opts.saveAny)
    async function rerunMany(list, retrack, label) {
      if (state.rerunning || !list.length) return;
      state.rerunning = true;
      const failed = [];
      const say = (s) => { state.rerunMsg = s; root.querySelectorAll(".mc-rerun-msg").forEach((m) => { m.textContent = s; }); };
      root.querySelectorAll(".mc-rerun button").forEach((b) => { b.disabled = true; });
      for (let k = 0; k < list.length; k++) {
        const rec = list[k], who = `${rec._name && rec._athlete !== String(athlete.id) ? `${rec._name}, ` : ""}${rec.date || ""}`;
        say(`${label} ${k + 1} of ${list.length} (${who})…`);
        try {
          const out = await rerun(rec, retrack, (p) => say(`${label} ${k + 1} of ${list.length} (${who}): tracking the ${p}…`));
          if (rec._athlete && rec._athlete !== String(athlete.id)) await opts.saveAny(out);
          else await opts.onSave(out);
          delete loaded[out.id]; // the 3D comparison reads it afresh
          if (state.saved && state.saved.id === out.id) state.saved = out;
        } catch (e) { failed.push(`${who}: ${(e && e.message) || e}`); }
      }
      state.rerunning = false;
      state.dir = null; // every pitcher's sessions read again next time, with their new numbers
      state.rerunMsg = `${label} done: ${list.length - failed.length} of ${list.length} updated.${failed.length ? ` Couldn't do ${failed.join("; ")}.` : ""}`;
      const h = root.querySelector(".mc-history");
      if (h) h.replaceWith(historyBlock());
      // the report that's open is worked out with the latest analysis already; reopened if it was re-tracked
      if (retrack && state.saved && list.some((r) => r.id === state.saved.id)) openSaved(state.saved);
    }
    const askFirst = async (title, text, ok) => (window.askConfirm ? window.askConfirm({ title, text, ok }) : window.confirm(`${title} ${text}`));

    const backToStart = () => { if (state.side && state.side.video) state.side.video.remove(); if (state.behind && state.behind.video) state.behind.video.remove(); state.result = null; state.summary = null; state.saved = null; state.manual = null; state.edits = {}; state.side = null; state.behind = null; render(); };

    function results() {
      const R = state.result, f = state.side, tr = f.tracked;
      const evL = evLabelsOf(R), zKey = zeroKeyOf(R), zName = zeroNameOf(R);
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
      // an arm the model can't see (behind the body, in the follow-through) isn't drawn: where it says it can't see the
      // elbow or wrist, or the upper arm or forearm stretches far from its usual length, those lines are left out
      // (a dot moved by hand always shows)
      const ARMS = [[P.lSh, P.lEl, P.lWr], [P.rSh, P.rEl, P.rWr]];
      const segLen = (q, a, b) => Math.hypot(q[a][0] - q[b][0], q[a][1] - q[b][1]);
      const usual = ARMS.map(([sh, el, wr]) => [[sh, el], [el, wr]].map(([a, b]) => { const ls = R.pts.map((q) => segLen(q, a, b)).sort((x, y) => x - y); return ls[Math.floor(ls.length / 2)] || 1; }));
      const hiddenAt = (i) => {
        const raw = tr.frames[i] && tr.frames[i].p, moved = (state.edits && state.edits[i]) || {}, out = new Set();
        ARMS.forEach(([sh, el, wr], s) => {
          const unseen = (j) => !moved[j] && (!raw || raw[j][2] < 0.5);
          const odd = (a, b, u) => { const l = segLen(R.pts[i], a, b); return l > u * 1.6 || l < u * 0.35; };
          if (unseen(el) || odd(sh, el, usual[s][0])) { if (!moved[el]) out.add(el); if (!moved[wr]) out.add(wr); }
          else if (unseen(wr) || odd(el, wr, usual[s][1])) { if (!moved[wr]) out.add(wr); }
        });
        return out.size ? out : null;
      };
      const pointsAt = (i) => { const q = R.pts[i].map((p) => p.slice()); if (drag) q[drag.j] = [drag.x, drag.y, 1]; return q; };
      const draw = (i) => {
        if (state.hideVideo && !state.fixing) { ctx.fillStyle = "#111"; ctx.fillRect(0, 0, canvas.width, canvas.height); } else ctx.drawImage(still, 0, 0);
        const q = pointsAt(i);
        if (!state.hideSkel || state.fixing) drawSkeleton(ctx, q, k, k, state.throws, state.fixing ? null : hiddenAt(i)); // every dot shows while fixing
        // the bat (from the tape on its end): the barrel's trail over the last 40 frames, and the bat from the hands to it
        if (R.bat && !state.hideSkel) {
          const tip = R.bat.tip, from = Math.max(0, i - 40);
          ctx.lineCap = "round"; ctx.lineWidth = 2.5; ctx.strokeStyle = "rgba(255, 210, 63, 0.8)"; ctx.beginPath();
          let pen = false;
          for (let j = from; j <= i; j++) { const p = tip[j]; if (!p) { pen = false; continue; } if (pen) ctx.lineTo(p[0] * k, p[1] * k); else ctx.moveTo(p[0] * k, p[1] * k); pen = true; }
          ctx.stroke();
          const h = R.bat.hands[i], p = tip[i];
          if (h && p) { ctx.lineWidth = 5; ctx.strokeStyle = "#ffd23f"; ctx.beginPath(); ctx.moveTo(h[0] * k, h[1] * k); ctx.lineTo(p[0] * k, p[1] * k); ctx.stroke(); }
        }
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
      let seqEl = null; // the kinematic sequence, whose line follows the frame showing
      const sk3d = state.show3d ? skeleton3D(R) : null; // the 3D skeleton, which follows it too
      const show = (i) => { // the frame's caption, slider and line on the sequence, once its picture is drawn
        const ev = Object.entries(R.events).find(([, j]) => j === i);
        const edited = state.edits && state.edits[i] ? " · dots moved here" : "";
        caption.textContent = `Frame ${i + 1} of ${R.n} · ${Math.round((R.tReal[i] - R.tReal[R.events[zKey]]) * 1000)} ms from ${zName}${ev ? ` · ${evL[ev[0]]}` : ""}${edited}`;
        slider.value = i;
        if (seqEl) seqEl.setCursor(i);
        if (sk3d) sk3d.setFrame(i);
      };
      const paint = (i) => {
        state.frame = i;
        painting = painting.then(async () => {
          if (f.video) { await seek(f.video, tr.frames[i].t); sctx.drawImage(f.video, 0, 0, still.width, still.height); }
          else { sctx.fillStyle = "#111"; sctx.fillRect(0, 0, still.width, still.height); } // no video kept: the skeleton alone
          draw(i);
          show(i);
        });
      };
      // playing it: the video itself plays (at the speed picked, 1x being the clip's own slowed-down speed) and each
      // frame drawn takes the tracked points nearest its moment; without a kept video the skeleton plays on its own
      const nearest = (t) => { let lo = 0, hi = tr.frames.length - 1; while (lo < hi) { const md = (lo + hi) >> 1; if (tr.frames[md].t < t) lo = md + 1; else hi = md; } return lo > 0 && Math.abs(tr.frames[lo - 1].t - t) < Math.abs(tr.frames[lo].t - t) ? lo - 1 : lo; };
      let playing = null;
      const playBtn = el("button", { type: "button", class: "mc-btn small", onclick: () => (playing ? stopPlay() : startPlay()) }, "▶ Play");
      function stopPlay() {
        if (!playing) return;
        cancelAnimationFrame(playing.raf);
        if (f.video) f.video.pause();
        playing = null;
        playBtn.textContent = "▶ Play";
        paint(state.frame || 0); // settle on the exact frame
      }
      function startPlay() {
        const last = tr.frames.length - 1, tEnd = tr.frames[last].t;
        let i = state.frame || 0;
        if (i >= last) i = 0;
        playBtn.textContent = "❚❚ Pause";
        const step = (t) => {
          if (t >= tEnd) { state.frame = last; stopPlay(); return; }
          const j = nearest(t);
          if (f.video) sctx.drawImage(f.video, 0, 0, still.width, still.height); else { sctx.fillStyle = "#111"; sctx.fillRect(0, 0, still.width, still.height); }
          state.frame = j; draw(j); show(j);
          playing.raf = requestAnimationFrame(loop);
        };
        let loop;
        if (f.video) {
          f.video.currentTime = tr.frames[i].t; f.video.playbackRate = state.playSpeed; f.video.muted = true;
          f.video.play().catch(() => {});
          loop = () => step(f.video.ended ? tEnd : f.video.currentTime);
        } else {
          const t0 = tr.frames[i].t, c0 = performance.now();
          loop = (now) => step(t0 + ((now - c0) / 1000) * state.playSpeed);
        }
        playing = { raf: requestAnimationFrame(loop) };
      }
      state.stopPlay = stopPlay; // a redraw of the page stops it
      const speedSel = el("select", { "aria-label": "Playback speed", onchange: (e) => { state.playSpeed = Number(e.target.value); if (playing && f.video) f.video.playbackRate = state.playSpeed; } },
        [0.25, 0.5, 0.75, 1, 1.25, 1.5].map((v) => el("option", { value: v, selected: state.playSpeed === v }, `${v}×`)));
      // dragging a dot (Fix points on): grab the nearest joint, move it, and on letting go the numbers are worked out again
      const toVideo = (e) => { const b = canvas.getBoundingClientRect(), s = canvas.width / b.width; return [((e.clientX - b.left) * s) / k, ((e.clientY - b.top) * s) / k]; };
      canvas.addEventListener("pointerdown", (e) => {
        if (!state.fixing) return;
        const [x, y] = toVideo(e), q = R.pts[state.frame || 0];
        let best = null;
        HANDLES.forEach(([j]) => { const d = Math.hypot(q[j][0] - x, q[j][1] - y) * k; if (d < 24 && (!best || d < best.d)) best = { j, d }; });
        if (!best) return;
        e.preventDefault();
        try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* the drag still works without it */ }
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
      slider.addEventListener("input", () => { if (playing) { cancelAnimationFrame(playing.raf); if (f.video) f.video.pause(); playing = null; playBtn.textContent = "▶ Play"; } paint(Number(slider.value)); });
      const go = (i) => { if (playing) { cancelAnimationFrame(playing.raf); if (f.video) f.video.pause(); playing = null; playBtn.textContent = "▶ Play"; } slider.value = i; paint(i); };
      seqEl = R.seq ? sequenceBlock(R, go) : null;
      setTimeout(() => paint(state.frame || 0), 0);
      const evBtns = el("div", { class: "mc-row" },
        playBtn, el("label", { class: "mc-speed" }, "Speed", speedSel),
        el("button", { type: "button", class: "mc-btn ghost", onclick: () => go(Math.max(0, (state.frame || 0) - 1)) }, "◀"),
        Object.entries(R.events).map(([key, i]) => el("button", { type: "button", class: "mc-btn ghost", onclick: () => go(i) }, evL[key])),
        el("button", { type: "button", class: "mc-btn ghost", onclick: () => go(Math.min(R.n - 1, (state.frame || 0) + 1)) }, "▶"));
      // what the picture shows: the video, the skeleton, or both; and the skeleton alone in 3D
      const layers = el("div", { class: "mc-row" },
        f.video ? el("label", { class: "mc-keep" }, el("input", { type: "checkbox", checked: !state.hideVideo, onchange: (e) => { state.hideVideo = !e.target.checked; draw(state.frame || 0); } }), " Video") : null,
        el("label", { class: "mc-keep" }, el("input", { type: "checkbox", checked: !state.hideSkel, onchange: (e) => { state.hideSkel = !e.target.checked; draw(state.frame || 0); } }), " Skeleton"),
        el("button", { type: "button", class: `mc-btn ${state.show3d ? "" : "ghost"} small`, "aria-pressed": state.show3d ? "true" : "false", onclick: () => { state.show3d = !state.show3d; render(); } }, state.show3d ? "Hide 3D skeleton" : "3D skeleton and comparisons"));
      // a moment found in the wrong place can be set by hand, to the frame showing (the moments after it follow)
      const fix = el("div", { class: "mc-row mc-fix" }, el("span", { class: "mc-hint" }, "Moment in the wrong place? Go to the right frame and set it:"),
        Object.keys(R.events).map((key) => el("button", { type: "button", class: "mc-btn ghost small", onclick: () => {
          const order = Object.keys(R.events), keep = {};
          order.slice(0, order.indexOf(key)).forEach((kk) => { if (state.manual && state.manual[kk] != null) keep[kk] = state.manual[kk]; });
          state.manual = { ...keep, [key]: state.frame }; compute(); render();
        } }, `${evL[key]} here`)),
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
      // the curves: the movement's own ([title, unit, values, color, second line]), or a pitch's
      const charts = R.charts ? el("div", { class: "mc-charts" }, R.charts.map(([title, unit, ys, color, extra]) => (ys ? chart(title, unit, ys, R.tReal, R.events, color, extra) : null))) : el("div", { class: "mc-charts" },
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

      // ---- the report: a PDF of the moments, the sequence and the numbers, to print, keep or email ------------------
      const MOMENTS = phaseKeysOf(R);
      const msOf = (i) => Math.round((R.tReal[i] - R.tReal[R.events[zKey]]) * 1000);
      const dateOf = () => (state.saved ? state.saved.date : new Date().toISOString().slice(0, 10));
      // the movement's own tables, and any it makes beside other testing (a jump beside his force plate jumps)
      const allTables = [...(R.tables || []), ...(kind.relate && opts.forceTests ? kind.relate(R, opts.forceTests() || [], { date: dateOf(), variant: state.variant }) : [])];
      const fileName = () => `${(athlete.name || "pitcher").replace(/[^a-z0-9]+/gi, "_")}-motion-capture-${dateOf()}.pdf`;
      // one crop for every moment: everywhere his body reaches at the four of them, with room around it
      const cropBox = () => {
        const xs = [], ys = [];
        MOMENTS.forEach((key) => R.pts[R.events[key]].forEach((p, j) => { if ((j === 0 || j >= 11) && Number.isFinite(p[0])) { xs.push(p[0]); ys.push(p[1]); } }));
        if (!xs.length) return { x: 0, y: 0, w: tr.W, h: tr.H };
        const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys), pad = 0.15 * Math.max(x1 - x0, y1 - y0);
        const bx = Math.max(0, x0 - pad), by = Math.max(0, y0 - pad);
        return { x: bx, y: by, w: Math.min(tr.W, x1 + pad) - bx, h: Math.min(tr.H, y1 + pad) - by };
      };
      // a moment as it shows above (video and skeleton, or whichever is on)
      const shot = async (i, box, w) => {
        const kk = w / box.w, c = document.createElement("canvas");
        c.width = Math.round(w); c.height = Math.round(box.h * kk);
        const g = c.getContext("2d");
        if (f.video && !state.hideVideo) { await seek(f.video, tr.frames[i].t); g.drawImage(f.video, box.x, box.y, box.w, box.h, 0, 0, c.width, c.height); }
        else { g.fillStyle = "#111"; g.fillRect(0, 0, c.width, c.height); }
        if (!state.hideSkel || !f.video || state.hideVideo) { g.save(); g.translate(-box.x * kk, -box.y * kk); drawSkeleton(g, R.pts[i], kk, kk, state.throws, hiddenAt(i)); g.restore(); }
        return c;
      };
      async function buildPdf(quality = 0.85) {
        stopPlay();
        await painting;
        const JsPDF = await jsPdf();
        const pdf = new JsPDF({ orientation: "portrait", unit: "in", format: "letter" });
        const PW = 8.5, PH = 11, M = 0.5, CW = PW - 2 * M, GAP = 0.12, GRAY = [95, 95, 95];
        let y = M;
        const img = (c, x, yy, w) => { const h = (c.height / c.width) * w; pdf.addImage(c.toDataURL("image/jpeg", quality), "JPEG", x, yy, w, h); return h; };
        const text = (s, x, yy, { size = 10, bold = false, color = [17, 17, 17], align, maxW } = {}) => {
          pdf.setFont("helvetica", bold ? "bold" : "normal"); pdf.setFontSize(size); pdf.setTextColor(...color);
          const t = maxW ? pdf.splitTextToSize(pdfSafe(s), maxW) : pdfSafe(s);
          pdf.text(t, x, yy, align ? { align } : undefined);
          return Array.isArray(t) ? t.length : 1;
        };
        const room = (h) => { if (y + h > PH - M - 0.3) { pdf.addPage(); y = M; } };
        const heading = (s) => { room(1.1); text(s, M, y + 0.18, { size: 12, bold: true }); y += 0.32; };
        const note2 = (s) => { const n = text(s, M, y + 0.06, { size: 8, color: GRAY, maxW: CW }); y += n * 0.14 + 0.12; };
        // a plain table: cols [[heading, width]], rows { cells, flag (the column to mark amber) }
        const table = (cols, rows) => {
          const rowH = 0.22;
          const head = () => { pdf.setFillColor(238, 238, 238); pdf.rect(M, y, CW, rowH, "F"); let x = M + 0.06; cols.forEach(([label, w]) => { text(label, x, y + 0.15, { size: 8.5, bold: true }); x += w; }); y += rowH; };
          room(rowH * 3); head();
          rows.forEach((r) => {
            if (y + rowH > PH - M - 0.3) { pdf.addPage(); y = M; head(); }
            let x = M + 0.06;
            r.cells.forEach((cell, k) => { text(cell, x, y + 0.15, { size: 8.5, bold: r.flag === k, color: r.flag === k ? [176, 108, 0] : [17, 17, 17] }); x += cols[k][1]; });
            pdf.setDrawColor(225, 225, 225); pdf.line(M, y + rowH, M + CW, y + rowH);
            y += rowH;
          });
          y += 0.14;
        };
        // who, when, how it was filmed
        text(`Motion Capture Report${kindName === "pitching" ? "" : `: ${kind.label}`}`, M, y + 0.25, { size: 18, bold: true });
        text("Dynamic Sports Training", PW - M, y + 0.25, { size: 10, bold: true, color: [181, 40, 58], align: "right" });
        y += 0.55;
        text(athlete.name || "", M, y, { size: 13, bold: true });
        y += 0.22;
        text(`${dateOf()} · ${setupName(state.setup)} · timing at ${state.cap} fps${kind.hand ? ` · ${state.throws === "L" ? "left-handed" : "right-handed"}` : ""}${state.heightIn ? ` · ${state.heightIn}"` : ""}`, M, y, { size: 9.5, color: GRAY });
        y += 0.32;
        // the four moments
        heading("The moments");
        const box = cropBox(), w4 = (CW - GAP * 3) / 4, shots = [];
        for (const key of MOMENTS) shots.push(await shot(R.events[key], box, 520));
        const h4 = (shots[0].height / shots[0].width) * w4;
        room(h4 + 0.35);
        shots.forEach((c, k) => {
          const key = MOMENTS[k], ms = msOf(R.events[key]);
          img(c, M + k * (w4 + GAP), y, w4);
          text(`${evL[key]}${key === zKey ? "" : ` · ${ms > 0 ? "+" : ""}${ms} ms`}`, M + k * (w4 + GAP) + w4 / 2, y + h4 + 0.16, { size: 8.5, bold: true, align: "center" });
        });
        y += h4 + 0.38;
        // the kinematic sequence
        const seqSvg = seqEl && seqEl.querySelector("svg");
        if (seqSvg) {
          heading(`Kinematic sequence: ${R.inOrder ? "in order (hips, trunk, arm, elbow)" : "out of order"}`);
          const c = await svgToCanvas(seqSvg), h = (c.height / c.width) * CW;
          room(h + 0.3);
          img(c, M, y, CW);
          y += h + 0.06;
          R.seq.forEach((s, k) => { const x = M + k * 1.6; pdf.setFillColor(s.color); pdf.rect(x, y + 0.04, 0.22, 0.06, "F"); text(s.name, x + 0.28, y + 0.11, { size: 8.5 }); });
          y += 0.26;
          table([["Segment", 2.2], ["Peak speed", 1.8], ["After foot strike", 1.8], ["Before release", 1.7]],
            R.seq.map((s) => ({ cells: [s.name, s.peak == null ? "–" : `${s.peak.toLocaleString()} °/s`, s.fromFS == null ? "–" : `${s.fromFS} ms`, s.beforeBR == null ? "–" : `${s.beforeBR} ms`] })));
          if (R.elbowFirst && state.elbowDepth !== false) note2(`The elbow's early peak (${R.elbowFirst.peak.toLocaleString()} °/s, ${R.elbowFirst.ms} ms after foot strike) is taken as depth, the forearm turning toward or away from the camera rather than straightening, so the elbow's line starts after it.`);
          if (R.rotSource === "estimate") note2("From one camera, pelvis and trunk speeds are the pose model's 3D estimate; the two-camera setup measures them. The upper arm's swing stands in for the shoulder, whose internal rotation video can't see.");
        }
        // the numbers
        heading("The numbers");
        table([["Measure", 3.7], ["His", 1.7], ["Usual range", 2.1]], R.metrics.map((m) => {
          const [lo, hi] = (m.range || "").split("–").map(Number);
          const out = typeof m.value === "number" && Number.isFinite(lo) && Number.isFinite(hi) && (m.value < lo || m.value > hi);
          return { cells: [m.label, m.value == null ? "–" : `${m.value} ${m.unit || ""}`, m.range ? `${m.range} ${(m.unit || "").replace(/^° .*/, "°")}` : ""], flag: out ? 1 : -1 };
        }));
        note2(`In amber: outside the usual range${kindName === "pitching" ? " for pitchers" : ""}, a guide from published biomechanics (it varies with body and style). Joint angles from video are good to about 5 to 10 degrees: compare sessions filmed the same way.`);
        // the movement's own tables (a sprint's steps), each column an even share of the width
        allTables.forEach((t) => { heading(t.title); table(t.cols.map((c) => [c, CW / t.cols.length]), t.rows.map((r) => ({ cells: r.map((c) => (c == null ? "–" : String(c))) }))); });
        // the curves, two to a row
        const boxes = [...charts.querySelectorAll(".mc-chart-box")];
        if (boxes.length) heading("Through the delivery");
        for (let k = 0; k < boxes.length; k += 2) {
          const pair = await Promise.all(boxes.slice(k, k + 2).map((b) => svgToCanvas(b.querySelector("svg"))));
          const w2 = (CW - 0.2) / 2, h2 = (pair[0].height / pair[0].width) * w2;
          room(h2 + 0.3);
          pair.forEach((c, j) => { text(boxes[k + j].querySelector(".mc-chart-title").textContent, M + j * (w2 + 0.2), y + 0.12, { size: 8.5, bold: true }); img(c, M + j * (w2 + 0.2), y + 0.18, w2); });
          y += h2 + 0.32;
        }
        // the 3D skeleton, when it's open, with whatever it's compared with
        if (sk3d) {
          heading("3D skeleton");
          const desc = sk3d.describe();
          if (desc) note2(desc);
          const s3 = MOMENTS.map((key) => sk3d.report(R.events[key], 600, 600));
          room(w4 + 0.35);
          s3.forEach((s, k) => { img(s.canvas, M + k * (w4 + GAP), y, w4); text(evL[MOMENTS[k]], M + k * (w4 + GAP) + w4 / 2, y + w4 + 0.16, { size: 8.5, bold: true, align: "center" }); });
          y += w4 + 0.38;
          const g = s3.find((s) => s.group), f0 = (v) => (v == null || !Number.isFinite(v) ? "–" : String(Math.round(v)));
          table([["At", 2.3], ...MOMENTS.map((key) => [evL[key], 1.3])], POSE_NUMS.map(([key, label, unit]) => ({
            cells: [`${label} (${unit})`, ...s3.map((s) => (s.group ? `${f0(s.mine[key])} vs ${f0(s.group.nums[key])}` : f0(s.mine[key])))],
          })));
          note2(g ? `His, then the group's ${g.group.med ? "median" : "mean"} (${g.group.n} sessions). From the pose model's 3D estimate: the depth toward and away from the camera is the least sure part.` : "From the pose model's 3D estimate: the depth toward and away from the camera is the least sure part.");
        }
        const noteText = (note.value || "").trim();
        if (noteText) { heading("Notes"); const n = text(noteText, M, y + 0.05, { size: 10, maxW: CW }); y += n * 0.18 + 0.1; }
        const pages = pdf.getNumberOfPages();
        for (let p = 1; p <= pages; p++) {
          pdf.setPage(p);
          text(`${athlete.name || ""} · motion capture, ${dateOf()} · page ${p} of ${pages}`, PW / 2, PH - 0.3, { size: 7.5, color: [130, 130, 130], align: "center" });
        }
        paint(state.frame || 0); // back to the frame that was showing
        return pdf;
      }
      const reportMsg = el("span", { class: "mc-status", role: "status" });
      const making = async (fn) => {
        reportMsg.textContent = "Making the report…";
        try { await fn(); reportMsg.textContent = ""; } catch (e) { reportMsg.textContent = `Couldn't make the report: ${(e && e.message) || e}`; }
      };
      // print: the PDF opens in a tab of its own with the print dialog (the window is opened at the tap, or a phone blocks it)
      const printIt = () => {
        const w = window.open("", "_blank");
        making(async () => {
          const pdf = await buildPdf();
          pdf.autoPrint();
          const url = URL.createObjectURL(pdf.output("blob"));
          if (w) w.location.href = url; else pdf.save(fileName());
        });
      };
      const savePdf = () => making(async () => { (await buildPdf()).save(fileName()); });
      // email: to the athlete (or anyone), from the coach's own address, the PDF attached (api/send-athlete-email.js)
      const emailBox = el("div", { class: "mc-email" });
      const openEmail = () => {
        const first = (athlete.name || "").split(/\s+/)[0] || "";
        const to = el("input", { type: "email", value: athlete.email || "", placeholder: "athlete@example.com", "aria-label": "To" });
        const cc = el("input", { type: "text", placeholder: "parent@example.com, coach@example.com", "aria-label": "CC" });
        const subject = el("input", { type: "text", value: "Your motion capture report from Dynamic Sports Training", "aria-label": "Subject" });
        const body = el("textarea", { rows: 5, "aria-label": "Message" });
        body.value = `Hi ${first},\n\nAttached is the motion capture report from your ${dateOf()} session: the key moments of your delivery, your kinematic sequence and your numbers beside the usual ranges for pitchers. Let me know if you have any questions.\n`;
        const msg = el("span", { class: "mc-status", role: "status" });
        const close = () => emailBox.replaceChildren();
        const sendBtn = el("button", { type: "button", class: "mc-btn", onclick: async () => {
          const re = /^[^@\s]+@[^@\s]+\.[^@\s]+$/, list = (s) => s.split(",").map((x) => x.trim()).filter(Boolean);
          const toList = list(to.value), ccList = list(cc.value);
          if (!toList.length || toList.some((a) => !re.test(a))) { msg.textContent = "Enter a valid email to send it to."; return; }
          if (ccList.some((a) => !re.test(a))) { msg.textContent = "One of the CC addresses doesn't look right."; return; }
          if (!subject.value.trim() || !body.value.trim()) { msg.textContent = "The subject and message can't be empty."; return; }
          sendBtn.disabled = true;
          try {
            msg.textContent = "Making the report…";
            let b64 = null;
            for (const q of [0.85, 0.65, 0.5]) { b64 = (await buildPdf(q)).output("datauristring").split(",")[1]; if (b64.length <= 3.8e6) break; b64 = null; } // the send takes about 4.5 MB at most
            if (!b64) throw new Error("the report is too big to email. Close the 3D skeleton, or save the PDF and send it yourself.");
            msg.textContent = "Sending…";
            const { data } = await sbc().auth.getSession();
            const token = data && data.session && data.session.access_token;
            if (!token) throw new Error("you're not signed in. Reload and sign in again.");
            const res = await fetch("/api/send-athlete-email", {
              method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
              body: JSON.stringify({ to: toList.join(", "), cc: ccList.join(", "), subject: subject.value.trim(), body: body.value, filename: fileName(), pdfBase64: b64, kind: "athlete_tab", athleteName: athlete.name, tab: "mocap" }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(json.error || `the send failed (${res.status})`);
            emailBox.replaceChildren(el("p", { class: "mc-hint" }, `Sent to ${toList.join(", ")}${ccList.length ? ` (cc ${ccList.join(", ")})` : ""}, from your email, with the report attached.`), el("button", { type: "button", class: "mc-btn ghost small", onclick: close }, "Close"));
          } catch (e) { msg.textContent = `Couldn't send it: ${(e && e.message) || e}`; sendBtn.disabled = false; }
        } }, "Send");
        emailBox.replaceChildren(el("div", { class: "mc-email-form" },
          el("label", null, "To", to), el("label", null, "CC (optional)", cc), el("label", null, "Subject", subject), el("label", null, "Message", body),
          el("p", { class: "mc-hint" }, `The report goes as a PDF, sent from your own email address${sk3d ? ", with the 3D skeleton as it's set now" : ""}.`),
          el("div", { class: "mc-row" }, sendBtn, el("button", { type: "button", class: "mc-btn ghost", onclick: close }, "Cancel"), msg)));
      };
      // Send to assessment: what this clip measured, into his biomechanical assessment (the host finds or starts it)
      const assessMsg = el("span", { class: "mc-status", role: "status" });
      const sendAssess = async () => {
        const list = assessmentWords(R.assessment);
        const q = { title: "Send to his biomechanical assessment?", text: `${list.join("; ")}. It goes into his latest assessment from the last two weeks, or a new one dated today.`, ok: "Send" };
        if (!(window.askConfirm ? await window.askConfirm(q) : window.confirm(`${q.title} ${q.text}`))) return;
        assessMsg.textContent = "Sending…";
        try { const where = await opts.fillAssessment(R.assessment); assessMsg.textContent = `Filled in on ${where}: ${list.join("; ")}.`; } catch (e) { assessMsg.textContent = `Couldn't fill it in (${(e && e.message) || e}).`; }
      };
      const assessRow = R.assessment && R.assessment.length && opts.fillAssessment
        ? el("div", { class: "mc-report" }, el("div", { class: "mc-row" }, el("b", null, "Biomechanical assessment"), el("button", { type: "button", class: "mc-btn small", onclick: sendAssess }, "Send to assessment"), assessMsg),
          el("p", { class: "mc-hint" }, `Fills in: ${assessmentWords(R.assessment).join("; ")}.`))
        : null;
      const reportRow = el("div", { class: "mc-report" },
        el("div", { class: "mc-row" }, el("b", null, "Report"),
          el("button", { type: "button", class: "mc-btn ghost small", onclick: printIt }, "Print"),
          el("button", { type: "button", class: "mc-btn ghost small", onclick: savePdf }, "Save as PDF"),
          el("button", { type: "button", class: "mc-btn ghost small", onclick: openEmail }, "Email to athlete"),
          reportMsg),
        el("p", { class: "mc-hint" }, `The four moments (as the picture shows them now: video, skeleton or both), the kinematic sequence, the numbers and the curves${sk3d ? ", and the 3D skeleton with its comparison" : " (open the 3D skeleton first to add it)"}.`),
        emailBox);
      return el("div", { class: "mc-results" }, f.video, state.behind && state.behind.video,
        el("div", { class: "mc-row" },
          el("button", { type: "button", class: "mc-btn ghost", onclick: backToStart }, saved ? "← Back" : "← Another video"),
          el("span", { class: "mc-hint" }, `${saved ? `Saved session, ${saved.date} · ` : ""}${setupName(state.setup)} · timing at ${state.cap} fps${kind.hand ? ` · ${state.throws === "L" ? "lefty" : "righty"}` : ""}${state.heightIn ? ` · ${state.heightIn}"` : " · no height, so no speed"}${f.video ? "" : " · no video kept, skeleton only"}`)),
        timing,
        canvas, slider, caption, evBtns, layers, sk3d && sk3d.node, fixDots, fix,
        seqEl,
        R.elbowFirst ? el("label", { class: "mc-keep" }, el("input", { type: "checkbox", checked: state.elbowDepth !== false, onchange: (e) => { state.elbowDepth = e.target.checked; compute(); render(); } }),
          ` Treat the elbow's first peak (${R.elbowFirst.peak.toLocaleString()}°/s, ${R.elbowFirst.ms} ms from foot strike) as depth, not extension: the forearm turning toward or away from the camera, not straightening. The elbow line then starts at the dip after it.`) : null,
        el("div", { class: "mc-grid" }, table, charts),
        allTables.map((t) => el("div", { class: "mc-scroll" }, el("h3", null, t.title), el("table", { class: "mc-table" },
          el("thead", null, el("tr", null, t.cols.map((c) => el("th", null, c)))), el("tbody", null, t.rows.map((r) => el("tr", null, r.map((c) => el("td", null, c == null ? "–" : String(c))))))))),
        el("p", { class: "mc-hint" }, R.hint ? R.hint : R.rotSource === "estimate"
          ? "From one camera, hip-shoulder separation and rotation speeds are the pose model's own 3D estimate: good for spotting big changes, not for exact numbers. The two-camera setup measures them. Joint angles from phone video are good to about 5 to 10 degrees: compare sessions filmed the same way."
          : "Two cameras: the hips' and shoulders' turn comes from both views together, lined up at release. Joint angles from phone video are good to about 5 to 10 degrees: compare sessions filmed the same way."),
        assessRow, reportRow,
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
          el("span", { class: "mc-hint" }, `Saved session, ${rec.date} · ${setupName(rec.setup)} · timing at ${rec.captureFps} fps`)),
        el("p", { class: "mc-hint" }, "This session was saved before the full tracking was kept, so here's what was saved of it, worked out with the analysis as it was then. Analyze the video again for the full report with the skeleton (and the newer, better-placed moments)."),
        seq, metricsTable(metrics), rec.note ? el("p", null, el("b", null, "Notes: "), rec.note) : null);
    }

    // saved sessions, newest first, with the main numbers side by side; open one for its report, or delete it
    function historyBlock() {
      const list = history().slice().sort((a, b) => (b.date || "").localeCompare(a.date || "") || String(b.id).localeCompare(String(a.id)));
      if (!list.length) return el("div", { class: "mc-history" });
      const keys = kind.historyKeys;
      const labelOf = (key) => { const r = list.find((x) => x.labels && x.labels[key]); return r ? r.labels[key][0].replace(/ \(estimate\)$/, "") : key; };
      // working them out again with the latest analysis (or tracking), his, or every pitcher's
      const kept = list.filter(canRerun), older = kept.filter(isOld), vids = kept.filter(canRetrack), oldTrack = vids.filter(trackOld);
      const busy = !!state.rerunning;
      const them = (n) => (n === 1 ? "it" : `all ${n}`);
      const rerunBar = el("div", { class: "mc-rerun" },
        el("div", { class: "mc-row" },
          kept.length ? el("button", { type: "button", class: `mc-btn ${older.length ? "" : "ghost "}small`, disabled: busy, onclick: () => rerunMany(kept, false, "Re-running") }, `Re-run ${them(kept.length)} with the latest analysis`) : null,
          vids.length ? el("button", { type: "button", class: `mc-btn ${oldTrack.length ? "" : "ghost "}small`, disabled: busy, onclick: async () => {
            if (await askFirst(`Re-track ${them(vids.length)} from video?`, `Each kept video goes through the pose model again (a minute or two each, on this device; keep this page open), then its numbers are worked out again. Moments set by hand and fixed points stay.`, "Re-track")) rerunMany(vids, true, "Re-tracking");
          } }, `Re-track ${them(vids.length)} from video`) : null,
          opts.saveAny ? el("button", { type: "button", class: "mc-btn ghost small", disabled: busy, onclick: async () => {
            let all;
            try { all = (await directory()).recs; } catch (e) { state.rerunMsg = `Couldn't read the other sessions (${(e && e.message) || e}).`; const h = root.querySelector(".mc-history"); if (h) h.replaceWith(historyBlock()); return; }
            if (await askFirst(`Re-run every pitcher's sessions (${all.length})?`, "Every saved session with its tracking kept, for every pitcher, is worked out again with the latest analysis and its saved numbers replaced. Moments set by hand and fixed points stay. Each one updated shows in the daily activity email.", "Re-run them all")) rerunMany(all, false, "Re-running every pitcher's:");
          } }, "Re-run every pitcher's sessions") : null,
          el("span", { class: "mc-status mc-rerun-msg", role: "status" }, state.rerunMsg || "")),
        el("p", { class: "mc-hint" }, [
          older.length ? `${older.length === kept.length ? (kept.length === 1 ? "This session was" : "These sessions were") : `${older.length} of these were`} worked out with an older analysis: re-run for the latest numbers. ` : "",
          oldTrack.length ? `${oldTrack.length} ${oldTrack.length === 1 ? "was" : "were"} tracked before the latest tracking: re-track from video for it. ` : "",
          "Re-run works the numbers out again from the kept tracking with the analysis as it is now (quick); re-track runs the kept video through the pose model again first, for when the tracking itself improves. Moments set by hand, fixed points and settings stay either way.",
        ].join("")));
      const status = (r) => (!canRerun(r) ? el("small", null, "summary only") : isOld(r) ? el("span", { class: "mc-old", title: "Worked out with an older analysis: re-run it" }, "older") : trackOld(r) && canRetrack(r) ? el("span", { class: "mc-old", title: "Tracked before the latest tracking: re-track it" }, "older tracking") : el("small", null, "latest"));
      return el("div", { class: "mc-history" }, el("h3", null, "Saved sessions"), rerunBar,
        el("div", { class: "mc-scroll" }, el("table", { class: "mc-table" },
          el("thead", null, el("tr", null, el("th", null, "Date"), el("th", null, "Setup"), keys.map((key) => el("th", null, labelOf(key))), el("th", null, "Notes"), el("th", null, "Analysis"), el("th", null, ""))),
          el("tbody", null, list.slice(0, 20).map((r) => el("tr", null, el("td", null, r.date || ""), el("td", null, (kind.setups.find((s) => s[0] === (r.setup || "one")) || [0, setupName(r.setup)])[1], variantName(r.variant) ? el("small", null, ` · ${variantName(r.variant)}`) : null),
            keys.map((key) => el("td", null, r.metrics && r.metrics[key] != null ? String(r.metrics[key]) : "–")), el("td", { class: "mc-note-cell" }, r.note || ""),
            el("td", null, status(r)),
            el("td", { class: "mc-row-btns" },
              el("button", { type: "button", class: "mc-btn ghost small", onclick: () => openSaved(r) }, "Open report"),
              canRerun(r) ? el("button", { type: "button", class: "mc-btn ghost small", disabled: busy, title: "Work its numbers out again with the latest analysis", onclick: () => rerunMany([r], false, "Re-running") }, "Re-run") : null,
              canRetrack(r) ? el("button", { type: "button", class: "mc-btn ghost small", disabled: busy, title: "Run its kept video through the pose model again, then re-run it", onclick: async () => { if (await askFirst("Re-track this session from its video?", "Its kept video goes through the pose model again (a minute or two, on this device; keep this page open), then its numbers are worked out again. Moments set by hand and fixed points stay.", "Re-track")) rerunMany([r], true, "Re-tracking"); } }, "Re-track") : null,
              opts.onDelete ? el("button", { type: "button", class: "mc-btn ghost small", title: "Delete this session", "aria-label": `Delete the ${r.date} session`, onclick: () => removeSaved(r) }, "✕") : null)))))));
    }

    render();
    return { refresh: render };
  }

  // The start of any movement's analysis (mocap_kinds.js): the side view's real times, how much to smooth, its points
  // cleaned (and any fixed by hand), a time as a number of frames, and his height on screen from his legs at their
  // longest (hip to ankle is about 49% of height), in the picture and in the model's 3D points
  function prepare(side, sideScale, captureFps, edits) {
    const n = side.frames.length;
    const tReal = side.frames.map((f) => (f.t - side.frames[0].t) * sideScale);
    const dt = (tReal[n - 1] - tReal[0]) / Math.max(1, n - 1);
    const perSec = dt > 0 ? 1 / dt : captureFps;
    const sig = Math.max(0.6, perSec / 120), med = Math.max(3, Math.round(perSec * 0.02));
    const pts = clean(side.frames, "p", sig, med), wpts = clean(side.frames, "w", sig, med);
    if (edits && Object.keys(edits).length) applyEdits(pts, edits, Math.max(2, Math.round(perSec * 0.025)));
    const fr = (sec) => Math.max(1, Math.round(sec / Math.max(dt, 1e-4)));
    const leg2 = (q, h, a) => Math.hypot(q[h][0] - q[a][0], q[h][1] - q[a][1]);
    const leg3 = (q, h, a) => Math.hypot(q[h][0] - q[a][0], q[h][1] - q[a][1], q[h][2] - q[a][2]);
    const longest = (list, len) => { const xs = list.map((q) => Math.max(len(q, P.lHip, P.lAn), len(q, P.rHip, P.rAn))).filter(Number.isFinite).sort((a, b) => a - b); return xs[Math.floor(xs.length * 0.9)] || 1; };
    return { n, tReal, dt, perSec, sig, med, pts, wpts, fr, Hpx: longest(pts, leg2) / 0.49, wLegs: longest(wpts, leg3) };
  }

  // Results laid into a biomechanical assessment record (assessment.js): a ROM or performance number into its left or
  // right cell (a single-value test's into left); a movement test's pass or fail for the side, joined with the other
  // side's ("L & R"), and its reading added to the notes (replacing this side's last video reading); an overhead squat
  // finding marked (never unmarked: video only adds what it saw). A copy comes back; the one given isn't touched.
  function applyToAssessment(rec, entries) {
    const out = JSON.parse(JSON.stringify(rec || {}));
    const at = (path) => { let o = out; path.forEach((k) => { if (!o[k] || typeof o[k] !== "object") o[k] = {}; o = o[k]; }); return o; };
    const sidesIn = (v) => new Set(v === "L & R" || v === "L/R" ? ["L", "R"] : v ? [v] : []);
    const word = (set) => (set.has("L") && set.has("R") ? "L & R" : set.has("L") ? "L" : set.has("R") ? "R" : "");
    (entries || []).forEach((e) => {
      if (e.section === "isolatedSpecific" || e.section === "performanceTesting") at([e.section, e.key])[e.side || "left"] = e.value;
      else if (e.section === "movementTests") {
        const cell = at(["movementTests", e.key]), s = e.side === "right" ? "R" : "L";
        const pass = sidesIn(cell.pass), fail = sidesIn(cell.fail);
        if (e.pass != null) { (e.pass ? pass : fail).add(s); (e.pass ? fail : pass).delete(s); }
        cell.pass = word(pass); cell.fail = word(fail);
        if (e.note) {
          const kept = String(cell.notes || "").split("; ").filter((x) => x && !(x.startsWith(`${s} `) && x.endsWith("(video)")));
          cell.notes = [...kept, `${s} ${e.note} (video)`].join("; ");
        }
      } else if (e.section === "squat" && e.check) {
        const cell = at(["squat", ...e.path]);
        if (e.side) cell[e.side] = { ...(cell[e.side] || {}), c1: true }; else cell.c1 = true;
      }
    });
    return out;
  }
  // the same, in words, for asking before and saying after
  const ASSESS_NAMES = { activeStraightLegRaise: "Active straight leg raise", modifiedThomasTest: "Modified Thomas test", proneHipExtension: "Prone hip extension", singleLegBalance: "Single-leg balance", seatedThoracicRotation: "Seated thoracic rotation", hamstringLengthPslr: "Hamstring (pSLR)", hamstringLength9090: "Hamstring (90/90)", shoulderFlexRom: "Shoulder flexion", shoulderErRom: "Shoulder ER", shoulderIrRom: "Shoulder IR", elbowExtRom: "Elbow extension", elbowFlexRom: "Elbow flexion", hipIrSupine: "Hip IR (supine)", hipErSupine: "Hip ER (supine)", hipIrProne: "Hip IR (prone)", hipErProne: "Hip ER (prone)", ankleDorsiflexion: "Ankle dorsiflexion", cmj: "CMJ", tenYdStart: "10yd start", adduction: "Overhead squat: knee adduction", frontalPlaneWeightShift: "Overhead squat: weight shift", barDriftForward: "Overhead squat: arms fall forward", forwardHead: "Overhead squat: forward head" };
  function assessmentWords(entries) {
    return (entries || []).map((e) => {
      const name = ASSESS_NAMES[e.key || (e.path || [])[(e.path || []).length - 1]] || e.key;
      const side = e.side && e.section !== "performanceTesting" ? `, ${e.side}` : "";
      return e.section === "movementTests" ? `${name}${side}: ${e.pass == null ? "" : e.pass ? "pass, " : "fail, "}${e.note || ""}` : e.section === "squat" ? `${name}${side}` : `${name}${side}: ${e.value}`;
    });
  }

  window.MoCap = {
    findTape: (v, color, near, radius) => findTape(v, TAPES[color], near, radius, null, document.createElement("canvas")),
    mount, analyze, sequenceBlock, HOW_TO, bodyOf, poseNumbers, kinds: KINDS,
    lib: { P, sidesOf, clean, applyEdits, mid, angleAt, deriv, unwrap, argBest, smoothSeries, comOf, r1, deg, wrapDeg, prepare, groundForce, forceMetrics, applyToAssessment },
  };
})();
