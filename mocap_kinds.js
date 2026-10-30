// Motion capture for hitting, sprinting and jumping: the movements measured besides pitching. Each is an analysis of
// the same tracked body points as a pitch (mocap.js), with its own moments, numbers, curves and filming tips; the rest
// (tracking, fixing points, playback, the 3D skeleton and comparisons, the report, saving, re-running) is mocap.js's.
// Loaded after mocap.js, it adds them to window.MoCap.kinds:
//   hitting  a swing from the open side (facing his chest), and optionally from behind: stride, load and timing,
//            separation, rotation speeds and the kinematic sequence, head movement, hand speed
//   sprint   side on, a start (linear, base-stealing, 40-yard) or max velocity: the first move and first step,
//            time to 1 and 2 meters, every step's contact and flight time, step length and rate,
//            speed, shin and trunk angles at touchdown, how far the foot lands ahead of the hips, knee lift
//   jump     side on: a countermovement jump, broad jump, or single-leg jump on either leg: height from flight time,
//            countermovement depth and timing, angles at the bottom, takeoff and landing, broad jump distance
(function () {
  const M = window.MoCap;
  if (!M || !M.lib) return;
  const { P, sidesOf, mid, angleAt, deriv, unwrap, argBest, smoothSeries, r1, deg, wrapDeg, prepare } = M.lib;
  const metric = (key, label, value, unit, range, note) => ({ key, label, value: typeof value === "number" && !Number.isFinite(value) ? null : value, unit, range: range || "", note: note || "" });
  const mean = (xs) => { const v = xs.filter((x) => x != null && Number.isFinite(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const median = (xs) => { const v = xs.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b); return v.length ? v[v.length >> 1] : null; };
  const hipOf = (q) => mid(q[P.lHip], q[P.rHip]);
  const shOf = (q) => mid(q[P.lSh], q[P.rSh]);
  // a line's lean from straight up, degrees, + toward `dir` on screen (y grows down)
  const leanOf = (lo, hi, dir) => deg(Math.atan2(dir * (hi[0] - lo[0]), lo[1] - hi[1]));
  const flexAt = (q, a, b, c) => { const x = angleAt(q[a], q[b], q[c]); return x == null ? null : 180 - x; };
  const mph = (ms) => (ms == null ? null : ms * 2.23694);
  const inches = (m) => (m == null ? null : m / 0.0254);
  const ftIn = (m) => { if (m == null || !Number.isFinite(m)) return null; const i = Math.round(m / 0.0254); return `${Math.floor(i / 12)}' ${i % 12}"`; };

  const TIPS_COMMON = [
    ["Most Compatible format", "Settings › Camera › Formats › Most Compatible. The default (High Efficiency) won't open in every browser on a computer."],
    ["On a tripod, landscape", "Phone sideways, on a tripod or something steady, at about hip height. No zoom past 1×, no moving the phone (don't follow him), and no one walking through the shot."],
    ["Light and clothes", "Bright, even light with the sun not behind him. Fitted clothes and a background that isn't the color of his clothes make the points easier to find."],
    ["Height", "Enter his height: it turns the picture into feet and inches, so speeds, lengths and distances come out real."],
  ];
  const SETUPS_SIDE = [["one", "Phone (side on)"], ["edger", "Edgertronic (side on)"]];

  // ---- hitting ---------------------------------------------------------------------------------------------------------
  // The moments: the load (the front foot at its highest), foot plant (the front foot down again), contact (the hands at
  // their fastest, which is just before the ball: video can't see the bat) and the finish (the hands at their highest).
  function analyzeHitting({ side, behind, throws: bats, heightIn, captureFps, sideScale, behindScale, events: manual, edits, weightKg }) {
    const A = prepare(side, sideScale, captureFps, edits), { n, tReal, dt, sig, med, pts, wpts, fr, Hpx } = A;
    const S = sidesOf(bats), m = manual || {}; // a righty hitter's front side is his left, as a righty pitcher's is
    const hands = pts.map((q) => mid(q[P.lWr], q[P.rWr]));
    const hvx = deriv(hands.map((h) => h[0]), dt), hvy = deriv(hands.map((h) => h[1]), dt);
    const handSpd = smoothSeries(hvx.map((vx, i) => Math.hypot(vx || 0, hvy[i] || 0)), sig);
    const C = m.C != null ? m.C : argBest(handSpd, fr(0.2), n - 1 - fr(0.05), (a, b) => a > b);
    const footY = pts.map((q) => (q[S.lead.heel][1] + q[S.lead.toe][1] + q[S.lead.an][1]) / 3);
    const footX = pts.map((q) => (q[S.lead.heel][0] + q[S.lead.toe][0] + q[S.lead.an][0]) / 3);
    const LD = m.LD != null ? m.LD : argBest(footY, Math.max(0, C - fr(1.6)), Math.max(0, C - fr(0.12)), (a, b) => a < b);
    const groundY = Math.max(...footY.slice(Math.max(0, C - fr(1.6)), C + 1));
    const fSpd = deriv(footX, dt).map((v) => Math.abs(v || 0));
    let FP = m.FP != null ? m.FP : -1;
    if (FP < 0) for (let i = LD + 1; i < C; i++) if (footY[i] >= groundY - 0.02 * Hpx && fSpd[i] < 0.6 * Hpx) { FP = i; break; }
    if (FP < 0) FP = Math.max(LD + 1, C - fr(0.15));
    const FIN = m.FIN != null ? m.FIN : argBest(hands.map((h) => h[1]), C + fr(0.05), Math.min(n - 1, C + fr(0.7)), (a, b) => a < b);
    // toward the pitcher on screen: the way the front foot strides (or, with no stride, the way it sits from the back foot)
    const dir = Math.sign(footX[FP] - footX[LD]) || Math.sign(pts[FP][S.lead.an][0] - pts[FP][S.drive.an][0]) || 1;
    const mPx = heightIn ? (heightIn * 0.0254) / Hpx : null;
    // the hips' and shoulders' turn: from behind (measured) or the model's 3D points (an estimate)
    let pelvis, trunk, rotSource = "estimate";
    if (behind) {
      const bp = M.lib.clean(behind.frames, "p", sig, med), bT = behind.frames.map((f) => (f.t - behind.frames[0].t) * behindScale), bn = bp.length;
      const bH = bp.map((q) => mid(q[P.lWr], q[P.rWr])), bvx = deriv(bH.map((h) => h[0]), dt), bvy = deriv(bH.map((h) => h[1]), dt);
      const bSpd = smoothSeries(bvx.map((vx, i) => Math.hypot(vx || 0, bvy[i] || 0)), sig);
      const bC = argBest(bSpd, 0, bn - 1, (a, b) => a > b), offset = tReal[C] - bT[bC]; // lined up at contact, the hands' fastest
      const bEarly = bp.slice(0, Math.max(3, Math.round(bn * 0.1)));
      const bHt = bEarly.reduce((s, q) => s + (Math.max(q[P.lAn][1], q[P.rAn][1]) - q[P.nose][1]), 0) / bEarly.length / 0.87;
      const at = (t) => { const x = t - offset; let k = 0; while (k < bn - 2 && bT[k + 1] < x) k++; const a = bp[k], b = bp[Math.min(bn - 1, k + 1)], f = bT[k + 1] > bT[k] ? Math.max(0, Math.min(1, (x - bT[k]) / (bT[k + 1] - bT[k]))) : 0; return a.map((p, j) => [p[0] + (b[j][0] - p[0]) * f, p[1] + (b[j][1] - p[1]) * f]); };
      const line = (q, bq, l, r) => deg(Math.atan2((dir * (q[r][0] - q[l][0])) / Hpx, (bq[r][0] - bq[l][0]) / bHt));
      const bAll = tReal.map((t) => at(t));
      pelvis = unwrap(pts.map((q, i) => line(q, bAll[i], P.lHip, P.rHip)));
      trunk = unwrap(pts.map((q, i) => line(q, bAll[i], P.lSh, P.rSh)));
      rotSource = "measured";
    } else {
      pelvis = unwrap(wpts.map((q) => deg(Math.atan2(q[P.rHip][2] - q[P.lHip][2], q[P.rHip][0] - q[P.lHip][0]))));
      trunk = unwrap(wpts.map((q) => deg(Math.atan2(q[P.rSh][2] - q[P.lSh][2], q[P.rSh][0] - q[P.lSh][0]))));
    }
    const sep = pelvis.map((p, i) => (p == null || trunk[i] == null ? null : wrapDeg(p - trunk[i])));
    const pelvisV = deriv(smoothSeries(pelvis, sig * 2), dt), trunkV = deriv(smoothSeries(trunk, sig * 2), dt);
    // the front arm: the upper arm's swing (3D) and the elbow straightening (its angle seen from the side)
    const v3 = (a, b) => [b[0] - a[0], b[1] - a[1], b[2] - a[2]], unit3 = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return v.map((x) => x / l); };
    const upper = wpts.map((q) => unit3(v3(q[S.glove.sh], q[S.glove.el])));
    const armV = smoothSeries(upper.map((u, i) => { const lo = Math.max(0, i - 1), hi = Math.min(n - 1, i + 1); if (hi <= lo) return null; const d = Math.max(-1, Math.min(1, u[0] * upper[hi][0] + u[1] * upper[hi][1] + u[2] * upper[hi][2])); const d2 = Math.max(-1, Math.min(1, upper[lo][0] * u[0] + upper[lo][1] * u[1] + upper[lo][2] * u[2])); return (deg(Math.acos(d)) + deg(Math.acos(d2))) / ((hi - lo) * dt); }), sig);
    const elbowFlex = pts.map((q) => flexAt(q, S.glove.sh, S.glove.el, S.glove.wr));
    const elbowV = smoothSeries(deriv(smoothSeries(elbowFlex, sig * 1.5), dt).map((v) => (v == null ? null : -v)), sig);
    const ab = (xs) => xs.map((x) => (x == null ? null : Math.abs(x)));
    const pvI = argBest(ab(pelvisV), FP - fr(0.15), C, (a, b) => a > b), tvI = argBest(ab(trunkV), FP - fr(0.1), C + fr(0.02), (a, b) => a > b);
    const avI = argBest(armV, FP, C + fr(0.03), (a, b) => a > b), evI = argBest(elbowV, FP, C + fr(0.03), (a, b) => a > b);
    const ms = (i, j) => (i < 0 || j < 0 ? null : Math.round((tReal[j] - tReal[i]) * 1000));
    const seq = [["Pelvis", pelvisV, pvI, "#2ec4b6"], ["Trunk", trunkV, tvI, "#ff4d5e"], ["Front arm", armV, avI, "#ff9f1c"], ["Front elbow", elbowV, evI, "#c77dff"]]
      .map(([name, ys, i, color]) => ({ name, color, i, peak: i < 0 || ys[i] == null ? null : Math.round(Math.abs(ys[i])), fromFS: ms(FP, i), beforeBR: i < 0 ? null : Math.round((tReal[C] - tReal[i]) * 1000) }));
    const found = seq.filter((r) => r.i >= 0), inOrder = found.every((r, k) => k === 0 || r.i >= found[k - 1].i);
    const kneeFlex = pts.map((q) => flexAt(q, S.lead.hip, S.lead.kn, S.lead.an));
    const tilt = pts.map((q) => -leanOf(hipOf(q), shOf(q), dir)); // + the shoulders back, away from the pitcher
    const handMph = mPx ? handSpd.map((v) => (v == null ? null : mph(v * mPx))) : null;
    const sepMaxI = argBest(ab(sep), LD, C, (a, b) => a > b);
    const head = (i) => pts[i][P.nose];
    const headX = mPx ? inches(Math.abs(head(C)[0] - head(LD)[0]) * mPx) : null, headY = mPx ? inches((head(C)[1] - head(LD)[1]) * mPx) : null;
    const est = rotSource === "estimate" ? " (estimate)" : "";
    const metrics = [
      metric("stride", "Stride length", r1((Math.abs(pts[FP][S.lead.an][0] - pts[FP][S.drive.an][0]) / Hpx) * 100), "% of height", "", "Ankle to ankle at foot plant, as a share of his height."),
      metric("ldfp", "Load to foot plant", ms(LD, FP), "ms", "", "From the front foot at its highest to it landing."),
      metric("fpc", "Foot plant to contact", ms(FP, C), "ms", "", "From the front foot landing to contact (the hands at their fastest)."),
      metric("kneeFP", "Front knee at foot plant", r1(kneeFlex[FP]), "° flexed", "", "How bent the front knee is when the foot lands."),
      metric("kneeC", "Front knee at contact", r1(kneeFlex[C]), "° flexed", "", "Less bent than at foot plant means the front leg firmed up."),
      metric("block", "Front leg block", r1(kneeFlex[FP] - kneeFlex[C]), "° straightened", "", "How much the front knee straightens from foot plant to contact."),
      metric("tilt", "Trunk tilt at contact", r1(tilt[C]), "° back", "", "The shoulders' lean back away from the pitcher at contact, seen from the open side."),
      metric("sepFP", `Hip-shoulder separation at foot plant${est}`, r1(sep[FP] == null ? null : Math.abs(sep[FP])), "°", "", "How far the hips have turned ahead of the shoulders when the foot lands."),
      metric("sepMax", `Peak hip-shoulder separation${est}`, r1(sepMaxI < 0 ? null : Math.abs(sep[sepMaxI])), "°", "", "The most the hips get ahead of the shoulders."),
      metric("pelvisV", `Peak pelvis rotation speed${est}`, pvI < 0 ? null : Math.round(Math.abs(pelvisV[pvI])), "°/s", "", "How fast the hips turn at their fastest."),
      metric("trunkV", `Peak trunk rotation speed${est}`, tvI < 0 ? null : Math.round(Math.abs(trunkV[tvI])), "°/s", "", "How fast the shoulders turn at their fastest."),
      metric("gain", `Trunk / pelvis speed gain${est}`, pvI < 0 || tvI < 0 || !pelvisV[pvI] ? null : Math.round((Math.abs(trunkV[tvI]) / Math.abs(pelvisV[pvI])) * 100) / 100, "×", "", "How much faster the trunk turns than the hips at their peaks."),
      metric("seqT", `Pelvis → trunk timing${est}`, ms(pvI, tvI), "ms", "", "From the hips' fastest turn to the shoulders': positive means hips first."),
      metric("order", "Kinematic sequence", found.length < 2 ? null : inOrder ? "In order" : "Out of order", "", "", "Hips, trunk, front arm, then front elbow reaching their fastest, each after the one before."),
      metric("headX", "Head movement toward the pitcher", r1(headX), "in", "", "How far the head travels forward from the load to contact (less is steadier)."),
      metric("headY", "Head drop", r1(headY), "in", "", "How far the head drops from the load to contact (negative: it rises)."),
      metric("handV", "Peak hand speed (estimate)", r1(handMph ? handMph[C] : null), "mph", "", "The hands at their fastest, from the side view: the bat moves faster than the hands, and video can't see it."),
    ];
    // inferred: bat speed and exit velo from the hands, and what the ground pushes with
    const bat = handMph && handMph[C] != null ? handMph[C] * 3 : null;
    metrics.push(
      metric("batV", "Bat speed (estimate)", r1(bat), "mph", "", "About 3 times the hands' peak speed (the barrel swings on a longer radius than the hands): a rough guide without a bat sensor."),
      metric("evPot", "Exit velo potential (estimate)", bat == null ? null : r1(1.2 * bat + 0.2 * 85), "mph", "", "Squared up on an 85 mph pitch: 1.2 × bat speed + 0.2 × pitch speed (Alan Nathan's rule of thumb for the collision)."),
      ...M.lib.forceMetrics(M.lib.groundForce({ pts, dt, sig, dir, mPerPx: mPx }), weightKg, [
        ["grfV", "Peak vertical ground force", "vert", FP, C + fr(0.05), "max", "Both feet together, from his center of mass, foot plant to contact: mostly the front leg."],
        ["grfBrake", "Peak braking force", "horiz", FP, C, "min", "The ground stopping his move toward the pitcher: the front leg bracing."],
        ["grfDrive", "Peak drive force", "horiz", LD, FP, "max", "The ground pushing him toward the pitcher in the stride: the back leg."],
      ]),
    );
    return {
      n, tReal, dir, Hpx, pts, wpts, wLegs: A.wLegs, rotSource,
      events: { LD, FP, C, FIN }, evLabels: { LD: "Load", FP: "Foot plant", C: "Contact", FIN: "Finish" },
      phaseKeys: ["LD", "FP", "C", "FIN"], zeroKey: "FP", seqWindow: ["FP", "C"], seqMarks: [["FP", "Foot plant"], ["C", "Contact"]],
      seq, inOrder, metrics,
      seqNote: `Each segment should reach its fastest after the one before it (hips, trunk, front arm, front elbow). ${rotSource === "estimate" ? "Pelvis and trunk here are the pose model's 3D estimate from one camera; a second camera behind measures them. " : ""}Contact is where the hands are fastest, just before the ball: video can't see the bat.`,
      series: { kneeFlex, tilt, sep, pelvisV, trunkV, armV, elbowV, handMph },
      charts: [
        ["Front knee flexion", "°", kneeFlex, "#3fa7ff"],
        ["Trunk tilt back", "°", tilt, "#e0b03a"],
        [`Hip-shoulder separation${est}`, "°", ab(sep), "#c77dff"],
        [`Rotation speed${est}`, "°/s", ab(pelvisV), "#2ec4b6", { ys: ab(trunkV), color: "#ff4d5e", label: "trunk (pelvis in teal)" }],
        handMph ? ["Hand speed (estimate)", "mph", handMph, "#8ac926"] : null,
      ].filter(Boolean),
      hint: rotSource === "estimate"
        ? "From one camera, hip-shoulder separation and rotation speeds are the pose model's 3D estimate: good for spotting big changes, not exact numbers. A second camera behind measures them. Joint angles from video are good to about 5 to 10 degrees: compare sessions filmed the same way."
        : "Two cameras: the hips' and shoulders' turn comes from both views together, lined up at contact. Joint angles from video are good to about 5 to 10 degrees: compare sessions filmed the same way.",
    };
  }

  // ---- sprinting ---------------------------------------------------------------------------------------------------------
  // Every ground contact, found where a foot is down (as low as feet get in the clip) and still: its touchdown and
  // toe-off, and so contact and flight times and step lengths. A start (linear, base-stealing, or a 40-yard three-point
  // start) also gets its first move (the hips leaving where they stood), the first step, and how long the hips take to
  // cover the first 1 and 2 meters; a base-stealing start says whether the first step crossed over or jabbed. The
  // moments shown are a start's first move and first step, or at max velocity one full step mid-clip.
  const SPRINT_RANGES = {
    accel: { contact: "", flight: "", trunk: "30–50", shin: "", step: "" },
    maxv: { contact: "90–120", flight: "110–140", trunk: "0–10", shin: "", step: "" },
  };
  const START_NAMES = { linear: "Linear start", steal: "Base-stealing start", forty: "40-yard start (three-point)", maxv: "Max velocity" };
  function analyzeSprint({ side, heightIn, captureFps, sideScale, events: manual, edits, variant, weightKg }) {
    const A = prepare(side, sideScale, captureFps, edits), { n, tReal, dt, sig, pts, wpts, fr, Hpx } = A;
    const start = variant === "maxv" ? null : variant === "steal" || variant === "forty" ? variant : "linear"; // (an older "accel" is a linear start)
    const m = manual || {}, phase = start ? "accel" : "maxv", R = SPRINT_RANGES[phase];
    const hips = pts.map(hipOf), dir = hips[n - 1][0] - hips[0][0] >= 0 ? 1 : -1;
    // the hips' forward speed, in heights a second (smoothed: a speed from positions is noisy)
    const hipV = smoothSeries(deriv(hips.map((h) => h[0]), dt).map((v) => (v == null ? null : (dir * v) / Hpx)), sig * 3);
    const mPx = heightIn ? (heightIn * 0.0254) / Hpx : null;
    const FEET = [["L", P.lHeel, P.lToe, P.lAn, P.lKn, P.lHip], ["R", P.rHeel, P.rToe, P.rAn, P.rKn, P.rHip]];
    const footX = (q, f) => (q[f[1]][0] + q[f[2]][0] + q[f[3]][0]) / 3, footLow = (q, f) => Math.max(q[f[1]][1], q[f[2]][1]);
    const lows = FEET.flatMap((f) => pts.map((q) => footLow(q, f))).sort((a, b) => a - b);
    const groundY = lows[Math.floor(lows.length * 0.95)];
    // each foot's contacts: low and still, for at least 30 ms (gaps of a frame or two closed)
    const contacts = [];
    FEET.forEach((f) => {
      const vx = smoothSeries(deriv(pts.map((q) => footX(q, f)), dt), sig);
      const down = pts.map((q, i) => footLow(q, f) >= groundY - 0.04 * Hpx && Math.abs(vx[i] || 0) < 1.2 * Hpx);
      for (let i = 1; i < n - 1; i++) if (!down[i] && down[i - 1] && down[i + 1]) down[i] = true;
      for (let i = 0; i < n;) {
        if (!down[i]) { i++; continue; }
        let j = i; while (j + 1 < n && down[j + 1]) j++;
        if (tReal[j] - tReal[i] >= 0.03) contacts.push({ foot: f[0], f, td: i, to: j, partial: i === 0 || j === n - 1 });
        i = j + 1;
      }
    });
    contacts.sort((a, b) => a.td - b.td);
    const atTD = (c) => {
      const q = pts[c.td], f = c.f, hip = hipOf(q);
      return {
        shin: leanOf(q[f[3]], q[f[4]], dir), // + the knee ahead of the ankle
        ahead: (dir * (footX(q, f) - hip[0])) / Hpx, // the foot landing ahead of the hips, in heights
        trunk: leanOf(hip, shOf(q), dir),
      };
    };
    // a step: one contact to the next by the other foot (not the two feet standing at the start); flight only when both
    // feet are off the ground, which a start's first steps may never be
    const steps = contacts.map((c, k) => {
      const next = contacts.slice(k + 1).find((x) => x.foot !== c.foot && x.td > c.td);
      const real = next && c.td > 0;
      const len = real ? (dir * (footX(pts[next.td], next.f) - footX(pts[c.td], c.f))) / Hpx : null;
      const flightMs = real && !c.partial ? Math.round((tReal[next.td] - tReal[c.to]) * 1000) : null;
      return { ...c, ...atTD(c), contactMs: c.partial ? null : Math.round((tReal[c.to] - tReal[c.td]) * 1000), flightMs: flightMs != null && flightMs > 0 ? flightMs : null, stepT: real ? tReal[next.td] - tReal[c.td] : null, len: len != null && len > 0.2 ? len : null };
    });
    const nextOf = (s) => (s ? steps.find((x) => x.td > s.td && x.foot !== s.foot) : null);
    let ev, first = null, ST = null, firstFoot = null, crossover = null, startStats = {};
    if (start) {
      // the first move: the hips leaving where they stood (by 2% of his height)
      const h0 = hips.slice(0, Math.max(2, Math.min(8, Math.round(n * 0.05)))).reduce((s, h) => [s[0] + h[0], s[1] + h[1]], [0, 0]).map((v) => v / Math.max(2, Math.min(8, Math.round(n * 0.05))));
      ST = m.ST != null ? m.ST : Math.max(0, hips.findIndex((h) => Math.hypot(h[0] - h0[0], h[1] - h0[1]) > 0.02 * Hpx));
      // (2% of his height is sure to be moving, but late: back up to where the hips were still)
      if (m.ST == null) while (ST > 0 && hipV[ST - 1] != null && hipV[ST - 1] > 0.02) ST--;
      // the first step: the first foot down after the first move; the first foot to move: the one whose stance ends first
      first = steps.find((s) => s.td > ST && !(s.td === 0)) || null;
      const stance = steps.filter((s) => s.td === 0);
      const lifted = stance.length ? stance.reduce((b, s) => (s.to < b.to ? s : b), stance[0]) : null;
      firstFoot = lifted ? lifted.foot : first ? first.foot : null;
      if (start === "steal" && firstFoot) {
        // from a lead the feet sit along the line to the next base: the back foot moving first crosses over, the front jabs
        const f = FEET.find((x) => x[0] === firstFoot), o = FEET.find((x) => x[0] !== firstFoot);
        crossover = dir * (footX(pts[0], f) - footX(pts[0], o)) < 0;
      }
      // how soon the hips cover the first 1 and 2 meters, and how far the first step reaches from where that foot stood
      const travel = (i) => dir * (hips[i][0] - h0[0]);
      const tTo = (meters) => { if (!mPx) return null; const i = hips.findIndex((_, k) => k >= ST && travel(k) * mPx >= meters); return i < 0 ? null : Math.round((tReal[i] - tReal[ST]) * 1000); };
      startStats = { t1: tTo(1), t2: tTo(2), len: first ? (dir * (footX(pts[first.td], first.f) - footX(pts[0], first.f))) / Hpx : null };
      const s2 = nextOf(first);
      ev = {
        ST,
        TD1: m.TD1 != null ? m.TD1 : first ? first.td : Math.min(n - 1, ST + fr(0.3)),
        TO1: m.TO1 != null ? m.TO1 : first ? first.to : Math.min(n - 1, ST + fr(0.45)),
        TD2: m.TD2 != null ? m.TD2 : s2 ? s2.td : Math.min(n - 1, ST + fr(0.6)),
      };
    } else {
      // a full step in the middle of the clip
      const whole = steps.filter((s) => !s.partial);
      const midStep = whole.length ? whole.reduce((b, s) => (Math.abs(s.td - n / 2) < Math.abs(b.td - n / 2) ? s : b), whole[0]) : null;
      const s2 = nextOf(midStep);
      ev = {
        TD1: m.TD1 != null ? m.TD1 : midStep ? midStep.td : Math.round(n * 0.3),
        TO1: m.TO1 != null ? m.TO1 : midStep ? midStep.to : Math.round(n * 0.4),
        TD2: m.TD2 != null ? m.TD2 : s2 ? s2.td : Math.round(n * 0.6),
        TO2: m.TO2 != null ? m.TO2 : s2 ? s2.to : Math.round(n * 0.7),
      };
    }
    // speed: the hips' forward speed, over the steps found
    // (a start: the fastest the hips get in the clip; at max velocity, their average over the steps)
    const span = steps.length > 1 ? [steps[0].td, steps[steps.length - 1].td] : [0, n - 1];
    const speedH = start ? Math.max(...hipV.filter((v) => v != null)) : mean(hipV.slice(span[0], span[1] + 1));
    const toMs = (h) => (h == null || !mPx ? null : h * Hpx * mPx);
    const thigh = (q, hip, kn) => deg(Math.atan2(dir * (q[kn][0] - q[hip][0]), q[kn][1] - q[hip][1])); // + forward of straight down
    const thighL = pts.map((q) => thigh(q, P.lHip, P.lKn)), thighR = pts.map((q) => thigh(q, P.rHip, P.rKn));
    const trunkLean = pts.map((q) => leanOf(hipOf(q), shOf(q), dir));
    const stepTime = median(steps.map((s) => s.stepT)), stepLen = median(steps.map((s) => s.len));
    const side2 = (foot, key) => median(steps.filter((s) => s.foot === foot).map((s) => s[key]));
    const asym = (key) => { const l = side2("L", key), r = side2("R", key); return l == null || r == null || !(l + r) ? null : Math.round((Math.abs(l - r) / ((l + r) / 2)) * 100); };
    const lenText = (h) => (h == null ? null : mPx ? ftIn(h * Hpx * mPx) : `${Math.round(h * 100)}% ht`);
    const metrics = [
      ...(start ? [
        start === "steal" ? metric("firstStep", "First step", crossover == null ? null : crossover ? "Crossover" : "Jab (open) step", "", "", "From a lead: the back foot moving first and crossing over, or the front foot jabbing toward the base.") : null,
        metric("firstFoot", "First foot to move", firstFoot === "L" ? "Left" : firstFoot === "R" ? "Right" : null, "", "", ""),
        metric("ttd1", "First move to first step", first ? Math.round((tReal[first.td] - tReal[ST]) * 1000) : null, "ms", "", "From the hips starting to move to the first foot landing."),
        metric("firstLen", "First step length", startStats.len == null ? null : mPx ? r1(inches(startStats.len * Hpx * mPx)) : r1(startStats.len * 100), mPx ? "in" : "% of height", "", "How far the first foot lands from where it stood."),
        metric("t1m", "Time to 1 m (3.3 ft)", startStats.t1, "ms", "", "From the first move to the hips 1 meter on (needs his height, and the camera wide enough)."),
        metric("t2m", "Time to 2 m (6.6 ft)", startStats.t2, "ms", "", "From the first move to the hips 2 meters on."),
        metric("trunk1", "Trunk lean at first touchdown", first ? r1(first.trunk) : null, "° forward", R.trunk, "The trunk's lean forward from upright as the first foot lands."),
        metric("shin1", "Shin angle at first touchdown", first ? r1(first.shin) : null, "° forward", "", "The first step's shin from vertical: + the knee ahead of the ankle (pushing, not reaching)."),
      ].filter(Boolean) : []),
      metric("speed", start ? "Top speed reached" : "Speed", r1(toMs(speedH)), "m/s", "", start ? "The hips' fastest forward speed in the clip." : "The hips' forward speed over the steps in the clip."),
      metric("speedMph", start ? "Top speed reached" : "Speed", r1(mph(toMs(speedH))), "mph", "", ""),
      metric("stepLen", "Step length", mPx ? r1(inches(toMs(stepLen))) : r1(stepLen == null ? null : stepLen * 100), mPx ? "in" : "% of height", "", "From one foot's touchdown to the other's (the middle step)."),
      metric("stepLenHt", "Step length (share of height)", r1(stepLen == null ? null : stepLen * 100), "% of height", "", ""),
      metric("stepRate", "Step rate", stepTime ? Math.round((1 / stepTime) * 100) / 100 : null, "steps/s", "", "Steps a second."),
      metric("contact", "Ground contact time", median(steps.map((s) => s.contactMs)), "ms", R.contact, "How long each foot is on the ground (the middle step)."),
      metric("flight", "Flight time", median(steps.map((s) => s.flightMs)), "ms", R.flight, "Time in the air between one foot leaving and the other landing."),
      metric("trunkTD", "Trunk lean at touchdown", r1(median(steps.map((s) => s.trunk))), "° forward", R.trunk, "The trunk's lean forward from upright as a foot lands."),
      metric("shinTD", "Shin angle at touchdown", r1(median(steps.map((s) => s.shin))), "° forward", R.shin, "The shin's lean from vertical as the foot lands: + the knee ahead of the ankle."),
      metric("ahead", "Foot lands ahead of the hips", mPx ? r1(inches(toMs(median(steps.map((s) => s.ahead))))) : r1((median(steps.map((s) => s.ahead)) || 0) * 100), mPx ? "in" : "% of height", "", "How far in front of the hips the foot touches down (overstriding when large)."),
      metric("kneeLift", "Knee lift", r1(Math.max(median(steps.filter((s) => s.foot === "L").map((s) => Math.max(...thighL.slice(s.to, Math.min(n, s.to + fr(0.35)))))) || -90, median(steps.filter((s) => s.foot === "R").map((s) => Math.max(...thighR.slice(s.to, Math.min(n, s.to + fr(0.35)))))) || -90)), "°", "", "The thigh at its highest in front after toe-off (90 = level)."),
      metric("asymContact", "Left / right contact time difference", asym("contactMs"), "%", "", "How much the two feet's contact times differ."),
      metric("asymLen", "Left / right step length difference", asym("len"), "%", "", "How much the steps off each foot differ."),
      metric("steps", "Ground contacts found", steps.length, "", "", "Every touchdown in the clip."),
    ];
    // inferred: the speed of every step (its length over its time), and for a start, the time and speed at set
    // distances and a force-velocity profile (Samozino's method: the hips' speed from the first move fitted to
    // v(t) = vmax·(1 − e^(−t/τ)); the horizontal force a kilogram then falls in a line from F0 = vmax/τ at a standstill to
    // nothing at vmax, and power peaks at F0·vmax/4), which projects his times over longer distances
    steps.forEach((s) => { s.speed = s.len != null && s.stepT && mPx ? (s.len * Hpx * mPx) / s.stepT : null; });
    const kg = weightKg || null;
    let splits = [], fv = null;
    if (start && mPx) {
      const vMs = hipV.map((v) => (v == null ? null : v * Hpx * mPx)), x0 = hips[ST][0];
      const at = (d) => hips.findIndex((h, k) => k >= ST && dir * (h[0] - x0) * mPx >= d);
      splits = [1, 2, 3, 5, 10, 15, 20].map((d) => { const i = at(d); return i < 0 ? null : { d, ms: Math.round((tReal[i] - tReal[ST]) * 1000), v: vMs[i] }; }).filter(Boolean);
      const ts = [], vs = [];
      // (fitted from the first move to a little before the clip's end, where the smoothing runs out of frames)
      for (let i = ST; i < n - Math.ceil(sig * 6); i++) if (vMs[i] != null) { ts.push(tReal[i] - tReal[ST]); vs.push(Math.max(0, vMs[i])); }
      if (ts.length > 10 && ts[ts.length - 1] >= 0.6) {
        let best = null;
        for (let tau = 0.3; tau <= 3; tau += 0.01) {
          let sg = 0, sv = 0;
          ts.forEach((t, k) => { const g1 = 1 - Math.exp(-t / tau); sg += g1 * g1; sv += g1 * vs[k]; });
          const vmax = sv / sg;
          let e = 0;
          ts.forEach((t, k) => { const d = vmax * (1 - Math.exp(-t / tau)) - vs[k]; e += d * d; });
          if (!best || e < best.e) best = { tau, vmax, e };
        }
        if (best && best.vmax >= 4 && best.vmax <= 12.5 && best.tau > 0.31 && best.tau < 2.95) {
          const { tau, vmax } = best;
          const timeTo = (d) => { let lo = 0, hi = 30; for (let k = 0; k < 60; k++) { const t = (lo + hi) / 2; if (vmax * (t + tau * (Math.exp(-t / tau) - 1)) < d) lo = t; else hi = t; } return lo; };
          fv = { tau, vmax, F0: vmax / tau, Pmax: (vmax * vmax) / tau / 4, covered: ts[ts.length - 1], timeTo };
        }
      }
    }
    if (start) {
      const yd = (y) => y * 0.9144, sec = (t) => Math.round(t * 100) / 100;
      metrics.push(
        metric("vmax", "Max speed, projected (estimate)", fv ? r1(fv.vmax) : null, "m/s", "", "The speed his acceleration is heading for (the force-velocity fit)."),
        metric("vmaxMph", "Max speed, projected (estimate)", fv ? r1(mph(fv.vmax)) : null, "mph", "", ""),
        metric("F0", "Max horizontal force (estimate)", fv ? Math.round(fv.F0 * 100) / 100 : null, "N/kg", "", "The push he could make at a standstill, a kilogram of him (F0)."),
        kg ? metric("F0N", "Max horizontal force (estimate)", fv ? Math.round(fv.F0 * kg) : null, "N", "", "") : null,
        metric("Pmax", "Max horizontal power (estimate)", fv ? r1(fv.Pmax) : null, "W/kg", "", "F0 × max speed ÷ 4."),
        kg ? metric("PmaxW", "Max horizontal power (estimate)", fv ? Math.round(fv.Pmax * kg) : null, "W", "", "") : null,
        ...(start === "steal"
          ? [metric("t2b", "Time to second, projected (estimate)", fv ? sec(fv.timeTo(yd(26))) : null, "s", "", "From the first move, a 12-foot lead (78 feet to the bag), running through it: no reaction time, no slide.")]
          : [10, 30, 40, 60].map((y) => metric(`t${y}yd`, `${y}-yard time, projected (estimate)`, fv ? sec(fv.timeTo(yd(y))) : null, "s", "", y === 10 ? "From the first move (no reaction time), projected from the force-velocity fit." : ""))),
      );
    }
    const fvNote = start ? (fv ? ` The force-velocity profile and projected times are fitted to the first ${fv.covered.toFixed(1)} s of the run in the clip: the more of his acceleration the clip covers, the surer they are.` : mPx ? " The clip is too short (or the speed too uneven) for a force-velocity profile: film at least the first 5 yards." : " Enter his height for a force-velocity profile and projected times.") : "";
    return {
      n, tReal, dir, Hpx, pts, wpts, wLegs: A.wLegs,
      events: ev,
      ...(start
        ? { evLabels: { ST: "First move", TD1: "First step", TO1: "First toe-off", TD2: "Second step" }, phaseKeys: ["ST", "TD1", "TO1", "TD2"], zeroKey: "ST", groundKey: "ST" }
        : { evLabels: { TD1: "Touchdown", TO1: "Toe-off", TD2: "Next touchdown", TO2: "Next toe-off" }, phaseKeys: ["TD1", "TO1", "TD2", "TO2"], zeroKey: "TD1", groundKey: "TD1" }),
      metrics: metrics.filter(Boolean),
      series: { trunkLean, thighL, thighR, hipV },
      charts: [
        [mPx ? "Hip speed" : "Hip speed (heights a second)", mPx ? "m/s" : "ht/s", mPx ? hipV.map((v) => (v == null ? null : v * Hpx * mPx)) : hipV, "#8ac926"],
        ["Trunk lean forward", "°", trunkLean, "#e0b03a"],
        ["Thigh angle", "°", thighL, "#3fa7ff", { ys: thighR, color: "#ff4d5e", label: "right (left in blue)" }],
      ],
      tables: [
        steps.length ? {
          title: "Every step",
          cols: ["#", "Foot", "Contact", "Flight", "Step length", "Speed", "Shin at touchdown", "Foot ahead of hips", "Trunk lean"],
          rows: steps.map((s, k) => [k + 1, s.foot === "L" ? "Left" : "Right", s.contactMs == null ? null : `${s.contactMs} ms`, s.flightMs == null ? null : `${s.flightMs} ms`, lenText(s.len), s.speed == null ? null : `${s.speed.toFixed(1)} m/s (${mph(s.speed).toFixed(1)} mph)`, `${Math.round(s.shin)}°`, mPx ? `${Math.round(inches(s.ahead * Hpx * mPx))} in` : `${Math.round(s.ahead * 100)}% ht`, `${Math.round(s.trunk)}°`]),
        } : null,
        splits.length ? {
          title: "Distance splits",
          cols: ["Distance", "Time from first move", "Speed there"],
          rows: splits.map((s) => [`${s.d} m (${(s.d / 0.9144).toFixed(1)} yd)`, `${(s.ms / 1000).toFixed(2)} s`, s.v == null ? null : `${s.v.toFixed(1)} m/s (${mph(s.v).toFixed(1)} mph)`]),
        } : null,
      ].filter(Boolean),
      hint: `${START_NAMES[start || "maxv"]}. ${steps.length < 2 ? "Fewer than two ground contacts were found: check that his feet stay in the picture and the camera doesn't move. " : ""}Contact and flight times are only as fine as the frames: at 240 fps each frame is 4 ms. ${mPx ? "" : "Enter his height for speed in m/s and lengths in feet and inches. "}Joint angles from video are good to about 5 to 10 degrees.${fvNote}`,
    };
  }

  // ---- jumping ---------------------------------------------------------------------------------------------------------
  // The moments: the start (standing, before the hips drop), the bottom of the countermovement, takeoff (the jumping
  // foot or feet off the ground), the peak (hips highest) and landing. Height from flight time: h = g·t² / 8.
  function analyzeJump({ side, heightIn, captureFps, sideScale, events: manual, edits, variant, weightKg }) {
    const A = prepare(side, sideScale, captureFps, edits), { n, tReal, dt, sig, pts, wpts, fr, Hpx, perSec } = A;
    const m = manual || {}, kindOf = variant || "cmj", single = kindOf === "slL" ? "L" : kindOf === "slR" ? "R" : null, broad = kindOf === "broad";
    const LEGS = { L: [P.lHip, P.lKn, P.lAn, P.lHeel, P.lToe], R: [P.rHip, P.rKn, P.rAn, P.rHeel, P.rToe] };
    const legs = single ? [LEGS[single]] : [LEGS.L, LEGS.R];
    const hips = pts.map(hipOf), hipY = hips.map((h) => h[1]);
    const mPx = heightIn ? (heightIn * 0.0254) / Hpx : null;
    const low = (q) => Math.min(...legs.map((l) => Math.max(q[l[3]][1], q[l[4]][1]))); // the jumping foot (or the higher of two) at its lowest point
    const lowY = pts.map(low);
    const early = lowY.slice(0, Math.max(3, Math.round(n * 0.2))).slice().sort((a, b) => a - b);
    const groundY = early[early.length >> 1];
    // takeoff to landing: the longest stretch with the jumping foot or feet off the ground
    const air = lowY.map((y) => y < groundY - 0.03 * Hpx);
    let best = null;
    for (let i = 0; i < n;) { if (!air[i]) { i++; continue; } let j = i; while (j + 1 < n && air[j + 1]) j++; if (!best || j - i > best[1] - best[0]) best = [i, j]; i = j + 1; }
    // (that stretch needs the foot well up to be sure of; its ends are then taken out to where the foot first leaves and
    // last touches the ground)
    if (best) {
      const off = (i) => lowY[i] < groundY - 0.006 * Hpx;
      while (best[0] > 0 && off(best[0] - 1)) best[0]--;
      while (best[1] < n - 1 && off(best[1] + 1)) best[1]++;
    }
    const TO = m.TO != null ? m.TO : best ? best[0] : Math.round(n * 0.5);
    const LA = m.LA != null ? m.LA : best ? Math.min(n - 1, best[1] + 1) : Math.round(n * 0.7);
    const PK = m.PK != null ? m.PK : argBest(hipY, TO, LA, (a, b) => a < b);
    const LO = m.LO != null ? m.LO : argBest(hipY, Math.max(0, TO - fr(1.5)), TO, (a, b) => a > b);
    const standY = (() => { const s = hipY.slice(0, Math.max(3, Math.min(LO, Math.round(n * 0.15)))).slice().sort((a, b) => a - b); return s[s.length >> 1]; })();
    let ST = m.ST != null ? m.ST : 0;
    if (m.ST == null) for (let i = LO; i >= 0; i--) if (hipY[i] <= standY + 0.015 * Hpx) { ST = i; break; }
    const dir = broad ? (Math.sign(hips[LA][0] - hips[TO][0]) || 1) : (Math.sign(pts[LO][legs[0][4]][0] - pts[LO][legs[0][3]][0]) || 1); // the way he jumps, or faces
    const flight = tReal[LA] - tReal[TO];
    const heightM = flight > 0 ? (9.81 * flight * flight) / 8 : null;
    const ms = (i, j) => Math.round((tReal[j] - tReal[i]) * 1000);
    const kneeFlex = pts.map((q) => mean(legs.map((l) => flexAt(q, l[0], l[1], l[2]))));
    const hipFlex = pts.map((q) => mean(legs.map((l) => flexAt(q, l[0] === P.lHip ? P.lSh : P.rSh, l[0], l[1])))); // trunk to thigh, each side
    const trunkLean = pts.map((q) => leanOf(hipOf(q), shOf(q), dir));
    const shin = pts.map((q) => mean(legs.map((l) => leanOf(q[l[2]], q[l[1]], dir))));
    const depthPx = hipY[LO] - standY;
    const hipVy = smoothSeries(deriv(hipY, dt).map((v) => (v == null ? null : -v / Hpx)), sig * 2); // heights a second, + up
    const landKnee = Math.max(...kneeFlex.slice(LA, Math.min(n, LA + fr(0.3))).filter((x) => x != null));
    let distance = null, angle = null;
    if (broad) {
      const toeAt = (i) => Math.max(...legs.map((l) => dir * pts[i][l[4]][0])), heelAt = (i) => Math.min(...legs.map((l) => dir * pts[i][l[3]][0]));
      distance = mPx ? (heelAt(LA) - toeAt(TO)) * mPx : null;
      const vx = deriv(hips.map((h) => h[0]), dt), vy = deriv(hipY, dt);
      angle = deg(Math.atan2(-(vy[TO] || 0), dir * (vx[TO] || 0)));
    }
    const name = single ? `Single-leg (${single === "L" ? "left" : "right"})` : broad ? "Broad jump" : "Countermovement jump";
    const metrics = [
      metric("height", "Jump height (from flight time)", heightM == null ? null : r1(inches(heightM)), "in", "", "From the time in the air: g × t² ÷ 8. Exact only if he lands as he took off (no tucked legs)."),
      metric("heightCm", "Jump height", heightM == null ? null : r1(heightM * 100), "cm", "", ""),
      metric("flight", "Flight time", ms(TO, LA), "ms", "", "Takeoff to landing."),
      broad ? metric("distance", "Distance", distance == null ? null : r1(inches(distance)), "in", "", "Front toe at takeoff to the back heel on landing.") : null,
      broad ? metric("distanceFt", "Distance", ftIn(distance), "", "", "") : null,
      broad ? metric("angle", "Takeoff angle", r1(angle), "° above level", "", "The hips' direction of travel at takeoff.") : null,
      metric("depth", "Countermovement depth", mPx ? r1(inches(depthPx * mPx)) : r1((depthPx / Hpx) * 100), mPx ? "in" : "% of height", "", "How far the hips drop from standing to the bottom."),
      metric("ttt", "Time to takeoff", ms(ST, TO), "ms", "", "From the hips starting down to leaving the ground."),
      metric("ecc", "Down phase", ms(ST, LO), "ms", "", "Start to the bottom of the countermovement."),
      metric("con", "Up phase", ms(LO, TO), "ms", "", "The bottom to takeoff."),
      !broad && heightM != null ? metric("rsi", "RSI-modified", Math.round((heightM / Math.max(0.05, tReal[TO] - tReal[ST])) * 100) / 100, "", "", "Jump height (m) ÷ time to takeoff (s): how much jump for how much time.") : null,
      metric("kneeLO", "Knee flexion at the bottom", r1(kneeFlex[LO]), "°", "", ""),
      metric("hipLO", "Hip flexion at the bottom", r1(hipFlex[LO]), "°", "", "Trunk to thigh."),
      metric("trunkLO", "Trunk lean at the bottom", r1(trunkLean[LO]), "° forward", "", ""),
      metric("shinLO", "Shin angle at the bottom", r1(shin[LO]), "° forward", "", "The shin's lean from vertical: + the knee ahead of the ankle."),
      metric("kneeTO", "Knee flexion at takeoff", r1(kneeFlex[TO]), "°", "", "Close to 0 is a full extension."),
      metric("landKnee", "Knee flexion on landing", Number.isFinite(landKnee) ? r1(landKnee) : null, "°", "", "The most the knee bends in the first 0.3 s after landing."),
    ].filter(Boolean);
    // inferred: takeoff speed (from the height, or a broad jump's distance and flight), power and force. Peak power by
    // Sayers' equation (from jump height and body mass, for a two-leg countermovement jump); the up phase's average
    // force from getting his mass from a stop to takeoff speed in its time, F = m(g + v/t), and its average power F·v/2;
    // peak takeoff and landing forces from his center of mass
    const conT = Math.max(0.05, tReal[TO] - tReal[LO]);
    const vTo = broad ? (flight > 0 && distance != null ? Math.hypot(distance / flight, (9.81 * flight) / 2) : null) : heightM != null ? Math.sqrt(2 * 9.81 * heightM) : null;
    const kg = weightKg || null;
    const meanF = vTo != null ? 1 + vTo / (9.81 * conT) : null; // body weights
    metrics.push(...[
      metric("vTO", "Takeoff velocity (estimate)", vTo == null ? null : Math.round(vTo * 100) / 100, "m/s", "", broad ? "From the distance and time in the air." : "From the jump height: √(2 g h)."),
      !broad && !single && heightM != null && kg ? metric("power", "Peak power (Sayers, estimate)", Math.round(60.7 * heightM * 100 + 45.3 * kg - 2055), "W", "", "60.7 × jump height (cm) + 45.3 × body mass (kg) − 2055.") : null,
      !broad && !single && heightM != null && kg ? metric("powerKg", "Peak power per kg (estimate)", r1((60.7 * heightM * 100 + 45.3 * kg - 2055) / kg), "W/kg", "", "") : null,
      metric("forceUp", "Average force, up phase (estimate)", meanF == null ? null : Math.round(meanF * 100) / 100, "× body weight", "", "Getting him from the bottom to takeoff speed in the up phase's time: F = m(g + v ÷ t)."),
      kg && meanF != null ? metric("forceUpN", "Average force, up phase (estimate)", Math.round(meanF * kg * 9.81), "N", "", "") : null,
      kg && meanF != null && vTo != null ? metric("powerUp", "Average power, up phase (estimate)", Math.round((meanF * kg * 9.81 * vTo) / 2), "W", "", "That force times his average speed through the up phase (half the takeoff speed).") : null,
      ...M.lib.forceMetrics(M.lib.groundForce({ pts, dt, sig, dir: 1, mPerPx: mPx }), weightKg, [
        ["grfTO", "Peak vertical force before takeoff", "vert", LO, TO, "max", "From his center of mass, the bottom to takeoff."],
        ["grfLand", "Peak landing force", "vert", LA, Math.min(n - 1, LA + fr(0.3)), "max", "From his center of mass, in the first 0.3 s after landing: higher is a stiffer, louder landing."],
      ]),
    ].filter(Boolean));
    return {
      n, tReal, dir, Hpx, pts, wpts, wLegs: A.wLegs,
      events: { ST, LO, TO, PK, LA }, evLabels: { ST: "Start", LO: "Bottom", TO: "Takeoff", PK: "Peak", LA: "Landing" },
      phaseKeys: ["LO", "TO", "PK", "LA"], zeroKey: "TO", groundKey: "LO",
      metrics: metrics.filter(Boolean),
      series: { kneeFlex, hipFlex, trunkLean, hipVy },
      charts: [
        [mPx ? "Hip height above standing" : "Hip height above standing (% of height)", mPx ? "in" : "%", hipY.map((y) => (mPx ? inches((standY - y) * mPx) : ((standY - y) / Hpx) * 100)), "#8ac926"],
        ["Knee flexion", "°", kneeFlex, "#3fa7ff", { ys: hipFlex, color: "#ff9f1c", label: "hip (knee in blue)" }],
        [mPx ? "Hip vertical speed" : "Hip vertical speed (heights a second)", mPx ? "m/s" : "ht/s", mPx ? hipVy.map((v) => (v == null ? null : v * Hpx * mPx)) : hipVy, "#c77dff"],
      ],
      hint: `${name}. ${best ? "" : "No time in the air was found: check that his feet are in the picture throughout. "}${perSec < 100 ? `This clip runs ${Math.round(perSec)} frames a second, so flight time (and the jump height from it) can be off by a frame: film in Slo-Mo for a sharper number. ` : ""}${mPx ? "" : "Enter his height for depth and distance in inches. "}Joint angles from video are good to about 5 to 10 degrees.`,
    };
  }

  // ---- a jump beside the force plate --------------------------------------------------------------------------------------
  // His force plate jump (Hawkin) of the same kind closest in date to the video's: the numbers both measure side by side,
  // so the video's estimates can be checked against the plate (and the plate's jump seen as a movement).
  const FP_KIND = { cmj: /counter ?movement|\bcmj\b/i, broad: /broad/i, slL: /single/i, slR: /single/i };
  function relateForcePlate(R, tests, { date, variant }) {
    const re = FP_KIND[variant || "cmj"];
    const list = (tests || []).filter((t) => t.date && re && re.test(t.testType || "") && !(variant === "cmj" && /single|rebound/i.test(t.testType || "")));
    if (!list.length) return [];
    const day = (d) => new Date(`${d}T12:00:00`).getTime();
    const t = list.reduce((b, x) => (Math.abs(day(x.date) - day(date)) < Math.abs(day(b.date) - day(date)) ? x : b), list[0]);
    const val = (k) => { const m = R.metrics.find((x) => x.key === k); return m && typeof m.value === "number" ? m.value : null; };
    const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    const depthIn = R.metrics.find((x) => x.key === "depth" && x.unit === "in") ? val("depth") : null;
    const rows = [
      ["Jump height", val("height"), num(t.jumpHeight), "in", 1],
      ["Countermovement depth", depthIn, num(t.countermovementDepth) == null ? null : Math.abs(t.countermovementDepth), "in", 1],
      ["Takeoff velocity", val("vTO"), num(t.takeoffVelocity), "m/s", 2],
      ["Peak power", val("power"), num(t.peakPower), "W", 0],
      ["Peak power per kg", val("powerKg"), num(t.relativePeakPower), "W/kg", 1],
      ["RSI-modified", val("rsi"), num(t.rsiModified), "", 2],
    ].filter((r) => r[1] != null || r[2] != null);
    const f = (v, dp) => (v == null ? null : v.toFixed(dp));
    const days = Math.round(Math.abs(day(t.date) - day(date)) / 86400000);
    return [{
      title: `Beside the force plate: ${t.testType || "jump"}, ${t.date}${days ? ` (${days} day${days === 1 ? "" : "s"} ${day(t.date) < day(date) ? "before" : "after"})` : " (same day)"}`,
      cols: ["", "Video (estimate)", "Force plate", "Difference"],
      rows: rows.map(([label, v, p, unit, dp]) => [label, v == null ? null : `${f(v, dp)} ${unit}`.trim(), p == null ? null : `${f(p, dp)} ${unit}`.trim(), v == null || p == null ? null : `${v - p >= 0 ? "+" : ""}${f(v - p, dp)}`]),
    }];
  }

  // ---- the movements, added to motion capture --------------------------------------------------------------------------
  Object.assign(M.kinds, {
    hitting: {
      label: "Hitting", hand: { label: "Bats", key: "bats" },
      setups: [["one", "One camera (open side)"], ["edger", "Edgertronic (open side)"], ["two", "Two cameras (open side + behind)"]],
      howTo: [
        ["Slow motion, 240 fps", "Slo-Mo at 240 fps (Settings › Camera › Record Slo-mo); 120 is all right. A swing is over in a fifth of a second: normal video blurs the hands."],
        ...TIPS_COMMON.slice(0, 2),
        ["Open side camera", "Facing his chest from across the plate (the other batter's box side), square to the line to the pitcher, 15 to 25 feet away, aimed at the plate."],
        ["Behind camera (two-camera setup)", "Directly behind the catcher on the line to the pitcher, the same height, 15 to 25 feet back. Start both before he gets in his stance; they're lined up afterward at contact."],
        ["Whole body, one swing", "His whole body in frame from his stance through the finish, feet included. One swing per clip, from just before the load to after the finish."],
        ...TIPS_COMMON.slice(2),
      ],
      sideLabel: "Open side video", sideHint: "Facing his chest from across the plate, square to the line to the pitcher",
      edgerHint: "From the open side, facing his chest, with his whole body in frame",
      behindHint: "Behind the catcher, on the line to the pitcher",
      trimHint: "Trim to the swing: from his stance just before the load to just after the finish.",
      heightHint: "Height is needed for hand speed and head movement in inches. \"Recorded at\" sets the timing: choose the slow-motion speed it was filmed at if the file plays it slowed down.",
      analyzeLabel: "Analyze the swing",
      analyze: analyzeHitting,
      historyKeys: ["stride", "fpc", "sepMax", "trunkV", "headX", "batV", "grfV"],
    },
    sprint: {
      label: "Sprint", hand: null, setups: SETUPS_SIDE,
      variants: { label: "Start", options: [["linear", "Linear start"], ["steal", "Base-stealing start"], ["forty", "40-yard start (three-point)"], ["maxv", "Max velocity (fly)"]] },
      howTo: [
        ["Slow motion, 240 fps", "Slo-Mo at 240 fps: a foot is on the ground for only a tenth of a second at top speed, so each frame (4 ms) counts."],
        ...TIPS_COMMON.slice(0, 2),
        ["Side on, wide", "Square to the lane, far enough back (30 to 50 feet) that two or three full steps cross the picture. The camera stays still: don't follow him."],
        ["Where to film", "Linear and 40-yard starts: the camera level with the start line, covering the start and the first 5 yards. Base-stealing: square to the base path at his lead, wide enough for his first three steps toward the base. Max velocity: a fly sprint, the camera on the 30 to 40 yard mark."],
        ["Feet in the picture", "His feet in frame the whole way across, with a plain floor or ground (contacts are found from where his feet are lowest and still)."],
        ...TIPS_COMMON.slice(2),
      ],
      sideLabel: "Side video", sideHint: "Side on to the lane, the camera still, two or three steps crossing the picture",
      edgerHint: "Side on to the lane, wide enough for two or three steps",
      trimHint: "Trim to the steps that cross the picture.",
      heightHint: "Height turns the picture into real speed (m/s, mph) and step length in feet. \"Recorded at\" sets the timing: choose the slow-motion speed it was filmed at.",
      analyzeLabel: "Analyze the sprint",
      analyze: analyzeSprint,
      historyKeys: ["ttd1", "t2m", "t10yd", "t2b", "vmaxMph", "F0", "stepLen", "contact"],
    },
    jump: {
      label: "Jump", hand: null, setups: SETUPS_SIDE,
      variants: { label: "Jump", options: [["cmj", "Countermovement jump"], ["broad", "Broad jump"], ["slL", "Single-leg, left"], ["slR", "Single-leg, right"]] },
      howTo: [
        ["Slow motion, 240 fps", "Slo-Mo at 240 fps: jump height comes from the time in the air, and at 240 fps it's timed to 4 ms (at normal speed, 33 ms, an inch or more of height)."],
        ...TIPS_COMMON.slice(0, 2),
        ["Side on", "Square to him, 10 to 15 feet away, his whole body and feet in frame with room above for the jump. For a broad jump, back far enough to see the takeoff and the landing."],
        ["Start still, land and hold", "Stand still for a second before the jump, then land and hold. Hands as you cue them (on hips or free), the same every time."],
        ["Single-leg", "The jumping leg on the camera's side."],
        ...TIPS_COMMON.slice(2),
      ],
      sideLabel: "Side video", sideHint: "Side on, his whole body and feet in frame, room above",
      edgerHint: "Side on, his whole body and feet in frame, room above",
      trimHint: "Trim to the jump: from standing still before it to after he lands and holds.",
      heightHint: "Height turns the picture into inches for depth and distance (jump height comes from flight time and needs no height). \"Recorded at\" sets the timing: choose the slow-motion speed it was filmed at.",
      analyzeLabel: "Analyze the jump",
      analyze: analyzeJump,
      relate: relateForcePlate,
      historyKeys: ["height", "distance", "power", "forceUp", "depth", "ttt", "rsi"],
    },
  });
})();
