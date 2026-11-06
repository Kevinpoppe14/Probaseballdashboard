// A bullpen's numbers by pitch type, without React, shared by the dashboard's Bullpens tab (bullpens.js), its PDF
// report (bullpen_pdf.js) and a coach's phone app (bullpen_app.js), so they all read the same: the order and colors of
// the pitch types, tilt averaged around the clock, spin efficiency estimated where TrackMan left it blank, numbers
// changed by hand, each type's figures, and the arm angle from the release.
//   window.BullpenStats = { typeStats, armAngleOf, colorOf, byType, livePitches, effOf, tiltText, ... }
(function () {
  const r1 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10);

  // the usual order and colors (close to TrackMan's own) for pitch types, anything else after them in gray
  const TYPE_ORDER = ["Fastball", "Four-Seam", "Sinker", "Two-Seam", "Cutter", "Slider", "Sweeper", "Slurve", "Curveball", "Knuckle Curve", "ChangeUp", "Changeup", "Splitter", "Knuckleball"];
  const TYPE_COLORS = { fastball: "#a3122a", "four-seam": "#a3122a", sinker: "#f6863b", "two-seam": "#f6863b", cutter: "#8d5524", slider: "#e6c229", sweeper: "#b38f00", slurve: "#c77dff", curveball: "#3a86ff", "knuckle curve": "#3a86ff", changeup: "#6aa84f", splitter: "#2a9d8f", knuckleball: "#999999" };
  const colorOf = (t) => TYPE_COLORS[String(t || "").toLowerCase()] || "#8a8a8a";
  const typeRank = (t) => { if (t === "Untagged") return 100; const i = TYPE_ORDER.findIndex((x) => x.toLowerCase() === String(t).toLowerCase()); return i === -1 ? 99 : i; };
  const byType = (a, b) => typeRank(a) - typeRank(b) || String(a).localeCompare(String(b));

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
  // Spin efficiency where TrackMan left it blank (often on a gyro slider): the share of the spin that moved the ball,
  // from how far it moved for its spin and speed. Spin-induced movement runs about as active spin over speed (the
  // Magnus lift grows with spin and speed, its flight time falls with speed), and on our bullpens with a measured
  // efficiency, movement (in) × speed (mph) ÷ active spin (rpm) comes out about 1.0. A rough figure, shown with ~.
  const effEstimate = (spin, speed, ivb, hb) => {
    if (![spin, speed, ivb, hb].every((v) => typeof v === "number") || spin < 300) return null;
    return Math.max(0, Math.min(100, Math.round((Math.hypot(ivb, hb) * speed * 100) / spin)));
  };
  const effOf = (p) => (typeof p.spinEff === "number" ? p.spinEff : effEstimate(p.spin, p.speed, p.ivb, p.hb));
  // a pitch's numbers changed by hand keep TrackMan's in p.orig ({ extension: 5.25 }); these can be changed
  const EDITABLE = [["speed", "Velo"], ["spin", "Spin"], ["tilt", "Tilt"], ["ivb", "IVB"], ["hb", "HB"], ["extension", "Ext."], ["relHeight", "Rel. ht"], ["relSide", "Rel. side"], ["spinEff", "Spin eff."]];
  const FEET = ["extension", "relHeight", "relSide"];
  const isEdited = (p, k) => !!(p.orig && Object.prototype.hasOwnProperty.call(p.orig, k));
  function typeStats(session) {
    const pitches = livePitches(session);
    const types = [...new Set(pitches.length ? pitches.map(typeOfPitch) : (session.summary || []).map((r) => r.type).filter(Boolean))].sort(byType);
    return types.map((type) => {
      const ps = pitches.filter((p) => typeOfPitch(p) === type), sum = (session.summary || []).find((r) => r.type === type) || {};
      const vals = (k) => ps.map((p) => p[k]).filter((v) => typeof v === "number");
      const avg = (k) => { const v = vals(k); return v.length ? r1(v.reduce((a, b) => a + b, 0) / v.length) : null; };
      const max = (k) => { const v = vals(k); return v.length ? r1(Math.max(...v)) : null; };
      const effAvg = avg("spinEff") != null ? Math.round(avg("spinEff")) : null;
      const effEst = effAvg == null ? effEstimate(avg("spin") ?? sum.spinAvg ?? null, avg("speed") ?? sum.speedAvg ?? null, avg("ivb"), avg("hb") ?? sum.hbAvg ?? null) : null;
      return {
        edited: EDITABLE.map(([k]) => k).filter((k) => ps.some((p) => isEdited(p, k))), spinEffEst: effEst != null,
        type, qty: ps.length || sum.qty || 0,
        speedAvg: avg("speed") ?? sum.speedAvg ?? null, speedMax: max("speed") ?? sum.speedMax ?? null,
        spinAvg: avg("spin") != null ? Math.round(avg("spin")) : sum.spinAvg != null ? Math.round(sum.spinAvg) : null,
        ivb: avg("ivb"), hb: avg("hb") ?? sum.hbAvg ?? null,
        relHeight: avg("relHeight") ?? sum.relHeight ?? null, relSide: avg("relSide") ?? sum.relSide ?? null,
        extension: avg("extension") ?? sum.extension ?? null, spinEff: effAvg ?? effEst,
        vaa: avg("vaa"), tilt: tiltAvg(ps.map((p) => p.tilt)),
      };
    });
  }
  // Arm angle, as Baseball Savant gives it: the line from the throwing shoulder to the ball at release, in degrees above
  // level (0 sidearm, about 45 three-quarters, 90 straight over the top). Savant sees the shoulder; a bullpen has only
  // the release, so the shoulder is put at 70% of his height over the middle of the rubber, from the pitches' average
  // release height and side (feet). Within a few degrees of Savant's for most pitchers.
  function armAngleOf(pitches, heightIn) {
    const ps = pitches.filter((p) => typeof p.relHeight === "number" && typeof p.relSide === "number");
    if (!ps.length || !heightIn) return null;
    const h = ps.reduce((s, p) => s + p.relHeight, 0) / ps.length, side = ps.reduce((s, p) => s + Math.abs(p.relSide), 0) / ps.length;
    return Math.round((Math.atan2(h - (0.7 * heightIn) / 12, Math.max(0.1, side)) * 180) / Math.PI);
  }

  window.BullpenStats = { r1, TYPE_ORDER, TYPE_COLORS, colorOf, typeRank, byType, UNTAGGED, typeOfPitch, livePitches, tiltMinutes, tiltText, tiltAvg, effEstimate, effOf, EDITABLE, FEET, isEdited, typeStats, armAngleOf };
})();
