// The nutrition plan as a printable PDF (portrait, letter): the day's targets, the meals and their times, a week of
// sample meals, each meal's options, the food exchange lists, and hydration and supplements. Built from the plan's
// snapshot (nutrition_engine.js snapshotOf), as the athlete's phone shows it (athlete.js: Print / Save PDF on the
// Nutrition page). Plain JavaScript; needs jsPDF and its autoTable plugin loaded first.
//   buildNutritionPdf({ plan, athleteName, cubs, allergies: ["Peanuts", ...] or null, basisText,
//                       okParts(parts) -> false for a meal with a food they can't eat, titleOf(sample, mealName) })
(function () {
  async function buildNutritionPdf(o) {
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "letter" });
    const n = o.plan, W = pdf.internal.pageSize.getWidth(), H = pdf.internal.pageSize.getHeight(), M = 40;
    const ok = (parts) => !o.okParts || !parts || o.okParts(parts);
    // DST: red and black, as the program PDF; Cubs-only athletes: Cubs blue and red
    const C = o.cubs ? { accent: [14, 51, 134], head: [14, 51, 134], soft: [228, 235, 248] } : { accent: [200, 16, 46], head: [20, 20, 20], soft: [245, 245, 245] };
    const macros = (t) => (t ? `${Math.round(t.kcal).toLocaleString()} cal · P ${Math.round(t.p)} · C ${Math.round(t.c)} · F ${Math.round(t.f)}` : "—");

    // the logo, top middle on the first page
    const loadImg = (src, cors) => new Promise((res, rej) => { const im = new Image(); if (cors) im.crossOrigin = "anonymous"; im.onload = () => res(im); im.onerror = rej; im.src = src; });
    let logo = null, ratio = 1;
    try {
      if (o.cubs) {
        const im = await loadImg("https://www.mlbstatic.com/team-logos/112.svg", true);
        const c = document.createElement("canvas"); c.width = 300; c.height = Math.round((300 * (im.naturalHeight || 1)) / (im.naturalWidth || 1));
        c.getContext("2d").drawImage(im, 0, 0, c.width, c.height); logo = c.toDataURL("image/png"); ratio = c.width / c.height;
      } else { const im = await loadImg("assets/dst-logo.png"); logo = im; ratio = im.naturalWidth / im.naturalHeight; }
    } catch (e) { logo = null; }

    let y = M;
    if (logo) pdf.addImage(logo, "PNG", W - M - 34 * ratio, M - 4, 34 * ratio, 34);
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(18); pdf.setTextColor(...C.accent);
    pdf.text(o.athleteName ? `${o.athleteName} · Nutrition Plan` : "Nutrition Plan", M, y + 14);
    pdf.setFont("helvetica", "normal"); pdf.setFontSize(11); pdf.setTextColor(60);
    pdf.text([n.goal || "", n.date ? `Plan from ${n.date}` : ""].filter(Boolean).join("  ·  "), M, y + 31);
    y += 42;
    pdf.setDrawColor(...C.accent); pdf.setLineWidth(1.5); pdf.line(M, y, W - M, y);
    y += 16;

    const heading = (text, sub) => {
      if (y > H - 90) { pdf.addPage(); y = M; }
      pdf.setFont("helvetica", "bold"); pdf.setFontSize(13); pdf.setTextColor(...C.accent); pdf.text(text, M, y);
      const w = pdf.getTextWidth(text);
      if (sub) { pdf.setFont("helvetica", "normal"); pdf.setFontSize(9); pdf.setTextColor(110); pdf.text(sub, M + w + 8, y); }
      y += 8;
    };
    const table = (head, body, opts) => {
      pdf.autoTable(Object.assign({
        startY: y, head: head ? [head] : undefined, body, margin: { left: M, right: M }, theme: "grid",
        styles: { font: "helvetica", fontSize: 9, cellPadding: 4, textColor: 30, lineColor: 200, lineWidth: 0.4, valign: "top" },
        headStyles: { fillColor: C.head, textColor: 255, fontStyle: "bold" },
        alternateRowStyles: { fillColor: C.soft },
      }, opts || {}));
      y = pdf.lastAutoTable.finalY + 18;
    };
    const lines = (items) => {
      pdf.setFont("helvetica", "normal"); pdf.setFontSize(10); pdf.setTextColor(30);
      items.forEach((t) => {
        const wrapped = pdf.splitTextToSize(`•  ${t}`, W - 2 * M - 10);
        if (y + wrapped.length * 13 > H - M) { pdf.addPage(); y = M; }
        pdf.text(wrapped, M + 4, y + 4); y += wrapped.length * 13;
      });
      y += 10;
    };

    // ---- daily targets
    heading("Daily targets");
    y += 4;
    table(["", "Calories", "Protein", "Carbs", "Fat"], [
      ["Training day", Math.round(n.train.kcal).toLocaleString(), `${n.train.p} g`, `${n.train.c} g`, `${n.train.f} g`],
      ["Rest day", Math.round(n.rest.kcal).toLocaleString(), `${n.rest.p} g`, `${n.rest.c} g`, `${n.rest.f} g`],
    ], { columnStyles: { 0: { fontStyle: "bold" } } });
    const facts = [o.basisText, o.allergies ? `Food allergies: ${o.allergies.length ? o.allergies.join(", ") : "none"}` : ""].filter(Boolean);
    if (facts.length) { y -= 8; pdf.setFont("helvetica", "normal"); pdf.setFontSize(9); pdf.setTextColor(90); pdf.text(facts.join("   ·   "), M, y); y += 18; }

    // ---- the meals and their times
    heading("Meals");
    y += 4;
    table(["Meal", "Time", "Training day", "Rest day"], (n.meals || []).map((m) => [m.name, m.time || "", macros(m.train), m.rest ? macros(m.rest) : "—"]), { columnStyles: { 0: { fontStyle: "bold" } } });

    // ---- a week of sample meals (the rotation's first week)
    const week = (n.weeks || [])[0];
    if (week && week.length) {
      heading("Sample week", "a training-day example; swap in any option below");
      y += 4;
      const body = [];
      week.forEach((day) => {
        const meals = (day.meals || []).map((s) => {
          const title = s.cheat ? "Cheat meal" : (o.titleOf ? o.titleOf(s, s.slot) : s.title) || s.slot;
          const what = s.cheat ? "Your pick. Enjoy it, then back on plan." : ok(s.parts) ? (s.items || []).join(" · ") : "Pick one of the options below (this sample has a food on your allergy list).";
          return [s.slot, title, what, s.cheat || !s.tot ? "" : `${Math.round(s.tot.kcal)}`];
        });
        meals.forEach((r, i) => body.push(i === 0 ? [{ content: day.day, rowSpan: meals.length, styles: { fontStyle: "bold", fillColor: [255, 255, 255] } }, ...r] : r));
      });
      table(["Day", "Meal", "Sample", "Foods", "Cal"], body, { styles: { font: "helvetica", fontSize: 8, cellPadding: 3, textColor: 30, lineColor: 200, lineWidth: 0.4, valign: "top" }, alternateRowStyles: {}, columnStyles: { 0: { cellWidth: 52 }, 1: { cellWidth: 70, fontStyle: "bold" }, 2: { cellWidth: 100 }, 4: { cellWidth: 34, halign: "right" } } });
    }

    // ---- each meal's options (training day)
    const choiceMeals = (n.meals || []).filter((m) => n.choices && n.choices[m.name] && (n.choices[m.name].train || []).length);
    if (choiceMeals.length) {
      pdf.addPage(); y = M;
      heading("Meal options", "each fits that meal's training-day targets");
      y += 4;
      choiceMeals.forEach((m) => {
        const list = (n.choices[m.name].train || []).filter((c) => ok(c.parts));
        if (!list.length) return;
        table([{ content: m.name, colSpan: 3 }], list.map((c) => [c.name, (c.items || []).join(" · ") + (c.note ? `\n${c.note}` : ""), macros(c.tot)]),
          { columnStyles: { 0: { cellWidth: 120, fontStyle: "bold" }, 2: { cellWidth: 120 } } });
      });
    }

    // ---- the food exchange lists
    if ((n.lists || []).length) {
      if (y > H - 200) { pdf.addPage(); y = M; }
      heading("Food exchange options", "for lunch and dinner: one protein, one carbohydrate and one fruit, plus vegetables");
      y += 4;
      n.lists.forEach((l) => {
        if (l.same) table([l.title, "Amount"], l.rows.map((r) => [r[0], r[1]]), { columnStyles: { 0: { fontStyle: "bold" } } });
        else table([l.title, "Training day", "Rest day"], l.rows, { columnStyles: { 0: { fontStyle: "bold" } } });
      });
    }

    // ---- hydration, supplements, packing
    heading("Hydration");
    y += 8;
    lines(["About half your body weight in ounces of water a day, more on training days. Spread it out: bottles in the morning and the afternoon.",
      "Weigh before and after practice, and drink 16 oz of water for every pound lost.",
      "Losing 2–3% of your body weight in water can cost 15–20% of your performance."]);
    heading("Supplements");
    y += 8;
    lines(["Fish oil", "Multi-vitamin", "Electrolytes", "Whey protein", "Creatine, beta-alanine, leucine", "NSF Certified for Sport products only."]);
    if ((n.packing || []).length) { heading(n.school ? "Packing your school lunch" : "Packing a lunch"); y += 8; lines(n.packing); }

    // page numbers
    const pages = pdf.internal.getNumberOfPages();
    for (let i = 1; i <= pages; i += 1) {
      pdf.setPage(i); pdf.setFont("helvetica", "normal"); pdf.setFontSize(8); pdf.setTextColor(130);
      pdf.text(`${o.athleteName ? `${o.athleteName} · ` : ""}Nutrition Plan · page ${i} of ${pages}`, W / 2, H - 20, { align: "center" });
    }
    return pdf;
  }
  window.buildNutritionPdf = buildNutritionPdf;
})();
