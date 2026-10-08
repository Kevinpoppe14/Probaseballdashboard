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

  // each holiday: the days it covers in a given year as [month, day] pairs, a greeting, and its three colors
  const HOLIDAYS = [
    { key: "newyear", greeting: "Happy New Year", colors: ["#c9971a", "#111111", "#ffffff"], days: () => [[0, 1], [11, 31]] },
    { key: "valentines", greeting: "Happy Valentine's Day", colors: ["#d6336c", "#8f1239", "#ffffff"], days: () => [[1, 14]] },
    { key: "stpatricks", greeting: "Happy St. Patrick's Day", colors: ["#1a7f37", "#c9971a", "#ffffff"], days: () => [[2, 17]] },
    { key: "easter", greeting: "Happy Easter", colors: ["#7c5cc4", "#d9668f", "#ffffff"], days: (y) => [easter(y)] },
    { key: "memorial", greeting: "Memorial Day", colors: ["#b31942", "#0a3161", "#ffffff"], days: (y) => [[4, nthWeekday(y, 4, 1, -1)]] },
    // Memorial Day, the 4th of July and Veterans Day all use the flag's own Old Glory Red and Old Glory Blue
    { key: "july4", greeting: "Happy 4th of July", colors: ["#b31942", "#0a3161", "#ffffff"], days: () => [[6, 4]] },
    { key: "halloween", greeting: "Happy Halloween", colors: ["#e8590c", "#000000", "#ffffff"], days: () => [[9, 31]] },
    { key: "veterans", greeting: "Veterans Day", colors: ["#b31942", "#0a3161", "#ffffff"], days: () => [[10, 11]] },
    { key: "thanksgiving", greeting: "Happy Thanksgiving", colors: ["#b45309", "#7c2d12", "#fde9b8"], days: (y) => [[10, nthWeekday(y, 10, 4, 4)]] },
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

  function apply() {
    const root = document.documentElement;
    const h = today();
    if (!h) {
      root.removeAttribute("data-holiday");
      ["--hol-1", "--hol-2", "--hol-3"].forEach((v) => root.style.removeProperty(v));
      return null;
    }
    root.setAttribute("data-holiday", h.key);
    h.colors.forEach((c, i) => root.style.setProperty(`--hol-${i + 1}`, c));
    return h;
  }

  window.Holiday = { HOLIDAYS, today, apply };
  apply();
  // a page left open overnight changes over (and changes back) on its own
  setInterval(apply, 15 * 60 * 1000);
})();
