// A bullpen as a DST-branded PDF report (portrait, letter), from the Bullpens tab (bullpens.js: PDF report on a
// session): the pitcher, the date and the facility under the DST logo, the coach's notes, the pitch types' numbers,
// the movement chart (with his arm angle), the release point and the locations, then every pitch. Drawn straight into
// the PDF (sharp at any size), in the same red and black as the program and nutrition PDFs. Numbers changed by hand
// are marked *, a spin efficiency TrackMan left blank and estimated from the movement ~.
//   BullpenPdf.save(o) downloads it, BullpenPdf.email(o, { to, cc, subject, body }) sends it from the coach's address,
//   BullpenPdf.build(o) -> { pdf, file }; o: { athlete: { name, throws, heightIn }, session, notes } and, optionally,
//   the dashboard's own stats, pitches (live, in order), armDeg, heightNote, colorOf, effOf (else bullpen_stats.js')
//   BullpenPdf.mailText({ athlete, session, link }): the email's opening message
(function () {
  const loadScript = (src) => new Promise((ok, bad) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = () => bad(new Error("Couldn't load the PDF maker. Check your connection and try again.")); document.head.appendChild(s); });
  async function ready() {
    if (!window.jspdf) await loadScript("https://unpkg.com/jspdf@2.5.2/dist/jspdf.umd.min.js");
    if (!window.jspdf.jsPDF.API.autoTable) await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js");
    return window.jspdf.jsPDF;
  }
  const RED = [200, 16, 46], INK = [20, 20, 20], SOFT = [245, 245, 245];
  const hex = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(h || ""); const n = m ? parseInt(m[1], 16) : 0x8a8a8a; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const f1 = (v) => (num(v) == null ? "–" : (Math.round(v * 10) / 10).toFixed(1));
  const ftIn = (v) => { if (num(v) == null) return "–"; const s = v < 0 ? "-" : "", a = Math.abs(v), f = Math.floor(a), i = Math.round((a - f) * 12); return i === 12 ? `${s}${f + 1}'` : `${s}${f}'${i ? ` ${i}"` : ""}`; };
  const fmtDay = (key) => { const d = new Date(`${key}T00:00:00`); return isNaN(d) ? key || "" : d.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" }); };
  const tiltText = (mins) => { if (mins == null) return "–"; if (typeof mins === "string") return mins; const q = Math.round(mins / 15) * 15 % 720, h = Math.floor(q / 60); return `${h === 0 ? 12 : h}:${String(q % 60).padStart(2, "0")}`; };

  // a scatter chart in the box (x, y, w, h): grid, zero lines, axis labels, the pitches as dots, each type's average
  // ringed; `line` (movement: his arm angle through the middle) and `zone` (the strike zone) optional
  function scatter(pdf, x, y, w, h, o) {
    const [x0, x1] = o.xr, [y0, y1] = o.yr, L = 30, B = 26, T = 18, R = 8;
    const px = (v) => x + L + ((v - x0) / (x1 - x0)) * (w - L - R), py = (v) => y + T + (1 - (v - y0) / (y1 - y0)) * (h - T - B);
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(10.5); pdf.setTextColor(...INK); pdf.text(o.title, x, y + 10);
    if (o.sub) { pdf.setFont("helvetica", "normal"); pdf.setFontSize(8); pdf.setTextColor(120); pdf.text(o.sub, x + w, y + 10, { align: "right" }); }
    pdf.setDrawColor(225); pdf.setLineWidth(0.5);
    pdf.setFont("helvetica", "normal"); pdf.setFontSize(7); pdf.setTextColor(130);
    for (let v = Math.ceil(x0 / o.step) * o.step; v <= x1 + 1e-9; v += o.step) { pdf.line(px(v), py(y0), px(v), py(y1)); pdf.text(String(Math.round(v * 10) / 10), px(v), py(y0) + 9, { align: "center" }); }
    for (let v = Math.ceil(y0 / o.step) * o.step; v <= y1 + 1e-9; v += o.step) { pdf.line(px(x0), py(v), px(x1), py(v)); pdf.text(String(Math.round(v * 10) / 10), px(x0) - 3, py(v) + 2.5, { align: "right" }); }
    pdf.setDrawColor(150); pdf.setLineWidth(0.8);
    if (x0 < 0 && x1 > 0 && o.zeros !== false) pdf.line(px(0), py(y0), px(0), py(y1));
    if (y0 < 0 && y1 > 0 && o.zeros !== false) pdf.line(px(x0), py(0), px(x1), py(0));
    pdf.setDrawColor(180); pdf.setLineWidth(0.6); pdf.rect(px(x0), py(y1), px(x1) - px(x0), py(y0) - py(y1));
    pdf.setFontSize(8); pdf.setTextColor(90);
    pdf.text(o.xLabel, (px(x0) + px(x1)) / 2, y + h - 4, { align: "center" });
    pdf.text(o.yLabel, x + 9, (py(y0) + py(y1)) / 2 + pdf.getTextWidth(o.yLabel) / 2, { angle: 90 }); // (rotated text ignores align)
    if (o.zone) { pdf.setDrawColor(...INK); pdf.setLineWidth(1); pdf.rect(px(o.zone.x0), py(o.zone.z1), px(o.zone.x1) - px(o.zone.x0), py(o.zone.z0) - py(o.zone.z1)); }
    if (o.line) {
      // through the middle at the angle, edge to edge, clipped to the box
      const a = (o.line.deg * Math.PI) / 180, dx = Math.cos(a) * o.line.side, dy = Math.sin(a);
      let t = Infinity;
      [[dx, x1, x0], [dy, y1, y0]].forEach(([d, hi, lo]) => { if (Math.abs(d) > 1e-6) t = Math.min(t, Math.abs((d > 0 ? hi : lo) / d), Math.abs((d > 0 ? lo : hi) / d)); });
      pdf.setDrawColor(...INK); pdf.setLineWidth(0.9); pdf.setLineDashPattern([3, 2.5], 0);
      pdf.line(px(-dx * t), py(-dy * t), px(dx * t), py(dy * t));
      pdf.setLineDashPattern([], 0);
      pdf.setFont("helvetica", "bold"); pdf.setFontSize(7.5); pdf.setTextColor(...INK);
      pdf.text(`Arm angle ${o.line.deg}°`, px(dx * t * 0.55) + (o.line.side > 0 ? -2 : 2), py(dy * t * 0.55) - 4, { align: o.line.side > 0 ? "right" : "left" });
    }
    const clampX = (v) => Math.max(x0, Math.min(x1, v)), clampY = (v) => Math.max(y0, Math.min(y1, v));
    const alpha = (a) => { try { pdf.setGState(new pdf.GState({ opacity: a })); } catch (e) { /* no transparency */ } };
    alpha(0.7);
    o.pts.forEach((p) => { pdf.setFillColor(...hex(p.color)); pdf.circle(px(clampX(p.x)), py(clampY(p.y)), 2.4, "F"); });
    alpha(1);
    (o.avgs || []).forEach((p) => { pdf.setFillColor(...hex(p.color)); pdf.setDrawColor(255); pdf.setLineWidth(1.2); pdf.circle(px(clampX(p.x)), py(clampY(p.y)), 4.6, "FD"); pdf.setDrawColor(...INK); pdf.setLineWidth(0.5); pdf.circle(px(clampX(p.x)), py(clampY(p.y)), 5.4, "S"); });
  }

  async function build(o) {
    const JsPDF = await ready();
    const pdf = new JsPDF({ orientation: "portrait", unit: "pt", format: "letter" });
    const W = pdf.internal.pageSize.getWidth(), H = pdf.internal.pageSize.getHeight(), M = 40;
    const BS = window.BullpenStats, session = o.session;
    const pitches = o.pitches || BS.livePitches(session).slice().sort((a, b) => a.no - b.no), stats = o.stats || BS.typeStats(session);
    const colorOf = o.colorOf || BS.colorOf, effOf = o.effOf || BS.effOf;
    if (o.armDeg === undefined) o = { ...o, armDeg: BS.armAngleOf(pitches, o.athlete.heightIn || 74), heightNote: o.athlete.heightIn ? "from his release and height" : "from his release, assuming 6'2\"" };
    const edited = (p, k) => !!(p.orig && Object.prototype.hasOwnProperty.call(p.orig, k));
    let logo = null, ratio = 1;
    // the logo drawn down to the size it prints at (the file itself is large)
    try {
      const im = await new Promise((ok, bad) => { const x = new Image(); x.onload = () => ok(x); x.onerror = bad; x.src = "assets/dst-logo.png"; });
      ratio = im.naturalWidth / im.naturalHeight;
      const c = document.createElement("canvas"); c.height = 160; c.width = Math.round(160 * ratio);
      c.getContext("2d").drawImage(im, 0, 0, c.width, c.height); logo = c.toDataURL("image/png");
    } catch (e) { logo = null; }

    // ---- the heading
    let y = M;
    if (logo) pdf.addImage(logo, "PNG", W - M - 40 * ratio, M - 6, 40 * ratio, 40);
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(19); pdf.setTextColor(...RED);
    pdf.text(`${o.athlete.name || "Pitcher"} · Bullpen Report`, M, y + 14);
    pdf.setFont("helvetica", "normal"); pdf.setFontSize(10.5); pdf.setTextColor(70);
    const fastest = Math.max(0, ...pitches.map((p) => num(p.speed) || 0));
    pdf.text([fmtDay(session.date), session.facility, `${pitches.length} pitches`, fastest ? `top velo ${fastest.toFixed(1)} mph` : "", o.athlete.throws ? `throws ${o.athlete.throws === "L" ? "left" : "right"}` : ""].filter(Boolean).join("  ·  "), M, y + 31);
    y += 44;
    pdf.setDrawColor(...RED); pdf.setLineWidth(1.5); pdf.line(M, y, W - M, y);
    y += 16;

    // ---- the coach's notes
    const notes = String(o.notes || "").trim();
    if (notes) {
      pdf.setFont("helvetica", "bold"); pdf.setFontSize(12); pdf.setTextColor(...RED); pdf.text("Coach's notes", M, y + 4);
      y += 12;
      pdf.setFont("helvetica", "normal"); pdf.setFontSize(10); pdf.setTextColor(30);
      const lines = pdf.splitTextToSize(notes, W - 2 * M - 20);
      const bh = lines.length * 13 + 14;
      pdf.setFillColor(...SOFT); pdf.setDrawColor(...RED); pdf.setLineWidth(0); pdf.rect(M, y, W - 2 * M, bh, "F");
      pdf.setFillColor(...RED); pdf.rect(M, y, 3, bh, "F");
      pdf.text(lines, M + 12, y + 16);
      y += bh + 18;
    }

    // ---- the pitch types
    const typed = stats.filter((s) => s.qty > 0);
    const mark = (s, k, text) => (s.edited && s.edited.includes(k) && text !== "–" ? `${text}*` : text);
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(12); pdf.setTextColor(...RED); pdf.text("Pitch types", M, y + 4);
    y += 10;
    pdf.autoTable({
      startY: y, margin: { left: M, right: M }, theme: "grid",
      head: [["Pitch", "#", "Velo", "Max", "Spin", "Tilt", "IVB", "HB", "Spin eff.", "VAA", "Ext.", "Rel. ht", "Rel. side"]],
      body: typed.map((s) => [s.type, s.qty, mark(s, "speed", f1(s.speedAvg)), mark(s, "speed", f1(s.speedMax)), mark(s, "spin", s.spinAvg != null ? String(s.spinAvg) : "–"), tiltText(s.tilt),
        mark(s, "ivb", f1(s.ivb)), mark(s, "hb", f1(s.hb)), s.spinEff == null ? "–" : `${s.spinEffEst ? "~" : ""}${s.spinEff}%`, s.vaa != null ? `${s.vaa.toFixed(1)}°` : "–",
        mark(s, "extension", ftIn(s.extension)), mark(s, "relHeight", ftIn(s.relHeight)), mark(s, "relSide", ftIn(s.relSide))]),
      styles: { font: "helvetica", fontSize: 8.5, cellPadding: 3.5, textColor: 30, lineColor: 210, lineWidth: 0.4, halign: "center" },
      headStyles: { fillColor: INK, textColor: 255, fontStyle: "bold" },
      alternateRowStyles: { fillColor: SOFT },
      columnStyles: { 0: { halign: "left", fontStyle: "bold", cellPadding: { left: 14, top: 3.5, bottom: 3.5, right: 3.5 } } },
      didDrawCell: (d) => { if (d.section === "body" && d.column.index === 0) { pdf.setFillColor(...hex(colorOf(typed[d.row.index].type))); pdf.circle(d.cell.x + 7, d.cell.y + d.cell.height / 2, 3, "F"); } },
    });
    y = pdf.lastAutoTable.finalY + 8;
    pdf.setFont("helvetica", "normal"); pdf.setFontSize(7.5); pdf.setTextColor(110);
    const foot = ["Velocity mph, spin rpm, break inches, tilt on the pitcher's clock."];
    if (typed.some((s) => s.spinEffEst)) foot.push("~ spin efficiency TrackMan left blank, estimated from the movement for its spin and speed.");
    if (typed.some((s) => s.edited && s.edited.length)) foot.push("* includes numbers corrected by hand.");
    if (pitches.some((p) => p.vaa != null)) foot.push("VAA estimated from release, extension, velo, IVB and location.");
    const fl = pdf.splitTextToSize(foot.join(" "), W - 2 * M);
    pdf.text(fl, M, y + 4);
    y += fl.length * 9 + 14;

    // ---- the charts: movement and release side by side, then the locations
    const colW = (W - 2 * M - 20) / 2, chartH = colW;
    if (y + chartH > H - M - 20) { pdf.addPage(); y = M; }
    const named = (s) => s.type && s.type !== "Untagged";
    const mv = pitches.filter((p) => num(p.ivb) != null && num(p.hb) != null);
    const mvR = Math.max(25, Math.ceil(Math.max(0, ...mv.map((p) => Math.max(Math.abs(p.hb), Math.abs(p.ivb)))) / 5) * 5 + 5);
    scatter(pdf, M, y, colW, chartH, {
      title: "Movement", sub: "pitcher's view", xr: [-mvR, mvR], yr: [-mvR, mvR], step: 10, xLabel: "Horizontal break (in)", yLabel: "Induced vertical break (in)",
      pts: mv.map((p) => ({ x: p.hb, y: p.ivb, color: colorOf(p.type) })),
      avgs: typed.filter((s) => named(s) && s.ivb != null && s.hb != null).map((s) => ({ x: s.hb, y: s.ivb, color: colorOf(s.type) })),
      line: o.armDeg != null ? { deg: o.armDeg, side: o.athlete.throws === "L" ? -1 : 1 } : null,
    });
    const rl = pitches.filter((p) => num(p.relSide) != null && num(p.relHeight) != null);
    const rng = (vals, lo, hi) => [Math.floor(Math.min(lo, ...vals.map((v) => v - 1))), Math.ceil(Math.max(hi, ...vals.map((v) => v + 1)))];
    scatter(pdf, M + colW + 20, y, colW, chartH, {
      title: "Release point", sub: "catcher's view", xr: rng(rl.map((p) => -p.relSide), -4, 4), yr: rng(rl.map((p) => p.relHeight), 0, 7), step: 1, xLabel: "Release side (ft)", yLabel: "Release height (ft)",
      pts: rl.map((p) => ({ x: -p.relSide, y: p.relHeight, color: colorOf(p.type) })),
      avgs: typed.filter((s) => named(s) && s.relHeight != null && s.relSide != null).map((s) => ({ x: -s.relSide, y: s.relHeight, color: colorOf(s.type) })),
    });
    y += chartH + 10;
    // the key: each type's color
    let kx = M;
    pdf.setFont("helvetica", "normal"); pdf.setFontSize(8.5); pdf.setTextColor(40);
    typed.filter(named).forEach((s) => { pdf.setFillColor(...hex(colorOf(s.type))); pdf.circle(kx + 3, y + 3, 3, "F"); pdf.text(`${s.type} (${s.qty})`, kx + 9, y + 6); kx += pdf.getTextWidth(`${s.type} (${s.qty})`) + 22; });
    y += 16;
    if (o.armDeg != null) { pdf.setFontSize(7.5); pdf.setTextColor(110); const t = pdf.splitTextToSize(`The dotted line is his arm angle (about ${o.armDeg}°, ${o.heightNote || "from his release"}): a pitch thrown straight off his hand moves along it.`, W - 2 * M); pdf.text(t, M, y + 2); y += t.length * 9 + 8; }

    const loc = pitches.filter((p) => num(p.plateSide) != null && num(p.plateHeight) != null);
    if (loc.length) {
      if (y + colW > H - M - 20) { pdf.addPage(); y = M; }
      scatter(pdf, M, y, colW, colW, {
        title: "Location", sub: "catcher's view", xr: [-2.5, 2.5], yr: [0, 5], step: 1, xLabel: "Plate side (ft)", yLabel: "Plate height (ft)", zeros: false,
        zone: { x0: -0.83, x1: 0.83, z0: 1.5, z1: 3.5 },
        pts: loc.map((p) => ({ x: p.plateSide, y: p.plateHeight, color: colorOf(p.type) })),
      });
      // beside it: strikes by pitch type
      const inZone = (p) => p.plateSide >= -0.83 && p.plateSide <= 0.83 && p.plateHeight >= 1.5 && p.plateHeight <= 3.5;
      const rows = typed.filter(named).map((s) => { const ps = loc.filter((p) => p.type === s.type); return ps.length ? [s.type, ps.length, `${Math.round((ps.filter(inZone).length / ps.length) * 100)}%`] : null; }).filter(Boolean);
      rows.push(["All", loc.length, `${Math.round((loc.filter(inZone).length / loc.length) * 100)}%`]);
      pdf.autoTable({
        startY: y + 16, margin: { left: M + colW + 20, right: M }, theme: "grid",
        head: [["Pitch", "Located", "In the zone"]], body: rows,
        styles: { font: "helvetica", fontSize: 8.5, cellPadding: 3.5, textColor: 30, lineColor: 210, lineWidth: 0.4, halign: "center" },
        headStyles: { fillColor: INK, textColor: 255, fontStyle: "bold" }, alternateRowStyles: { fillColor: SOFT },
        columnStyles: { 0: { halign: "left", fontStyle: "bold" } },
      });
      y += colW + 18;
    }

    // ---- every pitch
    if (y > H - M - 160) { pdf.addPage(); y = M; }
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(12); pdf.setTextColor(...RED); pdf.text("Every pitch", M, y + 4);
    const cell = (p, k, text) => (edited(p, k) && text !== "–" ? `${text}*` : text);
    pdf.autoTable({
      startY: y + 12, margin: { left: M, right: M, top: M }, theme: "grid",
      head: [["#", "Pitch", "Velo", "Spin", "Tilt", "IVB", "HB", "Spin eff.", "VAA", "Ext.", "Rel. ht", "Rel. side", "Plate ht"]],
      body: pitches.map((p) => {
        const e = effOf(p);
        return [p.no, p.type || "Untagged", cell(p, "speed", f1(p.speed)), cell(p, "spin", num(p.spin) != null ? String(Math.round(p.spin)) : "–"), cell(p, "tilt", p.tilt || "–"), cell(p, "ivb", f1(p.ivb)), cell(p, "hb", f1(p.hb)),
          e == null ? "–" : num(p.spinEff) != null ? cell(p, "spinEff", `${Math.round(p.spinEff)}%`) : `~${e}%`, num(p.vaa) != null ? `${p.vaa.toFixed(1)}°` : "–",
          cell(p, "extension", ftIn(p.extension)), cell(p, "relHeight", ftIn(p.relHeight)), cell(p, "relSide", ftIn(p.relSide)), ftIn(p.plateHeight)];
      }),
      styles: { font: "helvetica", fontSize: 8, cellPadding: 3, textColor: 30, lineColor: 210, lineWidth: 0.4, halign: "center" },
      headStyles: { fillColor: INK, textColor: 255, fontStyle: "bold" }, alternateRowStyles: { fillColor: SOFT },
      columnStyles: { 1: { halign: "left", cellPadding: { left: 13, top: 3, bottom: 3, right: 3 } } },
      didDrawCell: (d) => { if (d.section === "body" && d.column.index === 1) { pdf.setFillColor(...hex(colorOf(pitches[d.row.index].type))); pdf.circle(d.cell.x + 6.5, d.cell.y + d.cell.height / 2, 2.6, "F"); } },
    });

    // ---- every page's foot
    const pages = pdf.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      pdf.setPage(i);
      pdf.setDrawColor(...RED); pdf.setLineWidth(0.8); pdf.line(M, H - 30, W - M, H - 30);
      pdf.setFont("helvetica", "normal"); pdf.setFontSize(7.5); pdf.setTextColor(120);
      pdf.text(`Dynamic Sports Training  ·  ${o.athlete.name || ""} bullpen, ${fmtDay(session.date)}`, M, H - 18);
      pdf.text(`Page ${i} of ${pages}`, W - M, H - 18, { align: "right" });
    }
    const file = `${(o.athlete.name || "pitcher").replace(/[^a-z0-9]+/gi, "_")}-bullpen-report-${session.date || "session"}.pdf`;
    return { pdf, file };
  }

  async function save(o) { const { pdf, file } = await build(o); pdf.save(file); return file; }

  // The report emailed from the coach's own address (api/send-athlete-email.js, as the other athlete emails), the PDF
  // attached, with the link to his bullpen video in Google Drive when it's kept there (shared to anyone with the link).
  //   email(o, { to, cc, subject, body })   o as for save
  async function email(o, { to, cc, subject, body }) {
    const { pdf, file } = await build(o);
    const pdfBase64 = pdf.output("datauristring").split(",")[1];
    const { data } = await window.supabaseClient.auth.getSession();
    const token = data && data.session && data.session.access_token;
    if (!token) throw new Error("You're not signed in: reload and sign in again.");
    const res = await fetch("/api/send-athlete-email", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ to, cc: cc || "", subject, body, filename: file, pdfBase64, kind: "bullpen-report", athleteName: o.athlete.name || "", tab: "Bullpens" }),
    });
    const json = await res.json().catch(() => ({}));
    if (res.status === 413) throw new Error("The report is too large to email.");
    if (!res.ok) throw new Error(json.error || `The email didn't send (${res.status}).`);
    return json;
  }
  // the message the email starts with (the coach can change it)
  const mailText = ({ athlete, session, link }) => {
    const first = String(athlete.name || "").trim().split(/\s+/)[0] || "there";
    return `Hi ${first},\n\nAttached is your bullpen report from ${fmtDay(session.date)}${session.facility ? ` at ${session.facility}` : ""}: your pitch types' numbers, your movement and release, your locations and every pitch.${link ? `\n\nThe video of the bullpen:\n${link}` : ""}\n\nDynamic Sports Training`;
  };

  window.BullpenPdf = { build, save, email, mailText };
})();
