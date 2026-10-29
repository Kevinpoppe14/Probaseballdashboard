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
  function ScatterChart({ pts, avgs, xr, yr, step, xLabel, yLabel, label, unit, picked, onPick, tip }) {
    const W = 420, H = Math.round(420 * Math.min(1.2, Math.max(0.75, (yr[1] - yr[0]) / (xr[1] - xr[0])))), P = 30;
    const x = (v) => P + ((v - xr[0]) / (xr[1] - xr[0])) * (W - 2 * P), y = (v) => H - P - ((v - yr[0]) / (yr[1] - yr[0])) * (H - 2 * P);
    const ticks = (r) => { const out = []; for (let t = Math.ceil(r[0] / step) * step; t <= r[1] + 1e-9; t += step) out.push(Math.round(t * 100) / 100); return out; };
    const x0 = xr[0] <= 0 && xr[1] >= 0 ? 0 : xr[0], y0 = yr[0] <= 0 && yr[1] >= 0 ? 0 : yr[0];
    return (
      <svg className="bp-plot" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        {ticks(xr).map((t) => <line key={`x${t}`} x1={x(t)} y1={y(yr[0])} x2={x(t)} y2={y(yr[1])} className={t === 0 ? "bp-axis" : "bp-grid"} />)}
        {ticks(yr).map((t) => <line key={`y${t}`} x1={x(xr[0])} y1={y(t)} x2={x(xr[1])} y2={y(t)} className={t === 0 ? "bp-axis" : "bp-grid"} />)}
        {ticks(xr).filter((t) => t !== x0).map((t) => <text key={`xl${t}`} x={x(t)} y={y(y0) + 11} className="bp-tick" textAnchor="middle">{t}</text>)}
        {ticks(yr).filter((t) => t !== y0).map((t) => <text key={`yl${t}`} x={x(x0) - 4} y={y(t) + 3} className="bp-tick" textAnchor="end">{t}</text>)}
        <text x={W / 2} y={H - 3} className="bp-axis-label" textAnchor="middle">{xLabel}</text>
        <text x={9} y={H / 2} className="bp-axis-label" textAnchor="middle" transform={`rotate(-90 9 ${H / 2})`}>{yLabel}</text>
        {avgs.map((a) => <circle key={`a${a.type}`} cx={x(a.x)} cy={y(a.y)} r={8} fill={colorOf(a.type)} fillOpacity="0.85" stroke="var(--text)" strokeWidth="1.5" pointerEvents="none" />)}
        {pts.map((p) => (
          <circle key={p.key} className={`bp-pt${picked === p.key ? " on" : ""}`} cx={x(p.x)} cy={y(p.y)} r={picked === p.key ? 7 : 5}
            fill={p.type ? colorOf(p.type) : "transparent"} fillOpacity={picked === p.key ? 1 : 0.5} stroke={p.type ? colorOf(p.type) : "var(--warn)"} strokeWidth={p.type ? 1 : 1.5}
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
    const a = 0.62, b = 0.38, c = 2 * Math.sqrt(a * b); // a + b = 1 keeps the curve on the ball
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
  const BASE = mulM(rotM([0, 1, 0], 0.5), rotM([1, 0, 0], 1.1)); // how the ball starts: a horseshoe toward you
  const gyroOf = (eff) => (eff == null ? null : Math.max(0, Math.min(100, Math.round(100 - eff)))); // gyro % is what efficiency leaves

  function drawBall(ctx, size, M, color, tiltRad) {
    const cx = size / 2, cy = size / 2, r = size * 0.38;
    ctx.clearRect(0, 0, size, size);
    // the leather: lit from the upper left, darker toward the edge
    const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.42, r * 0.1, cx, cy, r);
    g.addColorStop(0, "#ffffff"); g.addColorStop(0.55, "#f3f0e8"); g.addColorStop(0.88, "#d9d4c8"); g.addColorStop(1, "#b5afa2");
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, 2 * Math.PI); ctx.fillStyle = g; ctx.fill();
    const X = (v) => cx + v[0] * r, Y = (v) => cy - v[1] * r;
    const off = (p, S, t, a, b) => [p[0] + S[0] * a + t[0] * b, p[1] + S[1] * a + t[1] * b, p[2] + S[2] * a + t[2] * b];
    // the seam's two edges in the leather
    ctx.lineCap = "round";
    [0.022, -0.022].forEach((w) => {
      ctx.beginPath();
      let pen = false;
      SEAM.line.forEach(({ p, t, S }) => {
        if (app(M, p)[2] < 0.02) { pen = false; return; }
        const q = app(M, off(p, S, t, w, 0));
        if (pen) ctx.lineTo(X(q), Y(q)); else { ctx.moveTo(X(q), Y(q)); pen = true; }
      });
      ctx.strokeStyle = "rgba(150, 140, 125, 0.55)"; ctx.lineWidth = Math.max(0.6, r * 0.014); ctx.stroke();
    });
    // the stitches: a red slash each side of the seam, angled into a herringbone
    ctx.lineWidth = Math.max(1, r * 0.04);
    SEAM.stitches.forEach(({ p, t, S }) => {
      const z = app(M, p)[2];
      if (z < 0.03) return;
      const alpha = Math.min(1, z * 4) * (0.7 + 0.3 * z);
      ctx.strokeStyle = `rgba(196, 30, 42, ${alpha.toFixed(3)})`;
      [1, -1].forEach((side) => {
        const a = app(M, off(p, S, t, side * 0.115, -0.035)), b = app(M, off(p, S, t, side * 0.035, 0.025));
        ctx.beginPath(); ctx.moveTo(X(a), Y(a)); ctx.lineTo(X(b), Y(b)); ctx.stroke();
      });
    });
    // a soft rim
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, 2 * Math.PI); ctx.strokeStyle = "rgba(0, 0, 0, 0.28)"; ctx.lineWidth = 1; ctx.stroke();
    // which way the spin moves it (the tilt), just outside the ball
    if (tiltRad != null) {
      const d = r + size * 0.06, w = size * 0.035, sx = Math.sin(tiltRad), sy = -Math.cos(tiltRad);
      const tipX = cx + sx * (d + w * 1.6), tipY = cy + sy * (d + w * 1.6), bx = cx + sx * d, by = cy + sy * d;
      ctx.beginPath(); ctx.moveTo(tipX, tipY); ctx.lineTo(bx - sy * w, by + sx * w); ctx.lineTo(bx + sy * w, by - sx * w); ctx.closePath();
      ctx.fillStyle = color; ctx.fill();
    }
  }

  function SpinBall({ s }) {
    const ref = useRef(null);
    const tiltRad = s.tilt != null ? (s.tilt / 720) * 2 * Math.PI : null;
    const eff = s.spinEff != null ? Math.max(0, Math.min(1, s.spinEff / 100)) : 1;
    const gyro = gyroOf(s.spinEff);
    useEffect(() => {
      const cv = ref.current;
      if (!cv) return undefined;
      const size = 132, dpr = window.devicePixelRatio || 1;
      cv.width = size * dpr; cv.height = size * dpr;
      const ctx = cv.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // the spin axis: the part that moves the ball (across the face you see, square to the tilt), leaned toward the
      // catcher by its share of gyro
      const th = tiltRad != null ? tiltRad : 0, m = [Math.sin(th), Math.cos(th), 0];
      const tr = [-m[1], m[0], 0]; // z x m: the backspin-style axis for this tilt
      const gy = 1 - eff;
      const u0 = [tr[0] * eff, tr[1] * eff, -gy], ul = Math.hypot(u0[0], u0[1], u0[2]) || 1, u = u0.map((v) => v / ul);
      const revPerSec = s.spinAvg ? s.spinAvg / 2400 : 0;
      const still = !revPerSec || (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
      let raf = 0, t0 = null, visible = true;
      const frame = (ts) => {
        if (t0 == null) t0 = ts;
        const ang = still ? 0.6 : ((ts - t0) / 1000) * revPerSec * 2 * Math.PI;
        drawBall(ctx, size, mulM(rotM(u, ang), BASE), colorOf(s.type), tiltRad);
        if (!still && visible) raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
      // only turns while on screen
      const io = window.IntersectionObserver ? new IntersectionObserver((entries) => {
        const was = visible; visible = entries[0].isIntersecting;
        if (visible && !was && !still) raf = requestAnimationFrame(frame);
      }) : null;
      if (io) io.observe(cv);
      return () => { cancelAnimationFrame(raf); if (io) io.disconnect(); };
    }, [s.type, s.spinAvg, s.tilt, s.spinEff]); // eslint-disable-line
    const active = s.spinAvg != null && s.spinEff != null ? Math.round((s.spinAvg * s.spinEff) / 100) : null;
    return (
      <div className="bp-ball">
        <div className="bp-ball-type" style={{ color: colorOf(s.type) }}>{s.type}</div>
        <canvas ref={ref} className="bp-ball-canvas" role="img" aria-label={`${s.type}: ${s.spinAvg || "?"} rpm${s.tilt != null ? `, tilt ${tiltText(s.tilt)}` : ""}${gyro != null ? `, ${gyro}% gyro` : ""}`} />
        <div className="bp-ball-stats">
          <b>{s.spinAvg != null ? `${s.spinAvg} rpm` : "– rpm"}</b>
          <span>Tilt {s.tilt != null ? tiltText(s.tilt) : "–"}</span>
          <span>Spin eff. {s.spinEff != null ? `${s.spinEff}%` : "–"}{gyro != null ? ` · ${gyro}% gyro` : ""}</span>
          {active != null && <span>Active ≈ {active} rpm</span>}
          {active != null && <span>Gyro ≈ {s.spinAvg - active} rpm</span>}
        </div>
      </div>
    );
  }

  // how a coach has arranged a session's modules (order, half width, folded away), kept per coach on this computer
  const DEFAULT_LAYOUT = { order: ["types", "movement", "release", "spin", "pitches", "trend", "notes"], half: { movement: true, release: true }, closed: { pitches: true } };
  const layoutKey = () => `bullpenLayout:${(window.AthleteStore.currentUserEmail && window.AthleteStore.currentUserEmail()) || "me"}`;
  const readLayout = () => {
    try { const v = JSON.parse(localStorage.getItem(layoutKey()) || "null"); if (v && Array.isArray(v.order)) return { order: v.order, half: v.half || {}, closed: v.closed || {} }; } catch (e) { /* private window */ }
    return DEFAULT_LAYOUT;
  };
  const writeLayout = (v) => { try { localStorage.setItem(layoutKey(), JSON.stringify(v)); } catch (e) { /* private window: not remembered */ } };

  function SessionDetail({ session, sessions, onSave }) {
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

    // the two charts, for this session or every session (remembered on this computer)
    const [scope, setScopeState] = useState(() => { try { return localStorage.getItem("bullpenChartScope") || "session"; } catch (e) { return "session"; } });
    const setScope = (v) => { setScopeState(v); setPicked(null); try { localStorage.setItem("bullpenChartScope", v); } catch (e) { /* private window */ } };
    const many = (sessions || []).length > 1;
    const all = scope === "all" && many;
    const chartPitches = (all ? sessions : [session]).flatMap((s) => livePitches(s).map((p) => ({ ...p, sid: s.id, key: `${s.id}:${p.no}`, dateLabel: all ? shortDate(s.date) : "" })));
    const chartStats = all ? typeStats({ pitches: chartPitches }) : stats;
    const mv = chartPitches.filter((p) => typeof p.hb === "number" && typeof p.ivb === "number").map((p) => ({ ...p, x: p.hb, y: p.ivb }));
    const mvR = Math.max(25, Math.ceil(Math.max(0, ...mv.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y)))) / 5) * 5 + 5);
    const rl = chartPitches.filter((p) => typeof p.relSide === "number" && typeof p.relHeight === "number").map((p) => ({ ...p, x: p.relSide, y: p.relHeight }));
    const rlX = rangeOf(rl.map((p) => p.x), [-4, 4], 1), rlY = rangeOf(rl.map((p) => p.y), [0, 7], 1);
    const pk = picked != null ? chartPitches.find((p) => p.key === picked) : null;

    // ---- the report's modules, which a coach can arrange: drag one by its ⋮⋮, make it half or full width, fold it
    // away. The arrangement is kept per coach on this computer.
    const scopeToggle = many ? (
      <span className="pill-tabs bp-scope" role="group" aria-label="Charts show">
        <button type="button" className={`pill-tab ${!all ? "active" : ""}`} onClick={() => setScope("session")}>This session</button>
        <button type="button" className={`pill-tab ${all ? "active" : ""}`} onClick={() => setScope("all")}>All ({sessions.length})</button>
      </span>
    ) : null;
    const spinStats = stats.filter((s) => s.spinAvg != null && s.type !== UNTAGGED);
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
            <ScatterChart pts={mv} avgs={chartStats.filter((s) => s.ivb != null && s.hb != null && s.type !== UNTAGGED).map((s) => ({ type: s.type, x: s.hb, y: s.ivb }))}
              xr={[-mvR, mvR]} yr={[-mvR, mvR]} step={10} xLabel="Horz. break (in)" yLabel="Induced vert. break (in)" label="Movement: horizontal break by induced vertical break, one dot per pitch"
              picked={picked} onPick={setPicked} tip={(p) => `${p.ivb} IVB, ${p.hb} HB, ${p.speed} mph`} />
            <p className="timestamp-note">Click a pitch to see it, change its type or take it out. Ringed dots are each type's average.</p>
          </React.Fragment>
        ),
      },
      release: {
        title: "Release point", sub: all ? "catcher's view, every session" : "catcher's view", extra: scopeToggle,
        body: (
          <React.Fragment>
            <ScatterChart pts={rl} avgs={chartStats.filter((s) => s.relHeight != null && s.relSide != null && s.type !== UNTAGGED).map((s) => ({ type: s.type, x: s.relSide, y: s.relHeight }))}
              xr={rlX} yr={rlY} step={1} xLabel="Release side (ft)" yLabel="Release height (ft)" label="Release point: release side by release height, one dot per pitch"
              picked={picked} onPick={setPicked} tip={(p) => `${ftIn(p.relHeight)} high, ${ftIn(p.relSide)} side`} />
            <p className="timestamp-note">Click a pitch to see it, change its type or take it out. Ringed dots are each type's average.</p>
          </React.Fragment>
        ),
      },
      spin: spinStats.length ? {
        title: "Spin by pitch type",
        body: (
          <React.Fragment>
            <div className="bp-balls">{spinStats.map((s) => <SpinBall key={s.type} s={s} />)}</div>
            <p className="timestamp-note">Each ball turns on its pitch's average spin axis as the catcher sees it, faster for more spin (though far slower than the real thing). The arrow is the tilt, the way the spin moves the ball (12:00 is straight backspin). Spin efficiency and gyro add up to 100%: 100% efficient is pure backspin or sidespin, 0% is all gyro (bullet spin, the axis pointing at the catcher), and the ball's axis leans by that split. Active spin (spin × efficiency) is the part that moves the ball; gyro spin is the rest, turning it like a bullet.</p>
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
                <thead><tr><th aria-label="Check"></th><th>#</th><th>Type</th><th>Velo</th><th>Spin</th><th>Tilt</th><th>IVB</th><th>HB</th><th title="Vertical approach angle, estimated">VAA</th><th>Plate ht</th><th>Ext.</th><th>Rel. ht</th><th>Rel. side</th><th>Spin eff.</th><th aria-label="Remove"></th></tr></thead>
                <tbody>
                  {live.map((p) => (
                    <tr key={p.no} className={`${p.type ? "" : "bp-untagged-row"}${picked === `${session.id}:${p.no}` ? " bp-picked-row" : ""}`}>
                      <td><input type="checkbox" checked={checked.includes(p.no)} onChange={() => toggle(p.no)} aria-label={`Check pitch ${p.no}`} /></td>
                      <td>{p.no}</td>
                      <td className="bp-type-cell"><span className="bp-dot" style={{ background: p.type ? colorOf(p.type) : "transparent" }} />{tagSelect(p.type || "", (v) => retag([p.no], v), `Pitch ${p.no} type`)}</td>
                      <td>{show(p.speed)}</td><td>{show(p.spin)}</td><td>{show(p.tilt)}</td><td>{show(p.ivb)}</td><td>{show(p.hb)}</td>
                      <td>{deg(p.vaa)}</td><td>{ftIn(p.plateHeight)}</td>
                      <td>{ftIn(p.extension)}</td><td>{ftIn(p.relHeight)}</td><td>{ftIn(p.relSide)}</td><td>{show(p.spinEff, p.spinEff != null ? "%" : "")}</td>
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
    const order = [...layout.order.filter((k) => DEFAULT_LAYOUT.order.includes(k)), ...DEFAULT_LAYOUT.order.filter((k) => !layout.order.includes(k))];
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
        {pk && (
          <div className="bp-pick-pop" role="dialog" aria-label={`Pitch ${pk.no}`}>
            <h3><span className="bp-dot" style={{ background: pk.type ? colorOf(pk.type) : "transparent" }} />Pitch #{pk.no}{all ? <small> {shortDate((sessions.find((s) => s.id === pk.sid) || {}).date)}</small> : null}</h3>
            <p>{[pk.speed != null && `${pk.speed} mph`, pk.spin != null && `${pk.spin} rpm`, pk.tilt && `tilt ${pk.tilt}`].filter(Boolean).join(" · ")}</p>
            <p>{[pk.ivb != null && `${pk.ivb} IVB`, pk.hb != null && `${pk.hb} HB`, pk.vaa != null && `${deg(pk.vaa)} VAA`].filter(Boolean).join(" · ")}</p>
            <p>{[pk.relHeight != null && `release ${ftIn(pk.relHeight)} high, ${ftIn(pk.relSide)} side`, pk.extension != null && `${ftIn(pk.extension)} ext.`].filter(Boolean).join(" · ")}</p>
            <label className="bp-pick-tag">Pitch type {tagSelect(pk.type || "", (v) => retag([pk.no], v, pk.sid), `Pitch ${pk.no} type`)}</label>
            <div className="bp-pick-actions">
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
      const ok = await window.askConfirm({ title: `Delete the ${fmtDate(b.date)} bullpen?`, text: "Its pitches and notes are deleted. You can import the PDF again to get it back.", ok: "Delete", danger: true });
      if (!ok) return;
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
        {selected && <SessionDetail key={selected.id} session={selected} sessions={list} onSave={save} />}
      </div>
    );
  }

  window.BullpensTab = BullpensTab;
  window.BullpenKit = { importReports, typeStats, resultText, FASTBALLS, livePitches };
})();
