// Sprint Assessment (the profile's Movement › Sprint Assessment): one session of sprint testing for an athlete, put
// together from three things and read as one:
//   - timing gate reps: the time at each gate (10, 20, 30, 40 yd, or whatever gates were set), typed in, and the steps
//     to each gate. Each rep's segments come out as time, speed, steps, step length and step rate, and the best rep
//     gets a force-velocity profile (Samozino's method, fitted to the splits) with its projected times.
//   - resisted sprints: the sled's load with the time over a distance, or the speed a radar or 1080 measured, giving a
//     load-velocity profile: his unloaded speed, the load that would stop him, and the loads for each training zone.
//   - sprint motion capture clips (the Sprint tab), linked to a rep: their first step, first three steps, foot
//     clearance and top speed, and, once a cone is marked on each clip, his steps counted to each gate across clips
//     filmed from several camera spots.
// Saved with his assessments as kind "sprintassess" (store.js). Plain JavaScript, mounted by index.html:
//   window.SprintAssessment.mount(box, { athlete, weightLb, list, all, save, remove, clips, openClip })
(function () {
  const el = (tag, attrs, ...kids) => {
    const n = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (v == null || v === false) return;
      if (k === "class") n.className = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    });
    kids.flat().forEach((c) => { if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c))); });
    return n;
  };
  const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const num = (v) => { const x = parseFloat(v); return Number.isFinite(x) ? x : null; };
  const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10), r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);
  const mph = (ms) => ms * 2.23694;
  const ord = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th"}`;
  const YD = 0.9144;
  const START_TYPES = [["3pt", "Three-point start"], ["2pt", "Two-point (standing) start"], ["steal", "Base-stealing start"], ["fly", "Flying start (fly-in)"]];
  const startName = (k) => (START_TYPES.find((s) => s[0] === k) || START_TYPES[0])[1];

  // ---- what each number means: shown with the pointer on its (dotted) label, or a tap on a phone or tablet ---------
  const TIPS = {
    gate: "Time from the start to this gate. With a beam start the clock starts when he breaks the first beam, a moment after he first moves.",
    "Fastest segment": "His highest average speed over any one stretch between gates: the top speed he actually showed in this rep.",
    "Top speed (projected)": "The speed his force-velocity curve levels off at (V0): what he'd reach with room to keep accelerating. Usually a little above his fastest segment.",
    "F0, max horizontal force": "The forward force he could put into the ground at zero speed, per kg of body weight: the start. Team-sport athletes are usually about 7-9 N/kg.",
    "V0, max speed": "The top speed his curve says he'd reach: where his force runs out. Team-sport athletes are usually about 8.5-10 m/s.",
    "Pmax, max power": "Max horizontal power (F0 × V0 ÷ 4), per kg: how much speed he can add in the middle of the acceleration. Usually about 15-22 W/kg.",
    "τ (how fast he gets there)": "Tau, the time his speed curve takes to reach 63% of his top speed: smaller gets him up to speed sooner. The fit is how far, on average, the curve misses where he really was at each gate.",
    Segment: "The stretch between two gates (the first from the start line).",
    Phase: "Which part of the sprint the stretch is: Start (to the first gate), Acceleration (to about 22 yd), Transition, then Max velocity (from about 30 yd).",
    Time: "The split: the time between the two gates.",
    Speed: "His average speed over the stretch: its distance over its time.",
    "Of his top": "The stretch's speed as a share of his fastest stretch. Near 100% means he's at top speed by here.",
    Steps: "Steps in the stretch: typed in, or counted from his linked videos (marked video) when a cone is marked on them.",
    "Step length": "Distance a step: the stretch's length over its steps (from the clips, one foot's touchdown to the other's). Speed = step length × step rate.",
    "Step rate": "Steps a second (step frequency). Speed = step length × step rate.",
    "On the track": "Whether a cone is marked on the clip. If so, the steps it shows and the yard lines they land on, which count his steps to the gates.",
    "First step": "Time from his hips starting to move to his first foot landing.",
    "First step length": "How far his first foot lands from where it stood.",
    "First 3 steps": "Distance from his front foot at the start to where his third step lands.",
    "Foot clearance": "How high the swing foot travels off the ground as it comes through (its lowest point, heel or toe, at its highest). High means a long recovery; scuffing low means little time in the air.",
    "Top speed in clip": "The fastest his hips moved forward in the clip.",
    Contact: "How long each foot is on the ground (the middle step). Shorter at top speed goes with stiffer, quicker contacts.",
    "Unloaded (V0)": "Where his line meets zero load: his speed with no sled, from the resisted reps.",
    "Load that stops him (L0)": "Where his line meets zero speed: the sled load, as a share of body weight, that would stop him. Higher means he holds his speed better under load.",
    "Speed lost per 10% BW": "How much speed each 10% of his body weight on the sled costs him (the slope of his line). r² is how well the points sit on it: nearer 1 is surer.",
    "Slows him by": "Training zones by how much the sled slows him from his unloaded speed. Each zone's load is that share of L0.",
    "Where he stands": "Strong, Middle or Needs work, from his percentile (among our athletes tested the same way once there are five, else the usual team-sport range), and lower if that stretch is slower than his own profile says it should be.",
    "Among our athletes": "His percentile among our other athletes' latest CMJs: higher is better for him, whichever way the number runs.",
    "Since the jump before": "The change from his CMJ before this one: green is better, red worse.",
  };
  const tipped = (key, text = key) => (TIPS[key] ? el("span", { class: "sa-tip", tabindex: "0", "data-tip": key }, text) : text);
  const head = (h) => el("th", null, tipped(h));
  let tipBox = null, tipFor = null;
  function showTip(t) {
    if (!tipBox) { tipBox = el("div", { class: "sa-tipbox", role: "tooltip" }); document.body.append(tipBox); window.addEventListener("scroll", hideTip, true); }
    tipBox.textContent = TIPS[t.dataset.tip];
    tipBox.style.display = "block"; tipFor = t;
    const r = t.getBoundingClientRect(), w = tipBox.offsetWidth, h = tipBox.offsetHeight;
    tipBox.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - w - 8))}px`;
    tipBox.style.top = `${r.bottom + 6 + h > window.innerHeight && r.top - 6 - h > 0 ? r.top - 6 - h : r.bottom + 6}px`;
  }
  function hideTip() { if (tipBox) tipBox.style.display = "none"; tipFor = null; }

  // ---- the numbers ------------------------------------------------------------------------------------------------
  // a session's gates, in meters, and each rep's times at them (cumulative, seconds)
  const metersOf = (rec, d) => (rec.unit === "m" ? d : d * YD);
  const repTimes = (rep, gates) => gates.map((_, k) => num((rep.times || [])[k]));
  // the best rep: the fastest to the furthest gate every rep reached
  function bestRep(rec) {
    const g = rec.gates || [];
    const reps = (rec.reps || []).filter((r) => repTimes(r, g).some((t) => t != null));
    if (!reps.length) return null;
    const far = Math.max(...reps.map((r) => repTimes(r, g).reduce((m, t, k) => (t != null ? k : m), -1)));
    const at = (r) => repTimes(r, g)[far];
    return reps.filter((r) => at(r) != null).reduce((b, r) => (at(r) < at(b) ? r : b));
  }
  // Force-velocity profile from split times (Samozino et al. 2016): his position from the first move is
  // x(t) = vmax·(t + τ·e^(−t/τ) − τ), fitted to the gates; then F0 = vmax/τ (N/kg), Pmax = F0·vmax/4 (W/kg).
  // `beam`: the clock started when he broke the first beam, a moment after he started moving (most gate systems), so
  // that moment (up to 0.6 s) is fitted too and added to every split; taken as the clock's zero, it would make his
  // early speed look far quicker than it was and F0 read high. Without it the clock started with his first move (a
  // touch pad, a hand release). Projected times are then from his first move, and `lag` is the fitted delay.
  function fvFrom(points, beam = false) {
    const pts = points.filter((p) => p.t > 0 && p.x > 0);
    if (pts.length < (beam ? 3 : 2)) return null;
    let best = null;
    for (let lag = 0; lag <= (beam ? 0.6 : 0); lag += 0.01) {
      for (let tau = 0.3; tau <= 3; tau += 0.005) {
        const g = (t) => t + tau * Math.exp(-t / tau) - tau;
        let sxg = 0, sgg = 0;
        pts.forEach((p) => { const gi = g(p.t + lag); sxg += p.x * gi; sgg += gi * gi; });
        const vmax = sxg / sgg;
        let e = 0;
        pts.forEach((p) => { const d = vmax * g(p.t + lag) - p.x; e += d * d; });
        if (!best || e < best.e) best = { tau, vmax, e, lag };
      }
    }
    if (!best || best.vmax < 4 || best.vmax > 13 || best.tau <= 0.305 || best.tau >= 2.995) return null;
    const { tau, vmax, lag } = best;
    const timeTo = (d) => { let lo = 0, hi = 30; for (let k = 0; k < 60; k++) { const t = (lo + hi) / 2; if (vmax * (t + tau * (Math.exp(-t / tau) - 1)) < d) lo = t; else hi = t; } return lo; };
    return { tau, vmax, lag, F0: vmax / tau, Pmax: (vmax * vmax) / tau / 4, timeTo, rmse: Math.sqrt(best.e / pts.length) };
  }
  // the steps his linked clips put on the track (yards from the start line, a touchdown each), across clips: where two
  // clips overlap, the same touchdown is counted once
  function trackSteps(clips) {
    const all = [];
    clips.forEach((c) => (c.track || []).forEach((s) => { if (Number.isFinite(s.yd)) all.push(s.yd); }));
    all.sort((a, b) => a - b);
    const out = [];
    all.forEach((yd) => { if (!out.length || yd - out[out.length - 1] > 0.35) out.push(yd); });
    return out;
  }
  // each segment of a rep: time, speed, steps (typed in, or counted from the clips), step length and rate
  function segmentsOf(rec, rep, clips) {
    const g = rec.gates || [], t = repTimes(rep, g), manual = (rep.steps || []).map(num), seen = trackSteps(clips || []);
    const unitYd = rec.unit !== "m";
    const median = (xs) => { const s = xs.slice().sort((a, b) => a - b); return s.length ? s[s.length >> 1] : null; };
    const gaps = seen.slice(1).map((y, k) => y - seen[k]), usual = median(gaps);
    return g.map((d, k) => {
      const from = k ? g[k - 1] : 0, t0 = k ? t[k - 1] : 0, t1 = t[k];
      const time = t1 != null && t0 != null ? t1 - t0 : null;
      const dist = metersOf(rec, d - from);
      // steps: typed in at the gates (cumulative), or the clips' touchdowns in this stretch, if they cover all of it
      let steps = null, fromVideo = false, partial = false;
      if (manual[k] != null && (k === 0 || manual[k - 1] != null)) steps = manual[k] - (k ? manual[k - 1] : 0);
      else if (seen.length && unitYd) {
        const inside = seen.filter((y) => y > from && y <= d);
        if (inside.length) {
          const edges = [from, ...inside, d], biggest = Math.max(...edges.slice(1).map((y, j) => y - edges[j]));
          partial = usual != null && biggest > usual * 1.8;
          fromVideo = true;
          steps = partial ? null : inside.length; // (a stretch the clips only partly cover isn't counted)
        }
      }
      const v = time && time > 0 ? dist / time : null;
      return { from, to: d, time, v, steps, fromVideo, partial, stepLen: steps ? dist / steps : null, rate: steps && time ? steps / time : null };
    });
  }
  // load-velocity profile: velocity falls in a line with the load (as a share of body weight); the load where it
  // would reach zero (L0), and the loads that slow him by 10, 25, 50 and 75% (the training zones; 50% is about where
  // his power on the sled peaks)
  function lvFrom(points) {
    if (points.length < 2 || new Set(points.map((p) => p.pct)).size < 2) return null;
    const n = points.length, mx = points.reduce((s, p) => s + p.pct, 0) / n, my = points.reduce((s, p) => s + p.v, 0) / n;
    const sxx = points.reduce((s, p) => s + (p.pct - mx) ** 2, 0), sxy = points.reduce((s, p) => s + (p.pct - mx) * (p.v - my), 0);
    const b = sxy / sxx, a = my - b * mx;
    if (!(b < 0) || !(a > 0)) return { a, b, bad: true };
    const ss = points.reduce((s, p) => s + (p.v - (a + b * p.pct)) ** 2, 0), st = points.reduce((s, p) => s + (p.v - my) ** 2, 0);
    return { V0: a, slope: b, L0: -a / b, r2: st ? 1 - ss / st : 1 };
  }
  // the resisted reps on one footing: velocity in m/s and load as % of body weight; a time over a distance gives his
  // average velocity over it, a measured speed his top speed, so the two aren't mixed on one line
  function resistedPoints(rec, weightLb) {
    const out = { time: [], speed: [] };
    (rec.resisted || []).forEach((r) => {
      const load = num(r.load);
      if (load == null || !weightLb) return;
      const pct = (load / weightLb) * 100;
      if (r.mode === "speed") { const s = num(r.speed); if (s) out.speed.push({ pct, load, v: r.speedUnit === "ms" ? s : s / 2.23694, r }); }
      else { const d = num(r.dist), t = num(r.time); if (d && t) out.time.push({ pct, load, v: metersOf(rec, d) / t, dist: d, r }); }
    });
    // the unloaded point for timed reps: his best gate rep over the same distance, if there's a gate there
    const g = rec.gates || [], best = bestRep(rec);
    if (best && out.time.length) {
      const d = out.time[0].dist, k = g.indexOf(d), t = k >= 0 ? repTimes(best, g)[k] : null;
      if (t && out.time.every((p) => p.dist === d) && !out.time.some((p) => p.load === 0)) out.time.push({ pct: 0, load: 0, v: metersOf(rec, d) / t, dist: d, fromGates: true });
    }
    return out;
  }

  // ---- a small chart (SVG) ----------------------------------------------------------------------------------------
  function lineChart({ points, line, xLabel, yLabel, w = 420, h = 220, xMax }) {
    const l = 44, r = 12, t = 12, b = 34;
    const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
    const x1 = xMax || Math.max(1, ...xs) * 1.08, y1 = Math.max(1, ...ys) * 1.12;
    const X = (v) => l + (v / x1) * (w - l - r), Y = (v) => t + (1 - v / y1) * (h - t - b);
    const ticks = (max, n) => Array.from({ length: n + 1 }, (_, k) => (max / n) * k);
    let svg = `<svg viewBox="0 0 ${w} ${h}" class="sa-chart" role="img" aria-label="${yLabel} by ${xLabel}">`;
    ticks(y1, 4).forEach((v) => { svg += `<line x1="${l}" x2="${w - r}" y1="${Y(v)}" y2="${Y(v)}" class="sa-grid"/><text x="${l - 6}" y="${Y(v) + 4}" text-anchor="end" class="sa-axis">${v.toFixed(1)}</text>`; });
    ticks(x1, 5).forEach((v) => { svg += `<text x="${X(v)}" y="${h - b + 16}" text-anchor="middle" class="sa-axis">${Math.round(v)}</text>`; });
    svg += `<text x="${(l + w - r) / 2}" y="${h - 4}" text-anchor="middle" class="sa-axis">${xLabel}</text><text x="12" y="${(t + h - b) / 2}" text-anchor="middle" class="sa-axis" transform="rotate(-90 12 ${(t + h - b) / 2})">${yLabel}</text>`;
    if (line) { const [a, bb] = line, xe = Math.min(x1, a / -bb); svg += `<line x1="${X(0)}" y1="${Y(a)}" x2="${X(xe)}" y2="${Y(Math.max(0, a + bb * xe))}" class="sa-fit"/>`; }
    points.forEach((p) => { svg += `<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="5" class="sa-pt${p.hollow ? " hollow" : ""}"><title>${p.tip || ""}</title></circle>`; });
    const box = el("div", { class: "sa-chart-box" });
    box.innerHTML = `${svg}</svg>`;
    return box;
  }

  // ---- the page ---------------------------------------------------------------------------------------------------
  function mount(box, opts) {
    const { athlete } = opts;
    const blank = () => ({ id: `sa-${uid()}`, kind: "sprintassess", date: new Date().toISOString().slice(0, 10), unit: "yd", gates: [10, 20, 30, 40], start: "3pt", clock: "beam", surface: "", note: "", weightLb: opts.weightLb ? Math.round(opts.weightLb) : "", reps: [{ id: uid(), times: [], steps: [], clips: [] }], resisted: [] });
    const saved = () => (opts.list() || []).slice().sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    let draft = null, viewId = (saved()[0] || {}).id || null, msg = "";
    const current = () => draft || saved().find((r) => r.id === viewId) || null;
    const clipsAll = () => (opts.clips ? opts.clips() : []).slice().sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    const clipById = (id) => clipsAll().find((c) => c.id === id);

    // the explanations: a mouse shows them while it rests on a label, a tap shows one (tap again, or anywhere else, to close)
    let touchy = false;
    box.addEventListener("pointerover", (e) => { touchy = e.pointerType !== "mouse"; const t = e.target.closest(".sa-tip"); if (t && !touchy) showTip(t); });
    box.addEventListener("pointerout", (e) => { const t = e.target.closest(".sa-tip"); if (t && e.pointerType === "mouse" && !t.contains(e.relatedTarget)) hideTip(); });
    box.addEventListener("click", (e) => { const t = e.target.closest(".sa-tip"); if (!t) return; if (touchy && tipFor === t) hideTip(); else showTip(t); });
    box.addEventListener("focusin", (e) => { const t = e.target.closest(".sa-tip"); if (t && !touchy) showTip(t); });
    box.addEventListener("focusout", hideTip);

    function render() {
      hideTip();
      const rec = current();
      const list = saved();
      box.replaceChildren(el("div", { class: "sa" },
        el("div", { class: "sa-head" },
          el("h2", null, "Sprint Assessment ", el("small", null, athlete.name || "")),
          el("div", { class: "sa-head-actions" },
            list.length && !draft ? el("select", { "aria-label": "Assessment", onchange: (e) => { viewId = e.target.value; render(); } },
              list.map((r) => el("option", { value: r.id, selected: r.id === viewId }, `${r.date} · ${startName(r.start)}${(r.reps || []).length ? ` · ${(r.reps || []).length} rep${(r.reps || []).length === 1 ? "" : "s"}` : ""}`))) : null,
            !draft ? el("button", { type: "button", class: "sa-btn primary", onclick: () => { draft = blank(); render(); } }, "+ New assessment") : null,
            !draft && rec ? el("button", { type: "button", class: "sa-btn", onclick: () => { draft = JSON.parse(JSON.stringify(rec)); render(); } }, "Edit") : null)),
        msg ? el("p", { class: "sa-msg", role: "status" }, msg) : null,
        draft ? editor(draft) : null,
        rec ? report(rec) : el("div", { class: "sa-empty" }, "No sprint assessments yet. + New assessment: type in the timing gate times for each rep (and the steps to each gate), any resisted sprints, and link his sprint videos from the Sprint tab.")));
    }

    // ---- entering a session ----
    function editor(d) {
      const g = d.gates || [];
      const field = (label, input) => el("label", { class: "sa-field" }, el("span", null, label), input);
      const input = (value, on, attrs = {}) => el("input", { value: value ?? "", ...attrs, oninput: (e) => on(e.target.value) });
      const gateText = input(g.join(", "), () => {}, { "aria-label": "Gates" });
      gateText.addEventListener("change", (e) => { const next = e.target.value.split(/[,\s]+/).map(num).filter((x) => x != null && x > 0).sort((a, b) => a - b); if (next.length) { d.gates = [...new Set(next)]; render(); } });
      const settings = el("div", { class: "sa-row" },
        field("Date", input(d.date, (v) => { d.date = v; }, { type: "date" })),
        field("Start", el("select", { onchange: (e) => { d.start = e.target.value; } }, START_TYPES.map(([k, t]) => el("option", { value: k, selected: d.start === k }, t)))),
        field("Clock started", el("select", { onchange: (e) => { d.clock = e.target.value; } }, [["beam", "Breaking the first beam"], ["move", "His first move (touch pad, hand release)"]].map(([k, t]) => el("option", { value: k, selected: (d.clock || "beam") === k }, t)))),
        field("Gates at (comma between)", gateText),
        field("In", el("select", { onchange: (e) => { d.unit = e.target.value; render(); } }, [["yd", "yards"], ["m", "meters"]].map(([k, t]) => el("option", { value: k, selected: d.unit === k }, t)))),
        field("Body weight (lb)", input(d.weightLb, (v) => { d.weightLb = num(v); }, { type: "number", inputmode: "decimal", style: "width:90px" })),
        field("Surface / sled", input(d.surface, (v) => { d.surface = v; }, { placeholder: "e.g. turf, Prowler" })));
      const u = d.unit === "m" ? "m" : "yd";
      // the reps: the time at each gate, and the steps to it
      const clips = clipsAll();
      const repRows = (d.reps || []).map((rep, ri) => {
        rep.times = rep.times || []; rep.steps = rep.steps || []; rep.clips = rep.clips || [];
        const cell = (arr, k, ph, step) => el("td", null, el("input", { type: "number", inputmode: "decimal", step, value: arr[k] ?? "", placeholder: ph, oninput: (e) => { arr[k] = e.target.value === "" ? null : num(e.target.value); } }));
        return [
          el("tr", null, el("th", { rowspan: 2 }, `Rep ${ri + 1}`), el("td", { class: "sa-sub" }, "Time (s)"), g.map((_, k) => cell(rep.times, k, "0.00", "0.01")),
            el("td", { rowspan: 2 }, el("button", { type: "button", class: "sa-link", onclick: () => { d.reps.splice(ri, 1); render(); } }, "Remove"))),
          el("tr", null, el("td", { class: "sa-sub" }, "Steps"), g.map((_, k) => cell(rep.steps, k, "–", "1"))),
          el("tr", null, el("td", { colspan: g.length + 3, class: "sa-clips" },
            el("span", { class: "sa-sub" }, "Videos of this rep: "),
            clips.length ? clips.slice(0, 30).map((c) => el("label", { class: `sa-clip${rep.clips.includes(c.id) ? " on" : ""}` },
              el("input", { type: "checkbox", checked: rep.clips.includes(c.id), onchange: (e) => { rep.clips = e.target.checked ? [...rep.clips, c.id] : rep.clips.filter((x) => x !== c.id); render(); } }),
              ` ${c.date} · ${c.variant === "maxv" ? "fly" : c.variant || "start"}${c.track && c.track.length ? ` · ${c.track[0].yd.toFixed(0)}-${c.track[c.track.length - 1].yd.toFixed(0)} yd` : ""}${c.metrics && c.metrics.speed ? ` · ${c.metrics.speed} m/s` : ""}`))
              : el("span", { class: "sa-sub" }, "none yet (film them on the Sprint tab and save them; mark a cone on each to count steps to the gates)"))),
        ];
      });
      const reps = el("div", { class: "sa-block" },
        el("h3", null, "Timing gates"),
        el("p", { class: "sa-hint" }, `The time at each gate from the start (cumulative, seconds), and the steps to each gate if you counted them. Steps left blank come from his linked videos, where a cone is marked on each (one camera spot per section: 0-${g[0] || 10}, ${g[0] || 10}-${g[1] || 20}…).`),
        el("div", { class: "sa-scroll" }, el("table", { class: "sa-table sa-entry" },
          el("thead", null, el("tr", null, el("th", null, ""), el("th", null, ""), g.map((x) => el("th", null, `${x} ${u}`)), el("th", null, ""))),
          el("tbody", null, repRows.flat()))),
        el("button", { type: "button", class: "sa-btn", onclick: () => { d.reps.push({ id: uid(), times: [], steps: [], clips: [] }); render(); } }, "+ Rep"));
      // resisted sprints
      const resRows = (d.resisted || []).map((r, k) => el("tr", null,
        el("td", null, el("input", { type: "number", inputmode: "decimal", value: r.load ?? "", placeholder: "lb", oninput: (e) => { r.load = num(e.target.value); } })),
        el("td", null, el("select", { onchange: (e) => { r.mode = e.target.value; render(); } }, [["time", "Time over a distance"], ["speed", "Measured speed (radar, 1080)"]].map(([v, t]) => el("option", { value: v, selected: (r.mode || "time") === v }, t)))),
        (r.mode || "time") === "time"
          ? [el("td", null, el("input", { type: "number", inputmode: "decimal", value: r.dist ?? (g[1] || g[0] || 20), oninput: (e) => { r.dist = num(e.target.value); } }), ` ${u}`),
            el("td", null, el("input", { type: "number", inputmode: "decimal", step: "0.01", value: r.time ?? "", placeholder: "s", oninput: (e) => { r.time = num(e.target.value); } }), " s")]
          : [el("td", null, el("input", { type: "number", inputmode: "decimal", step: "0.1", value: r.speed ?? "", placeholder: "top speed", oninput: (e) => { r.speed = num(e.target.value); } })),
            el("td", null, el("select", { onchange: (e) => { r.speedUnit = e.target.value; } }, [["mph", "mph"], ["ms", "m/s"]].map(([v, t]) => el("option", { value: v, selected: (r.speedUnit || "mph") === v }, t))))],
        el("td", null, el("button", { type: "button", class: "sa-link", onclick: () => { d.resisted.splice(k, 1); render(); } }, "Remove"))));
      const resisted = el("div", { class: "sa-block" },
        el("h3", null, "Resisted sprints"),
        el("p", { class: "sa-hint" }, "Each rep's sled load (what's on the sled, lb) and either its time over a distance or the top speed a radar or 1080 measured. Three or more loads (unloaded counts: his best gate rep over the same distance is added) give a load-velocity profile. Keep the sled and surface the same from test to test."),
        resRows.length ? el("div", { class: "sa-scroll" }, el("table", { class: "sa-table sa-entry" },
          el("thead", null, el("tr", null, ["Load (lb)", "Measured as", "", "", ""].map((h) => el("th", null, h)))), el("tbody", null, resRows))) : null,
        el("button", { type: "button", class: "sa-btn", onclick: () => { d.resisted = d.resisted || []; const last = d.resisted[d.resisted.length - 1]; d.resisted.push({ id: uid(), load: null, mode: last ? last.mode : "time", dist: last ? last.dist : (g[1] || g[0] || 20), speedUnit: last ? last.speedUnit : "mph" }); render(); } }, "+ Resisted rep"));
      const note = el("textarea", { class: "sa-note", rows: 2, placeholder: "Notes…", oninput: (e) => { d.note = e.target.value; } });
      note.value = d.note || "";
      const isNew = !saved().some((r) => r.id === d.id);
      return el("div", { class: "sa-editor" }, settings, reps, resisted, note,
        el("div", { class: "sa-row" },
          el("button", { type: "button", class: "sa-btn primary", onclick: () => {
            const clean = { ...d, gates: d.gates, reps: (d.reps || []).filter((r) => (r.times || []).some((t) => t != null) || (r.clips || []).length), resisted: (d.resisted || []).filter((r) => r.load != null) };
            opts.save(clean); viewId = clean.id; draft = null; msg = "Saved."; render();
          } }, "Save"),
          el("button", { type: "button", class: "sa-btn", onclick: () => { draft = null; msg = ""; render(); } }, "Cancel"),
          !isNew ? el("button", { type: "button", class: "sa-link", onclick: () => { if (!window.confirm(`Delete the ${d.date} sprint assessment?`)) return; opts.remove(d); draft = null; viewId = (saved()[0] || {}).id || null; msg = "Deleted."; render(); } }, "Delete") : null));
    }

    // ---- reading a session ----
    function report(rec) {
      const g = rec.gates || [], u = rec.unit === "m" ? "m" : "yd", wLb = num(rec.weightLb) || opts.weightLb || null, kg = wLb ? wLb * 0.4536 : null;
      const best = bestRep(rec);
      const clipsOf = (rep) => (rep.clips || []).map(clipById).filter(Boolean);
      const out = [];
      if (best) {
        // the best rep: its segments and its force-velocity profile
        const segs = segmentsOf(rec, best, clipsOf(best));
        const topSeg = Math.max(...segs.map((s) => s.v || 0)) || null;
        const fv = rec.start === "fly" ? null : fvFrom(g.map((d, k) => ({ x: metersOf(rec, d), t: repTimes(best, g)[k] })).filter((p) => p.t != null), rec.clock !== "move");
        // what each part of the sprint is called, by where it is
        const phaseOf = (s, k) => (rec.start === "fly" ? "Max velocity" : k === 0 ? "Start" : metersOf(rec, s.to) <= 20.5 ? "Acceleration" : metersOf(rec, s.from) >= 27 ? "Max velocity" : "Transition");
        out.push(el("div", { class: "sa-block" },
          el("h3", null, `Best rep `, el("small", null, `rep ${(rec.reps || []).indexOf(best) + 1} of ${(rec.reps || []).length} · ${startName(rec.start)}${rec.surface ? ` · ${rec.surface}` : ""}`)),
          el("div", { class: "sa-stats" },
            g.map((d, k) => { const t = repTimes(best, g)[k]; return t != null ? el("div", null, el("span", null, tipped("gate", `${d} ${u}`)), el("b", null, `${t.toFixed(2)} s`)) : null; }),
            topSeg ? el("div", null, el("span", null, tipped("Fastest segment")), el("b", null, `${mph(topSeg).toFixed(1)} mph`), el("small", null, `${topSeg.toFixed(2)} m/s`)) : null,
            fv ? el("div", null, el("span", null, tipped("Top speed (projected)")), el("b", null, `${mph(fv.vmax).toFixed(1)} mph`), el("small", null, `${fv.vmax.toFixed(2)} m/s`)) : null),
          el("div", { class: "sa-scroll" }, el("table", { class: "sa-table" },
            el("thead", null, el("tr", null, ["Segment", "Phase", "Time", "Speed", "Of his top", "Steps", "Step length", "Step rate"].map(head))),
            el("tbody", null, segs.map((s, k) => el("tr", null,
              el("td", null, `${s.from}-${s.to} ${u}`), el("td", null, phaseOf(s, k)),
              el("td", null, s.time != null ? `${s.time.toFixed(2)} s` : "–"),
              el("td", null, s.v ? `${s.v.toFixed(2)} m/s · ${mph(s.v).toFixed(1)} mph` : "–"),
              el("td", null, s.v && topSeg ? `${Math.round((s.v / topSeg) * 100)}%` : "–"),
              el("td", null, s.steps != null ? `${s.steps}${s.fromVideo ? " (video)" : ""}` : s.partial ? "– (video covers part)" : "–"),
              el("td", null, s.stepLen ? `${(s.stepLen / 0.0254).toFixed(0)} in` : "–"),
              el("td", null, s.rate ? `${s.rate.toFixed(2)}/s` : "–")))))),
          fv ? el("div", { class: "sa-fv" },
            el("h4", null, "Force-velocity profile (from the splits)"),
            el("div", { class: "sa-stats" },
              el("div", null, el("span", null, tipped("F0, max horizontal force")), el("b", null, `${fv.F0.toFixed(2)} N/kg`), kg ? el("small", null, `${Math.round(fv.F0 * kg)} N`) : null),
              el("div", null, el("span", null, tipped("V0, max speed")), el("b", null, `${fv.vmax.toFixed(2)} m/s`), el("small", null, `${mph(fv.vmax).toFixed(1)} mph`)),
              el("div", null, el("span", null, tipped("Pmax, max power")), el("b", null, `${fv.Pmax.toFixed(1)} W/kg`), kg ? el("small", null, `${Math.round(fv.Pmax * kg)} W`) : null),
              el("div", null, el("span", null, tipped("τ (how fast he gets there)")), el("b", null, `${fv.tau.toFixed(2)} s`), el("small", null, `fit ±${(fv.rmse * 100).toFixed(0)} cm`))),
            el("p", { class: "sa-hint" }, `Projected from his first move: 10 yd ${fv.timeTo(10 * YD).toFixed(2)} s · 20 yd ${fv.timeTo(20 * YD).toFixed(2)} s · 30 yd ${fv.timeTo(30 * YD).toFixed(2)} s · 40 yd ${fv.timeTo(40 * YD).toFixed(2)} s · 60 yd ${fv.timeTo(60 * YD).toFixed(2)} s.${fv.lag ? ` The gates' clock started about ${fv.lag.toFixed(2)} s after his first move (fitted), so gate times run that much quicker.` : ""}`),
            diagnosis(rec, fv, segs, topSeg)) : rec.start === "fly" ? null : el("p", { class: "sa-hint" }, "Two or more gates' times (three or more is surer) give a force-velocity profile."),
          el("p", { class: "sa-hint" }, `Hover over (or tap) a dotted label for what it means. Speeds are averages over each segment. The force-velocity profile is fitted to the gate times (Samozino's method)${rec.clock === "move" ? ", the clock started with his first move" : ", with the moment between his first move and the clock starting at the first beam fitted too (three or more gates needed)"}. Compare it with tests timed the same way.`)));
        // every rep
        if ((rec.reps || []).length > 1) out.push(el("div", { class: "sa-block" }, el("h3", null, "Every rep"),
          el("div", { class: "sa-scroll" }, el("table", { class: "sa-table" },
            el("thead", null, el("tr", null, el("th", null, "Rep"), g.map((d) => el("th", null, `${d} ${u}`)), el("th", null, "Videos"))),
            el("tbody", null, rec.reps.map((r, k) => el("tr", { class: r === best ? "sa-best" : "" }, el("td", null, `${k + 1}${r === best ? " ★" : ""}`),
              repTimes(r, g).map((t) => el("td", null, t != null ? t.toFixed(2) : "–")), el("td", null, String((r.clips || []).length || "–")))))))));
      }
      // the videos linked to the reps: what each shows
      const linked = (rec.reps || []).flatMap((r, k) => clipsOf(r).map((c) => ({ c, rep: k + 1 })));
      if (linked.length) {
        const m = (c, key) => (c.metrics || {})[key];
        const unit = (c, key) => ((c.labels || {})[key] || [])[1] || "";
        const show = (c, key) => (m(c, key) == null ? "–" : `${m(c, key)}${unit(c, key) && !/^[°%]/.test(unit(c, key)) ? ` ${unit(c, key)}` : unit(c, key) || ""}`);
        out.push(el("div", { class: "sa-block" }, el("h3", null, "From his videos"),
          el("div", { class: "sa-scroll" }, el("table", { class: "sa-table" },
            el("thead", null, el("tr", null, ["Rep", "Clip", "On the track", "First step", "First step length", "First 3 steps", "Foot clearance", "Top speed in clip", "Contact", "Step length", "Step rate", ""].map(head))),
            el("tbody", null, linked.map(({ c, rep }) => el("tr", null,
              el("td", null, rep), el("td", null, `${c.date} · ${c.variant === "maxv" ? "fly" : c.variant || "start"}`),
              el("td", null, c.track && c.track.length ? `${c.track.length} steps, ${c.track[0].yd.toFixed(1)}-${c.track[c.track.length - 1].yd.toFixed(1)} yd` : "no cone marked"),
              el("td", null, show(c, "ttd1")), el("td", null, show(c, "firstLen")), el("td", null, m(c, "first3Ft") || show(c, "first3")), el("td", null, show(c, "clearance")),
              el("td", null, m(c, "speedMph") != null ? `${m(c, "speedMph")} mph` : show(c, "speed")), el("td", null, show(c, "contact")), el("td", null, show(c, "stepLen")), el("td", null, show(c, "stepRate")),
              el("td", null, opts.openClip ? el("button", { type: "button", class: "sa-link", onclick: () => opts.openClip(c) }, "Open") : null)))))),
          el("p", { class: "sa-hint" }, "Each clip's own analysis (Movement › Sprint). Sessions saved before the newest sprint analysis show their first 3 steps and foot clearance once re-run there. A shadow runner can be put beside him on any of them.")));
      }
      // the load-velocity profile
      const pts = resistedPoints(rec, wLb);
      [["time", "average velocity over the distance"], ["speed", "top speed measured"]].forEach(([mode, what]) => {
        const P = pts[mode];
        if (!P.length) return;
        const lv = lvFrom(P);
        const zone = (dec) => (lv && !lv.bad ? lv.L0 * dec : null);
        const lb = (pct) => (pct == null || !wLb ? "" : ` (${Math.round((pct / 100) * wLb)} lb)`);
        out.push(el("div", { class: "sa-block" },
          el("h3", null, "Load-velocity profile ", el("small", null, `${P.length} point${P.length === 1 ? "" : "s"}, ${what}${rec.surface ? ` · ${rec.surface}` : ""}`)),
          !wLb ? el("p", { class: "sa-hint" }, "Enter his body weight (Edit) to put the loads as a share of it.") : null,
          el("div", { class: "sa-lv" },
            lineChart({ points: P.map((p) => ({ x: p.pct, y: p.v, hollow: p.fromGates, tip: `${p.load} lb (${p.pct.toFixed(0)}% BW): ${p.v.toFixed(2)} m/s${p.fromGates ? ", his best gate rep" : ""}` })), line: lv && !lv.bad ? [lv.V0, lv.slope] : null, xLabel: "Sled load (% body weight)", yLabel: "Velocity (m/s)", xMax: lv && !lv.bad ? Math.min(lv.L0 * 1.05, 200) : null }),
            lv && !lv.bad ? el("div", null,
              el("div", { class: "sa-stats" },
                el("div", null, el("span", null, tipped("Unloaded (V0)")), el("b", null, `${lv.V0.toFixed(2)} m/s`), el("small", null, `${mph(lv.V0).toFixed(1)} mph`)),
                el("div", null, el("span", null, tipped("Load that stops him (L0)")), el("b", null, `${Math.round(lv.L0)}% BW`), el("small", null, lb(lv.L0).trim())),
                el("div", null, el("span", null, tipped("Speed lost per 10% BW")), el("b", null, `${(-lv.slope * 10).toFixed(2)} m/s`), el("small", null, `r² ${lv.r2.toFixed(2)}`))),
              el("table", { class: "sa-table" },
                el("thead", null, el("tr", null, head("Slows him by"), el("th", null, "Load"), el("th", null, "For"))),
                el("tbody", null, [[0.1, "10%", "Technique at speed, max velocity"], [0.25, "25%", "Speed-strength: acceleration"], [0.5, "50%", "Power: about where his sled power peaks"], [0.75, "75%", "Strength-speed: the first steps"]].map(([dec, label, use]) =>
                  el("tr", null, el("td", null, label), el("td", null, `${Math.round(zone(dec))}% BW${lb(zone(dec))}`), el("td", null, use))))))
              : el("p", { class: "sa-hint" }, lv && lv.bad ? "These points don't fall with the load (a heavier sled came out faster): check the entries." : "At least two different loads (three or more is better) for a profile.")),
          el("p", { class: "sa-hint" }, mode === "time" ? "Velocity is his average over the timed distance; the line through the loads gives his unloaded speed and the load that would stop him. Loads for each zone slow him by that share of his unloaded speed (after Cross, Cahill and colleagues). Valid for this sled on this surface." : "Velocity is the top speed measured at each load. Loads for each zone slow him by that share of his unloaded speed (after Cross, Cahill and colleagues). Valid for this sled on this surface.")));
      });
      // against his last assessment
      const prev = saved().filter((r) => r.id !== rec.id && (r.date || "") < (rec.date || "") && r.unit === rec.unit).shift();
      const pb = prev && bestRep(prev);
      if (best && pb) {
        const pg = prev.gates || [];
        const rows = g.filter((d) => pg.includes(d)).map((d) => { const a = repTimes(best, g)[g.indexOf(d)], b = repTimes(pb, pg)[pg.indexOf(d)]; return a != null && b != null ? [d, a, b] : null; }).filter(Boolean);
        if (rows.length) out.push(el("div", { class: "sa-block" }, el("h3", null, "Since his last assessment ", el("small", null, prev.date)),
          el("table", { class: "sa-table" }, el("thead", null, el("tr", null, ["Gate", "Now", "Then", "Change"].map((h) => el("th", null, h)))),
            el("tbody", null, rows.map(([d, a, b]) => el("tr", null, el("td", null, `${d} ${u}`), el("td", null, `${a.toFixed(2)} s`), el("td", null, `${b.toFixed(2)} s`),
              el("td", { class: a < b ? "sa-better" : a > b ? "sa-worse" : "" }, `${a - b > 0 ? "+" : a - b < 0 ? "−" : ""}${Math.abs(a - b).toFixed(2)} s`)))))));
      }
      if (rec.note) out.push(el("p", { class: "sa-note-text" }, rec.note));
      return el("div", { class: "sa-report" }, out.length ? out : el("div", { class: "sa-empty" }, "Nothing entered in this assessment yet: Edit to add reps."));
    }

    // ---- what it says: his areas, what to do about them, and the CMJ numbers that go with them ----
    // Each part of the sprint rated strong, middle or needs work: the start (F0 and his first segment), acceleration
    // (max power, and his early segments), the transition and top speed (V0 and his late segments). Where he stands
    // comes from the other athletes' assessments here (five or more, timed the same way) or else the usual range for
    // team-sport athletes; a segment well behind what his own profile says it should be also counts against that part.
    // Then basic ways to work on what needs it (with his own sled loads when he has a load-velocity profile), ways to
    // keep what's strong, and the CMJ numbers that tend to go with each part, his latest beside the others'.
    const AREAS = {
      start: {
        name: "Start (the first steps)",
        what: "Getting moving: horizontal force from a standstill and the first three steps.",
        work: (z) => [
          `Heavy sled starts, 5-10 yd${z ? `, ${z(0.6)}-${z(0.75)} (a load that slows him 60-75%)` : ", a load that slows him 60-75%"}: 4-6 reps, full rest`,
          "Starts from different positions (3-point, push-up, half-kneeling, lateral), 5-10 yd, 6-8 reps",
          "Wall drills and A-marches for shin angle, push direction and posture",
          "Heavy lower-body strength: trap bar deadlift, split squat, hip thrust, 3-5 reps",
          "Med ball scoop and push throws for distance",
        ],
        keep: (z) => ["Once or twice a week: 4-6 starts of 10 yd at full intent", `One heavy sled start set a week${z ? ` (${z(0.6)}-${z(0.75)})` : ""}`, "Keep the heavy lower-body strength work in"],
        cmj: ["relPropForce", "relPeakProp", "ttt", "mrsi"],
      },
      accel: {
        name: "Acceleration",
        what: "Building speed through 10-20 yd: keeping horizontal force on as he rises.",
        work: (z) => [
          `Moderate sled sprints, 10-20 yd${z ? `, ${z(0.25)}-${z(0.5)} (a load that slows him 25-50%)` : ", a load that slows him 25-50%"}: 4-6 reps`,
          "Resisted-to-free contrast: a sled rep, then the same run free",
          "Hill sprints or push-up starts to 20 yd",
          "Horizontal plyometrics: bounds, broad jumps, single-leg hops for distance",
        ],
        keep: (z) => ["One acceleration day a week: 4-6 runs of 15-20 yd", `A set of moderate sled sprints every week or two${z ? ` (${z(0.25)}-${z(0.5)})` : ""}`],
        cmj: ["relPeakPower", "relPropForce", "mrsi", "height"],
      },
      trans: {
        name: "Transition",
        what: "Rising from acceleration into upright running, 20-30 yd.",
        work: () => ["Build-ups: 20 yd building to near-top speed, 4-6 reps", "Wicket runs with spacing that lengthens through the run", "Sprints of 30 yd with posture cues (tall, hips under him)"],
        keep: () => ["A couple of 30-yd build-ups in the weekly speed work"],
        cmj: ["relPeakPower", "brakingRfd", "mrsi"],
      },
      maxv: {
        name: "Top speed",
        what: "Max velocity: stiff, quick ground contacts and front-side mechanics.",
        work: (z) => [
          "Fly sprints: a 20-30 yd build-up, then 10-20 yd at full speed, 3-5 reps with 3+ min rest",
          "Wicket runs at max-velocity spacing",
          `Light sled sprints${z ? `, ${z(0.05)}-${z(0.1)} (slows him 10% or less)` : ", slowing him 10% or less"}`,
          "Reactive plyometrics: pogos, hurdle hops, depth jumps (short contacts)",
          "Hamstring strength for top speed: Nordics, RDLs, isometric holds",
        ],
        keep: () => ["Once a week: 3-4 fly sprints at full speed", "Keep the hamstring work in (Nordics, RDLs) year round"],
        cmj: ["brakingRfd", "relBrakeForce", "brakePhase", "stiffness", "mrsi", "lrBraking"],
      },
    };
    // the CMJ numbers (the Hawkin force plate, his latest countermovement jump): what each tells about the sprint
    const CMJ = {
      relPropForce: { label: "Avg relative propulsive force", unit: "% BW", up: true, get: (t) => relOf(t, "Avg. Propulsive Force(N)"), why: "How hard he pushes the ground on the way up: horizontal force from a standstill goes with it." },
      relPeakProp: { label: "Peak relative propulsive force", unit: "% BW", up: true, get: (t) => relOf(t, "Peak Propulsive Force(N)"), why: "His top push: the first steps' force." },
      ttt: { label: "Time to takeoff", unit: "s", up: false, get: (t) => rawOf(t, "Time To Takeoff(s)"), why: "How quickly he can apply force: shorter is quicker." },
      mrsi: { label: "mRSI", unit: "", up: true, get: (t) => t.rsiModified, why: "Jump height for the time it took: explosiveness, at the start and at speed." },
      relPeakPower: { label: "Peak relative power", unit: "W/kg", up: true, get: (t) => t.relativePeakPower, why: "Power a kilogram of him: tracks acceleration and max sprint power." },
      height: { label: "Jump height", unit: "in", up: true, get: (t) => t.jumpHeight, why: "Overall lower-body power." },
      brakingRfd: { label: "Braking RFD", unit: "N/s", up: true, get: (t) => t.brakingRfd, why: "How fast he can take on force on the way down: stiff, quick contacts at speed." },
      relBrakeForce: { label: "Avg relative braking force", unit: "% BW", up: true, get: (t) => relOf(t, "Avg. Braking Force(N)"), why: "Eccentric strength: holding up at top-speed contacts." },
      brakePhase: { label: "Braking phase", unit: "s", up: false, get: (t) => rawOf(t, "Braking Phase(s)"), why: "Time spent stopping the dip: shorter goes with quicker ground contacts." },
      stiffness: { label: "Stiffness", unit: "N/m", up: true, get: (t) => rawOf(t, "Stiffness(N/m)"), why: "Leg spring: how little he gives on contact." },
      lrBraking: { label: "Left/right braking RFD difference", unit: "%", up: false, get: (t) => { const v = rawOf(t, "L|R Avg. Braking RFD(%)"); return v == null ? null : Math.abs(v); }, why: "A big left/right gap at top speed is a hamstring watch point." },
    };
    function rawOf(t, key) { const v = t && t.raw ? Number(t.raw[key]) : NaN; return Number.isFinite(v) ? v : null; }
    function relOf(t, key) { const v = rawOf(t, key); return v == null || !(t.systemWeight > 0) ? null : (v / t.systemWeight) * 100; } // as a share of body weight
    const isCmj = (t) => /counter ?movement|\bcmj\b/i.test(t.testType || "") && !/single|rebound/i.test(t.testType || "");

    function diagnosis(rec, fv, segs, topSeg) {
      const others = (opts.all ? opts.all() : []).filter((r) => r.athleteId !== athlete.id && r.unit === rec.unit && r.start === rec.start && (r.clock || "beam") === (rec.clock || "beam"))
        .map((r) => { const b = bestRep(r); if (!b) return null; const g = r.gates || []; return fvFrom(g.map((d, k) => ({ x: metersOf(r, d), t: repTimes(b, g)[k] })).filter((p) => p.t != null), r.clock !== "move"); }).filter(Boolean);
      const pctIn = (v, xs) => Math.round((xs.filter((x) => x < v).length / xs.length) * 100);
      const lines = [];
      let fP, vP, pP;
      if (others.length >= 5) {
        fP = pctIn(fv.F0, others.map((o) => o.F0)); vP = pctIn(fv.vmax, others.map((o) => o.vmax)); pP = pctIn(fv.Pmax, others.map((o) => o.Pmax));
        lines.push(`Among ${others.length} other athletes' ${startName(rec.start).toLowerCase()}s here: F0 in the ${ord(fP)} percentile, power in the ${ord(pP)}, top speed in the ${ord(vP)}.`);
      } else {
        // team-sport athletes usually sit about 7-9 N/kg, 8.5-10 m/s and 15-22 W/kg
        const scale = (v, lo, hi) => Math.max(0, Math.min(100, Math.round(((v - lo) / (hi - lo)) * 100)));
        fP = scale(fv.F0, 7, 9); vP = scale(fv.vmax, 8.5, 10); pP = scale(fv.Pmax, 15, 22);
        lines.push(`Against the usual range for team-sport athletes (F0 about 7-9 N/kg, top speed 8.5-10 m/s, power 15-22 W/kg): F0 ${fv.F0 < 7 ? "below it" : fv.F0 > 9 ? "above it" : "within it"}, top speed ${fv.vmax < 8.5 ? "below it" : fv.vmax > 10 ? "above it" : "within it"}, power ${fv.Pmax < 15 ? "below it" : fv.Pmax > 22 ? "above it" : "within it"}. (Ranked among our own athletes once five or more are tested the same way.)`);
      }
      if (fP - vP >= 25) lines.push("His force side is ahead of his velocity side: the start is the strength, top speed is what's holding him back.");
      else if (vP - fP >= 25) lines.push("His velocity side is ahead of his force side: he gets fast but takes too long getting there.");
      else lines.push("His force and velocity sides are about even.");
      // each segment against what his own profile says it should be (+ slower)
      const off = segs.map((s, k) => (s.time == null ? null : s.time - (fv.timeTo(metersOf(rec, s.to)) - (k ? fv.timeTo(metersOf(rec, s.from)) : fv.lag || 0))));
      const worst = off.reduce((b, o, k) => (o != null && (b < 0 || o > off[b]) ? k : b), -1);
      if (worst >= 0 && off[worst] > 0.03) lines.push(`Slowest against his own profile: ${segs[worst].from}-${segs[worst].to} ${rec.unit === "m" ? "m" : "yd"}, ${off[worst].toFixed(2)} s slower than the curve through his other splits.`);
      const stepSegs = segs.filter((s) => s.stepLen && s.rate);
      if (stepSegs.length >= 2) { const a = stepSegs[0], z = stepSegs[stepSegs.length - 1]; const la = Math.round(a.stepLen / 0.0254), lz = Math.round(z.stepLen / 0.0254); lines.push(`Step length ${Math.abs(lz - la) <= 1 ? `holds at about ${lz} in` : `${lz > la ? "grows" : "shrinks"} from ${la} to ${lz} in`} and step rate goes from ${a.rate.toFixed(2)} to ${z.rate.toFixed(2)} a second, first segment to last.`); }
      // the areas: a score from where he stands, less for a segment behind his own profile
      const segIn = (lo, hi) => segs.map((s, k) => ({ s, k })).filter(({ s }) => { const a = metersOf(rec, s.from), b = metersOf(rec, s.to); return b > lo && a < hi; });
      const behind = (list) => Math.max(0, ...list.map(({ k }) => off[k] || 0));
      const rate = (score, lag) => (score >= 67 && lag <= 0.02 ? "strong" : score <= 33 || lag > 0.04 ? "work" : "middle");
      const areas = [
        { key: "start", score: fP, lag: behind(segIn(0, 9.2)) },
        { key: "accel", score: pP, lag: behind(segIn(9, 18.5)) },
        ...(segs.some((s) => metersOf(rec, s.to) > 22 && metersOf(rec, s.from) < 28) ? [{ key: "trans", score: Math.round((pP + vP) / 2), lag: behind(segIn(18.5, 28)) }] : []),
        { key: "maxv", score: vP, lag: behind(segIn(27, 99)) },
      ].map((a) => ({ ...a, rating: rate(a.score, a.lag) }));
      // his sled loads for each zone, from his load-velocity profile (timed or measured), as lb on the sled
      const wLb = num(rec.weightLb) || opts.weightLb || null, P = resistedPoints(rec, wLb), lv = lvFrom(P.time.length >= P.speed.length ? P.time : P.speed);
      const zone = lv && !lv.bad && wLb ? (dec) => `${Math.round(((lv.L0 * dec) / 100) * wLb)} lb` : null;
      const RATING = { strong: "Strong", middle: "Middle", work: "Needs work" };
      const table = el("table", { class: "sa-table sa-areas" },
        el("thead", null, el("tr", null, el("th", null, "Area"), head("Where he stands"), el("th", null, "What to do"))),
        el("tbody", null, areas.map((a) => {
          const A = AREAS[a.key], list = (a.rating === "work" ? A.work(zone) : a.rating === "strong" ? A.keep(zone) : [A.keep(zone)[0], A.work(zone)[0]]).map((x) => x.replace(/(\d+) lb-(\d+) lb/g, "$1-$2 lb"));
          return el("tr", { class: `sa-area-${a.rating}` },
            el("td", null, el("b", null, A.name), el("div", { class: "sa-sub" }, A.what)),
            el("td", null, el("span", { class: `sa-rating ${a.rating}` }, RATING[a.rating]), el("div", { class: "sa-sub" }, `${ord(a.score)} percentile${a.lag > 0.03 ? `, ${a.lag.toFixed(2)} s behind his profile` : ""}`)),
            el("td", null, el("div", { class: "sa-sub" }, a.rating === "work" ? "To improve it:" : a.rating === "strong" ? "To keep it:" : "To keep it, and push it:"), el("ul", null, list.map((x) => el("li", null, x)))));
        })));
      return el("div", { class: "sa-diag" }, el("h4", null, "What it says"), lines.map((t) => el("p", null, t)), table,
        el("p", { class: "sa-hint" }, `Basic starting points, not a program: dose them around his throwing, lifting and season.${zone ? " Sled loads are from his load-velocity profile, for this sled on this surface." : " Add resisted sprints for sled loads worked out for him."}`),
        cmjBlock(areas));
    }

    // the CMJ numbers that go with his areas: his latest, where it ranks among the other athletes' latest, and the change
    // since his jump before
    function cmjBlock(areas) {
      const mine = (opts.forceTests ? opts.forceTests(athlete.id) : []).filter(isCmj).sort((a, b) => (a.date || "").localeCompare(b.date || ""));
      const order = ["work", "middle", "strong"], sorted = areas.slice().sort((a, b) => order.indexOf(a.rating) - order.indexOf(b.rating));
      const keys = [...new Set(sorted.flatMap((a) => AREAS[a.key].cmj))];
      const forArea = (k) => sorted.filter((a) => AREAS[a.key].cmj.includes(k)).map((a) => AREAS[a.key].name.replace(/ \(.*\)/, "").toLowerCase());
      const last = mine[mine.length - 1], prev = mine[mine.length - 2];
      const others = opts.latestCmjs ? opts.latestCmjs().filter((t) => String(t.athleteId) !== String(athlete.id)) : [];
      const fmt = (v, u) => (v == null ? "–" : u === "s" ? v.toFixed(3) : u === "N/s" || u === "N/m" ? Math.round(v).toLocaleString() : u === "" ? v.toFixed(2) : v.toFixed(1));
      const rows = keys.map((k) => {
        const M = CMJ[k], v = last ? M.get(last) : null, p = prev ? M.get(prev) : null;
        const pool = others.map((t) => M.get(t)).filter((x) => x != null && Number.isFinite(x));
        const rank = v != null && pool.length >= 5 ? Math.round((pool.filter((x) => (M.up ? x < v : x > v)).length / pool.length) * 100) : null;
        const d = v != null && p != null ? v - p : null, better = d == null || d === 0 ? null : (d > 0) === M.up;
        return el("tr", null,
          el("td", null, el("b", null, M.label), el("div", { class: "sa-sub" }, M.why)),
          el("td", null, v == null ? "–" : `${fmt(v, M.unit)}${M.unit ? ` ${M.unit}` : ""}`),
          el("td", null, rank == null ? "–" : ord(rank)),
          el("td", { class: better == null ? "" : better ? "sa-better" : "sa-worse" }, d == null ? "–" : `${d > 0 ? "+" : "−"}${fmt(Math.abs(d), M.unit)}`),
          el("td", null, forArea(k).join(", ")));
      });
      return el("div", { class: "sa-cmj" },
        el("h4", null, "CMJ numbers to keep an eye on ", el("small", null, last ? `his latest force plate CMJ, ${last.date}${prev ? `, against ${prev.date}` : ""}` : "no force plate CMJ for him yet")),
        el("div", { class: "sa-scroll" }, el("table", { class: "sa-table" },
          el("thead", null, el("tr", null, ["Metric", "His latest", "Among our athletes", "Since the jump before", "Goes with"].map(head))),
          el("tbody", null, rows))),
        el("p", { class: "sa-hint" }, "The ones that tend to go with the areas above, the areas that need work first. They're signs to watch, not causes: a CMJ is vertical and slower than a sprint step, so watch them move with the sprint numbers over time. Percentiles are among our other athletes' latest CMJs (higher is better for him, whichever way the number runs)."));
    }

    render();
    return { refresh: render };
  }

  window.SprintAssessment = { mount, lib: { fvFrom, lvFrom, segmentsOf, bestRep, trackSteps } };
})();
