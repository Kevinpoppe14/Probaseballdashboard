// TrackMan bullpen reports: reads the PDF a TrackMan "Pitching practice" session exports (a summary page with
// "Stats by pitch type", then "Pitches in session", one row per pitch) into
//   { athleteName, facility, sessionType, date: "YYYY-MM-DD", summary: [...per pitch type], pitches: [...each pitch] }
// for the Bullpens tab (bullpens.js). The PDF is read in the browser with pdf.js, loaded the first time it's needed.
// TrackMan marks each pitch's type only with a colored dot, so the dots' colors are read from the page drawing and
// matched to the legend ("● Fastball ● Sinker ...") at the top of each page.
(function () {
  const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/";
  let loading = null;
  const loadPdfJs = () => {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (!loading) loading = new Promise((ok, no) => {
      const s = document.createElement("script");
      s.src = `${PDFJS}pdf.min.js`;
      s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDFJS}pdf.worker.min.js`; ok(window.pdfjsLib); };
      s.onerror = () => { loading = null; no(new Error("Couldn't load the PDF reader. Check your connection and try again.")); };
      document.head.appendChild(s);
    });
    return loading;
  };

  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const DATE_RE = /^(\d{1,2}) ([A-Za-z]{3})[a-z]* (\d{4})$/;
  const num = (s) => { const v = parseFloat(String(s).replace(/[%,]/g, "")); return Number.isFinite(v) ? v : null; };
  // 5'10" -> 5.83 (feet); 6' -> 6; "-" -> null
  const feet = (s) => {
    const m = String(s).replace(/[’′]/g, "'").replace(/[”″]|''/g, '"').match(/^(-?\d+)'(?:\s*(\d+(?:\.\d+)?)")?$/);
    if (m) return Math.round((Number(m[1]) + (m[2] ? Number(m[2]) / 12 : 0)) * 100) / 100;
    return num(s);
  };
  const blank = (s) => s == null || s === "" || s === "-" || s === "–" || s === "—";

  // the page's text, one line per row (items within 2 points of each other), left to right
  const linesOf = (items) => {
    const rows = [];
    items.filter((i) => i.s.trim()).sort((a, b) => b.y - a.y || a.x - b.x).forEach((i) => {
      const row = rows.find((r) => Math.abs(r.y - i.y) <= 2);
      if (row) row.items.push(i); else rows.push({ y: i.y, items: [i] });
    });
    rows.forEach((r) => r.items.sort((a, b) => a.x - b.x));
    return rows;
  };

  // the small round dots drawn on a page, with their fill color, in the same coordinates as the text
  const dotsOf = (ops, O) => {
    const mul = (m, c) => [m[0] * c[0] + m[1] * c[2], m[0] * c[1] + m[1] * c[3], m[2] * c[0] + m[3] * c[2], m[2] * c[1] + m[3] * c[3], m[4] * c[0] + m[5] * c[2] + c[4], m[4] * c[1] + m[5] * c[3] + c[5]];
    const at = (c, x, y) => [c[0] * x + c[2] * y + c[4], c[1] * x + c[3] * y + c[5]];
    const rgb = (a) => {
      if (!a) return null;
      if (typeof a[0] === "string" && a[0][0] === "#") { const h = a[0]; return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); }
      const v = [a[0], a[1], a[2]].map(Number);
      return v.every((x) => x <= 1) ? v.map((x) => Math.round(x * 255)) : v;
    };
    let ctm = [1, 0, 0, 1, 0, 0], fill = null;
    const stack = [], dots = [];
    for (let i = 0; i < ops.fnArray.length; i++) {
      const fn = ops.fnArray[i], args = ops.argsArray[i];
      if (fn === O.save) stack.push({ ctm, fill });
      else if (fn === O.restore) { const s = stack.pop(); if (s) ({ ctm, fill } = s); }
      else if (fn === O.transform) ctm = mul(args, ctm);
      else if (fn === O.setFillRGBColor) fill = rgb(args);
      else if (fn === O.constructPath && fill) {
        const kinds = args[0] || [], pts = args[1] || [];
        if (!kinds.includes(O.curveTo) || pts.length < 4) continue;
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (let k = 0; k + 1 < pts.length; k += 2) { const [x, y] = at(ctm, pts[k], pts[k + 1]); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
        const w = x1 - x0, h = y1 - y0;
        if (w > 3 && w < 16 && Math.abs(w - h) < 1.5) dots.push({ x: (x0 + x1) / 2, y: (y0 + y1) / 2, color: fill });
      }
    }
    return dots;
  };
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  // the dot just left of a piece of text on the same line
  const dotBeside = (dots, item) => {
    const mid = item.y + (item.h || 7) / 2;
    let best = null;
    dots.forEach((d) => { if (d.x < item.x && item.x - d.x < 18 && Math.abs(d.y - mid) < 5 && (!best || d.x > best.x)) best = d; });
    return best;
  };

  const UNTAGGED = /^(undefined|unknown|untagged|none|other)?$/i;
  const STAT_KEYS = ["qty", "speedMin", "speedMax", "speedAvg", "spinMin", "spinMax", "spinAvg", "ivbMaxAbs", "hbAvg", "hbMaxAbs", "vbMaxAbs", "relHeight", "relSide", "extension"];
  // the pitch table's columns, by the start of their header
  const PITCH_COLS = [["speed", /^pitch speed/i], ["spin", /^total spin/i], ["tilt", /^tilt/i], ["ivb", /^i\.? ?vert/i], ["hb", /^horz/i], ["extension", /^extension/i], ["relHeight", /^release height/i], ["relSide", /^release side/i], ["spinEff", /^spin eff/i]];

  async function parse(file) {
    const lib = await loadPdfJs();
    const data = file instanceof ArrayBuffer ? file : await file.arrayBuffer();
    const doc = await lib.getDocument({ data }).promise;
    const out = { athleteName: "", facility: "", sessionType: "", date: "", summary: [], pitches: [], source: "trackman-pdf" };
    const palette = []; // { color, type } from the legends and the summary table's dots
    let cols = null;
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      const items = tc.items.map((i) => ({ s: i.str.trim(), x: i.transform[4], y: i.transform[5], h: i.height }));
      const dots = dotsOf(await page.getOperatorList(), lib.OPS);
      const lines = linesOf(items);
      // the header: "Ryan Hendrix | Pitching practice | 21 Jan 2026", under the facility's name
      if (!out.date) {
        const i = lines.findIndex((l) => l.items.some((t) => DATE_RE.test(t.s)));
        if (i >= 0) {
          const l = lines[i].items, d = l.find((t) => DATE_RE.test(t.s)).s.match(DATE_RE);
          out.date = `${d[3]}-${String(MONTHS[d[2].toLowerCase()] || 1).padStart(2, "0")}-${String(d[1]).padStart(2, "0")}`;
          out.athleteName = l[0].s;
          out.sessionType = l.length > 2 ? l[1].s : "";
          if (i > 0) out.facility = lines[i - 1].items.map((t) => t.s).join(" ");
        }
      }
      lines.forEach((l) => {
        const toks = l.items;
        // a legend entry or summary row: a word with a dot beside it
        toks.forEach((t) => { if (/^[A-Za-z][A-Za-z -]+$/.test(t.s)) { const d = dotBeside(dots, t); if (d && !palette.some((q) => q.type === t.s)) palette.push({ color: d.color, type: t.s }); } });
        // "Stats by pitch type" rows: a pitch type then fourteen figures
        const firstNum = toks.findIndex((t) => blank(t.s) || num(t.s) != null);
        if (firstNum > 0 && toks.length - firstNum === STAT_KEYS.length && !/^#/.test(toks[0].s)) {
          const type = toks.slice(0, firstNum).map((t) => t.s).join(" ");
          if (/^[A-Za-z]/.test(type) && !out.summary.some((r) => r.type === type)) {
            const row = { type };
            STAT_KEYS.forEach((k, j) => { const s = toks[firstNum + j].s; row[k] = blank(s) ? null : num(s); });
            out.summary.push(row);
          }
        }
        // the pitch table's header row gives where each column starts
        if (toks.some((t) => /^pitch speed/i.test(t.s))) {
          cols = PITCH_COLS.map(([k, re]) => { const t = toks.find((x) => re.test(x.s)); return t ? { k, x: t.x } : null; }).filter(Boolean).sort((a, b) => a.x - b.x);
        }
        // a pitch: "#12" then its figures
        const m = toks[0] && toks[0].s.match(/^#(\d+)$/);
        if (m && cols) {
          const pitch = { no: Number(m[1]), type: "" };
          toks.slice(1).forEach((t) => {
            let col = null;
            cols.forEach((c) => { if (c.x <= t.x + 4) col = c; });
            if (!col || blank(t.s)) return;
            pitch[col.k] = col.k === "tilt" ? t.s : ["extension", "relHeight", "relSide"].includes(col.k) ? feet(t.s) : num(t.s);
          });
          const d = dotBeside(dots, toks[0]);
          pitch._color = d ? d.color : null;
          out.pitches.push(pitch);
        }
      });
    }
    // each pitch's type: the legend color nearest its dot's
    out.pitches.forEach((pt) => {
      if (pt._color && palette.length) {
        let best = null;
        palette.forEach((q) => { const dd = dist(q.color, pt._color); if (!best || dd < best.d) best = { d: dd, type: q.type }; });
        if (best && best.d < 60) pt.type = best.type;
      }
      delete pt._color;
      // a pitch TrackMan didn't tag (no dot, or one marked Undefined) stays untagged, to tag on the Bullpens tab
      if (UNTAGGED.test(pt.type)) pt.type = "";
    });
    out.pitches.sort((a, b) => a.no - b.no);
    if (!out.pitches.length && !out.summary.length) throw new Error("This doesn't look like a TrackMan pitching report: no pitch table was found in it.");
    return out;
  }

  window.TrackmanImport = { parse, feet };
})();
