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
    // Extra boxes a coach added to an exercise with the builder's "+" (Time, Distance, or one they named):
    // `e.extras` is [{ label, value }]. The ones filled in, as "Time 0:30 · Distance 40 yd".
    extras: (e) => (Array.isArray((e || {}).extras) ? e.extras : []).filter((x) => x && `${x.value || ""}`.trim()),
    extrasText: (e) => ProgramRx.extras(e).map((x) => `${(x.label || "").trim()} ${`${x.value}`.trim()}`.trim()).join(" · "),
    // where an athlete's written-in weight for one set group is kept
    logKey: (e, gi) => `${e.id}|${gi}`,
    // "BM" (Beast Mode) or "TF" (Technical Failure) in the reps box means the set goes to failure; "-E" is each
    // side. The athlete then writes in the reps they got as well as the weight.
    failure(g) {
      const m = /\b(BM|TF)(\s*-\s*E)?\b/i.exec(`${(g || {}).reps || ""}`);
      return m ? { kind: m[1].toUpperCase(), each: !!m[2] } : null;
    },
    repsLogKey: (e, gi) => `${e.id}|${gi}|r`,
    // ---- EDT blocks and accumulated isometrics ----
    // a time in a reps box or a note, in seconds: "3 MIN", "3:00 total", "45 SEC", "3 x 10 SEC" (10); else null
    seconds(text) {
      const t = `${text || ""}`;
      let m = /(\d+):(\d{2})/.exec(t);
      if (m) return Number(m[1]) * 60 + Number(m[2]);
      m = /(\d+(?:\.\d+)?)\s*(?:s|sec|secs|second|seconds)\b/i.exec(t);
      if (m) return Math.round(Number(m[1]));
      m = /(\d+(?:\.\d+)?)\s*(?:m|min|mins|minute|minutes)\b/i.exec(t);
      return m ? Math.round(Number(m[1]) * 60) : null;
    },
    // done each side: "8E", "30 SEC E", "5-E", "each", "/side"
    sided: (text) => /(?:-\s*E\b|\dE\b|\sE\s*$|\beach\b|\/\s*side\b|\bper side\b)/i.test(`${text || ""}`.trim()),
    // EDT: the block's exercises (A1, A2...) are done back to back for a set time, and the athlete logs how many
    // times through they got. Set in the program builder on the block's first exercise (`e.edt`, minutes; 0 turns
    // it off), or written in its notes as "EDT 10 min" / "EDT - 15 MIN". The minutes, or null.
    edtMinutes(e) {
      const x = e || {};
      if (x.edt === 0) return null;
      const n = parseFloat(x.edt);
      if (n > 0) return n;
      const m = /\bEDT\b\s*[-–—:]?\s*(\d+(?:\.\d+)?)\s*(?:m|min|mins|minutes)\b/i.exec(`${x.name || ""} ${x.notes || ""}`);
      return m ? Number(m[1]) : null;
    },
    // what the builder's EDT / Accumulate settings add to a printed or listed exercise, when its notes don't
    // already say it: "EDT 10 min", "Accumulate time"
    tagText(e) {
      const x = e || {}, notes = `${x.notes || ""}`;
      return [
        parseFloat(x.edt) > 0 && !/\bEDT\b/i.test(notes) ? `EDT ${parseFloat(x.edt)} min` : "",
        x.accumulate === true && !/accumulat/i.test(notes) ? "Accumulate time" : "",
      ].filter(Boolean).join(" · ");
    },
    // where the sets for an EDT block are logged, on the exercise with the EDT note: a set group slot no exercise
    // has, so it passes the phone link's key check (migration_007)
    edtKey: (e) => `${e.id}|99|r`,
    // Accumulated time: hold, rest when the hold breaks, go again until the time is used up, and log the sets it
    // took (each side, on a sided one). Set in the program builder (`e.accumulate`: true, or false to turn it off),
    // and on by itself for an isometric longer than a minute ("Push-Up Extreme Iso 1x3 MIN"). The time is the
    // reps box. Its seconds, or null. The sets go in the group's reps slot: "4", or "L3 R4".
    accumulated(e, g) {
      const x = e || {};
      if (x.accumulate === false) return null;
      const s = ProgramRx.seconds((g || {}).reps);
      if (x.accumulate === true) return s || null;
      if (!/\biso(?:metric)?s?\b/i.test(x.name || "")) return null;
      return s && s > 60 ? s : null;
    },
    accSets(value) {
      const t = `${value || ""}`, l = /L\s*(\d+)/i.exec(t), r = /R\s*(\d+)/i.exec(t);
      return l || r ? { l: l ? l[1] : "", r: r ? r[1] : "" } : { one: (/\d+/.exec(t) || [""])[0] };
    },
    accValue: (sets) => (sets.one != null ? `${sets.one || ""}` : [sets.l ? `L${sets.l}` : "", sets.r ? `R${sets.r}` : ""].filter(Boolean).join(" ")),
    // how a logged set reads in a summary: "135 x 5", or "4 sets" / "L 3 · R 4 sets" for an accumulated iso
    loggedText(e, g, weight, reps) {
      if (ProgramRx.accumulated(e, g) && reps) {
        const s = ProgramRx.accSets(reps);
        const sets = s.one != null ? `${s.one} sets` : `${[s.l ? `L ${s.l}` : "", s.r ? `R ${s.r}` : ""].filter(Boolean).join(" · ")} sets`;
        return weight ? `${weight} · ${sets}` : sets;
      }
      return weight || reps ? `${weight || "?"}${reps ? ` x ${reps}` : ""}` : "";
    },
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

  // The same lift under another name: the exercise library's "Also called" names (typed in, or from merging two
  // exercises) make Hex Bar Deadlift and Trap Bar Deadlift, say, one lift for estimated maxes, top weights and
  // last-time weights. liftKey(name) is the name a lift is tracked under: the library exercise it belongs to, or
  // the name itself. The dashboard looks it up in its library (AthleteStore); the phone page is told with
  // setLiftNames([{ name, canon }]) from what its page data says.
  // Exercise names are compared ignoring case, spaces, hyphens and punctuation everywhere they link (the library,
  // videos, lifts), so "Push-up", "Push up" and "Pushup" are one name. Plurals and other wordings are what
  // "Also called" names are for. (The database does the same in athlete_portal_get, migration_019.)
  const normName = (n) => String(n || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  window.exerciseNameKey = normName;
  const liftNames = new Map(), liftCache = new Map();
  ProgramRx.setLiftNames = (list) => {
    (list || []).forEach((x) => { if (x && x.name && x.canon) liftNames.set(normName(x.name), normName(x.canon)); });
    liftCache.clear();
  };
  ProgramRx.liftKey = (name) => {
    const k = normName(name);
    if (!k || liftNames.has(k)) return liftNames.get(k) || k;
    if (liftCache.has(k)) return liftCache.get(k);
    const S = window.AthleteStore;
    const found = S && S.findExerciseByName ? S.findExerciseByName(name) : null;
    const key = found && found.name ? normName(found.name) : k;
    if (S && S.allExercises && S.allExercises().length) liftCache.set(k, key); // (not before the library has loaded)
    return key;
  };

  // An athlete's estimated maxes from the failure sets logged on their plan, in the order the sets fall on the
  // plan (plan week, then day). `latest` is the newest estimate per exercise; `before(name, week, day)` is the
  // newest one from an earlier day, which is what fills in the weights for the % sets that follow it. So each
  // new failure set re-works the weights from the next session on, and leaves the earlier ones alone. `all` is
  // every estimate in that order ({ key, name, value, weight, reps, pos }, pos = plan week * 100 + day).
  // `programById` looks a program up by id; `plan.programLog[programId][key]` holds what has been logged.
  // Until a lift has a failure set, its % sets are filled from a training max instead: the weight logged on the
  // heaviest % set of the latest earlier day, divided by its % (60 lb at 60% is a training max of 100, so a 65% set
  // gets 65). `before` hands that back with `tm: true` ({ key, name, value, weight, pct, pos, tm }) when there is no
  // failure-set estimate yet; `tms` is every one of them.
  function planMaxes(plan, programById) {
    const sets = [], pctSets = {};
    ((plan || {}).blocks || []).filter((b) => b.programId).forEach((b) => {
      const program = programById(b.programId);
      const log = ((plan.programLog || {})[b.programId]) || {};
      if (!program) return;
      (program.weeks || []).forEach((w, wi) => (w.sessions || []).forEach((s, si) => (s.exercises || []).forEach((e) => {
        const name = (e.name || "").trim();
        if (!name) return;
        const pctUnit = ProgramRx.normalize(e).intensityUnit === "%";
        ProgramRx.groups(e).forEach((g, gi) => {
          const reps = log[ProgramRx.repsLogKey(e, gi)], pos = (b.start + wi) * 100 + si, key = ProgramRx.liftKey(name);
          const w = parseFloat(log[ProgramRx.logKey(e, gi)]), pct = pctUnit ? parseFloat(g.intensity) : NaN;
          if (!ProgramRx.failure(g) && w > 0 && pct > 0 && pct <= 100) { // a % set's weight, toward a training max
            const id = `${key}@${pos}`, had = pctSets[id];
            if (!had || pct > had.pct || (pct === had.pct && w > had.weight)) pctSets[id] = { key, name, value: Math.round(w / (pct / 100)), weight: w, pct, pos, tm: true };
          }
          if (!ProgramRx.failure(g) || !reps) return;
          sets.push({ key, name, e, g, weight: log[ProgramRx.logKey(e, gi)], reps, pos });
        });
      })));
    });
    sets.sort((a, b) => a.pos - b.pos);
    const tms = Object.values(pctSets).sort((a, b) => a.pos - b.pos);
    const findTm = (key, pos) => {
      let found = null;
      tms.forEach((m) => { if (m.key === key && m.pos < pos) found = m; });
      return found;
    };
    const all = [];
    const find = (key, pos) => {
      let found = null;
      all.forEach((m) => { if (m.key === key && m.pos < pos) found = m; });
      return found;
    };
    // A failure set done at its filled-in weight (only the reps typed) counts at that weight.
    sets.forEach((s) => {
      const prev = find(s.key, s.pos) || findTm(s.key, s.pos);
      const auto = prev && ProgramRx.normalize(s.e).intensityUnit === "%" ? ProgramRx.weightAt(prev.value, s.g) : null;
      const weight = s.weight || (auto ? `${auto}` : "");
      const value = ProgramRx.estimate1RM(weight, s.reps);
      if (value) all.push({ key: s.key, name: s.name, value, weight, reps: s.reps, pos: s.pos });
    });
    const latest = {};
    all.forEach((m) => { latest[m.key] = m; });
    const before = (name, week, day) => { const k = ProgramRx.liftKey(name), p = week * 100 + day; return find(k, p) || findTm(k, p); };
    return { latest, before, all, tms };
  }
  window.planMaxes = planMaxes;

  // A program as one athlete does it: `overrides` (exercise id -> { name, groups }) are the changes the athlete
  // made on their phone to an exercise or its sets and reps. The program itself is left alone. A changed
  // exercise keeps its id (so what was logged stays with it) and carries `_coach`, what the coach prescribed.
  function applyOverrides(program, overrides) {
    if (!program || !overrides || !Object.keys(overrides).length) return program;
    return {
      ...program,
      weeks: (program.weeks || []).map((w) => ({
        ...w,
        sessions: (w.sessions || []).map((s) => ({
          ...s,
          exercises: (s.exercises || []).map((e) => {
            const o = overrides[e.id];
            if (!o || !(o.name || "").trim()) return e;
            const base = ProgramRx.normalize(e);
            return { ...base, name: o.name, groups: Array.isArray(o.groups) && o.groups.length ? o.groups : base.groups, _coach: { name: e.name, text: ProgramRx.text(e), at: o._at || null } };
          }),
        })),
      })),
    };
  }
  window.applyOverrides = applyOverrides;

  // A small one-week program made when a session is sent to one athlete's app: a group speed session from Coach
  // Mode ("gspeed-...") or a quick strength session from a coach's app ("gstrength-...", quick_assign.js). There
  // is one per athlete per week; they are reached from the athlete's plan and kept out of the program library.
  window.isSentProgram = (id) => /^g(speed|strength)-/.test(String(id || ""));

  // The plan row a program goes in when it's assigned, which is also the label the athlete's app shows for it:
  // a speed-layout program, or one in a Speed folder, goes in Speed; an arm care program (an Arm Care folder, or
  // "Arm Care" in its name) in Arm Care; a Throwing folder in Throwing; a Re-Ed or
  // Correctives folder in the plan's own Re-Ed / Correctives row if it has one (else "Re-Education"); anything else
  // in Strength. `laneNames` are the rows already on the plan, so an existing row is used rather than a near copy.
  window.programLaneName = (program, laneNames) => {
    const p = program || {}, names = laneNames || [];
    const top = String(p.folder || "").split("/")[0];
    const kinds = [
      { name: "Speed", is: () => (window.isSpeedProgram && window.isSpeedProgram(p)) || /speed|sprint/i.test(top), row: /^speed/i },
      { name: "Arm Care", is: () => /arm\s*care/i.test(`${p.folder || ""} ${p.name || ""}`), row: /arm\s*care/i },
      { name: "Throwing", is: () => /throw/i.test(top), row: /throw/i },
      { name: "Re-Education", is: () => /re-?ed|correct|rehab/i.test(top), row: /re-?ed|correct/i },
      { name: "Strength", is: () => true, row: /^strength$/i },
    ];
    const k = kinds.find((x) => x.is());
    return names.find((n) => k.row.test(String(n || "").trim())) || k.name;
  };

  // ---- the speed layout (speed_builder.js) ------------------------------------------------------------
  // A speed program is laid out in sections (Warm-up, Plyometrics, Speed / Agility...), each with its time, and
  // inside a section, series (Acceleration Series - Prowler) holding drills, instead of A1/A2 supersets. Each drill
  // is an ordinary exercise with `section`, optionally `series`, its sets and reps in its one set group, `distance`
  // (a distance or a time for each rep: "10 yd", "120 ft", "30 m", "6 s", "1:00") and `extras` (boxes added with
  // the builder's "+", Time, Height..., each with an optional target, that the athlete fills in in the app). The day keeps its sections' order and times, and an optional description shown at the top of the section in the app, in `sections` ([{ name, time, description }]).
  window.isSpeedSession = (s) => !!s && (s.exercises || []).some((e) => e && e.section);
  window.isSpeedProgram = (p) => !!p && (p.layout === "speed" || (p.weeks || []).some((w) => (w.sessions || []).some(window.isSpeedSession)));
  // "10 yd", "120 feet", "30m", "40 meters", "@7yds", "6 s", "6 seconds", "2 min", "1:30" -> { yards } or { seconds },
  // or null. A bare number counts as yards.
  window.speedParse = (text) => {
    const t = String(text || "").trim().toLowerCase().replace(/^@\s*/, "");
    let m = /^(\d+):(\d{1,2})$/.exec(t);
    if (m) return { seconds: Number(m[1]) * 60 + Number(m[2]) };
    m = /^(\d+(?:\.\d+)?)\s*([a-z'"]*)/.exec(t);
    if (!m) return null;
    const n = Number(m[1]), u = m[2];
    if (/^(s|sec|secs|second|seconds)$/.test(u)) return { seconds: n };
    if (/^(min|mins|minute|minutes)$/.test(u)) return { seconds: n * 60 };
    if (/^(ft|feet|foot|')$/.test(u)) return { yards: n / 3 };
    if (/^(m|meter|meters|metre|metres)$/.test(u)) return { yards: n * 1.09361 };
    if (/^(mi|mile|miles)$/.test(u)) return { yards: n * 1760 };
    if (/^(|y|yd|yds|yard|yards)$/.test(u)) return { yards: n };
    return null;
  };
  // a drill's whole amount: sets x reps x its distance (or time) per rep -> { reps, yards, seconds }
  window.speedAmount = (e) => {
    const g = ((e && e.groups) || [])[0] || {};
    const sets = parseFloat(g.sets) || 1, reps = parseFloat(g.reps) || 1, per = window.speedParse(e && e.distance);
    const count = sets * reps;
    return { reps: `${g.sets || ""}${g.reps || ""}`.trim() ? count : 0, yards: per && per.yards ? count * per.yards : 0, seconds: per && per.seconds ? count * per.seconds : 0 };
  };
  // how a drill reads in the app and Coach Mode: "3 × 4 reps @ 10 yd", "2 × 6 s", "120 ft"
  window.speedText = (e) => {
    const g = ((e && e.groups) || [])[0] || {};
    const sets = `${g.sets || ""}`.trim(), reps = `${g.reps || ""}`.trim(), dist = `${(e && e.distance) || ""}`.trim().replace(/^@\s*/, "");
    const word = (r) => `${r}${/^\d+$/.test(r) ? (r === "1" ? " rep" : " reps") : ""}`;
    const count = sets && reps ? `${sets} × ${word(reps)}` : sets ? (dist ? `${sets} ×` : `${sets} sets`) : reps ? word(reps) : "";
    return [count, dist ? (sets && !reps ? dist : count ? `@ ${dist}` : dist) : ""].filter(Boolean).join(" ");
  };
  // a drill made before `distance` existed kept its distance in the reps box ("@7yds"): moved to `distance`
  window.speedNormalize = (e) => {
    const g = ((e && e.groups) || [])[0];
    if (!e || !g || `${e.distance || ""}`.trim()) return e;
    const r = `${g.reps || ""}`.trim();
    if (/^\d+\s*reps?$/i.test(r)) g.reps = r.replace(/\D+$/, "");
    else if (/^@/.test(r) || (window.speedParse(r) && !/^\d+$/.test(r))) { e.distance = r.replace(/^@\s*/, ""); g.reps = ""; }
    return e;
  };
  // a day's sections in order, each with its time and its drills in series: [{ name, time, series: [{ name, drills: [{ e, index }] }] }]
  window.speedSections = (s) => {
    const xs = (s && s.exercises) || [];
    const order = ((s && s.sections) || []).map((x) => x.name);
    xs.forEach((e) => { const n = e.section || "Other"; if (!order.includes(n)) order.push(n); });
    return order.map((name) => {
      const series = [];
      xs.forEach((e, index) => {
        if ((e.section || "Other") !== name) return;
        const last = series[series.length - 1];
        if (last && last.name === (e.series || "")) last.drills.push({ e, index });
        else series.push({ name: e.series || "", drills: [{ e, index }] });
      });
      const own = ((s && s.sections) || []).find((x) => x.name === name) || {};
      return { name, time: own.time || "", description: own.description || "", series };
    });
  };

  // An exercise video link as something that can be embedded (YouTube incl. Shorts, Vimeo), or a clip a coach
  // filmed or uploaded ({ file: true }: played in a <video> rather than a frame).
  window.videoEmbedOf = function (url) {
    const u = (url || "").trim();
    if (ExerciseVideo.isFile(u)) return { src: u, file: true, vertical: false };
    let m = u.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{6,})/i);
    if (m) return { src: `https://www.youtube.com/embed/${m[1]}`, vertical: /\/shorts\//i.test(u) };
    m = u.match(/vimeo\.com\/(?:video\/)?(\d+)/i);
    if (m) return { src: `https://player.vimeo.com/video/${m[1]}`, vertical: false };
    return null;
  };

  // Exercise videos coaches film on their phone or upload, kept in the "exercise-videos" storage bucket
  // (supabase/migration_015_exercise_videos.sql). Uploading needs a signed-in staff account. A clip is tied to
  // the exercise by name through the exercise library, so it plays wherever that exercise is programmed.
  const ExerciseVideo = {
    BUCKET: "exercise-videos",
    MAX_MB: 50,
    // Every row of the exercise library (signed in). The database hands back at most 1,000 rows per request and
    // the library is bigger than that, so it is read a page at a time.
    async readLibrary(columns) {
      const sb = window.supabaseClient, rows = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await sb.from("exercises").select(columns).order("id").range(from, from + 999);
        if (error) throw error;
        rows.push(...(data || []));
        if (!data || data.length < 1000) return rows;
      }
    },
    isFile: (url) => /\/storage\/v1\/object\/public\/exercise-videos\//i.test(url || "") || /\.(mp4|m4v|mov|webm)(?:[?#]|$)/i.test(url || ""),
    // stores the clip and returns its address; throws an Error whose message can be shown as it is
    async upload(file, name) {
      if (!file || !/^video\//i.test(file.type || "video/")) throw new Error("That isn't a video. Film or pick a video clip.");
      const mb = file.size / 1048576;
      if (mb > ExerciseVideo.MAX_MB) throw new Error(`That clip is ${Math.round(mb)} MB. Keep it under ${ExerciseVideo.MAX_MB} MB (about 20 seconds) and try again.`);
      const sb = window.supabaseClient;
      const ext = ((file.name || "").match(/\.(\w{2,4})$/) || [])[1] || (/quicktime/i.test(file.type) ? "mov" : /webm/i.test(file.type) ? "webm" : "mp4");
      const slug = (name || "exercise").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "exercise";
      const path = `${slug}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${ext.toLowerCase()}`;
      const { error } = await sb.storage.from(ExerciseVideo.BUCKET).upload(path, file, { contentType: file.type || "video/mp4", cacheControl: "31536000", upsert: false });
      if (error) throw new Error(/row-level security|unauthorized|jwt/i.test(error.message || "") ? "Sign in with your dashboard account to add videos." : "Could not upload the video. Check your connection and try again.");
      return sb.storage.from(ExerciseVideo.BUCKET).getPublicUrl(path).data.publicUrl;
    },
    // The library row ({ id, data }) for the exercise called `name`, or one that has that name merged into it (its
    // `aliases`); null when there is none. Throws when the library can't be reached.
    async find(name) {
      const sb = window.supabaseClient;
      const key = normName(name);
      if (!key) return null;
      const same = (n) => normName(n) === key;
      const { data, error } = await sb.from("exercises").select("id,data").ilike("data->>name", (name || "").trim().replace(/[\\%_]/g, "\\$&"));
      if (error) throw error;
      const exact = (data || []).find((r) => same((r.data || {}).name));
      if (exact) return exact;
      // not under that exact wording: look through every name and other name (just the names, a page at a time),
      // compared ignoring spaces and punctuation, then fetch that row
      const names = await ExerciseVideo.readLibrary("id,name:data->>name,aliases:data->aliases");
      const hit = names.find((r) => same(r.name) || (Array.isArray(r.aliases) ? r.aliases : []).some(same));
      if (!hit) return null;
      const { data: row, error: rowError } = await sb.from("exercises").select("id,data").eq("id", hit.id).maybeSingle();
      if (rowError) throw rowError;
      return row || null;
    },
    // Makes `url` the video of the library exercise called `name`, adding the exercise to the library if it isn't
    // there (with no video, when `url` is empty). An exercise that already has a video keeps it unless `replace`.
    // Returns the library entry's data.
    async attach(name, url, replace) {
      const sb = window.supabaseClient;
      const clean = (name || "").trim();
      let row;
      try { row = await ExerciseVideo.find(clean); } catch (e) { throw new Error("Could not reach the exercise library. Check your connection and try again."); }
      if (row && (row.data.videoUrl || !url) && !replace) return row.data;
      const id = row ? row.id : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const data = row
        ? { ...row.data, videoUrl: url }
        : { name: clean, videoUrl: url, tier: "", pattern: "", region: "", laterality: "", equipment: [], tags: [], cues: "" };
      const { error: saveError } = await sb.from("exercises").upsert({ id, data });
      if (saveError) throw new Error(url ? "The video uploaded, but it could not be added to the exercise library. Try again." : "Could not add it to the exercise library. Try again.");
      return data;
    },
  };
  window.ExerciseVideo = ExerciseVideo;
})();

// ---- Equipment check (remote athletes) ---------------------------------------------------------------
// What an exercise needs, and whether an athlete training remotely has it. An exercise needs everything ticked
// under "Equipment Needed" on its exercise-library entry, plus anything its name says ("KB Swing" -> Kettlebell,
// "BB Bench Press" -> Barbell and Bench). So "Back Squat", which names no equipment, is flagged for a barbell
// once Barbell is ticked on its library entry. Bodyweight never counts as something to own.
(function () {
  // Every kind of equipment an exercise can need and an athlete can have, grouped by type for the checklists.
  const GROUPS = [
    { name: "Bar Type", items: ["Barbell", "Safety Bar / Transformer Bar", "Trap Bar", "EZ Bar", "PVC"] },
    { name: "Free Weights", items: ["Dumbbell", "Kettlebell", "Plate", "Med Ball", "Club", "Sledgehammer"] },
    { name: "Racks, Benches and Boxes", items: ["Rack", "Bench", "Box", "Pull-Up Bar", "GHR", "Landmine"] },
    { name: "Machines and Cables", items: ["Cable", "Machine", "Jammer", "Bike", "Rower", "Sled"] },
    { name: "Bands, Balls and Accessories", items: ["Band", "Physio Ball", "Suspension Trainer", "Slideboard", "Hurdles", "Foam Roller", "Airex Pad", "Slant Board"] },
    { name: "Specialty Equipment", items: ["Keiser", "Belt Squat", "Supercat", "Flywheel", "SSL", "Tindeq", "Power Ball", "Reflex Bar / Shoulder Tube / Body Blade", "Rice Bucket"] },
    // places to train, ticked the same way; nothing in an exercise name is read as one of these, so an exercise
    // only needs a space when it is ticked under Equipment Needed on its library entry
    { name: "Spaces", items: ["Open Field", "Indoor Turf", "Track", "Basketball Court"] },
  ];
  const LIST = GROUPS.reduce((all, g) => all.concat(g.items), []);
  // how an item reads on a checklist, where that says more than its stored name
  const LABELS = { "Trap Bar": "Trap Bar / Hex Bar", "Physio Ball": "Physio / Swiss Ball" };
  const label = (q) => LABELS[q] || q;
  // what a name gives away: abbreviations and plain words
  const FROM_NAME = [
    ["Barbell", /\bBB\b|barbell|\bLM\b|land\s*mine/i], // a landmine needs a barbell in it
    ["Dumbbell", /\bDBs?\b|dumb\s*bell/i],
    ["Kettlebell", /\bKBs?\b|kettle\s*bell/i],
    // a safety bar or a transformer bar does the job; a plain barbell does not
    ["Safety Bar / Transformer Bar", /\bSSB\b|safety\s*(squat\s*)?bar|transformer\s*bar/i],
    ["Trap Bar", /\bTBDL\b|\btrap\s*bar\b|\bhex\s*bar\b/i],
    ["EZ Bar", /\bEZ\b/i],
    ["Plate", /\bplates?\b/i],
    ["Rack", /^\s*rack\b|\brack\s*pull|\bstrap\s+rack\b/i], // a rack to set up in; not the "front rack" or "rack carry" position
    ["Bench", /\bbench\b/i],
    ["Box", /(?<!shin\s)\bbox\b|depth\s*(drop|jump)/i], // not the "shin box" position
    ["Pull-Up Bar", /pull-?\s?ups?\b|chin-?\s?ups?\b|\bhanging\b/i],
    // a landmine belt squat only needs the barbell (wedged in a corner will do), not a landmine attachment
    ["Landmine", /^(?!.*belt\s*squat).*(\bLM\b|land\s*mine)/i],
    ["Cable", /\bcable\b/i],
    ["Keiser", /\bkeiser\b/i], // its own specialty item, not a cable stack
    ["Belt Squat", /^(?!.*(\bLM\b|land\s*mine)).*belt\s*squat/i], // the machine; a landmine belt squat is set up on a landmine instead
    ["Machine", /\bmachine\b|leg\s*press|lat\s*pull\s*down/i],
    ["GHR", /\bGHR\b|glute\s*ham/i],
    ["Band", /(?<!\bIT\s)\bband(s|ed)?\b|\bTKE\b/i], // not the IT band; every TKE variation is banded
    ["Med Ball", /\bMB\b|med(icine)?\s*ball/i],
    ["Physio Ball", /\bPB\b|physio\s*ball|stability\s*ball|swiss\s*ball|stir\s*the\s*pot/i],
    ["Suspension Trainer", /\bTRX\b|suspension/i],
    // SB at the very start of a name is a slideboard drill ("SB Pike"), except Stir The Pot, which is on a ball;
    // later in a name, as in the Elbow Enforcer drills ("EE Band SB HS ..."), SB is not equipment
    ["Slideboard", /slide\s*board|^\s*SB\b(?!.*stir\s*the\s*pot)/i],
    ["Sled", /\bsled\b|prowler/i],
    ["Hurdles", /\bhurdles?\b/i],
    ["Foam Roller", /foam\s*roll/i],
    ["Airex Pad", /\bairex\b/i],
    ["Slant Board", /slant\s*board/i],
    ["PVC", /\bPVC\b/i],
    ["Jammer", /\bjammer\b/i],
    ["Flywheel", /\bflywheel\b/i],
    ["Bike", /\bbike\b/i],
    ["Rower", /\bC2\b|\brower\b/i],
    ["Rice Bucket", /rice\s*bucket/i],
    ["Sledgehammer", /\bsledge(\s*hammer)?\b/i],
    ["SSL", /\bSSL\b/],
    ["Supercat", /super\s*cat/i],
    ["Tindeq", /\btindeq\b/i],
    ["Power Ball", /power\s*ball/i],
    ["Reflex Bar / Shoulder Tube / Body Blade", /reflex\s*bar|shoulder\s*tube|body\s*blade/i], // any one of the three will do
    ["Club", /\bclubs?\b/i],
  ];
  const fromName = (name) => FROM_NAME.filter(([, re]) => re.test(name || "")).map(([q]) => q);
  // the equipment one exercise needs: [] when it needs nothing (or nothing can be told)
  function required(name, libraryEntry) {
    const listed = libraryEntry && Array.isArray(libraryEntry.equipment) ? libraryEntry.equipment.filter((q) => q && q !== "Bodyweight") : [];
    return [...new Set([...listed, ...fromName(name)])];
  }
  // what of that the athlete lacks, given the list of equipment they have
  // (matched without regard to capitals, so equipment typed in by hand on an athlete's list still counts)
  const missing = (name, libraryEntry, access) => {
    const have = (access || []).map((x) => `${x}`.toLowerCase());
    return required(name, libraryEntry).filter((q) => !have.includes(q.toLowerCase()));
  };

  // ---- room to run ------------------------------------------------------------------------------------
  // A sprint or run can be done in any of the Spaces, as long as the space is long enough for the distance.
  // SPACE_YARDS is roughly the longest straight run each one allows: a basketball court is 94 ft, so about 30
  // yards; an open field or a track is as long as anyone will be asked to run. Indoor turf varies, so it is taken
  // to be long enough for anything unless the athlete's own length has been filled in.
  const SPACE_YARDS = { "Basketball Court": 30, "Indoor Turf": 400, "Open Field": 400, Track: 400 };
  // An athlete's own indoor turf length, in yards, is kept in their equipment list as a "turf-yards:35" entry
  // (so it travels with the list and needs no column of its own). When present it is the turf's limit.
  const TURF_KEY = "turf-yards:";
  const isSetting = (q) => `${q}`.toLowerCase().startsWith(TURF_KEY);
  const turfYards = (access) => {
    const hit = (access || []).find(isSetting);
    const n = hit ? parseFloat(`${hit}`.slice(TURF_KEY.length)) : NaN;
    return n > 0 ? n : null;
  };
  const withTurfYards = (access, yards) => {
    const rest = (access || []).filter((q) => !isSetting(q));
    const n = parseFloat(yards);
    return n > 0 ? [...rest, `${TURF_KEY}${Math.round(n)}`] : rest;
  };
  const RUN_NAME = /sprint|\bruns?\b|\brunning\b|\bdash\b|\bfly(ing|s)?\b|\baccel(eration)?s?\b|\bstrides?\b|build-?\s?ups?/i;
  // the longest distance written in a piece of text, in yards ("60 yd", "40 yards", "30m", "90 ft"); 0 if none
  function yardsIn(text) {
    let max = 0;
    const re = /(\d+(?:\.\d+)?)\s*-?\s*(yards?|yds?|yd|y|meters?|metres?|m|feet|foot|ft)\b/gi;
    let m;
    while ((m = re.exec(text || ""))) {
      const n = parseFloat(m[1]), u = m[2].toLowerCase();
      const yd = /^m/.test(u) ? n * 1.094 : /^f/.test(u) ? n / 3 : n;
      if (yd > max) max = yd;
    }
    return max;
  }
  // What a run needs that the athlete lacks: [] when one of their spaces is long enough, otherwise one line
  // saying so. `text` is the exercise's name plus its sets, reps and notes, where the distance is usually written.
  // A run with no distance written anywhere just needs some space to run in.
  function spaceMissing(name, text, access) {
    if (!RUN_NAME.test(name || "")) return [];
    const have = (access || []).map((x) => `${x}`.toLowerCase());
    const yards = Math.round(yardsIn(`${name} ${text || ""}`));
    const need = yards ? `Space for ${yards} yd` : "Space to run";
    if (have.includes(need.toLowerCase())) return []; // a coach chose "Ignore and add" for this one
    const spaces = Object.keys(SPACE_YARDS).filter((s) => have.includes(s.toLowerCase()));
    const room = (s) => (s === "Indoor Turf" && turfYards(access)) || SPACE_YARDS[s];
    if (spaces.some((s) => room(s) >= yards)) return [];
    return [need];
  }

  // Exercises in a program that need something the athlete lacks: one entry per exercise name, with how often
  // it comes up. `findExercise(name)` looks an exercise up in the exercise library.
  function flaggedIn(program, access, findExercise) {
    const byName = {};
    ((program || {}).weeks || []).forEach((w) => (w.sessions || []).forEach((s) => (s.exercises || []).forEach((e) => {
      const name = (e.name || "").trim();
      if (!name) return;
      const key = name.toLowerCase();
      if (!byName[key]) byName[key] = { name, missing: missing(name, findExercise ? findExercise(name) : null, access), count: 0 };
      byName[key].count += 1;
      // the distance can differ from week to week, so the space is checked each time the run comes up
      const text = `${(e.groups || []).map((g) => `${g.sets || ""} ${g.reps || ""} ${g.intensity || ""}`).join(" ")} ${e.reps || ""} ${e.notes || ""}`;
      spaceMissing(name, text, access).forEach((q) => { (byName[key].space = byName[key].space || []).push(q); });
    })));
    // one line per run: the longest distance it is ever asked for that they have no room for
    Object.values(byName).forEach((f) => {
      if (!f.space) return;
      const yards = Math.max(0, ...f.space.map((q) => parseInt((/\d+/.exec(q) || [0])[0], 10)));
      f.missing.push(yards ? `Space for ${yards} yd` : "Space to run");
      delete f.space;
    });
    return Object.values(byName).filter((f) => f.missing.length).sort((x, y) => x.name.localeCompare(y.name));
  }
  window.EquipmentCheck = { GROUPS, LIST, label, required, missing, fromName, flaggedIn, spaceMissing, SPACE_YARDS, turfYards, withTurfYards, isSetting, REMOTE_LOCATION: "DST Remote Training" };
})();

// ---- Re-assessments (shared by the dashboard and the weekly email) -----------------------------------
// After a full biomechanical assessment, an athlete is re-assessed every four weeks: only what the full assessment
// flagged is retested (see reassessment.js). A full assessment counts for about eight months; after that, or with
// none on file, the athlete is due a full assessment again. A coach can silence a re-assessment flag, which skips
// that one (the flag comes back for the next).
//   status({ fulls, reassessments, silencedUntil, today })  -> { state, due, daysUntil, full, last, ... }
//     state: "assess" (no full assessment in the last 8 months; reason "none" or "old"), "reassess-due" (due date
//     reached), "reassess-soon" (due within 7 days), "ok", or "silenced". Dates are "YYYY-MM-DD".
(function () {
  const FULL_VALID_DAYS = 243;
  const INTERVAL_DAYS = 28;
  const dayNo = (iso) => Math.floor(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 864e5);
  const isoOf = (n) => new Date(n * 864e5).toISOString().slice(0, 10);
  const byDate = (a, b) => (a.date || "").localeCompare(b.date || "");
  function status({ fulls, reassessments, silencedUntil, today }) {
    const t = dayNo(today);
    const list = (fulls || []).filter((a) => a && a.date).sort(byDate);
    const full = list[list.length - 1];
    if (!full) return { state: "assess", reason: "none" };
    const age = t - dayNo(full.date);
    if (age > FULL_VALID_DAYS) return { state: "assess", reason: "old", full, age };
    const after = (reassessments || []).filter((r) => r && r.date && r.date >= full.date).sort(byDate);
    const lastReassess = after[after.length - 1] || null;
    const last = lastReassess ? lastReassess.date : full.date;
    const due = dayNo(last) + INTERVAL_DAYS;
    const out = { full, lastReassess, last, due: isoOf(due), daysUntil: due - t };
    if (silencedUntil && silencedUntil >= today) return { ...out, state: "silenced", silencedUntil };
    if (out.daysUntil <= 0) return { ...out, state: "reassess-due" };
    if (out.daysUntil <= 7) return { ...out, state: "reassess-soon" };
    return { ...out, state: "ok" };
  }
  // silencing skips the re-assessment that is due: the flag returns four weeks after that due date (or after today,
  // when it was already overdue)
  const silenceUntil = (st, today) => isoOf(Math.max(dayNo(st.due), today ? dayNo(today) : 0) + INTERVAL_DAYS - 1);
  window.ReassessRules = { FULL_VALID_DAYS, INTERVAL_DAYS, status, silenceUntil, dayNo, isoOf };
})();
