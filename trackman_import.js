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

  // The Location chart (plate location, in feet, catcher's view): its dots, in the order drawn, which is pitch order,
  // placed in feet from the chart's own tick labels. Pitches with no location (not fully tracked) have no dot.
  function locationDots(items, dots) {
    const title = items.find((t) => t.s === "Location");
    if (!title) return null;
    const below = items.filter((t) => t.y < title.y - 4 && (t.s === "Release" || t.s === "Movement"));
    const bottom = below.length ? Math.max(...below.filter((t) => t.x >= title.x - 10).map((t) => t.y), -Infinity) : -Infinity;
    const ticks = items.filter((t) => t.x >= title.x - 10 && t.y < title.y - 4 && t.y > bottom + 4 && /^-?\d+(\.\d+)?$/.test(t.s))
      .map((t) => ({ v: Number(t.s), cx: t.x + (t.w || 0) / 2, cy: t.y + (t.h || 7) * 0.36 }));
    if (ticks.length < 4) return null;
    // the bottom row of numbers is the side axis; the right-hand column is the height axis
    const rowY = Math.min(...ticks.map((t) => t.cy));
    const xs = ticks.filter((t) => Math.abs(t.cy - rowY) < 2);
    const colX = Math.max(...ticks.map((t) => t.cx));
    const ys = ticks.filter((t) => Math.abs(t.cx - colX) < 4 && Math.abs(t.cy - rowY) >= 2);
    if (xs.length < 2 || ys.length < 2) return null;
    const fit = (pts, k) => { const a = pts[0], b = pts[pts.length - 1]; const m = (b.v - a.v) / (b[k] - a[k]); return (u) => a.v + (u - a[k]) * m; };
    xs.sort((a, b) => a.cx - b.cx); ys.sort((a, b) => a.cy - b.cy);
    const sideAt = fit(xs, "cx"), heightAt = fit(ys, "cy");
    const left = title.x - 10, right = colX - 4, low = bottom > -Infinity ? bottom + 4 : rowY - 20, high = title.y - 4; // dots can sit lower than the side axis numbers
    const out = [];
    dots.forEach((d) => {
      if (d.x < left || d.x > right || d.y < low || d.y > high) return;
      const last = out[out.length - 1];
      if (last && Math.abs(last.x - d.x) < 0.3 && Math.abs(last.y - d.y) < 0.3) return; // a dot's outline, drawn over its fill
      out.push({ x: d.x, y: d.y, color: d.color, side: Math.round(sideAt(d.x) * 100) / 100, height: Math.round(heightAt(d.y) * 100) / 100 });
    });
    return out.length ? out : null;
  }
  // Each location dot's pitch: the dots run in pitch order, skipping pitches with no movement, so they're matched by
  // color along the pitches; a dot is only given to a pitch when every possible matching agrees (earliest = latest).
  function placePitches(pitches, located, typeOfColor) {
    const cand = pitches.filter((p) => p.ivb != null && p.hb != null && p.type);
    const dts = located.map((d) => typeOfColor(d.color));
    const early = [], late = [];
    let j = 0;
    for (let i = 0; i < dts.length; i++) { while (j < cand.length && cand[j].type !== dts[i]) j++; if (j >= cand.length) return 0; early.push(j++); }
    j = cand.length - 1;
    for (let i = dts.length - 1; i >= 0; i--) { while (j >= 0 && cand[j].type !== dts[i]) j--; if (j < 0) return 0; late[i] = j--; }
    let placed = 0;
    dts.forEach((t, i) => { if (early[i] === late[i]) { const p = cand[early[i]]; p.plateHeight = located[i].height; p.plateSide = located[i].side; placed++; } });
    return placed;
  }
  // Vertical approach angle, estimated: the pitch's path from release to the front of the plate with gravity, the lift
  // its IVB implies, and a typical slowdown from drag, reaching the plate height the Location chart shows.
  // Negative is downward; flatter (closer to 0) on a fastball is what's usually wanted up in the zone.
  function vaaOf(p) {
    if (p.speed == null || p.ivb == null || p.relHeight == null || p.plateHeight == null) return null;
    const ext = p.extension != null ? p.extension : 6;
    const d = 60.5 - ext - 17 / 12, v0 = p.speed * 1.46667;
    const t = d / (v0 * 0.96), vyPlate = v0 * 0.92;
    const az = -32.174 + (2 * (p.ivb / 12)) / (t * t);
    const vz0 = (p.plateHeight - p.relHeight - 0.5 * az * t * t) / t;
    const vzPlate = vz0 + az * t;
    return Math.round((Math.atan2(vzPlate, vyPlate) * 180 / Math.PI) * 100) / 100;
  }

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
    let cols = null, located = null;
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      const items = tc.items.map((i) => ({ s: i.str.trim(), x: i.transform[4], y: i.transform[5], h: i.height, w: i.width }));
      const dots = dotsOf(await page.getOperatorList(), lib.OPS);
      const lines = linesOf(items);
      if (!located) located = locationDots(items, dots);
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
    // plate location from the Location chart, and from it each pitch's vertical approach angle
    if (located && palette.length) {
      const typeOfColor = (c) => { let best = null; palette.forEach((q) => { const dd = dist(q.color, c); if (!best || dd < best.d) best = { d: dd, type: q.type }; }); return best && best.d < 60 ? best.type : ""; };
      out.located = placePitches(out.pitches, located, typeOfColor);
    }
    out.pitches.forEach((pt) => { const v = vaaOf(pt); if (v != null) pt.vaa = v; });
    if (!out.pitches.length && !out.summary.length) throw new Error("This doesn't look like a TrackMan pitching report: no pitch table was found in it.");
    return out;
  }

  window.TrackmanImport = { parse, feet, vaaOf };
})();
