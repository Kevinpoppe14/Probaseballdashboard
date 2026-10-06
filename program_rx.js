// Program prescription logic shared by the coach dashboard (index.html / periodization.js) and the athlete
// phone page (athlete.html). Plain JavaScript, no JSX, so the phone page can load it without Babel.
(function () {
  // Superset labels for a session's exercises: A1, A2, B1... An exercise marked `linked` joins the group of the
  // exercise above it; any other exercise starts the next letter.
  function exerciseLabels(exercises) {
    let group = -1, n = 0;
    return (exercises || []).map((e, i) => {
      if (i > 0 && e.linked) n += 1;
      else { group += 1; n = 1; }
      const letter = (group >= 26 ? String.fromCharCode(64 + Math.floor(group / 26)) : "") + String.fromCharCode(65 + (group % 26));
      return `${letter}${n}.`;
    });
  }
  window.exerciseLabels = exerciseLabels;

  // ---- exercise prescription ---------------------------------------------------------------------
  // An exercise is prescribed as one or more set groups, each { sets, reps, intensity }, with one intensity unit for
  // the exercise (%, RIR or RPE). It reads "5 (50%)  3 (60%)  3x1 (70%)": reps, or sets x reps, then the intensity.
  // The weight itself is never part of the program; the athlete writes it in when doing the work.
  // Older programs stored a single sets / reps / load per exercise; normalize() turns those into one set group.
  const ProgramRx = {
    UNITS: ["%", "RIR", "RPE", ""],
    normalize(e) {
      if (Array.isArray(e.groups)) return e;
      const { sets, reps, load, loadUnit, ...rest } = e;
      const pct = loadUnit === "% 1RM" || loadUnit === "RPE";
      return { ...rest, tempo: e.tempo || "", intensityUnit: loadUnit === "RPE" ? "RPE" : "%", groups: [{ sets: sets || "", reps: reps || "", intensity: pct ? load || "" : "" }] };
    },
    groups(e) {
      return ProgramRx.normalize(e).groups.filter((g) => `${g.sets || ""}${g.reps || ""}`.trim());
    },
    intensityText(e, g) {
      const v = `${g.intensity || ""}`.trim();
      if (!v) return "";
      const unit = ProgramRx.normalize(e).intensityUnit;
      if (unit === "%") return `${v.replace(/%$/, "")}%`;
      if (unit === "RIR") return `${v} RIR`;
      if (unit === "RPE") return `RPE ${v}`;
      return ""; // "No intensity": nothing shown even if a number was typed earlier
    },
    // just the sets and reps of one group: "5", or "3x1" for three sets of one
    repsText(g) {
      const sets = `${g.sets || ""}`.trim(), reps = `${g.reps || ""}`.trim();
      return sets && sets !== "1" ? (reps ? `${sets}x${reps}` : `${sets} sets`) : reps;
    },
    groupText(e, g) {
      const base = ProgramRx.repsText(g);
      const int = ProgramRx.intensityText(e, g);
      return `${base}${int ? ` (${int})` : ""}`;
    },
    text(e) {
      return ProgramRx.groups(e).map((g) => ProgramRx.groupText(e, g)).join("  ");
    },
    // where an athlete's written-in weight for one set group is kept
    logKey: (e, gi) => `${e.id}|${gi}`,
    // "BM" (Beast Mode) or "TF" (Technical Failure) in the reps box means the set goes to failure; "-E" is each
    // side. The athlete then writes in the reps they got as well as the weight.
    failure(g) {
      const m = /\b(BM|TF)(\s*-\s*E)?\b/i.exec(`${(g || {}).reps || ""}`);
      return m ? { kind: m[1].toUpperCase(), each: !!m[2] } : null;
    },
    repsLogKey: (e, gi) => `${e.id}|${gi}|r`,
    // The reps-to-failure -> % of 1RM chart. The dashboard reads it from the store; the phone page replaces
    // this with the chart it was sent.
    chart: () => (window.AthleteStore && window.AthleteStore.getRmChart ? window.AthleteStore.getRmChart() : {}),
    // 1RM estimated from a set to failure: the weight divided by the chart's % for that many reps, to the nearest 5.
    estimate1RM(weight, reps) {
      const w = parseFloat(weight), r = parseInt(reps, 10);
      const pct = parseFloat(ProgramRx.chart()[Math.min(r, 17)]); // the chart's last row is "17 or more"
      if (!(w > 0) || !(r > 0) || !(pct > 0)) return null;
      return Math.round(w / (pct / 100) / 5) * 5;
    },
    // weight for a % set once a max is known, to the nearest 5
    weightAt(max, g) {
      const pct = parseFloat(`${(g || {}).intensity || ""}`);
      return max > 0 && pct > 0 ? Math.round((max * pct) / 100 / 5) * 5 : null;
    },
  };
  window.ProgramRx = ProgramRx;

  // An athlete's estimated maxes from the failure sets logged on their plan, in the order the sets fall on the
  // plan (plan week, then day). `latest` is the newest estimate per exercise; `before(name, week, day)` is the
  // newest one from an earlier day, which is what fills in the weights for the % sets that follow it. So each
  // new failure set re-works the weights from the next session on, and leaves the earlier ones alone.
  // `programById` looks a program up by id; `plan.programLog[programId][key]` holds what has been logged.
  function planMaxes(plan, programById) {
    const sets = [];
    ((plan || {}).blocks || []).filter((b) => b.programId).forEach((b) => {
      const program = programById(b.programId);
      const log = ((plan.programLog || {})[b.programId]) || {};
      if (!program) return;
      (program.weeks || []).forEach((w, wi) => (w.sessions || []).forEach((s, si) => (s.exercises || []).forEach((e) => {
        const name = (e.name || "").trim();
        if (!name) return;
        ProgramRx.groups(e).forEach((g, gi) => {
          const reps = log[ProgramRx.repsLogKey(e, gi)];
          if (!ProgramRx.failure(g) || !reps) return;
          sets.push({ key: name.toLowerCase(), name, e, g, weight: log[ProgramRx.logKey(e, gi)], reps, pos: (b.start + wi) * 100 + si });
        });
      })));
    });
    sets.sort((a, b) => a.pos - b.pos);
    const all = [];
    const find = (key, pos) => {
      let found = null;
      all.forEach((m) => { if (m.key === key && m.pos < pos) found = m; });
      return found;
    };
    // A failure set done at its filled-in weight (only the reps typed) counts at that weight.
    sets.forEach((s) => {
      const prev = find(s.key, s.pos);
      const auto = prev && ProgramRx.normalize(s.e).intensityUnit === "%" ? ProgramRx.weightAt(prev.value, s.g) : null;
      const weight = s.weight || (auto ? `${auto}` : "");
      const value = ProgramRx.estimate1RM(weight, s.reps);
      if (value) all.push({ key: s.key, name: s.name, value, weight, reps: s.reps, pos: s.pos });
    });
    const latest = {};
    all.forEach((m) => { latest[m.key] = m; });
    const before = (name, week, day) => find((name || "").trim().toLowerCase(), week * 100 + day);
    return { latest, before };
  }
  window.planMaxes = planMaxes;

  // An exercise video link as something that can be embedded (YouTube incl. Shorts, Vimeo).
  window.videoEmbedOf = function (url) {
    const u = (url || "").trim();
    let m = u.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{6,})/i);
    if (m) return { src: `https://www.youtube.com/embed/${m[1]}`, vertical: /\/shorts\//i.test(u) };
    m = u.match(/vimeo\.com\/(?:video\/)?(\d+)/i);
    if (m) return { src: `https://player.vimeo.com/video/${m[1]}`, vertical: false };
    return null;
  };
})();
