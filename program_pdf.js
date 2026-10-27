// The program PDF: a program drawn as a landscape page (or pages) of weeks and days, as the DST training sheets look.
// Shared by the dashboard (index.html: Print / Save PDF in the builder and on the Player Plan) and the athlete's phone
// app (athlete.js: Print / Save PDF on the Program page). Plain JavaScript; needs jsPDF (window.jspdf) and
// program_rx.js (window.ProgramRx, window.exerciseLabels) loaded first.
(function () {
  // Draws a program as a landscape PDF: athlete and program name top left, logo top middle, then one row per
  // week with its days side by side. It stays on one page while the text can remain readable; a longer program
  // runs onto more pages, with whole weeks kept together. Returns { pdf, fontSize, fits, pages }.
  // `into`: an existing PDF to add this program to, starting on a new page (Print all on the Player Plan).
  // `maxFs`: the largest text size (10 for the all-weeks sheet; larger for a day to a page, which has room)
  async function buildProgramPdf(program, athleteName, cubsLogo = false, into = null, maxFs = 10) {
    const { jsPDF } = window.jspdf;
    const pdf = into || new jsPDF({ orientation: "landscape", unit: "pt", format: "letter" });
    const W = pdf.internal.pageSize.getWidth(), H = pdf.internal.pageSize.getHeight();
    const M = 28, headH = 44, gutter = 46, pad = 4;
  
    // Cubs-only athletes get the Cubs logo; everyone else gets DST's. The Cubs logo is an SVG, which the PDF
    // library can't place directly, so it's drawn onto a canvas first. If it can't be loaded, DST's is used.
    const loadImg = (src, cors) => new Promise((res, rej) => { const im = new Image(); if (cors) im.crossOrigin = "anonymous"; im.onload = () => res(im); im.onerror = rej; im.src = src; });
    let logo = null, logoRatio = 1;
    if (cubsLogo) {
      try {
        const im = await loadImg("https://www.mlbstatic.com/team-logos/112.svg", true);
        const c = document.createElement("canvas");
        c.width = 400; c.height = Math.round((400 * (im.naturalHeight || 1)) / (im.naturalWidth || 1));
        c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
        logo = c.toDataURL("image/png");
        logoRatio = c.width / c.height;
      } catch (e) { logo = null; }
    }
    if (!logo) {
      try {
        const im = await loadImg("assets/dst-logo.png");
        logo = im;
        logoRatio = im.naturalWidth / im.naturalHeight;
      } catch (e) { /* no logo file: the page still exports without it */ }
    }
    const logoW = logo ? 38 * logoRatio : 0;
    const leftW = (W - logoW) / 2 - M - 12; // names stay clear of the centered logo
    const oneLine = (text) => pdf.splitTextToSize(text, leftW)[0];
    // Colors. DST follows its training sheets: black week blocks, red day bars, red accents and a bright cyan
    // cell for the prescribed intensity. Cubs-only athletes get Cubs blue and red instead.
    const C = cubsLogo
      ? { week: [14, 51, 134], weekText: 255, day: [204, 52, 51], dayText: 255, accent: [14, 51, 134], pct: [214, 226, 247], label: [14, 51, 134] }
      : { week: [0, 0, 0], weekText: 255, day: [200, 16, 46], dayText: 255, accent: [200, 16, 46], pct: [0, 255, 255], label: [0, 0, 0] };
    const theme = C.accent;
    // Page header, repeated on every page: names top left, logo top middle, page number top right when there's more than one.
    const drawHeader = (pageNo, pageCount) => {
      if (logo) pdf.addImage(logo, "PNG", (W - logoW) / 2, M, logoW, 38);
      pdf.setTextColor(...theme);
      pdf.setFont("helvetica", "bold"); pdf.setFontSize(15);
      pdf.text(oneLine(athleteName || program.name), M, M + 15);
      if (athleteName) {
        pdf.setFont("helvetica", "normal"); pdf.setFontSize(11); pdf.setTextColor(70);
        pdf.text(oneLine(program.name), M, M + 31);
      }
      if (pageCount > 1) {
        pdf.setFont("helvetica", "normal"); pdf.setFontSize(9); pdf.setTextColor(110);
        pdf.text(`Page ${pageNo} of ${pageCount}`, W - M, M + 12, { align: "right" });
      }
      pdf.setDrawColor(...theme); pdf.setLineWidth(1.5);
      pdf.line(M, M + headH + 3, W - M, M + headH + 3);
    };
  
    const Rx = window.ProgramRx;
    // first line of an exercise: label, name, tempo just right of the name, then rest and notes
    const exText = (e, label) => `${label} ${e.name}${e.tempo ? `  ${e.tempo}` : ""}${e.notes ? ` (${e.notes})` : ""}`;
  
    const weeks = program.weeks || [];
    const maxDays = Math.max(1, ...weeks.map((w) => (w.sessions || []).length));
    const top = M + headH + 8;
    const availH = H - M - top;
    const colW = (W - 2 * M - gutter) / maxDays;
  
    // Beside each exercise name, every set group is its reps ("5", or "3x1") followed by a line for writing in
    // the weight used, with the prescribed intensity in a colored cell under the line. A rule is drawn between
    // superset groups (A, B, C…).
    const layout = (fs) => {
      pdf.setFont("helvetica", "normal"); pdf.setFontSize(fs);
      // each set group is its reps followed by a write-in line, with the intensity in a colored cell under the line
      const lineH = fs * 1.25, rowH = fs * 1.6, pctH = fs * 1.05, lineW = fs * 4.6, sp = fs * 0.9, bandH = lineH + 3, gap = Math.max(2, fs * 0.35);
      const nameFs = fs * 1.12, nameLH = nameFs * 1.2, noteLH = fs * 1.0;
      const textW = colW - 2 * pad;
      const rows = weeks.map((w) => {
        const cells = (w.sessions || []).map((s, si) => {
          const named = (s.exercises || []).filter((e) => (e.name || "").trim());
          const labels = window.exerciseLabels(named);
          const items = named.map((e, i) => {
            // The write-in lines always sit at the right of the day column, never under the name. Set groups wrap
            // onto more rows once a row would pass rxMax, and every row is pushed against the right edge.
            const rxMax = textW * 0.62;
            const rxLines = [];
            let cur = [], x = 0;
            const gs = Rx.groups(e).map((g) => ({ reps: Rx.repsText(g), int: Rx.intensityText(e, g) }));
            gs.forEach((g) => { g.rw = pdf.getTextWidth(g.reps) * 1.08 + 2.5; }); // reps are drawn bold
            // With several set groups the lines shorten (to no less than 70%) so they still fit on one row.
            const fixed = gs.reduce((t, g) => t + g.rw + sp, 0) - sp;
            const lw = gs.length ? Math.max(lineW * 0.7, Math.min(lineW, (rxMax - fixed) / gs.length)) : lineW;
            gs.forEach((g) => {
              const bw = g.rw + lw + sp;
              if (cur.length && x + bw - sp > rxMax + 0.5) { rxLines.push(cur); cur = []; x = 0; }
              cur.push({ reps: g.reps, int: g.int, x, bw, rw: g.rw, lw });
              x += bw;
            });
            if (cur.length) rxLines.push(cur);
            const rowWs = rxLines.map((ln) => ln.reduce((t, b) => t + b.bw, 0) - sp);
            rxLines.forEach((ln, k) => ln.forEach((b) => { b.x += textW - rowWs[k]; }));
            const rxW = Math.max(0, ...rowWs);
            const hasInt = rxLines.some((ln) => ln.some((b) => b.int));
            const rxH = rowH + (hasInt ? pctH : 0) + 2;
            // the name: bold capitals a little larger than the rest, in the space left of the lines
            const nameW = textW - (rxW ? rxW + 5 : 0);
            pdf.setFont("helvetica", "bold"); pdf.setFontSize(nameFs);
            const lines = pdf.splitTextToSize(`${labels[i]} ${e.name.trim().toUpperCase()}${e.tempo ? `  ${e.tempo}` : ""}`, nameW);
            pdf.setFont("helvetica", "normal"); pdf.setFontSize(fs * 0.85);
            const noteLines = (e.notes || "").trim() ? pdf.splitTextToSize(e.notes.trim(), nameW) : [];
            pdf.setFontSize(fs);
            // rest goes at the bottom right, under the exercise's sets and reps
            const rest = [(e.rest || "").trim() ? `Rest ${e.rest.trim()}` : "", window.ProgramRx.extrasText(e), window.ProgramRx.tagText(e)].filter(Boolean).join(" · "); // with any extra boxes (Time, Distance…)
            const restH = rest ? fs * 1.05 + 2 : 0;
            const bodyH = Math.max(lines.length * nameLH + noteLines.length * noteLH, rxLines.length * rxH + restH) + 1;
            return { label: labels[i], lines, noteLines, rxLines, rxH, bodyH, hasInt, rest, newGroup: i > 0 && !e.linked };
          });
          // optional warm-up for the day, printed above the first superset
          const warm = (s.warmup || "").trim();
          const warmLines = warm ? pdf.splitTextToSize(`WARM-UP: ${warm}`, textW) : [];
          const warmH = warmLines.length ? warmLines.length * lineH + gap * 2 : 0;
          const h = warmH + items.reduce((t, it, k) => t + it.bodyH + (k > 0 ? gap * 2 : 0), 0);
          return { name: s.name || `Day ${si + 1}`, items, h, warmLines };
        });
        return { name: w.name || "", cells, h: bandH + pad * 2 + Math.max(lineH, ...cells.map((c) => c.h)) };
      });
      return { rows, lineH, rowH, pctH, lineW, bandH, gap, nameFs, nameLH, noteLH, total: rows.reduce((t, r) => t + r.h, 0) };
    };
  
    // One page when everything fits at a readable size (READABLE pt or larger). Otherwise the weeks are spread
    // over as few pages as a readable size allows, and the text is then made as large as that page count permits.
    const READABLE = 6;
    const paginate = (p) => {
      let page = 1, used = 0;
      p.rows.forEach((row) => { if (used > 0 && used + row.h > availH) { page += 1; used = 0; } row.page = page; used += row.h; });
      return page;
    };
    let fs = maxFs, plan = layout(fs);
    while (plan.total > availH && fs > READABLE) { fs -= 0.5; plan = layout(fs); }
    let pages = 1;
    if (plan.total > availH) {
      // a single week taller than a page keeps shrinking, so no week is ever cut off
      while (Math.max(...plan.rows.map((r) => r.h)) > availH && fs > 3.5) { fs -= 0.5; plan = layout(fs); }
      pages = paginate(plan);
      for (let bigger = fs + 0.5; bigger <= maxFs; bigger += 0.5) {
        const tryPlan = layout(bigger);
        if (Math.max(...tryPlan.rows.map((r) => r.h)) > availH || paginate(tryPlan) > pages) break;
        fs = bigger; plan = tryPlan;
      }
      pages = paginate(plan);
    } else plan.rows.forEach((row) => { row.page = 1; });
    const fits = Math.max(0, ...plan.rows.map((r) => r.h)) <= availH;
    const { lineH, rowH, pctH, lineW, bandH, gap, nameFs, nameLH, noteLH } = plan;
    pdf.setFont("helvetica", "normal"); pdf.setFontSize(fs);
  
    if (into) pdf.addPage(); // after the programs already in it
    drawHeader(1, pages);
    let y = top, pageNo = 1;
    plan.rows.forEach((row) => {
      if (row.page !== pageNo) { pdf.addPage(); pageNo = row.page; drawHeader(pageNo, pages); y = top; }
      // week name: solid colored block down the left
      pdf.setFillColor(...C.week); pdf.rect(M, y, gutter, row.h, "F");
      pdf.setTextColor(C.weekText); pdf.setFont("helvetica", "bold"); pdf.setFontSize(Math.min(fs + 1, 10));
      pdf.text(pdf.splitTextToSize(row.name, gutter - 2 * pad), M + pad, y + pad + lineH * 0.8);
      for (let i = 0; i < maxDays; i++) {
        const x = M + gutter + i * colW;
        const cell = row.cells[i];
        if (cell) {
          // day name centered on a solid bar
          pdf.setFillColor(...C.day); pdf.rect(x, y, colW, bandH, "F");
          pdf.setTextColor(C.dayText); pdf.setFont("helvetica", "bold"); pdf.setFontSize(fs);
          pdf.text(pdf.splitTextToSize(cell.name.toUpperCase(), colW - 2 * pad)[0], x + colW / 2, y + lineH * 0.8 + 1.5, { align: "center" });
          pdf.setFontSize(fs);
          let cy = y + bandH + pad;
          if (cell.warmLines.length) {
            pdf.setFont("helvetica", "bolditalic"); pdf.setTextColor(20);
            cell.warmLines.forEach((line) => { pdf.text(line, x + pad, cy + lineH * 0.8); cy += lineH; });
            cy += gap;
            pdf.setDrawColor(...theme); pdf.setLineWidth(1);
            pdf.line(x, cy, x + colW, cy);
            cy += gap;
          }
          cell.items.forEach((it, k) => {
            if (k > 0) {
              cy += gap;
              if (it.newGroup) {
                // a solid colored rule across the whole day column separates one superset from the next
                pdf.setDrawColor(...theme); pdf.setLineWidth(1);
              } else {
                // a thin black line separates the exercises inside a superset (A1 from A2)
                pdf.setDrawColor(0); pdf.setLineWidth(0.35);
              }
              pdf.line(x, cy, x + colW, cy);
              cy += gap;
            }
            const itemTop = cy;
            pdf.setFont("helvetica", "bold"); pdf.setFontSize(nameFs);
            it.lines.forEach((line, li) => {
              const base = cy + nameLH * 0.8;
              if (li === 0) {
                // superset label as a small solid tag, like the label cells on the sheets
                const tag = it.label.replace(/\.$/, "");
                const tagW = pdf.getTextWidth(tag) + 3;
                pdf.setFillColor(...C.label); pdf.rect(x + pad, base - nameFs * 0.82, tagW, nameFs * 1.08, "F");
                pdf.setTextColor(255); pdf.text(tag, x + pad + 1.5, base);
                const lw = pdf.getTextWidth(`${it.label} `);
                pdf.setTextColor(20);
                pdf.text(line.slice(it.label.length).trimStart(), x + pad + Math.max(lw, tagW + 2.5), base);
              } else {
                pdf.setTextColor(20);
                pdf.text(line, x + pad, base);
              }
              cy += nameLH;
            });
            pdf.setFont("helvetica", "italic"); pdf.setFontSize(fs * 0.85); pdf.setTextColor(70);
            it.noteLines.forEach((line) => { pdf.text(line, x + pad, cy + noteLH * 0.78); cy += noteLH; });
            pdf.setFontSize(fs);
            // set groups at the right: reps, a line for the weight used, and the intensity in a colored cell under it
            cy = itemTop;
            it.rxLines.forEach((boxes) => {
              pdf.setDrawColor(40); pdf.setLineWidth(0.5);
              boxes.forEach((b) => {
                const bx = x + pad + b.x, lx = bx + b.rw, base = cy + rowH - 2;
                pdf.setFont("helvetica", "bold"); pdf.setFontSize(fs); pdf.setTextColor(20);
                pdf.text(b.reps, bx, base);
                pdf.setDrawColor(40); pdf.setLineWidth(0.6);
                pdf.line(lx, base + 1, lx + b.lw, base + 1);
                if (b.int) {
                  pdf.setFillColor(...C.pct); pdf.rect(lx, base + 1.6, b.lw, pctH, "F");
                  pdf.setFont("helvetica", "bolditalic"); pdf.setFontSize(fs * 0.85); pdf.setTextColor(0);
                  pdf.text(b.int, lx + b.lw / 2, base + 1.6 + pctH * 0.76, { align: "center" });
                }
              });
              pdf.setFontSize(fs);
              cy += it.rxH;
            });
            if (it.rest) {
              pdf.setFont("helvetica", "italic"); pdf.setFontSize(fs * 0.85); pdf.setTextColor(70);
              pdf.text(it.rest, x + colW - pad, cy + fs * 0.75, { align: "right" });
              pdf.setFontSize(fs);
            }
            cy = itemTop + it.bodyH;
          });
        }
        pdf.setDrawColor(170); pdf.setLineWidth(0.5);
        pdf.rect(x, y, colW, row.h);
      }
      y += row.h;
    });
    return { pdf, fontSize: fs, fits, pages };
  }
  window.buildProgramPdf = buildProgramPdf;

  // The same program a day to a page (the phone's Print / PDF): Day 1 in every week on the first page, Day 2 in every
  // week on the next, and so on, with the weeks side by side. Up to five weeks go across; more run in rows of up to
  // five (a 10-week program is weeks 1-5 over weeks 6-10). A day is the same place in each week, or on a throwing
  // program laid over the progression, the same weekday. Drawn with buildProgramPdf, one page (or more) per day.
  async function buildProgramPdfByDay(program, athleteName, cubsLogo) {
    const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const weeks = program.weeks || [];
    const byKey = new Map();
    weeks.forEach((w, wi) => (w.sessions || []).forEach((s, si) => {
      const key = s.tpDay != null ? `t${s.tpDay}` : `i${si}`;
      if (!byKey.has(key)) byKey.set(key, { name: s.tpDay != null ? DAYS[s.tpDay] : (s.name || `Day ${si + 1}`), sort: s.tpDay != null ? s.tpDay : si, cells: [] });
      byKey.get(key).cells[wi] = s;
    }));
    const days = [...byKey.values()].sort((a, b) => a.sort - b.sort);
    const per = weeks.length <= 5 ? weeks.length : Math.ceil(weeks.length / Math.ceil(weeks.length / 5));
    let pdf = null, pages = 0, fits = true;
    for (const d of days) {
      const rows = [];
      for (let i = 0; i < weeks.length; i += per) {
        const span = weeks.slice(i, i + per);
        rows.push({
          name: weeks.length > per ? `Wk ${i + 1}-${i + span.length}` : "",
          // each week's session for this day under the week's name (a throwing day keeps its "L-2x25"); a week without the day is left empty
          sessions: span.map((w, k) => {
            const s = d.cells[i + k], wk = w.name || `Week ${i + k + 1}`;
            return Object.assign({}, s || { exercises: [] }, { name: s && s.tpDay != null && s.name ? `${wk} · ${s.name.replace(/^\w+ · /, "")}` : wk });
          }),
        });
      }
      const built = await buildProgramPdf({ name: `${program.name} · ${d.name}`, weeks: rows }, athleteName, cubsLogo, pdf, 13);
      pdf = built.pdf; pages += built.pages; fits = fits && built.fits;
    }
    if (!pdf) return buildProgramPdf(program, athleteName, cubsLogo);
    return { pdf, pages, fits };
  }
  window.buildProgramPdfByDay = buildProgramPdfByDay;
})();
