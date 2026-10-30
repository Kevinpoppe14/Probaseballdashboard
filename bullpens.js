// Bullpens — a pitcher's TrackMan bullpen sessions, under the Pitching tab of their profile. Each session comes in from
// the PDF TrackMan exports ("Pitching practice": stats by pitch type, then every pitch; read by trackman_import.js)
// and is kept in the assessments table as kind: "bullpen", so it needs no table of its own (see getBullpens in
// store.js). The tab shows velocity by pitch type across sessions, and for one session its pitch types, a movement
// plot and every pitch. The Pitching Assessment's own import (pitching_assessment.js) saves here too.
(function () {
  const { useState, useRef, useEffect } = React;

  const uid = () => `bp-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const fmtDate = (key) => { if (!key) return "No date"; const d = new Date(`${key}T00:00:00`); return isNaN(d) ? key : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); };
  const shortDate = (key) => { const d = new Date(`${key}T00:00:00`); return isNaN(d) ? key : `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`; };
  const nameKey = (s) => String(s || "").toLowerCase().replace(/[^a-z]/g, "");
  const r1 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10);
  const show = (v, unit) => (v == null ? "–" : `${v}${unit || ""}`);
  const deg = (v) => (v == null ? "–" : `${v.toFixed(1)}°`);
  const ftIn = (v) => { if (v == null) return "–"; const f = Math.floor(v), i = Math.round((v - f) * 12); return i === 12 ? `${f + 1}'` : `${f}'${i ? `${i}"` : ""}`; };

  // the usual order and colors (close to TrackMan's own) for pitch types, anything else after them in gray
  const TYPE_ORDER = ["Fastball", "Four-Seam", "Sinker", "Two-Seam", "Cutter", "Slider", "Sweeper", "Slurve", "Curveball", "Knuckle Curve", "ChangeUp", "Changeup", "Splitter", "Knuckleball"];
  const TYPE_COLORS = { fastball: "#a3122a", "four-seam": "#a3122a", sinker: "#f6863b", "two-seam": "#f6863b", cutter: "#8d5524", slider: "#e6c229", sweeper: "#b38f00", slurve: "#c77dff", curveball: "#3a86ff", "knuckle curve": "#3a86ff", changeup: "#6aa84f", splitter: "#2a9d8f", knuckleball: "#999999" };
  const colorOf = (t) => TYPE_COLORS[String(t || "").toLowerCase()] || "#8a8a8a";
  const typeRank = (t) => { if (t === "Untagged") return 100; const i = TYPE_ORDER.findIndex((x) => x.toLowerCase() === String(t).toLowerCase()); return i === -1 ? 99 : i; };
  // what a pitch can be tagged as (plus whatever the session already uses, and Other… for anything else)
  const TAG_TYPES = ["Fastball", "Sinker", "Cutter", "Slider", "Sweeper", "Slurve", "Curveball", "ChangeUp", "Splitter", "Knuckleball"];
  const byType = (a, b) => typeRank(a) - typeRank(b) || String(a).localeCompare(String(b));
  const FASTBALLS = /fastball|four|sinker|two|seam/i;

  // one session's figures for each pitch type, from its pitches (TrackMan's summary only fills a gap)
  // (pitch types come from the pitches as tagged now, so retagging one moves it; an untagged pitch counts as Untagged)
  const UNTAGGED = "Untagged";
  const typeOfPitch = (p) => p.type || UNTAGGED;
  // a pitch taken out of the report (from a chart or the pitch table) is kept, marked removed, so it can be put back
  const livePitches = (session) => (session.pitches || []).filter((p) => !p.removed);
  // the average of clock-face tilts ("1:45"), around the clock (so 11:45 and 12:15 average to 12:00), to 15 minutes
  const tiltMinutes = (t) => { const m = String(t || "").match(/^(\d{1,2}):(\d{2})$/); return m ? ((Number(m[1]) % 12) * 60 + Number(m[2])) : null; };
  const tiltText = (mins) => { if (mins == null) return null; const q = Math.round(mins / 15) * 15 % 720, h = Math.floor(q / 60); return `${h === 0 ? 12 : h}:${String(q % 60).padStart(2, "0")}`; };
  const tiltAvg = (list) => {
    const ms = list.map(tiltMinutes).filter((m) => m != null);
    if (!ms.length) return null;
    const a = ms.map((m) => (m / 720) * 2 * Math.PI), sx = a.reduce((s, v) => s + Math.sin(v), 0), cx = a.reduce((s, v) => s + Math.cos(v), 0);
    return ((Math.atan2(sx, cx) / (2 * Math.PI)) * 720 + 720) % 720;
  };
  function typeStats(session) {
    const pitches = livePitches(session);
    const types = [...new Set(pitches.length ? pitches.map(typeOfPitch) : (session.summary || []).map((r) => r.type).filter(Boolean))].sort(byType);
    return types.map((type) => {
      const ps = pitches.filter((p) => typeOfPitch(p) === type), sum = (session.summary || []).find((r) => r.type === type) || {};
      const vals = (k) => ps.map((p) => p[k]).filter((v) => typeof v === "number");
      const avg = (k) => { const v = vals(k); return v.length ? r1(v.reduce((a, b) => a + b, 0) / v.length) : null; };
      const max = (k) => { const v = vals(k); return v.length ? r1(Math.max(...v)) : null; };
      return {
        type, qty: ps.length || sum.qty || 0,
        speedAvg: avg("speed") ?? sum.speedAvg ?? null, speedMax: max("speed") ?? sum.speedMax ?? null,
        spinAvg: avg("spin") != null ? Math.round(avg("spin")) : sum.spinAvg != null ? Math.round(sum.spinAvg) : null,
        ivb: avg("ivb"), hb: avg("hb") ?? sum.hbAvg ?? null,
        relHeight: avg("relHeight") ?? sum.relHeight ?? null, relSide: avg("relSide") ?? sum.relSide ?? null,
        extension: avg("extension") ?? sum.extension ?? null, spinEff: avg("spinEff") != null ? Math.round(avg("spinEff")) : null,
        vaa: avg("vaa"), tilt: tiltAvg(ps.map((p) => p.tilt)),
      };
    });
  }

  // Saves parsed TrackMan reports as bullpen sessions for this athlete. A report already on file (same date, same
  // number of pitches, same first pitch) is skipped; one made out to someone else is only saved once confirmed.
  async function importReports(athlete, files) {
    const store = window.AthleteStore, out = { saved: [], skipped: [], failed: [] };
    for (const file of files) {
      try {
        const r = await window.TrackmanImport.parse(file);
        if (r.athleteName && nameKey(r.athleteName) !== nameKey(athlete.name)) {
          const ok = await window.askConfirm({ title: "Different name on the report", text: `${file.name} is for ${r.athleteName}, not ${athlete.name}. Save it to ${athlete.name}'s bullpens anyway?`, ok: "Save it here" });
          if (!ok) { out.skipped.push(`${file.name} (for ${r.athleteName})`); continue; }
        }
        const first = r.pitches[0] || {};
        const dup = getBullpens(athlete.id).find((b) => b.date === r.date && (b.pitches || []).length === r.pitches.length && ((b.pitches || [])[0] || {}).speed === first.speed);
        if (dup) { out.skipped.push(`${fmtDate(r.date)} (already on file)`); continue; }
        const rec = {
          id: uid(), kind: "bullpen", athleteId: athlete.id, date: r.date, sessionType: r.sessionType, facility: r.facility,
          reportName: r.athleteName, summary: r.summary, pitches: r.pitches, source: "trackman-pdf", fileName: file.name || "",
          importedAt: new Date().toISOString(), importedBy: store.currentUserEmail ? store.currentUserEmail() : "", notes: "",
        };
        store.saveAssessment(rec);
        out.saved.push(rec);
      } catch (e) {
        out.failed.push(`${file.name || "file"}: ${(e && e.message) || e}`);
      }
    }
    return out;
  }
  const getBullpens = (athleteId) => window.AthleteStore.getBullpens(athleteId);
  const resultText = (res) => [
    res.saved.length ? `Imported ${res.saved.length} bullpen${res.saved.length === 1 ? "" : "s"} (${res.saved.map((b) => shortDate(b.date)).join(", ")}).` : "",
    res.skipped.length ? `Skipped ${res.skipped.join(", ")}.` : "",
    res.failed.length ? `Couldn't read ${res.failed.join("; ")}` : "",
  ].filter(Boolean).join(" ");

  // A scatter chart on a grid with its zero lines: a small dot per pitch (click one to tag or remove it) and a ringed
  // dot at each pitch type's average. Used for movement (HB by IVB) and release point (side by height).
  function ScatterChart({ pts, avgs, xr, yr, step, xLabel, yLabel, label, unit, picked, onPick, tip, focus, show = "both" }) {
    // show: "both" (every pitch and each type's average), "pitches", or "avgs" (just the averages, labeled)
    const showPts = show !== "avgs", showAvgs = show !== "pitches";
    const dim = (t) => focus && focus.length > 0 && !focus.includes(t || UNTAGGED); // a pitch type the key isn't showing
    const ordered = [...pts].sort((a, b) => (dim(a.type) ? 0 : 1) - (dim(b.type) ? 0 : 1));
    const W = 420, H = Math.round(420 * Math.min(1.2, Math.max(0.75, (yr[1] - yr[0]) / (xr[1] - xr[0])))), P = 30;
    const x = (v) => P + ((v - xr[0]) / (xr[1] - xr[0])) * (W - 2 * P), y = (v) => H - P - ((v - yr[0]) / (yr[1] - yr[0])) * (H - 2 * P);
    const ticks = (r) => { const out = []; for (let t = Math.ceil(r[0] / step) * step; t <= r[1] + 1e-9; t += step) out.push(Math.round(t * 100) / 100); return out; };
    const x0 = xr[0] <= 0 && xr[1] >= 0 ? 0 : xr[0], y0 = yr[0] <= 0 && yr[1] >= 0 ? 0 : yr[0];
    // with just the averages, each is labeled; labels that would overlap are stacked apart, with a line back to the dot
    const labels = (() => {
      const ls = avgs.map((a) => ({ type: a.type, dx: x(a.x), dy: y(a.y), ly: y(a.y) + 4 })).sort((p, q) => p.ly - q.ly);
      for (let i = 1; i < ls.length; i++) if (ls[i].ly - ls[i - 1].ly < 14) ls[i].ly = ls[i - 1].ly + 14;
      return Object.fromEntries(ls.map((l) => [l.type, l]));
    })();
    return (
      <svg className="bp-plot" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        {ticks(xr).map((t) => <line key={`x${t}`} x1={x(t)} y1={y(yr[0])} x2={x(t)} y2={y(yr[1])} className={t === 0 ? "bp-axis" : "bp-grid"} />)}
        {ticks(yr).map((t) => <line key={`y${t}`} x1={x(xr[0])} y1={y(t)} x2={x(xr[1])} y2={y(t)} className={t === 0 ? "bp-axis" : "bp-grid"} />)}
        {ticks(xr).filter((t) => t !== x0).map((t) => <text key={`xl${t}`} x={x(t)} y={y(y0) + 11} className="bp-tick" textAnchor="middle">{t}</text>)}
        {ticks(yr).filter((t) => t !== y0).map((t) => <text key={`yl${t}`} x={x(x0) - 4} y={y(t) + 3} className="bp-tick" textAnchor="end">{t}</text>)}
        <text x={W / 2} y={H - 3} className="bp-axis-label" textAnchor="middle">{xLabel}</text>
        <text x={9} y={H / 2} className="bp-axis-label" textAnchor="middle" transform={`rotate(-90 9 ${H / 2})`}>{yLabel}</text>
        {showAvgs && avgs.map((a) => (
          <g key={`a${a.type}`} opacity={dim(a.type) ? 0.12 : 1}>
            <circle cx={x(a.x)} cy={y(a.y)} r={show === "avgs" ? 10 : 8} fill={colorOf(a.type)} fillOpacity="0.85" stroke="var(--text)" strokeWidth="1.5" pointerEvents={show === "avgs" ? "auto" : "none"}><title>{a.type} average{a.tip ? `: ${a.tip}` : ""}</title></circle>
            {show === "avgs" && labels[a.type] && Math.abs(labels[a.type].ly - (y(a.y) + 4)) > 2 && <line x1={x(a.x) + 9} y1={y(a.y)} x2={x(a.x) + 22} y2={labels[a.type].ly - 4} className="bp-avg-leader" />}
            {show === "avgs" && <text x={x(a.x) + 24} y={labels[a.type] ? labels[a.type].ly : y(a.y) + 4} className="bp-avg-label">{a.type}</text>}
          </g>
        ))}
        {showPts && ordered.map((p) => (
          <circle key={p.key} className={`bp-pt${picked === p.key ? " on" : ""}`} cx={x(p.x)} cy={y(p.y)} r={picked === p.key ? 7 : 5}
            fill={p.type ? colorOf(p.type) : "transparent"} fillOpacity={picked === p.key ? 1 : 0.5} stroke={p.type ? colorOf(p.type) : "var(--warn)"} strokeWidth={p.type ? 1 : 1.5} opacity={dim(p.type) && picked !== p.key ? 0.12 : 1}
            onClick={() => onPick(picked === p.key ? null : p.key)}>
            <title>{p.dateLabel ? `${p.dateLabel} ` : ""}#{p.no} {p.type || "Untagged"}: {tip(p)}. Click to tag or remove.</title>
          </circle>
        ))}
      </svg>
    );
  }
  const rangeOf = (vals, min, pad) => { const a = Math.min(min[0], ...vals.map((v) => v - pad)), b = Math.max(min[1], ...vals.map((v) => v + pad)); return [Math.floor(a), Math.ceil(b)]; };

  // ---- the arsenal's spin: a real-looking baseball per pitch type, turning on the pitch's own spin axis ----------
  // The seam is the ball's actual figure-eight curve on the sphere, with its 108 double stitches in a herringbone,
  // drawn each frame as the ball turns (only the half facing you). The axis, as the catcher sees it: the tilt sets
  // which way the spin pushes the ball (12:00 = pure backspin, the face rolling straight up), and spin efficiency
  // and gyro (100% minus efficiency) split the axis between them: 100% efficient spins straight end over end toward the
  // tilt; a 40% slider is 60% gyro, mostly "bullet" spin, turning around the line it's thrown on. Far slower than life.
  const SEAM = (() => {
    const a = 0.71, b = 0.29, c = 2 * Math.sqrt(a * b); // a + b = 1 keeps the curve on the ball; a smaller b opens up the horseshoes
    const P = (t) => [a * Math.cos(t) + b * Math.cos(3 * t), a * Math.sin(t) - b * Math.sin(3 * t), c * Math.sin(2 * t)];
    const N = 3000, pts = [], len = [0];
    for (let i = 0; i <= N; i++) pts.push(P((i / N) * 2 * Math.PI));
    for (let i = 1; i <= N; i++) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]));
    const even = (m) => {
      const out = [];
      let j = 0;
      for (let k = 0; k < m; k++) {
        const s = (k / m) * len[N];
        while (j < N - 1 && len[j + 1] < s) j++;
        const p = pts[j], q = pts[j + 1], T = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], tl = Math.hypot(T[0], T[1], T[2]) || 1;
        const t = T.map((v) => v / tl), S = [p[1] * t[2] - p[2] * t[1], p[2] * t[0] - p[0] * t[2], p[0] * t[1] - p[1] * t[0]]; // across the seam
        out.push({ p, t, S });
      }
      return out;
    };
    return { line: even(260), stitches: even(108) };
  })();
  const rotM = (u, a) => { // rotation by a about unit axis u
    const x = u[0], y = u[1], z = u[2], c = Math.cos(a), s = Math.sin(a), k = 1 - c;
    return [[c + x * x * k, x * y * k - z * s, x * z * k + y * s], [y * x * k + z * s, c + y * y * k, y * z * k - x * s], [z * x * k - y * s, z * y * k + x * s, c + z * z * k]];
  };
  const mulM = (A, B) => A.map((r) => [0, 1, 2].map((j) => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
  const app = (M, v) => [M[0][0] * v[0] + M[0][1] * v[1] + M[0][2] * v[2], M[1][0] * v[0] + M[1][1] * v[1] + M[1][2] * v[2], M[2][0] * v[0] + M[2][1] * v[1] + M[2][2] * v[2]];
  // How the seams sit on the spin axis: a four-seam ball turns about the axis through its seam loops' poles (four
  // seams cross the band of fastest spin each turn); a two-seam ball about a diagonal where only two do: the one through
  // the pair of horseshoes with nothing printed in them (the other pair holds "Pitching" and the DST plate).
  const SEAM_AXIS = { four: [0, 0, 1], two: [Math.SQRT1_2, -Math.SQRT1_2, 0] };
  const isTwoSeam = (t) => /sinker|two|2[- ]?seam/i.test(String(t || ""));
  // the rotation that carries unit vector a onto unit vector b
  const alignM = (a, b) => {
    const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    if (d > 0.99999) return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    let ax = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    let l = Math.hypot(ax[0], ax[1], ax[2]);
    if (l < 1e-6) { ax = Math.abs(a[0]) < 0.9 ? [0, -a[2], a[1]] : [-a[2], 0, a[0]]; l = Math.hypot(ax[0], ax[1], ax[2]); }
    return rotM(ax.map((v) => v / l), Math.acos(Math.max(-1, Math.min(1, d))));
  };
  const gyroOf = (eff) => (eff == null ? null : Math.max(0, Math.min(100, Math.round(100 - eff)))); // gyro % is what efficiency leaves
  // The spin axis in the catcher's frame (x to the catcher's right, y up, z toward the catcher). TrackMan's tilt is
  // the pitcher's clock, so a righty's 1:30 runs to the catcher's left. The transverse part makes the face the catcher
  // sees roll toward that movement; gyro (100% minus efficiency) leans the axis onto the line of flight.
  function spinAxis(tiltMin, effPct) {
    const th = tiltMin != null ? (tiltMin / 720) * 2 * Math.PI : 0;
    const m = [-Math.sin(th), Math.cos(th), 0]; // movement, catcher's frame
    const tr = [-m[1], m[0], 0]; // z x m
    const e = effPct != null ? Math.max(0, Math.min(1, effPct / 100)) : 1;
    const u = [tr[0] * e, tr[1] * e, 1 - e], l = Math.hypot(u[0], u[1], u[2]) || 1;
    return u.map((v) => v / l);
  }
  const POV_M = { catcher: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], pitcher: [[-1, 0, 0], [0, 1, 0], [0, 0, -1]] }; // from behind the pitcher: turned around
  // the seams mirrored without changing the spin: a reflection through the plane square to the axis, which turns with
  // the ball the same way (so a horseshoe on the right of a fastball comes round on the left)
  const mirrorM = (u) => [0, 1, 2].map((i) => [0, 1, 2].map((j) => (i === j ? 1 : 0) - 2 * u[i] * u[j]));

  // ---- what's printed on the ball, all in the navy of an MLB ball's stamps -----------------------------------------
  // On the sweet spot (the narrow waist between the seams), "★ OFFICIAL ★ / DYNAMIC SPORTS TRAINING" over Kevin Poppe's own
  // signature; above the seam beyond it, "Pitching" in a script like Rawlings'; below the other seam, a navy plate
  // with the DST logo cut out of it. Each is drawn once into an alpha map, then painted onto the turning sphere pixel
  // by pixel (each pixel on the ball traced back to the ball's own surface, and into the stamp as printed there: flat
  // as seen square-on, so its lines run straight when it faces you, the way a stamp on a real ball does).
  const INK = [18, 30, 72];
  const sweet = [0, 0, 1], up = [Math.SQRT1_2, Math.SQRT1_2, 0], across = [Math.SQRT1_2, -Math.SQRT1_2, 0];
  // a stamp laid on the ball `deg` degrees from the sweet spot, toward the "Pitching" side (negative: the other way)
  const placed = (deg, hw, hh) => {
    const a = (deg * Math.PI) / 180;
    return { d: [up[0] * Math.sin(a), up[1] * Math.sin(a), Math.cos(a)], R: across, U: [up[0] * Math.cos(a), up[1] * Math.cos(a), -Math.sin(a)], hw, hh };
  };
  const DECALS = [
    { ...placed(0, 0.64, 0.26), key: "stamp" }, // as wide as it likes; this tall keeps ~10° clear of the stitches,
    { ...placed(56, 0.44, 0.172), key: "script" },
    { ...placed(-56, 0.29, 0.158), key: "plate" },
  ];
  const decalMaps = {}; // key -> { w, h, a: alpha 0..1 }, once the fonts and logo are in
  const alphaMap = (w, h, draw) => {
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    const g = cv.getContext("2d");
    g.fillStyle = `rgb(${INK.join(",")})`;
    draw(g, w, h);
    const px = g.getImageData(0, 0, w, h).data, a = new Float32Array(w * h);
    for (let i = 0; i < a.length; i++) a[i] = px[i * 4 + 3] / 255;
    return { w, h, a };
  };
  const star = (g, x, y, R) => {
    g.beginPath();
    for (let k = 0; k < 10; k++) { const rr = k % 2 ? R * 0.42 : R, t = -Math.PI / 2 + (k * Math.PI) / 5; g.lineTo(x + rr * Math.cos(t), y + rr * Math.sin(t)); }
    g.closePath(); g.fill();
  };
  const fitText = (g, text, x, y, maxW) => {
    const w = g.measureText(text).width;
    g.save(); g.translate(x, y); if (w > maxW) g.scale(maxW / w, 1); g.fillText(text, 0, 0); g.restore();
  };
  let decalsReady = null;
  function loadDecals() {
    if (decalsReady) return decalsReady;
    const logo = new Image();
    const logoIn = new Promise((ok) => { logo.onload = ok; logo.onerror = ok; logo.src = "assets/dst-logo.png"; });
    const sig = new Image(); // Kevin's own signature: light strokes on black (assets/signature.jpg)
    const sigIn = new Promise((ok) => { sig.onload = ok; sig.onerror = ok; sig.src = "assets/signature.jpg"; });
    const fonts = document.fonts ? Promise.all(["800 96px 'Barlow Condensed'", "150px Yellowtail", "120px 'Mrs Saint Delafield'"].map((f) => document.fonts.load(f).catch(() => null))) : Promise.resolve();
    decalsReady = Promise.all([logoIn, sigIn, fonts]).then(() => {
      decalMaps.stamp = alphaMap(1000, 406, (g, w) => {
        g.textAlign = "center"; g.textBaseline = "alphabetic";
        // OFFICIAL a little smaller than the line under it and slanted, between stars as tall as its capitals
        g.font = "800 104px 'Barlow Condensed', 'Arial Narrow', sans-serif";
        const om = g.measureText("OFFICIAL"), ow = om.width, cap = om.actualBoundingBoxAscent || 73, base = 112;
        g.save(); g.translate(w / 2, base); g.transform(1, 0, -0.12, 1, 0, 0); g.fillText("OFFICIAL", 0, 0); g.restore();
        const sr = cap / (1 + Math.cos(Math.PI / 5)), sy = base - cap + sr; // a star's top point to its feet is its height
        star(g, w / 2 - ow / 2 - 16 - sr, sy, sr); star(g, w / 2 + ow / 2 + 16 + sr, sy, sr);
        g.font = "800 118px 'Barlow Condensed', 'Arial Narrow', sans-serif";
        fitText(g, "DYNAMIC SPORTS TRAINING", w / 2, 234, 980);
        if (sig.naturalWidth) {
          // the signature as written: its strokes (the light parts of the picture) become ink, thickened a little so
          // they still show at the size of the ball
          const sx = 280, sy = 10, sw = sig.naturalWidth > 820 ? 540 : sig.naturalWidth, sh = Math.min(335, sig.naturalHeight);
          const dh = 158, dw = Math.round((dh * sw) / sh), t = document.createElement("canvas");
          t.width = dw; t.height = dh;
          const tg = t.getContext("2d"), R = 3;
          tg.globalCompositeOperation = "lighten";
          for (let ox = -R; ox <= R; ox++) for (let oy = -R; oy <= R; oy++) if (ox * ox + oy * oy <= R * R) tg.drawImage(sig, sx, sy, sw, sh, ox, oy, dw, dh);
          const id = tg.getImageData(0, 0, dw, dh), p = id.data;
          for (let i = 0; i < p.length; i += 4) { const l = Math.max(p[i], p[i + 1], p[i + 2]); p[i] = INK[0]; p[i + 1] = INK[1]; p[i + 2] = INK[2]; p[i + 3] = Math.max(0, Math.min(255, (l - 45) * 2.2)); }
          tg.putImageData(id, 0, 0);
          g.drawImage(t, (w - dw) / 2, 246);
        } else {
          g.font = "110px 'Mrs Saint Delafield', 'Brush Script MT', cursive";
          fitText(g, "Kevin Poppe", w / 2, 380, 420);
        }
      });
      decalMaps.script = alphaMap(600, 235, (g, w) => {
        g.textAlign = "center";
        g.font = "190px Yellowtail, 'Brush Script MT', cursive";
        // a heavier pen than the font's own: the same letters, outlined in ink as well as filled
        const tw = g.measureText("Pitching").width, k = Math.min(1, 560 / tw);
        g.save(); g.translate(w / 2, 172); g.scale(k, 1);
        g.lineWidth = 5; g.lineJoin = "round"; g.strokeStyle = g.fillStyle;
        g.strokeText("Pitching", 0, 0); g.fillText("Pitching", 0, 0);
        g.restore();
      });
      decalMaps.plate = alphaMap(440, 240, (g, w, h) => {
        const rr = 26;
        g.beginPath(); g.moveTo(rr, 0); g.arcTo(w, 0, w, h, rr); g.arcTo(w, h, 0, h, rr); g.arcTo(0, h, 0, 0, rr); g.arcTo(0, 0, w, 0, rr); g.closePath(); g.fill();
        if (logo.naturalWidth) { // the logo's DST letters (not the words under them), cut out of the plate
          const sw = logo.naturalWidth, sh = logo.naturalHeight * 0.8, dw = w * 0.8, dh = (dw * sh) / sw;
          g.globalCompositeOperation = "destination-out";
          g.drawImage(logo, 0, 0, sw, sh, (w - dw) / 2, (h - dh) / 2, dw, dh);
          g.globalCompositeOperation = "source-over";
        }
      });
      window.dispatchEvent(new CustomEvent("bp-ball-decals"));
    });
    return decalsReady;
  }
  // one layer canvas per drawn size, reused frame to frame
  const layers = new Map();
  function paintDecals(ctx, size, M, mirror) {
    if (!decalMaps.stamp) return;
    const sc = Math.min(2, window.devicePixelRatio || 1), N = Math.round(size * sc);
    let L = layers.get(N);
    if (!L) { const cv = document.createElement("canvas"); cv.width = N; cv.height = N; const g = cv.getContext("2d"); L = { cv, g, img: g.createImageData(N, N) }; layers.set(N, L); }
    const data = L.img.data;
    data.fill(0);
    const cx = size / 2, cy = size / 2, r = size * 0.38;
    let any = false;
    DECALS.forEach((dc) => {
      const map = decalMaps[dc.key];
      if (!map) return;
      // where it lands on screen: its outline and middle, turned with the ball
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, seen = false;
      for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
        const a = (dc.hw * i) / 2, b = (dc.hh * j) / 2, c = Math.sqrt(Math.max(0, 1 - a * a - b * b));
        const v = app(M, [0, 1, 2].map((k) => dc.R[k] * a + dc.U[k] * b + dc.d[k] * c));
        if (v[2] > 0) seen = true;
        const px = (cx + v[0] * r) * sc, py = (cy - v[1] * r) * sc;
        x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
      }
      if (!seen) return;
      any = true;
      x0 = Math.max(0, Math.floor(x0) - 2); y0 = Math.max(0, Math.floor(y0) - 2); x1 = Math.min(N - 1, Math.ceil(x1) + 2); y1 = Math.min(N - 1, Math.ceil(y1) + 2);
      const { w: TW, h: TH, a: A } = map, flip = mirror ? -1 : 1;
      for (let py = y0; py <= y1; py++) {
        const Y = -((py + 0.5) / sc - cy) / r;
        for (let px = x0; px <= x1; px++) {
          const X = ((px + 0.5) / sc - cx) / r, rr = X * X + Y * Y;
          if (rr >= 1) continue;
          const Z = Math.sqrt(1 - rr);
          // back onto the ball's own surface (M is a rotation, or a rotation and a mirror: its transpose undoes it)
          const q0 = M[0][0] * X + M[1][0] * Y + M[2][0] * Z, q1 = M[0][1] * X + M[1][1] * Y + M[2][1] * Z, q2 = M[0][2] * X + M[1][2] * Y + M[2][2] * Z;
          const dot = q0 * dc.d[0] + q1 * dc.d[1] + q2 * dc.d[2];
          if (dot < 0.3) continue;
          const u = (flip * (q0 * dc.R[0] + q1 * dc.R[1] + q2 * dc.R[2])) / dc.hw, v = (q0 * dc.U[0] + q1 * dc.U[1] + q2 * dc.U[2]) / dc.hh;
          if (u <= -1 || u >= 1 || v <= -1 || v >= 1) continue;
          const tx = ((u + 1) / 2) * (TW - 1), ty = ((1 - v) / 2) * (TH - 1), ix = tx | 0, iy = ty | 0, fx = tx - ix, fy = ty - iy;
          const k = iy * TW + ix;
          const a = (A[k] * (1 - fx) + A[k + 1] * fx) * (1 - fy) + (A[k + TW] * (1 - fx) + A[k + TW + 1] * fx) * fy;
          if (a < 0.02) continue;
          const shade = 0.7 + 0.3 * Z, o = (py * N + px) * 4;
          data[o] = INK[0] * shade; data[o + 1] = INK[1] * shade; data[o + 2] = INK[2] * shade;
          data[o + 3] = 255 * a * Math.min(1, Z * 3) * 0.95;
        }
      }
    });
    if (!any) return;
    L.g.putImageData(L.img, 0, 0);
    ctx.drawImage(L.cv, 0, 0, size, size);
  }
  // the leather's pebble grain: specks fixed on the ball, a touch darker or lighter, turning with it
  const GRAIN = (() => {
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const out = [];
    for (let i = 0; i < 2600; i++) {
      const z = rnd() * 2 - 1, t = rnd() * 2 * Math.PI, s = Math.sqrt(1 - z * z);
      out.push({ p: [s * Math.cos(t), s * Math.sin(t), z], dark: rnd() < 0.6 });
    }
    return out;
  })();
  function paintGrain(ctx, cx, cy, r, M) {
    const dot = Math.max(0.6, r * 0.016);
    [true, false].forEach((dark) => {
      ctx.beginPath();
      GRAIN.forEach((g) => {
        if (g.dark !== dark) return;
        const v = app(M, g.p);
        if (v[2] < 0.15) return;
        ctx.rect(cx + v[0] * r - dot / 2, cy - v[1] * r - dot / 2, dot, dot);
      });
      ctx.fillStyle = dark ? "rgba(120, 105, 85, 0.11)" : "rgba(255, 255, 255, 0.35)";
      ctx.fill();
    });
  }

  function drawBall(ctx, size, M, color, arrowRad, mirror) {
    const cx = size / 2, cy = size / 2, r = size * 0.38;
    ctx.clearRect(0, 0, size, size);
    // the leather: lit from the upper left, darker toward the edge
    const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.42, r * 0.1, cx, cy, r);
    g.addColorStop(0, "#ffffff"); g.addColorStop(0.55, "#f3f0e8"); g.addColorStop(0.88, "#d9d4c8"); g.addColorStop(1, "#b5afa2");
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, 2 * Math.PI); ctx.fillStyle = g; ctx.fill();
    paintGrain(ctx, cx, cy, r, M);
    paintDecals(ctx, size, M, mirror);
    const X = (v) => cx + v[0] * r, Y = (v) => cy - v[1] * r;
    const off = (p, S, t, a, b) => [p[0] + S[0] * a + t[0] * b, p[1] + S[1] * a + t[1] * b, p[2] + S[2] * a + t[2] * b];
    // the seam: one groove in the leather, where the two pieces meet
    ctx.lineCap = "round";
    ctx.beginPath();
    let pen = false;
    SEAM.line.forEach(({ p }) => {
      const q = app(M, p);
      if (q[2] < 0.02) { pen = false; return; }
      if (pen) ctx.lineTo(X(q), Y(q)); else { ctx.moveTo(X(q), Y(q)); pen = true; }
    });
    ctx.strokeStyle = "rgba(110, 92, 78, 0.6)"; ctx.lineWidth = Math.max(0.6, r * 0.012); ctx.stroke();
    // the stitches: a red slash each side of the groove, meeting it in a herringbone, raised off the leather (a shadow
    // below and to the right, away from the light, and a glint on top). Drawn in a few batches by how far round the
    // ball each one is (they fade toward the edge).
    const segs = [];
    SEAM.stitches.forEach(({ p, t, S }) => {
      const z = app(M, p)[2];
      if (z < 0.03) return;
      const alpha = Math.min(1, z * 4) * (0.7 + 0.3 * z);
      [1, -1].forEach((side) => {
        const a = app(M, off(p, S, t, side * 0.115, -0.035)), b = app(M, off(p, S, t, side * 0.012, 0.025));
        segs.push([X(a), Y(a), X(b), Y(b), Math.max(1, Math.ceil(alpha * 5))]);
      });
    });
    const lw = Math.max(1, r * 0.042);
    const pass = (dx, dy, width, style) => {
      for (let k = 1; k <= 5; k++) {
        ctx.beginPath();
        let any = false;
        segs.forEach((s) => { if (s[4] !== k) return; any = true; ctx.moveTo(s[0] + dx, s[1] + dy); ctx.lineTo(s[2] + dx, s[3] + dy); });
        if (!any) continue;
        ctx.lineWidth = width; ctx.strokeStyle = style(k / 5); ctx.stroke();
      }
    };
    pass(r * 0.012, r * 0.018, lw * 1.3, (a) => `rgba(60, 25, 20, ${(0.3 * a).toFixed(3)})`);
    pass(0, 0, lw, (a) => `rgba(165, 20, 32, ${a.toFixed(3)})`);
    pass(-r * 0.006, -r * 0.009, lw * 0.4, (a) => `rgba(255, 150, 150, ${(0.4 * a).toFixed(3)})`);
    // a soft rim
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, 2 * Math.PI); ctx.strokeStyle = "rgba(0, 0, 0, 0.28)"; ctx.lineWidth = 1; ctx.stroke();
    // which way the spin moves the ball, as seen from this side, just outside the ball
    if (arrowRad != null) {
      const d = r + size * 0.06, w = size * 0.035, sx = Math.sin(arrowRad), sy = -Math.cos(arrowRad);
      const tipX = cx + sx * (d + w * 1.6), tipY = cy + sy * (d + w * 1.6), bx = cx + sx * d, by = cy + sy * d;
      ctx.beginPath(); ctx.moveTo(tipX, tipY); ctx.lineTo(bx - sy * w, by + sx * w); ctx.lineTo(bx + sy * w, by - sx * w); ctx.closePath();
      ctx.fillStyle = color; ctx.fill();
    }
  }

  // `ctl` is { paused, speed (x the default), pov ("catcher" | "pitcher"), flip (seams mirrored) }, shared by every ball on the page
  function SpinBall({ s, ctl, size = 132, onZoom, overlay }) {
    const ref = useRef(null);
    const live = useRef(ctl);
    live.current = ctl;
    const kick = useRef(null);
    const turned = useRef(0); // how far it has turned, kept when its spin changes (a slider being dragged) so it carries on from there
    const gyro = gyroOf(s.spinEff);
    useEffect(() => {
      const cv = ref.current;
      if (!cv) return undefined;
      const dpr = window.devicePixelRatio || 1;
      cv.width = size * dpr; cv.height = size * dpr;
      const ctx = cv.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const u = spinAxis(s.tilt, s.spinEff);
      const seamAxis = isTwoSeam(s.type) ? SEAM_AXIS.two : SEAM_AXIS.four;
      const start = mulM(alignM(seamAxis, u), rotM(seamAxis, 0.6)); // the seams set on the axis, turned a little for a good first look
      const thRad = s.tilt != null ? (s.tilt / 720) * 2 * Math.PI : null;
      const revPerSec = s.spinAvg ? s.spinAvg / 9600 : 0; // at 1x, a quarter of a turn a second per 2400 rpm (life is ~40 turns a second)
      const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      let raf = 0, last = null, visible = true;
      const flipped = mulM(mirrorM(u), start);
      const paint = () => {
        const pov = live.current.pov === "pitcher" ? "pitcher" : "catcher";
        const arrow = thRad == null ? null : pov === "pitcher" ? thRad : -thRad; // the pitcher's clock, or the catcher's mirror of it
        const flip = !!live.current.flip;
        drawBall(ctx, size, mulM(POV_M[pov], mulM(rotM(u, turned.current), flip ? flipped : start)), colorOf(s.type), arrow, flip);
      };
      const moving = () => !reduce && revPerSec > 0 && visible && !live.current.paused;
      const frame = (ts) => {
        raf = 0;
        if (last != null) turned.current += ((ts - last) / 1000) * revPerSec * (live.current.speed || 1) * 2 * Math.PI;
        last = ts;
        paint();
        if (moving()) raf = requestAnimationFrame(frame); else last = null;
      };
      // a change of pause, speed or side: repaint now and carry on (or stay put) from where it is
      kick.current = () => { if (!raf) { last = null; raf = requestAnimationFrame(frame); } };
      raf = requestAnimationFrame(frame);
      const io = window.IntersectionObserver ? new IntersectionObserver((entries) => {
        visible = entries[0].isIntersecting;
        if (visible) kick.current();
      }) : null;
      if (io) io.observe(cv);
      // the printing comes in once its fonts and logo have loaded: repaint then, even if paused
      const decalsIn = () => { if (kick.current) kick.current(); };
      window.addEventListener("bp-ball-decals", decalsIn);
      loadDecals();
      return () => { cancelAnimationFrame(raf); raf = 0; if (io) io.disconnect(); kick.current = null; window.removeEventListener("bp-ball-decals", decalsIn); };
    }, [s.type, s.spinAvg, s.tilt, s.spinEff, size]); // eslint-disable-line
    useEffect(() => { if (kick.current) kick.current(); }, [ctl.paused, ctl.speed, ctl.pov, ctl.flip]);
    const active = s.spinAvg != null && s.spinEff != null ? Math.round((s.spinAvg * s.spinEff) / 100) : null;
    return (
      <div className={`bp-ball${size > 200 ? " big" : ""}`}>
        <div className="bp-ball-type" style={{ color: colorOf(s.type) }}>{s.type}</div>
        <div className="bp-ball-stage" style={{ width: size, height: size }}>
          <canvas ref={ref} className={`bp-ball-canvas${onZoom ? " zoomable" : ""}`} style={{ width: size, height: size }} title={onZoom ? "Click to zoom in" : undefined} onClick={onZoom || undefined} role="img" aria-label={`${s.type}: ${s.spinAvg || "?"} rpm${s.tilt != null ? `, tilt ${tiltText(s.tilt)}` : ""}${gyro != null ? `, ${gyro}% gyro` : ""}, ${isTwoSeam(s.type) ? "two" : "four"}-seam, ${ctl.pov === "pitcher" ? "pitcher's" : "catcher's"} view`} />
          {overlay ? overlay(size) : null}
        </div>
        <div className="bp-ball-stats">
          {s.speedAvg != null && <b className="bp-ball-velo">{s.speedAvg} mph <small>avg</small></b>}
          <b>{s.spinAvg != null ? `${s.spinAvg} rpm` : "– rpm"}</b>
          <span>Tilt {s.tilt != null ? tiltText(s.tilt) : "–"}</span>
          <span>Spin eff. {s.spinEff != null ? `${s.spinEff}%` : "–"}{gyro != null ? ` · ${gyro}% gyro` : ""}</span>
          {active != null && <span>Active ≈ {active} rpm</span>}
          {active != null && <span>Gyro ≈ {s.spinAvg - active} rpm</span>}
        </div>
      </div>
    );
  }

  // the spinning balls' controls, shared by every ball on a page: paused or not, how fast, from whose side, and the seams
  // mirrored or not (all but pausing remembered on this computer)
  function useSpinCtl() {
    const [ctl, setCtl] = useState(() => {
      try { const v = JSON.parse(localStorage.getItem("bullpenSpin2") || "null"); if (v) return { paused: false, speed: Number(v.speed) || 1, pov: v.pov === "catcher" ? "catcher" : "pitcher", flip: !!v.flip }; } catch (e) { /* private window */ }
      return { paused: false, speed: 1, pov: "pitcher", flip: false };
    });
    const set = (patch) => setCtl((c) => { const n = { ...c, ...patch }; try { localStorage.setItem("bullpenSpin2", JSON.stringify({ speed: n.speed, pov: n.pov, flip: n.flip })); } catch (e) { /* not remembered */ } return n; });
    return [ctl, set];
  }
  function SpinControls({ ctl, set }) {
    return (
      <span className="bp-spin-ctl">
        <button type="button" className="bp-mod-btn" onClick={() => set({ paused: !ctl.paused })}>{ctl.paused ? "▶ Play" : "❚❚ Pause"}</button>
        <select className="bp-tag" value={ctl.speed} aria-label="Spin speed" onChange={(e) => set({ speed: Number(e.target.value) })}>
          <option value={0.25}>Speed ¼×</option><option value={0.5}>Speed ½×</option><option value={1}>Speed 1×</option><option value={2}>Speed 2×</option>
        </select>
        <span className="pill-tabs bp-scope" role="group" aria-label="Seen from">
          <button type="button" className={`pill-tab ${ctl.pov === "pitcher" ? "active" : ""}`} onClick={() => set({ pov: "pitcher" })}>Pitcher</button>
          <button type="button" className={`pill-tab ${ctl.pov !== "pitcher" ? "active" : ""}`} onClick={() => set({ pov: "catcher" })}>Catcher</button>
        </span>
        <button type="button" className={`bp-mod-btn${ctl.flip ? " on" : ""}`} aria-pressed={!!ctl.flip} title="Mirror the seams (the horseshoe swaps sides); the spin stays the same" onClick={() => set({ flip: !ctl.flip })}>⇋ Flip seams</button>
      </span>
    );
  }
  // one pitch type's ball, large, with ‹ › through the rest of `list`; `onType(null)` closes it
  function SpinZoom({ list, type, onType, ctl, set }) {
    useEffect(() => {
      const esc = (e) => { if (e.key === "Escape") onType(null); };
      document.addEventListener("keydown", esc);
      return () => document.removeEventListener("keydown", esc);
    }, []); // eslint-disable-line
    const i = list.findIndex((s) => s.type === type);
    if (i < 0) return null;
    const step = (d) => onType(list[(i + d + list.length) % list.length].type);
    return (
      <div className="bp-zoom" onMouseDown={(e) => { if (e.target === e.currentTarget) onType(null); }}>
        <div className="bp-zoom-card" role="dialog" aria-label={`${type} spin, zoomed in`}>
          <div className="bp-zoom-head">
            <SpinControls ctl={ctl} set={set} />
            <button type="button" className="bp-mod-btn bp-zoom-close" onClick={() => onType(null)}>✕ Close</button>
          </div>
          <div className="bp-zoom-body">
            {list.length > 1 && <button type="button" className="bp-zoom-step" aria-label="Previous pitch type" onClick={() => step(-1)}>‹</button>}
            <SpinBall key={`zoom-${type}`} s={list[i]} ctl={ctl} size={380} />
            {list.length > 1 && <button type="button" className="bp-zoom-step" aria-label="Next pitch type" onClick={() => step(1)}>›</button>}
          </div>
          <p className="timestamp-note">{ctl.pov === "pitcher" ? "From behind the pitcher" : "From the catcher"}. The arrow is the way the spin moves the ball. Esc or a click outside closes it.</p>
        </div>
      </div>
    );
  }

  // ---- comps: where each pitch sits among MLB pitchers (Baseball Savant) and DST's own bullpens ------------------
  // For each pitch type in the session: its MLB percentile for velo, IVB, horizontal break, spin, release height and extension
  // (same pitch type, same throwing hand, one season), and the closest pitchers by that shape, MLB and DST together.
  // Savant's leaderboards are read straight from the browser and kept for the visit. Release side isn't matched:
  // Savant measures it from the pitcher's body and TrackMan from the middle of the rubber, so they differ by where
  // a pitcher stands. Horizontal break is arm-side positive in both.
  const SAVANT = "https://baseballsavant.mlb.com/leaderboard/";
  const savantCache = new Map();
  const savantCsv = (url) => {
    if (!savantCache.has(url)) {
      savantCache.set(url, fetch(url).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); })
        .then((t) => window.Papa.parse(t.trim(), { header: true, skipEmptyLines: true }).data)
        .catch((e) => { savantCache.delete(url); throw e; }));
    }
    return savantCache.get(url);
  };
  // TrackMan's names to Savant's pitch codes (curveballs take knuckle curves too)
  const CODES = [[/^(fastball|four|4[- ]?seam)/i, ["FF"]], [/^(sinker|two|2[- ]?seam)/i, ["SI"]], [/^cutter/i, ["FC"]], [/^sweeper/i, ["ST"]], [/^slurve/i, ["SV"]], [/^slider/i, ["SL"]], [/curve/i, ["CU", "KC"]], [/^change/i, ["CH"]], [/^split/i, ["FS"]], [/^knuckleball/i, ["KN"]]];
  const codesOf = (type) => { const hit = CODES.find(([re]) => re.test(String(type || ""))); return hit ? hit[1] : null; };
  const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
  // the pitcher's MLB (Savant) id: saved on the profile, or read from their MLB headshot link the way the profile does
  const mlbIdOf = (athlete) => String((athlete && athlete.mlbamId) || (athlete && window.extractMlbamId && window.extractMlbamId(athlete)) || "");
  const defaultSeason = () => { const d = new Date(); return d.getMonth() >= 4 ? d.getFullYear() : d.getFullYear() - 1; };
  // every pitcher's results with each pitch type that season (Savant's pitch arsenal stats), by "id|code"
  const arsenalStats = (year) => savantCsv(`${SAVANT}pitch-arsenal-stats?type=pitcher&pitchType=&year=${year}&team=&min=1&csv=true`)
    .then((rows) => new Map(rows.map((r) => [`${r.player_id}|${r.pitch_type}`, {
      pitchName: r.pitch_name, pitches: num(r.pitches), usage: num(r.pitch_usage), whiff: num(r.whiff_percent), putAway: num(r.put_away),
      xwoba: num(r.est_woba), hardHit: num(r.hard_hit_percent), rv100: num(r.run_value_per_100), rv: num(r.run_value),
    }])), () => new Map());
  // what Statcast Search has for each pitcher's pitch of one type that season (grouped by pitcher; a few seconds per
  // pitch type, kept for the visit), by id: extension (Savant's leaderboards leave it blank), release side (how far
  // from the middle of the rubber, either side), arm angle, and VAA, worked out from the average release, velo, IVB
  // and plate height the same way as a TrackMan bullpen's
  const statcastBy = (code, year) => savantCsv(`https://baseballsavant.mlb.com/statcast_search/csv?all=true&hfPT=${code}%7C&hfSea=${year}%7C&hfGT=R%7C&player_type=pitcher&group_by=name&min_pitches=1&min_results=0&sort_col=pitches&sort_order=desc&chk_stats_release_extension=on`)
    .then((rows) => new Map(rows.map((r) => {
      const v = num(r.velocity), ivbFt = num(r.api_break_z_induced), rz = num(r.release_pos_z), pz = num(r.plate_z), ext = num(r.release_extension), rx = num(r.release_pos_x);
      const vaa = v != null && ivbFt != null && rz != null && pz != null && window.TrackmanImport && window.TrackmanImport.vaaOf ? window.TrackmanImport.vaaOf({ speed: v, ivb: ivbFt * 12, relHeight: rz, plateHeight: pz, extension: ext }) : null;
      return [String(r.player_id), { ext, relSide: rx == null ? null : Math.abs(rx), vaa, armAngle: num(r.arm_angle) }];
    })), () => new Map());
  // Savant's pitcher_break_x is how far a pitch breaks sideways, never which way (it's positive for every pitch, a
  // curveball's included), so the side comes from the way its movement points (Savant's movement-inferred clock, from
  // behind the pitcher: past 12 toward 6 on the right is a righty's arm side, on the left a lefty's), or failing that
  // from the pitch type: curves, sliders, sweepers, slurves and cutters to the glove side, the rest to the arm side
  const GLOVE_SIDE = new Set(["CU", "KC", "SL", "ST", "SV", "FC"]);
  const armSideSign = (hand, code, dir) => {
    const m = dir ? num(dir.movement_inferred_clock_minutes) : null;
    const s = m == null ? 0 : Math.sin((m / 720) * 2 * Math.PI);
    if (Math.abs(s) > 0.05) return (hand === "L" ? -1 : 1) * Math.sign(s);
    return GLOVE_SIDE.has(code) ? -1 : 1;
  };
  // every MLB pitcher who threw this pitch type that season: velo, IVB, HB (arm side +), spin, spin direction and active
  // spin, release height and side, extension, arm angle, VAA, and how the pitch did (res)
  async function mlbPitchers(codes, year) {
    const [moves, spins, arms, ars, exts, dirs] = await Promise.all([
      Promise.all(codes.map((c) => savantCsv(`${SAVANT}pitch-movement?year=${year}&team=&min=50&pitch_type=${c}&hand=&x=pitcher_break_x&z=pitcher_break_z_induced&csv=true`))),
      savantCsv(`${SAVANT}pitch-arsenals?year=${year}&min=50&type=avg_spin&hand=&csv=true`).catch(() => []),
      savantCsv(`${SAVANT}pitcher-arm-angles?batSide=&dateStart=${year}-03-01&dateEnd=${year}-11-30&gameType=R&groupBy=&min=50&minGroupPitches=1&perspective=back&pitchHand=&pitchType=&season=${year}&size=small&sort=ascending&team=&csv=true`).catch(() => []),
      arsenalStats(year),
      Promise.all(codes.map((c) => statcastBy(c, year))),
      Promise.all(codes.map((c) => spinDirs(c, year))),
    ]);
    const spinBy = new Map(spins.map((r) => [String(r.pitcher || r.player_id), r]));
    const armBy = new Map(arms.map((r) => [String(r.pitcher), r]));
    const dirBy = dirs.map((rows) => new Map(rows.map((r) => [String(r.player_id), r])));
    const out = [];
    moves.forEach((rows, i) => rows.forEach((r) => {
      const id = String(r.pitcher_id), code = codes[i];
      const sp = spinBy.get(id), arm = armBy.get(id), ss = exts[i].get(id) || {}, dir = dirBy[i].get(id);
      const nm = String(r["last_name, first_name"] || "").split(",").map((x) => x.trim());
      out.push({
        id, name: nm.length > 1 ? `${nm[1]} ${nm[0]}` : nm[0], team: r.team_name_abbrev || "", hand: r.pitch_hand, code,
        velo: num(r.avg_speed), ivb: num(r.pitcher_break_z_induced), hb: num(r.pitcher_break_x) == null ? null : Math.abs(num(r.pitcher_break_x)) * armSideSign(r.pitch_hand, code, dir),
        spin: sp ? num(sp[`${code.toLowerCase()}_avg_spin`] || (code === "KC" ? sp.cu_avg_spin : null)) : null,
        relHeight: arm ? num(arm.release_ball_z) : null, armAngle: arm ? num(arm.ball_angle) : ss.armAngle != null ? ss.armAngle : null,
        ext: ss.ext != null ? ss.ext : null, relSide: ss.relSide != null ? ss.relSide : null, vaa: ss.vaa != null ? ss.vaa : null,
        tilt: dir ? num(dir.hawkeye_measured_clock_minutes) : null, eff: dir && dir.active_spin !== "" && dir.active_spin != null ? Math.round(num(dir.active_spin) * 100) : null,
        res: ars.get(`${id}|${code}`) || null,
      });
    }));
    return out;
  }
  // a pitcher's own MLB arsenal that season, most used first: each pitch's shape (when he threw 50) and results, with
  // the same pitch from every other pitcher of his hand to rank it against
  // (and each pitch's spin direction and active spin, as tilt and spinEff)
  async function mlbArsenal(id, hand, year) {
    const ars = await arsenalStats(year);
    const his = [...ars.entries()].filter(([k]) => k.split("|")[0] === String(id)).map(([k, res]) => ({ code: k.split("|")[1], res }));
    const [lists, dirs] = await Promise.all([
      Promise.all(his.map((m) => mlbPitchers([m.code], year).catch(() => []))),
      Promise.all(his.map((m) => spinDirs(m.code, year))),
    ]);
    return his.map((m, i) => {
      const shape = lists[i].find((p) => p.id === String(id)) || {};
      const dir = dirs[i].find((r) => String(r.player_id) === String(id));
      const h = hand || shape.hand;
      const spin = dir ? { tilt: num(dir.hawkeye_measured_clock_minutes), spinEff: dir.active_spin != null && dir.active_spin !== "" ? Math.round(num(dir.active_spin) * 100) : null, spinRate: num(dir.spin_rate) } : {};
      return { ...shape, ...spin, code: m.code, res: m.res, pool: lists[i].filter((p) => p.id !== String(id) && (!h || p.hand === h)).map((p) => p.res) };
    }).sort((a, b) => (b.res.usage || 0) - (a.res.usage || 0));
  }
  // Savant's spin direction leaderboard for one pitch type: each pitcher's spin, the direction it moves the ball (from
  // behind the pitcher, as clock minutes: the same as TrackMan's tilt) and active spin (a fraction)
  const spinDirs = (code, year) => savantCsv(`${SAVANT}spin-direction-pitches?year=${year}&min=1&sort=11&sortDir=asc&pitch_type=${code}&throws=&playerName=&team=&pov=Pit&csv=true`).catch(() => []);
  // how each pitch did, as Savant reports it; `good` says which way is better for the pitcher (run value is the
  // pitcher's: plus is runs saved)
  const RESULTS = [
    ["usage", "Usage", (v) => `${v}%`, null, "Share of his pitches"],
    ["whiff", "Whiff", (v) => `${v}%`, true, "Misses per swing"],
    ["putAway", "Put-away", (v) => `${v}%`, true, "Two-strike pitches that ended in a strikeout"],
    ["xwoba", "xwOBA", (v) => v.toFixed(3).replace(/^0/, ""), false, "Expected wOBA on the plate appearances it ended (lower is better)"],
    ["rv100", "RV/100", (v) => `${v > 0 ? "+" : ""}${v.toFixed(1)}`, true, "Run value per 100 pitches (plus is runs saved)"],
  ];
  const goodPct = (v, xs, good) => { const p = pctOf(v, xs); return p == null || good == null ? null : good ? p : 100 - p; };
  const resHeads = () => RESULTS.map(([k, label, , , tip], i) => <th key={k} className={i === 0 ? "bp-res-first" : ""} title={tip}>{label}</th>);
  // the results cells for one pitcher's pitch, each tinted by where it ranks among `pool` (red good, blue not)
  const resCells = (res, pool) => RESULTS.map(([k, , fmt, good], i) => {
    const v = res ? res[k] : null;
    const p = v == null ? null : goodPct(v, pool.map((r) => (r ? r[k] : null)), good);
    return (
      <td key={k} className={i === 0 ? "bp-res-first" : ""} title={v == null ? "" : `${p != null ? `Better than ${p}% of them. ` : ""}${k === "rv100" && res.rv != null ? `${res.rv > 0 ? "+" : ""}${res.rv} runs over ${res.pitches} pitches` : `${res.pitches || "?"} pitches`}`}>
        {v == null ? "–" : <span className="bp-res" style={p == null ? null : { background: `hsla(${Math.round(210 - (p / 100) * 210)}, 75%, 50%, 0.22)` }}>{fmt(v)}</span>}
      </td>
    );
  });
  // Savant's pitch codes to our pitch types, for colors
  const CODE_TYPE = { FF: "Fastball", SI: "Sinker", FC: "Cutter", SL: "Slider", ST: "Sweeper", SV: "Slurve", CU: "Curveball", KC: "Knuckle Curve", CH: "ChangeUp", FS: "Splitter", KN: "Knuckleball" };
  // DST's other pitchers with this pitch type in their bullpens, averaged over all their sessions
  function dstPitchers(athlete, codes) {
    const S = window.AthleteStore, out = [];
    (S.allAthletes ? S.allAthletes() : []).forEach((a) => {
      if (String(a.id) === String(athlete.id)) return;
      const all = S.getBullpens(a.id);
      if (!all.length) return;
      const st = typeStats({ pitches: all.flatMap(livePitches) }).find((s) => { const c = codesOf(s.type); return c && c.some((x) => codes.includes(x)); });
      if (!st) return;
      const code = codesOf(st.type).find((x) => codes.includes(x));
      out.push({
        id: `dst-${a.id}`, name: a.name, team: "DST", hand: a.throws || "", dst: true, mlbamId: a.mlbamId || null, code,
        velo: st.speedAvg, ivb: st.ivb, hb: a.throws === "L" && st.hb != null ? -st.hb : st.hb, // TrackMan's break is the pitcher's view; comps go by arm side
        spin: st.spinAvg, relHeight: st.relHeight, relSide: st.relSide != null ? Math.abs(st.relSide) : null, ext: st.extension, vaa: st.vaa, tilt: st.tilt, eff: st.spinEff, armAngle: null,
      });
    });
    return out;
  }
  const FEATURES = [["velo", 1.5], ["ivb", 2], ["hb", 2], ["spin", 120], ["relHeight", 0.35], ["relSide", 0.35], ["ext", 0.35], ["vaa", 0.5]]; // what a mile, an inch, a foot, a degree is worth
  const matchOf = (me, p) => {
    let sum = 0, n = 0;
    FEATURES.forEach(([k, scale]) => { if (me[k] != null && p[k] != null) { sum += ((me[k] - p[k]) / scale) ** 2; n++; } });
    return n >= 3 ? Math.round(100 * Math.exp(-sum / n / 2)) : null;
  };
  const pctOf = (v, list) => { const xs = list.filter((x) => x != null); if (v == null || xs.length < 10) return null; return Math.round((xs.filter((x) => x < v).length / xs.length) * 100); };
  const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th"}`;

  // ---- rarity: how unusual a pitch is among MLB pitches of its type thrown with the same hand -----------------------
  // How few MLB pitches look like it. Each trait is put on the same footing (standard deviations from the MLB average
  // for that pitch; spin direction around the clock), and the pitch's distance to its 5 most similar MLB pitches is
  // set against every MLB pitch's distance to its own 5 nearest: rarity is the share of those MLB pitches with closer
  // company than it has, so 99 means fewer look like it than for 99% of them. A pitch far out on any one trait, or an
  // unusual mix of ordinary ones, has few neighbors and scores high; a common shape scores low, however good it is.
  // The traits furthest from the usual are named.
  const KNN = 5;
  const rarityCache = new Map(); // a population's standing (its traits' spread and each pitch's nearest-5 distance), by who's in it
  const RARE_TRAITS = [
    ["velo", "harder than most", "softer than most"], ["ivb", "more vertical break", "less vertical break"], ["hb", "more arm-side run", "more glove-side movement"],
    ["spin", "more spin", "less spin"], ["eff", "more efficient spin", "more gyro"], ["tilt", "spin direction turned clockwise of the usual", "spin direction turned counterclockwise of the usual"],
    ["relHeight", "a higher release", "a lower release"], ["relSide", "a wider release", "a release closer to the middle"], ["ext", "longer extension", "shorter extension"],
    ["vaa", "a flatter approach angle", "a steeper approach angle"], ["armAngle", "a higher arm angle", "a lower arm angle"],
  ];
  function rarityOf(me, pop) {
    if (!pop.length) return null;
    const ckey = `${pop.length}|${pop[0].id}|${pop[0].code}|${pop[pop.length - 1].id}`;
    let base = rarityCache.get(ckey);
    if (!base) { base = rarityBase(pop); rarityCache.set(ckey, base); }
    const { zOf, zs, nearest } = base;
    if (nearest.length < 15) return null;
    const z = zOf(me);
    const mine = kthNearest(z, zs, -1);
    if (mine == null) return null;
    const stand = Object.entries(z).filter(([, v]) => Math.abs(v) >= 1.2).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 3)
      .map(([k, v]) => { const t = RARE_TRAITS.find((x) => x[0] === k); return v > 0 ? t[1] : t[2]; });
    return { score: Math.round((nearest.filter((x) => x < mine).length / nearest.length) * 100), stand, n: nearest.length };
  }
  // How much each trait counts toward looking alike: the shape (the break) and where it's let go count most; velo, VAA,
  // extension and arm path next; spin direction as is; spin rate and efficiency least, as their work already shows in the break
  const RARE_WEIGHTS = { ivb: 2, hb: 2, relHeight: 2, relSide: 1.5, ext: 1.5, armAngle: 1.5, velo: 1.5, vaa: 1.5, tilt: 1, spin: 0.75, eff: 0.75 };
  // the distance between two pitches' traits: the weighted root mean square over the traits both have (at least four)
  const traitDistance = (a, b) => { let s = 0, w = 0, c = 0; for (const k in a) if (b[k] != null) { const wt = RARE_WEIGHTS[k] || 1; s += wt * (a[k] - b[k]) ** 2; w += wt; c++; } return c >= 4 ? Math.sqrt(s / w) : null; };
  // the distance to the 5th most similar pitch (skipping the pitch itself, at index `skip`)
  const kthNearest = (z, zs, skip) => {
    const ds = [];
    for (let i = 0; i < zs.length; i++) { if (i === skip) continue; const d = traitDistance(z, zs[i]); if (d != null) ds.push(d); }
    if (ds.length < KNN) return null;
    ds.sort((x, y) => x - y);
    return ds[KNN - 1];
  };
  function rarityBase(pop) {
    const stats = {};
    RARE_TRAITS.forEach(([k]) => {
      let xs = pop.map((p) => p[k]).filter((v) => v != null && Number.isFinite(v));
      if (xs.length < 15) return;
      let center = 0;
      if (k === "tilt") { const a = xs.map((x) => (x / 720) * 2 * Math.PI); center = (Math.atan2(a.reduce((s, x) => s + Math.sin(x), 0), a.reduce((s, x) => s + Math.cos(x), 0)) / (2 * Math.PI)) * 720; }
      const rel = (v) => (k === "tilt" ? ((((v - center) % 720) + 1080) % 720) - 360 : v);
      xs = xs.map(rel);
      const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
      const sd = Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length) || 1;
      stats[k] = { rel, mean, sd };
    });
    const zOf = (p) => { const z = {}; Object.entries(stats).forEach(([k, s]) => { if (p[k] != null && Number.isFinite(p[k])) z[k] = (s.rel(p[k]) - s.mean) / s.sd; }); return z; };
    const zs = pop.map(zOf);
    const nearest = zs.map((z, i) => kthNearest(z, zs, i)).filter((x) => x != null);
    return { zOf, zs, nearest };
  }
  const rarityColor = (s) => `hsl(${Math.round(210 - (s / 100) * 210)}, 70%, 45%)`;

  // ---- grips: a search for a comp's grip, and screenshots coaches add (the public "grips" storage,
  // supabase/migration_033_grips.sql), one per pitcher and pitch, shown wherever that pitcher's pitch comes up
  const GRIPS = "grips";
  let gripIndexP = null;
  const gripIndex = (fresh) => {
    if (!gripIndexP || fresh) gripIndexP = window.supabaseClient.storage.from(GRIPS).list("", { limit: 1000, sortBy: { column: "name", order: "asc" } })
      .then(({ data }) => new Map((data || []).map((f) => [f.name.replace(/\.\w+$/, ""), f.name])), () => new Map());
    return gripIndexP;
  };
  function GripCell({ pitcherId, code, name, pitch }) {
    const key = `${pitcherId}-${code}`;
    const [file, setFile] = useState(null);
    const [stamp, setStamp] = useState(0);
    const [busy, setBusy] = useState(false);
    const ref = useRef(null);
    useEffect(() => { let off = false; gripIndex().then((m) => { if (!off) setFile(m.get(key) || null); }); return () => { off = true; }; }, [key]);
    const url = file ? `${window.supabaseClient.storage.from(GRIPS).getPublicUrl(file).data.publicUrl}${stamp ? `?v=${stamp}` : ""}` : null;
    const add = async (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = "";
      if (!f) return;
      setBusy(true);
      const ext = (((f.name || "").match(/\.(\w{2,4})$/) || [])[1] || "jpg").toLowerCase();
      const path = `${key}.${ext}`;
      const { error } = await window.supabaseClient.storage.from(GRIPS).upload(path, f, { upsert: true, contentType: f.type || "image/jpeg" });
      setBusy(false);
      if (error) { window.alert(/bucket not found/i.test(error.message || "") ? "Grip screenshots need supabase/migration_033_grips.sql run once in the SQL Editor." : "Couldn't add the screenshot. Check your connection and try again."); return; }
      await gripIndex(true);
      setFile(path); setStamp(Date.now());
    };
    const q = encodeURIComponent(`${name} ${pitch} grip`);
    return (
      <span className="bp-grip">
        {url && <a href={url} target="_blank" rel="noopener noreferrer" title={`${name}'s ${pitch} grip`}><img src={url} alt={`${name}'s ${pitch} grip`} /></a>}
        <a className="bp-grip-btn" href={`https://www.google.com/search?tbm=isch&q=${q}`} target="_blank" rel="noopener noreferrer" title={`Search for ${name}'s ${pitch} grip`}>🔍</a>
        <button type="button" className="bp-grip-btn" disabled={busy} title={url ? "Replace the grip screenshot" : "Add a screenshot of his grip"} onClick={() => ref.current && ref.current.click()}>📷</button>
        <input ref={ref} type="file" accept="image/*" hidden onChange={add} />
      </span>
    );
  }

  // `stats` is a bullpen's pitch types (typeStats), or, given `season`, the pitcher's own MLB arsenal that season
  // (each with its results as `res`), compared with everyone else's
  // `meLabel` names the pitch's own row (default: this session); `nowStat`, given, is the same pitch as it is now, for
  // rarity now beside the designed pitch's (Pitch Design)
  function CompsModule({ athlete, stats, season: fixed, mlbId, meLabel, nowStat }) {
    const fromMlb = fixed != null;
    const myId = String(mlbId || mlbIdOf(athlete));
    const [picked, setSeason] = useState(defaultSeason);
    const season = fromMlb ? fixed : picked;
    const [hand, setHandState] = useState(athlete.throws || "");
    const [data, setData] = useState({}); // pitch type -> { list, error }
    const [loading, setLoading] = useState(false);
    const [ars, setArs] = useState(() => new Map()); // "id|code" -> results, for DST pitchers who've pitched in MLB
    const mine = stats.filter((s) => s.type !== UNTAGGED && codesOf(s.type));
    const key = mine.map((s) => s.type).join("|");
    const setHand = (h) => { setHandState(h); try { window.AthleteStore.updateAthlete(athlete.id, { throws: h }); } catch (e) { /* kept for this visit */ } };
    useEffect(() => { if (athlete.throws && athlete.throws !== hand) setHandState(athlete.throws); }, [athlete.throws]); // eslint-disable-line
    useEffect(() => {
      let off = false;
      setLoading(true);
      Promise.all([arsenalStats(season), ...mine.map((s) => mlbPitchers(codesOf(s.type), season).then((list) => [s.type, { list }], (e) => [s.type, { list: [], error: String((e && e.message) || e) }]))])
        .then(([arsMap, ...pairs]) => {
          if (off) return;
          const next = Object.fromEntries(pairs);
          setArs(arsMap);
          // the pitcher's own hand, from Savant, when they're on it and it isn't set yet
          if (!hand && myId) {
            const me = pairs.flatMap((p) => p[1].list).find((p) => p.id === myId);
            if (me && me.hand) setHand(me.hand);
          }
          setData(next); setLoading(false);
        });
      return () => { off = true; };
    }, [season, key]); // eslint-disable-line
    const h = hand || "R";
    return (
      <div className="bp-comps">
        <div className="bp-comps-bar">
          <span className="pill-tabs bp-scope" role="group" aria-label="Throws">
            <button type="button" className={`pill-tab ${h === "R" ? "active" : ""}`} onClick={() => setHand("R")}>Throws R</button>
            <button type="button" className={`pill-tab ${h === "L" ? "active" : ""}`} onClick={() => setHand("L")}>Throws L</button>
          </span>
          {!fromMlb && (
            <select className="bp-tag" value={season} aria-label="MLB season" onChange={(e) => setSeason(Number(e.target.value))}>
              {[0, 1, 2, 3].map((k) => defaultSeason() - k).map((y) => <option key={y} value={y}>{y} MLB season</option>)}
            </select>
          )}
          {!hand && <span className="timestamp-note">Set which hand he throws with, so he's compared with the right pitchers.</span>}
          {loading && <span className="timestamp-note">Loading Baseball Savant…</span>}
        </div>
        {mine.map((s) => {
          const d = data[s.type] || { list: [] };
          const codes = codesOf(s.type);
          const mlb = d.list.filter((p) => p.hand === h && p.id !== myId);
          const dst = dstPitchers(athlete, codes).filter((p) => !p.hand || p.hand === h)
            .map((p) => ({ ...p, res: p.mlbamId ? codes.map((c) => ars.get(`${p.mlbamId}|${c}`)).find(Boolean) || null : null }));
          const pool = [...mlb, ...dst];
          // the pitch's traits on Savant's footing: break by arm side (TrackMan's is the pitcher's view), release side
          // as distance from the middle
          const meOf = (x) => ({
            velo: x.speedAvg, ivb: x.ivb, hb: x.hbArm != null ? x.hbArm : x.hb == null ? null : h === "L" ? -x.hb : x.hb, spin: x.spinAvg,
            relHeight: x.relHeight, relSide: x.relSide != null ? Math.abs(x.relSide) : null, ext: x.extension, vaa: x.vaa, tilt: x.tilt, eff: x.spinEff, armAngle: x.armAngle,
          });
          const me = meOf(s);
          const rare = rarityOf(me, mlb), rareNow = nowStat ? rarityOf(meOf(nowStat), mlb) : null;
          const comps = pool.map((p) => ({ ...p, match: matchOf(me, p) })).filter((p) => p.match != null).sort((a, b) => b.match - a.match).slice(0, 5);
          const resPool = mlb.map((p) => p.res);
          const meMlb = myId ? d.list.find((p) => p.id === myId) : null;
          // are the comps good pitches? their average results, ranked among everyone's
          const withRes = comps.filter((p) => p.res);
          const avgOf = (k) => { const xs = withRes.map((p) => p.res[k]).filter((v) => v != null); return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; };
          const verdict = withRes.length ? RESULTS.filter(([k]) => k !== "usage").map(([k, label, fmt, good]) => {
            const v = avgOf(k);
            if (v == null) return null;
            const p = goodPct(v, resPool.map((r) => (r ? r[k] : null)), good);
            return `${label} ${fmt(k === "xwoba" ? v : Math.round(v * 10) / 10)}${p != null ? ` (${ordinal(p)} pct.)` : ""}`;
          }).filter(Boolean) : [];
          const pcts = [["Velo", pctOf(me.velo, mlb.map((p) => p.velo)), `${show(me.velo)} mph`], ["IVB", pctOf(me.ivb, mlb.map((p) => p.ivb)), `${show(me.ivb)} in`], ["Arm-side run", pctOf(me.hb, mlb.map((p) => p.hb)), `${show(me.hb)} in`], ["Spin", pctOf(me.spin, mlb.map((p) => p.spin)), `${show(me.spin)} rpm`], ["Release ht", pctOf(me.relHeight, mlb.map((p) => p.relHeight)), ftIn(me.relHeight)], ["Release side", pctOf(me.relSide, mlb.map((p) => p.relSide)), ftIn(me.relSide)], ["Extension", pctOf(me.ext, mlb.map((p) => p.ext)), ftIn(me.ext)], ["VAA", pctOf(me.vaa, mlb.map((p) => p.vaa)), deg(me.vaa)]];
          return (
            <div key={s.type} className="bp-comp-type">
              <h4><span className="bp-dot" style={{ background: colorOf(s.type) }} />{s.type} <small>vs {season} {h === "L" ? "left" : "right"}-handed {codes.join("/")}s{mlb.length ? ` (${mlb.length} MLB pitchers)` : ""}</small></h4>
              {d.error ? <p className="assess-row-note">Couldn't reach Baseball Savant ({d.error}).</p> : (
                <React.Fragment>
                  {rare && (
                    <p className="bp-rarity">
                      <span className="bp-rarity-score" style={{ background: rarityColor(rare.score) }} title="0 is as ordinary as they come, 100 as unusual">Rarity {rare.score}</span>
                      {rareNow && <span className="bp-rarity-now">now {rareNow.score}</span>}
                      <span>more unusual than {rare.score}% of {season} {h === "L" ? "lefty" : "righty"} {codes.join("/")}s{rare.stand.length ? `, for ${rare.stand.length < 2 ? rare.stand[0] : `${rare.stand.slice(0, -1).join(", ")} and ${rare.stand[rare.stand.length - 1]}`}` : ", close to the usual shape"}</span>
                    </p>
                  )}
                  <div className="bp-pcts">
                    {pcts.map(([label, p, val]) => (
                      <span key={label} className="bp-pct" title={p == null ? "Not enough to compare" : `${label} ${val}: higher than ${p}% of them`}>
                        <span className="bp-pct-label">{label}</span><b>{val}</b>
                        <span className="bp-pct-bar"><i style={{ width: `${p == null ? 0 : Math.max(3, p)}%`, background: p == null ? "transparent" : `hsl(${Math.round(210 - (p / 100) * 210)}, 70%, 50%)` }} /></span>
                        <small>{p == null ? "–" : ordinal(p)}</small>
                      </span>
                    ))}
                  </div>
                  {comps.length > 0 ? (
                    <div className="bp-table-wrap">
                      <table className="assess-table bp-table bp-comp-table">
                        <thead><tr><th>Closest 5</th><th>Velo</th><th>IVB</th><th>HB</th><th>Spin</th><th>Rel. ht</th><th>Rel. side</th><th>Ext.</th><th>VAA</th><th>Arm angle</th><th>Match</th>{resHeads()}<th>Grip</th></tr></thead>
                        <tbody>
                          <tr className="bp-comp-me"><td>{athlete.name} <small>{meLabel || (fromMlb ? `${season} MLB games` : "this session")}</small></td><td>{show(me.velo)}</td><td>{show(me.ivb)}</td><td>{show(me.hb)}</td><td>{show(me.spin)}</td><td>{ftIn(me.relHeight)}</td><td>{ftIn(me.relSide)}</td><td>{ftIn(me.ext)}</td><td>{deg(me.vaa)}</td><td>{me.armAngle != null ? `${me.armAngle}°` : "–"}</td><td></td>{fromMlb ? resCells(s.res, resPool) : RESULTS.map(([k], i) => <td key={k} className={i === 0 ? "bp-res-first" : ""}></td>)}<td></td></tr>
                          {meMlb && !fromMlb && (
                            <tr className="bp-comp-me"><td>{athlete.name} <small>{season} MLB games</small></td><td>{show(meMlb.velo)}</td><td>{show(meMlb.ivb)}</td><td>{show(meMlb.hb)}</td><td>{show(meMlb.spin)}</td><td>{ftIn(meMlb.relHeight)}</td><td>{ftIn(meMlb.relSide)}</td><td>{ftIn(meMlb.ext)}</td><td>{deg(meMlb.vaa)}</td><td>{meMlb.armAngle != null ? `${meMlb.armAngle}°` : "–"}</td><td></td>{resCells(meMlb.res, resPool)}<td></td></tr>
                          )}
                          {comps.map((p) => (
                            <tr key={p.id}>
                              <td>{p.dst ? p.name : <a href={`https://baseballsavant.mlb.com/savant-player/${p.id}`} target="_blank" rel="noopener noreferrer">{p.name}</a>}{p.dst ? <span className="bp-dst-tag">DST</span> : <small> {p.team}</small>}</td>
                              <td>{show(p.velo)}</td><td>{show(p.ivb)}</td><td>{show(p.hb)}</td><td>{show(p.spin)}</td><td>{ftIn(p.relHeight)}</td><td>{ftIn(p.relSide)}</td><td>{ftIn(p.ext)}</td><td>{deg(p.vaa)}</td><td>{p.armAngle != null ? `${p.armAngle}°` : "–"}</td><td><b>{p.match}%</b></td>{resCells(p.res, resPool)}
                              <td>{p.dst ? "" : <GripCell pitcherId={p.id} code={p.code} name={p.name} pitch={String(CODE_TYPE[p.code] || s.type).toLowerCase()} />}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : !loading && <p className="assess-row-note">No comps found for this pitch yet.</p>}
                  {verdict.length > 0 && <p className="bp-comp-verdict"><b>The {withRes.length} closest{withRes.length < comps.length ? " with MLB results" : ""}, on average:</b> {verdict.join(" · ")}<span className="timestamp-note"> Percentile among {season} {h === "L" ? "lefty" : "righty"} {codes.join("/")}s; higher is better for the pitcher.</span></p>}
                </React.Fragment>
              )}
            </div>
          );
        })}
        <p className="timestamp-note">MLB numbers are each pitcher's season averages on Baseball Savant (at least 50 of that pitch); DST rows are our other pitchers' bullpens. Percentiles are among MLB pitchers throwing that pitch with the same hand. Match weighs velo, IVB, horizontal break, spin, release height, release side, extension and VAA together (release side as distance from the middle of the rubber; MLB VAA worked out from each pitcher's average release, velo, IVB and plate height, as a bullpen's is), and the closest five are shown. Rarity is how few MLB pitches of its type, thrown with the same hand, look like it, across velo, break, spin and its efficiency and direction, release height and side, extension, VAA and arm angle (break and release height count most; release side, extension, arm angle, velo and VAA next; spin rate and efficiency least): 99 means fewer pitches look like it than for 99% of MLB pitches, 0 that it has plenty of company. It measures how unusual the shape is, not how good the pitch is. Bullpen numbers run a little different from game ones (intensity, a different tracking system), so read comps as a shape match, not a projection. Usage, whiff, put-away, xwOBA and run value are each pitcher's results with that pitch in MLB games that season (Savant's pitch arsenal stats; run value is the pitcher's, plus is runs saved), shaded red for better than most of that pitch, blue for worse; hover a number for its rank and pitch count. A small sample (a reliever's third pitch) can swing them a lot.</p>
      </div>
    );
  }

  // the pitcher's own MLB arsenal, for a pitcher linked to MLB who pitched that season: every pitch he threw in
  // games, its shape and how it did, ranked among the same pitch from pitchers of his hand
  // `full` (the Statcast tab) adds each pitch's spinning ball and its comps, all from Savant
  function MlbArsenal({ athlete, mlbId, full }) {
    const id = String(mlbId || mlbIdOf(athlete));
    const [season, setSeason] = useState(defaultSeason);
    const [st, setSt] = useState({ loading: true, rows: [], error: "" });
    const [spinCtl, setSpinCtl] = useSpinCtl();
    const [zoomBall, setZoomBall] = useState(null);
    useEffect(() => {
      let off = false;
      setSt((s) => ({ ...s, loading: true }));
      mlbArsenal(id, athlete.throws, season)
        .then((rows) => { if (!off) setSt({ loading: false, rows, error: "" }); }, (e) => { if (!off) setSt({ loading: false, rows: [], error: String((e && e.message) || e) }); });
      return () => { off = true; };
    }, [id, athlete.throws, season]);
    const total = st.rows.reduce((n, r) => n + (r.res.pitches || 0), 0);
    // the arsenal as pitch types, the way the balls and comps take a bullpen's
    const asTypes = st.rows.filter((r) => CODE_TYPE[r.code]).map((r) => ({
      type: CODE_TYPE[r.code], qty: r.res.pitches, speedAvg: r.velo, ivb: r.ivb, hb: r.hb, hbArm: r.hb, spinAvg: r.spin != null ? Math.round(r.spin) : r.spinRate, relHeight: r.relHeight, extension: r.ext, relSide: r.relSide, vaa: r.vaa, armAngle: r.armAngle,
      tilt: r.tilt, spinEff: r.spinEff, res: r.res,
    }));
    const balls = asTypes.filter((s) => s.spinAvg != null);
    return (
      <div className="bp-comps">
        <div className="bp-comps-bar">
          <select className="bp-tag" value={season} aria-label="MLB season" onChange={(e) => setSeason(Number(e.target.value))}>
            {[0, 1, 2, 3].map((k) => defaultSeason() - k).map((y) => <option key={y} value={y}>{y} MLB season</option>)}
          </select>
          {st.loading && <span className="timestamp-note">Loading Baseball Savant…</span>}
          {!st.loading && total > 0 && <span className="timestamp-note">{total.toLocaleString()} pitches · <a href={`https://baseballsavant.mlb.com/savant-player/${id}`} target="_blank" rel="noopener noreferrer">Savant page</a></span>}
        </div>
        {st.error ? <p className="assess-row-note">Couldn't reach Baseball Savant ({st.error}).</p>
          : !st.loading && !st.rows.length ? <p className="assess-row-note">No MLB pitches for him in {season}.</p>
          : st.rows.length > 0 && (
            <div className="bp-table-wrap">
              <table className="assess-table bp-table bp-comp-table">
                <thead><tr><th>Pitch</th><th>Pitches</th><th>Velo</th><th>IVB</th><th>HB</th><th>Spin</th><th>Ext.</th>{resHeads()}</tr></thead>
                <tbody>
                  {st.rows.map((r) => (
                    <tr key={r.code}>
                      <td><span className="bp-dot" style={{ background: colorOf(CODE_TYPE[r.code]) }} />{r.res.pitchName || r.code}</td>
                      <td>{show(r.res.pitches)}</td><td>{show(r.velo)}</td><td>{show(r.ivb)}</td><td>{show(r.hb)}</td><td>{show(r.spin)}</td><td>{ftIn(r.ext)}</td>{resCells(r.res, r.pool)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        <p className="timestamp-note">His MLB regular-season games on Baseball Savant. Shape shows once he's thrown 50 of a pitch. Results are shaded against the same pitch from {athlete.throws === "L" ? "left" : athlete.throws === "R" ? "right" : "same"}-handed pitchers who threw at least 50 (red better, blue worse); hover for the rank.</p>
        {full && balls.length > 0 && (
          <div className="bp-savant-sec">
            <div className="bp-savant-head"><h3>Spin by pitch <small>{season} MLB, {spinCtl.pov === "pitcher" ? "pitcher's view" : "catcher's view"}</small></h3><SpinControls ctl={spinCtl} set={setSpinCtl} /></div>
            <div className="bp-balls">{balls.map((s) => <SpinBall key={s.type} s={s} ctl={spinCtl} onZoom={() => setZoomBall(s.type)} />)}</div>
            <p className="timestamp-note">Each ball turns on that pitch's average spin axis in his MLB games (Savant's measured spin direction, on the pitcher's clock like TrackMan's tilt) and its active spin, which is Savant's spin efficiency (gyro is the rest). Click a ball to zoom in.</p>
            {zoomBall && <SpinZoom list={balls} type={zoomBall} onType={setZoomBall} ctl={spinCtl} set={setSpinCtl} />}
          </div>
        )}
        {full && asTypes.some((s) => codesOf(s.type)) && (
          <div className="bp-savant-sec">
            <div className="bp-savant-head"><h3>Comps <small>the MLB pitchers whose {season} pitches are shaped most like his</small></h3></div>
            <CompsModule athlete={athlete} stats={asTypes} season={season} mlbId={id} />
          </div>
        )}
      </div>
    );
  }

  // how a coach has arranged a session's modules (order, half width, folded away), kept per coach on this computer
  const DEFAULT_LAYOUT = { order: ["types", "goals", "movement", "release", "spin", "comps", "arsenal", "pitches", "trend", "notes"], half: { movement: true, release: true }, closed: { pitches: true } };
  const layoutKey = () => `bullpenLayout:${(window.AthleteStore.currentUserEmail && window.AthleteStore.currentUserEmail()) || "me"}`;
  const readLayout = () => {
    try { const v = JSON.parse(localStorage.getItem(layoutKey()) || "null"); if (v && Array.isArray(v.order)) return { order: v.order, half: v.half || {}, closed: v.closed || {} }; } catch (e) { /* private window */ }
    return DEFAULT_LAYOUT;
  };
  const writeLayout = (v) => { try { localStorage.setItem(layoutKey(), JSON.stringify(v)); } catch (e) { /* private window: not remembered */ } };

  function SessionDetail({ session, sessions, onSave, athlete }) {
    const stats = typeStats(session);
    const live = livePitches(session);
    const removed = (session.pitches || []).filter((p) => p.removed);
    const [notes, setNotes] = useState(session.notes || "");
    const timer = useRef(null);
    const latest = useRef(session);
    latest.current = session;
    const total = live.length || stats.reduce((n, s) => n + s.qty, 0);
    const changeNotes = (v) => { setNotes(v); clearTimeout(timer.current); timer.current = setTimeout(() => onSave({ ...latest.current, notes: v }), 500); };
    // changes one session's pitches: this one, or (from a chart showing every session) another
    const editPitches = (nos, patch, sid) => {
      const base = !sid || sid === latest.current.id ? { ...latest.current, notes } : (sessions || []).find((s) => s.id === sid);
      if (base) onSave({ ...base, pitches: (base.pitches || []).map((p) => (nos.includes(p.no) ? { ...p, ...patch } : p)) });
    };
    // tagging pitches after the fact: from a dot on a chart, from its row, or every checked row at once
    const untagged = live.filter((p) => !p.type).length;
    const [checked, setChecked] = useState([]);
    const [picked, setPicked] = useState(null); // the pitch clicked on a chart
    const [focus, setFocus] = useState([]); // pitch types picked in the charts' key; the others dim (none picked: all show)
    const [chartShow, setChartShowState] = useState(() => { try { return localStorage.getItem("bullpenChartShow") || "both"; } catch (e) { return "both"; } });
    const setChartShow = (v) => { setChartShowState(v); if (v === "avgs") setPicked(null); try { localStorage.setItem("bullpenChartShow", v); } catch (e) { /* not remembered */ } };
    const [spinCtl, setSpinCtl] = useSpinCtl();
    const [zoomBall, setZoomBall] = useState(null); // the pitch type whose ball is open large
    const toggleFocus = (t) => setFocus((f) => (f.includes(t) ? f.filter((x) => x !== t) : [...f, t]));
    const tagOptions = [...new Set([...TAG_TYPES, ...(session.pitches || []).map((p) => p.type).filter(Boolean)])].sort(byType);
    const retag = async (nos, value, sid) => {
      let type = value;
      if (value === "__other") {
        type = await window.askText({ title: "Tag as", text: "The pitch type's name, e.g. Gyro Slider.", placeholder: "Pitch type", ok: "Tag", maxLength: 30 });
        if (!type) return;
      }
      editPitches(nos, { type, typeGuessed: false, retagged: true }, sid);
      setChecked([]);
    };
    // a session's Edgertronic video: which pitch's clip is open, and saving a change to the clips
    const [vid, setVid] = useState(null); // { sid, no }
    const saveVideo = (sid, video) => {
      const base = !sid || sid === latest.current.id ? { ...latest.current, notes } : (sessions || []).find((s) => s.id === sid);
      if (!base) return;
      const next = { ...base };
      if (video) next.video = video; else delete next.video;
      onSave(next);
    };
    const sessionOf = (sid) => (!sid || sid === session.id ? session : (sessions || []).find((s) => s.id === sid)) || session;
    const BV = window.BullpenVideo;
    const removePitches = (nos, sid) => { editPitches(nos, { removed: true }, sid); setChecked([]); setPicked(null); };
    const toggle = (no) => setChecked((c) => (c.includes(no) ? c.filter((x) => x !== no) : [...c, no]));
    const tagSelect = (value, onPick, label) => (
      <select className="bp-tag" value={value} aria-label={label} onChange={(e) => onPick(e.target.value)}>
        <option value="">Untagged</option>
        {tagOptions.map((t) => <option key={t} value={t}>{t}</option>)}
        <option value="__other">Other…</option>
      </select>
    );
    const vaaNote = live.some((p) => p.vaa != null);
    // the pitcher's pitch design goals, to hold this bullpen up against (Pitch Design tab)
    const goalPlan = athlete && window.AthleteStore.getPitchDesign ? window.AthleteStore.getPitchDesign(athlete.id) : null;

    // the two charts, for this session or every session (remembered on this computer)
    const [scope, setScopeState] = useState(() => { try { return localStorage.getItem("bullpenChartScope") || "session"; } catch (e) { return "session"; } });
    const setScope = (v) => { setScopeState(v); setPicked(null); try { localStorage.setItem("bullpenChartScope", v); } catch (e) { /* private window */ } };
    const many = (sessions || []).length > 1;
    const all = scope === "all" && many;
    const chartPitches = (all ? sessions : [session]).flatMap((s) => livePitches(s).map((p) => ({ ...p, sid: s.id, key: `${s.id}:${p.no}`, dateLabel: all ? shortDate(s.date) : "" })));
    const chartStats = all ? typeStats({ pitches: chartPitches }) : stats;
    const mv = chartPitches.filter((p) => typeof p.hb === "number" && typeof p.ivb === "number").map((p) => ({ ...p, x: p.hb, y: p.ivb }));
    const mvR = Math.max(25, Math.ceil(Math.max(0, ...mv.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y)))) / 5) * 5 + 5);
    const rl = chartPitches.filter((p) => typeof p.relSide === "number" && typeof p.relHeight === "number").map((p) => ({ ...p, x: -p.relSide, y: p.relHeight })); // mirrored: TrackMan's release side is the pitcher's, this is the catcher's view
    const rlX = rangeOf(rl.map((p) => p.x), [-4, 4], 1), rlY = rangeOf(rl.map((p) => p.y), [0, 7], 1);
    const pk = picked != null ? chartPitches.find((p) => p.key === picked) : null;

    // the charts' pitch key: click a type to bring it forward (the others dim), click more to add them, again to drop one
    const pitchKey = (
      <div className="bp-key" role="group" aria-label="Pitch types on the charts">
        {chartStats.map((s) => {
          const on = focus.includes(s.type), off = focus.length > 0 && !on;
          return (
            <button key={s.type} type="button" className={`bp-key-chip${on ? " on" : ""}${off ? " off" : ""}`} aria-pressed={on} title={on ? `Stop picking out ${s.type}` : `Pick out ${s.type}`} onClick={() => toggleFocus(s.type)}>
              <span className="bp-dot" style={{ background: s.type === UNTAGGED ? "transparent" : colorOf(s.type) }} />{s.type} <small>{s.qty}</small>
            </button>
          );
        })}
        {focus.length > 0 && <button type="button" className="bp-key-all" onClick={() => setFocus([])}>Show all</button>}
        <span className="pill-tabs bp-scope bp-show" role="group" aria-label="Show on the charts">
          {[["both", "Pitches + averages"], ["pitches", "Pitches"], ["avgs", "Averages"]].map(([k, label]) => <button key={k} type="button" className={`pill-tab ${chartShow === k ? "active" : ""}`} onClick={() => setChartShow(k)}>{label}</button>)}
        </span>
      </div>
    );
    // ---- the report's modules, which a coach can arrange: drag one by its ⋮⋮, make it half or full width, fold it
    // away. The arrangement is kept per coach on this computer.
    const scopeToggle = many ? (
      <span className="pill-tabs bp-scope" role="group" aria-label="Charts show">
        <button type="button" className={`pill-tab ${!all ? "active" : ""}`} onClick={() => setScope("session")}>This session</button>
        <button type="button" className={`pill-tab ${all ? "active" : ""}`} onClick={() => setScope("all")}>All ({sessions.length})</button>
      </span>
    ) : null;
    const spinStats = stats.filter((s) => s.spinAvg != null && s.type !== UNTAGGED);
    const spinControls = <SpinControls ctl={spinCtl} set={setSpinCtl} />;
    const modules = {
      types: {
        title: "Pitch types",
        body: (
          <React.Fragment>
            <div className="bp-counts">
              {stats.map((s) => <span key={s.type} className="bp-count"><span className="bp-dot" style={{ background: colorOf(s.type) }} />{s.type} <b>{s.qty}</b></span>)}
            </div>
            <div className="bp-table-wrap">
              <table className="assess-table bp-table">
                <thead><tr><th>Pitch type</th><th>Qty</th><th>Velo avg</th><th>Velo max</th><th>Spin</th><th>IVB</th><th>HB</th><th title="Vertical approach angle at the plate, estimated">VAA</th><th>Rel. ht</th><th>Rel. side</th><th>Ext.</th><th>Spin eff.</th></tr></thead>
                <tbody>
                  {stats.map((s) => (
                    <tr key={s.type}>
                      <td><span className="bp-dot" style={{ background: colorOf(s.type) }} />{s.type}</td>
                      <td>{s.qty}</td><td>{show(s.speedAvg)}</td><td>{show(s.speedMax)}</td><td>{show(s.spinAvg)}</td>
                      <td>{show(s.ivb)}</td><td>{show(s.hb)}</td><td>{deg(s.vaa)}</td><td>{ftIn(s.relHeight)}</td><td>{ftIn(s.relSide)}</td><td>{ftIn(s.extension)}</td><td>{show(s.spinEff, s.spinEff != null ? "%" : "")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="timestamp-note">Velocity in mph, spin in rpm, break in inches. IVB, HB and spin efficiency are averaged from the pitches; a pitch TrackMan left blank is left out.{vaaNote ? " VAA (vertical approach angle) isn't in TrackMan's report: it's estimated from each pitch's release height, extension, velo, IVB and where it crossed the plate on the report's location chart, so read it as within about half a degree. Up in the zone it's flatter (closer to 0); low it's steeper." : ""}</p>
          </React.Fragment>
        ),
      },
      movement: {
        title: "Movement", sub: all ? `every session, ${mv.length} pitches` : "", extra: scopeToggle,
        body: (
          <React.Fragment>
            {pitchKey}
            <ScatterChart pts={mv} avgs={chartStats.filter((s) => s.ivb != null && s.hb != null && s.type !== UNTAGGED).map((s) => ({ type: s.type, x: s.hb, y: s.ivb, tip: `${s.ivb} IVB, ${s.hb} HB, ${s.speedAvg} mph, ${s.qty} pitches` }))}
              xr={[-mvR, mvR]} yr={[-mvR, mvR]} step={10} xLabel="Horz. break (in)" yLabel="Induced vert. break (in)" label="Movement: horizontal break by induced vertical break, one dot per pitch"
              picked={picked} onPick={setPicked} focus={focus} show={chartShow} tip={(p) => `${p.ivb} IVB, ${p.hb} HB, ${p.speed} mph`} />
            <p className="timestamp-note">Click a pitch to see it, change its type or take it out. Ringed dots are each type's average; show just the pitches or just the averages with the switch above.</p>
          </React.Fragment>
        ),
      },
      release: {
        title: "Release point", sub: all ? "catcher's view, every session" : "catcher's view", extra: scopeToggle,
        body: (
          <React.Fragment>
            {pitchKey}
            <ScatterChart pts={rl} avgs={chartStats.filter((s) => s.relHeight != null && s.relSide != null && s.type !== UNTAGGED).map((s) => ({ type: s.type, x: -s.relSide, y: s.relHeight, tip: `${ftIn(s.relHeight)} high, ${ftIn(s.relSide)} side, ${s.qty} pitches` }))}
              xr={rlX} yr={rlY} step={1} xLabel="Release side (ft)" yLabel="Release height (ft)" label="Release point: release side by release height, one dot per pitch"
              picked={picked} onPick={setPicked} focus={focus} show={chartShow} tip={(p) => `${ftIn(p.relHeight)} high, ${ftIn(p.relSide)} side`} />
            <p className="timestamp-note">Click a pitch to see it, change its type or take it out. Ringed dots are each type's average; show just the pitches or just the averages with the switch above.</p>
          </React.Fragment>
        ),
      },
      spin: spinStats.length ? {
        title: "Spin by pitch type", sub: spinCtl.pov === "pitcher" ? "pitcher's view" : "catcher's view",
        extra: spinControls,
        body: (
          <React.Fragment>
            <div className="bp-balls">{spinStats.map((s) => <SpinBall key={s.type} s={s} ctl={spinCtl} onZoom={() => setZoomBall(s.type)} />)}</div>
            <p className="timestamp-note">Each ball turns on its pitch's average spin axis, seen from behind the pitcher or from the catcher, faster for more spin (though far slower than the real thing). The arrow is the way the spin moves the ball as seen from that side; TrackMan's tilt is the pitcher's clock (12:00 is straight backspin). Sinkers and two-seamers spin with a two-seam orientation, everything else four-seam. Spin efficiency and gyro add up to 100%: 100% efficient is pure backspin or sidespin, 0% is all gyro (bullet spin, the axis pointing at the catcher), and the ball's axis leans by that split. Active spin (spin × efficiency) is the part that moves the ball; gyro spin is the rest, turning it like a bullet. Click a ball to zoom in.</p>
          </React.Fragment>
        ),
      } : null,
      pitches: {
        title: "Every pitch", sub: `${total}${untagged > 0 ? ` · ${untagged} untagged` : ""}`,
        body: (
          <React.Fragment>
            <div className="bp-bulk">
              {checked.length > 0
                ? <React.Fragment><span>Tag the {checked.length} checked as</span>{tagSelect("", (v) => retag(checked, v), "Tag the checked pitches as")}<button type="button" className="btn btn-secondary" onClick={() => removePitches(checked)}>Remove them</button><button type="button" className="btn btn-secondary" onClick={() => setChecked([])}>Clear</button></React.Fragment>
                : <span className="timestamp-note">Change a pitch's type from its row, or check several to tag or remove them together.</span>}
            </div>
            <div className="bp-table-wrap">
              <table className="assess-table bp-table">
                <thead><tr><th aria-label="Check"></th><th>#</th><th>Type</th><th>Velo</th><th>Spin</th><th>Tilt</th><th>IVB</th><th>HB</th><th title="Vertical approach angle, estimated">VAA</th><th>Plate ht</th><th>Ext.</th><th>Rel. ht</th><th>Rel. side</th><th>Spin eff.</th><th aria-label="Video"></th><th aria-label="Remove"></th></tr></thead>
                <tbody>
                  {live.map((p) => (
                    <tr key={p.no} className={`${p.type ? "" : "bp-untagged-row"}${picked === `${session.id}:${p.no}` ? " bp-picked-row" : ""}`}>
                      <td><input type="checkbox" checked={checked.includes(p.no)} onChange={() => toggle(p.no)} aria-label={`Check pitch ${p.no}`} /></td>
                      <td>{p.no}</td>
                      <td className="bp-type-cell"><span className="bp-dot" style={{ background: p.type ? colorOf(p.type) : "transparent" }} />{tagSelect(p.type || "", (v) => retag([p.no], v), `Pitch ${p.no} type`)}</td>
                      <td>{show(p.speed)}</td><td>{show(p.spin)}</td><td>{show(p.tilt)}</td><td>{show(p.ivb)}</td><td>{show(p.hb)}</td>
                      <td>{deg(p.vaa)}</td><td>{ftIn(p.plateHeight)}</td>
                      <td>{ftIn(p.extension)}</td><td>{ftIn(p.relHeight)}</td><td>{ftIn(p.relSide)}</td><td>{show(p.spinEff, p.spinEff != null ? "%" : "")}</td>
                      <td>{BV && BV.hasClip(session, p.no) ? <BV.CameraButton label={`Watch pitch ${p.no}`} onClick={() => setVid({ sid: session.id, no: p.no })} /> : null}</td>
                      <td><button type="button" className="ft-x" title="Take this pitch out of the report" aria-label={`Remove pitch ${p.no}`} onClick={() => removePitches([p.no])}>✕</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {removed.length > 0 && (
              <div className="bp-removed">
                <span>Removed: {removed.map((p) => `#${p.no}${p.type ? ` ${p.type}` : ""}`).join(", ")}</span>
                <button type="button" className="btn btn-secondary" onClick={() => editPitches(removed.map((p) => p.no), { removed: false })}>Put {removed.length === 1 ? "it" : "them all"} back</button>
              </div>
            )}
          </React.Fragment>
        ),
      },
      goals: goalPlan && goalPlan.goals && goalPlan.goals.length ? { title: "Pitch design goals", sub: "this bullpen against each goal", body: <GoalStatus session={session} sessions={sessions} goals={goalPlan.goals} throws={athlete && athlete.throws} /> } : null,
      comps: athlete && stats.some((s) => s.type !== UNTAGGED && codesOf(s.type)) ? { title: "Comps", sub: "MLB (Baseball Savant) and DST", body: <CompsModule athlete={athlete} stats={stats} /> } : null,
      arsenal: athlete && mlbIdOf(athlete) ? { title: "MLB arsenal", sub: "his pitches in MLB games (Baseball Savant)", body: <MlbArsenal athlete={athlete} /> } : null,
      trend: many ? { title: "Velocity by session", sub: `average / max mph, last ${Math.min(8, sessions.length)}`, body: <VeloTrend sessions={sessions} /> } : null,
      notes: {
        title: "Notes",
        body: (
          <React.Fragment>
            <textarea className="bp-notes-box" rows={3} value={notes} placeholder="What you worked on, how it felt…" onChange={(e) => changeNotes(e.target.value)} />
            <p className="timestamp-note">Imported from {session.fileName || "a TrackMan report"}{session.importedAt ? ` on ${shortDate(session.importedAt.slice(0, 10))}` : ""}{session.importedBy ? ` by ${session.importedBy}` : ""}.</p>
          </React.Fragment>
        ),
      },
    };
    const [layout, setLayoutState] = useState(readLayout);
    const setLayout = (next) => { setLayoutState(next); writeLayout(next); };
    // a module added since the coach arranged them goes in after the one it follows by default
    const order = layout.order.filter((k) => DEFAULT_LAYOUT.order.includes(k));
    DEFAULT_LAYOUT.order.forEach((k, i) => { if (!order.includes(k)) order.splice(i ? order.indexOf(DEFAULT_LAYOUT.order[i - 1]) + 1 : 0, 0, k); });
    const [pitchesOpen, setPitchesOpen] = useState(untagged > 0); // untagged pitches open Every pitch once, however it was left
    const isClosed = (k) => !!layout.closed[k] && !(k === "pitches" && pitchesOpen);
    const toggleClosed = (k) => { if (k === "pitches") setPitchesOpen(false); setLayout({ ...layout, closed: { ...layout.closed, [k]: !isClosed(k) } }); };
    const dragKey = useRef(null);
    const [over, setOver] = useState(null);
    const drop = (e, target) => {
      e.preventDefault();
      const from = dragKey.current;
      setOver(null); dragKey.current = null;
      if (!from || from === target) return;
      const r = e.currentTarget.getBoundingClientRect();
      const after = layout.half[target] ? e.clientX > r.left + r.width / 2 : e.clientY > r.top + r.height / 2;
      const next = order.filter((k) => k !== from);
      next.splice(next.indexOf(target) + (after ? 1 : 0), 0, from);
      setLayout({ ...layout, order: next });
    };

    return (
      <div className="panel bp-session">
        <div className="bp-session-head">
          <h2>{fmtDate(session.date)} <small>{[session.sessionType, session.facility, `${total} pitches`].filter(Boolean).join(" · ")}</small></h2>
          <button type="button" className="btn btn-small-grey" title="Put the modules back in their usual order and sizes" onClick={() => setLayout(DEFAULT_LAYOUT)}>Reset layout</button>
        </div>
        {BV && <BV.VideoBar session={session} athlete={athlete} onSave={(v) => saveVideo(session.id, v)} />}
        {untagged > 0 && <p className="bp-untagged">{untagged} pitch{untagged === 1 ? " isn't" : "es aren't"} tagged. Click one on a chart, pick a type for each under Every pitch, or check several and tag them at once.</p>}
        <div className="bp-mods">
          {order.filter((k) => modules[k]).map((k) => {
            const m = modules[k], half = !!layout.half[k], closed = isClosed(k);
            return (
              <section key={k} className={`bp-mod${half ? " half" : ""}${over === k ? " over" : ""}${closed ? " closed" : ""}`}
                onDragOver={(e) => { if (dragKey.current) { e.preventDefault(); if (over !== k) setOver(k); } }}
                onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOver((o) => (o === k ? null : o)); }}
                onDrop={(e) => drop(e, k)}>
                <div className="bp-mod-head">
                  <span className="bp-mod-grip" draggable title="Drag to move" aria-label={`Move ${m.title}`}
                    onDragStart={(e) => { dragKey.current = k; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", k); const sec = e.currentTarget.closest(".bp-mod"); if (sec && e.dataTransfer.setDragImage) e.dataTransfer.setDragImage(sec, 20, 16); }}
                    onDragEnd={() => { dragKey.current = null; setOver(null); }}>⋮⋮</span>
                  <h3>{m.title}{m.sub ? <small> {m.sub}</small> : null}</h3>
                  {!closed && m.extra}
                  <button type="button" className="bp-mod-btn" title={half ? "Make it full width" : "Make it half width, to sit beside another"} onClick={() => setLayout({ ...layout, half: { ...layout.half, [k]: !half } })}>{half ? "Full" : "Half"}</button>
                  <button type="button" className="bp-mod-btn" title={closed ? "Show it" : "Fold it away"} aria-expanded={!closed} onClick={() => toggleClosed(k)}>{closed ? "▸" : "▾"}</button>
                </div>
                {!closed && <div className="bp-mod-body">{m.body}</div>}
              </section>
            );
          })}
        </div>
        {zoomBall && <SpinZoom list={spinStats} type={zoomBall} onType={setZoomBall} ctl={spinCtl} set={setSpinCtl} />}
        {vid && BV && (() => {
          const vs = sessionOf(vid.sid);
          const describe = (no) => { const p = (vs.pitches || []).find((x) => x.no === no); return p ? [p.type || "Untagged", p.speed != null && `${p.speed} mph`, p.spin != null && `${p.spin} rpm`, p.ivb != null && `${p.ivb} IVB`, p.hb != null && `${p.hb} HB`, p.removed && "taken out", all && shortDate(vs.date)].filter(Boolean).join(" · ") : ""; };
          return <BV.PitchVideo session={vs} no={vid.no} onNo={(no) => setVid({ sid: vid.sid, no })} onClose={() => setVid(null)} onChange={(v) => saveVideo(vid.sid, v)} describe={describe} />;
        })()}
        {pk && (
          <div className="bp-pick-pop" role="dialog" aria-label={`Pitch ${pk.no}`}>
            <h3><span className="bp-dot" style={{ background: pk.type ? colorOf(pk.type) : "transparent" }} />Pitch #{pk.no}{all ? <small> {shortDate((sessions.find((s) => s.id === pk.sid) || {}).date)}</small> : null}</h3>
            <p>{[pk.speed != null && `${pk.speed} mph`, pk.spin != null && `${pk.spin} rpm`, pk.tilt && `tilt ${pk.tilt}`].filter(Boolean).join(" · ")}</p>
            <p>{[pk.ivb != null && `${pk.ivb} IVB`, pk.hb != null && `${pk.hb} HB`, pk.vaa != null && `${deg(pk.vaa)} VAA`].filter(Boolean).join(" · ")}</p>
            <p>{[pk.relHeight != null && `release ${ftIn(pk.relHeight)} high, ${ftIn(pk.relSide)} side`, pk.extension != null && `${ftIn(pk.extension)} ext.`].filter(Boolean).join(" · ")}</p>
            <label className="bp-pick-tag">Pitch type {tagSelect(pk.type || "", (v) => retag([pk.no], v, pk.sid), `Pitch ${pk.no} type`)}</label>
            <div className="bp-pick-actions">
              {BV && BV.hasClip(sessionOf(pk.sid), pk.no) && <BV.CameraButton text="Watch" label={`Watch pitch ${pk.no}`} onClick={() => setVid({ sid: pk.sid, no: pk.no })} />}
              <button type="button" className="btn btn-secondary" onClick={() => removePitches([pk.no], pk.sid)}>Remove pitch</button>
              <button type="button" className="btn btn-secondary" onClick={() => setPicked(null)}>Close</button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // velocity by pitch type across the sessions: average (and max) for each, newest on the right
  function VeloTrend({ sessions }) {
    const last = sessions.slice(-8);
    const per = last.map((s) => ({ s, stats: typeStats(s) }));
    const types = [...new Set(per.flatMap((x) => x.stats.map((t) => t.type)))].sort(byType);
    return (
      <div className="bp-table-wrap">
        <table className="assess-table bp-table bp-trend">
          <thead><tr><th>Pitch type</th>{per.map((x) => <th key={x.s.id}>{shortDate(x.s.date)}</th>)}</tr></thead>
          <tbody>
            {types.map((t) => (
              <tr key={t}>
                <td><span className="bp-dot" style={{ background: colorOf(t) }} />{t}</td>
                {per.map((x) => { const st = x.stats.find((q) => q.type === t); return <td key={x.s.id}>{st && st.speedAvg != null ? <span>{st.speedAvg}<small> / {show(st.speedMax)}</small></span> : "–"}</td>; })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  function BullpensTab({ athlete }) {
    const store = window.AthleteStore;
    const [list, setList] = useState(() => getBullpens(athlete.id));
    const [selectedId, setSelectedId] = useState(() => { const l = getBullpens(athlete.id); return l.length ? l[l.length - 1].id : null; });
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState("");
    const fileRef = useRef(null);
    const refresh = () => { const l = getBullpens(athlete.id); setList(l); return l; };
    const selected = list.find((b) => b.id === selectedId) || null;
    const pick = async (e) => {
      const files = [...(e.target.files || [])];
      e.target.value = "";
      if (!files.length) return;
      setBusy(true); setMsg("Reading…");
      const res = await importReports(athlete, files);
      const l = refresh();
      if (res.saved.length) setSelectedId(res.saved[res.saved.length - 1].id);
      else if (!l.some((b) => b.id === selectedId) && l.length) setSelectedId(l[l.length - 1].id);
      setMsg(resultText(res) || "Nothing imported.");
      setBusy(false);
    };
    const remove = async (b) => {
      const ok = await window.askConfirm({ title: `Delete the ${fmtDate(b.date)} bullpen?`, text: b.video ? "Its pitches, notes and video are deleted. You can import the PDF again, but the video would need adding again too." : "Its pitches and notes are deleted. You can import the PDF again to get it back.", ok: "Delete", danger: true });
      if (!ok) return;
      if (b.video && window.BullpenVideo) window.BullpenVideo.removeFiles(b.video);
      store.deleteAssessment(b.id);
      const l = refresh();
      if (selectedId === b.id) setSelectedId(l.length ? l[l.length - 1].id : null);
    };
    const save = (rec) => { store.saveAssessment(rec); refresh(); };
    return (
      <div className="bp-wrap">
        <div className="panel no-print">
          <h2>Bullpens <small>TrackMan pitching sessions</small></h2>
          <div className="assess-history">
            {!list.length && <span className="assess-row-note">No bullpens yet. Import a TrackMan report (the PDF from a Pitching practice session) to add one.</span>}
            {[...list].reverse().map((b) => (
              <span key={b.id} className={`assess-history-item${b.id === selectedId ? " active" : ""}`}>
                <button type="button" className="assess-history-btn" onClick={() => setSelectedId(b.id)} title="Open this session">{fmtDate(b.date)} · {livePitches(b).length} pitches</button>
                <button type="button" className="assess-history-delete" onClick={() => remove(b)} title="Delete this session">&times;</button>
              </span>
            ))}
          </div>
          <div className="assess-toolbar">
            <button className="btn btn-primary" disabled={busy} onClick={() => fileRef.current && fileRef.current.click()}>{busy ? "Importing…" : "Import TrackMan PDF"}</button>
            <input ref={fileRef} type="file" accept="application/pdf,.pdf" multiple hidden onChange={pick} />
            {msg && <span className="assess-row-note" role="status">{msg}</span>}
          </div>
          <p className="timestamp-note">Choose one or more TrackMan "Pitching practice" PDFs. Each one becomes a session here, with every pitch and its type.</p>
        </div>
        {selected && <SessionDetail key={selected.id} session={selected} sessions={list} onSave={save} athlete={athlete} />}
        {!selected && mlbIdOf(athlete) && <div className="panel"><h2>MLB arsenal <small>his pitches in MLB games (Baseball Savant)</small></h2><MlbArsenal athlete={athlete} /></div>}
      </div>
    );
  }

  // ---- pitch design: what a change in spin would do to one of the pitcher's pitches --------------------------------
  // Start from a pitch (a bullpen's averages, or the pitcher's MLB season from Savant) and move its velo, spin, spin
  // direction and spin efficiency; the designed pitch's movement is predicted from the change in its Magnus lift. Lift
  // goes with the spin factor S = r·ω(active)/v, through Alan Nathan's fit C_L = S / (0.4 + 2.32·S), and the break it
  // makes over the flight is in proportion to C_L (the force's v² and the flight time's 1/v² cancel). So the new break
  // is the pitch's own measured break × C_L(new) / C_L(old), turned to the new spin direction and then by its seam
  // effects: the pitch's own offset between its spin direction and where it really moves, as it was or as set. Break here is the pitcher's
  // view, as TrackMan gives it: + to the pitcher's right (a righty's arm side). Savant's (arm side +) is turned to match.
  const BALL_R_FT = 1.45 / 12;
  const liftOf = (rpm, effPct, mph) => {
    if (!rpm || !mph) return null;
    const S = (BALL_R_FT * rpm * (effPct / 100) * 2 * Math.PI / 60) / (mph * 1.4667);
    return S / (0.4 + 2.32 * S);
  };
  const clockRad = (min) => (min / 720) * 2 * Math.PI;
  const toClock = (rad) => { const m = Math.round((rad / (2 * Math.PI)) * 720) % 720; return m < 0 ? m + 720 : m; };
  const wrapMin = (m) => ((Math.round(m) % 720) + 720) % 720;
  const ASSUMED_EFF = 95; // when a pitch has no spin efficiency on file
  const moveDir = (p) => Math.atan2(p.hb, p.ivb); // the way it actually moves, as a clock angle: from 12 toward the right
  // seam effects: how far (clock minutes, + clockwise from behind the pitcher) a pitch moves off its spin direction,
  // from the wake its seams shift
  const seamOf = (b) => {
    if (b.tilt == null) return 0;
    let m = Math.round(((moveDir(b) - clockRad(b.tilt)) / (2 * Math.PI)) * 720);
    if (m > 360) m -= 720;
    if (m < -360) m += 720;
    return m;
  };
  // the movement seam effects add: the gap between where spin alone would send it and where it goes
  const seamInches = (m, offMin) => 2 * m * Math.abs(Math.sin(clockRad(offMin) / 2));
  function designed(base, d) {
    const effB = base.spinEff != null ? base.spinEff : ASSUMED_EFF, mB = Math.hypot(base.hb, base.ivb);
    const k = (liftOf(d.spin, d.eff, d.velo) || 0) / (liftOf(base.spinAvg, effB, base.speedAvg) || 1);
    const m = mB * k, dir = clockRad(d.tilt) + clockRad(d.seam);
    return { hb: m * Math.sin(dir), ivb: m * Math.cos(dir), m, dirMin: toClock(dir) };
  }
  // a clock angle (minutes) taken round to the same turn as `ref`, so a dial centered on ref can show it
  const nearTo = (t, ref) => { let x = t; while (x - ref > 360) x -= 720; while (x - ref < -360) x += 720; return x; };
  const startOf = (b) => ({ velo: b.speedAvg, spin: b.spinAvg, tilt: b.tilt != null ? b.tilt : toClock(moveDir(b)), eff: b.spinEff != null ? b.spinEff : ASSUMED_EFF, seam: seamOf(b) });

  // ---- seam-shifted wake, learned from MLB pitches ------------------------------------------------------------------
  // Hawk-Eye measures every MLB pitch's spin direction, and its movement says where it really went: the gap between the
  // two is what its seams add, the seam-shifted wake (Savant's spin direction leaderboard has both, for each pitcher's
  // pitch). Over every MLB pitch of a type that season, the gap is predicted for any spin direction, spin efficiency and
  // velo from the pitches most like it (a Gaussian-weighted average; a lefty's turned to throw like a righty). A design
  // changes the pitch's own seam effects by the change the model predicts from where it is to where it's designed: so a
  // sinker given more gyro, say, picks up the extra run MLB sinkers like it show.
  const SSW_SCALE = { tilt: 40, eff: 8, velo: 2.5 }; // how far apart two pitches can be and still count as alike: clock minutes, % efficiency, mph
  async function sswModel(codes, year) {
    const rows = (await Promise.all(codes.map((c) => spinDirs(c, year)))).flat();
    return rows.map((r) => {
      const meas = num(r.hawkeye_measured_clock_minutes), inf = num(r.movement_inferred_clock_minutes), eff = num(r.active_spin), velo = num(r.release_speed);
      if (meas == null || inf == null || eff == null || velo == null) return null;
      const L = r.pitch_hand === "L", off = ((((inf - meas) % 720) + 1080) % 720) - 360; // + clockwise from behind the pitcher
      return { tilt: L ? wrapMin(720 - meas) : meas, eff: eff * 100, velo, off: L ? -off : off };
    }).filter(Boolean);
  }
  // the seam effects (clock minutes, + clockwise) of pitches like this one, and how many there are (within 2 of each scale)
  const sswAt = (pts, hand, tilt, eff, velo) => {
    if (!pts || pts.length < 20) return null;
    const L = hand === "L", t = L ? wrapMin(720 - tilt) : wrapMin(tilt);
    let sw = 0, s = 0, n = 0;
    pts.forEach((p) => {
      let dt = Math.abs(p.tilt - t) % 720;
      if (dt > 360) dt = 720 - dt;
      const z = (dt / SSW_SCALE.tilt) ** 2 + ((p.eff - eff) / SSW_SCALE.eff) ** 2 + ((p.velo - velo) / SSW_SCALE.velo) ** 2;
      const w = Math.exp(-z / 2);
      sw += w; s += w * p.off;
      if (z < 4) n++;
    });
    return sw > 1e-9 ? { off: (L ? -1 : 1) * (s / sw), n } : null;
  };

  // the pitcher's pitches on a movement plot, with an arrow from the pitch as it is to the pitch as designed
  function DesignChart({ pitches, base, out }) {
    const vals = [...pitches.flatMap((p) => [p.hb, p.ivb]), out.hb, out.ivb].map(Math.abs);
    const R = Math.max(20, Math.ceil(Math.max(...vals) / 5) * 5 + 5);
    const S = 320, pad = 36, sc = (S - 2 * pad) / (2 * R);
    const X = (v) => pad + (v + R) * sc, Y = (v) => pad + (R - v) * sc;
    const ticks = [];
    for (let t = -Math.floor(R / 10) * 10; t <= R; t += 10) ticks.push(t);
    const col = colorOf(base.type);
    const far = Math.hypot(out.hb - base.hb, out.ivb - base.ivb) > 0.6;
    return (
      <svg className="pd-chart" viewBox={`0 0 ${S} ${S}`} role="img" aria-label={`Movement: ${base.type} now ${base.ivb} IVB, ${base.hb} HB; designed ${out.ivb.toFixed(1)} IVB, ${out.hb.toFixed(1)} HB`}>
        <defs><marker id="pd-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill={col} /></marker></defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={X(t)} x2={X(t)} y1={pad} y2={S - pad} stroke="var(--chart-grid)" strokeWidth={t === 0 ? 1.5 : 0.6} />
            <line x1={pad} x2={S - pad} y1={Y(t)} y2={Y(t)} stroke="var(--chart-grid)" strokeWidth={t === 0 ? 1.5 : 0.6} />
            <text x={X(t)} y={S - pad + 14} textAnchor="middle" fontSize="10" fill="var(--text-dim)">{t}</text>
            <text x={pad - 6} y={Y(t) + 3} textAnchor="end" fontSize="10" fill="var(--text-dim)">{t}</text>
          </g>
        ))}
        <text x={S / 2} y={S - 4} textAnchor="middle" fontSize="11" fill="var(--text-dim)">Horz. break (in), pitcher's view</text>
        <text x={11} y={S / 2} textAnchor="middle" fontSize="11" fill="var(--text-dim)" transform={`rotate(-90 11 ${S / 2})`}>Induced vert. break (in)</text>
        {pitches.filter((p) => p !== base).map((p) => (
          <g key={p.type}><circle cx={X(p.hb)} cy={Y(p.ivb)} r="6" fill={colorOf(p.type)} opacity="0.4" /><title>{`${p.type}: ${p.ivb} IVB, ${p.hb} HB`}</title></g>
        ))}
        {far && <line x1={X(base.hb)} y1={Y(base.ivb)} x2={X(out.hb)} y2={Y(out.ivb)} stroke={col} strokeWidth="2" markerEnd="url(#pd-arrow)" />}
        <circle cx={X(base.hb)} cy={Y(base.ivb)} r="8" fill={col} stroke="var(--panel)" strokeWidth="2" />
        <circle cx={X(out.hb)} cy={Y(out.ivb)} r="9" fill="none" stroke={col} strokeWidth="3" strokeDasharray="4 3" />
      </svg>
    );
  }

  // ---- pitch design goals: each pitch either changed (the pitch now, and as designed) or kept as it is ------------
  // Kept on the pitcher as one record, kind "pitchdesign": { goals: [{ type, mode: "change" | "maintain", source, now,
  // goal, note, savedAt, savedBy }] }, now and goal each { velo, spin, tilt, eff, seam, ivb, hb } (break in the
  // pitcher's view). One goal per pitch type: saving another replaces it.
  const clockAt = (m) => { const w = ((Math.round(m) % 720) + 720) % 720, h = Math.floor(w / 60); return `${h === 0 ? 12 : h}:${String(w % 60).padStart(2, "0")}`; };
  const inch = (v) => `${Math.abs(v).toFixed(1)}"`;
  const listOf = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
  // horizontal break in words, from the pitcher's-view number and his throwing hand
  const sideOf = (hb, throws) => { const arm = throws === "L" ? -hb : hb; return { arm, words: `${inch(arm)} of ${arm >= 0 ? "arm-side run" : "glove-side sweep"}` }; };
  const vertOf = (ivb) => (ivb >= 0 ? `${inch(ivb)} of induced vertical break` : `${inch(ivb)} of drop below a spinless pitch`);
  const seamWords = (m) => (Math.abs(m) < 3 ? "none" : `${Math.round(Math.abs(m) / 2)}° ${m > 0 ? "clockwise" : "counterclockwise"}`);
  // the goal in plain words, for the printed plan
  function goalSummary(g, throws) {
    const t = g.type.toLowerCase(), n = g.now, G = g.goal;
    const shape = (m) => `${m.velo.toFixed(1)} mph with ${Math.round(m.spin).toLocaleString()} rpm spinning toward ${clockAt(m.tilt)} (${Math.round(m.eff)}% efficient, ${100 - Math.round(m.eff)}% gyro)`;
    if (g.mode === "maintain") {
      return [
        `Keep the ${t} where it is: ${shape(n)}, for ${vertOf(n.ivb)} and ${sideOf(n.hb, throws).words}.`,
        Math.abs(n.seam) >= 6 ? `Its seams move it about ${Math.round(Math.abs(n.seam) / 2)}° off where its spin alone would send it (about ${seamInches(Math.hypot(n.hb, n.ivb), n.seam).toFixed(1)}" of its movement), so keep the grip and release that give it that.` : null,
        "The goal is consistency: the same velo, spin direction and efficiency from one bullpen to the next.",
      ].filter(Boolean).join(" ");
    }
    const asks = [], why = [];
    const dt = G.tilt - n.tilt, de = G.eff - n.eff, dv = G.velo - n.velo, ds = G.seam - n.seam;
    if (Math.abs(dt) >= 3) {
      asks.push(`move the spin direction from ${clockAt(n.tilt)} to ${clockAt(G.tilt)} (about ${Math.round(Math.abs(dt) / 2)}° ${dt > 0 ? "clockwise" : "counterclockwise"}, seen from behind the pitcher)`);
      why.push("a change in spin direction usually comes from the hand and wrist position at release, or the arm slot");
    }
    if (Math.abs(de) >= 1) {
      asks.push(de < 0 ? `add gyro (from ${Math.round(n.eff)}% to ${Math.round(G.eff)}% efficient, so ${100 - Math.round(G.eff)}% gyro)` : `clean up the spin (from ${Math.round(n.eff)}% to ${Math.round(G.eff)}% efficient, ${100 - Math.round(G.eff)}% gyro)`);
      why.push(de < 0 ? "more gyro usually means getting more to the side of the ball at release, toward bullet spin" : "more efficiency usually means staying behind the ball through release, so more of the spin moves it");
    }
    if (Math.abs(dv) >= 0.3) asks.push(`${dv > 0 ? "add" : "take off"} ${Math.abs(dv).toFixed(1)} mph (${n.velo.toFixed(1)} to ${G.velo.toFixed(1)})`);
    if (Math.abs(ds) >= 4) asks.push(`${Math.abs(G.seam) > Math.abs(n.seam) ? "get more" : "get less"} from seam effects (${seamWords(n.seam)} to ${seamWords(G.seam)} off its spin)`);
    const sN = sideOf(n.hb, throws), sG = sideOf(G.hb, throws), dArm = sG.arm - sN.arm, dIvb = G.ivb - n.ivb;
    const moves = [];
    if (Math.abs(dIvb) >= 0.3) moves.push(`${inch(dIvb)} ${dIvb > 0 ? "more" : "less"} vertical break`);
    if (Math.abs(dArm) >= 0.3) moves.push(`${inch(dArm)} more ${dArm > 0 ? "to the arm side" : "to the glove side"}`);
    return [
      asks.length ? `Goal for the ${t}: ${listOf(asks)}.` : `Goal for the ${t}: no change to its spin, velo or seam effects yet.`,
      `Predicted, that takes it from ${vertOf(n.ivb)} and ${sN.words} to ${vertOf(G.ivb)} and ${sG.words}${moves.length ? ` (${listOf(moves)})` : ""}; total break ${inch(Math.hypot(n.hb, n.ivb))} to ${inch(Math.hypot(G.hb, G.ivb))}.`,
      Math.abs(dt) >= 3 || Math.abs(de) >= 1 ? `The spin rate stays about ${Math.round(n.spin).toLocaleString()} rpm: the change is in how the spin is put on the ball, not how much of it there is.` : null,
      why.length ? `For reference: ${why.join("; ")}.` : null,
    ].filter(Boolean).join(" ");
  }
  const STILL = { paused: true, speed: 1, pov: "pitcher", flip: false }; // printed balls: one still frame, from behind the pitcher

  // the plan: every goal, with its balls standing still, the numbers and the summary; it's what prints from this tab
  function PitchPlan({ athlete, plan, onRemove, onNote, onOpen }) {
    const goals = (plan && plan.goals) || [];
    if (!goals.length) return null;
    const ballOf = (g, m) => ({ type: g.type, spinAvg: Math.round(m.spin), tilt: m.tilt, spinEff: Math.round(m.eff), speedAvg: Math.round(m.velo * 10) / 10 });
    const row = (label, f, g) => <tr><td>{label}</td><td>{f(g.now)}</td>{g.mode === "change" && <td><b>{f(g.goal)}</b></td>}</tr>;
    return (
      <div className="panel pd-plan">
        <div className="pd-plan-head">
          <h2>Pitch Design Plan <small>{athlete.name}</small></h2>
          <button type="button" className="btn btn-secondary no-print" onClick={() => window.print()}>Print plan</button>
        </div>
        {goals.map((g) => (
          <div key={g.type} className="pd-goal">
            <div className="pd-goal-head">
              <h3><span className="bp-dot" style={{ background: colorOf(g.type) }} />{g.type}</h3>
              <span className={`pd-badge ${g.mode}`}>{g.mode === "change" ? "Change" : "Maintain shape and qualities"}</span>
              <span className="timestamp-note">set {g.savedAt ? shortDate(g.savedAt.slice(0, 10)) : ""}{g.source ? ` from ${g.source}` : ""}</span>
              <span className="pd-goal-btns no-print">
                <button type="button" className="bp-mod-btn" onClick={() => onOpen(g)}>Open in designer</button>
                <button type="button" className="bp-mod-btn" onClick={() => onRemove(g)}>Remove</button>
              </span>
            </div>
            <div className="pd-goal-body">
              <div className="pd-goal-balls">
                <div><div className="pd-goal-cap">{g.mode === "change" ? "Now" : "Keep"}</div><SpinBall s={ballOf(g, g.now)} ctl={STILL} size={130} /></div>
                {g.mode === "change" && <div><div className="pd-goal-cap">Goal</div><SpinBall s={ballOf(g, g.goal)} ctl={STILL} size={130} /></div>}
              </div>
              <table className="assess-table bp-table pd-goal-table">
                <thead><tr><th></th><th>{g.mode === "change" ? "Now" : "Keep"}</th>{g.mode === "change" && <th>Goal</th>}</tr></thead>
                <tbody>
                  {row("Velo", (m) => `${m.velo.toFixed(1)} mph`, g)}
                  {row("Spin", (m) => `${Math.round(m.spin)} rpm`, g)}
                  {row("Spin direction", (m) => clockAt(m.tilt), g)}
                  {row("Efficiency / gyro", (m) => `${Math.round(m.eff)}% / ${100 - Math.round(m.eff)}%`, g)}
                  {row("IVB", (m) => `${m.ivb.toFixed(1)}"`, g)}
                  {row("Horz. break", (m) => sideOf(m.hb, athlete.throws).words.replace(" of ", " "), g)}
                  {row("Seam effects", (m) => seamWords(m.seam), g)}
                </tbody>
              </table>
            </div>
            <p className="pd-summary">{goalSummary(g, athlete.throws)}</p>
            <textarea className="bp-notes-box no-print" rows={2} value={g.note || ""} placeholder="Cues, grip notes, what to work on…" onChange={(e) => onNote(g, e.target.value)} />
            {g.note ? <p className="print-only pd-note-print"><b>Notes:</b> {g.note}</p> : null}
          </div>
        ))}
        <p className="timestamp-note">Goal movement is predicted from the change in Magnus lift, scaled from the pitch's own measured break and keeping (or setting) its seam effects; it's a guide for the work, not a guarantee. Horizontal break is described from the pitcher's arm side.</p>
      </div>
    );
  }

  // ---- a bullpen against the pitcher's pitch design goals ----------------------------------------------------------
  // For each pitch with a goal: this session's averages beside the goal, how far its movement is from the goal's (in
  // inches, IVB and horizontal break together), whether that's closer or further than his bullpen before, and for a
  // change goal how much of the planned change has happened; for a "maintain" goal, whether it's holding its shape.
  const CLOSE_IN = 0.5; // movement within half an inch counts as no change
  const minutesApart = (a, b) => { let d = Math.round(a - b) % 720; if (d > 360) d -= 720; if (d < -360) d += 720; return d; };
  function GoalStatus({ session, sessions, goals, throws }) {
    // the session's figures for a goal's pitch: the same name, or failing that the same kind of pitch
    const statOf = (s, type) => {
      const all = typeStats(s).filter((x) => x.type !== UNTAGGED && x.ivb != null && x.hb != null);
      const codes = codesOf(type) || [];
      return all.find((x) => x.type === type) || all.find((x) => (codesOf(x.type) || []).some((c) => codes.includes(c))) || null;
    };
    const apart = (a, b) => Math.hypot(a.hb - b.hb, a.ivb - b.ivb);
    const ordered = [...(sessions || [])].sort((a, b) => (a.date || "").localeCompare(b.date || "") || String(a.id).localeCompare(String(b.id)));
    const idx = ordered.findIndex((s) => s.id === session.id);
    return (
      <div className="pd-status-list">
        {goals.map((g) => {
          const st = statOf(session, g.type);
          const head = (
            <div className="pd-status-head">
              <h4><span className="bp-dot" style={{ background: colorOf(g.type) }} />{g.type}</h4>
              <span className={`pd-badge ${g.mode}`}>{g.mode === "change" ? "Change" : "Maintain"}</span>
            </div>
          );
          if (!st) return <div key={g.type} className="pd-status">{head}<p className="assess-row-note">Not thrown in this bullpen.</p></div>;
          const G = g.goal, N = g.now, dNow = apart(st, G);
          // the same pitch in the bullpens before this one, newest last, for the trend and the history
          const history = ordered.slice(0, idx + 1).map((s) => ({ s, st: statOf(s, g.type) })).filter((x) => x.st).slice(-6);
          const prev = history.length > 1 ? history[history.length - 2] : null;
          const dPrev = prev ? apart(prev.st, G) : null;
          const trend = dPrev == null ? null : dNow < dPrev - CLOSE_IN / 2 ? "closer" : dNow > dPrev + CLOSE_IN / 2 ? "further" : "same";
          const dTilt = st.tilt != null ? minutesApart(st.tilt, G.tilt) : null;
          const dEff = st.spinEff != null ? st.spinEff - G.eff : null;
          const dVelo = st.speedAvg != null ? st.speedAvg - G.velo : null;
          let status, tone, progress = null;
          if (g.mode === "change") {
            const d0 = apart(N, G);
            progress = d0 > CLOSE_IN ? Math.max(0, Math.min(1, (d0 - dNow) / d0)) : null;
            if (dNow <= 1 || (progress != null && progress >= 0.85)) { status = "At goal"; tone = "good"; }
            else if (trend === "closer") { status = "Getting closer"; tone = "good"; }
            else if (trend === "further") { status = "Moving away"; tone = "bad"; }
            else if (progress != null && progress >= 0.25) { status = "Partway there"; tone = "mid"; }
            else { status = trend === "same" ? "No change since last" : "Not there yet"; tone = "mid"; }
          } else {
            const holding = dNow <= 1.5 && (dTilt == null || Math.abs(dTilt) <= 15) && (dVelo == null || Math.abs(dVelo) <= 1.5);
            status = holding ? "Holding its shape" : trend === "closer" ? "Drifting, coming back" : "Drifting";
            tone = holding ? "good" : trend === "closer" ? "mid" : "bad";
          }
          const side = (hb) => sideOf(hb, throws);
          const chips = [
            [`IVB ${st.ivb.toFixed(1)}"`, `goal ${G.ivb.toFixed(1)}"`],
            [`${side(st.hb).words.replace(" of ", " ")}`, `goal ${inch(side(G.hb).arm)}`],
            st.tilt != null ? [`spin dir. ${clockAt(st.tilt)}`, `goal ${clockAt(G.tilt)}${Math.abs(dTilt) >= 8 ? ` (${Math.round(Math.abs(dTilt) / 2)}° ${dTilt > 0 ? "clockwise" : "counterclockwise"} of it)` : ""}`] : null,
            st.spinEff != null ? [`${st.spinEff}% eff.`, `goal ${Math.round(G.eff)}%`] : null,
            st.speedAvg != null ? [`${st.speedAvg} mph`, `goal ${G.velo.toFixed(1)}`] : null,
          ].filter(Boolean);
          return (
            <div key={g.type} className="pd-status">
              {head}
              <span className={`pd-status-pill ${tone}`}>{status}</span>
              <p className="pd-status-line">
                {g.mode === "change" ? `${inch(dNow)} from the goal's movement` : `${inch(dNow)} off the shape he's keeping`}
                {trend && dPrev != null ? ` · ${trend === "closer" ? "closer than" : trend === "further" ? "further than" : "about the same as"} his last bullpen (${inch(dPrev)}${prev.s.date ? `, ${shortDate(prev.s.date)}` : ""})` : " · his first bullpen with this pitch since the goal"}
              </p>
              {progress != null && (
                <div className="pd-progress" title={`${Math.round(progress * 100)}% of the planned change in movement`}>
                  <i style={{ width: `${Math.max(2, progress * 100)}%` }} /><span>{Math.round(progress * 100)}% of the way there</span>
                </div>
              )}
              <div className="pd-status-chips">{chips.map(([a, b]) => <span key={a} className="pd-status-chip"><b>{a}</b> <small>{b}</small></span>)}</div>
              {history.length > 1 && (
                <p className="timestamp-note">Distance to goal, bullpen by bullpen: {history.map((x) => `${inch(apart(x.st, G))}${x.s.id === session.id ? " (this one)" : ""}`).join(" → ")}</p>
              )}
            </div>
          );
        })}
        <p className="timestamp-note">Movement is compared as induced vertical and horizontal break together; within about an inch counts as at goal (an inch and a half for a pitch being kept). Goals are set on the Pitch Design tab.</p>
      </div>
    );
  }

  // ---- handles on the designed ball: shape the spin by hand ------------------------------------------------------
  // Two, drawn over the ball, from whichever side it's seen:
  //   the solid knob on the ring: the spin direction (the way spin pushes the ball), dragged round the clock
  //   the white knob on the axis line: the spin axis as you see it. Pulled in toward the middle it points at you (all
  //     gyro); pushed out to the edge it lies flat across the ball (all efficient); dragged round, it turns the spin.
  // The axis knob is the end facing you. Spin efficiency e leans the axis between flat (e = 1) and pointing at you
  // (e = 0) as spinAxis does, so the knob sits sin(lean) of the way out: ρ = e / √(e² + (1 − e)²), and back again
  // e = ρ / (ρ + √(1 − ρ²)).
  function DesignHandles({ size, tilt, eff, pov, color, onChange }) {
    const svgRef = useRef(null);
    const drag = useRef(null);
    const c = size / 2, rBall = size * 0.38, rRing = size * 0.47;
    const th = clockRad(tilt), mine = pov === "pitcher";
    // the ring: an angle clockwise from 12 on screen, for a clock angle (the catcher sees the pitcher's clock mirrored)
    const screenA = (rad) => (mine ? rad : -rad);
    const onRing = (a) => [c + rRing * Math.sin(a), c - rRing * Math.cos(a)];
    const [sx, sy] = onRing(screenA(th));
    // the axis knob: the axis end facing you, as far out as the axis lies flat
    const e = Math.max(0, Math.min(1, eff / 100)), rho = e / (Math.hypot(e, 1 - e) || 1);
    const kx = c - rBall * rho * Math.cos(th), ky = c - rBall * rho * (mine ? Math.sin(th) : -Math.sin(th));
    const at = (ev) => {
      const b = svgRef.current.getBoundingClientRect(), k = size / b.width;
      return [(ev.clientX - b.left) * k - c, (ev.clientY - b.top) * k - c];
    };
    const toMin = (rad) => (rad / (2 * Math.PI)) * 720;
    const move = (ev) => {
      if (!drag.current) return;
      const [dx, dy] = at(ev), a = Math.atan2(dx, -dy); // clockwise from 12 on screen
      if (drag.current === "spin") {
        onChange({ tilt: Math.round(nearTo(toMin(mine ? a : -a), tilt)) });
      } else {
        const r = Math.min(1, Math.hypot(dx, dy) / rBall);
        const patch = { eff: Math.round((100 * r) / (r + Math.sqrt(Math.max(0, 1 - r * r)))) };
        if (r > 0.08) { // far enough out to have a direction: the knob's angle sets the spin direction too
          // the knob sits at (−cos θ, sin θ) from behind the pitcher and (−cos θ, −sin θ) from the catcher (y up)
          const t = mine ? Math.atan2(-dy, -dx) : Math.atan2(dy, -dx);
          patch.tilt = Math.round(nearTo(toMin(t), tilt));
        }
        onChange(patch);
      }
    };
    const start = (which) => (ev) => { ev.preventDefault(); drag.current = which; svgRef.current.setPointerCapture(ev.pointerId); };
    const end = () => { drag.current = null; };
    const knob = (x, y, which, title, body) => (
      <g className={`pd-h pd-h-${which}`} onPointerDown={start(which)}><title>{title}</title>{body(x, y)}<circle cx={x} cy={y} r={size * 0.075} fill="transparent" /></g>
    );
    return (
      <svg ref={svgRef} className="pd-handles" viewBox={`0 0 ${size} ${size}`} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
        <circle cx={c} cy={c} r={rRing} fill="none" stroke="var(--chart-grid)" strokeDasharray="3 4" />
        <line x1={2 * c - kx} y1={2 * c - ky} x2={kx} y2={ky} stroke="rgba(20, 20, 20, 0.55)" strokeWidth="2" strokeDasharray="5 3" />
        {knob(sx, sy, "spin", "Spin direction: drag around the clock", (x, y) => <circle cx={x} cy={y} r={size * 0.04} fill={color} stroke="var(--panel)" strokeWidth="2" />)}
        {knob(kx, ky, "axis", "Spin axis: pull in for more gyro, push out for more efficiency, drag around to turn it", (x, y) => (
          <g><circle cx={x} cy={y} r={size * 0.042} fill="#fff" stroke="#222" strokeWidth="2" /><circle cx={x} cy={y} r={size * 0.012} fill="#222" /></g>
        ))}
      </svg>
    );
  }

  function PitchDesignTab({ athlete, mlbId }) {
    const id = String(mlbId || mlbIdOf(athlete));
    const sessions = getBullpens(athlete.id);
    const latest = sessions[sessions.length - 1] || null;
    const sources = [
      ...(latest ? [{ key: "latest", label: `Latest bullpen (${shortDate(latest.date)})` }] : []),
      ...(sessions.length > 1 ? [{ key: "all", label: `All bullpens (${sessions.length})` }] : []),
      ...(id ? [{ key: "mlb", label: "MLB games" }] : []),
    ];
    const [source, setSource] = useState(sources.length ? sources[0].key : "");
    const [season, setSeason] = useState(defaultSeason);
    const [mlb, setMlb] = useState({ loading: false, rows: [] });
    useEffect(() => {
      if (source !== "mlb" || !id) return undefined;
      let off = false;
      setMlb({ loading: true, rows: [] });
      mlbArsenal(id, athlete.throws, season).then((rows) => { if (!off) setMlb({ loading: false, rows }); }, () => { if (!off) setMlb({ loading: false, rows: [] }); });
      return () => { off = true; };
    }, [source, id, season]); // eslint-disable-line
    // the pitches to start from, each with velo, spin, spin direction, efficiency and its break (pitcher's view)
    const usable = (p) => p.type && p.ivb != null && p.hb != null && p.spinAvg && p.speedAvg;
    const pitches = (source === "mlb"
      ? mlb.rows.filter((r) => CODE_TYPE[r.code]).map((r) => {
        const left = (r.hand || athlete.throws) === "L";
        return { type: CODE_TYPE[r.code], code: r.code, speedAvg: r.velo, spinAvg: r.spin != null ? Math.round(r.spin) : r.spinRate, tilt: r.tilt, spinEff: r.spinEff, ivb: r.ivb, hb: r.hb != null ? (left ? -r.hb : r.hb) : null, qty: r.res.pitches, relHeight: r.relHeight, relSide: r.relSide, extension: r.ext, vaa: r.vaa, armAngle: r.armAngle };
      })
      : source ? typeStats(source === "all" ? { pitches: sessions.flatMap(livePitches) } : latest).filter((s) => s.type !== UNTAGGED).map((s) => ({ type: s.type, speedAvg: s.speedAvg, spinAvg: s.spinAvg, tilt: s.tilt, spinEff: s.spinEff, ivb: s.ivb, hb: s.hb, qty: s.qty, relHeight: s.relHeight, relSide: s.relSide, extension: s.extension, vaa: s.vaa }))
      : []).filter(usable);
    const [pick, setPick] = useState("");
    const base = pitches.find((p) => p.type === pick) || pitches[0] || null;
    const baseKey = base ? `${source}|${season}|${base.type}|${base.speedAvg}|${base.spinAvg}` : "";
    const [d, setD] = useState(null);
    const opening = useRef(null); // a saved goal being opened: its design, once its pitch is picked
    useEffect(() => {
      const o = opening.current;
      setD(base ? (o && o.type === base.type ? { ...o.d, tilt: nearTo(o.d.tilt, startOf(base).tilt) } : startOf(base)) : null);
      opening.current = null;
    }, [baseKey]); // eslint-disable-line
    const [spinCtl, setSpinCtl] = useSpinCtl();
    // the seam-shifted wake model for this pitch type: every MLB pitch of the type that season (the bullpen's, last season's)
    const sswCodes = base ? (base.code ? [base.code] : codesOf(base.type)) : null;
    const sswYear = source === "mlb" ? season : defaultSeason();
    const sswKey = sswCodes ? `${sswCodes.join("+")}|${sswYear}` : "";
    const [ssw, setSsw] = useState({ key: "", pts: null });
    useEffect(() => {
      if (!sswKey) return undefined;
      let off = false;
      sswModel(sswCodes, sswYear).then((pts) => { if (!off) setSsw({ key: sswKey, pts }); }, () => { if (!off) setSsw({ key: sswKey, pts: [] }); });
      return () => { off = true; };
    }, [sswKey]); // eslint-disable-line
    const sswPts = ssw.key === sswKey ? ssw.pts : null;
    // the goals, kept on the pitcher
    const store = window.AthleteStore;
    const [plan, setPlan] = useState(() => (store.getPitchDesign ? store.getPitchDesign(athlete.id) : null));
    const [goalMsg, setGoalMsg] = useState("");
    const saveGoals = (goals) => {
      const rec = plan ? { ...plan, goals } : { id: uid(), kind: "pitchdesign", athleteId: athlete.id, date: new Date().toISOString().slice(0, 10), goals };
      store.saveAssessment(rec);
      setPlan(rec);
    };
    const putGoal = (g) => saveGoals([...((plan && plan.goals) || []).filter((x) => x.type !== g.type), g].sort((a, b) => byType(a.type, b.type)));
    const removeGoal = async (g) => {
      const ok = await window.askConfirm({ title: `Remove the ${g.type.toLowerCase()} goal?`, text: "It comes off the plan; the pitch itself isn't touched.", ok: "Remove", danger: true });
      if (ok) saveGoals(plan.goals.filter((x) => x.type !== g.type));
    };
    const noteTimer = useRef(null);
    const noteGoal = (g, note) => {
      const goals = plan.goals.map((x) => (x.type === g.type ? { ...x, note } : x));
      setPlan({ ...plan, goals });
      clearTimeout(noteTimer.current);
      noteTimer.current = setTimeout(() => saveGoals(goals), 600);
    };
    const openGoal = (g) => {
      const design = { velo: g.goal.velo, spin: g.goal.spin, tilt: g.goal.tilt, eff: g.goal.eff, seam: g.goal.seam };
      if (base && base.type === g.type) setD({ ...design, tilt: nearTo(design.tilt, startOf(base).tilt) });
      else if (pitches.some((p) => p.type === g.type)) { opening.current = { type: g.type, d: design }; setPick(g.type); }
      else { setGoalMsg(`There's no ${g.type.toLowerCase()} in ${(sources.find((s) => s.key === source) || {}).label || "this source"} to open it on; pick another source.`); return; }
      setGoalMsg("");
      window.scrollTo({ top: 0, behavior: "smooth" });
    };

    if (!sources.length) {
      return <div className="panel"><h2>Pitch Design</h2><div className="empty-state">Import a TrackMan bullpen, or link this pitcher to MLB, to design from one of his pitches.</div></div>;
    }
    const start = base ? startOf(base) : null;
    const dd0 = d && base && d.velo != null ? d : start;
    // the design's seam effects: the pitch's own, changed by what the MLB model predicts for the change (held where they
    // are when the model hasn't loaded, or too few MLB pitches are like the design to say)
    const hand = athlete.throws === "L" ? "L" : "R";
    const sswNow = base && sswPts ? sswAt(sswPts, hand, start.tilt, start.eff, start.velo) : null;
    const sswNew = base && dd0 && sswPts ? sswAt(sswPts, hand, dd0.tilt, dd0.eff, dd0.velo) : null;
    const sswOk = !!(sswNow && sswNew && sswNew.n >= 5);
    const sswDelta = sswOk ? Math.round(sswNew.off - sswNow.off) : 0;
    const dd = dd0 && { ...dd0, seam: start.seam + sswDelta };
    const out = base && dd ? designed(base, dd) : null;
    const set = (k, v) => setD({ ...dd, [k]: v });
    const sign = (v, dp = 1) => { const r = Number(v.toFixed(dp)); return r === 0 ? "–" : `${r > 0 ? "+" : ""}${r.toFixed(dp)}`; };
    // a dial: drag for big moves, − / + for the finest step it takes; `ends` labels its two ends
    const slider = ({ label, k, min, max, step, fmt, deltaFmt, ends, note }) => {
      const changed = Math.abs(dd[k] - start[k]) > 1e-9;
      const dp = String(step).includes(".") ? String(step).split(".")[1].length : 0;
      const nudge = (dir) => set(k, Math.max(min, Math.min(max, Number((dd[k] + dir * step).toFixed(dp)))));
      return (
        <div className="pd-slider">
          <span className="pd-slider-top"><span>{label}</span><b>{fmt(dd[k])}</b><small className={changed ? "on" : ""}>{changed ? deltaFmt(dd[k] - start[k]) : "as is"}</small></span>
          <span className="pd-slider-row">
            <button type="button" className="pd-nudge" aria-label={`${label}: a little less`} onClick={() => nudge(-1)}>−</button>
            <input type="range" min={min} max={max} step={step} value={dd[k]} aria-label={label} onChange={(e) => set(k, Number(e.target.value))} />
            <button type="button" className="pd-nudge" aria-label={`${label}: a little more`} onClick={() => nudge(1)}>+</button>
          </span>
          {ends && <span className="pd-slider-ends"><span>{ends[0]}</span><span>{ends[1]}</span></span>}
          {note && <span className="pd-slider-note">{note}</span>}
        </div>
      );
    };
    // the spin direction to the minute (the fine steps would vanish rounded to the quarter hour)
    const clockExact = (m) => { const w = wrapMin(m), h = Math.floor(w / 60); return `${h === 0 ? 12 : h}:${String(w % 60).padStart(2, "0")}`; };
    const effB = base && base.spinEff != null ? base.spinEff : ASSUMED_EFF;
    const seamText = (m) => (Math.abs(m) < 3 ? "none" : `${Math.round(Math.abs(m) / 2)}° ${m > 0 ? "clockwise" : "counterclockwise"}`);
    const mNow = base ? Math.hypot(base.hb, base.ivb) : 0;
    const rows = base && out ? [
      ["IVB", `${base.ivb.toFixed(1)}"`, `${out.ivb.toFixed(1)}"`, sign(out.ivb - base.ivb)],
      ["Horz. break", `${base.hb.toFixed(1)}"`, `${out.hb.toFixed(1)}"`, sign(out.hb - base.hb)],
      ["Total break", `${Math.hypot(base.hb, base.ivb).toFixed(1)}"`, `${out.m.toFixed(1)}"`, sign(out.m - Math.hypot(base.hb, base.ivb))],
      ["Moves toward", tiltText(toClock(moveDir(base))), tiltText(out.dirMin), ""],
      ["Velo", `${base.speedAvg} mph`, `${dd.velo.toFixed(1)} mph`, sign(dd.velo - base.speedAvg)],
      ["Spin", `${base.spinAvg} rpm`, `${Math.round(dd.spin)} rpm`, sign(dd.spin - base.spinAvg, 0)],
      ["Spin direction", base.tilt != null ? clockExact(base.tilt) : "–", clockExact(dd.tilt), ""],
      ["Spin eff. / gyro", `${effB}% / ${100 - effB}%`, `${Math.round(dd.eff)}% / ${100 - Math.round(dd.eff)}%`, sign(dd.eff - effB, 0)],
      ["Active spin", `${Math.round((base.spinAvg * effB) / 100)} rpm`, `${Math.round((dd.spin * dd.eff) / 100)} rpm`, sign((dd.spin * dd.eff) / 100 - (base.spinAvg * effB) / 100, 0)],
      ["Seam effects", seamText(start.seam), seamText(dd.seam), Math.abs(sswDelta) < 2 ? "–" : `${sswDelta > 0 ? "+" : "−"}${Math.round(Math.abs(sswDelta) / 2)}°`],
      ["Break from seams", `${seamInches(mNow, start.seam).toFixed(1)}"`, `${seamInches(out.m, dd.seam).toFixed(1)}"`, sign(seamInches(out.m, dd.seam) - seamInches(mNow, start.seam))],
    ] : [];
    const ballNow = base && { type: base.type, spinAvg: base.spinAvg, tilt: base.tilt, spinEff: base.spinEff, speedAvg: base.speedAvg };
    const ballNew = base && { type: base.type, spinAvg: Math.round(dd.spin), tilt: wrapMin(dd.tilt), spinEff: Math.round(dd.eff), speedAvg: Math.round(dd.velo * 10) / 10 };
    // the designed pitch for its rarity and comps: its new velo, break, spin direction and efficiency, and otherwise as
    // he releases it now (its VAA moved by the change in velo and IVB, worked out the way a bullpen's is)
    const vaaAt = (v, ivb) => (window.TrackmanImport && window.TrackmanImport.vaaOf ? window.TrackmanImport.vaaOf({ speed: v, ivb, relHeight: base.relHeight || 6, plateHeight: 2.5, extension: base.extension }) : null);
    const shifted = base && out && base.vaa != null && vaaAt(dd.velo, out.ivb) != null && vaaAt(base.speedAvg, base.ivb) != null ? r1(base.vaa + vaaAt(dd.velo, out.ivb) - vaaAt(base.speedAvg, base.ivb)) : base && base.vaa;
    const goalStat = base && out && { type: base.type, speedAvg: r1(dd.velo), ivb: r1(out.ivb), hb: r1(out.hb), spinAvg: Math.round(dd.spin), relHeight: base.relHeight, relSide: base.relSide, extension: base.extension, vaa: shifted, tilt: wrapMin(dd.tilt), spinEff: Math.round(dd.eff), armAngle: base.armAngle };
    const nowStat = base && { type: base.type, speedAvg: base.speedAvg, ivb: base.ivb, hb: base.hb, spinAvg: base.spinAvg, relHeight: base.relHeight, relSide: base.relSide, extension: base.extension, vaa: base.vaa, tilt: base.tilt, spinEff: base.spinEff, armAngle: base.armAngle };
    // saving the pitch as a goal: changed (now and as designed), or kept where it is
    const goalFor = (type) => ((plan && plan.goals) || []).find((x) => x.type === type) || null;
    const srcText = source === "mlb" ? `${season} MLB games` : ((sources.find((s) => s.key === source) || {}).label || "").toLowerCase();
    const nowM = base && { velo: base.speedAvg, spin: base.spinAvg, tilt: start.tilt, eff: effB, seam: start.seam, ivb: base.ivb, hb: base.hb };
    const stamp = () => ({ note: (goalFor(base.type) || {}).note || "", savedAt: new Date().toISOString(), savedBy: (store.currentUserEmail && store.currentUserEmail()) || "" });
    const saveChange = () => {
      putGoal({ type: base.type, mode: "change", source: srcText, now: nowM, goal: { velo: Math.round(dd.velo * 10) / 10, spin: dd.spin, tilt: wrapMin(dd.tilt), eff: Math.round(dd.eff), seam: dd.seam, ivb: r1(out.ivb), hb: r1(out.hb) }, ...stamp() });
      setGoalMsg(`Saved: the ${base.type.toLowerCase()} goal is on the plan below.`);
    };
    const saveMaintain = () => {
      putGoal({ type: base.type, mode: "maintain", source: srcText, now: nowM, goal: nowM, ...stamp() });
      setGoalMsg(`Saved: keep the ${base.type.toLowerCase()} as it is. It's on the plan below.`);
    };
    return (
      <React.Fragment>
      <div className="panel pd-wrap no-print">
        <h2>Pitch Design <small>change the spin, see what it would do to the movement</small></h2>
        <div className="bp-comps-bar">
          <span className="pill-tabs bp-scope" role="group" aria-label="Start from">
            {sources.map((s) => <button key={s.key} type="button" className={`pill-tab ${source === s.key ? "active" : ""}`} onClick={() => { setSource(s.key); setPick(""); }}>{s.label}</button>)}
          </span>
          {source === "mlb" && (
            <select className="bp-tag" value={season} aria-label="MLB season" onChange={(e) => setSeason(Number(e.target.value))}>
              {[0, 1, 2, 3].map((k) => defaultSeason() - k).map((y) => <option key={y} value={y}>{y} MLB season</option>)}
            </select>
          )}
          {source === "mlb" && mlb.loading && <span className="timestamp-note">Loading Baseball Savant…</span>}
        </div>
        {pitches.length > 0 && (
          <div className="bp-key" role="group" aria-label="Pitch to design from">
            {pitches.map((p) => (
              <button key={p.type} type="button" className={`bp-key-chip${base && base.type === p.type ? " on" : ""}`} aria-pressed={base && base.type === p.type} onClick={() => setPick(p.type)}>
                <span className="bp-dot" style={{ background: colorOf(p.type) }} />{p.type} <small>{p.qty}</small>
                {goalFor(p.type) && <span className={`pd-chip-goal ${goalFor(p.type).mode}`}>{goalFor(p.type).mode === "change" ? "goal" : "keep"}</span>}
              </button>
            ))}
          </div>
        )}
        {!pitches.length && !(source === "mlb" && mlb.loading) && <p className="assess-row-note">No pitches here with velo, spin and movement to design from.</p>}
        {base && out && (
          <React.Fragment>
            <div className="pd-top">
              <SpinControls ctl={spinCtl} set={setSpinCtl} />
              <button type="button" className="btn btn-small-grey" onClick={() => setD(startOf(base))}>Reset to his {base.type.toLowerCase()}</button>
              <span className="pd-save">
                <button type="button" className="btn btn-primary" onClick={saveChange}>Save as goal: change</button>
                <button type="button" className="btn btn-secondary" onClick={saveMaintain}>Goal: maintain shape and qualities</button>
              </span>
              {goalMsg && <span className="assess-row-note" role="status">{goalMsg}</span>}
            </div>
            <div className="pd-grid">
              <div className="pd-col">
                <h3>Now</h3>
                <SpinBall key={`now-${baseKey}`} s={ballNow} ctl={spinCtl} size={200} />
              </div>
              <div className="pd-col">
                <h3>Designed</h3>
                <SpinBall key={`new-${baseKey}`} s={ballNew} ctl={spinCtl} size={200}
                  overlay={(sz) => <DesignHandles size={sz} tilt={dd.tilt} eff={dd.eff} pov={spinCtl.pov} color={colorOf(base.type)} onChange={(patch) => setD((p) => ({ ...(p && p.velo != null ? p : dd), ...patch }))} />} />
                <p className="pd-handles-key">Drag on the ball: <b className="pd-k-spin">●</b> spin direction · <b className="pd-k-axis">◉</b> the spin axis: pull in for gyro, push out for efficiency, drag around to turn it</p>
              </div>
              <div className="pd-col pd-controls">
                <h3>Change it</h3>
                {slider({ label: "Velo", k: "velo", min: Math.round(start.velo - 10), max: Math.round(start.velo + 10), step: 0.1, fmt: (v) => `${v.toFixed(1)} mph`, deltaFmt: (v) => `${sign(v)} mph` })}
                {slider({ label: "Spin direction", k: "tilt", min: start.tilt - 360, max: start.tilt + 360, step: 1, fmt: clockExact, deltaFmt: (v) => `${v > 0 ? "+" : "−"}${Math.floor(Math.abs(v) / 60)}:${String(Math.round(Math.abs(v) % 60)).padStart(2, "0")}`, note: `${Math.round(Math.abs(dd.tilt - start.tilt) / 2)}° ${dd.tilt >= start.tilt ? "clockwise" : "counterclockwise"} of where it is (behind the pitcher); the spin rate stays ${Math.round(dd.spin)} rpm` })}
                {slider({ label: "Gyro ⇄ efficiency", k: "eff", min: 0, max: 100, step: 1, fmt: (v) => `${Math.round(v)}% eff. · ${100 - Math.round(v)}% gyro`, deltaFmt: (v) => `${sign(v, 0)}% eff.`, ends: ["← more gyro (cut, bullet spin)", "more efficient (ride, run) →"], note: `${Math.round((dd.spin * dd.eff) / 100)} rpm active (moves the ball) · ${Math.round(dd.spin - (dd.spin * dd.eff) / 100)} rpm gyro (doesn't)` })}
              </div>
            </div>
            <div className="pd-grid pd-results">
              <div className="bp-table-wrap">
                <table className="assess-table bp-table pd-table">
                  <thead><tr><th></th><th>Now</th><th>Designed</th><th>Change</th></tr></thead>
                  <tbody>{rows.map(([k, a, b, c]) => <tr key={k}><td>{k}</td><td>{a}</td><td><b>{b}</b></td><td className={c && c !== "–" ? "pd-chg" : ""}>{c}</td></tr>)}</tbody>
                </table>
              </div>
              <DesignChart pitches={pitches} base={base} out={out} />
            </div>
            {goalStat && (
              <div className="pd-goal-comps">
                <h3>The designed pitch: its rarity and 5 closest MLB pitches</h3>
                <CompsModule athlete={athlete} stats={[goalStat]} meLabel="designed" nowStat={nowStat} />
              </div>
            )}
            <p className="timestamp-note">
              Predicted from the change in Magnus lift (Alan Nathan's model of how lift grows with active spin for the speed), scaled from this pitch's own measured break, so leaving everything as is predicts no change. Spin direction is the pitcher's clock, as TrackMan's tilt; horizontal break is the pitcher's view (+ to his right).
              {source === "mlb"
                ? ` Seam effects (the seam-shifted wake): his ${base.type.toLowerCase()} moves ${seamText(start.seam)} of where its measured spin sends it (seen from behind the pitcher), about ${seamInches(mNow, start.seam).toFixed(1)}" of its movement.`
                : ` Seam effects (the seam-shifted wake): TrackMan's tilt here is worked out from the movement, so this pitch's own seam effects read as none; the design adds the change the MLB model predicts.`}
              {sswOk
                ? ` As the design changes, its seam effects change as MLB ${base.type.toLowerCase()}s with a similar spin direction, efficiency and velo do (${sswNew.n} of them in ${sswYear}, from Baseball Savant's measured spin against where each went): ${Math.abs(sswDelta) < 2 ? "no change for this design" : `they shift ${Math.round(Math.abs(sswDelta) / 2)}° ${sswDelta > 0 ? "clockwise" : "counterclockwise"}`}.`
                : sswPts ? ` Too few MLB ${base.type.toLowerCase()}s are like the design to predict its seam effects, so they're held where his are.` : " The MLB seam effects model is loading."}
              {base.spinEff == null ? ` This pitch has no spin efficiency on file, so ${ASSUMED_EFF}% is assumed.` : ""}
              {" "}It's a guide for small changes: a big change in grip or axis can change the seam effects too, which no model of spin alone can see.
            </p>
          </React.Fragment>
        )}
      </div>
      <PitchPlan athlete={athlete} plan={plan} onRemove={removeGoal} onNote={noteGoal} onOpen={openGoal} />
      </React.Fragment>
    );
  }

  // Pitching › Motion Capture: the tool from mocap.js (plain JavaScript, shared with Coach Mode), mounted here and
  // saving with the pitcher's other records
  function MoCapTab({ athlete }) {
    const ref = useRef(null);
    useEffect(() => {
      const box = ref.current;
      if (!box || !window.MoCap) return undefined;
      const store = window.AthleteStore;
      window.MoCap.mount(box, {
        athlete: { id: athlete.id, name: athlete.name, throws: athlete.throws, email: athlete.email || "" },
        onSave: async (rec) => { store.saveAssessment({ ...rec, athleteId: athlete.id }); },
        onDelete: async (rec) => { store.deleteAssessment(rec.id); },
        saveAny: async (rec) => { store.saveAssessment(rec); }, // another pitcher's session, re-run (it keeps its own athleteId)
        history: () => (store.getMocap ? store.getMocap(athlete.id) : []),
      });
      return () => box.replaceChildren();
    }, [athlete.id]); // eslint-disable-line
    return (
      <div className="panel">
        {window.MoCap ? <div ref={ref} /> : <div className="empty-state">Motion capture didn't load. Reload the page.</div>}
      </div>
    );
  }

  window.BullpensTab = BullpensTab;
  window.MoCapTab = MoCapTab; // the Pitching tab's Motion Capture (index.html)
  window.PitchDesignTab = PitchDesignTab; // the Pitching tab's Pitch Design (index.html)
  window.MlbArsenalPanel = MlbArsenal; // the Statcast tab's Savant arsenal, spin and comps (index.html)
  window.BullpenKit = { importReports, typeStats, resultText, FASTBALLS, livePitches, SpinBall };
})();
