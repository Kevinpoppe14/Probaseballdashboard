// Holiday colors — on a major holiday the dashboard and the athlete phone page take on that day's three colors,
// and go back to normal the day after. Shared by index.html and athlete.html (plain JavaScript, no JSX).
//
// On a holiday this sets data-holiday on <html>, along with --hol-1 / --hol-2 / --hol-3 (the day's main color,
// second color and third), and each page's stylesheet has a few rules under :root[data-holiday] that use them.
// To see one on any day, add ?holiday=christmas (or halloween, july4, ...) to the address; ?holiday=none turns
// today's off.
(function () {
  // nth weekday of a month (n = -1 for the last one); weekday 0 is Sunday, month 0 is January
  const nthWeekday = (year, month, weekday, n) => {
    if (n > 0) { const first = new Date(year, month, 1).getDay(); return 1 + ((weekday - first + 7) % 7) + (n - 1) * 7; }
    const last = new Date(year, month + 1, 0);
    return last.getDate() - ((last.getDay() - weekday + 7) % 7);
  };
  // Easter Sunday (Gregorian), as [month, day]
  const easter = (year) => {
    const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
    const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31) - 1, dayOfMonth = ((h + l - 7 * m + 114) % 31) + 1;
    return [month, dayOfMonth];
  };

  // a run of days as [month, day] pairs: `count` days starting `offset` days from the given date
  const span = (year, month, dayOfMonth, offset, count) => Array.from({ length: count }, (_, i) => {
    const d = new Date(year, month, dayOfMonth + offset + i);
    return [d.getMonth(), d.getDate()];
  });

  // each holiday: the days it covers in a given year as [month, day] pairs, a greeting, and its three colors
  const HOLIDAYS = [
    { key: "newyear", greeting: "Happy New Year", colors: ["#c9971a", "#111111", "#ffffff"], days: () => [[0, 1], [11, 31]] },
    { key: "valentines", greeting: "Happy Valentine's Day", colors: ["#d6336c", "#8f1239", "#ffffff"], days: () => [[1, 14]] },
    { key: "stpatricks", greeting: "Happy St. Patrick's Day", colors: ["#1a7f37", "#c9971a", "#ffffff"], days: () => [[2, 17]] },
    { key: "easter", greeting: "Happy Easter", colors: ["#7c5cc4", "#d9668f", "#ffffff"], days: (y) => span(y, ...easter(y), -2, 3) }, // Good Friday through Easter Sunday
    { key: "mothers", greeting: "Happy Mother's Day", colors: ["#d6477a", "#8e3a6b", "#ffffff"], days: (y) => [[4, nthWeekday(y, 4, 0, 2)]] }, // second Sunday of May
    { key: "fathers", greeting: "Happy Father's Day", colors: ["#1d5fa8", "#3d4f66", "#ffffff"], days: (y) => [[5, nthWeekday(y, 5, 0, 3)]] }, // third Sunday of June
    { key: "memorial", greeting: "Memorial Day", colors: ["#b31942", "#0a3161", "#ffffff"], days: (y) => [[4, nthWeekday(y, 4, 1, -1)]] },
    // Memorial Day, the 4th of July and Veterans Day all use the flag's own Old Glory Red and Old Glory Blue
    { key: "july4", greeting: "Happy 4th of July", colors: ["#b31942", "#0a3161", "#ffffff"], days: () => [[6, 4]] },
    { key: "halloween", greeting: "Happy Halloween", colors: ["#e8590c", "#000000", "#ffffff"], days: () => [[9, 31]] },
    { key: "veterans", greeting: "Veterans Day", colors: ["#b31942", "#0a3161", "#ffffff"], days: () => [[10, 11]] },
    { key: "thanksgiving", greeting: "Happy Thanksgiving", colors: ["#b45309", "#7c2d12", "#fde9b8"], days: (y) => span(y, 10, nthWeekday(y, 10, 4, 4), 0, 4) }, // Thanksgiving Thursday through Sunday
    { key: "christmas", greeting: "Merry Christmas", colors: ["#c8102e", "#1a7f37", "#ffffff"], days: () => [[11, 24], [11, 25]] },
  ];

  // today's holiday, or null. A ?holiday= in the address previews one (or "none" switches today's off).
  function today(now = new Date()) {
    let forced = null;
    try { forced = new URLSearchParams(window.location.search).get("holiday"); } catch (e) { /* no address to read */ }
    if (forced) return HOLIDAYS.find((h) => h.key === forced.toLowerCase()) || null;
    const m = now.getMonth(), d = now.getDate(), y = now.getFullYear();
    return HOLIDAYS.find((h) => h.days(y).some(([hm, hd]) => hm === m && hd === d)) || null;
  }

  // ---- logos in the day's colors ---------------------------------------------------------------------
  // The DST and Cubs logos in the page header are redrawn in the holiday's colors: the picture is copied onto
  // a canvas and its colored parts are repainted, shape and edges untouched. On the DST logo the red "D" takes
  // the main color and the red tagline under it the second; on the Cubs logo the red "C" takes the main color
  // and the blue ring the second. White and charcoal lettering is left alone. Only header logos are touched
  // (.brand-logo on the dashboard, the logo on the phone page); printed pages and team logos in tables are not.
  const LOGO_SELECTOR = "img.brand-logo, .brand > img";
  const isLogo = (src) => /dst-logo|team-logos\/112\.svg/.test(src || "");
  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const luminance = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  const tinted = new Map(); // "holiday|source|light or dark" -> the recolored picture, as a data: address

  function recolor(src, holiday, onLight) {
    const id = `${holiday.key}|${src}|${onLight ? "light" : "dark"}`;
    if (tinted.has(id)) return tinted.get(id);
    const job = new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous"; // the Cubs logo comes from another site; without this the canvas can't be read back
      img.onload = () => {
        try {
          const scale = Math.max(1, 360 / (img.naturalWidth || 360)); // the Cubs logo is a small vector: draw it larger so it stays sharp
          const w = Math.round((img.naturalWidth || 360) * scale), h = Math.round((img.naturalHeight || 360) * scale);
          const canvas = document.createElement("canvas");
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, w, h);
          const data = ctx.getImageData(0, 0, w, h);
          const px = data.data;
          const main = rgb(holiday.colors[0]);
          // the second color has to show up against the page: a black one on a dark page (or a white one on a
          // light page) would vanish, so the third or the main color steps in
          let second = rgb(holiday.colors[1]);
          if (!onLight && luminance(second) < 0.12) second = rgb(holiday.colors[2]);
          if (onLight && luminance(second) > 0.85) second = main;
          const dst = /dst-logo/.test(src);
          for (let i = 0; i < px.length; i += 4) {
            if (px[i + 3] < 8) continue; // transparent
            const r = px[i], g = px[i + 1], b = px[i + 2];
            const max = Math.max(r, g, b), min = Math.min(r, g, b);
            if (max - min < 60) continue; // white, grey or charcoal: leave it
            const red = r === max && r - Math.max(g, b) > 50, blue = b === max && b - r > 40;
            let to = null;
            if (red) to = dst && Math.floor(i / 4 / w) > h * 0.8 ? second : main; // the DST tagline sits in the bottom fifth
            else if (blue) to = second;
            if (to) { px[i] = to[0]; px[i + 1] = to[1]; px[i + 2] = to[2]; }
          }
          ctx.putImageData(data, 0, 0);
          resolve(canvas.toDataURL("image/png"));
        } catch (e) { resolve(null); } // the picture could not be read back: keep the normal logo
      };
      img.onerror = () => resolve(null);
      img.src = src;
    });
    tinted.set(id, job);
    return job;
  }

  // puts every header logo into today's colors, or back to normal when it is not a holiday
  function tintLogos() {
    const h = today();
    const onLight = document.documentElement.getAttribute("data-theme") === "light";
    document.querySelectorAll(LOGO_SELECTOR).forEach((img) => {
      const shown = img.getAttribute("src") || "";
      // remember the real logo whenever the page sets one (as it does when switching light and dark mode)
      if (!shown.startsWith("data:") && isLogo(shown)) img.dataset.holidayOrig = shown;
      const orig = img.dataset.holidayOrig;
      if (!orig) return;
      if (!h) { if (shown.startsWith("data:")) img.setAttribute("src", orig); return; }
      const want = `${h.key}|${onLight}`;
      if (shown.startsWith("data:") && img.dataset.holidayTint === want) return; // already done
      recolor(new URL(orig, document.baseURI).href, h, onLight).then((url) => {
        if (!url || img.dataset.holidayOrig !== orig) return;
        img.dataset.holidayTint = want;
        img.setAttribute("src", url);
      });
    });
  }

  function apply() {
    const root = document.documentElement;
    const h = today();
    if (!h) {
      root.removeAttribute("data-holiday");
      ["--hol-1", "--hol-2", "--hol-3"].forEach((v) => root.style.removeProperty(v));
    } else {
      root.setAttribute("data-holiday", h.key);
      h.colors.forEach((c, i) => root.style.setProperty(`--hol-${i + 1}`, c));
    }
    tintLogos();
    return h;
  }

  window.Holiday = { HOLIDAYS, today, apply };
  apply();
  // Logos are drawn by the page after this runs, and redrawn when the theme or the page changes, so watch for
  // them. (On an ordinary day there is nothing to do and nothing is watched.)
  const watch = () => {
    if (!today() || !document.body) return;
    let queued = false;
    new MutationObserver(() => {
      if (queued) return;
      queued = true;
      setTimeout(() => { queued = false; tintLogos(); }, 50);
    }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["src", "data-theme"] });
    tintLogos();
  };
  if (document.body) watch(); else document.addEventListener("DOMContentLoaded", watch);
  // a page left open overnight changes over (and changes back) on its own
  setInterval(apply, 15 * 60 * 1000);
})();
