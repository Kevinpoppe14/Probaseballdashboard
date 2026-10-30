// Motion capture's movement screen: the biomechanical assessment's tests that video can measure (assessment.js), one
// clip each, filmed square to the movement. The overhead squat from the front (knee valgus, weight shift, depth) and
// the side (trunk and shin, arms, head, heels), and range of motion through each test, its end of range found as the
// frame where the angle is greatest (or least, or for a held position, where it's held), which "End range here" can
// move. Each result says what it fills in on the assessment (`assessment`: entries for its isolated ROM, a movement
// test's pass or fail and notes, or the overhead squat checklist), and Send to assessment puts them there.
// Loaded after mocap.js and mocap_kinds.js; adds window.MoCap.kinds.screen.
(function () {
  const M = window.MoCap;
  if (!M || !M.lib) return;
  const { P, mid, angleAt, smoothSeries, argBest, r1, deg, wrapDeg, prepare } = M.lib;
  const metric = (key, label, value, unit, range, note) => ({ key, label, value: typeof value === "number" && !Number.isFinite(value) ? null : value, unit, range: range || "", note: note || "" });
  const hipOf = (q) => mid(q[P.lHip], q[P.rHip]);
  const leanOf = (lo, hi, dir) => deg(Math.atan2(dir * (hi[0] - lo[0]), lo[1] - hi[1])); // from straight up, + toward dir
  const vecAng = (a, b, c, d) => { const u = [b[0] - a[0], b[1] - a[1]], v = [d[0] - c[0], d[1] - c[1]], l = Math.hypot(...u) * Math.hypot(...v); return l ? deg(Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1]) / l)))) : null; };
  const SIDES = {
    L: { hip: P.lHip, kn: P.lKn, an: P.lAn, heel: P.lHeel, toe: P.lToe, sh: P.lSh, el: P.lEl, wr: P.lWr, ear: 7 },
    R: { hip: P.rHip, kn: P.rKn, an: P.rAn, heel: P.rHeel, toe: P.rToe, sh: P.rSh, el: P.rEl, wr: P.rWr, ear: 8 },
  };
  const finite = (xs) => xs.filter((x) => x != null && Number.isFinite(x));
  // hip rotation: the shin's angle from straight down (seated) or up (prone), + the foot moving out (the hip turning in)
  const hipRot = (q, L, shank) => { const lat = Math.sign(q[L.kn][0] - hipOf(q)[0]) || 1; return deg(Math.atan2(lat * (q[L.an][0] - q[L.kn][0]), shank === "down" ? q[L.an][1] - q[L.kn][1] : q[L.kn][1] - q[L.an][1])); };
  const hipRotTest = (name, view, shank, fill) => ({
    name, view, best: "max",
    angle: (q, c) => Math.abs(hipRot(q, SIDES[c.side], shank)),
    read: (q, c) => {
      const a = finite(c.pts.map((p) => hipRot(p, SIDES[c.side], shank))), ir = Math.max(...a), er = -Math.min(...a);
      return { metrics: [metric("ir", "Hip IR", r1(ir), "°", "40+", "The foot rotated out (the hip turning in)."), metric("er", "Hip ER", r1(er), "°", "50+", "The foot rotated in (the hip turning out).")],
        entries: [{ section: "isolatedSpecific", key: fill[0], side: c.sideWord, value: `${Math.round(ir)}°` }, { section: "isolatedSpecific", key: fill[1], side: c.sideWord, value: `${Math.round(er)}°` }] };
    },
  });

  // each test: its name, how to film it, which end of its angle is the end of range ("max", "min", or "hold" for a
  // position held at the end of the clip), and its numbers and assessment entries there (c: the side and the clip)
  const SCREEN = {
    ohsFront: { name: "Overhead squat (front)", view: "Facing him, square, his whole body in frame", both: true, best: "max",
      angle: (q) => hipOf(q)[1],
      read: (q) => {
        const midX = hipOf(q)[0], metrics = [], entries = [];
        ["L", "R"].forEach((s) => {
          const L = SIDES[s], hip = q[L.hip], kn = q[L.kn], an = q[L.an], side = s === "L" ? "left" : "right";
          const lineX = hip[0] + ((an[0] - hip[0]) * (kn[1] - hip[1])) / ((an[1] - hip[1]) || 1);
          const inward = (kn[0] - lineX) * Math.sign(midX - hip[0]) > 0, bend = 180 - (angleAt(hip, kn, an) || 180);
          const valgus = r1(inward ? bend : -bend);
          metrics.push(metric(`valgus${s}`, `Knee valgus at the bottom, ${side}`, valgus, "°", "0–10", "The knee caving in past the line from hip to ankle (negative: bowing out)."));
          if (valgus != null && valgus > 10) entries.push({ section: "squat", path: ["knee", "adduction"], side, check: true });
        });
        const feetX = (q[P.lAn][0] + q[P.rAn][0]) / 2, width = Math.abs(q[P.lAn][0] - q[P.rAn][0]) || 1;
        const shift = ((midX - feetX) / width) * 100, toLeft = Math.sign(midX - feetX) === Math.sign(q[P.lHip][0] - q[P.rHip][0]);
        metrics.push(metric("shift", `Hips shifted to the ${toLeft ? "left" : "right"}`, r1(Math.abs(shift)), "% of stance", "0–10", "How far the hips sit off the middle of the feet at the bottom."));
        if (Math.abs(shift) > 10) entries.push({ section: "squat", path: ["pelvis", "frontalPlaneWeightShift"], side: toLeft ? "left" : "right", check: true });
        metrics.push(metric("depth", "Hips below the knees", hipOf(q)[1] > (q[P.lKn][1] + q[P.rKn][1]) / 2 ? "Yes" : "No", "", "", "At the bottom."));
        return { metrics, entries };
      } },
    ohsSide: { name: "Overhead squat (side)", view: "Side on, his whole body and his hands overhead in frame", both: true, best: "max",
      angle: (q) => hipOf(q)[1],
      read: (q, c) => {
        const L = SIDES[c.side], dir = Math.sign(q[L.toe][0] - q[L.heel][0]) || 1, entries = [];
        const trunk = leanOf(q[L.hip], q[L.sh], dir), shin = leanOf(q[L.an], q[L.kn], dir);
        const arms = deg(Math.atan2(dir * (q[L.wr][0] - q[L.sh][0]), q[L.sh][1] - q[L.wr][1]));
        const head = ((q[L.ear][0] - q[L.sh][0]) * dir / c.Hpx) * 100, heel = ((c.pts[0][L.heel][1] - q[L.heel][1]) / c.Hpx) * 100;
        if (arms > 15) entries.push({ section: "squat", path: ["upperBody", "barDriftForward"], check: true });
        if (head > 4) entries.push({ section: "squat", path: ["upperBody", "forwardHead"], check: true });
        return { entries, metrics: [
          metric("thigh", "Thigh below level at the bottom", r1(deg(Math.atan2(q[L.hip][1] - q[L.kn][1], Math.abs(q[L.kn][0] - q[L.hip][0])))), "°", "", "+ the hip crease below the knee."),
          metric("trunk", "Trunk lean forward", r1(trunk), "°", "", ""),
          metric("shin", "Shin lean forward", r1(shin), "°", "", "Trunk and shin about parallel is the goal."),
          metric("trunkShin", "Trunk lean past the shin", r1(trunk - shin), "°", "0–15", "More: the chest falls forward."),
          metric("arms", "Arms forward of vertical", r1(arms), "°", "0–15", "The arms falling forward of straight overhead."),
          metric("head", "Head forward of the shoulders", r1(head), "% of height", "0–4", "The ear ahead of the shoulder."),
          metric("heel", "Heel rise", r1(heel), "% of height", "0–1", "The heel lifting off the floor at the bottom."),
        ] };
      } },
    aslr: { name: "Active straight leg raise", view: "Side on, lying on his back, the raised leg nearest the camera", best: "max",
      angle: (q, c) => vecAng(q[SIDES[c.side].hip], q[SIDES[c.side].an], q[SIDES[c.other].hip], q[SIDES[c.other].an]),
      read: (q, c, v) => ({ metrics: [metric("aslr", "Active straight leg raise", r1(v), "°", "70+", "The raised leg's angle from the leg on the floor.")],
        entries: [{ section: "movementTests", key: "activeStraightLegRaise", side: c.sideWord, pass: v >= 70, note: `${Math.round(v)}°` }] }) },
    pslr: { name: "Passive straight leg raise", view: "Side on, lying on his back, the lifted leg nearest the camera", best: "max",
      angle: (q, c) => vecAng(q[SIDES[c.side].hip], q[SIDES[c.side].an], q[SIDES[c.other].hip], q[SIDES[c.other].an]),
      read: (q, c, v) => ({ metrics: [metric("pslr", "Passive straight leg raise", r1(v), "°", "", "The lifted leg's angle from the leg on the floor.")],
        entries: [{ section: "isolatedSpecific", key: "hamstringLengthPslr", side: c.sideWord, value: `${Math.round(v)}°` }] }) },
    ham9090: { name: "Hamstring 90/90", view: "Side on, lying on his back, the hip held at 90°, the tested leg nearest the camera", best: "min",
      angle: (q, c) => { const L = SIDES[c.side], a = angleAt(q[L.hip], q[L.kn], q[L.an]); return a == null ? null : 180 - a; },
      read: (q, c, v) => ({ metrics: [metric("ham", "Knee short of straight at 90/90", r1(v), "°", "0–20", "How bent the knee stays at its straightest.")],
        entries: [{ section: "isolatedSpecific", key: "hamstringLength9090", side: c.sideWord, value: `${Math.round(v)}°` }] }) },
    shFlex: { name: "Shoulder flexion", view: "Side on, seated or standing tall, the tested arm nearest the camera", best: "max",
      angle: (q, c) => { const L = SIDES[c.side]; return vecAng(q[L.sh], q[L.el], q[L.sh], q[L.hip]); },
      read: (q, c, v) => ({ metrics: [metric("shFlex", "Shoulder flexion", r1(v), "°", "170+", "The upper arm's angle from the trunk, reaching overhead.")],
        entries: [{ section: "isolatedSpecific", key: "shoulderFlexRom", side: c.sideWord, value: `${Math.round(v)}°` }] }) },
    shRot: { name: "Shoulder ER and IR (90/90, on his back)", view: "Square to the forearm's swing (from his head or feet end, level with the arm); rotate back (ER) and forward (IR)", best: "max",
      angle: (q, c) => { const L = SIDES[c.side], toHead = Math.sign(q[P.nose][0] - q[L.sh][0]) || 1; return Math.abs(deg(Math.atan2(toHead * (q[L.wr][0] - q[L.el][0]), q[L.el][1] - q[L.wr][1]))); },
      read: (q, c) => {
        const L = SIDES[c.side], toHead = Math.sign(q[P.nose][0] - q[L.sh][0]) || 1;
        const a = finite(c.pts.map((p) => deg(Math.atan2(toHead * (p[L.wr][0] - p[L.el][0]), p[L.el][1] - p[L.wr][1])))), er = Math.max(...a), ir = -Math.min(...a);
        return { metrics: [metric("er", "Shoulder ER", r1(er), "°", "90+", "The forearm back toward the head from vertical."), metric("ir", "Shoulder IR", r1(ir), "°", "45+", "The forearm forward toward the feet from vertical."), metric("arc", "Total arc", r1(er + ir), "°", "160–190", "ER plus IR; compare sides.")],
          entries: [{ section: "isolatedSpecific", key: "shoulderErRom", side: c.sideWord, value: `${Math.round(er)}°` }, { section: "isolatedSpecific", key: "shoulderIrRom", side: c.sideWord, value: `${Math.round(ir)}°` }] };
      } },
    elbow: { name: "Elbow extension and flexion", view: "Side on to the arm; straighten it fully, then bend it fully", best: "max",
      angle: (q, c) => { const L = SIDES[c.side]; return angleAt(q[L.sh], q[L.el], q[L.wr]); },
      read: (q, c) => {
        const L = SIDES[c.side], a = finite(c.pts.map((p) => angleAt(p[L.sh], p[L.el], p[L.wr]))), ext = 180 - Math.max(...a), flex = 180 - Math.min(...a);
        return { metrics: [metric("ext", "Elbow short of straight", r1(ext), "°", "0–8", "Negative: it goes past straight."), metric("flex", "Elbow flexion", r1(flex), "°", "130+", "Bent as far as it goes.")],
          entries: [{ section: "isolatedSpecific", key: "elbowExtRom", side: c.sideWord, value: `${Math.round(ext)}°` }, { section: "isolatedSpecific", key: "elbowFlexRom", side: c.sideWord, value: `${Math.round(flex)}°` }] };
      } },
    hipRotSeated: hipRotTest("Hip IR and ER (seated, hip at 90°)", "Facing his shin from the front; rotate the foot out (IR), then in (ER)", "down", ["hipIrSupine", "hipErSupine"]),
    hipRotProne: hipRotTest("Hip IR and ER (prone, knee at 90°)", "From his feet, looking up the table; the shin rotates out (IR), then in (ER)", "up", ["hipIrProne", "hipErProne"]),
    thomas: { name: "Modified Thomas test", view: "Side on, lying back off the end of the table, the hanging leg nearest the camera; hold the end position", best: "hold",
      angle: (q, c) => { const L = SIDES[c.side]; return deg(Math.atan2(q[L.kn][1] - q[L.hip][1], Math.abs(q[L.kn][0] - q[L.hip][0]))); },
      read: (q, c, v) => {
        const L = SIDES[c.side], knee = 180 - (angleAt(q[L.hip], q[L.kn], q[L.an]) || 180), pass = v >= 0 && knee >= 80;
        return { metrics: [metric("thigh", "Thigh below level", r1(v), "°", "0+", "Negative: the thigh stays up (tight hip flexors)."), metric("knee", "Knee flexion", r1(knee), "°", "80+", "Less: a tight rectus femoris.")],
          entries: [{ section: "movementTests", key: "modifiedThomasTest", side: c.sideWord, pass, note: `thigh ${Math.round(v)}°, knee ${Math.round(knee)}°` }] };
      } },
    proneHipExt: { name: "Prone hip extension", view: "Side on, lying face down, the tested leg nearest the camera", best: "max",
      angle: (q, c) => { const L = SIDES[c.side]; return deg(Math.atan2(q[L.hip][1] - q[L.kn][1], Math.abs(q[L.kn][0] - q[L.hip][0]))); },
      read: (q, c, v) => ({ metrics: [metric("hipExt", "Hip extension", r1(v), "°", "10+", "The thigh lifted above the table.")],
        entries: [{ section: "movementTests", key: "proneHipExtension", side: c.sideWord, pass: v >= 10, note: `${Math.round(v)}°` }] }) },
    ankleDF: { name: "Ankle dorsiflexion (knee to wall)", view: "Side on, half kneeling, the front ankle nearest the camera, heel down", best: "max",
      angle: (q, c) => { const L = SIDES[c.side], dir = Math.sign(q[L.toe][0] - q[L.heel][0]) || 1; return leanOf(q[L.an], q[L.kn], dir); },
      read: (q, c, v) => ({ metrics: [metric("df", "Shin angle forward", r1(v), "°", "35+", "The shin's lean past vertical with the heel down: about 35° is the knee 4 inches past the toes.")],
        entries: [{ section: "isolatedSpecific", key: "ankleDorsiflexion", side: c.sideWord, value: `${Math.round(v)}°` }] }) },
    slBalance: { name: "Single-leg balance", view: "Facing him, his whole body in frame, 10 seconds on the tested leg", best: "hold",
      angle: (q) => hipOf(q)[0],
      read: (q, c) => {
        const other = SIDES[c.other], ground = Math.max(...c.pts.slice(0, 5).map((p) => p[SIDES[c.side].an][1]));
        const up = c.pts.findIndex((p) => p[other.an][1] < ground - 0.03 * c.Hpx);
        const back = up < 0 ? -1 : c.pts.slice(up).findIndex((p) => p[other.an][1] >= ground - 0.01 * c.Hpx);
        const secs = up < 0 ? 0 : back < 0 ? c.tReal[c.n - 1] - c.tReal[up] : c.tReal[up + back] - c.tReal[up];
        const xs = c.pts.slice(Math.max(0, up)).map((p) => hipOf(p)[0]), sway = c.mPx ? (Math.max(...xs) - Math.min(...xs)) * c.mPx * 100 : null;
        return { metrics: [metric("held", "Held on one leg", r1(secs), "s", "10+", "From the other foot lifting to it touching down (or the clip's end)."), metric("sway", "Side-to-side sway of the hips", r1(sway), "cm", "", "Less is steadier.")],
          entries: [{ section: "movementTests", key: "singleLegBalance", side: c.sideWord, pass: secs >= 10, note: `${Math.round(secs * 10) / 10} s${sway != null ? `, sway ${Math.round(sway)} cm` : ""}` }] };
      } },
    thoracic: { name: "Seated thoracic rotation (estimate)", view: "From behind, seated, arms crossed; turn to the tested side", best: "max",
      angle: (q, c, i) => { const w = c.wpts[i], yaw = (a, b) => deg(Math.atan2(w[b][2] - w[a][2], w[b][0] - w[a][0])); return Math.abs(wrapDeg(yaw(P.lSh, P.rSh) - yaw(P.lHip, P.rHip))); },
      read: (q, c, v) => ({ metrics: [metric("thor", "Thoracic rotation (estimate)", r1(v), "°", "45+", "The shoulders turned from the hips, from the pose model's 3D estimate.")],
        entries: [{ section: "movementTests", key: "seatedThoracicRotation", side: c.sideWord, pass: v >= 45, note: `${Math.round(v)}° (estimate)` }] }) },
  };

  function analyzeScreen({ side, throws, heightIn, captureFps, sideScale, events: manual, edits, variant }) {
    const A = prepare(side, sideScale, captureFps, edits), { n, tReal, pts, wpts, Hpx, sig } = A;
    const test = SCREEN[variant] || SCREEN.ohsFront, s = throws === "L" ? "L" : "R", m = manual || {};
    const c = { side: s, other: s === "L" ? "R" : "L", sideWord: s === "L" ? "left" : "right", pts, wpts, tReal, n, Hpx, mPx: heightIn ? (heightIn * 0.0254) / Hpx : null };
    const ang = smoothSeries(pts.map((q, i) => { const v = test.angle(q, c, i); return v == null || !Number.isFinite(v) ? null : v; }), sig * 2);
    // the end of range: the greatest (or least) angle, or for a held position the last third of the clip
    let END = m.END != null ? m.END : test.best === "hold" ? Math.round(n * 0.83) : argBest(ang, 0, n - 1, test.best === "min" ? (a, b) => a < b : (a, b) => a > b);
    if (END < 0) END = n - 1;
    const ST = m.ST != null ? m.ST : 0, MID = m.MID != null ? m.MID : Math.round((ST + END) / 2), FIN = m.FIN != null ? m.FIN : n - 1;
    const r = test.read(pts[END], c, ang[END]);
    const which = test.both ? "" : ` (${c.sideWord})`;
    return {
      n, tReal, dir: 1, Hpx, pts, wpts, wLegs: A.wLegs,
      events: { ST, MID, END, FIN }, evLabels: { ST: "Start", MID: "Halfway", END: "End range", FIN: "Clip end" },
      phaseKeys: ["ST", "MID", "END", "FIN"], zeroKey: "END", groundKey: "ST",
      metrics: r.metrics.filter(Boolean),
      series: { angle: ang },
      charts: ang.some((v) => v != null) ? [[variant === "slBalance" ? "Hips side to side" : `${test.name}${which}`, variant === "slBalance" || /ohs/.test(variant || "ohs") ? "px" : "°", ang, "#3fa7ff"]] : [],
      assessment: r.entries,
      hint: `${test.name}${which}. ${test.view}. ${test.best === "hold" ? "Measured where the position is held at the end of the clip" : `The end of range is the ${test.best === "min" ? "least" : "greatest"} angle in the clip`}: if it's on the wrong frame, step to the right one and press End range here. Angles from video are good to about 5 degrees with the camera square to the movement.`,
    };
  }

  M.kinds.screen = {
    label: "Movement Screen", hand: { label: "Side tested", key: "screenSide" },
    setups: [["one", "Phone"], ["edger", "Edgertronic"]],
    variants: { label: "Test", options: Object.entries(SCREEN).map(([k, t]) => [k, t.name]) },
    howTo: [
      ["One test per clip", "Pick the test, and the side for one-sided tests, then film it: the tool finds the end of range in the clip and measures it there."],
      ["Square to the movement", "The camera square to the plane the joint moves in (side on for a leg raise or shoulder flexion, facing him for the squat from the front), level with the joint, 8 to 12 feet away. Angles read off at an angle are wrong."],
      ["The tested side nearest", "For one-sided tests, the tested limb nearest the camera, nothing in front of it."],
      ["Steady, normal speed", "On a tripod; normal video is fine (these are slow). Move through the range and pause a beat at the end of it."],
      ["Fitted clothes", "Shorts and a fitted shirt so the hips, knees and shoulders can be found; no baggy clothes."],
    ],
    sideLabel: "Video", sideHint: "Square to the movement, the tested side nearest the camera",
    edgerHint: "Square to the movement",
    trimHint: "Trim to the test: from the start position through the end of range.",
    heightHint: "Height is only needed for balance sway in centimeters. Normal-speed video is fine for these tests.",
    analyzeLabel: "Measure it",
    analyze: analyzeScreen,
    historyKeys: ["valgusL", "valgusR", "trunkShin", "aslr", "pslr", "shFlex", "er", "ir", "df"],
  };
})();
