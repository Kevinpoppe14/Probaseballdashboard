// The athlete's phone page: this week's program, a box to log the weight (and reps reached on sets to failure)
// for each set, and the exercise videos. Opened from a private link whose token sits after the "#", so it is
// never sent to the web server. All data comes from, and goes to, the two athlete_portal_* database functions
// (supabase/migration_007_athlete_portal.sql); nothing else in the database is reachable from here.
(function () {
  const Rx = window.ProgramRx;
  const sb = window.supabaseClient;
  const app = document.getElementById("app");
  const statusEl = document.getElementById("status");
  const overlay = document.getElementById("overlay");
  let token = (window.location.hash || "").replace(/^#/, "").trim();
  const query = new URLSearchParams(window.location.search);
  // In Coach Mode (coach.html) this page is shown inside a frame for an athlete a signed-in coach picked:
  // ?coach=1&aid=<athlete id>, with no token.
  const coachId = query.get("coach") === "1" ? query.get("aid") : null;
  // If the page is ever opened as plain /athlete.html (no code after the "#"), the code, team and staff flag from
  // the last time this browser opened the athlete's link are used. Kept on the phone only, and never in Coach Mode.
  let savedTeam = "", savedStaff = false;
  if (!coachId) {
    try {
      if (token) localStorage.setItem("myProgramLink", JSON.stringify({ token, team: query.get("team") || "", staff: query.get("staff") === "1" }));
      else {
        const saved = JSON.parse(localStorage.getItem("myProgramLink") || "null");
        if (saved && saved.token) { token = saved.token; savedTeam = saved.team || ""; savedStaff = !!saved.staff; }
      }
    } catch (e) { /* storage blocked: the link itself still works */ }
  }
  // A coach's own link (?staff=1) adds a Coach Mode button to the bottom bar. Coach Mode itself asks them to sign in.
  const staff = !coachId && (query.get("staff") === "1" || savedStaff);

  // Where the page's data comes from and goes to. An athlete's own link goes through the token-checked
  // athlete_portal_* database functions and can reach nothing else. In Coach Mode there is no token: the
  // coach is signed in, so the same data is read from and written to the tables under their own login, and
  // what they log is recorded as entered by a coach.
  const api = coachId ? {
    async get() {
      const { data: s } = await sb.auth.getSession();
      if (!s || !s.session) return { error: { signedOut: true } };
      const id = String(coachId);
      const [a, pz, lg, ov, meta] = await Promise.all([
        sb.from("athletes").select("data").eq("id", id).maybeSingle(),
        sb.from("periodization").select("data").eq("athlete_id", id).maybeSingle(),
        sb.from("athlete_logs").select("program_id,key,value").eq("athlete_id", id).limit(20000),
        sb.from("athlete_overrides").select("program_id,exercise_id,data").eq("athlete_id", id).limit(5000),
        sb.from("app_meta").select("value").eq("key", "rmChart").maybeSingle(),
      ]);
      if (a.error || pz.error) return { error: a.error || pz.error };
      const athlete = (a.data && a.data.data) || {};
      const p = pz.data ? pz.data.data : null;
      const ids = [...new Set(((p && p.blocks) || []).map((b) => b.programId).filter(Boolean).map(String))];
      const pr = ids.length ? await sb.from("programs").select("id,data").in("id", ids) : { data: [] };
      const programs = (pr.data || []).map((r) => ({ id: r.id, name: r.data.name, weeks: r.data.weeks }));
      // videos and cues for the exercises in those programs (and any the athlete switched to), a batch at a time
      const names = new Set();
      programs.forEach((x) => (x.weeks || []).forEach((w) => (w.sessions || []).forEach((ses) => (ses.exercises || []).forEach((e) => { if ((e.name || "").trim()) names.add(e.name.trim()); }))));
      (ov.data || []).forEach((r) => { if (r.data && (r.data.name || "").trim()) names.add(r.data.name.trim()); });
      // the library, read whole so an exercise also answers to the names merged into it (its `aliases`): each
      // program name gets the entry it matches (ignoring case, spaces and punctuation), under the program's wording,
      // with the entry's own name as `canon`, the lift it tracks as
      const key = window.exerciseNameKey;
      const wanted = new Map(); // name key -> the program's wordings of it
      [...names].forEach((n) => { const k = key(n); if (k) wanted.set(k, [...(wanted.get(k) || []), n]); });
      const exercises = [];
      const lib = await window.ExerciseVideo.readLibrary("data"); // every row, a page at a time
      lib.forEach((r) => {
        const d = r.data || {};
        const keys = new Set([d.name, ...(d.aliases || [])].map(key));
        keys.forEach((k) => (wanted.get(k) || []).forEach((n) => exercises.push({ name: n, canon: d.name, videoUrl: d.videoUrl, cues: d.cues })));
      });
      return {
        data: {
          athlete: { name: athlete.name || "", offseasonFacility: athlete.offseasonFacility || "", remote: false }, // the equipment survey is the athlete's own
          plan: p ? { startDate: p.startDate, weeks: p.weeks, goals: p.goals, actionPlan: p.actionPlan, lanes: p.lanes || [], blocks: p.blocks || [], programLog: p.programLog || {} } : null,
          programs, exercises,
          logs: (lg.data || []).map((r) => ({ programId: r.program_id, key: r.key, value: r.value })),
          overrides: (ov.data || []).map((r) => ({ programId: r.program_id, exerciseId: r.exercise_id, data: r.data })),
          rmChart: meta.data ? meta.data.value : null,
        },
      };
    },
    async log(programId, key, value) {
      const { error } = await sb.from("athlete_logs").upsert({ athlete_id: String(coachId), program_id: String(programId), key, value: value || "", source: "coach", updated_at: new Date().toISOString() });
      if (!error && key.startsWith("session-") && window.parent !== window) window.parent.postMessage("coach-session-changed", window.location.origin); // Coach Mode marks who has finished today
      return !error;
    },
    async override(programId, ids, payload) {
      const base = sb.from("athlete_overrides");
      const { error } = payload
        ? await base.upsert(ids.map((exId) => ({ athlete_id: String(coachId), program_id: String(programId), exercise_id: exId, data: payload, source: "coach", updated_at: new Date().toISOString() })))
        : await base.delete().eq("athlete_id", String(coachId)).eq("program_id", String(programId)).in("exercise_id", ids);
      return !error;
    },
    async exercises(q) {
      const { data } = await sb.from("exercises").select("data").ilike("data->>name", `%${q.replace(/[%_]/g, " ")}%`).limit(20);
      return (data || []).map((r) => ({ name: r.data.name, videoUrl: r.data.videoUrl, cues: r.data.cues }));
    },
    async tests() {
      const { data, error } = await sb.from("kpi_entries").select("data").eq("athlete_id", String(coachId)).limit(5000);
      return error ? [] : (data || []).map((r) => r.data || {});
    },
    async bodyComp() {
      const id = String(coachId);
      const [bc, as] = await Promise.all([
        sb.from("body_comp").select("data").eq("athlete_id", id).limit(5000),
        sb.from("assessments").select("data").eq("athlete_id", id).eq("data->>kind", "bodycomp").limit(1000),
      ]);
      return { scans: (bc.data || []).map((r) => r.data || {}), sheets: (as.data || []).map((r) => ({ date: (r.data || {}).date, summary: (r.data || {}).summary })) };
    },
    // when each logged entry was entered, as athlete_portal_log_times hands it back
    async logTimes() {
      const { data, error } = await sb.from("athlete_logs").select("program_id,key,updated_at").eq("athlete_id", String(coachId)).neq("value", "").limit(20000);
      return error ? [] : (data || []).map((r) => ({ programId: r.program_id, key: r.key, at: r.updated_at }));
    },
    // the food log, as athlete_portal_food_get / _save read and write it
    async foodLog(from) {
      const { data, error } = await sb.from("food_logs").select("day,entries").eq("athlete_id", String(coachId)).gte("day", from).limit(100);
      return error ? null : (data || []).map((r) => ({ day: r.day, entries: r.entries || [] }));
    },
    async foodSave(day, entries) {
      const { error } = await sb.from("food_logs").upsert({ athlete_id: String(coachId), day, entries, source: "coach", updated_at: new Date().toISOString() });
      return !error;
    },
    // the shared food library, as athlete_portal_food_library / _add read and write it
    async foodLibrary() {
      const { data, error } = await sb.from("food_library").select("id,data").limit(5000);
      return error ? null : (data || []).map((r) => Object.assign({ id: r.id }, r.data || {}, { mine: (r.data || {}).athleteId === String(coachId) }));
    },
    // the same as athlete_portal_food_library_add: the food already there for its barcode (or under the same name,
    // serving and calories) is handed back instead of adding another (migration_027's index refuses a second barcode)
    async foodLibraryAdd(def) {
      const code = String(def.barcode || "").replace(/\D/g, "");
      const byCode = async () => { const r = await sb.from("food_library").select("id").eq("data->>barcode", code).limit(1); return r.data && r.data[0] ? r.data[0].id : null; };
      if (code) { const had = await byCode(); if (had) return had; }
      const same = await sb.from("food_library").select("id,data").ilike("data->>name", String(def.name || "").replace(/[%_]/g, "")).limit(20);
      const match = (same.data || []).find((r) => r.data && r.data.sUnit === def.sUnit && +r.data.sAmt === +def.sAmt && Math.abs(+r.data.kcal - +def.kcal) < 1);
      if (match) {
        if (code && !match.data.barcode) await sb.from("food_library").update({ data: Object.assign({}, match.data, { barcode: code }), updated_at: new Date().toISOString() }).eq("id", match.id);
        return match.id;
      }
      const { data: s } = await sb.auth.getSession();
      const id = `fl-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      const by = (s && s.session && s.session.user && s.session.user.email) || "";
      const { error } = await sb.from("food_library").insert({ id, data: Object.assign({}, def, code ? { barcode: code } : {}, { source: "coach", athleteId: String(coachId), addedBy: by }) });
      if (error && code && error.code === "23505") return byCode(); // added by someone else a moment ago
      return error ? null : id;
    },
    // their food allergies, as athlete_portal_allergies / _set_allergies read and write them (the "nutrition_prefs" record)
    async allergies() {
      const { data, error } = await sb.from("assessments").select("data").eq("id", `nutprefs-${coachId}`).maybeSingle();
      if (error) return null;
      return data && data.data ? { allergies: data.data.allergies || [], other: data.data.other || "", asked: true } : { allergies: [], other: "", asked: false };
    },
    async setAllergies(list, other) {
      const id = `nutprefs-${coachId}`;
      const athleteId = /^\d+$/.test(String(coachId)) ? Number(coachId) : String(coachId);
      const { error } = await sb.from("assessments").upsert({ id, athlete_id: String(coachId), data: { id, kind: "nutrition_prefs", athleteId, allergies: list, other: other || "", asked: true, date: new Date().toISOString().slice(0, 10), source: "coach" }, updated_at: new Date().toISOString() });
      return !error;
    },
    // the athlete's saved meals, as athlete_portal_saved_meals / _save read and write them
    async savedMeals() {
      const { data, error } = await sb.from("saved_meals").select("id,data,updated_at").eq("athlete_id", String(coachId)).order("updated_at", { ascending: false }).limit(500);
      return error ? null : (data || []).map((r) => ({ id: r.id, data: r.data }));
    },
    async savedMealSave(id, data) {
      const { error } = data
        ? await sb.from("saved_meals").upsert({ id, athlete_id: String(coachId), data, updated_at: new Date().toISOString() })
        : await sb.from("saved_meals").delete().eq("id", id).eq("athlete_id", String(coachId));
      return !error;
    },
    // the nutrition plan's copy for the phone, as athlete_portal_nutrition hands it back
    async nutrition() {
      const { data, error } = await sb.from("assessments").select("data").eq("athlete_id", String(coachId)).eq("data->>kind", "nutrition").limit(10);
      if (error) return null;
      const plans = (data || []).map((r) => r.data || {}).filter((d) => d.goal && d.snapshot).sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
      return plans.length ? plans[0].snapshot : null;
    },
    // force plate tests, the same figures athlete_portal_cmj hands back
    async cmj() {
      const { data, error } = await sb.from("force_tests").select("data").eq("athlete_id", String(coachId)).limit(5000);
      if (error) return [];
      return (data || []).map((r) => {
        const d = r.data || {}, raw = d.raw || {};
        return { date: d.date, testType: d.testType, jumpHeight: d.jumpHeight, rsiModified: d.rsiModified, peakPower: d.peakPower, relativePeakPower: d.relativePeakPower, systemWeight: d.systemWeight, takeoffVelocity: d.takeoffVelocity, totalImpulse: d.totalImpulse, jumpMomentum: d.jumpMomentum != null ? d.jumpMomentum : raw["Jump Momentum(kg.m/s)"], countermovementDepth: d.countermovementDepth, countermovementDepthM: raw["Countermovement Depth(m)"] };
      });
    },
  } : {
    get: () => sb.rpc("athlete_portal_get", { p_token: token }),
    async log(programId, key, value) {
      const res = await sb.rpc("athlete_portal_log", { p_token: token, p_program_id: programId, p_key: key, p_value: value });
      return !res.error && res.data === true;
    },
    async override(programId, ids, payload) {
      const res = await sb.rpc("athlete_portal_override", { p_token: token, p_program_id: programId, p_exercise_ids: ids, p_data: payload });
      return !res.error && res.data === true;
    },
    async exercises(q) {
      const res = await sb.rpc("athlete_portal_exercises", { p_token: token, p_query: q });
      return res.data || [];
    },
    // Group Testing results (supabase/migration_014_athlete_portal_tests.sql); none until that has been run
    async tests() {
      const res = await sb.rpc("athlete_portal_tests", { p_token: token });
      return !res.error && Array.isArray(res.data) ? res.data : [];
    },
    // Evolt scans and manual body comp sheets (supabase/migration_018_athlete_portal_body_comp.sql); none until that has been run
    async bodyComp() {
      const res = await sb.rpc("athlete_portal_body_comp", { p_token: token });
      return !res.error && res.data ? res.data : null;
    },
    // when each logged entry was entered (supabase/migration_021_athlete_portal_log_times.sql); none until that has been run
    async logTimes() {
      const res = await sb.rpc("athlete_portal_log_times", { p_token: token });
      return !res.error && Array.isArray(res.data) ? res.data : [];
    },
    // force plate (CMJ) tests (supabase/migration_020_athlete_portal_cmj.sql); none until that has been run
    async cmj() {
      const res = await sb.rpc("athlete_portal_cmj", { p_token: token });
      return !res.error && Array.isArray(res.data) ? res.data : [];
    },
    // the food log (supabase/migration_023_food_log.sql); null (no log) until that has been run
    async foodLog(from) {
      const res = await sb.rpc("athlete_portal_food_get", { p_token: token, p_from: from });
      return !res.error && Array.isArray(res.data) ? res.data : null;
    },
    async foodSave(day, entries) {
      const res = await sb.rpc("athlete_portal_food_save", { p_token: token, p_day: day, p_entries: entries });
      return !res.error && res.data === true;
    },
    // the shared food library (supabase/migration_024_food_library.sql); none until that has been run
    async foodLibrary() {
      const res = await sb.rpc("athlete_portal_food_library", { p_token: token });
      return !res.error && Array.isArray(res.data) ? res.data : null;
    },
    // their food allergies (supabase/migration_026_nutrition_allergies.sql): null until that has been run, then
    // { allergies, other, asked } (asked false until they've answered)
    async allergies() {
      const res = await sb.rpc("athlete_portal_allergies", { p_token: token });
      if (res.error) return null;
      return res.data ? { allergies: res.data.allergies || [], other: res.data.other || "", asked: true } : { allergies: [], other: "", asked: false };
    },
    async setAllergies(list, other) {
      const res = await sb.rpc("athlete_portal_set_allergies", { p_token: token, p_allergies: list, p_other: other || "" });
      return !res.error && res.data === true;
    },
    // the athlete's saved meals (supabase/migration_025_saved_meals.sql); none until that has been run
    async savedMeals() {
      const res = await sb.rpc("athlete_portal_saved_meals", { p_token: token });
      return !res.error && Array.isArray(res.data) ? res.data : null;
    },
    async savedMealSave(id, data) {
      const res = await sb.rpc("athlete_portal_saved_meal_save", { p_token: token, p_id: id, p_data: data });
      return !res.error && res.data === true;
    },
    async foodLibraryAdd(def) {
      const res = await sb.rpc("athlete_portal_food_library_add", { p_token: token, p_food: def });
      return !res.error && res.data ? res.data : null;
    },
    // the nutrition plan (supabase/migration_022_athlete_portal_nutrition.sql); none until that has been run
    async nutrition() {
      const res = await sb.rpc("athlete_portal_nutrition", { p_token: token });
      return !res.error && res.data && typeof res.data === "object" ? res.data : null;
    },
  };
  // Links for Cubs-only players carry ?team=cubs, which changes the logo and colors, and the name the page gets
  // when it is added to the home screen: "My Program" rather than "My DST Program".
  const cubs = query.get("team") === "cubs" || savedTeam === "cubs";
  if (cubs) {
    document.body.classList.add("cubs");
    document.querySelector('meta[name="theme-color"]').setAttribute("content", "#06122b");
    document.querySelector('meta[name="apple-mobile-web-app-title"]').setAttribute("content", "My Program");
    document.querySelector('link[rel="manifest"]').setAttribute("href", "athlete-cubs.webmanifest");
  }
  // ---- light / dark --------------------------------------------------------------------------------------
  // The page is dark unless it's switched to light with the sun/moon button at the top (beside the logo, so it is
  // on every screen); the choice is kept on the phone. Light mode has its own colors (athlete.html,
  // :root[data-theme="light"]), the dark DST logo, and a matching browser bar.
  let theme = (() => { try { return localStorage.getItem("appTheme") === "light" ? "light" : "dark"; } catch (e) { return "dark"; } })();
  const applyTheme = () => {
    if (theme === "light") document.documentElement.setAttribute("data-theme", "light");
    else document.documentElement.removeAttribute("data-theme");
    const bar = document.querySelector('meta[name="theme-color"]');
    if (bar) bar.setAttribute("content", theme === "light" ? (cubs ? "#eef2fa" : "#f2f3f5") : (cubs ? "#06122b" : "#0a0a0a"));
  };
  applyTheme();
  const SUN = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  const MOON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>';
  const themeToggle = () => {
    const toLight = theme !== "light";
    const b = el("button", { class: "theme-toggle", "aria-label": toLight ? "Switch to light mode" : "Switch to dark mode", title: toLight ? "Light mode" : "Dark mode", onclick: () => {
      theme = toLight ? "light" : "dark";
      try { localStorage.setItem("appTheme", theme); } catch (e) { /* private window: for now only */ }
      applyTheme();
      const y = window.scrollY;
      render();
      window.scrollTo(0, y);
    } });
    b.innerHTML = toLight ? SUN : MOON;
    return b;
  };
  // the logo, with the day's greeting under it on a holiday (see holiday.js), and the light/dark button
  const logo = () => {
    const holiday = window.Holiday && window.Holiday.today();
    return [
      cubs
        ? el("img", { src: "https://www.mlbstatic.com/team-logos/112.svg", alt: "Chicago Cubs" })
        : el("img", { src: theme === "light" ? "assets/dst-logo.png" : "assets/dst-logo-light.png", alt: "Dynamic Sports Training" }),
      holiday ? el("div", { class: "holiday-greeting" }, holiday.greeting) : null,
      plan ? themeToggle() : null, // (not on a message screen, which has nothing to redraw)
    ];
  };

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
  const message = (text) => { app.replaceChildren(el("div", { class: "empty" }, text)); };

  let data = null; // what athlete_portal_get returned
  let plan = null; // data.plan with programLog holding everything logged so far
  let weekIdx = 0, itemIdx = 0, dayIdx = 0;
  let view = "program"; // "program" (this week's training), "plan" (the player plan), "progress" or "equipment" (remote athletes)
  let tests = null; // the athlete's Group Testing results, loaded after the program is on screen
  let cmjTests = []; // their force plate (CMJ) tests, for the Progress tab's jump graphs, loaded the same way
  let logTimes = {}; // "<program id>|<key>" -> when it was entered, for the Plan tab's Training Log calendar
  let bodyComp = null; // { scans, sheets }: their Evolt scans and manual body comp sheets, loaded the same way
  let nutrition = null; // the nutrition plan as the dashboard wrote it out for the phone (nutrition.js), loaded the same way
  let nutRest = false, nutWeek = null, nutDay = null; // the Nutrition tab: rest-day targets, and the example week and day shown
  let foodDays = null; // the food log: "YYYY-MM-DD" -> that day's entries (null until loaded, or with no food log in the database)
  let foodDay = null; // the day the food log is showing ("YYYY-MM-DD"), today to start with
  let libraryFoods = []; // the shared food library: custom foods athletes and coaches have added (migration_024)
  let savedMeals = null; // My meals: [{ id, data: { name, meal, items } }] (null until loaded, or without migration_025)
  let allergyInfo = null; // their food allergies { allergies, other, asked } (null until loaded, or without migration_026)
  let allergyAsked = false; // the allergy question has been put to them this visit
  let allergyLoaded = false; // their answer has been looked up (whether or not there is one)
  let remote = false; // trains remotely: gets the equipment survey
  let equipment = { access: null, custom: [], surveyedAt: null };
  let derived = []; // refreshers for the filled-in weights and 1RM estimates currently on screen

  // The athlete's own changes to an exercise or its sets and reps: programId -> exercise id -> { name, groups, from }.
  // programById gives the program with those applied; rawProgram is what the coach wrote.
  let overrides = {};
  let effective = {};
  const rawProgram = (id) => (data.programs || []).find((p) => p.id === id) || null;
  const programById = (id) => {
    if (!(id in effective)) effective[id] = window.applyOverrides(rawProgram(id), overrides[id]);
    return effective[id];
  };
  const parseISO = (s) => { const [y, m, d] = String(s).split("-").map(Number); return new Date(y, m - 1, d); };
  const currentWeek = () => {
    const days = Math.round((new Date(new Date().toDateString()) - parseISO(plan.startDate)) / 864e5);
    return Math.max(0, Math.min(plan.weeks - 1, Math.floor(days / 7)));
  };
  // the programs in play during one plan week, in the order of the plan's rows (see programWeeksAt in periodization.js)
  const itemsAt = (wk) => (plan.blocks || [])
    .filter((b) => b.programId && b.start <= wk && wk < b.start + b.len)
    .map((b) => {
      const program = programById(b.programId);
      const lane = (plan.lanes || []).find((l) => l.id === b.lane);
      if (!program || !lane || !(program.weeks || []).length) return null;
      const n = (wk - b.start) % program.weeks.length;
      return { block: b, lane, program, week: program.weeks[n], weekNo: n + 1 };
    })
    .filter(Boolean)
    .sort((a, b) => plan.lanes.indexOf(a.lane) - plan.lanes.indexOf(b.lane));
  const weekDates = (wk) => {
    const a = parseISO(plan.startDate); a.setDate(a.getDate() + wk * 7);
    const b = new Date(a); b.setDate(b.getDate() + 6);
    const f = (d) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    return `${f(a)} – ${f(b)}`;
  };

  // ---- saving ------------------------------------------------------------------------------------
  const pending = new Map(); // "programId key" -> { programId, key, value } not yet saved
  let flushing = false, statusTimer = null;
  const showStatus = (text, bad) => {
    statusEl.textContent = text;
    statusEl.className = `status show${bad ? " bad" : ""}`;
    clearTimeout(statusTimer);
    if (!bad) statusTimer = setTimeout(() => { statusEl.className = "status"; }, 1500);
  };
  async function flush() {
    if (flushing || !pending.size) return;
    flushing = true;
    for (const [id, p] of [...pending]) {
      let ok = false;
      try {
        ok = await api.log(p.programId, p.key, p.value);
      } catch (e) { ok = false; }
      if (!ok) { showStatus("Not saved yet. Check your connection; it will retry.", true); break; }
      if (pending.get(id) === p) pending.delete(id);
    }
    flushing = false;
    if (!pending.size) showStatus("Saved");
    else setTimeout(flush, 5000);
  }
  window.addEventListener("online", flush);
  window.addEventListener("beforeunload", (e) => { if (pending.size) { e.preventDefault(); e.returnValue = ""; } });
  const logged = (programId, key) => ((plan.programLog || {})[programId] || {})[key] || "";
  const save = (programId, key, value) => {
    if (value === logged(programId, key)) return;
    const one = (plan.programLog[programId] = plan.programLog[programId] || {});
    if (value) one[key] = value; else delete one[key];
    if (value) logTimes[`${programId}|${key}`] = new Date().toISOString(); else delete logTimes[`${programId}|${key}`]; // for the Training Log
    pending.set(`${programId} ${key}`, { programId, key, value });
    flush();
    derived.forEach((fn) => fn());
  };

  // ---- exercise video ----------------------------------------------------------------------------
  const nameKey = window.exerciseNameKey; // names match ignoring case, spaces, hyphens and punctuation (program_rx.js)
  const exerciseInfo = (name) => (data.exercises || []).find((x) => nameKey(x.name) === nameKey(name)) || null;
  const closeVideo = () => {
    if (window.__dstStopScanner) window.__dstStopScanner(); // a barcode scan left open: the camera goes off
    overlay.className = "overlay"; overlay.replaceChildren();
    // the coach's own plan changed in Coach tools (quick_assign.js): reload so the page shows it
    if (window.QuickAssign && window.QuickAssign.takeChange && window.QuickAssign.takeChange()) window.location.reload();
  };
  const openVideo = (info) => {
    const embed = window.videoEmbedOf(info.videoUrl);
    overlay.replaceChildren(el("div", { class: "sheet" },
      el("button", { class: "close", "aria-label": "Close", onclick: closeVideo }, "×"),
      el("h2", null, info.name),
      embed && embed.file
        // a clip a coach filmed: plays on a loop, muted to start (phones only autoplay muted video)
        ? (() => { const v = el("video", { class: "clip", src: embed.src, controls: true, playsinline: true, autoplay: true, muted: true, loop: true, preload: "metadata" }); v.muted = true; return v; })()
        : embed
          ? el("div", { class: `video${embed.vertical ? " vertical" : ""}` }, el("iframe", { src: embed.src, title: info.name, allow: "accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture", allowfullscreen: true, referrerpolicy: "strict-origin-when-cross-origin" }))
          : info.videoUrl ? el("a", { href: info.videoUrl, target: "_blank", rel: "noopener" }, "Open the video") : null,
      info.cues ? el("div", { class: "cues" }, info.cues) : null));
    overlay.className = "overlay show";
  };
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeVideo(); });
  // A home-screen app can sit open in the background for days. Coming back to it after 15 minutes or more (or on a
  // new day) reloads it, so a program assigned since then shows. Not while something is being typed or a sheet is
  // open, or with weights still waiting to save.
  let hiddenAt = null;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { hiddenAt = new Date(); return; }
    const was = hiddenAt;
    hiddenAt = null;
    if (!was || coachId) return;
    const stale = Date.now() - was.getTime() >= 15 * 60e3 || was.toDateString() !== new Date().toDateString();
    const busy = overlay.className.includes("show") || (document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) || pending.size > 0;
    if (stale && !busy) window.location.reload();
  });
  // a small picture of an exercise's video beside its name; tapping it plays the video. YouTube gives a still
  // picture, a coach's own clip shows its first frame, and anything else (Vimeo) a plain tile with the play mark.
  function videoThumb(info) {
    const embed = window.videoEmbedOf(info.videoUrl);
    if (!embed) return null;
    const b = el("button", { class: "thumb", "aria-label": `Play the video for ${info.name}`, title: "Play the video", onclick: () => openVideo(info) });
    const yt = /youtube\.com\/embed\/([\w-]+)/.exec(embed.src);
    if (yt) b.append(el("img", { src: `https://i.ytimg.com/vi/${yt[1]}/mqdefault.jpg`, alt: "", loading: "lazy" }));
    else if (embed.file) { const v = el("video", { src: `${embed.src}#t=0.5`, muted: true, playsinline: true, preload: "metadata", "aria-hidden": "true", tabindex: "-1" }); v.muted = true; b.append(v); }
    b.append(el("span", { class: "thumb-play", "aria-hidden": "true" }));
    return b;
  }

  // ---- filming a video for an exercise that has none (signed-in coaches only) ------------------------
  // A camera button beside the switch button on an exercise with no video. It opens the phone's camera; the clip
  // is stored and becomes the exercise's video in the exercise library (the exercise is added to the library if
  // it isn't there), so it plays wherever the exercise is programmed, for every athlete.
  let canFilm = false; // set once we know a coach is signed in (Coach Mode, or a coach's own link after signing in)
  const CAMERA = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 10l5-3v10l-5-3z"/><rect x="3" y="6" width="12" height="12" rx="2"/></svg>';
  function filmVideo(e) {
    const name = (e.name || "").trim();
    document.querySelectorAll("input.film-input").forEach((x) => x.remove()); // one left over from a cancelled camera
    const input = el("input", { type: "file", class: "film-input", accept: "video/*", capture: "environment", hidden: true });
    document.body.append(input);
    input.addEventListener("change", async () => {
      const file = input.files && input.files[0];
      input.remove();
      if (!file) return;
      const note = el("div", { class: "swap-note" }, `Uploading… (${Math.max(1, Math.round(file.size / 1048576))} MB). Keep this screen open.`);
      const actions = el("div", { class: "swap-actions" });
      overlay.replaceChildren(el("div", { class: "sheet" }, el("h2", null, `Video for ${name}`), note, actions));
      overlay.className = "overlay show";
      try {
        const url = await window.ExerciseVideo.upload(file, name);
        note.textContent = "Adding it to the exercise library…";
        const entry = await window.ExerciseVideo.attach(name, url);
        const info = exerciseInfo(name);
        if (info) { info.videoUrl = entry.videoUrl; info.cues = info.cues || entry.cues; }
        else data.exercises.push({ name: entry.name || name, videoUrl: entry.videoUrl, cues: entry.cues || "" });
        closeVideo();
        render();
        showStatus(entry.videoUrl === url ? "Video added" : "This exercise already had a video");
      } catch (err) {
        note.textContent = (err && err.message) || "Could not upload the video. Check your connection and try again.";
        actions.replaceChildren(el("button", { class: "primary", onclick: () => filmVideo(e) }, "Film again"), el("button", { onclick: closeVideo }, "Close"));
      }
    });
    input.click();
  }

  // ---- form checks (athletes who train remotely) -------------------------------------------------------
  // A camera button on each exercise films a set and sends it to the coach who assigned the program, with an
  // optional note (api/form-check.js, supabase/migration_017_form_checks.sql). The phone gets a one-time upload
  // link for its own folder, uploads the clip straight to private storage, then the coach is emailed. Under the
  // exercise it then says it was sent, and shows the coach's reply once there is one. Clips are kept for a week.
  let formChecks = []; // this athlete's checks from the past week: { programId, exerciseId, exercise, note, reply, reviewed, at }
  const canSendChecks = () => remote && !coachId && !!token;
  const checksFor = (item, e) => formChecks.filter((f) => String(f.programId) === String(item.program.id) && f.exerciseId === e.id);
  function checkLine(item, e) {
    const mine = checksFor(item, e);
    if (!mine.length) return null;
    const last = mine[mine.length - 1];
    const replied = mine.filter((f) => (f.reply || "").trim());
    return el("div", { class: "check-line" },
      el("div", { class: "check-sent" }, `✓ Form check sent to your coach${mine.length > 1 ? ` (${mine.length})` : ""}${last.reviewed && !replied.length ? " · seen" : ""}`),
      replied.map((f) => el("div", { class: "check-reply" }, el("b", null, "Coach: "), f.reply)));
  }
  function sendCheck(item, e, dayName) {
    document.querySelectorAll("input.film-input").forEach((x) => x.remove());
    const input = el("input", { type: "file", class: "film-input", accept: "video/*", capture: "environment", hidden: true });
    document.body.append(input);
    input.addEventListener("change", () => {
      const file = input.files && input.files[0];
      input.remove();
      if (!file) return;
      const preview = el("video", { class: "clip", src: URL.createObjectURL(file), controls: true, playsinline: true, muted: true, preload: "metadata" });
      preview.muted = true;
      const note = el("textarea", { class: "check-note", rows: "3", maxlength: "600", placeholder: "Anything your coach should know? (optional)" });
      const msg = el("div", { class: "swap-note" });
      const actions = el("div", { class: "swap-actions" });
      const close = () => { URL.revokeObjectURL(preview.src); closeVideo(); };
      const send = async () => {
        const mb = file.size / 1048576;
        if (mb > 50) { msg.textContent = `That clip is ${Math.round(mb)} MB. Keep it under 50 MB (about 20 seconds) and film it again.`; return; }
        actions.replaceChildren();
        msg.textContent = `Sending… (${Math.max(1, Math.round(mb))} MB). Keep this screen open.`;
        const post = async (body) => {
          const r = await fetch("/api/form-check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, ...body }) });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(j.error || "Could not send the video. Check your connection and try again.");
          return j;
        };
        try {
          const ext = ((file.name || "").match(/\.(\w{2,4})$/) || [])[1] || (/quicktime/i.test(file.type) ? "mov" : /webm/i.test(file.type) ? "webm" : "mp4");
          const { path, uploadToken } = await post({ action: "start", ext });
          const up = await sb.storage.from("form-checks").uploadToSignedUrl(path, uploadToken, file, { contentType: file.type || "video/mp4" });
          if (up.error) throw new Error("The video didn't upload. Check your connection and try again.");
          const text = note.value.trim();
          await post({ action: "done", path, programId: item.program.id, exerciseId: e.id, exercise: e.name, program: item.program.name, week: item.week.name || `Week ${item.weekNo}`, day: dayName, note: text });
          formChecks.push({ programId: item.program.id, exerciseId: e.id, exercise: e.name, note: text, reply: "", reviewed: false, at: new Date().toISOString() });
          close();
          render();
          showStatus("Sent to your coach");
        } catch (err) {
          msg.textContent = (err && err.message) || "Could not send the video. Check your connection and try again.";
          actions.replaceChildren(el("button", { class: "primary", onclick: send }, "Try again"), el("button", { onclick: close }, "Cancel"));
        }
      };
      actions.replaceChildren(el("button", { class: "primary", onclick: send }, "Send to my coach"), el("button", { onclick: () => { close(); sendCheck(item, e, dayName); } }, "Film again"), el("button", { onclick: close }, "Cancel"));
      overlay.replaceChildren(el("div", { class: "sheet" },
        el("button", { class: "close", "aria-label": "Close", onclick: close }, "×"),
        el("h2", null, `Form check: ${e.name}`),
        preview, note, msg, actions));
      overlay.className = "overlay show";
    });
    input.click();
  }

  // After a coach swaps in an exercise: if it isn't in the exercise library, or is there with no video, offer to
  // film one now (or, for a new name, to add it to the library without one). An exercise that is in the library
  // with a video just starts showing it.
  async function offerVideo(name) {
    const clean = (name || "").trim();
    if (!clean) return;
    const known = exerciseInfo(clean);
    if (known && known.videoUrl) return;
    let row = null;
    try { row = await window.ExerciseVideo.find(clean); } catch (err) { return; } // can't reach the library: the camera button is still there
    if (overlay.className.includes("show")) return; // something else opened meanwhile
    const entry = row && row.data;
    if (entry && entry.videoUrl) {
      if (known) { known.videoUrl = entry.videoUrl; known.cues = known.cues || entry.cues; }
      else data.exercises.push({ name: clean, videoUrl: entry.videoUrl, cues: entry.cues || "" });
      render();
      return;
    }
    const note = el("div", { class: "swap-note" });
    const add = async () => {
      note.textContent = "Adding…";
      try {
        await window.ExerciseVideo.attach(clean, "");
        closeVideo();
        showStatus("Added to the exercise library");
      } catch (err) { note.textContent = (err && err.message) || "Could not add it. Try again."; }
    };
    overlay.replaceChildren(el("div", { class: "sheet coach-menu" },
      el("button", { class: "close", "aria-label": "Close", onclick: closeVideo }, "×"),
      el("h2", null, "Add a video?"),
      el("div", { class: "swap-coach" }, entry
        ? `“${clean}” is in the exercise library but has no video yet. Film a short clip and it will play wherever this exercise is programmed.`
        : `“${clean}” isn't in the exercise library yet. Film a short clip to add it with a video, so it plays wherever this exercise is programmed.`),
      note,
      el("div", { class: "swap-actions" },
        el("button", { class: "primary", onclick: () => filmVideo({ name: clean }) }, "Film a video"),
        entry ? null : el("button", { onclick: add }, "Add it without a video"),
        el("button", { onclick: closeVideo }, "Not now"))));
    overlay.className = "overlay show";
  }

  // ---- changing an exercise, or its sets and reps ------------------------------------------------
  // Opened from the switch button beside an exercise name. The athlete can type another exercise (matches from
  // the exercise library are offered as they type) and edit the sets and reps. If the same exercise comes up
  // on the same day in later weeks of the program, they are asked whether to change those too.
  function openSwap(item, si, e) {
    const pid = item.program.id;
    const raw = rawProgram(pid);
    const wi = item.weekNo - 1;
    const sameName = (a, b) => (a || "").trim().toLowerCase() === (b || "").trim().toLowerCase();
    // the coach's version of this exercise, and where the same one comes up in the weeks after this one
    const rawDay = (w) => ((((raw.weeks[w] || {}).sessions || [])[si] || {}).exercises || []);
    const coach = rawDay(wi).find((x) => x.id === e.id) || e;
    const nth = rawDay(wi).filter((x) => sameName(x.name, coach.name)).indexOf(coach);
    const later = [];
    for (let w = wi + 1; w < raw.weeks.length; w += 1) {
      const m = rawDay(w).filter((x) => sameName(x.name, coach.name))[Math.max(0, nth)];
      if (m && m.id !== e.id) later.push(m.id);
    }
    const changed = !!(overrides[pid] || {})[e.id];
    const unit = Rx.normalize(e).intensityUnit;
    let groups = Rx.normalize(e).groups.map((g) => ({ sets: `${g.sets || ""}`, reps: `${g.reps || ""}`, intensity: `${g.intensity || ""}` }));
    if (!groups.length) groups = [{ sets: "", reps: "", intensity: "" }];
    let picked = null; // library entry chosen from the suggestions

    const name = el("input", { type: "text", class: "swap-name", value: e.name, autocomplete: "off", autocapitalize: "words", "aria-label": "Exercise" });
    const matches = el("div", { class: "matches" });
    const rowsEl = el("div", { class: "swap-rows" });
    const note = el("div", { class: "swap-note" });
    const actions = el("div", { class: "swap-actions" });
    let searchTimer = null, searchNo = 0;
    name.addEventListener("input", () => {
      picked = null;
      clearTimeout(searchTimer);
      const q = name.value.trim();
      if (q.length < 2) { matches.replaceChildren(); return; }
      searchTimer = setTimeout(async () => {
        const no = (searchNo += 1);
        let res;
        try { res = { data: await api.exercises(q) }; } catch (err) { res = { data: [] }; }
        if (no !== searchNo) return;
        matches.replaceChildren(...(res.data || []).slice(0, 8).map((m) => el("button", { class: "match", onclick: () => { name.value = m.name; picked = m; matches.replaceChildren(); } }, m.name, m.videoUrl ? el("small", null, "video") : null)));
      }, 250);
    });
    const drawRows = () => {
      rowsEl.replaceChildren(...groups.map((g, gi) => {
        const field = (key, label, mode) => el("label", null, label, el("input", { type: "text", inputmode: mode, value: g[key], autocomplete: "off", oninput: (ev) => { g[key] = ev.target.value; } }));
        return el("div", { class: "swap-row" },
          field("sets", "Sets", "numeric"), field("reps", "Reps", "text"),
          unit ? field("intensity", unit === "%" ? "%" : unit, "decimal") : null,
          groups.length > 1 ? el("button", { class: "swap-x", "aria-label": "Remove this set", onclick: () => { groups.splice(gi, 1); drawRows(); } }, "×") : null);
      }), el("button", { class: "swap-add", onclick: () => { groups.push({ sets: "", reps: "", intensity: "" }); drawRows(); } }, "+ Add a set"));
    };
    const apply = async (ids, payload) => {
      note.textContent = "Saving…";
      let ok = false;
      try {
        ok = await api.override(pid, ids, payload);
      } catch (err) { ok = false; }
      if (!ok) { note.textContent = "Could not save. Check your connection and try again."; drawActions(); return; }
      const one = (overrides[pid] = overrides[pid] || {});
      ids.forEach((id) => { if (payload) one[id] = payload; else delete one[id]; });
      delete effective[pid];
      if (picked && !exerciseInfo(picked.name)) data.exercises.push(picked);
      closeVideo();
      render();
      showStatus(payload ? "Changed" : "Back to your coach's version");
      // a coach who swapped in a different exercise: offer to film it if the library has no video for it
      if (payload && canFilm && payload.name.trim().toLowerCase() !== (payload.from || "").trim().toLowerCase()) offerVideo(payload.name);
    };
    // asks about the rest of the phase when the same exercise comes up again, then saves
    const choose = (payload, ask) => {
      const ids = later.filter((id) => (payload ? true : !!(overrides[pid] || {})[id]));
      if (!ids.length) { apply([e.id], payload); return; }
      note.textContent = ask;
      actions.replaceChildren(
        el("button", { class: "primary", onclick: () => apply([e.id, ...ids], payload) }, "Yes, all remaining weeks"),
        el("button", { onclick: () => apply([e.id], payload) }, "Just this week"));
    };
    function drawActions() {
      actions.replaceChildren(...[
        el("button", { class: "primary", onclick: () => {
          const nm = name.value.trim();
          const gs = groups.map((g) => ({ sets: g.sets.trim(), reps: g.reps.trim(), intensity: g.intensity.trim() })).filter((g) => g.sets || g.reps);
          if (!nm) { note.textContent = "Type an exercise name."; return; }
          if (!gs.length) { note.textContent = "Enter the sets and reps."; return; }
          choose({ name: nm, groups: gs, from: coach.name }, "Replace for the rest of this phase?");
        } }, "Save"),
        changed ? el("button", { onclick: () => choose(null, "Go back to your coach's version for the rest of this phase too?") }, "Use coach's version") : null,
        el("button", { onclick: closeVideo }, "Cancel")].filter(Boolean));
    }
    drawRows();
    drawActions();
    overlay.replaceChildren(el("div", { class: "sheet" },
      el("button", { class: "close", "aria-label": "Close", onclick: closeVideo }, "×"),
      el("h2", null, "Change exercise"),
      changed ? el("div", { class: "swap-coach" }, `Coach: ${coach.name}${Rx.text(coach) ? `, ${Rx.text(coach)}` : ""}`) : null,
      el("label", { class: "swap-label" }, "Exercise", name),
      matches,
      el("div", { class: "swap-label" }, "Sets and reps"),
      rowsEl, note, actions));
    overlay.className = "overlay show";
  }

  // What was logged for this set the last time it came up: the same exercise (by name) on the same day of an
  // earlier week of this block, looking back from last week. Returns { week, when, text } or null.
  // when a past set was done, for that line: the day it was typed in (when the log says), the day of a quick session
  // (it has one), else the week it was in
  const loggedWhen = (wk, date, pid, keys) => {
    const f = (d) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const at = (keys || []).map((k) => logTimes[`${pid}|${k}`]).filter(Boolean).sort().pop();
    if (at && !isNaN(new Date(at))) return f(new Date(at));
    if (date) return f(parseISO(date));
    const a = parseISO(plan.startDate); a.setDate(a.getDate() + wk * 7);
    return `Wk of ${f(a)}`;
  };
  // Which of an earlier time's set groups goes beside this one. When both are prescribed in %, the one at the same %
  // (else the nearest below it, else the heaviest): a deload week of 40 / 50 / 60% before a week of 60 / 70 / 80%
  // shows the 60% set's weight beside all three, not the 40% warm-up's. Otherwise the same set, or past the last
  // set it had, its last (top) set.
  function pairGroup(prev, e, gi) {
    const pg = Rx.groups(prev), g = Rx.groups(e)[gi];
    if (!pg.length) return { gi };
    const pct = (x, grp) => (grp && Rx.normalize(x).intensityUnit === "%" ? parseFloat(grp.intensity) : NaN);
    const mine = pct(e, g);
    if (Number.isFinite(mine)) {
      const had = pg.map((x, i) => ({ i, v: pct(prev, x) })).filter((x) => Number.isFinite(x.v));
      if (had.length) {
        const pick = had.find((x) => x.v === mine) || had.filter((x) => x.v < mine).sort((a, b) => b.v - a.v)[0] || had.sort((a, b) => b.v - a.v)[0];
        return { gi: pick.i, pct: pick.v === mine ? null : pick.v };
      }
    }
    return { gi: gi < pg.length ? gi : pg.length - 1 };
  }
  // a logged set as that line reads it, or null when there's nothing to show: a weight of 0 (typed on a bodyweight
  // exercise) counts as no weight
  const lastText = (w, r, pct) => {
    const wt = parseFloat(w) > 0 ? w : "";
    if (!wt && !r) return null;
    return { w: wt, r, text: `${r ? `${wt || "BW"} x ${r}` : wt}${pct != null ? ` @ ${pct}%` : ""}` };
  };
  function lastLogged(item, si, e, gi) {
    const pid = item.program.id, name = Rx.liftKey(e.name);
    const same = (x) => Rx.liftKey(x.name) === name; // the same lift, under any of its library names
    const today = ((item.week.sessions || [])[si] || {}).exercises || [];
    const nth = today.filter(same).indexOf(e); // which one, if the exercise is on the day more than once
    for (let wk = weekIdx - 1; wk >= item.block.start; wk -= 1) {
      const week = item.program.weeks[(wk - item.block.start) % item.program.weeks.length];
      const prev = ((((week || {}).sessions || [])[si] || {}).exercises || []).filter(same)[Math.max(0, nth)];
      if (!prev || prev.id === e.id) continue;
      const p = pairGroup(prev, e, gi), keys = [Rx.logKey(prev, p.gi), Rx.repsLogKey(prev, p.gi)];
      const t = lastText(logged(pid, keys[0]), logged(pid, keys[1]), p.pct);
      if (t) return { week: wk + 1, when: loggedWhen(wk, null, pid, keys), ...t };
    }
    return lastLoggedAnywhere(e, gi, weekIdx * 100 + si);
  }
  // Otherwise the last time the exercise (by name) was logged anywhere on the plan before this day: in another
  // program, a quick strength session (and a quick session finds it in the regular program), or earlier this week.
  // Its set group paired as above.
  function lastLoggedAnywhere(e, gi, pos) {
    const name = Rx.liftKey(e.name);
    let best = null;
    (plan.blocks || []).filter((b) => b.programId).forEach((b) => {
      const program = programById(b.programId);
      if (!program) return;
      (program.weeks || []).forEach((w, wi) => (w.sessions || []).forEach((s, si) => (s.exercises || []).forEach((x) => {
        const at = (b.start + wi) * 100 + si;
        if (x.id === e.id || at >= pos || (best && at <= best.at) || Rx.liftKey(x.name) !== name) return;
        const p = pairGroup(x, e, gi), keys = [Rx.logKey(x, p.gi), Rx.repsLogKey(x, p.gi)];
        const t = lastText(logged(program.id, keys[0]), logged(program.id, keys[1]), p.pct);
        if (t) best = { at, week: b.start + wi + 1, when: loggedWhen(b.start + wi, s.date, program.id, keys), ...t };
      })));
    });
    return best;
  }

  // ---- suggested weights -------------------------------------------------------------------------------
  // What a set's weight box is filled in with (in grey, until it's typed over), with a note saying where it's from:
  //  - a % set: its % of the lift's estimated max from a BM / TF set, or until there is one, of the initial training
  //    max from last time's % sets (planMaxes in program_rx.js): "TM 100"
  //  - an accessory lift (no %, in a strength row, not arm care, re-education, throwing or speed): a dumbbell lift
  //    gets 5 lb more than the last week of this phase it was logged, a barbell lift 10 ("+5 from Oct 22"). Other
  //    implements (kettlebells, cables, bands, machines) get no suggestion. On a deload week, week 1's weight from
  //    this phase instead; the weeks after a deload build on the week before it (a deload that opens the phase counts).
  const isDeload = (week) => /deload/i.test((week || {}).name || "");
  const NOT_STEPPED = /\bkb\b|kettlebell|cable|band|machine|landmine|sled|keiser|vest|plate/i;
  const DB_LIFT = /\bdb\b|dumbbell/i;
  const BB_LIFT = /\bbb\b|barbell|trap bar|hex bar|safety bar|\bssb\b|squat|bench press|deadlift|\brdl\b|bent over row|overhead press|\bohp\b|good morning|hip thrust|clean|snatch|jerk/i;
  const stepFor = (name) => (NOT_STEPPED.test(name) ? null : DB_LIFT.test(name) ? 5 : BB_LIFT.test(name) ? 10 : null);
  function accessorySuggestion(item, si, e, g, gi) {
    if (/arm\s*care|re-?ed|correct|rehab|throw|speed|sprint|run/i.test((item.lane || {}).name || "")) return null;
    if (unloaded(item, e) || Rx.accumulated(e, g)) return null;
    const step = stepFor(e.name || "");
    if (!step) return null;
    const pid = item.program.id, name = Rx.liftKey(e.name), len = item.program.weeks.length;
    const weekAt = (wk) => item.program.weeks[(wk - item.block.start) % len] || {};
    const same = (x) => Rx.liftKey(x.name) === name;
    const nth = ((((item.week.sessions || [])[si] || {}).exercises) || []).filter(same).indexOf(e);
    // the weight logged for this set on that week's same day (the same exercise, its set paired as for "last time")
    const on = (wk) => {
      const prev = ((((weekAt(wk).sessions || [])[si] || {}).exercises) || []).filter(same)[Math.max(0, nth)];
      if (!prev || prev.id === e.id) return null;
      const keys = [Rx.logKey(prev, pairGroup(prev, e, gi).gi)];
      const w = parseFloat(logged(pid, keys[0]));
      return w > 0 ? { w, when: loggedWhen(wk, null, pid, keys) } : null;
    };
    if (isDeload(weekAt(weekIdx))) {
      const first = weekIdx > item.block.start ? on(item.block.start) : null;
      return first ? { value: first.w, note: "Week 1 wt (deload)" } : null;
    }
    for (let wk = weekIdx - 1; wk >= item.block.start; wk -= 1) {
      if (isDeload(weekAt(wk)) && wk !== item.block.start) continue;
      const last = on(wk);
      if (last) return { value: last.w + step, note: `+${step} from ${last.when}` };
    }
    return null;
  }
  function suggestFor(item, si, e, g, gi, maxes) {
    if (Rx.normalize(e).intensityUnit === "%" && parseFloat(g.intensity) > 0) {
      const max = maxes.before(e.name, weekIdx, si);
      const v = max ? Rx.weightAt(max.value, g) : null;
      return v ? { value: v, note: max.tm ? `TM ${max.value}` : "" } : null;
    }
    return accessorySuggestion(item, si, e, g, gi);
  }

  // ---- "add to home screen" tip ------------------------------------------------------------------------
  // Until the athlete has put the page on their home screen, a small tip above the program says how. On Android
  // (and desktop Chrome) the browser offers to install it, so the tip has an Install button that brings that up;
  // on an iPhone it can only be done from the Share menu, so the tip says where. Closing it hides it for good on
  // this phone. Never shown in Coach Mode or once the page is running from the home screen.
  let installEvent = null;
  window.addEventListener("beforeinstallprompt", (ev) => { ev.preventDefault(); installEvent = ev; if (view === "program") render(); });
  const standalone = () => window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  function installTip() {
    let dismissed = false;
    try { dismissed = localStorage.getItem("installTipClosed") === "1"; } catch (e) { /* storage blocked */ }
    if (coachId || !token || standalone() || dismissed) return null;
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const close = () => { try { localStorage.setItem("installTipClosed", "1"); } catch (e) { /* storage blocked */ } render(); };
    const install = async () => { if (!installEvent) return; installEvent.prompt(); try { await installEvent.userChoice; } catch (e) { /* closed */ } installEvent = null; render(); };
    return el("div", { class: "install-tip" },
      el("div", null,
        el("strong", null, "Put this on your home screen"),
        installEvent
          ? el("span", null, "It opens like an app, straight to your program.")
          : ios
            ? el("span", null, "Tap the Share button (the square with an arrow), then “Add to Home Screen”. It opens like an app, straight to your program.")
            : el("span", null, "Open your browser menu and choose “Add to Home screen” or “Install app”. It opens like an app, straight to your program."),
        installEvent ? el("div", null, el("button", { class: "install-go", onclick: install }, "Install")) : null),
      el("button", { class: "install-x", "aria-label": "Close this tip", onclick: close }, "×"));
  }

  // Drills with nothing to lift (sprints, jumps, mobility, the group speed sessions a coach sends) get no weight
  // box: there is nothing to write in it. Anything naming an implement keeps the box.
  const LOADED = /barbell|dumbbell|\bdb\b|\bbb\b|kettlebell|\bkb\b|trap bar|hex bar|med ball|\bmb\b|medicine ball|sled|weighted|cable|machine|safety bar|\bssb\b|landmine|\blm\b|plate|vest|keiser|belt squat|smith|ez bar|press|curl|row\b|squat|deadlift|lunge|rdl|bench|pull-?down/i;
  const UNLOADED = /sprint|\brun\b|running|jog|shuffle|skip|carioca|bound|hop|jump|mobility|stretch|breath|plank|bird dog|dead bug|walk|march|crawl|acceleration|flying|pogo|agility|cone|start\b|warm-?up|foam roll|90\/90|cat cow|t-spine|thoracic/i;
  const unloaded = (item, e) => {
    const name = e.name || "";
    if (e.section) return true; // a drill on a speed day: nothing to weigh (a best time, if asked for, has its own box)
    if (LOADED.test(name)) return false;
    return String(item.program.id || "").startsWith("gspeed-") || UNLOADED.test(name);
  };

  // ---- timer for timed sets ---------------------------------------------------------------------------
  // A set prescribed as a time (a 30s plank, a 1:00 carry, a "Time 0:45" box) gets a timer button, so the athlete
  // can time it without leaving the page: a big countdown with start / pause / reset, a beep and a buzz at zero, and
  // a second round for sets done each side.
  const secondsIn = (text) => {
    const t = `${text || ""}`;
    let m = /(\d+):(\d{2})/.exec(t);
    if (m) return Number(m[1]) * 60 + Number(m[2]);
    m = /(\d+(?:\.\d+)?)\s*(?:s|sec|secs|second|seconds)\b/i.exec(t);
    if (m) return Math.round(Number(m[1]));
    m = /(\d+(?:\.\d+)?)\s*(?:m|min|mins|minute|minutes)\b/i.exec(t);
    if (m) return Math.round(Number(m[1]) * 60);
    return null;
  };
  const eachSide = Rx.sided; // "8E", "30 SEC E", "5-E", "each"
  const clock = (s) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.max(0, s) % 60).padStart(2, "0")}`;
  const beep = () => {
    try {
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.35, 0.7].forEach((at) => {
        const o = ac.createOscillator(), gn = ac.createGain();
        o.frequency.value = 880; gn.gain.value = 0.25;
        o.connect(gn); gn.connect(ac.destination);
        o.start(ac.currentTime + at); o.stop(ac.currentTime + at + 0.2);
      });
      setTimeout(() => ac.close(), 1500);
    } catch (err) { /* no sound */ }
    try { if (navigator.vibrate) navigator.vibrate([300, 150, 300]); } catch (err) { /* no buzz */ }
  };
  // Two more ways it runs (opts.mode):
  //  "acc": an accumulated iso (Rx.accumulated). The clock only runs while they hold: each Start is a set, Stop
  //    when the hold breaks, until the time is used up. A sided one runs the left side, then the right.
  //  "edt": an EDT block. One countdown for the block, and a +1 button for each time through (a set).
  // Closing it hands the counts ([left or only, right]) to opts.onDone, which fills in the log boxes. The screen
  // is kept awake while it runs, where the phone allows it.
  function openTimer(name, seconds, sides, opts) {
    const o = opts || {}, acc = o.mode === "acc", edt = o.mode === "edt";
    let left = seconds, running = false, tick = null, round = 1, last = 0, lock = null;
    const counts = [0, 0];
    const rounds = sides ? 2 : 1;
    const sideName = () => (!sides ? "" : acc ? (round === 1 ? "Left side" : "Right side") : (round === 1 ? "First side" : "Second side"));
    const face = el("div", { class: "timer-face" }, clock(left));
    const label = el("div", { class: "timer-round" }, sideName());
    const count = el("div", { class: "timer-count" });
    const go = el("button", { class: "primary" }, "Start");
    const reset = el("button", null, "Reset");
    const plus = edt ? el("button", { class: "timer-plus", onclick: () => { counts[0] += 1; draw(); } }, "+1 set") : null;
    const minus = edt ? el("button", { class: "timer-minus", "aria-label": "One set less", onclick: () => { counts[0] = Math.max(0, counts[0] - 1); draw(); } }, "−") : null;
    const awake = async (on) => {
      try {
        if (on && !lock && navigator.wakeLock) lock = await navigator.wakeLock.request("screen");
        if (!on && lock) { lock.release(); lock = null; }
      } catch (err) { /* the screen may sleep */ }
    };
    const stop = () => { running = false; clearInterval(tick); tick = null; };
    const draw = () => {
      face.textContent = clock(left);
      face.className = `timer-face${left <= 3 && running ? " ending" : ""}${left <= 0 ? " done" : ""}`;
      label.textContent = sideName();
      go.disabled = false;
      if (acc) {
        const n = counts[round - 1];
        go.textContent = running ? "Stop (hold broke)" : left <= 0 ? (round < rounds ? "Start right side" : "Finished") : n ? `Start set ${n + 1}` : "Start set 1";
        go.disabled = !running && left <= 0 && round >= rounds;
        count.textContent = [n ? `Set ${n}` : "", sides && round === 2 ? `Left took ${counts[0]} set${counts[0] === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ");
      } else {
        go.textContent = running ? "Pause" : left <= 0 ? (round < rounds ? "Other side" : "Again") : left < seconds ? "Resume" : "Start";
        if (edt) count.textContent = `${counts[0]} set${counts[0] === 1 ? "" : "s"} done`;
      }
    };
    const run = () => {
      if (running) { stop(); draw(); return; }
      if (left <= 0) {
        if (round < rounds) round += 1;
        else if (acc) return;
        else { round = 1; if (edt) counts[0] = 0; }
        left = seconds;
      }
      if (acc) counts[round - 1] += 1;
      running = true; last = Date.now(); awake(true);
      tick = setInterval(() => {
        while (running && Date.now() - last >= 1000) { // catches up after the phone held the page back
          last += 1000; left -= 1;
          if (left <= 0) { left = 0; stop(); beep(); }
        }
        draw();
      }, 100);
      draw();
    };
    go.addEventListener("click", run);
    reset.addEventListener("click", () => { stop(); left = seconds; round = 1; counts[0] = 0; counts[1] = 0; draw(); });
    const close = () => {
      stop(); awake(false);
      if (o.onDone && (counts[0] || counts[1])) o.onDone(counts.slice());
      closeVideo();
    };
    draw();
    overlay.replaceChildren(el("div", { class: "sheet timer-sheet" },
      el("button", { class: "close", "aria-label": "Close", onclick: close }, "×"),
      el("h2", null, name),
      o.hint ? el("div", { class: "timer-hint" }, o.hint) : null,
      label, face, (acc || edt) ? count : null,
      edt ? el("div", { class: "timer-sets" }, minus, plus) : null,
      el("div", { class: "swap-actions" }, go, reset, el("button", { onclick: close }, (acc || edt) ? "Done · log it" : "Done"))));
    overlay.className = "overlay show";
  }
  // the timer button for a set group, when its reps (or the exercise's Time box) are a time
  const timerFor = (e, g) => {
    if (Rx.accumulated(e, g)) return null; // it has its own (accBox)
    const timeBox = (Rx.extras(e).find((x) => /^time$/i.test((x.label || "").trim())) || {}).value;
    const secs = secondsIn(g.reps) || secondsIn(timeBox);
    if (!secs || secs > 3600) return null;
    const sides = eachSide(g.reps);
    return el("button", { class: "timer-btn", title: `Time this set: ${clock(secs)}${sides ? " each side" : ""}`, onclick: () => openTimer(e.name, secs, sides) }, `⏱ ${clock(secs)}`);
  };

  // ---- accumulated isos and EDT blocks ----------------------------------------------------------------
  // An iso held longer than a minute (Rx.accumulated) is built up in as many sets as it takes: its row has a box
  // for the sets (L and R on a sided one) and the accumulate timer, which counts them and fills the boxes in. A
  // weight box too, but only when it names an implement (a bodyweight extreme iso has nothing to weigh).
  const ACC_LOADED = /barbell|dumbbell|\bdb\b|\bbb\b|kettlebell|\bkb\b|keiser|cable|weighted|vest|plate|trap bar|safety bar|\bssb\b|landmine|machine/i;
  const accWeighed = (e) => ACC_LOADED.test(e.name || "");
  function accBox(item, si, e, g, gi) {
    const pid = item.program.id, key = Rx.repsLogKey(e, gi), wKey = Rx.logKey(e, gi);
    const secs = Rx.accumulated(e, g), sides = Rx.sided(g.reps);
    const box = (ph, label) => el("input", { type: "text", inputmode: "numeric", placeholder: ph, "aria-label": label, autocomplete: "off" });
    const one = sides ? null : box("sets", `Sets it took for ${e.name}`);
    const L = sides ? box("L sets", `Sets it took on the left for ${e.name}`) : null;
    const R = sides ? box("R sets", `Sets it took on the right for ${e.name}`) : null;
    const weight = accWeighed(e) ? box("wt", "Weight used") : null;
    if (weight) weight.setAttribute("inputmode", "decimal");
    const inputs = [weight, one, L, R].filter(Boolean);
    const refresh = () => {
      const s = Rx.accSets(logged(pid, key));
      const put = (i, v) => { if (i && document.activeElement !== i) i.value = v || ""; };
      put(one, s.one != null ? s.one : s.l || s.r); put(L, s.l != null ? s.l : s.one); put(R, s.r);
      put(weight, logged(pid, wKey));
    };
    const digits = (i) => (i ? i.value.replace(/[^\d]/g, "") : "");
    const store = () => save(pid, key, sides ? Rx.accValue({ l: digits(L), r: digits(R) }) : Rx.accValue({ one: digits(one) }));
    [one, L, R].filter(Boolean).forEach((i) => { i.addEventListener("focus", () => i.select()); i.addEventListener("blur", () => { store(); refresh(); }); });
    if (weight) { weight.addEventListener("focus", () => weight.select()); weight.addEventListener("blur", () => save(pid, wKey, weight.value.trim())); }
    inputs.forEach((i) => i.addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter") return;
      ev.preventDefault();
      const all = [...document.querySelectorAll("main .boxes input")];
      const next = all[all.indexOf(i) + 1];
      if (next) next.focus(); else i.blur();
    }));
    derived.push(refresh);
    refresh();
    const each = sides ? " each side" : "";
    const onDone = (c) => {
      const s = Rx.accSets(logged(pid, key));
      save(pid, key, sides
        ? Rx.accValue({ l: c[0] ? String(c[0]) : s.l || s.one || "", r: c[1] ? String(c[1]) : s.r || "" })
        : Rx.accValue({ one: String(c[0]) }));
      refresh();
      showStatus("Sets logged");
    };
    const last = lastLogged(item, si, e, gi);
    return el("div", { class: "set acc" },
      el("span", { class: "reps" }, Rx.repsText(g)),
      el("div", { class: "boxes" }, ...inputs),
      el("button", { class: "timer-btn", title: `Accumulate ${clock(secs)}${each}`, onclick: () => openTimer(e.name, secs, sides, { mode: "acc", onDone, hint: `Build up ${clock(secs)}${each}. Start when you set the hold, Stop when it breaks, rest, and go again until the time runs out.` }) }, `⏱ ${clock(secs)}${sides ? " ×2" : ""}`),
      last && last.r ? el("span", { class: "last" }, `${last.when}: ${Rx.loggedText(e, g, last.w, last.r)}`) : null,
      el("div", { class: "acc-hint" }, `Accumulate ${clock(secs)}${each}: log how many sets it took.`));
  }
  // An EDT block (Rx.edtMinutes on one of its exercises): a bar at the top of the card with the block's
  // countdown and a box for the sets done (times through A1, A2...). Its sets finish the block.
  function edtBar(item, b) {
    const first = b.rows.find((e) => Rx.edtMinutes(e));
    if (!first) return;
    b.edt = first;
    const pid = item.program.id, key = Rx.edtKey(first), mins = Rx.edtMinutes(first), secs = Math.round(mins * 60);
    const box = el("input", { type: "text", inputmode: "numeric", placeholder: "sets", "aria-label": `Sets of ${b.letter} done in ${mins} minutes`, autocomplete: "off", value: logged(pid, key) });
    box.addEventListener("focus", () => box.select());
    box.addEventListener("blur", () => { box.value = box.value.replace(/[^\d]/g, ""); save(pid, key, box.value); });
    const span = b.rows.length > 1 ? `${b.letter}1–${b.letter}${b.rows.length}` : `${b.letter}1`;
    const onDone = (c) => { box.value = String(c[0]); save(pid, key, box.value); showStatus("Sets logged"); };
    b.card.prepend(el("div", { class: "edt-bar" },
      el("div", { class: "edt-title" }, el("strong", null, `EDT · ${mins} min`), el("span", null, `Go through ${span} back to back for ${mins} minutes. Each time through is one set.`)),
      el("div", { class: "edt-log" },
        el("button", { class: "timer-btn", onclick: () => openTimer(`${b.letter} · EDT ${mins} min`, secs, false, { mode: "edt", onDone, hint: `${b.rows.map((e) => e.name.trim()).join(" → ")}. Tap +1 set each time you finish ${b.letter}${b.rows.length}.` }) }, `⏱ Start ${clock(secs)}`),
        el("label", { class: "edt-box" }, el("span", null, "Sets done"), box))));
  }

  // ---- pre / post weight ------------------------------------------------------------------------------
  // Today's pre-lift weight is kept as their bodyweight: the nutrition plan follows it (nutrition.js) and it's charted
  // on Progress here and on the dashboard. It goes in the log of the program shown, under today's date as
  // "bw-YYYYMMDD|0" (a key the phone link's check takes: migration_007); whichever program holds a day's entry, it
  // counts. The post-lift weight is never saved: it only works out the water to drink back, 16 oz per pound lost.
  const postWeights = {}; // today's post-lift weight, on this page only
  const ymd = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  // every pre-lift weight logged: [{ date: "2026-10-22", lb, key, pid }], oldest first, one per day
  const weighIns = () => {
    const byDay = {};
    Object.keys(plan.programLog || {}).forEach((pid) => Object.keys(plan.programLog[pid] || {}).forEach((key) => {
      const m = /^bw-(\d{4})(\d{2})(\d{2})\|0$/.exec(key), lb = parseFloat(plan.programLog[pid][key]);
      if (m && lb > 0) byDay[`${m[1]}-${m[2]}-${m[3]}`] = { date: `${m[1]}-${m[2]}-${m[3]}`, lb, key, pid };
    }));
    return Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date));
  };
  function weighIn(item) {
    const key = `bw-${ymd(new Date())}|0`;
    const onPlan = new Set((plan.blocks || []).map((b) => String(b.programId)));
    // today's entry stays in the program that already holds it, if that one is still on the plan
    const owner = () => (Object.keys(plan.programLog || {}).find((pid) => (plan.programLog[pid] || {})[key] && onPlan.has(String(pid))) || item.program.id);
    const now = () => { const w = weighIns().find((x) => x.key === key); return w ? String(w.lb) : ""; };
    const box = (label, value) => el("input", { type: "text", inputmode: "decimal", placeholder: "lb", "aria-label": label, autocomplete: "off", value });
    const pre = box("Pre weight in pounds", now()), post = box("Post weight in pounds (not saved)", postWeights[key] || "");
    const out = el("div", { class: "bw-out" });
    const before = weighIns().filter((x) => x.key !== key).pop();
    const draw = () => {
      const a = parseFloat(pre.value), b = parseFloat(post.value);
      out.className = "bw-out";
      if (b > 0 && !(a > 0)) { out.textContent = "Add your pre weight to see how much water to drink back."; return; }
      if (!(a > 0) || !(b > 0)) { out.textContent = before && !(a > 0) ? `Last pre weight: ${before.lb} lb (${new Date(`${before.date}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })})` : ""; return; }
      const lost = Math.round((a - b) * 10) / 10;
      if (lost <= 0) { out.textContent = "No weight lost. Keep sipping water as normal."; return; }
      const oz = Math.round(lost * 16);
      out.className = "bw-out drink";
      out.replaceChildren(el("strong", null, `Drink ${oz} oz of water`), ` · down ${lost.toFixed(1)} lb (16 oz for each pound lost), over the next couple of hours`);
      // the drink-back goes on today's water goal (the ounces only; the post weight still isn't kept)
      if (foodDays) {
        const dk = todayKey(), on = Math.round(+waterOf(dk).extra || 0) === oz;
        out.append(el("button", { class: "bw-water", disabled: on, onclick: () => { setWater(dk, { extra: oz }); showStatus(`Added ${oz} oz to today's water goal`); draw(); } }, on ? "On today's water goal ✓" : `Add ${oz} oz to today's water goal`));
      }
    };
    pre.addEventListener("focus", () => pre.select());
    pre.addEventListener("input", draw);
    pre.addEventListener("blur", () => {
      const v = parseFloat(pre.value.replace(/[^\d.]/g, ""));
      const ok = v >= 50 && v <= 500 ? String(Math.round(v * 10) / 10) : "";
      if (pre.value.trim() && !ok) showStatus("That weight doesn't look right", true);
      pre.value = ok;
      save(owner(), key, ok);
      draw();
    });
    post.addEventListener("focus", () => post.select());
    post.addEventListener("input", () => { postWeights[key] = post.value; draw(); });
    draw();
    return el("div", { class: "bw-card" },
      el("div", { class: "bw-row" },
        el("label", { class: "bw-box" }, el("span", null, "Pre Weight"), pre),
        el("label", { class: "bw-box" }, el("span", null, "Post Weight"), post)),
      out);
  }

  // ---- one set group -----------------------------------------------------------------------------
  // ---- a finished block folds up ---------------------------------------------------------------------
  // Each card of the day (A, B, ...: one exercise, or the exercises of a superset) shrinks to a single line once
  // it's done, so the next block moves up. Done means every set in it that takes a weight has one written in (and
  // the reps, on a set to failure), or the athlete tapped Done: a block with nothing to weigh (a plank, a drill)
  // only folds that way. A logged session folds every block. Tapping a folded block opens it again. The Done taps
  // are kept on this phone.
  const openBlocks = new Set(); // folded blocks opened again with a tap, until the page is reloaded
  const doneKey = (item, si) => `blocksDone:${token || coachId}:${item.program.id}:${item.weekNo}:${si}`;
  const tappedDone = (item, si) => { try { return JSON.parse(localStorage.getItem(doneKey(item, si)) || "[]"); } catch (e) { return []; } };
  function foldable(item, si, b) {
    const pid = item.program.id, id = `${pid}|${item.weekNo}|${si}|${b.letter}`;
    // the sets in the block that take something written in
    const sets = b.rows.flatMap((e) => Rx.groups(e).map((g, gi) => ({ e, g, gi }))).filter((x) => !unloaded(item, x.e) || Rx.failure(x.g) || Rx.accumulated(x.e, x.g));
    const filled = ({ e, g, gi }) => (Rx.accumulated(e, g) // its sets (and its weight, if it takes one)
      ? !!logged(pid, Rx.repsLogKey(e, gi)) && (!accWeighed(e) || !!logged(pid, Rx.logKey(e, gi)))
      : unloaded(item, e)
        ? !!logged(pid, Rx.repsLogKey(e, gi))
        : !!logged(pid, Rx.logKey(e, gi)) && (!Rx.failure(g) || !!logged(pid, Rx.repsLogKey(e, gi))));
    const isDone = () => !!logged(pid, sessionKey(item, si)) || tappedDone(item, si).includes(b.letter) || (b.edt && !!logged(pid, Rx.edtKey(b.edt))) || (sets.length > 0 && sets.every(filled));
    const summary = el("button", { class: "blk-sum", onclick: () => { openBlocks.add(id); update(); } },
      el("span", { class: "blk-check", "aria-hidden": "true" }, "✓"),
      el("span", { class: "blk-letter" }, b.letter),
      el("span", { class: "blk-names" }, b.rows.map((e) => e.name.trim()).join(" · ")),
      el("span", { class: "blk-open" }, "Show"));
    const doneBtn = el("button", { class: "blk-done", onclick: () => {
      if (!isDone()) {
        try { localStorage.setItem(doneKey(item, si), JSON.stringify([...tappedDone(item, si), b.letter])); } catch (e) { /* private window: folds for now only */ openBlocks.delete(id); b.card.classList.add("folded"); return; }
      }
      openBlocks.delete(id);
      update();
    } });
    const update = () => {
      const done = isDone();
      b.card.classList.toggle("done", done);
      b.card.classList.toggle("folded", done && !openBlocks.has(id));
      doneBtn.textContent = done ? "Fold up" : `✓ Done with ${b.letter}`;
    };
    b.card.prepend(summary);
    b.card.append(el("div", { class: "blk-foot" }, doneBtn));
    derived.push(update); // weights written in anywhere can finish the block
    update();
  }

  function setBox(item, si, e, g, gi) {
    const pid = item.program.id;
    const fail = Rx.failure(g);
    const wKey = Rx.logKey(e, gi), rKey = Rx.repsLogKey(e, gi);
    const int = Rx.intensityText(e, g);
    if (Rx.accumulated(e, g)) return accBox(item, si, e, g, gi);
    if (unloaded(item, e)) {
      // reps only, plus a reps box on a set taken to failure (a max-rep push-up, say)
      const repsOnly = fail ? el("input", { type: "text", inputmode: "numeric", placeholder: "reps", "aria-label": `Reps reached${fail.each ? " each side" : ""}`, autocomplete: "off", value: logged(pid, rKey) }) : null;
      if (repsOnly) {
        repsOnly.addEventListener("focus", () => repsOnly.select());
        repsOnly.addEventListener("blur", () => save(pid, rKey, repsOnly.value.trim()));
      }
      return el("div", { class: "set noload" }, el("span", { class: "reps" }, Rx.repsText(g)), repsOnly ? el("div", { class: "boxes" }, repsOnly) : null, int ? el("span", { class: "pct" }, int) : null, timerFor(e, g));
    }
    const weight = el("input", { type: "text", inputmode: "decimal", enterkeyhint: "next", placeholder: "wt", "aria-label": "Weight used", autocomplete: "off" });
    const reps = fail ? el("input", { type: "text", inputmode: "numeric", placeholder: "reps", "aria-label": `Reps reached${fail.each ? " each side" : ""}`, autocomplete: "off" }) : null;
    const est = el("span", { class: "est" });
    let auto = null;
    // works out the filled-in weight and the estimate again; never touches a box the athlete is typing in
    const refresh = () => {
      const sug = suggestFor(item, si, e, g, gi, window.planMaxes(plan, programById));
      const has = logged(pid, wKey);
      auto = sug && !has ? sug.value : null;
      if (document.activeElement !== weight) { weight.value = has || (auto ? `${auto}` : ""); weight.className = auto ? "auto" : ""; }
      if (reps && document.activeElement !== reps) reps.value = logged(pid, rKey);
      const used = has || (auto ? `${auto}` : "");
      const value = fail ? Rx.estimate1RM(used, logged(pid, rKey)) : null;
      est.textContent = value ? `Est. 1RM ${value}` : auto && sug.note ? sug.note : ""; // where a filled-in weight came from
    };
    weight.addEventListener("focus", () => { weight.className = ""; weight.select(); });
    weight.addEventListener("blur", () => {
      const v = weight.value.trim();
      if (!logged(pid, wKey) && auto && v === `${auto}`) { refresh(); return; } // untouched filled-in weight stays automatic
      save(pid, wKey, v);
      refresh();
    });
    if (reps) {
      reps.addEventListener("focus", () => reps.select());
      reps.addEventListener("blur", () => { save(pid, rKey, reps.value.trim()); refresh(); });
    }
    // Enter (or Next on the keyboard) moves on to the next box on the page instead of just closing the keyboard
    [weight, reps].forEach((i) => i && i.addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter") return;
      ev.preventDefault();
      const boxes = [...document.querySelectorAll("main .boxes input")];
      const next = boxes[boxes.indexOf(i) + 1];
      if (next) next.focus(); else i.blur();
    }));
    derived.push(refresh);
    refresh();
    const last = lastLogged(item, si, e, gi);
    const setWeight = (v) => { save(pid, wKey, v); refresh(); };
    // − and + change the weight 5 at a time, starting from what is in the box (or last week's, or nothing)
    const step = (by) => () => {
      const now = parseFloat(weight.value) || parseFloat(last && last.w) || 0;
      setWeight(String(Math.max(0, Math.round((now + by) * 10) / 10)));
    };
    // last week's numbers, tapped, are copied into this set
    const useLast = () => {
      if (last.w) setWeight(last.w);
      if (reps && last.r) { save(pid, rKey, last.r); refresh(); }
      showStatus("Same as last time");
    };
    return el("div", { class: `set${fail ? " fail" : ""}` },
      el("span", { class: "reps" }, Rx.repsText(g)),
      el("div", { class: "boxes" }, weight, reps),
      // under the box, so the box keeps its full width in a narrow column
      el("div", { class: "steps" },
        el("button", { class: "step", "aria-label": `5 less for ${e.name}`, onclick: step(-5) }, "−5"),
        el("button", { class: "step", "aria-label": `5 more for ${e.name}`, onclick: step(5) }, "+5")),
      int ? el("span", { class: "pct" }, int) : null,
      est,
      last ? el("button", { class: "last", title: `Logged in week ${last.week} (${last.when}). Tap to use the same numbers.`, onclick: useLast }, `${last.when}: ${last.text}`, el("b", null, " · use")) : null,
      timerFor(e, g));
  }

  // ---- player plan: where the plan is now, the timeline row by row, goals and the action plan --------
  // the menu is a bar along the bottom of the screen, so the top stays small and the workout starts high up
  const MENU_ICONS = {
    program: '<path d="M6.5 7v10M17.5 7v10M3.5 9.5v5M20.5 9.5v5M6.5 12h11"/>',
    progress: '<path d="M4 4v16h16"/><path d="M7.5 15l4-4.5 3 3L20 7"/>',
    plan: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
    equipment: '<path d="M10 6h10M10 12h10M10 18h10M3.5 6l1.5 1.5L7.5 5M3.5 12l1.5 1.5 2.5-2.5M3.5 18l1.5 1.5 2.5-2.5"/>',
    coach: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 10h6M9 14h6M9 18h3"/>',
    nutrition: '<path d="M12 8c-1.6-1.6-5.2-1.7-6.6 1.2-1.3 2.7-.6 6.9 1.9 9.7 1.3 1.4 2.8 1.6 4.7.8 1.9.8 3.4.6 4.7-.8 2.5-2.8 3.2-7 1.9-9.7C17.2 6.3 13.6 6.4 12 8z"/><path d="M12 8c0-2.2 1-3.8 3-4.6"/>',
  };
  // Nutrition shows once the athlete has a nutrition plan (and always for a coach, who can see where it will be)
  const menu = () => el("nav", { class: "menu", role: "tablist" },
    [["program", "Program"], ["progress", "Progress"]].concat(nutrition || staff || coachId ? [["nutrition", "Nutrition"]] : [], remote ? [["equipment", "Equipment"]] : [], staff ? [["coach", "Coach"]] : []).map(([id, text]) => {
      const icon = el("span", { class: "menu-icon", "aria-hidden": "true" });
      icon.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${MENU_ICONS[id]}</svg>`;
      // the coach button offers Coach Mode or the dashboard, each its own page with a way back here
      const go = id === "coach" ? openCoachMenu : () => { view = id; render(); window.scrollTo(0, 0); };
      return el("button", { class: `menu-item${view === id ? " on" : ""}${id === "coach" ? " to-coach" : ""}`, role: id === "coach" ? null : "tab", "aria-selected": id === "coach" ? null : view === id ? "true" : "false", onclick: go }, icon, el("span", null, text));
    }));
  // Create Quick Session and Assign Existing Program (quick_assign.js), in the coach menu and on a coach's empty
  // program page; something put on their own plan reloads the page so it shows
  const quickTools = () => (window.QuickAssign ? [
    el("button", { class: "primary", onclick: () => window.QuickAssign.open({ overlay, close: closeVideo, status: showStatus, mode: "build", onAssignedSelf: () => setTimeout(() => window.location.reload(), 600) }) }, "Create Quick Session"),
    el("button", { class: "primary", onclick: () => window.QuickAssign.open({ overlay, close: closeVideo, status: showStatus, onAssignedSelf: () => setTimeout(() => window.location.reload(), 600) }) }, "Assign Existing Program"),
  ] : []);
  function openCoachMenu() {
    const to = (href) => () => { window.location.href = href; };
    overlay.replaceChildren(el("div", { class: "sheet coach-menu" },
      el("button", { class: "close", "aria-label": "Close", onclick: closeVideo }, "×"),
      el("h2", null, "Coach tools"),
      el("div", { class: "swap-coach" }, "Sign in with your dashboard account. Each has a way back to your program."),
      el("div", { class: "swap-actions" },
        el("button", { class: "primary", onclick: to("coach.html?from=app") }, "Coach Mode"),
        el("button", { class: "primary", onclick: to("index.html?from=app") }, "Dashboard"),
        quickTools(),
        el("button", { onclick: closeVideo }, "Cancel"))));
    overlay.className = "overlay show";
  }
  const blockDates = (b) => {
    const a = parseISO(plan.startDate); a.setDate(a.getDate() + b.start * 7);
    const z = new Date(a); z.setDate(z.getDate() + b.len * 7 - 1);
    const f = (d) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    return `Wk ${b.start + 1}${b.len > 1 ? `–${b.start + b.len}` : ""} · ${f(a)} – ${f(z)}`;
  };
  // ---- Training Log on the Plan tab ---------------------------------------------------------------------
  // A month calendar of what they did: a dot on each day a session was logged (red) or a test done (green), and
  // the day tapped shown underneath, each exercise with the weights and reps logged. A session's day is when Log
  // session was pressed, or else when its last weight was entered (athlete_portal_log_times); a quick session
  // without either goes on its own date.
  let tlMonth = null, tlDay = null;
  function trainingLogSection() {
    const pad = (n) => String(n).padStart(2, "0");
    const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const dayOf = (iso) => { if (!iso) return ""; const d = new Date(iso); return isNaN(d) ? "" : key(d); };
    const byDay = {};
    const put = (k, item) => { if (k) (byDay[k] = byDay[k] || []).push(item); };
    let undated = 0;
    const seen = new Set();
    (plan.blocks || []).filter((b) => b.programId && !seen.has(b.programId) && seen.add(b.programId)).forEach((b) => {
      const program = programById(b.programId), log = (plan.programLog || {})[b.programId] || {};
      if (!program) return;
      (program.weeks || []).forEach((w, wi) => (w.sessions || []).forEach((s, si) => {
        const rows = (s.exercises || []).filter((e) => (e.name || "").trim());
        const labels = window.exerciseLabels(rows);
        let latest = "";
        const done = rows.map((e, ei) => {
          const sets = Rx.groups(e).map((g, gi) => {
            const wk = Rx.logKey(e, gi), rk = Rx.repsLogKey(e, gi), wt = log[wk], rp = log[rk];
            [wk, rk].forEach((k) => { const at = logTimes[`${b.programId}|${k}`]; if (log[k] && at && at > latest) latest = at; });
            return wt || rp ? Rx.loggedText(e, g, wt, rp).replace(" x ", " × ") : null;
          }).filter(Boolean);
          const ek = Rx.edtMinutes(e) ? Rx.edtKey(e) : null; // an EDT block's sets, on the exercise with its note
          if (ek && log[ek]) {
            sets.unshift(`EDT ${Rx.edtMinutes(e)} min: ${log[ek]} sets`);
            const at = logTimes[`${b.programId}|${ek}`]; if (at && at > latest) latest = at;
          }
          return { label: labels[ei] || "", name: e.name.trim(), sets };
        });
        const markKey = `session-${wi}-${si}|0`, marked = !!log[markKey];
        if (!marked && !done.some((r) => r.sets.length)) return;
        const when = (marked && logTimes[`${b.programId}|${markKey}`]) || latest || (s.date ? `${s.date}T12:00:00` : "");
        const sent = window.isSentProgram(b.programId);
        const title = sent ? `${(s.name || "").trim() || "Quick session"}` : `${program.name} · ${w.name || `Week ${wi + 1}`} · ${(s.name || "").trim() || `Day ${si + 1}`}`;
        if (!when) { undated += 1; return; }
        put(dayOf(when), { kind: "lift", title, marked, rows: marked ? done : done.filter((r) => r.sets.length) });
      }));
    });
    (tests || []).forEach((t) => { if (t.date && Number.isFinite(testValue(t))) put(t.date, { kind: "test", title: t.kpiName, text: `${nice(testValue(t))}${t.unit ? ` ${t.unit}` : ""}${Array.isArray(t.trials) && t.trials.length > 1 ? ` (trials ${t.trials.join(", ")})` : ""}` }); });
    const days = Object.keys(byDay).sort();
    if (!days.length && !undated) return null;
    const newest = days[days.length - 1];
    if (!tlMonth) { const d = newest ? new Date(`${newest}T12:00:00`) : new Date(); tlMonth = { y: d.getFullYear(), m: d.getMonth() }; }
    const picked = tlDay && byDay[tlDay] ? tlDay : newest;
    const first = new Date(tlMonth.y, tlMonth.m, 1);
    const start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7));
    const cells = Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
    while (cells.length > 35 && cells[cells.length - 7].getMonth() !== tlMonth.m) cells.splice(-7);
    const redraw = () => { const y = window.scrollY; render(); window.scrollTo(0, y); };
    const step = (n) => () => { const d = new Date(tlMonth.y, tlMonth.m + n, 1); tlMonth = { y: d.getFullYear(), m: d.getMonth() }; redraw(); };
    const today = key(new Date());
    const grid = el("div", { class: "tl-grid" },
      ["M", "T", "W", "T", "F", "S", "S"].map((d) => el("div", { class: "tl-dow" }, d)),
      cells.map((d) => {
        const k = key(d), items = byDay[k] || [];
        const kinds = [...new Set(items.map((x) => x.kind))];
        return el("button", { class: ["tl-day", d.getMonth() !== tlMonth.m ? "out" : "", k === today ? "today" : "", items.length ? "has" : "", k === picked ? "on" : ""].filter(Boolean).join(" "), disabled: !items.length, "aria-label": `${d.toDateString()}${items.length ? `: ${items.map((x) => x.title).join(", ")}` : ""}`, onclick: () => { tlDay = k; redraw(); } },
          el("span", null, `${d.getDate()}`),
          items.length ? el("span", { class: "tl-dots" }, kinds.map((kd) => el("i", { class: kd }))) : null);
      }));
    const inMonth = days.filter((k) => k.startsWith(`${tlMonth.y}-${pad(tlMonth.m + 1)}`)).length;
    const detail = picked && byDay[picked] ? el("div", { class: "tl-detail" },
      el("div", { class: "tl-detail-day" }, new Date(`${picked}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })),
      byDay[picked].map((x) => x.kind === "test"
        ? el("div", { class: "tl-item test" }, el("b", null, x.title), el("span", null, x.text))
        : el("div", { class: "tl-item" }, el("b", null, x.title, x.marked ? el("span", { class: "tl-check" }, " ✓") : null),
          x.rows.map((r) => el("div", { class: "tl-ex" }, el("span", { class: "label" }, r.label), el("span", null, r.name), el("small", null, r.sets.length ? r.sets.join(", ") : "—")))))) : null;
    return [el("h2", { class: "section" }, "Training log", el("small", null, `${days.length} day${days.length === 1 ? "" : "s"} logged`)),
      el("div", { class: "card tl-card" },
        el("div", { class: "tl-head" },
          el("button", { class: "nav", "aria-label": "Previous month", onclick: step(-1) }, "‹"),
          el("div", null, first.toLocaleDateString(undefined, { month: "long", year: "numeric" }), el("small", null, `${inMonth} day${inMonth === 1 ? "" : "s"}`)),
          el("button", { class: "nav", "aria-label": "Next month", onclick: step(1) }, "›")),
        grid,
        el("div", { class: "tl-key" }, el("span", null, el("i", { class: "lift" }), "Session"), el("span", null, el("i", { class: "test" }), "Testing")),
        detail,
        undated ? el("div", { class: "card-sub" }, `${undated} older session${undated === 1 ? " was" : "s were"} logged before times were kept, so ${undated === 1 ? "it isn't" : "they aren't"} on the calendar.`) : null)];
  }

  function planView() {
    const now = currentWeek();
    const main = el("main");
    const started = new Date(new Date().toDateString()) >= parseISO(plan.startDate);
    const end = parseISO(plan.startDate); end.setDate(end.getDate() + plan.weeks * 7 - 1);
    const fmt = (d) => d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    // the plan's dates once a coach has built one (nothing on it yet: a note instead)
    if ((plan.blocks || []).length) {
      main.append(el("div", { class: "card" },
        el("div", { class: "card-title" }, started ? `Week ${now + 1} of ${plan.weeks}` : `Starts ${fmt(parseISO(plan.startDate))}`),
        el("div", { class: "bar" }, el("span", { style: `width:${started ? Math.round(((now + 1) / plan.weeks) * 100) : 0}%` })),
        el("div", { class: "card-sub" }, `${fmt(parseISO(plan.startDate))} – ${fmt(end)}`)));
    } else {
      main.append(el("div", { class: "card" }, el("div", { class: "card-title" }, "No plan yet"), el("div", { class: "card-sub" }, "Your plan’s timeline, goals and action plan show here once your coach builds it.")));
    }

    const lanes = (plan.lanes || []).filter((l) => (plan.blocks || []).some((b) => b.lane === l.id));
    if (lanes.length) main.append(el("h2", { class: "section" }, "Timeline"));
    lanes.forEach((l) => {
      const blocks = plan.blocks.filter((b) => b.lane === l.id).sort((a, b) => a.start - b.start);
      main.append(el("div", { class: "card" },
        el("div", { class: "card-title" }, l.name),
        blocks.map((b) => {
          const state = started && b.start <= now && now < b.start + b.len ? "now" : (started && b.start + b.len <= now ? "past" : "");
          return el("div", { class: `phase ${state}`, style: `border-left-color:${b.color || l.color || "#666"}` },
            el("div", { class: "phase-name" }, b.label || "Untitled", state === "now" ? el("span", { class: "now-tag" }, "Now") : null),
            el("div", { class: "phase-when" }, blockDates(b)));
        })));
    });

    const log = trainingLogSection();
    if (log) main.append(...log);

    const goals = plan.goals && typeof plan.goals === "object" ? plan.goals : {};
    [["physical", "Physical Goals"], ["skill", "Skill Goals"], ["habits", "Habits"]].forEach(([key, title]) => {
      const items = Array.isArray(goals[key]) ? goals[key].filter((g) => g && (g.text || "").trim()) : [];
      if (!items.length) return;
      main.append(el("h2", { class: "section" }, title, el("small", null, `${items.filter((g) => g.done).length} of ${items.length} achieved`)));
      main.append(el("div", { class: "card" }, items.map((g, i) => el("div", { class: `goal${g.done ? " done" : ""}` },
        el("span", { class: "goal-rank" }, `${i + 1}`), el("span", { class: "goal-mark" }, g.done ? "✓" : "○"), el("span", null, g.text)))));
    });

    const facility = (data.athlete.offseasonFacility || "").trim().replace(/\.$/, "");
    const first = (data.athlete.name || "").trim().split(/\s+/)[0];
    const lead = facility && first ? `This off-season, ${first} will be training at ${facility}.` : "";
    const action = typeof plan.actionPlan === "string" ? plan.actionPlan.trim() : "";
    if (lead || action) {
      main.append(el("h2", { class: "section" }, "Action Plan"));
      main.append(el("div", { class: "card action" }, lead ? el("p", { class: "lead" }, lead) : null, action || null));
    }
    return main;
  }

  // ---- logging a session ---------------------------------------------------------------------------
  // "Log session" at the end of a day marks that day of that program week as done. The mark is kept in the
  // same log as the weights, under a key of its own, so the coach's Training Log can show it with its time.
  // If some sets have no weight yet, a sheet asks for them first; the athlete can fill them in or skip.
  const sessionKey = (item, si) => `session-${item.weekNo - 1}-${si}|0`;
  // Coach Mode can finish the day showing here for a whole group at once ("Log session for everyone"): it asks
  // each athlete's page to mark its current day done, exactly as the Log session button does, without the
  // prompt for missing weights. `shown` is the day this page last drew.
  let shown = null; // { item, dayIdx }
  if (coachId) {
    window.addEventListener("message", (e) => {
      if (e.origin !== window.location.origin || !e.data || e.data.type !== "coach-log-session" || !shown) return;
      const { item, dayIdx: di } = shown;
      if (logged(item.program.id, sessionKey(item, di))) return;
      save(item.program.id, sessionKey(item, di), "done");
      render();
    });
  }

  function logSession(item, si, rows) {
    const pid = item.program.id;
    const maxes = window.planMaxes(plan, programById);
    const missing = []; // { e, sets: [{ g, gi, fail, suggest }] } for every set with no weight (or no reps, on a set to failure)
    rows.forEach((e) => {
      const sets = [];
      Rx.groups(e).forEach((g, gi) => {
        if (Rx.accumulated(e, g) && !accWeighed(e)) return; // a bodyweight extreme iso: its sets are in its own boxes
        if (unloaded(item, e) && !Rx.failure(g)) return; // nothing to weigh on a sprint or a mobility drill
        const fail = Rx.failure(g);
        if (logged(pid, Rx.logKey(e, gi)) && (!fail || logged(pid, Rx.repsLogKey(e, gi)))) return;
        const sug = suggestFor(item, si, e, g, gi, maxes);
        sets.push({ g, gi, fail, suggest: sug ? sug.value : null });
      });
      if (sets.length) missing.push({ e, sets });
    });
    // logged: the athlete gets the finish screen; a coach in Coach Mode just a note, to keep the session moving
    const finish = () => { save(pid, sessionKey(item, si), "done"); closeVideo(); render(); if (coachId) showStatus("Session logged"); else finishScreen(item, si, rows); };
    if (!missing.length) { finish(); return; }

    const fields = []; // { key, input }
    const body = missing.map(({ e, sets }) => el("div", { class: "log-ex" },
      el("div", { class: "log-name" }, e.name),
      el("div", { class: "sets" }, sets.map(({ g, gi, fail, suggest }) => {
        const has = logged(pid, Rx.logKey(e, gi));
        const weight = el("input", { type: "text", inputmode: "decimal", placeholder: "wt", value: has || (suggest ? `${suggest}` : ""), "aria-label": `${e.name} ${Rx.repsText(g)} weight`, autocomplete: "off" });
        fields.push({ key: Rx.logKey(e, gi), input: weight });
        let reps = null;
        if (fail) {
          reps = el("input", { type: "text", inputmode: "numeric", placeholder: "reps", value: logged(pid, Rx.repsLogKey(e, gi)), "aria-label": `${e.name} reps reached`, autocomplete: "off" });
          fields.push({ key: Rx.repsLogKey(e, gi), input: reps });
        }
        const int = Rx.intensityText(e, g);
        return el("div", { class: `set${fail ? " fail" : ""}` },
          el("span", { class: "reps" }, Rx.repsText(g)),
          el("div", { class: "boxes" }, weight, reps),
          int ? el("span", { class: "pct" }, int) : null);
      }))));
    overlay.replaceChildren(el("div", { class: "sheet" },
      el("button", { class: "close", "aria-label": "Close", onclick: closeVideo }, "×"),
      el("h2", null, "Log session"),
      el("div", { class: "swap-coach" }, "Some sets have no weight yet. Add what you used, or skip."),
      body,
      el("div", { class: "swap-actions" },
        el("button", { class: "primary", onclick: () => { fields.forEach((f) => { const v = f.input.value.trim(); if (v) save(pid, f.key, v); }); finish(); } }, "Save and log"),
        el("button", { onclick: finish }, "Skip"),
        el("button", { onclick: closeVideo }, "Cancel"))));
    overlay.className = "overlay show";
    overlay.scrollTop = 0;
  }

  // ---- equipment survey (remote athletes) ----------------------------------------------------------
  // Athletes who train remotely tick what they have to train with. It is asked before their first look at a
  // program (and works before one is assigned), and stays reachable from the menu. Saving it lets the coach's
  // dashboard flag exercises they can't do, and emails the coach who assigned the program if any are flagged.
  const EC = window.EquipmentCheck;
  let draft = null; // { have: Set of names, custom: [names] } while the survey is open
  function equipmentView() {
    const lower = (q) => `${q}`.toLowerCase();
    if (!draft) {
      // the saved list also carries the indoor turf length (see turfYards in program_rx.js), which is not equipment
      const saved = Array.isArray(equipment.access) ? equipment.access : [];
      const access = saved.filter((q) => !EC.isSetting(q));
      const listed = (q) => EC.LIST.some((x) => lower(x) === lower(q));
      draft = { have: new Set(access), custom: [...new Set([...(equipment.custom || []), ...access.filter((q) => !listed(q))])], turf: EC.turfYards(saved) || "" };
    }
    const first = !equipment.surveyedAt;
    const main = el("main");
    main.append(el("div", { class: "card" },
      el("div", { class: "card-title" }, first ? "Before you start: what equipment do you have?" : "Your equipment"),
      el("div", { class: "card-sub" }, "Tick everything you can train with. Your coach uses this to build a program you can actually do. You can change it any time.")));
    const tile = (q) => {
      const box = el("input", { type: "checkbox" });
      box.checked = draft.have.has(q);
      const t = el("label", { class: `eq-tile${box.checked ? " on" : ""}` }, box, el("span", null, EC.label(q)));
      box.addEventListener("change", () => { if (box.checked) draft.have.add(q); else draft.have.delete(q); t.className = `eq-tile${box.checked ? " on" : ""}`; });
      // indoor turf comes with a blank for its length; left empty, it is taken to be long enough for anything
      if (q === "Indoor Turf") {
        const len = el("input", { type: "text", inputmode: "numeric", class: "eq-len", placeholder: "length", value: draft.turf, "aria-label": "Indoor turf length in yards", autocomplete: "off" });
        len.addEventListener("input", () => {
          draft.turf = len.value.trim();
          if (draft.turf && !box.checked) { box.checked = true; draft.have.add(q); t.className = "eq-tile on"; } // a length means they have turf
        });
        t.append(el("span", { class: "eq-len-wrap" }, len, "yd"));
        t.style.gridColumn = "span 2"; // room for the length box
      }
      return t;
    };
    EC.GROUPS.forEach((g) => main.append(el("h2", { class: "section" }, g.name), el("div", { class: "eq-tiles" }, g.items.map(tile))));
    const customBox = el("div", { class: "eq-tiles" }, draft.custom.map(tile));
    const add = el("input", { type: "text", class: "eq-new", placeholder: "Add new equipment", "aria-label": "Add new equipment", autocomplete: "off", autocapitalize: "words" });
    const addNew = () => {
      const q = add.value.trim().replace(/\s+/g, " ").slice(0, 60);
      if (!q) return;
      const name = EC.LIST.find((x) => lower(x) === lower(q)) || draft.custom.find((x) => lower(x) === lower(q)) || q;
      draft.have.add(name);
      if (!EC.LIST.includes(name) && !draft.custom.includes(name)) draft.custom.push(name);
      render();
    };
    add.addEventListener("keydown", (ev) => { if (ev.key === "Enter") addNew(); });
    main.append(el("h2", { class: "section" }, "Anything else?"), customBox, el("div", { class: "eq-new-row" }, add, el("button", { class: "eq-new-btn", onclick: addNew }, "Add")));
    const note = el("div", { class: "swap-note" });
    const saveBtn = el("button", { class: "session-log", onclick: async () => {
      saveBtn.disabled = true;
      note.textContent = "Saving…";
      const access = EC.withTurfYards([...draft.have], draft.have.has("Indoor Turf") ? draft.turf : null), custom = [...draft.custom];
      let ok = false;
      try { const res = await sb.rpc("athlete_portal_equipment", { p_token: token, p_access: access, p_custom: custom }); ok = !res.error && res.data === true; } catch (e) { ok = false; }
      saveBtn.disabled = false;
      if (!ok) { note.textContent = "Could not save. Check your connection and try again."; return; }
      equipment = { access, custom, surveyedAt: new Date().toISOString() };
      draft = null;
      // lets the coach who assigned the program know if any exercise needs something not ticked; nothing to wait for
      try { fetch("/api/equipment-alert", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) }).catch(() => {}); } catch (e) { /* not reachable: the dashboard still shows the flags */ }
      view = plan ? "program" : "equipment";
      render();
      window.scrollTo(0, 0);
      showStatus("Equipment saved");
    } }, first ? "Save and continue" : "Save my equipment");
    main.append(el("div", { class: "session-end" }, note, saveBtn));
    if (!plan && !first) main.append(el("div", { class: "empty" }, "Thanks. Your coach has not put a program on your plan yet; it will show up here when they do."));
    return main;
  }

  // ---- this week, streaks and progress -------------------------------------------------------------
  // every day with exercises in the programs of plan week `wk`, as { item, si, s }
  const daysAt = (wk) => itemsAt(wk).flatMap((it) => (it.week.sessions || []).map((s, si) => ({ item: it, si, s })))
    .filter((d) => (d.s.exercises || []).some((e) => (e.name || "").trim()));
  const isDone = (d) => !!logged(d.item.program.id, sessionKey(d.item, d.si));
  const weekCount = (wk) => { const ds = daysAt(wk); return { done: ds.filter(isDone).length, total: ds.length }; };
  // weeks in a row with at least one session logged, counting back from this week (from last week while nothing
  // is logged yet this week, so a streak is not lost on a Monday morning)
  const streak = () => {
    let wk = currentWeek(), n = 0;
    if (!weekCount(wk).done) wk -= 1;
    while (wk >= 0 && weekCount(wk).done) { n += 1; wk -= 1; }
    return n;
  };
  const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const nice = (v) => (Number.isInteger(v) ? `${v}` : `${Math.round(v * 100) / 100}`);
  const testValue = (t) => parseFloat(t.best != null && t.best !== "" ? t.best : t.value);
  // a test result that beats every earlier result of the same test
  const isTestBest = (t) => {
    const v = testValue(t);
    const earlier = (tests || []).filter((x) => x.kpiId === t.kpiId && x.date < t.date).map(testValue).filter((x) => Number.isFinite(x));
    return Number.isFinite(v) && earlier.length > 0 && (t.better === "lower" ? v < Math.min(...earlier) : v > Math.max(...earlier));
  };
  // a small trend line; `flip` for results where lower is better, so up always means better
  const spark = (vals, flip) => {
    if (vals.length < 2) return null;
    const v = flip ? vals.map((x) => -x) : vals;
    const w = 84, h = 26, lo = Math.min(...v), span = Math.max(...v) - lo || 1;
    const pts = v.map((x, i) => [(i / (v.length - 1)) * (w - 6) + 3, h - 3 - ((x - lo) / span) * (h - 6)]);
    const box = el("span", { class: "spark" });
    box.innerHTML = `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><polyline points="${pts.map((p) => p.map((n) => n.toFixed(1)).join(",")).join(" ")}" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${pts[pts.length - 1][0].toFixed(1)}" cy="${pts[pts.length - 1][1].toFixed(1)}" r="3" fill="currentColor"/></svg>`;
    return box;
  };
  const goToProgress = () => { view = "progress"; render(); window.scrollTo(0, 0); };

  // ---- body composition on the Progress tab ------------------------------------------------------------
  // The athlete's Evolt scans and manual body comp sheets, the same graph as on the dashboard's Body Composition
  // tab: one source, or both drawn together on one graph (they stay separate records), for a figure and a time
  // window. Which ones were last picked is remembered on this phone.
  const BC_SOURCES = { evolt: "Evolt", sheet: "Manual sheet", both: "Together" };
  const BC_METRICS = [
    { key: "pctFat", label: "Body fat", unit: "%", evolt: (s) => s.bodyFatPct, sheet: (m) => m.pctFat },
    { key: "weight", label: "Weight", unit: "lb", evolt: (s) => s.weightLb, sheet: (m) => m.weightLb },
    { key: "lean", label: "Lean mass", unit: "lb", evolt: (s) => s.lbmLb, sheet: (m) => m.leanLb },
    { key: "fat", label: "Fat mass", unit: "lb", evolt: (s) => s.bodyFatLb, sheet: (m) => m.fatLb },
    { key: "muscle", label: "Muscle", unit: "lb", evolt: (s) => s.smmLb, sheet: (m) => m.muscleLb },
  ];
  const BC_RANGES = [{ key: "90d", label: "90 days", days: 90 }, { key: "6m", label: "6 months", days: 183 }, { key: "1y", label: "1 year", days: 365 }, { key: "all", label: "All time", days: 0 }];
  const BC_SHEET_COLOR = "#f59e0b";
  let bcView = (() => { try { return JSON.parse(localStorage.getItem("bodyCompView") || "{}") || {}; } catch (e) { return {}; } })();
  const setBcView = (patch) => {
    bcView = { ...bcView, ...patch };
    try { localStorage.setItem("bodyCompView", JSON.stringify(bcView)); } catch (e) { /* private window: not remembered */ }
    const y = window.scrollY;
    render();
    window.scrollTo(0, y);
  };
  const bcDay = (ms) => { const d = new Date(ms); return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`; };
  // the graph: each series a line with a dot per measurement, spaced by date. `joinAll` (Together) draws one line
  // through every point of every series in date order instead, with the dots still in their series' color, and
  // a dashed straight-line trend through all of them.
  function bcGraph(series, unit, joinAll, label) {
    const pts = series.flatMap((s) => s.points);
    const w = 320, h = 170, l = 38, r = 10, t = 10, b = 24;
    let t0 = Math.min(...pts.map((p) => p.t)), t1 = Math.max(...pts.map((p) => p.t));
    if (t0 === t1) { t0 -= 86400000; t1 += 86400000; }
    let lo = Math.min(...pts.map((p) => p.v)), hi = Math.max(...pts.map((p) => p.v));
    const pad = (hi - lo) * 0.15 || Math.max(1, Math.abs(hi) * 0.05);
    lo -= pad; hi += pad;
    const x = (v) => l + ((v - t0) / (t1 - t0)) * (w - l - r), y = (v) => t + (1 - (v - lo) / (hi - lo)) * (h - t - b);
    const fmt = (v) => `${Math.round(v * 10) / 10}${unit === "%" ? "%" : ""}`;
    const grid = [0, 0.5, 1].map((f) => { const v = lo + (hi - lo) * f; return `<line x1="${l}" x2="${w - r}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" class="bc-grid"/><text x="${l - 5}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end" class="bc-axis">${fmt(v)}</text>`; }).join("");
    const poly = (ps) => (ps.length > 1 ? `<polyline points="${ps.map((q) => `${x(q.t).toFixed(1)},${y(q.v).toFixed(1)}`).join(" ")}" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>` : "");
    let joined = "";
    if (joinAll) {
      const all = [...pts].sort((a, c) => a.t - c.t);
      joined = `<g class="bc-joined">${poly(all)}</g>`;
      if (all.length > 1) { // least-squares line through every point
        const mx = all.reduce((n, q) => n + q.t, 0) / all.length, my = all.reduce((n, q) => n + q.v, 0) / all.length;
        const den = all.reduce((n, q) => n + (q.t - mx) ** 2, 0), k = den ? all.reduce((n, q) => n + (q.t - mx) * (q.v - my), 0) / den : 0;
        const at = (tt) => my + k * (tt - mx);
        joined += `<line x1="${x(all[0].t).toFixed(1)}" y1="${y(at(all[0].t)).toFixed(1)}" x2="${x(all[all.length - 1].t).toFixed(1)}" y2="${y(at(all[all.length - 1].t)).toFixed(1)}" class="bc-trend"/>`;
      }
    }
    const lines = series.map((s) => `<g style="color:${s.color}">${joinAll ? "" : poly(s.points)}${s.points.map((q) => `<circle cx="${x(q.t).toFixed(1)}" cy="${y(q.v).toFixed(1)}" r="${joinAll ? 4 : 3.5}" fill="currentColor"><title>${bcDay(q.t)}: ${fmt(q.v)}${unit === "lb" ? " lb" : ""}</title></circle>`).join("")}</g>`).join("");
    const box = el("div", { class: "bc-graph" });
    box.innerHTML = `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${label || "Body composition graph"}">${grid}${joined}${lines}<text x="${l}" y="${h - 6}" class="bc-axis">${bcDay(t0)}</text><text x="${w - r}" y="${h - 6}" text-anchor="end" class="bc-axis">${bcDay(t1)}</text></svg>`;
    return box;
  }
  // the pre-lift weigh-ins from the Program page, drawn with Weight
  const BC_WEIGH_COLOR = "#3b82f6";
  function bodyCompSection() {
    const scans = (bodyComp && bodyComp.scans) || [], sheets = ((bodyComp && bodyComp.sheets) || []).filter((s) => s.date && s.summary);
    const weighs = weighIns();
    if (!scans.length && !sheets.length && !weighs.length) return null;
    const has = { evolt: scans.length > 0, sheet: sheets.length > 0 };
    const source = has.evolt && has.sheet ? (BC_SOURCES[bcView.source] ? bcView.source : "evolt") : has.evolt ? "evolt" : "sheet";
    // weigh-ins alone (no scan or sheet yet): just Weight
    const metrics = has.evolt || has.sheet ? BC_METRICS : BC_METRICS.filter((m) => m.key === "weight");
    const metric = metrics.find((m) => m.key === bcView.metric) || metrics[0];
    const range = BC_RANGES.find((x) => x.key === bcView.range) || BC_RANGES[BC_RANGES.length - 1];
    const from = range.days ? Date.now() - range.days * 86400000 : -Infinity;
    const at = (d, time) => new Date(`${d}T${time || "12:00"}:00`).getTime();
    const num = (v) => (typeof v === "number" && isFinite(v) ? Math.round(v * 10) / 10 : null);
    // anything entered in kilograms before Evolt came in pounds is shown in pounds
    const lb = (s, lbKey, kgKey) => (s[lbKey] != null ? s[lbKey] : s[kgKey] != null ? s[kgKey] * 2.20462 : null);
    const series = [];
    if (source !== "sheet") series.push({ name: "Evolt", color: "var(--label, var(--accent))", points: scans.map((s) => ({ t: at(s.date, s.time), v: num(metric.evolt({ ...s, weightLb: lb(s, "weightLb", "weightKg"), smmLb: lb(s, "smmLb", "skeletalMuscleKg") })) })) });
    if (source !== "evolt") series.push({ name: "Manual sheet", color: BC_SHEET_COLOR, points: sheets.map((s) => ({ t: at(s.date), v: num(metric.sheet(s.summary)) })) });
    if (metric.key === "weight") series.push({ name: "Pre-lift weigh-ins", color: BC_WEIGH_COLOR, points: weighs.map((w) => ({ t: at(w.date), v: num(w.lb) })) });
    series.forEach((s) => { s.points = s.points.filter((p) => p.v != null && p.t >= from).sort((a, b) => a.t - b.t); });
    const shown = series.filter((s) => s.points.length);
    const chips = (items, on, pick) => el("div", { class: "chips bc-chips" }, items.map(([k, label]) => el("button", { class: `chip${on === k ? " on" : ""}`, onclick: () => pick(k) }, label)));
    const unitText = (v) => `${nice(v)}${metric.unit === "%" ? "%" : " lb"}`;
    const card = el("div", { class: "card" },
      has.evolt && has.sheet ? chips(Object.entries(BC_SOURCES), source, (k) => setBcView({ source: k })) : null,
      metrics.length > 1 ? chips(metrics.map((m) => [m.key, m.label]), metric.key, (k) => setBcView({ metric: k })) : null,
      chips(BC_RANGES.map((x) => [x.key, x.label]), range.key, (k) => setBcView({ range: k })),
      shown.length ? bcGraph(shown, metric.unit, source === "both") : el("div", { class: "card-sub" }, `No ${metric.label.toLowerCase()} in the last ${range.label.toLowerCase()}. All time shows everything.`),
      // the latest of each, and the change across the window
      shown.map((s) => {
        const a = s.points[0], z = s.points[s.points.length - 1], d = Math.round((z.v - a.v) * 10) / 10;
        return el("div", { class: "bc-latest" }, el("span", { class: "bc-key", style: `background:${s.color}` }), el("span", null, `${s.name}: `, el("b", null, unitText(z.v)), s.points.length > 1 ? el("small", null, ` ${d > 0 ? "+" : ""}${unitText(d)} since ${bcDay(a.t)}`) : el("small", null, ` ${bcDay(z.t)}`)));
      }),
      source === "both" ? el("div", { class: "card-sub" }, "One line through every measurement in date order, scans and sheets alike, with the dashed trend through all of them. A scan and a skinfold sheet measure a little differently, so the line can step where it changes from one to the other.") : null);
    return [el("h2", { class: "section" }, has.evolt || has.sheet ? "Body composition" : "Body weight", el("small", null, [has.evolt && `${scans.length} scan${scans.length === 1 ? "" : "s"}`, has.sheet && `${sheets.length} sheet${sheets.length === 1 ? "" : "s"}`, weighs.length && `${weighs.length} weigh-in${weighs.length === 1 ? "" : "s"}`].filter(Boolean).join(" · "))), card];
  }

  // ---- countermovement jump on the Progress tab ----------------------------------------------------------
  // Their force plate tests, graphed as on the dashboard's Performance Metrics tab: one figure at a time over a
  // time window, one test a day (the best jump that day), with a dashed trend line. The figure and window picked
  // are remembered on this phone.
  const N_TO_LBF = 4.4482216152605;
  const num2 = (v) => (typeof v === "number" && isFinite(v) ? Math.round(v * 100) / 100 : null);
  const CMJ_METRICS = [
    { key: "jumpHeight", label: "Jump height", unit: "in", get: (t) => num2(t.jumpHeight) },
    { key: "mRSI", label: "mRSI", unit: "", get: (t) => num2(t.rsiModified) },
    { key: "peakPower", label: "Peak power", unit: "W", get: (t) => num2(t.peakPower) },
    { key: "relativePeakPower", label: "Relative peak power", unit: "W/kg", get: (t) => num2(t.relativePeakPower) },
    { key: "bodyWeight", label: "Body weight", unit: "lb", get: (t) => (typeof t.systemWeight === "number" ? num2(t.systemWeight / N_TO_LBF) : null) },
    { key: "jumpMomentum", label: "Jump momentum", unit: "kg·m/s", get: (t) => num2(t.jumpMomentum) },
    { key: "takeoffVelocity", label: "Takeoff velocity", unit: "m/s", get: (t) => num2(t.takeoffVelocity) },
    { key: "totalImpulse", label: "Propulsive net impulse", unit: "Ns", get: (t) => num2(t.totalImpulse) },
    { key: "depth", label: "Countermovement depth", unit: "in", get: (t) => (typeof t.countermovementDepth === "number" ? Math.abs(num2(t.countermovementDepth)) : typeof t.countermovementDepthM === "number" ? Math.abs(num2(t.countermovementDepthM * 39.3701)) : null) },
  ];
  let cmjView = (() => { try { return JSON.parse(localStorage.getItem("cmjView") || "{}") || {}; } catch (e) { return {}; } })();
  const setCmjView = (patch) => {
    cmjView = { ...cmjView, ...patch };
    try { localStorage.setItem("cmjView", JSON.stringify(cmjView)); } catch (e) { /* private window: not remembered */ }
    const y = window.scrollY;
    render();
    window.scrollTo(0, y);
  };
  function cmjSection() {
    // peak power and relative peak power swapped on some older imports, put right as the dashboard does
    const fixed = (cmjTests || []).filter((t) => t && t.date).map((t) => {
      const n = { ...t }, pp = typeof n.peakPower === "number" ? n.peakPower : null, rpp = typeof n.relativePeakPower === "number" ? n.relativePeakPower : null;
      if (pp !== null && pp < 1000) { n.peakPower = null; if (rpp === null || rpp >= 1000) n.relativePeakPower = pp; }
      if (rpp !== null && rpp >= 1000) { if (n.peakPower == null) n.peakPower = rpp; if (n.relativePeakPower === rpp) n.relativePeakPower = null; }
      return n;
    });
    // one test a day: the best jump
    const byDay = new Map();
    fixed.forEach((t) => { const cur = byDay.get(t.date); const jh = typeof t.jumpHeight === "number" ? t.jumpHeight : -Infinity; if (!cur || jh > (typeof cur.jumpHeight === "number" ? cur.jumpHeight : -Infinity)) byDay.set(t.date, t); });
    const days = [...byDay.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
    if (!days.length) return null;
    const offered = CMJ_METRICS.filter((m) => days.some((t) => m.get(t) != null));
    const metric = offered.find((m) => m.key === cmjView.metric) || offered[0];
    if (!metric) return null;
    const range = BC_RANGES.find((x) => x.key === cmjView.range) || BC_RANGES[BC_RANGES.length - 1];
    const from = range.days ? Date.now() - range.days * 86400000 : -Infinity;
    const points = days.map((t) => ({ t: new Date(`${t.date}T12:00:00`).getTime(), v: metric.get(t) })).filter((p) => p.v != null && p.t >= from);
    const chips = (items, on, pick) => el("div", { class: "chips bc-chips" }, items.map(([k, label]) => el("button", { class: `chip${on === k ? " on" : ""}`, onclick: () => pick(k) }, label)));
    const u = (v) => `${nice(v)}${metric.unit ? ` ${metric.unit}` : ""}`;
    let summary = null;
    if (points.length) {
      const a = points[0], z = points[points.length - 1], best = Math.max(...points.map((p) => p.v));
      const d = Math.round((z.v - a.v) * 100) / 100;
      summary = el("div", { class: "bc-latest" }, el("span", { class: "bc-key", style: "background:var(--label, var(--accent))" }),
        el("span", null, "Latest: ", el("b", null, u(z.v)), el("small", null, ` ${bcDay(z.t)}${points.length > 1 ? ` · ${d > 0 ? "+" : ""}${u(d)} since ${bcDay(a.t)}` : ""}${points.length > 1 && best > z.v && metric.key !== "depth" && metric.key !== "bodyWeight" ? ` · best ${u(best)}` : ""}`)));
    }
    const card = el("div", { class: "card" },
      chips(offered.map((m) => [m.key, m.label]), metric.key, (k) => setCmjView({ metric: k })),
      chips(BC_RANGES.map((x) => [x.key, x.label]), range.key, (k) => setCmjView({ range: k })),
      points.length ? bcGraph([{ name: metric.label, color: "var(--label, var(--accent))", points }], metric.unit, true, "Countermovement jump graph") : el("div", { class: "card-sub" }, `No jumps in the last ${range.label.toLowerCase()}. All time shows everything.`),
      summary,
      points.length > 1 ? el("div", { class: "card-sub" }, "One point per test day (the best jump that day), with the dashed line showing the trend.") : null);
    return [el("h2", { class: "section" }, "Countermovement jump", el("small", null, `${days.length} test day${days.length === 1 ? "" : "s"}`)), card];
  }

  // What shows at the end of a logged day: the week so far, the streak, any estimated max that went past the
  // athlete's best, and any Group Testing best from today.
  // what a logged day earned: new or first estimated maxes from it, and today's new testing bests, as [label, text]
  function sessionWins(item, si, rows) {
    const pos = (item.block.start + item.weekNo - 1) * 100 + si; // where this day sits in planMaxes
    const all = window.planMaxes(plan, programById).all;
    const wins = [];
    const seen = new Set();
    rows.forEach((e) => {
      const key = Rx.liftKey(e.name);
      if (seen.has(key)) return;
      seen.add(key);
      const mine = all.filter((m) => m.key === key && m.pos === pos).map((m) => m.value);
      if (!mine.length) return;
      const now = Math.max(...mine);
      const before = all.filter((m) => m.key === key && m.pos < pos).map((m) => m.value);
      if (!before.length) wins.push(["First estimated max", `${e.name.trim()} ${now}`]);
      else if (now > Math.max(...before)) wins.push(["New estimated max", `${e.name.trim()} ${now} (+${now - Math.max(...before)})`]);
    });
    if (weekIdx === currentWeek()) {
      (tests || []).filter((t) => t.date === localDay() && isTestBest(t)).forEach((t) => wins.push(["New testing best", `${t.kpiName} ${nice(testValue(t))}${t.unit ? ` ${t.unit}` : ""}`]));
    }
    return wins;
  }

  // The moment the athlete logs a day: the day done, the week so far, the streak, and anything new from today.
  function finishScreen(item, si, rows) {
    const s = (item.week.sessions || [])[si] || {};
    const wk = weekCount(weekIdx), st = streak(), wins = sessionWins(item, si, rows);
    const week = wk.total && wk.done >= wk.total
      ? (wk.total > 1 ? `Week complete: all ${wk.total} sessions done` : "Week complete")
      : `${wk.done} of ${wk.total} sessions this week`;
    overlay.replaceChildren(el("div", { class: "sheet finish", role: "dialog", "aria-label": "Session logged" },
      el("div", { class: "finish-check", "aria-hidden": "true" }, "✓"),
      el("h2", null, `${(s.name || "").trim() || `Day ${si + 1}`} done.`),
      el("div", { class: "finish-lines" },
        el("div", null, week),
        st >= 2 ? el("div", null, `${st} weeks in a row`) : null),
      wins.length
        ? el("div", { class: "sum-wins" }, wins.map(([k, v]) => el("div", { class: "sum-win" }, el("span", null, k), el("b", null, v))))
        : el("p", { class: "finish-close" }, "Nice work. See you next session."),
      el("div", { class: "swap-actions" },
        el("button", { class: "primary", onclick: () => { closeVideo(); goToProgress(); } }, "See my progress"),
        el("button", { onclick: closeVideo }, "Done"))));
    overlay.className = "overlay show";
  }

  function sessionSummary(item, si, rows) {
    const wk = weekCount(weekIdx), st = streak();
    const wins = sessionWins(item, si, rows);
    return el("div", { class: "session-summary" },
      el("div", { class: "session-done" }, "✓ Session logged", el("button", { class: "session-undo", onclick: () => { save(item.program.id, sessionKey(item, si), ""); render(); } }, "Undo")),
      el("div", { class: "sum-stats" },
        el("div", null, el("b", null, `${wk.done}/${wk.total}`), el("span", null, "sessions this week")),
        st >= 2 ? el("div", null, el("b", null, `${st}`), el("span", null, "weeks in a row")) : null),
      wins.length ? el("div", { class: "sum-wins" }, wins.map(([k, v]) => el("div", { class: "sum-win" }, el("span", null, k), el("b", null, v)))) : null,
      el("button", { class: "sum-more", onclick: goToProgress }, "See my progress ›"));
  }

  // ---- food log: what was eaten, counted down against the day's targets ------------------------------------------
  // Each entry keeps its own calories and macros (worked out when it was added), so a later change to the food lists
  // doesn't change what was logged. A day is saved whole each time it changes (athlete_portal_food_save).
  const redrawKeep = () => { const y = window.scrollY; render(); window.scrollTo(0, y); };
  const dayKeyOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const todayKey = () => dayKeyOf(new Date());
  const shiftDay = (key, by) => { const [y, m, d] = key.split("-").map(Number); return dayKeyOf(new Date(y, m - 1, d + by)); };
  const FRAC = { 0: "", 0.25: "¼", 0.5: "½", 0.75: "¾" };
  const qtyText = (a) => { const w = Math.floor(a + 1e-9), r = Math.round((a - w) * 4) / 4; return ((w ? String(w) : "") + (FRAC[r] || "")) || "0"; };
  // a food from the plan's food lists: [name, unit, step, kcal, carbohydrate, protein, fat, plural, group, largest amount] by key
  const foodOf = (key) => { const x = nutrition && nutrition.foods && nutrition.foods[key]; return x ? { key, name: x[0], unit: x[1], step: x[2], kcal: x[3], c: x[4], p: x[5], f: x[6], pl: x[7], cat: x[8] || "", max: x[9] || 99 } : null; };
  const amountLabel = (f, a) => {
    const q = qtyText(a);
    if (f.unit === "oz") return `${q} oz`;
    if (f.unit === "cup") return `${q} C.`;
    if (f.unit === "tsp" && a >= 3 && a % 3 === 0) return `${qtyText(a / 3)} tbsp`;
    if (f.unit === "tbsp" || f.unit === "tsp") return `${q} ${f.unit}`;
    if (f.unit === "scoop") return `${q} ${a > 1 ? "scoops" : "scoop"}`;
    if (f.unit === "slice") return `${q} ${a > 1 ? "slices" : "slice"}`;
    return q;
  };
  const defaultAmount = (f) => (f.unit === "oz" ? (f.step < 1 ? 4 : 2) : 1); // a first guess at a serving, changed with − and +
  const newEntryId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const r1 = (v) => Math.round(v * 10) / 10;
  // an entry for a food from the plan's lists: its key and amount are kept too, for editing and the grocery list
  const entryOf = (f, a, meal) => ({ id: newEntryId(), meal, name: f.name, amount: amountLabel(f, a), kcal: Math.round(f.kcal * a), c: r1(f.c * a), p: r1(f.p * a), f: r1(f.f * a), key: f.key, qty: a, unit: f.unit });
  const sumOf = (entries) => entries.reduce((t, e) => ({ kcal: t.kcal + (+e.kcal || 0), c: t.c + (+e.c || 0), p: t.p + (+e.p || 0), f: t.f + (+e.f || 0) }), { kcal: 0, c: 0, p: 0, f: 0 });
  const mealNames = () => ((nutrition && nutrition.meals) || []).map((m) => m.name).concat(["Other"]);
  const mealNow = () => { const d = new Date(), h = d.getHours() + d.getMinutes() / 60; return h < 9.5 ? "Breakfast" : h < 11.5 ? "Mid-Morning Snack" : h < 14 ? "Lunch" : h < 16.5 ? "Mid-Afternoon Snack" : "Dinner"; };
  let foodSaving = Promise.resolve(); // saves go one after another, each sending the day as it is by then
  function setFoodDay(key, entries) {
    // a day with food on it is marked training or rest the first time (as the Nutrition tab is set), for their coach
    if (entries.some((e) => e.name) && !entries.some((e) => e.id === DAY_TAG)) entries = entries.concat([{ id: DAY_TAG, dayType: nutRest ? "rest" : "train" }]);
    foodDays[key] = entries;
    foodSaving = foodSaving.then(async () => {
      let ok = false;
      try { ok = await api.foodSave(key, foodDays[key] || []); } catch (e) { ok = false; }
      showStatus(ok ? "Saved" : "Not saved. Check your connection and try again.", !ok);
    });
  }
  // added to the day shown; a day still to come is planned, not eaten
  const addFood = (entries) => {
    if (!foodDay) foodDay = todayKey();
    const planned = foodDay > todayKey();
    setFoodDay(foodDay, (foodDays[foodDay] || []).concat(entries.map((e) => (planned ? Object.assign({}, e, { planned: true }) : e))));
    redrawKeep();
  };
  // units for a custom food: [family, size in that family's base unit]; an amount converts within its family
  // (grams and ounces by weight; cups, spoons and fluid ounces by volume)
  const CUSTOM_UNITS = { serving: ["count", 1], piece: ["count", 1], g: ["weight", 1], oz: ["weight", 28.35], cup: ["volume", 48], "fl oz": ["volume", 6], tbsp: ["volume", 3], tsp: ["volume", 1] };
  // their own foods: custom foods they've logged (with the label figures), newest first, then the ones they added to
  // the shared library, one of each by name
  const labelOf = (x) => ({ name: x.name, sAmt: +x.sAmt || 1, sUnit: x.sUnit, kcal: +x.kcal || 0, p: +x.p || 0, c: +x.c || 0, f: +x.f || 0 });
  const myFoods = () => {
    const seen = new Set(), out = [];
    const keep = (d) => { const id = d.name.toLowerCase(); if (!seen.has(id)) { seen.add(id); out.push(d); } };
    Object.keys(foodDays || {}).sort().reverse().forEach((k) => (foodDays[k] || []).slice().reverse().forEach((e) => {
      if (e.def && !e.def.db && CUSTOM_UNITS[e.def.sUnit]) keep(e.def);
    }));
    libraryFoods.filter((x) => x.mine && CUSTOM_UNITS[x.sUnit]).forEach((x) => keep(labelOf(x)));
    return out;
  };
  // the food database: the built-in foods (foods_db.js) and the custom foods others have added to the library
  const databaseFoods = () => (window.DSTFoodDB || []).map((r) => ({ name: r[0], sAmt: r[1], sUnit: r[2], kcal: r[3], p: r[4], c: r[5], f: r[6], group: r[7] }))
    .concat(libraryFoods.filter((x) => !x.mine && CUSTOM_UNITS[x.sUnit]).map((x) => Object.assign(labelOf(x), { group: "Added by athletes and coaches" })));
  // foods logged in the last two weeks, newest first, one of each, for adding again in a tap
  const recentFoods = () => {
    const seen = new Set(), out = [];
    Object.keys(foodDays || {}).sort().reverse().forEach((k) => (foodDays[k] || []).slice().reverse().forEach((e) => {
      if (!e.name || (e.def && !e.def.db)) return; // their own foods are under My foods (and the day's training/rest mark isn't a food)
      const id = `${e.name}|${e.amount}`;
      if (!seen.has(id)) { seen.add(id); out.push(e); }
    }));
    return out;
  };

  // ---- training or rest day: kept in the day's log as one more entry ({ id: "daytype", dayType }), with no food in it,
  // so their coach's Meal Log can show which days were which
  const DAY_TAG = "daytype";
  let dayTypeShown = null; // the day whose training/rest setting the Nutrition tab last took up
  const dayTypeOf = (dk) => { const e = ((foodDays && foodDays[dk]) || []).find((x) => x.id === DAY_TAG); return e ? e.dayType === "rest" : null; };
  function setDayType(dk, rest) {
    if (!foodDays) return;
    setFoodDay(dk, (foodDays[dk] || []).filter((x) => x.id !== DAY_TAG).concat([{ id: DAY_TAG, dayType: rest ? "rest" : "train" }]));
  }
  // A day not set either way takes it from their program: a lift or speed day is a training day. A day has a session
  // when a quick session is dated that day, a program day is named for that weekday ("Mon", "Thu - Scap + Elbow"),
  // something was logged for the program that day, or (for programs of "Day 1", "Day 2"...) the week's days fall on
  // it, spread the usual way (3 days: Mon / Wed / Fri; 4: Mon / Tue / Thu / Fri, counted from the plan week's first
  // day). Arm care, throwing and re-education don't make a training day on their own. { rest, why }, or null with no
  // plan for that day. The athlete can still switch it.
  // ---- water: a day's goal and what's been drunk, counted with taps; kept in the day's log as one more entry with no
  // food in it ({ id: "water", oz, extra }: extra is what the post-lift weight said to drink back, added to the goal
  // when they tap it; the weight itself is never kept). The goal is half their body weight in ounces (their latest
  // pre-lift weigh-in, else the plan's weight), 24 oz more on a training day, plus any drink-back.
  const WATER_TAG = "water";
  const waterOf = (dk) => ((foodDays && foodDays[dk]) || []).find((x) => x.id === WATER_TAG) || { oz: 0, extra: 0 };
  function setWater(dk, patch) {
    if (!foodDays) return;
    const next = Object.assign({ oz: 0, extra: 0 }, waterOf(dk), patch, { id: WATER_TAG });
    setFoodDay(dk, (foodDays[dk] || []).filter((x) => x.id !== WATER_TAG).concat([next]));
  }
  const bodyLb = () => { const w = weighIns().pop(); return w ? w.lb : nutrition && nutrition.kg ? Math.round(nutrition.kg * 2.2) : null; };
  const waterGoal = (dk, rest) => {
    const lb = bodyLb(), w = waterOf(dk);
    const base = lb ? Math.round(lb / 2) : 100, train = rest ? 0 : 24, extra = Math.round(+w.extra || 0);
    return { goal: base + train + extra, base, train, extra, lb };
  };
  function waterCard(dk, rest) {
    const g = waterGoal(dk, rest), drunk = Math.round(+waterOf(dk).oz || 0);
    const add = (oz) => () => { setWater(dk, { oz: Math.max(0, drunk + oz) }); redrawKeep(); };
    const left = g.goal - drunk;
    return el("div", { class: "card water-card" },
      el("div", { class: "water-top" },
        el("div", null, el("b", null, `${drunk} oz`), el("small", null, ` of ${g.goal} oz`)),
        el("small", { class: left > 0 ? "" : "water-done" }, left > 0 ? `${left} oz to go` : "Goal reached ✓")),
      el("div", { class: "food-track water-track" }, el("span", { style: `width:${g.goal ? Math.min(100, (drunk / g.goal) * 100) : 0}%` })),
      el("div", { class: "water-btns" },
        [8, 16, 24, 32].map((oz) => el("button", { class: "water-add", onclick: add(oz) }, `+${oz}`)),
        el("button", { class: "water-add water-minus", "aria-label": "8 oz less", disabled: !drunk, onclick: add(-8) }, "−8")),
      el("div", { class: "card-sub water-why" }, [
        g.lb ? `½ oz per lb (${g.lb} lb) = ${g.base}` : `${g.base} oz to start`,
        g.train ? `+${g.train} training day` : "",
        g.extra ? `+${g.extra} to drink back after your lift` : "",
      ].filter(Boolean).join(" · ")));
  }

  // ---- eating on the road: orders at the places players end up on road trips (chains, the hotel breakfast, a gas
  // station), each built from the food database's published figures (foods_db.js) and set against the meal it's for:
  // how close it comes to that meal's calories, sorted closest first. "Log" adds it to the day shown, food by food.
  // Orders with a food they're allergic to are left out.
  const ROAD = [
    { at: "Chick-fil-A", name: "Egg White Grill + fruit cup", for: "breakfast", parts: [["Chick-fil-A Egg White Grill", 1], ["Chick-fil-A fruit cup (medium)", 1]] },
    { at: "Starbucks", name: "Egg bites + oatmeal", for: "breakfast", parts: [["Starbucks egg white & roasted red pepper egg bites (2)", 1], ["Starbucks classic oatmeal", 1]] },
    { at: "Starbucks", name: "Spinach feta wrap + banana", for: "breakfast", parts: [["Starbucks spinach, feta & egg white wrap", 1], ["Banana (medium)", 1]] },
    { at: "Starbucks", name: "Turkey bacon sandwich + egg bites", for: "breakfast", parts: [["Starbucks turkey bacon, cheddar & egg white sandwich", 1], ["Starbucks egg white & roasted red pepper egg bites (2)", 1]] },
    { at: "McDonald's", name: "2 Egg McMuffins", for: "breakfast", parts: [["McDonald's Egg McMuffin", 2]] },
    { at: "Hotel breakfast", name: "3 eggs, oatmeal, banana, 2 toast", for: "breakfast", parts: [["Egg, large", 3], ["Oatmeal, cooked with water", 1], ["Banana (medium)", 1], ["Whole wheat bread", 2]] },
    { at: "Hotel breakfast", name: "2 Greek yogurts, oatmeal, apple", for: "breakfast", parts: [["Greek yogurt cup, flavored nonfat (5.3 oz)", 2], ["Oatmeal, cooked with water", 1], ["Apple (medium)", 1]] },
    { at: "Chipotle", name: "Chicken bowl (white rice, black beans, fajita veg, salsa)", for: "meal", parts: [["Chipotle chicken", 1], ["Chipotle white rice", 1], ["Chipotle black beans", 1], ["Chipotle fajita veggies", 1], ["Chipotle fresh tomato salsa", 1]] },
    { at: "Chipotle", name: "Double chicken bowl", for: "meal", parts: [["Chipotle chicken", 2], ["Chipotle white rice", 1], ["Chipotle black beans", 1], ["Chipotle fajita veggies", 1], ["Chipotle fresh tomato salsa", 1]] },
    { at: "Chipotle", name: "Steak burrito (rice, pinto beans, fajita veg, salsa, cheese)", for: "meal", parts: [["Chipotle flour tortilla (burrito)", 1], ["Chipotle steak", 1], ["Chipotle white rice", 1], ["Chipotle pinto beans", 1], ["Chipotle fajita veggies", 1], ["Chipotle fresh tomato salsa", 1], ["Chipotle cheese", 1]] },
    { at: "Chipotle", name: "Chicken bowl, brown rice, half guac", for: "meal", parts: [["Chipotle chicken", 1], ["Chipotle brown rice", 1], ["Chipotle black beans", 1], ["Chipotle fajita veggies", 1], ["Chipotle fresh tomato salsa", 1], ["Chipotle guacamole", 0.5]] },
    { at: "Chick-fil-A", name: "12 ct grilled nuggets + fruit cup", for: "meal", parts: [["Chick-fil-A Grilled Nuggets (12 ct)", 1], ["Chick-fil-A fruit cup (medium)", 1]] },
    { at: "Chick-fil-A", name: "Grilled chicken sandwich + 8 ct grilled nuggets", for: "meal", parts: [["Chick-fil-A Grilled Chicken Sandwich", 1], ["Chick-fil-A Grilled Nuggets (8 ct)", 1]] },
    { at: "Subway", name: "Footlong oven roasted turkey on wheat", for: "meal", parts: [["Subway 6 inch oven roasted turkey on wheat", 2]] },
    { at: "Whataburger", name: "Egg Sandwich + 2 hard-boiled eggs", for: "breakfast", parts: [["Whataburger Egg Sandwich", 1], ["Whataburger Hard-Boiled Egg", 2]] },
    { at: "Whataburger", name: "Breakfast On A Bun (bacon) + egg + apple slices", for: "breakfast", parts: [["Whataburger Breakfast On A Bun with Bacon", 1], ["Whataburger Hard-Boiled Egg", 1], ["Whataburger Apple Slices", 1]] },
    { at: "Whataburger", name: "Taquito (bacon & cheese) + 2 hard-boiled eggs", for: "breakfast", parts: [["Whataburger Taquito with Cheese & Bacon", 1], ["Whataburger Hard-Boiled Egg", 2]] },
    { at: "Whataburger", name: "2 Grilled Chicken Melts", for: "meal", parts: [["Whataburger Grilled Chicken Melt", 2]] },
    { at: "Whataburger", name: "Grilled Chicken Sandwich + 6 Whatachick'n Bites", for: "meal", parts: [["Whataburger Grilled Chicken Sandwich with Whatasauce", 1], ["Whataburger Whatachick'n Bites (6)", 1]] },
    { at: "Whataburger", name: "2 Chicken Fajita Tacos + apple slices", for: "meal", parts: [["Whataburger Chicken Fajita Taco", 2], ["Whataburger Apple Slices", 1]] },
    { at: "Whataburger", name: "Apple & Cranberry Chicken Salad + Grilled Chicken Melt", for: "meal", parts: [["Whataburger Apple & Cranberry Salad with Grilled Chicken (no dressing)", 1], ["Whataburger Grilled Chicken Melt", 1]] },
    { at: "Whataburger", name: "Grilled Chicken Sandwich + apple slices", for: "meal", parts: [["Whataburger Grilled Chicken Sandwich with Whatasauce", 1], ["Whataburger Apple Slices", 1]] },
    { at: "Whataburger", name: "2 chocolate milks + apple slices", for: "post", parts: [["Whataburger 1% Chocolate Milk (8 fl oz)", 2], ["Whataburger Apple Slices", 1]] },
    { at: "Gas station", name: "Beef jerky, banana, string cheese", for: "snack", parts: [["Beef jerky", 2], ["Banana (medium)", 1], ["String cheese", 1]] },
    { at: "Anywhere", name: "Premier Protein shake + banana", for: "snack", parts: [["Premier Protein shake (11 fl oz)", 1], ["Banana (medium)", 1]] },
    { at: "Anywhere", name: "Core Power + RXBAR", for: "post", parts: [["Fairlife Core Power 26g (14 fl oz)", 1], ["RXBAR", 1]] },
    { at: "Clubhouse", name: "2 cups chocolate milk + PB&J", for: "post", parts: [["Chocolate milk, low-fat", 2], ["PB&J sandwich (wheat bread, 2 tbsp PB, 1 tbsp jam)", 1]] },
  ];
  const ROAD_GROUPS = [["breakfast", "Breakfast"], ["meal", "Lunch or dinner"], ["snack", "Snacks"], ["post", "After a lift or game"]];
  function roadFold(fold, rest) {
    const db = {};
    (window.DSTFoodDB || []).forEach((r) => { db[r[0]] = { name: r[0], sAmt: r[1], sUnit: r[2], kcal: r[3], p: r[4], c: r[5], f: r[6] }; });
    const meals = (nutrition && nutrition.meals) || [];
    // the plan's meal each kind of order is set against
    const mealFor = (kind) => meals.find((m) => (kind === "breakfast" ? /breakfast/i : kind === "meal" ? /lunch/i : kind === "post" ? /post|workout/i : /snack/i).test(m.name))
      || (kind === "post" ? meals.find((m) => /snack/i.test(m.name)) : null);
    const items = (o) => o.parts.map(([name, qty]) => {
      const d = db[name];
      if (!d) return null;
      const count = d.sUnit === "piece" || d.sUnit === "serving";
      return { kind: "label", def: Object.assign({ db: true }, d), eAmt: String(count ? qty : qty * d.sAmt), eUnit: count ? "servings" : d.sUnit };
    });
    const groups = ROAD_GROUPS.map(([kind, title]) => {
      const m = mealFor(kind), t = m ? (rest && m.rest ? m.rest : m.train) : null;
      const rows = ROAD.filter((o) => o.for === kind && !o.parts.some(([n]) => nameBanned(n))).map((o) => {
        const its = items(o);
        if (its.some((x) => !x)) return null;
        const tot = its.map(itemTotals).reduce((a, x) => ({ kcal: a.kcal + x.kcal, p: a.p + x.p, c: a.c + x.c, f: a.f + x.f }), { kcal: 0, p: 0, c: 0, f: 0 });
        return { o, its, tot, off: t && t.kcal ? (tot.kcal - t.kcal) / t.kcal : 0 };
      }).filter(Boolean).sort((a, b) => Math.abs(a.off) - Math.abs(b.off));
      if (!rows.length) return null;
      return [el("div", { class: "nut-group" }, title, m && t ? el("small", null, ` · your ${m.name.toLowerCase()} is ${t.kcal} cal`) : null),
        ...rows.map((r) => el("div", { class: "road-row" },
          el("div", { class: "road-main" },
            el("b", null, r.o.name), el("small", { class: "road-at" }, r.o.at),
            el("small", null, `${Math.round(r.tot.kcal)} cal · P ${Math.round(r.tot.p)} · C ${Math.round(r.tot.c)} · F ${Math.round(r.tot.f)}`),
            t ? el("em", { class: `road-fit${Math.abs(r.off) <= 0.2 ? " good" : ""}` }, Math.abs(r.off) <= 0.2 ? `fits your ${m.name.toLowerCase()}` : r.off > 0 ? `${Math.round(r.tot.kcal - t.kcal)} cal more than your ${m.name.toLowerCase()}` : `${Math.round(t.kcal - r.tot.kcal)} cal less: add a side`) : null),
          foodDays ? el("button", { class: "food-logmeal road-log", onclick: () => {
            const meal = m ? m.name : mealNow();
            addFood(r.its.map((it) => itemToEntry(it, meal)).filter(Boolean));
            showStatus(`${foodDay > todayKey() ? "Planned" : "Logged"} ${r.o.name} as ${meal.toLowerCase()}`);
          } }, foodDay > todayKey() ? "Plan" : "Log") : null))];
    }).filter(Boolean);
    if (!groups.length) return null;
    return fold("Eating on the road",
      el("div", { class: "card-sub nut-note" }, "Orders at the places you'll end up on a road trip, set against your meals. Restaurants change their menus now and then, so these are close estimates."),
      ...groups.flat());
  }

  const WEEKDAYS = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
  const SPREAD = { 1: [0], 2: [0, 3], 3: [0, 2, 4], 4: [0, 1, 3, 4], 5: [0, 1, 2, 3, 4], 6: [0, 1, 2, 3, 4, 5], 7: [0, 1, 2, 3, 4, 5, 6] };
  const weekdayOf = (name) => { const m = /\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\b/i.exec(String(name || "")); return m ? WEEKDAYS[m[1].toLowerCase()] : null; };
  function programDayType(dk) {
    if (!plan || !plan.startDate || !plan.blocks) return null;
    const d = parseISO(dk), days = Math.round((d - parseISO(plan.startDate)) / 864e5);
    if (days < 0 || days >= (plan.weeks || 0) * 7) return null;
    const wk = Math.floor(days / 7), slot = days % 7;
    const items = itemsAt(wk).filter((it) => !/throw|arm\s*care|re-?ed|correct|rehab/i.test(it.lane.name || ""));
    const loggedOn = (pid) => Object.keys(logTimes).some((k) => k.startsWith(`${pid}|`) && !/\|bw-/.test(k) && dayKeyOf(new Date(logTimes[k])) === dk);
    for (const it of items) {
      const ss = (it.week.sessions || []).filter((s) => (s.exercises || []).some((e) => (e.name || "").trim()));
      const name = (s, i) => `${it.lane.name}: ${(s && s.name) || `Day ${i + 1}`}`;
      const dated = ss.find((s) => s.date === dk);
      if (dated) return { rest: false, why: name(dated, ss.indexOf(dated)) };
      if (ss.some((s) => s.date)) continue; // a quick session on another day
      if (loggedOn(it.program.id)) return { rest: false, why: `${it.lane.name} logged` };
      if (ss.some((s) => weekdayOf(s.name) != null)) {
        const i = ss.findIndex((s) => weekdayOf(s.name) === d.getDay());
        if (i >= 0) return { rest: false, why: name(ss[i], i) };
        continue;
      }
      const at = (SPREAD[Math.min(ss.length, 7)] || []).indexOf(slot);
      if (at >= 0 && ss[at]) return { rest: false, why: name(ss[at], at) };
    }
    return { rest: true, why: items.length ? "no session on your program" : "nothing on your program this week" };
  }

  // ---- food allergies: what they've said they can't eat, and the foods and meals that rules out. The plan's own foods
  // carry their allergens (nutrition.js); other foods (the database, the library) are matched by name. Their answer
  // here counts at once; the plan itself is rebuilt without those foods the next time the dashboard opens.
  const ALLERGY_LABELS = { peanut: "Peanuts", treenut: "Tree nuts", fish: "Fish", shellfish: "Shellfish", dairy: "Dairy", egg: "Eggs", gluten: "Gluten / wheat", soy: "Soy", sesame: "Sesame" };
  const ALLERGY_WORDS = {
    peanut: /peanut|pb&j/i,
    treenut: /almond|cashew|walnut|pecan|pistachio|hazelnut|macadamia|mixed nuts|trail mix|nutella|granola/i,
    fish: /salmon|tuna|\bcod\b|tilapia|mahi|halibut|sardine|\bfish\b|trout|anchov/i,
    shellfish: /shrimp|scallop|crab|lobster|clam|oyster|mussel|california roll/i,
    dairy: /milk|cheese|yogurt|whey|casein|cream|\bbutter\b|latte|ice cream|pizza|core power|premier protein|oikos|egg bites|mcmuffin|big mac|quarter pounder|zone/i,
    egg: /\begg|mayo/i,
    gluten: /bread|bagel|pasta|noodle|flour tortilla|wheat|pita|\bbun\b|pancake|waffle|cracker|pretzel|cereal|cheerios|flakes|bran|granola|muffin|couscous|cookie|oreo|newton|clif|subway|sandwich|pizza|big mac|quarter pounder|soy sauce|teriyaki|mac and cheese|\boat|goldfish|graham|jerky|zone/i,
    soy: /\bsoy|tofu|edamame|tempeh|teriyaki|jerky|zone/i,
    sesame: /sesame|hummus|tahini/i,
  };
  const myAllergies = () => (allergyInfo && allergyInfo.asked ? allergyInfo.allergies : (nutrition && nutrition.allergies) || []).filter((a) => ALLERGY_LABELS[a]);
  // a food named this would contain one of their allergens (peanut and almond butter and plant milks aren't dairy)
  const nameBanned = (name) => {
    const n = String(name || "").toLowerCase();
    return myAllergies().some((a) => ALLERGY_WORDS[a].test(a === "dairy" ? n.replace(/(peanut|almond|nut) butter|(almond|oat|soy|coconut) milk/g, "") : n));
  };
  const foodBanned = (key) => {
    const x = nutrition && nutrition.foods && nutrition.foods[key];
    if (!x || !myAllergies().length) return false;
    return Array.isArray(x[10]) ? x[10].some((a) => myAllergies().includes(a)) : nameBanned(x[0]);
  };
  const partsOk = (parts) => !(parts || []).some(([key]) => foodBanned(key));

  // The allergy question. Until they've answered it once (allergies, or "No food allergies"), it's all the Nutrition tab
  // shows (gate); after that it opens from the "change" link on the tab, as a sheet.
  function allergyForm(gate) {
    const pick = new Set(myAllergies());
    let other = (allergyInfo && allergyInfo.other) || "";
    const box = el("div", { class: gate ? "card allergy-gate" : "sheet food-sheet" });
    const save = async (list) => {
      const ok = await api.setAllergies(list, other.trim());
      if (!ok) { showStatus("Not saved. Check your connection and try again.", true); return; }
      allergyInfo = { allergies: list, other: other.trim(), asked: true };
      if (!gate) closeVideo();
      showStatus(list.length ? "Saved: your meals leave those foods out" : "Saved: no food allergies");
      redrawKeep();
    };
    const draw = () => box.replaceChildren(
      gate ? "" : el("button", { class: "close", "aria-label": "Close", onclick: closeVideo }, "×"),
      el(gate ? "div" : "h2", { class: gate ? "card-title" : null }, "Any food allergies?"),
      el("div", { class: "card-sub nut-note" }, gate
        ? "Before your nutrition plan opens: tap any food allergies you have, or tap No food allergies. You only answer this once; your sample meals, options and food search will leave those foods out."
        : "Tap any that apply. Your sample meals, meal options and food search will leave those foods out. Always check labels too."),
      el("div", { class: "chips nut-chips allergy-chips" }, Object.keys(ALLERGY_LABELS).map((a) => el("button", { class: `chip${pick.has(a) ? " on" : ""}`, onclick: () => { if (pick.has(a)) pick.delete(a); else pick.add(a); draw(); } }, ALLERGY_LABELS[a]))),
      el("label", { class: "food-label" }, "Anything else (your coach will see it)", el("input", { class: "food-input", value: other, placeholder: "e.g. strawberries", oninput: (e) => { other = e.target.value; } })),
      el("div", { class: "swap-actions" },
        el("button", { class: "primary", disabled: gate && !pick.size, onclick: () => save([...pick]) }, pick.size ? `Save ${pick.size} allerg${pick.size === 1 ? "y" : "ies"}` : gate ? "Tap your allergies above" : "Save"),
        el("button", { onclick: () => { pick.clear(); save([]); } }, "No food allergies")));
    draw();
    return box;
  }
  function openAllergySheet() {
    allergyAsked = true;
    overlay.replaceChildren(allergyForm(false));
    overlay.className = "overlay show";
  }

  // ---- a meal as it's built in the meal editor: a list of items, each a food from the plan's lists at an amount
  // ({ kind: "plan", key, amt }), a food from a label at an amount ({ kind: "label", def, eAmt, eUnit }), or an
  // entry kept as it was ({ kind: "fixed", entry })
  const numOf = (v) => { const x = parseFloat(v); return Number.isFinite(x) && x >= 0 ? x : 0; };
  // how much of a label's serving an amount is: in servings, or in a unit that converts to the serving's
  const labelRatio = (def, eAmt, eUnit) => (eUnit === "servings" ? numOf(eAmt)
    : CUSTOM_UNITS[eUnit] && CUSTOM_UNITS[def.sUnit] ? (numOf(eAmt) * CUSTOM_UNITS[eUnit][1]) / ((numOf(def.sAmt) || 1) * CUSTOM_UNITS[def.sUnit][1]) : numOf(eAmt));
  const labelAmount = (eAmt, eUnit) => { const a = numOf(eAmt); return eUnit === "servings" ? `${a} serving${a === 1 ? "" : "s"}` : `${a} ${eUnit}`; };
  function itemToEntry(it, meal) {
    if (it.kind === "plan") { const f = foodOf(it.key); return f ? entryOf(f, it.amt, meal) : null; }
    if (it.kind === "label") {
      const k = labelRatio(it.def, it.eAmt, it.eUnit);
      return { id: newEntryId(), meal, name: it.def.name, amount: labelAmount(it.eAmt, it.eUnit), kcal: Math.round(it.def.kcal * k), c: r1(it.def.c * k), p: r1(it.def.p * k), f: r1(it.def.f * k), def: it.def, qty: numOf(it.eAmt), unit: it.eUnit };
    }
    return Object.assign({}, it.entry, { id: newEntryId(), meal, planned: false });
  }
  function entryToItem(e) {
    if (e.key && foodOf(e.key) && e.qty) return { kind: "plan", key: e.key, amt: e.qty };
    if (e.def && e.qty) return { kind: "label", def: e.def, eAmt: String(e.qty), eUnit: e.unit || "servings" };
    return { kind: "fixed", entry: e };
  }
  const itemTotals = (it) => { const e = itemToEntry(it, ""); return e ? { kcal: e.kcal, p: e.p, c: e.c, f: e.f } : { kcal: 0, p: 0, c: 0, f: 0 }; };
  const DAY_RANGE = 7; // the food log reaches a week back for logging and a week ahead for planning
  const dayLabel = (k) => { const t = todayKey(); return k === t ? "Today" : k === shiftDay(t, -1) ? "Yesterday" : k === shiftDay(t, 1) ? "Tomorrow" : new Date(`${k}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }); };
  const eatenOf = (entries) => entries.filter((e) => !e.planned);
  const plannedOf = (entries) => entries.filter((e) => e.planned);

  // the day bar and countdown: what's been eaten against the day's targets (or, for a day still to come, what's planned)
  function foodLogCard(target) {
    if (!foodDay) foodDay = todayKey();
    const today = todayKey();
    const entries = foodDays[foodDay] || [];
    const future = foodDay > today;
    const counted = sumOf(future ? plannedOf(entries) : eatenOf(entries));
    const planned = sumOf(plannedOf(entries));
    const go = (by) => { const k = shiftDay(foodDay, by); if (k > shiftDay(today, DAY_RANGE) || k < shiftDay(today, -DAY_RANGE)) return; foodDay = k; redrawKeep(); };
    const kLeft = Math.round(target.kcal - counted.kcal);
    const bar = (name, ate, goal) => {
      const over = ate > goal + 0.5;
      return el("div", { class: "food-bar" },
        el("div", { class: "food-bar-top" }, el("b", null, name), el("small", null, over ? `${Math.round(ate - goal)}g over` : `${Math.round(goal - ate)}g ${future ? "to plan" : "left"}`)),
        el("div", { class: `food-track${over ? " over" : ""}` }, el("span", { style: `width:${goal ? Math.min(100, (ate / goal) * 100) : 0}%` })),
        el("small", { class: "food-bar-sub" }, `${Math.round(ate)} of ${goal}g`));
    };
    return el("div", { class: "card food-log" },
      el("div", { class: "food-day" },
        el("button", { class: "nav", "aria-label": "Previous day", disabled: foodDay <= shiftDay(today, -DAY_RANGE), onclick: () => go(-1) }, "‹"),
        el("b", null, dayLabel(foodDay), future ? el("small", { class: "food-plan-tag" }, " planning") : null),
        el("button", { class: "nav", "aria-label": "Next day", disabled: foodDay >= shiftDay(today, DAY_RANGE), onclick: () => go(1) }, "›")),
      el("div", { class: `food-left${kLeft < 0 ? " over" : ""}` },
        el("b", null, Math.abs(kLeft).toLocaleString()),
        el("span", null, kLeft < 0 ? (future ? "calories over, as planned" : "calories over") : future ? "calories still to plan" : "calories left"),
        el("small", null, future
          ? `${target.kcal.toLocaleString()} goal − ${Math.round(counted.kcal).toLocaleString()} planned`
          : `${target.kcal.toLocaleString()} goal − ${Math.round(counted.kcal).toLocaleString()} eaten${planned.kcal ? ` · ${Math.round(planned.kcal).toLocaleString()} more planned` : ""}`)),
      bar("Protein", counted.p, target.p), bar("Carbs", counted.c, target.c), bar("Fat", counted.f, target.f),
      el("div", { class: "swap-actions" }, el("button", { class: "primary", onclick: () => openFoodPicker() }, future ? "+ Plan a food" : "+ Log food")));
  }

  // ---- barcode scanning ----------------------------------------------------------------------------------
  // The camera reads a packaged food's barcode and Open Food Facts (a free, open food database) gives its label, which
  // opens in the custom food form to set how much (and goes into the shared food library when it's logged, so the next
  // athlete finds it by name). html5-qrcode reads the barcode on any phone (iPhones have no built-in barcode reader for
  // web pages); it's loaded the first time it's needed. Without the camera: a photo of the barcode, or its digits typed.
  const SCANNER_SRC = "https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js";
  let scannerLoad = null;
  const loadScanner = () => scannerLoad || (scannerLoad = new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = SCANNER_SRC;
    s.onload = () => (window.Html5Qrcode ? res(window.Html5Qrcode) : rej(new Error("no scanner")));
    s.onerror = () => { scannerLoad = null; rej(new Error("load")); };
    document.head.appendChild(s);
  }));
  // a barcode's food as a label { name, sAmt, sUnit, kcal, p, c, f }, per serving where the database has one (else per
  // 100 g); null when it isn't in the database or has no calories
  async function lookUpBarcode(code) {
    const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=product_name,brands,serving_size,serving_quantity,nutriments`);
    if (!r.ok) return null;
    const j = await r.json();
    const p = j && j.status === 1 ? j.product : null;
    if (!p) return null;
    const n = p.nutriments || {}, grams = parseFloat(p.serving_quantity);
    const hasServing = n["energy-kcal_serving"] != null || n.energy_serving != null;
    const get = (k) => {
      const v = hasServing ? n[`${k}_serving`] : n[`${k}_100g`];
      return v != null && isFinite(+v) ? +v : null;
    };
    let kcal = get("energy-kcal");
    if (kcal == null && get("energy") != null) kcal = get("energy") / 4.184; // kJ
    if (kcal == null) return null;
    const brand = String(p.brands || "").split(",")[0].trim(), name = String(p.product_name || "").trim();
    return {
      name: `${brand && !name.toLowerCase().includes(brand.toLowerCase()) ? `${brand} ` : ""}${name || "Scanned food"}`.slice(0, 60),
      sAmt: hasServing ? (grams > 0 ? Math.round(grams) : 1) : 100, sUnit: hasServing ? (grams > 0 ? "g" : "serving") : "g",
      kcal: Math.round(kcal), p: r1(get("proteins") || 0), c: r1(get("carbohydrates") || 0), f: r1(get("fat") || 0),
    };
  }
  let activeScanner = null; // the camera while a barcode is being read (stopped whenever the sheet closes)
  const stopScanner = () => { const s = activeScanner; activeScanner = null; if (s) { try { s.stop().catch(() => {}).then(() => { try { s.clear(); } catch (e) { /* gone */ } }); } catch (e) { /* not running */ } } };
  window.__dstStopScanner = stopScanner; // for closeVideo, defined before this
  // A scan looks in the shared food library first (a product someone has scanned before, by its barcode), then in
  // Open Food Facts; a product found there goes into the library straight away, barcode and all, so it's in it once
  // and the next scan finds it there (migration_027 refuses a second food with the same barcode).
  const libraryByBarcode = (code) => libraryFoods.find((x) => x.barcode && String(x.barcode) === code) || null;
  function addScannedToLibrary(d) {
    if (!api.foodLibraryAdd || !d.barcode || libraryByBarcode(d.barcode)) return;
    api.foodLibraryAdd(d).then((id) => {
      if (id && !libraryFoods.some((y) => y.id === id)) libraryFoods.push(Object.assign({ id, mine: true }, d));
    }).catch(() => {});
  }
  // onResult(label, code) with the food found, or onResult(null, code) to enter it from the label instead (its barcode
  // kept with it); `back` is the sheet to return to (the Log food sheet)
  function openScanner(onResult, back) {
    const status = el("div", { class: "card-sub scan-status" }, "Starting the camera…");
    const reader = el("div", { id: "bc-reader", class: "scan-reader" });
    const typed = el("input", { class: "food-input", inputmode: "numeric", placeholder: "Or type the barcode number", "aria-label": "Barcode number" });
    const photo = el("input", { type: "file", accept: "image/*", capture: "environment", class: "scan-file" });
    let busy = false;
    const leave = (label, code) => { stopScanner(); overlay.replaceChildren(back); onResult(label, code); };
    const found = async (raw) => {
      if (busy) return;
      busy = true;
      stopScanner();
      const code = String(raw).replace(/\D/g, "");
      const mine = libraryByBarcode(code);
      if (mine) { showStatus(`Found: ${mine.name}`); leave(Object.assign(labelOf(mine), { barcode: code }), code); return; }
      status.textContent = `Looking up ${code}…`;
      let d = null;
      try { d = await lookUpBarcode(code); } catch (e) { d = null; }
      if (d) { d.barcode = code; addScannedToLibrary(d); showStatus(`Found: ${d.name}`); leave(d, code); return; }
      busy = false;
      status.replaceChildren(`${code} isn't in the food database yet. `, el("button", { class: "btn-link", onclick: () => leave(null, code) }, "Enter it from the label"), " (it's added for everyone after).");
    };
    photo.addEventListener("change", async () => {
      const file = photo.files && photo.files[0];
      if (!file) return;
      status.textContent = "Reading the photo…";
      try {
        const Lib = await loadScanner();
        stopScanner();
        const code = await new Lib("bc-reader").scanFile(file, false);
        found(code);
      } catch (e) { status.textContent = "Couldn't read a barcode in that photo. Try again closer up, or type the number."; }
    });
    overlay.replaceChildren(el("div", { class: "sheet food-sheet scan-sheet" },
      el("button", { class: "close", "aria-label": "Close", onclick: () => leave(undefined) }, "×"),
      el("h2", null, "Scan a barcode"),
      reader, status,
      el("div", { class: "food-pair scan-type" }, typed, el("button", { class: "primary", onclick: () => { if (typed.value.replace(/\D/g, "").length >= 6) found(typed.value); } }, "Look up")),
      el("label", { class: "food-row food-custom scan-photo" }, el("span", null, "Take a photo of the barcode"), el("small", null, "if the camera won't scan"), photo),
      el("div", { class: "swap-actions" }, el("button", { onclick: () => leave(undefined) }, "Back"))));
    overlay.className = "overlay show";
    loadScanner().then((Lib) => {
      if (!document.getElementById("bc-reader")) return;
      const F = window.Html5QrcodeSupportedFormats || {};
      const formats = [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E].filter((x) => x != null);
      const s = new Lib("bc-reader", Object.assign({ verbose: false }, formats.length ? { formatsToSupport: formats } : {}));
      activeScanner = s;
      return s.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 260, height: 130 } }, (code) => found(code), () => {})
        .then(() => { status.textContent = "Hold the barcode inside the box."; })
        .catch(() => { activeScanner = null; status.textContent = "The camera isn't available. Allow camera access for this page, or take a photo of the barcode or type its number below."; });
    }).catch(() => { status.textContent = "The scanner couldn't load. Check your connection, or type the barcode number below."; });
  }

  // The Log food sheet: search the food lists (or a recent food) and set the amount, or enter a food of their own from
  // its label. With onPick, the food chosen goes back to the meal editor instead of into the log.
  function openFoodPicker(meal, onPick) {
    let q = "", chosen = null, amt = 1, mealSel = meal || mealNow(), custom = false;
    let fromDb = false; // the label form opened on a food from the database (not added to the library again)
    const cf = { name: "", sAmt: "1", sUnit: "serving", kcal: "", p: "", c: "", f: "", eAmt: "1", eUnit: "servings" };
    // a food of their own, or one from the database, in the label form ready for an amount
    const openLabel = (d, db) => { Object.assign(cf, { name: d.name, sAmt: String(d.sAmt), sUnit: d.sUnit, kcal: String(d.kcal), p: String(d.p), c: String(d.c), f: String(d.f), eAmt: String(d.sAmt), eUnit: d.sUnit === "serving" || d.sUnit === "piece" ? "servings" : d.sUnit, barcode: d.barcode || "" }); fromDb = !!db; custom = true; draw(); };
    const done = (item) => { if (onPick) onPick(item); else { closeVideo(); const e = itemToEntry(item, mealSel); if (e) addFood([e]); } };
    const sheet = el("div", { class: "sheet food-sheet" });
    const close = () => el("button", { class: "close", "aria-label": "Close", onclick: closeVideo }, "×");
    const mealPick = () => (onPick ? "" : el("label", { class: "food-label" }, "Meal",
      el("select", { class: "food-select", onchange: (e) => { mealSel = e.target.value; } }, mealNames().map((m) => { const o = el("option", { value: m }, m); if (m === mealSel) o.selected = true; return o; }))));
    const addText = onPick ? "Add to meal" : "Add";
    const draw = () => {
      if (chosen) {
        const f = chosen, t = { kcal: Math.round(f.kcal * amt), p: r1(f.p * amt), c: r1(f.c * amt), f: r1(f.f * amt) };
        const step = (by) => () => { amt = Math.max(f.step, Math.round((amt + by * f.step) * 100) / 100); draw(); };
        sheet.replaceChildren(close(), el("h2", null, f.name),
          el("div", { class: "food-amt" }, el("button", { class: "food-step", "aria-label": "Less", onclick: step(-1) }, "−"), el("b", null, amountLabel(f, amt)), el("button", { class: "food-step", "aria-label": "More", onclick: step(1) }, "+")),
          el("div", { class: "food-amt-tot" }, `${t.kcal} cal · P ${t.p} · C ${t.c} · F ${t.f}`),
          mealPick(),
          el("div", { class: "swap-actions" }, el("button", { onclick: () => { chosen = null; draw(); } }, "Back"), el("button", { class: "primary", onclick: () => done({ kind: "plan", key: f.key, amt }) }, addText)));
        return;
      }
      if (custom) {
        // From the nutrition label: what one serving is and what's in it, then how much was eaten, in a unit that
        // converts to the serving's (grams and ounces, cups and spoons) or in servings. The label figures are kept with
        // the entry, so it comes back under My foods for any amount.
        const family = (u) => (CUSTOM_UNITS[u] || CUSTOM_UNITS.serving)[0];
        const eatUnits = ["servings"].concat(Object.keys(CUSTOM_UNITS).filter((u) => family(u) === family(cf.sUnit) && family(u) !== "count"));
        if (!eatUnits.includes(cf.eUnit)) cf.eUnit = "servings";
        const per = () => ({ kcal: numOf(cf.kcal) || numOf(cf.p) * 4 + numOf(cf.c) * 4 + numOf(cf.f) * 9, p: numOf(cf.p), c: numOf(cf.c), f: numOf(cf.f) }); // calories from the macros when left blank
        const ratio = () => labelRatio({ sAmt: cf.sAmt, sUnit: cf.sUnit }, cf.eAmt, cf.eUnit);
        const totalEl = el("div", { class: "food-amt-tot" });
        const showTotal = () => { const k = ratio(), x = per(); totalEl.textContent = `You ate: ${Math.round(x.kcal * k)} cal · P ${r1(x.p * k)} · C ${r1(x.c * k)} · F ${r1(x.f * k)}`; };
        const box = (k, label, mode) => el("label", { class: "food-label" }, label, el("input", { class: "food-input", value: cf[k], inputmode: mode || "decimal", type: mode === "text" ? "text" : "number", step: "any", min: "0", oninput: (e) => { cf[k] = e.target.value; showTotal(); } }));
        const unitPick = (k, units, label) => el("select", { class: "food-select", "aria-label": label, onchange: (e) => { cf[k] = e.target.value; draw(); } },
          units.map((u) => { const o = el("option", { value: u }, u); if (u === cf[k]) o.selected = true; return o; }));
        const pair = (amtKey, unitKey, units, label) => el("label", { class: "food-label" }, label, el("div", { class: "food-pair" },
          el("input", { class: "food-input", value: cf[amtKey], inputmode: "decimal", type: "number", step: "any", min: "0", oninput: (e) => { cf[amtKey] = e.target.value; showTotal(); } }),
          unitPick(unitKey, units, label)));
        sheet.replaceChildren(close(), el("h2", null, fromDb ? cf.name || "Log food" : "Custom food"),
          box("name", "Food", "text"),
          el("div", { class: "nut-group" }, "From the label"),
          pair("sAmt", "sUnit", Object.keys(CUSTOM_UNITS), "Serving size"),
          el("div", { class: "food-grid" }, box("kcal", "Calories"), box("p", "Protein (g)"), box("c", "Carbs (g)"), box("f", "Fat (g)")),
          el("div", { class: "nut-group" }, "How much"),
          pair("eAmt", "eUnit", eatUnits, "Amount"),
          totalEl, mealPick(),
          el("div", { class: "swap-actions" }, el("button", { onclick: () => { custom = false; draw(); } }, "Back"), el("button", { class: "primary", onclick: () => {
            if (!cf.name.trim()) { showStatus("Give the food a name.", true); return; }
            if (!(ratio() > 0)) { showStatus("Enter how much.", true); return; }
            const x = per();
            const def = Object.assign({ name: cf.name.trim().slice(0, 60), sAmt: numOf(cf.sAmt) || 1, sUnit: cf.sUnit, kcal: Math.round(x.kcal), p: r1(x.p), c: r1(x.c), f: r1(x.f) }, cf.barcode ? { barcode: cf.barcode } : {}); // a scanned product entered by hand keeps its barcode
            // a food of their own goes into the shared library for good (one already there under the same name,
            // serving and calories is left as it is)
            if (!fromDb && api.foodLibraryAdd) {
              api.foodLibraryAdd(def).then((id) => {
                if (id && !libraryFoods.some((y) => y.id === id)) libraryFoods.push(Object.assign({ id, mine: true }, def));
              }).catch(() => {});
            }
            done({ kind: "label", def: fromDb ? Object.assign({ db: true }, def) : def, eAmt: cf.eAmt, eUnit: cf.eUnit });
          } }, addText)));
        showTotal();
        return;
      }
      const list = el("div", { class: "food-list" });
      const drawList = () => {
        const words = q.toLowerCase().trim();
        const match = (name) => !words || words.split(/\s+/).every((w) => name.toLowerCase().includes(w));
        const foods = Object.keys((nutrition && nutrition.foods) || {}).map(foodOf).filter((f) => f && match(f.name) && !foodBanned(f.key)).sort((a, b) => a.name.localeCompare(b.name));
        const mine = myFoods().filter((d) => match(d.name));
        const recent = recentFoods().filter((e) => match(e.name)).slice(0, 8);
        // the database is searched, not listed whole: the closest 40 names (those starting with the search first)
        const db = words ? databaseFoods().filter((d) => match(d.name) && !nameBanned(d.name))
          .sort((a, b) => (b.name.toLowerCase().startsWith(words) ? 1 : 0) - (a.name.toLowerCase().startsWith(words) ? 1 : 0) || a.name.localeCompare(b.name)).slice(0, 40) : [];
        const dbCount = databaseFoods().length;
        list.replaceChildren(
          el("button", { class: "food-row food-custom food-scan", onclick: () => openScanner((d, code) => { if (d) openLabel(d, true); else if (d === null) { custom = true; cf.name = ""; cf.barcode = code; draw(); } }, sheet) }, el("span", null, "▦ Scan a barcode"), el("small", null, "packaged foods")),
          el("button", { class: "food-row food-custom", onclick: () => { custom = true; cf.name = q.trim(); cf.barcode = ""; draw(); } }, el("span", null, "+ Custom food"), el("small", null, "from its nutrition label")),
          mine.length ? el("div", { class: "nut-group" }, "My foods") : "",
          ...mine.map((d) => el("button", { class: "food-row", onclick: () => openLabel(d, false) },
            el("span", null, d.name), el("small", null, `${d.kcal} cal / ${d.sAmt} ${d.sUnit}`))),
          recent.length ? el("div", { class: "nut-group" }, "Recent") : "",
          ...recent.map((e) => el("button", { class: "food-row", onclick: () => done(entryToItem(e)) },
            el("span", null, e.name, e.amount ? el("small", null, ` ${e.amount}`) : null), el("small", null, `${e.kcal} cal`))),
          foods.length ? el("div", { class: "nut-group" }, "Your plan’s foods") : "",
          ...foods.map((f) => el("button", { class: "food-row", onclick: () => { chosen = f; amt = defaultAmount(f); draw(); } },
            el("span", null, f.name), el("small", null, `${Math.round(f.kcal * defaultAmount(f))} cal · ${amountLabel(f, defaultAmount(f))}`))),
          db.length ? el("div", { class: "nut-group" }, "Food database") : "",
          ...db.map((d) => el("button", { class: "food-row", onclick: () => openLabel(d, true) },
            el("span", null, d.name), el("small", null, `${d.kcal} cal / ${d.sAmt} ${d.sUnit}`))),
          !words ? el("div", { class: "card-sub nut-note" }, `Type to search ${dbCount} more foods: whole foods, groceries, bars and shakes, restaurant meals, and foods other athletes have added.`)
            : !mine.length && !recent.length && !foods.length && !db.length ? el("div", { class: "card-sub nut-note" }, "Nothing found. Add it as a custom food from its label.") : "");
      };
      const search = el("input", { type: "search", class: "food-input", placeholder: "Search foods: chicken, rice, eggs…", value: q, oninput: (e) => { q = e.target.value; drawList(); } });
      sheet.replaceChildren(close(), el("h2", null, onPick ? `Add a food to ${meal ? meal.toLowerCase() : "the meal"}` : "Log food"), mealPick(), search, list);
      drawList();
    };
    draw();
    overlay.replaceChildren(sheet);
    overlay.className = "overlay show";
  }

  // The meal editor: a sample meal, an option, a custom meal or what's already planned, laid out food by food. A food
  // from the plan's lists can be swapped for another of the same group (resized to bring the same protein, carbohydrate
  // or fat), and any food resized, removed or added to; then the whole meal is logged, or planned for the day shown.
  // replaceIds: entries it stands in for (a planned meal being changed), taken out when it's saved.
  // the sample meal for a meal on a given day: that day of the two-week rotation (the week half by the calendar week)
  function sampleFor(dayKey, mealName) {
    const weeks = (nutrition && nutrition.weeks) || [];
    if (!weeks.length) return null;
    const [y, m, d] = dayKey.split("-").map(Number);
    const wk = weeks[Math.floor(Date.UTC(y, m - 1, d) / (7 * 86400000)) % weeks.length] || weeks[0];
    const day = wk[(new Date(y, m - 1, d).getDay() + 6) % 7];
    return (day && day.meals.find((x) => x.slot === mealName)) || null;
  }

  // Plan my week: the next seven days, starting from the example meal rotation. Opening it plans every meal not yet
  // logged or planned with that day's rotation meal (not the cheat meal, which is theirs to pick); then they tap a day
  // to adjust, swap or rebuild its meals. Reset puts the rotation back over what's planned; Clear empties the week.
  // Logged meals are never touched.
  function openWeekPlanner() {
    const sheet = el("div", { class: "sheet food-sheet week-planner" });
    const today = todayKey();
    const days = Array.from({ length: 7 }, (_, i) => shiftDay(today, i));
    const meals = ((nutrition && nutrition.meals) || []).filter((m) => !nutRest || m.rest).map((m) => m.name);
    // each meal still open is planned with the day's rotation meal; with replace, planned meals are replaced too
    const fillFromRotation = (replace) => {
      let added = 0;
      days.forEach((dk) => {
        let entries = foodDays[dk] || [];
        if (replace) entries = entries.filter((e) => !e.planned);
        const more = [];
        meals.forEach((name) => {
          if (entries.some((e) => e.meal === name)) return;
          let s = sampleFor(dk, name);
          if (!s || s.cheat || !s.parts || !s.parts.length) return;
          // a sample with a food they can't eat gives way to the closest option without one
          if (!partsOk(s.parts)) {
            const c = nutrition.choices && nutrition.choices[name];
            s = ((c && ((nutRest && c.rest) || c.train)) || []).find((o) => o.parts && o.parts.length && partsOk(o.parts));
            if (!s) return;
          }
          s.parts.forEach(([key, amt]) => { const f = foodOf(key); if (f) more.push(Object.assign(entryOf(f, amt, name), { planned: true })); });
          added += 1;
        });
        if (more.length || (replace && entries.length !== (foodDays[dk] || []).length)) setFoodDay(dk, entries.concat(more));
      });
      return added;
    };
    const draw = () => {
      const rows = days.map((dk) => {
        const entries = foodDays[dk] || [];
        const pills = meals.map((name) => {
          const mine = entries.filter((e) => e.meal === name);
          const state = eatenOf(mine).length ? "eaten" : plannedOf(mine).length ? "planned" : "open";
          return el("span", { class: `wk-pill ${state}`, title: `${name}: ${state}` }, name.replace("Mid-Morning ", "AM ").replace("Mid-Afternoon ", "PM ").replace("Post-Workout Shake", "Shake"));
        });
        const tot = sumOf(entries);
        return el("button", { class: "wk-day", onclick: () => { foodDay = dk; openMeals = new Set(); closeVideo(); redrawKeep(); } },
          el("div", { class: "wk-day-top" }, el("b", null, dayLabel(dk)), el("small", null, tot.kcal ? `${Math.round(tot.kcal).toLocaleString()} cal ›` : "nothing yet ›")),
          el("div", { class: "wk-pills" }, pills));
      });
      const reset = () => {
        if (!window.confirm("Put the example rotation back over every planned meal for the next 7 days? Meals you've logged stay.")) return;
        fillFromRotation(true);
        showStatus("Week reset to the rotation");
        draw();
      };
      const clear = () => {
        if (!window.confirm("Clear every planned meal for the next 7 days? Meals you've logged stay.")) return;
        days.forEach((dk) => { const entries = foodDays[dk] || []; if (entries.some((e) => e.planned)) setFoodDay(dk, entries.filter((e) => !e.planned)); });
        showStatus("Planned meals cleared");
        draw();
      };
      sheet.replaceChildren(
        el("button", { class: "close", "aria-label": "Close", onclick: () => { closeVideo(); redrawKeep(); } }, "×"),
        el("h2", null, "Plan my week"),
        el("div", { class: "card-sub nut-note" }, `Your week starts with the example meal rotation (${nutRest ? "rest" : "training"}-day amounts). Tap a day to adjust, swap or build any of its meals; the grocery list follows.`),
        el("div", { class: "wk-legend" }, el("span", { class: "wk-pill eaten" }, "logged"), el("span", { class: "wk-pill planned" }, "planned"), el("span", { class: "wk-pill open" }, "open")),
        ...rows,
        el("div", { class: "swap-actions" },
          el("button", { onclick: reset }, "Reset to the rotation"),
          el("button", { onclick: clear }, "Clear planned meals")));
    };
    const added = fillFromRotation(false);
    if (added) showStatus(`Planned ${added} meal${added === 1 ? "" : "s"} from the rotation`);
    draw();
    overlay.replaceChildren(sheet);
    overlay.className = "overlay show";
  }

  const SWAP_MACRO = { protein: "p", deli: "p", dairy: "p", starch: "c", fruit: "c", bar: "c", fat: "f" };
  function openMealEditor(opts) {
    const meal = opts.meal, day = foodDay || todayKey();
    const items = (opts.items || []).map((it) => Object.assign({}, it));
    const target = ((nutrition && nutrition.meals) || []).find((m) => m.name === meal);
    const t = target ? (nutRest && target.rest ? target.rest : target.train) : null;
    const sheet = el("div", { class: "sheet food-sheet meal-editor" });
    const planDays = new Set([day]); // the days Plan it puts this meal on
    const show = () => { draw(); overlay.replaceChildren(sheet); overlay.className = "overlay show"; };
    const swapTo = (it, key) => {
      const cur = foodOf(it.key), nf = foodOf(key);
      if (!cur || !nf) return;
      const m = SWAP_MACRO[cur.cat];
      let a = m && cur[m] > 0 && nf[m] > 0 ? (it.amt * cur[m]) / nf[m] : it.amt;
      a = Math.max(nf.step, Math.min(nf.max || 99, Math.round(a / nf.step) * nf.step));
      it.key = key; it.amt = a;
    };
    const draw = () => {
      const tot = items.map(itemTotals).reduce((s, x) => ({ kcal: s.kcal + x.kcal, p: s.p + x.p, c: s.c + x.c, f: s.f + x.f }), { kcal: 0, p: 0, c: 0, f: 0 });
      const rows = items.map((it, i) => {
        const x = itemTotals(it);
        const remove = el("button", { class: "food-x", "aria-label": "Remove", onclick: () => { items.splice(i, 1); draw(); } }, "×");
        if (it.kind === "plan") {
          const f = foodOf(it.key);
          if (!f) return null;
          const same = Object.keys(nutrition.foods).map(foodOf).filter((g) => g && g.cat === f.cat && (g.key === f.key || !foodBanned(g.key))).sort((a, b) => a.name.localeCompare(b.name));
          const pick = el("select", { class: "food-select me-swap", "aria-label": "Swap for", onchange: (e) => { swapTo(it, e.target.value); draw(); } },
            same.map((g) => { const o = el("option", { value: g.key }, g.name); if (g.key === f.key) o.selected = true; return o; }));
          const step = (by) => () => { it.amt = Math.max(f.step, Math.round((it.amt + by * f.step) * 100) / 100); draw(); };
          return el("div", { class: "me-row" }, pick,
            el("div", { class: "me-amt" }, el("button", { class: "me-step", "aria-label": "Less", onclick: step(-1) }, "−"), el("b", null, amountLabel(f, it.amt)), el("button", { class: "me-step", "aria-label": "More", onclick: step(1) }, "+")),
            el("small", { class: "me-cal" }, `${x.kcal} cal`), remove);
        }
        if (it.kind === "label") {
          const amtIn = el("input", { class: "food-input me-num", type: "number", step: "any", min: "0", inputmode: "decimal", value: it.eAmt, onchange: (e) => { it.eAmt = e.target.value; draw(); } });
          return el("div", { class: "me-row" }, el("span", { class: "me-name" }, it.def.name),
            el("div", { class: "me-amt" }, amtIn, el("small", null, it.eUnit)), el("small", { class: "me-cal" }, `${x.kcal} cal`), remove);
        }
        return el("div", { class: "me-row" }, el("span", { class: "me-name" }, it.entry.name, it.entry.amount ? el("small", null, ` ${it.entry.amount}`) : null), el("span", null), el("small", { class: "me-cal" }, `${x.kcal} cal`), remove);
      }).filter(Boolean);
      const off = t ? Math.round(tot.kcal - t.kcal) : 0;
      const save = (asPlan) => {
        const make = () => items.map((it) => itemToEntry(it, meal)).filter(Boolean).map((e) => Object.assign(e, { planned: !!asPlan }));
        if (!make().length) { showStatus("Add a food first.", true); return; }
        // planned on more days than the one shown: the same meal on each, in place of what was planned for it there
        const targets = asPlan ? [...planDays].sort() : [day];
        targets.forEach((dk) => {
          const kept = (foodDays[dk] || []).filter((e) => (dk === day ? !(opts.replaceIds || []).includes(e.id) : !(e.planned && e.meal === meal)));
          setFoodDay(dk, kept.concat(make()));
        });
        closeVideo();
        showStatus(`${asPlan ? "Planned" : "Logged"} ${meal.toLowerCase()}${targets.length > 1 ? ` on ${targets.length} days` : ""}`);
        redrawKeep();
      };
      const today = todayKey();
      // the days a plan goes on: the day shown, and any others in the coming week they tick
      const week = Array.from({ length: 7 }, (_, i) => shiftDay(today, i));
      const dayChips = day >= today ? el("div", { class: "me-days" },
        el("small", null, "Plan on:"),
        el("div", { class: "chips nut-chips" }, week.map((dk) => el("button", { class: `chip${planDays.has(dk) ? " on" : ""}`, onclick: () => {
          if (planDays.has(dk)) { if (planDays.size > 1) planDays.delete(dk); } else planDays.add(dk);
          draw();
        } }, dk === today ? "Today" : new Date(`${dk}T12:00:00`).toLocaleDateString(undefined, { weekday: "short" }))))) : null;
      sheet.replaceChildren(
        el("button", { class: "close", "aria-label": "Close", onclick: closeVideo }, "×"),
        el("h2", null, opts.title || meal),
        el("div", { class: "card-sub nut-note" }, `${meal} · ${dayLabel(day)}${opts.note ? ` · ${opts.note}` : ""}. Swap a food with its menu, change amounts with − and +, or add more.`),
        rows.length ? el("div", { class: "me-rows" }, rows) : el("div", { class: "card-sub nut-note" }, "No foods yet. Add some below."),
        el("button", { class: "food-logmeal me-add", onclick: () => openFoodPicker(meal, (item) => { items.push(item); show(); }) }, "+ Add a food"),
        el("div", { class: `me-tot${t && Math.abs(off) > t.kcal * 0.15 ? " off" : ""}` },
          el("b", null, `${Math.round(tot.kcal)} cal`), ` · P ${r1(tot.p)} · C ${r1(tot.c)} · F ${r1(tot.f)}`,
          t ? el("small", null, `Target: ${t.kcal} cal · P ${t.p} · C ${t.c} · F ${t.f}`) : null),
        dayChips,
        el("div", { class: "swap-actions" },
          day <= today ? el("button", { class: "primary", onclick: () => save(false) }, day === today ? "Log it" : `Log for ${dayLabel(day).toLowerCase()}`) : null,
          day >= today ? el("button", { class: day > today ? "primary" : "", onclick: () => save(true) }, planDays.size > 1 ? `Plan on ${planDays.size} days` : day === today ? "Plan it for later" : "Plan it") : null),
        // My meals (once they've loaded; there are none until migration_025 has been run)
        savedMeals ? el("button", { class: "food-logmeal nut-other me-save", onclick: saveMine }, opts.savedId ? "Update in My meals" : "Save to My meals") : null);
    };
    // the meal as it stands, kept under a name in My meals (a saved meal opened here is updated, or saved as a new one
    // under a new name)
    const saveMine = () => {
      if (!items.length) { showStatus("Add a food first.", true); return; }
      const name = (window.prompt("Name this meal", opts.savedName || (opts.title && !/^Custom /.test(opts.title) ? opts.title : "")) || "").trim().slice(0, 60);
      if (!name) return;
      const id = opts.savedId && name === opts.savedName ? opts.savedId : `sm-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      const data = { name, meal, items: items.map((it) => JSON.parse(JSON.stringify(it))) };
      savedMeals = [{ id, data }].concat((savedMeals || []).filter((x) => x.id !== id));
      opts.savedId = id; opts.savedName = name;
      api.savedMealSave(id, data).then((ok) => showStatus(ok ? `Saved ${name} to My meals` : "Not saved. Check your connection and try again.", !ok));
      draw();
    };
    show();
  }

  // ---- Nutrition: the plan the coach built on the dashboard (nutrition.js), as it wrote it out for the phone ------
  // The day's targets (training or rest day) and the countdown for the day shown (a week back to log, a week ahead to
  // plan); Your meals, each opening to what's logged or planned, the day's sample meal, the options sized to that meal
  // and a custom meal, all logged or planned whole through the meal editor; the food exchange lists; and a grocery list
  // from what's planned, hydration and supplements, folded away.
  let openMeals = new Set(); // the meals opened in Your meals
  // ---- a coach sets the plan from the app ---------------------------------------------------------------
  // In Coach Mode (an athlete's app, or their own) and on a coach's own link (?staff=1), a coach can set the goal, and
  // the weight and details the plan is built from, without the dashboard. The plan is worked out here with the same
  // engine as the dashboard (nutrition_engine.js) and saved the way the dashboard saves it. Details entered here take
  // over from a body composition that's older (nutrition.js). Changing only the goal keeps what the plan was worked out
  // from (the snapshot's `basis`), body comp sheet and all. It needs the coach signed in (Coach Mode's sign-in): the
  // record is written as staff, and the athlete's own link can't change it.
  const canPlanNutrition = () => !!(staff || coachId) && !!window.NutritionEngine;
  async function nutritionContext() {
    const { data: s } = await sb.auth.getSession();
    if (!s || !s.session) return { signedOut: true };
    let aid = coachId ? String(coachId) : null;
    if (!aid && token) {
      const r = await sb.from("athlete_links").select("athlete_id").eq("token", token).maybeSingle();
      aid = r.data ? String(r.data.athlete_id) : null;
    }
    if (!aid) return { error: true };
    const [plan0, prefs, ath] = await Promise.all([
      sb.from("assessments").select("data").eq("id", `nutrition-${aid}`).maybeSingle(),
      sb.from("assessments").select("data").eq("id", `nutprefs-${aid}`).maybeSingle(),
      sb.from("athletes").select("data").eq("id", aid).maybeSingle(),
    ]);
    if (plan0.error || ath.error) return { error: true };
    return { aid, rec: plan0.data ? plan0.data.data : null, prefs: prefs.data ? prefs.data.data : null, athlete: (ath.data && ath.data.data) || {} };
  }
  const ageFrom = (dob) => {
    const d = dob ? new Date(`${String(dob).slice(0, 10)}T12:00:00`) : null;
    if (!d || isNaN(d)) return "";
    const now = new Date();
    return String(now.getFullYear() - d.getFullYear() - (now < new Date(now.getFullYear(), d.getMonth(), d.getDate()) ? 1 : 0));
  };
  // the training and sport minutes the plan uses: set in the app, else what the basis came with
  const minutesOf = (rec, b) => {
    const mm = (rec && rec.minutes) || {}, m = (rec && rec.manual) || {};
    const pick = (k, d) => [mm[k], b && b[k], m[k]].map((v) => parseFloat(v)).find((v) => Number.isFinite(v)) ?? d;
    return { trainMin: pick("trainMin", 120), sportMin: pick("sportMin", 30) };
  };
  // Works the plan out again and saves it: the goal, the basis (with the minutes applied), the details entered (or
  // none, keeping the body composition) and any targets kept from the dashboard. Planned meals are resized to it.
  async function savePlanFromApp(ctx, o) {
    const E = window.NutritionEngine, rec = ctx.rec || {};
    const basis = E.withMinutes(o.basis, o.minutes);
    const allergies = ctx.prefs && Array.isArray(ctx.prefs.allergies) ? ctx.prefs.allergies.filter((a) => E.ALLERGIES[a]) : [];
    const seed = rec.seed || Math.floor(Math.random() * 1e9);
    const T = E.targetsFor(basis, o.goal, o.targets);
    const snap = E.snapshotOf(basis, T, E.buildPlan(T, seed, { school: !!rec.schoolLunch, allergies }), E.macroLists(T, { allergies }), E.mealTimes(basis, rec));
    const record = Object.assign({ id: `nutrition-${ctx.aid}`, athleteId: ctx.aid, kind: "nutrition", seed }, rec, { goal: o.goal, minutes: o.minutes, snapshot: JSON.parse(JSON.stringify(snap)), date: todayKey(), editedIn: "app" });
    if (o.manual) record.manual = o.manual; else delete record.manual;
    if (o.targets) record.targets = o.targets; else delete record.targets;
    const { error } = await sb.from("assessments").upsert({ id: record.id, athlete_id: String(ctx.aid), data: record });
    if (error) return false;
    nutrition = record.snapshot;
    const resized = fitPlanned();
    showStatus(resized ? `Plan saved · planned meals resized on ${resized} day${resized === 1 ? "" : "s"}` : "Nutrition plan saved");
    return true;
  }
  // Training and sport minutes on their own, from the Nutrition tab (a coach): the same body composition and goal,
  // the activity calories (and so the targets) following the new minutes
  async function openMinutesEditor() {
    overlay.replaceChildren(el("div", { class: "sheet" }, el("h2", null, "Training & sport time"), el("div", { class: "card-sub" }, "Loading…")));
    overlay.className = "overlay show";
    const ctx = await nutritionContext().catch(() => ({ error: true }));
    if (ctx.signedOut || ctx.error || !ctx.rec || !nutrition || !nutrition.basis) { openPlanEditor(); return; } // signing in, or no plan to keep: the full editor
    const rec = ctx.rec, cur = minutesOf(rec, nutrition.basis);
    const box = (label, v) => el("input", { type: "text", inputmode: "numeric", value: String(cur[v]), autocomplete: "off", "aria-label": label });
    const t = box("Training minutes a day", "trainMin"), s = box("Sport minutes a day", "sportMin");
    const msg = el("div", { class: "pe-msg" });
    const save = el("button", { class: "primary" }, "Save");
    save.addEventListener("click", async () => {
      const tv = parseFloat(t.value), sv = parseFloat(s.value);
      if (!(tv >= 0 && tv <= 600) || !(sv >= 0 && sv <= 600)) { msg.textContent = "Enter minutes a day (0 to 600)."; return; }
      save.disabled = true; msg.textContent = "Saving…";
      const ok = await savePlanFromApp(ctx, { goal: rec.goal, basis: nutrition.basis, manual: rec.manual, minutes: { trainMin: tv, sportMin: sv }, targets: rec.targets && (rec.targets.train || rec.targets.rest) ? rec.targets : null });
      if (!ok) { save.disabled = false; msg.textContent = "Couldn't save. Check your connection and try again."; return; }
      closeVideo(); redrawKeep();
    });
    overlay.replaceChildren(el("div", { class: "sheet plan-edit" },
      el("button", { class: "close", "aria-label": "Close", onclick: closeVideo }, "×"),
      el("h2", null, "Training & sport time"),
      el("div", { class: "swap-coach" }, "Minutes a day of training (lifting, running, conditioning) and of sport (practice, games). The calories follow them; the rest of the plan stays as it is."),
      el("div", { class: "pe-grid" },
        el("label", { class: "pe-field" }, el("span", null, "Training"), el("div", { class: "pe-in" }, t, el("em", null, "min/day"))),
        el("label", { class: "pe-field" }, el("span", null, "Sport"), el("div", { class: "pe-in" }, s, el("em", null, "min/day")))),
      rec.targets && (rec.targets.train || rec.targets.rest) ? el("div", { class: "card-sub" }, "Calories and macros were set by hand on the dashboard, so they stay as they are until those are cleared.") : null,
      msg,
      el("div", { class: "swap-actions" }, save, el("button", { onclick: closeVideo }, "Cancel"))));
  }

  // ---- planned meals follow the plan ---------------------------------------------------------------------
  // A meal planned ahead keeps the foods picked, but once the plan's targets change (a new goal, weight or training
  // time) its amounts are resized to the meal's target again, so a planned day adds up to the day's calories. Only
  // today and the days ahead, only meals not eaten yet, and only meals more than 3% off. Returns the days changed.
  function scaleEntry(e, k) {
    const f = e.key ? foodOf(e.key) : null;
    if (f && e.qty) {
      const q = Math.max(f.step, Math.min(f.max || 99, Math.round((e.qty * k) / f.step) * f.step));
      return Object.assign(entryOf(f, q, e.meal), { id: e.id, planned: true });
    }
    if (e.def && e.qty) {
      const n = itemToEntry({ kind: "label", def: e.def, eAmt: String(Math.max(0.25, Math.round(e.qty * k * 4) / 4)), eUnit: e.unit || "servings" }, e.meal);
      return n ? Object.assign(n, { id: e.id, planned: true }) : null;
    }
    return null;
  }
  function fitPlanned() {
    if (!foodDays || !nutrition || !nutrition.meals) return 0;
    const today = todayKey();
    let days = 0;
    Object.keys(foodDays).filter((dk) => dk >= today).forEach((dk) => {
      const set = dayTypeOf(dk), prog = programDayType(dk);
      const rest = set != null ? set : prog ? prog.rest : false;
      const out = (foodDays[dk] || []).slice();
      let dirty = false;
      nutrition.meals.forEach((m) => {
        const tg = rest ? m.rest : m.train;
        if (!tg || !tg.kcal) return;
        const at = out.map((e, i) => (e.meal === m.name && e.planned && e.name ? i : -1)).filter((i) => i >= 0);
        const tot = at.reduce((sum, i) => sum + (+out[i].kcal || 0), 0);
        if (!tot || Math.abs(tot - tg.kcal) / tg.kcal <= 0.03) return;
        at.forEach((i) => { const n = scaleEntry(out[i], tg.kcal / tot); if (n) { out[i] = n; dirty = true; } });
      });
      if (dirty) { setFoodDay(dk, out); days += 1; }
    });
    return days;
  }
  // once both the plan and the food log are in (each loads on its own), planned meals are checked against the plan
  let plannedChecked = false;
  const checkPlanned = () => {
    if (plannedChecked || !foodDays || !nutrition) return;
    plannedChecked = true;
    const n = fitPlanned();
    if (n) { showStatus(`Planned meals resized to your plan on ${n} day${n === 1 ? "" : "s"}`); if (view === "nutrition" && !overlay.className.includes("show")) redrawKeep(); }
  };

  async function openPlanEditor() {
    const E = window.NutritionEngine;
    overlay.replaceChildren(el("div", { class: "sheet" }, el("h2", null, "Nutrition plan"), el("div", { class: "card-sub" }, "Loading…")));
    overlay.className = "overlay show";
    const ctx = await nutritionContext().catch(() => ({ error: true }));
    const shell = (...kids) => overlay.replaceChildren(el("div", { class: "sheet plan-edit" },
      el("button", { class: "close", "aria-label": "Close", onclick: closeVideo }, "×"), el("h2", null, "Nutrition plan"), ...kids));
    if (ctx.signedOut) {
      shell(el("div", { class: "swap-coach" }, "Sign in with your dashboard account to set a nutrition plan from the app."),
        el("div", { class: "swap-actions" }, el("button", { class: "primary", onclick: () => { window.location.href = "coach.html?from=app"; } }, "Sign in (Coach Mode)"), el("button", { onclick: closeVideo }, "Cancel")));
      return;
    }
    if (ctx.error) { shell(el("div", { class: "swap-coach" }, "Couldn't load the plan. Check your connection and try again."), el("div", { class: "swap-actions" }, el("button", { onclick: closeVideo }, "Close"))); return; }
    const rec = ctx.rec || {}, m = rec.manual || {}, snapBasis = nutrition && nutrition.basis;
    const lastWeigh = weighIns().pop();
    // filled in from what's on file: the weight from the latest weigh-in, else the details entered before, else the
    // body composition the plan uses now
    const start = {
      weightLb: lastWeigh ? String(lastWeigh.lb) : m.weightLb || (snapBasis ? String(Math.round(snapBasis.weightLb * 10) / 10) : ""),
      age: m.age || (snapBasis && snapBasis.age ? String(snapBasis.age) : ageFrom(ctx.athlete.dob)),
      sex: m.sex || (snapBasis ? (snapBasis.male ? "M" : "F") : /^f/i.test(ctx.athlete.gender || "") ? "F" : "M"),
      bodyFatPct: m.bodyFatPct || (snapBasis && snapBasis.pctFat != null ? String(Math.round(snapBasis.pctFat * 10) / 10) : ""),
      trainMin: String(minutesOf(rec, snapBasis).trainMin),
      sportMin: String(minutesOf(rec, snapBasis).sportMin),
    };
    const f = Object.assign({}, start, { goal: rec.goal && E.GOALS[rec.goal] ? rec.goal : "" });
    const field = (label, k, unit, mode) => {
      const i = el("input", { type: "text", inputmode: mode || "decimal", value: f[k], autocomplete: "off", "aria-label": label });
      i.addEventListener("input", () => { f[k] = i.value.trim(); });
      return el("label", { class: "pe-field" }, el("span", null, label), el("div", { class: "pe-in" }, i, unit ? el("em", null, unit) : null));
    };
    const sexSel = el("select", { "aria-label": "Sex" }, el("option", { value: "M" }, "Male"), el("option", { value: "F" }, "Female"));
    sexSel.value = f.sex; sexSel.addEventListener("change", () => { f.sex = sexSel.value; });
    const goalSel = el("select", { "aria-label": "Goal" }, el("option", { value: "" }, "Choose a goal…"), ...E.GOAL_KEYS.map((k) => el("option", { value: k }, E.GOALS[k].label)));
    goalSel.value = f.goal; goalSel.addEventListener("change", () => { f.goal = goalSel.value; });
    const hasTargets = !!(rec.targets && (rec.targets.train || rec.targets.rest));
    const clearBox = hasTargets ? el("input", { type: "checkbox", checked: true }) : null;
    const msg = el("div", { class: "pe-msg" });
    const from = snapBasis && snapBasis.source !== "manual" ? `the ${snapBasis.source === "sheet" ? "body comp sheet" : "Evolt scan"} of ${snapBasis.date}` : null;
    const save = el("button", { class: "primary" }, nutrition ? "Save plan" : "Build plan");
    save.addEventListener("click", async () => {
      // training and sport minutes are kept on their own (rec.minutes), so changing them keeps the body composition
      const details = ["weightLb", "age", "sex", "bodyFatPct"];
      const changed = details.some((k) => String(f[k] || "") !== String(start[k] || ""));
      if (!f.goal) { msg.textContent = "Choose a goal."; return; }
      const lb = parseFloat(f.weightLb);
      if (!(lb >= 50 && lb <= 500)) { msg.textContent = "Enter a weight in pounds."; return; }
      const t = parseFloat(f.trainMin), s = parseFloat(f.sportMin);
      if (!(t >= 0 && t <= 600) || !(s >= 0 && s <= 600)) { msg.textContent = "Enter the training and sport minutes a day."; return; }
      const minutes = { trainMin: t, sportMin: s };
      const today = todayKey();
      // only the goal (or the minutes) changed on a plan from a body composition: the same basis
      const keepBasis = !changed && snapBasis && snapBasis.source !== "manual";
      const manual = keepBasis ? rec.manual : { weightLb: String(lb), age: f.age, sex: f.sex, bodyFatPct: f.bodyFatPct, trainMin: String(t), sportMin: String(s), date: today };
      const basis = keepBasis ? snapBasis : E.manualBasis(manual, parseFloat(ageFrom(ctx.athlete.dob)) || null, f.sex);
      const targets = hasTargets && !(clearBox && clearBox.checked) ? rec.targets : null;
      save.disabled = true; msg.textContent = "Saving…";
      const ok = await savePlanFromApp(ctx, { goal: f.goal, basis, manual, minutes, targets });
      if (!ok) { save.disabled = false; msg.textContent = "Couldn't save. Check your connection and try again."; return; }
      closeVideo();
      view = "nutrition"; render();
    });
    shell(
      el("div", { class: "swap-coach" }, from
        ? `Built from ${from}. Change only the goal to keep using it, or enter a weight and details to build from them instead (until a newer body comp is on file).`
        : "Enter the weight and details the plan is built from, and the goal. Pre-lift weigh-ins on the Program page keep it up to date."),
      el("label", { class: "pe-field" }, el("span", null, "Goal"), goalSel),
      el("div", { class: "pe-grid" },
        field("Weight", "weightLb", "lb"), field("Age", "age", "yrs", "numeric"),
        el("label", { class: "pe-field" }, el("span", null, "Sex"), sexSel), field("Body fat (optional)", "bodyFatPct", "%"),
        field("Training", "trainMin", "min/day", "numeric"), field("Sport", "sportMin", "min/day", "numeric")),
      hasTargets ? el("label", { class: "pe-check" }, clearBox, " Use the worked-out calories and macros (clears the ones set by hand on the dashboard)") : null,
      msg,
      el("div", { class: "swap-actions" }, save, el("button", { onclick: closeVideo }, "Cancel")));
  }

  function nutritionView() {
    const main = el("main", { class: "nut-main" });
    const n = nutrition;
    if (!n) {
      main.append(el("div", { class: "card" },
        el("div", { class: "card-title" }, "No nutrition plan yet"),
        el("div", { class: "card-sub" }, staff || coachId
          ? "Set a weight and a goal here to build the plan, or set one up on the dashboard's Nutrition tab."
          : "Your coach hasn’t set up your nutrition plan yet. It shows here as soon as they do."),
        canPlanNutrition() ? el("div", { class: "swap-actions" }, el("button", { class: "primary", onclick: openPlanEditor }, "Set up a nutrition plan")) : null));
      return main;
    }
    // the allergy question comes first, once: nothing else opens until it's answered (or they say they have none)
    if (api.allergies && !allergyLoaded) { main.append(el("div", { class: "card" }, el("div", { class: "card-sub" }, "Loading your nutrition plan…"))); return main; }
    if (allergyInfo && !allergyInfo.asked) { main.append(allergyForm(true)); return main; }
    const redraw = redrawKeep;
    const macros = (t) => `P ${t.p} · C ${t.c} · F ${t.f}`;
    if (!foodDay) foodDay = todayKey();
    // a day shown for the first time takes the training or rest day it was logged as, or else the one on their program
    // (training with neither); until the food log is in, the program's
    const fromProgram = programDayType(foodDay);
    const setOn = foodDays ? dayTypeOf(foodDay) : null;
    if (foodDay !== dayTypeShown) { nutRest = setOn != null ? setOn : fromProgram ? fromProgram.rest : false; if (foodDays) dayTypeShown = foodDay; }
    const day = nutRest ? n.rest : n.train;
    if (!foodDay) foodDay = todayKey();
    const today = todayKey();
    // training or rest day, as a tab bar across the top (like Strength / Speed on the Program page)
    main.append(el("div", { class: "lane-tabs nut-lanes", role: "tablist" },
      [["Training day", false], ["Rest day", true]].map(([text, rest]) => el("button", { class: `lane-tab${nutRest === rest ? " on" : ""}`, role: "tab", "aria-selected": nutRest === rest ? "true" : "false", onclick: () => {
        nutRest = rest;
        if (foodDays) setDayType(foodDay, rest); // the day is logged as a training or rest day (their coach sees it)
        redraw();
      } }, text))));
    // where the setting came from, when it's the program's
    if (setOn == null && fromProgram) main.append(el("div", { class: "nut-daytype-why" }, fromProgram.rest ? `Rest day: ${fromProgram.why}. Tap Training day if you train.` : `Training day: ${fromProgram.why}.`));
    const al = myAllergies();
    main.append(el("div", { class: "card nut-head" },
      el("div", { class: "card-title" }, n.goal),
      allergyInfo ? el("button", { class: "nut-allergy-line", onclick: openAllergySheet },
        "Food allergies: ", el("b", null, al.length ? al.map((a) => ALLERGY_LABELS[a]).join(", ") : allergyInfo.asked ? "none" : "not set"), el("span", null, " · change")) : null,
      el("div", { class: "sum-stats" },
        el("div", null, el("b", null, day.kcal.toLocaleString()), el("span", null, "calories")),
        el("div", null, el("b", null, `${day.p}g`), el("span", null, "protein")),
        el("div", null, el("b", null, `${day.c}g`), el("span", null, "carbs")),
        el("div", null, el("b", null, `${day.f}g`), el("span", null, "fat"))),
      nutRest ? el("div", { class: "card-sub" }, "Rest day: the same protein and fat with less carbohydrate, and no post-workout shake.") : null,
      // the training and sport time the calories are worked out for (a coach can change it here)
      n.basis ? (() => { const mm = minutesOf(null, n.basis), text = `Training ${mm.trainMin} min · sport ${mm.sportMin} min a day`;
        return canPlanNutrition() ? el("button", { class: "nut-allergy-line nut-minutes", onclick: openMinutesEditor }, text, el("span", null, " · change")) : el("div", { class: "nut-allergy-line nut-minutes" }, text); })() : null,
      canPlanNutrition() ? el("button", { class: "nut-coach-edit", onclick: openPlanEditor }, "Coach: change weight or goal") : null));

    // the countdown for the day shown (once the food log has loaded; there is none until migration_023 has been run)
    if (foodDays) main.append(el("h2", { class: "section" }, "Food log", el("small", null, foodDay > today ? "planning ahead" : "counts down to your targets")), foodLogCard(day));
    // water for the day shown (not a day still to come)
    if (foodDays && foodDay <= today) main.append(el("h2", { class: "section" }, "Water", el("small", null, dayLabel(foodDay))), waterCard(foodDay, nutRest));

    // ---- Your meals: one cell per meal for the day shown
    const entries = (foodDays && foodDays[foodDay]) || [];
    const weeks = n.weeks || [];
    const [yy, mm, dd] = foodDay.split("-").map(Number);
    const dayDate = new Date(yy, mm - 1, dd);
    const sampleDay = weeks.length ? (weeks[Math.floor(Date.UTC(yy, mm - 1, dd) / (7 * 86400000)) % weeks.length] || weeks[0])[(dayDate.getDay() + 6) % 7] : null;
    main.append(el("h2", { class: "section" }, "Your meals", el("small", null, `${dayLabel(foodDay)} · ${nutRest ? "rest day" : "training day"}`)));
    main.append(el("div", { class: "card-sub nut-note" }, foodDays
      ? (foodDay > today ? "Tap a meal to plan it: the sample, an option, or your own." : "Tap a meal to log it: the sample, an option, your own, or a single food.")
      : "Tap a meal for its sample and options."));
    if (foodDays) main.append(el("button", { class: "meal-act week-act", onclick: openWeekPlanner },
      el("b", null, "Plan my week"), el("small", null, "See the next 7 days, fill them with sample meals, or jump to a day"), el("span", { class: "nut-chev", "aria-hidden": "true" }, "›")));
    const cells = n.meals.filter((m) => !nutRest || m.rest).map((m) => {
      const t = nutRest ? m.rest : m.train;
      const mine = entries.filter((e) => e.meal === m.name);
      const eaten = eatenOf(mine), planned = plannedOf(mine);
      const open = openMeals.has(m.name);
      const toggle = () => { if (open) openMeals.delete(m.name); else openMeals.add(m.name); redraw(); };
      const status = eaten.length ? `${Math.round(sumOf(eaten).kcal)} of ${t.kcal} cal` : planned.length ? `Planned · ${Math.round(sumOf(planned).kcal)} cal` : `${t.kcal} cal`;
      const head = el("button", { class: `nut-meal-row nut-meal-btn${eaten.length ? " done" : ""}`, "aria-expanded": open ? "true" : "false", onclick: toggle },
        el("div", { class: "nut-meal-name" }, el("b", null, m.name), el("small", null, m.time)),
        el("div", { class: "nut-meal-fig" }, el("b", null, status), el("small", null, macros(t))),
        el("span", { class: "nut-chev", "aria-hidden": "true" }, open ? "▾" : "›"));
      if (!open) return el("div", { class: "meal-cell" }, head);
      const body = [];
      const remove = (id) => { setFoodDay(foodDay, entries.filter((e) => e.id !== id)); redraw(); };
      const sample0 = sampleDay && sampleDay.meals.find((x) => x.slot === m.name);
      // a lunch or dinner sample is named for its protein and starch ("Tilapia & Pasta") rather than for the meal
      const sampleName = (s) => { const a = s.parts && s.parts[0] && foodOf(s.parts[0][0]), b = s.parts && s.parts[1] && foodOf(s.parts[1][0]); return s.title && s.title !== m.name ? s.title : a && b ? `${a.name} & ${b.name}` : m.name; };
      // a sample or option with a food they can't eat is left out (they pick a different meal instead)
      const sample = sample0 && !sample0.cheat ? (partsOk(sample0.parts) ? Object.assign({}, sample0, { title: sampleName(sample0) }) : null) : sample0;
      const choices = (n.choices && n.choices[m.name] ? (nutRest && n.choices[m.name].rest ? n.choices[m.name].rest : n.choices[m.name].train) || [] : []).filter((o) => partsOk(o.parts));
      // the meal shown: what's logged (or planned) for it, or else the day's sample meal
      if (mine.length) {
        body.push(el("div", { class: "meal-done" }, mine.map((e) => el("div", { class: `food-entry${e.planned ? " planned" : ""}` },
          el("span", null, e.name, e.amount ? el("small", null, ` ${e.amount}`) : null, e.planned ? el("em", { class: "food-plan-tag" }, " planned") : null),
          el("small", null, `${e.kcal} cal`),
          el("button", { class: "food-x", "aria-label": `Remove ${e.name}`, onclick: () => remove(e.id) }, "×")))));
        if (planned.length && foodDay <= today) {
          body.push(el("button", { class: "food-logmeal meal-ate", onclick: () => {
            setFoodDay(foodDay, entries.map((e) => (e.meal === m.name && e.planned ? Object.assign({}, e, { planned: false }) : e)));
            showStatus(`Logged ${m.name.toLowerCase()}`); redraw();
          } }, "✓ I ate this"));
        }
      } else if (sample) {
        body.push(el("div", { class: "meal-current" },
          el("div", { class: "meal-opt-top" }, el("b", null, sample.cheat ? "Cheat meal" : sample.title || m.name, el("em", { class: "food-plan-tag" }, ` ${foodDay === today ? "today's meal" : `for ${dayLabel(foodDay).toLowerCase()}`}`)),
            el("small", null, sample.cheat ? "your pick" : `${sample.tot.kcal} cal · ${macros(sample.tot)}`)),
          el("div", { class: "meal-opt-items" }, sample.cheat ? "Enjoy it, then back on plan. Log what you have with + Add a single food." : sample.items.join(" · ")),
          sample.note ? el("div", { class: "card-sub" }, sample.note) : null));
      }
      if (foodDays) {
        // three ways to go: adjust the meal shown, pick a different ready-made (or saved) meal, or build one from
        // scratch; a meal already planned is replaced by whichever is logged or planned instead
        const shown = eaten.length ? eaten : planned;
        const adjustItems = shown.length ? shown.map(entryToItem) : sample && !sample.cheat && sample.parts ? sample.parts.map(([key, amt]) => ({ kind: "plan", key, amt })) : [];
        const replaceIds = planned.map((e) => e.id);
        const saved = (savedMeals || []).length;
        const act = (title, sub, onclick) => el("button", { class: "meal-act", onclick }, el("b", null, title), el("small", null, sub), el("span", { class: "nut-chev", "aria-hidden": "true" }, "›"));
        // nothing on this meal yet and they ate it yesterday: the same again in a tap (planned, for a day still to come)
        const yesterday = mine.length ? [] : eatenOf((foodDays[shiftDay(foodDay, -1)] || []).filter((e) => e.meal === m.name && e.name));
        body.push(el("div", { class: "meal-actions" },
          yesterday.length ? act("Same as yesterday", `${yesterday.map((e) => e.name).join(", ")} · ${Math.round(sumOf(yesterday).kcal)} cal`, () => {
            setFoodDay(foodDay, entries.concat(yesterday.map((e) => Object.assign({}, e, { id: newEntryId(), planned: foodDay > today }))));
            showStatus(foodDay > today ? `Planned ${m.name.toLowerCase()}` : `Logged ${m.name.toLowerCase()}`); redraw();
          }) : null,
          adjustItems.length ? act("Adjust this meal", "Swap foods or change amounts", () => openMealEditor({
            meal: m.name, items: adjustItems, replaceIds: shown.map((e) => e.id),
            title: eaten.length ? `${m.name} (logged)` : planned.length ? `${m.name} (planned)` : sample.title || m.name, note: shown.length ? "" : sample.note,
          })) : null,
          choices.length || saved ? act("Pick a different meal", `${choices.length} ready-made option${choices.length === 1 ? "" : "s"}${saved ? " and your saved meals" : ""}`, () => openMealChooser(m.name, choices, replaceIds)) : null,
          act("Build my own meal", "Start from scratch with any foods", () => openMealEditor({ meal: m.name, title: `My ${m.name.toLowerCase()}`, items: [], replaceIds }))));
        body.push(el("button", { class: "meal-single", onclick: () => openFoodPicker(m.name) }, foodDay > today ? "+ Plan a single food" : "+ Add a single food"));
      } else if (choices.length) {
        // no food log yet (migration_023): the options, to read
        body.push(el("div", { class: "nut-group" }, `${m.name} options`));
        choices.forEach((o) => body.push(mealCard(o.name, o.tot, o.items, o.note, null)));
      }
      return el("div", { class: "meal-cell open" }, head, el("div", { class: "meal-body" }, body));
    });
    main.append(el("div", { class: "card nut-meals" }, cells));
    // one meal as a card: name, figures and foods, with Choose (and, for a saved meal, Delete) when given
    function mealCard(title, tot, itemTexts, note, onChoose, tag, onDelete) {
      return el("div", { class: "meal-opt" },
        el("div", { class: "meal-opt-top" }, el("b", null, title, tag ? el("em", { class: "food-plan-tag" }, ` ${tag}`) : null),
          el("small", null, `${Math.round(tot.kcal)} cal · P ${Math.round(tot.p)} · C ${Math.round(tot.c)} · F ${Math.round(tot.f)}`)),
        el("div", { class: "meal-opt-items" }, itemTexts.join(" · ")),
        note ? el("div", { class: "card-sub" }, note) : null,
        onChoose || onDelete ? el("div", { class: "nut-meal-acts" },
          onChoose ? el("button", { class: "food-logmeal", onclick: onChoose }, "Choose") : null,
          onDelete ? el("button", { class: "food-logmeal nut-other", onclick: onDelete }, "Delete") : null) : null);
    }
    // Pick a different meal: their saved meals (those saved from this meal first) and the ready-made options sized to
    // it; the one chosen opens in the meal editor, to change if they like, then log or plan
    function openMealChooser(mealName, choices, replaceIds) {
      const sheet = el("div", { class: "sheet food-sheet" });
      const draw = () => {
        const saved = (savedMeals || []).slice().sort((a, b) => (b.data.meal === mealName ? 1 : 0) - (a.data.meal === mealName ? 1 : 0));
        const savedCard = (s) => {
          const items = (s.data.items || []).filter((it) => it && (it.kind !== "plan" || foodOf(it.key)));
          const tot = items.map(itemTotals).reduce((a, x) => ({ kcal: a.kcal + x.kcal, p: a.p + x.p, c: a.c + x.c, f: a.f + x.f }), { kcal: 0, p: 0, c: 0, f: 0 });
          const names = items.map((it) => { const e = itemToEntry(it, ""); return e ? `${e.amount ? `${e.amount} ` : ""}${e.name}` : ""; }).filter(Boolean);
          return mealCard(s.data.name, tot, names, "",
            () => openMealEditor({ meal: mealName, title: s.data.name, items: items.map((it) => JSON.parse(JSON.stringify(it))), savedId: s.id, savedName: s.data.name, replaceIds }),
            s.data.meal && s.data.meal !== mealName ? s.data.meal.toLowerCase() : "",
            () => {
              if (!window.confirm(`Delete ${s.data.name} from My meals?`)) return;
              savedMeals = savedMeals.filter((x) => x.id !== s.id);
              api.savedMealSave(s.id, null).then((ok) => { if (!ok) showStatus("Not deleted. Check your connection and try again.", true); });
              draw();
            });
        };
        sheet.replaceChildren(
          el("button", { class: "close", "aria-label": "Close", onclick: () => { closeVideo(); redraw(); } }, "×"),
          el("h2", null, `Pick a different ${mealName.toLowerCase()}`),
          el("div", { class: "card-sub nut-note" }, "Each one fits this meal's targets. Choose one to log or plan it, changing anything you like first."),
          saved.length ? el("div", { class: "nut-group" }, "My meals") : "",
          ...saved.map(savedCard),
          choices.length ? el("div", { class: "nut-group" }, "Ready-made options") : "",
          ...choices.map((o) => mealCard(o.name, o.tot, o.items, o.note,
            o.parts && o.parts.length ? () => openMealEditor({ meal: mealName, title: o.name, items: o.parts.map(([key, amt]) => ({ kind: "plan", key, amt })), note: o.note, replaceIds }) : null)));
      };
      draw();
      overlay.replaceChildren(sheet);
      overlay.className = "overlay show";
    }

    // ---- the food exchange lists
    const fold = (title, ...body) => el("details", { class: "card nut-fold" }, el("summary", null, title), ...body);
    const table = (rows, heads) => el("table", { class: "nut-table" },
      el("thead", null, el("tr", null, heads.map((h) => el("th", null, h)))),
      el("tbody", null, rows.map((r) => el("tr", null, r.map((c) => el("td", null, c))))));
    // ---- supplements, with the DST dispensary
    main.append(fold("Supplements",
      el("ul", { class: "nut-items" }, ["Fish oil", "Multi-vitamin", "Electrolytes", "Whey protein", "Creatine, beta-alanine, leucine"].map((s) => el("li", null, s))),
      el("div", { class: "card-sub" }, "NSF Certified for Sport products only."),
      el("a", { class: "food-logmeal thorne-link", href: THORNE_URL, target: "_blank", rel: "noopener" }, "Shop the DST dispensary on Thorne ↗")));

    // ---- eating on the road
    const road = roadFold(fold, nutRest);
    if (road) main.append(road);

    // ---- More: the grocery list (following what's planned for the coming week), hydration, packing and the exchange lists
    main.append(el("h2", { class: "section" }, "More"));
    main.append(groceryFold(fold, table));
    main.append(fold("Hydration",
      el("ul", { class: "nut-items" },
        el("li", null, "Weigh before and after practice (Pre Weight and Post Weight on the Program page)"),
        el("li", null, "Drink 16 oz of water for every pound lost: add it to the day's water goal from there"),
        el("li", null, "Your daily goal is under Water above: about half your body weight in ounces, more on training days. Spread it out: bottles in the morning and the afternoon")),
      el("div", { class: "card-sub" }, "Losing 2–3% of your body weight in water can cost 15–20% of your performance.")));
    // packing tips, from the DST high school meal rotation
    if (n.packing && n.packing.length) main.append(fold(n.school ? "Packing your school lunch" : "Packing a lunch",
      el("ul", { class: "nut-items" }, n.packing.map((t) => el("li", null, t)))));
    // the exchange lists: one menu, folded, opening to the protein, carbohydrate, fruit, vegetable and fat lists
    main.append(el("details", { class: "card nut-fold exchange-menu" },
      el("summary", null, "Food Exchange Options"),
      el("div", { class: "card-sub nut-note" }, "For lunch and dinner, pick one protein, one carbohydrate and one fruit, plus the vegetables, in these amounts."),
      ...(n.lists || []).map((l) => el("details", { class: "nut-fold nut-subfold" }, el("summary", null, l.title),
        l.same ? table(l.rows.map((r) => [r[0], r[1]]), ["Food", "Amount"]) : table(l.rows, ["Food", "Training", "Rest"])))));
    return main;
  }
  const THORNE_URL = "https://s.thorne.com/WFei3"; // the DST dispensary on Thorne

  // The grocery list: one list, for what's planned over the next seven days (from today), each food added up across
  // the meals it's in. With nothing planned there's no list, just the way to plan the week.
  const GROCERY_GROUP = { protein: "Protein", deli: "Protein", starch: "Carbohydrate", fruit: "Fruit", veg: "Vegetable", dairy: "Dairy & Misc", fat: "Dairy & Misc", bar: "Dairy & Misc" };
  function groceryFold(fold, table) {
    const today = todayKey();
    const byFood = new Map();
    for (let i = 0; i < 7; i++) {
      ((foodDays && foodDays[shiftDay(today, i)]) || []).filter((e) => e.planned).forEach((e) => {
        const f = e.key ? foodOf(e.key) : null;
        const id = f ? `k|${f.key}` : `n|${e.name.toLowerCase()}|${e.unit || ""}`;
        const g = byFood.get(id) || { name: f ? f.name : e.name, f, unit: e.unit || "", qty: 0, times: 0, group: f ? GROCERY_GROUP[f.cat] || "Dairy & Misc" : "Other" };
        g.qty += +e.qty || 0; g.times += 1;
        byFood.set(id, g);
      });
    }
    if (byFood.size) {
      const groups = ["Protein", "Carbohydrate", "Fruit", "Vegetable", "Dairy & Misc", "Other"];
      const rows = (name) => [...byFood.values()].filter((g) => g.group === name).sort((a, b) => a.name.localeCompare(b.name))
        .map((g) => [g.name, g.f ? amountLabel(g.f, g.qty) : g.qty ? `${r1(g.qty)} ${g.unit === "servings" ? "servings" : g.unit}` : `${g.times}×`, `${g.times} meal${g.times === 1 ? "" : "s"}`]);
      return fold("Grocery list",
        el("div", { class: "card-sub" }, "Everything planned for the next 7 days. Change your meals and this list follows."),
        ...groups.filter((g) => rows(g).length).flatMap((g) => [el("div", { class: "nut-group" }, g), table(rows(g), ["Food", "Total", "In"])]));
    }
    return fold("Grocery list",
      el("div", { class: "card-sub" }, "Your grocery list appears once your week is planned."),
      foodDays ? el("button", { class: "food-logmeal", onclick: openWeekPlanner }, "Plan my week") : null);
  }

  // ---- My Progress: sessions week by week, estimated maxes, top weights and Group Testing results ----------
  function progressView() {
    const main = el("main");
    const now = currentWeek();
    const wk = weekCount(now), st = streak();
    const weeks = Array.from({ length: now + 1 }, (_, w) => ({ w, ...weekCount(w) })).filter((x) => x.total).slice(-10);
    main.append(el("div", { class: "card" },
      el("div", { class: "card-title" }, "Sessions"),
      el("div", { class: "sum-stats" },
        el("div", null, el("b", null, `${wk.done}/${wk.total}`), el("span", null, "this week")),
        el("div", null, el("b", null, `${st}`), el("span", null, st === 1 ? "week in a row" : "weeks in a row"))),
      weeks.length > 1 ? el("div", { class: "weeks" }, weeks.map((x) => el("div", { class: `wk${x.w === now ? " now" : ""}`, title: `Week ${x.w + 1}: ${x.done} of ${x.total}` },
        el("div", { class: "wk-bar" }, el("span", { style: `height:${Math.round((x.done / x.total) * 100)}%` })),
        el("small", null, `W${x.w + 1}`)))) : null));

    const row = (name, line, value, sub) => el("div", { class: "prog-row" },
      el("span", { class: "prog-name" }, name), line, el("span", { class: "prog-val" }, el("b", null, value), sub ? el("small", null, sub) : null));
    const weekOf = (pos) => Math.floor(pos / 100) + 1;

    // estimated maxes, from sets taken to failure
    const byLift = new Map();
    window.planMaxes(plan, programById).all.forEach((m) => { if (!byLift.has(m.key)) byLift.set(m.key, []); byLift.get(m.key).push(m); });
    if (byLift.size) {
      main.append(el("h2", { class: "section" }, "Estimated maxes"));
      main.append(el("div", { class: "card" }, [...byLift.values()].map((ms) => {
        const vals = ms.map((m) => m.value), last = ms[ms.length - 1], best = Math.max(...vals), gain = last.value - ms[0].value;
        return row(last.name, spark(vals), `${last.value}`, ms.length > 1 ? `${gain >= 0 ? "+" : ""}${gain} since wk ${weekOf(ms[0].pos)}${best > last.value ? ` · best ${best}` : ""}` : `wk ${weekOf(last.pos)}`);
      })));
    }

    // the heaviest weight logged for each lift, week by week
    const lifts = new Map(); // key -> { name, weeks: Map(plan week -> heaviest), lastPos }
    (plan.blocks || []).filter((b) => b.programId).forEach((b) => {
      const program = programById(b.programId);
      const log = (plan.programLog || {})[b.programId] || {};
      if (!program) return;
      (program.weeks || []).forEach((w, wi) => (w.sessions || []).forEach((s, si) => (s.exercises || []).forEach((e) => {
        const name = (e.name || "").trim();
        if (!name || unloaded({ program }, e)) return;
        Rx.groups(e).forEach((g, gi) => {
          const v = parseFloat(log[Rx.logKey(e, gi)]);
          if (!(v > 0)) return;
          const key = Rx.liftKey(name), pw = b.start + wi; // one lift under any of its library names
          if (!lifts.has(key)) lifts.set(key, { name, weeks: new Map(), lastPos: 0 });
          const one = lifts.get(key);
          one.weeks.set(pw, Math.max(one.weeks.get(pw) || 0, v));
          one.lastPos = Math.max(one.lastPos, pw * 100 + si);
        });
      })));
    });
    if (lifts.size) {
      main.append(el("h2", { class: "section" }, "Top weights", el("small", null, "heaviest logged each week")));
      main.append(el("div", { class: "card" }, [...lifts.values()].sort((a, b) => b.lastPos - a.lastPos).map((x) => {
        const ws = [...x.weeks.entries()].sort((a, b) => a[0] - b[0]);
        const vals = ws.map((p) => p[1]), last = vals[vals.length - 1], gain = last - vals[0];
        return row(x.name, spark(vals), nice(last), ws.length > 1 ? `${gain >= 0 ? "+" : ""}${nice(gain)} since wk ${ws[0][0] + 1}` : `wk ${ws[0][0] + 1}`);
      })));
    }

    // Group Testing (the coach's Coach Mode), each test with its best and latest result
    const byTest = new Map();
    (tests || []).forEach((t) => { if (!Number.isFinite(testValue(t))) return; if (!byTest.has(t.kpiId)) byTest.set(t.kpiId, []); byTest.get(t.kpiId).push(t); });
    if (byTest.size) {
      main.append(el("h2", { class: "section" }, "Testing"));
      main.append(el("div", { class: "card" }, [...byTest.values()].map((ts) => {
        ts.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
        const t = ts[ts.length - 1], lower = t.better === "lower", vals = ts.map(testValue);
        const best = lower ? Math.min(...vals) : Math.max(...vals), last = vals[vals.length - 1];
        const unit = t.unit ? ` ${t.unit}` : "";
        const when = parseISO(t.date).toLocaleDateString(undefined, { month: "short", day: "numeric" });
        return row(t.kpiName, spark(vals, lower), `${nice(last)}${unit}`, last === best ? (ts.length > 1 ? `best · ${when}` : when) : `best ${nice(best)} · ${when}`);
      })));
    }

    // force plate countermovement jumps
    const cmj = cmjSection();
    if (cmj) main.append(...cmj);

    // Evolt scans and manual body comp sheets
    const bc = bodyCompSection();
    if (bc) main.append(...bc);

    if (!byLift.size && !lifts.size && !byTest.size && !bc && !cmj) {
      main.append(el("div", { class: "empty" }, "Log your weights and your progress will show up here: your top weights each week, estimated maxes from sets to failure, and your testing results."));
    }
    return main;
  }

  // ---- the page ----------------------------------------------------------------------------------
  // ---- the tour (tour.js) ------------------------------------------------------------------------------
  // The first time this phone opens the program, a short tour lights up each part in turn. The ? at the top left
  // plays it again. Steps for things a day may not have (a warm-up, a video, a second program) are skipped.
  const PHONE_TOUR = [
    { title: "Welcome to your program", text: "Everything your coach has planned for you, with a place to log what you lift. Here’s a quick look at how it works." },
    { sel: ".install-tip", optional: true, title: "Put it on your home screen", text: "Add this page to your home screen and it opens like an app, straight to your program. Close the tip once it’s done." },
    { sel: "main .no-program", optional: true, title: "Your program goes here", text: "Nothing is on your plan yet. As soon as there is, your week’s workouts show on this page. Coaches: Create Quick Session and Assign Existing Program put one on in a few taps, for you or an athlete." },
    { sel: ".weekbar", optional: true, title: "Your week", text: "The week you’re on, with its dates. The arrows look back at past weeks or ahead to what’s coming." },
    { sel: ".lane-tabs", optional: true, title: "Your programs", text: "When you have more than one program this week (strength and speed, say), tap its tab to switch." },
    { sel: ".chips.days", optional: true, title: "Your days", text: "Tap a day to open it. A day gets a ✓ once it’s logged, and the app opens on the next day you haven’t done." },
    { sel: "main .warmup", optional: true, title: "Warm-up", text: "Start here before the first exercise." },
    { sel: "main .group", optional: true, title: "Each block", text: "Exercises are lettered A, B, C. A1 and A2 together are a superset: do a set of one, then the other, and repeat. A block folds up once it’s done; tap it to open it again." },
    { sel: "main button.name", optional: true, title: "Watch the video", text: "Tap an exercise’s name to see its video and coaching cues." },
    { sel: "main .set .boxes", optional: true, title: "Log your weights", text: "Type the weight you used for each set. A grey number is filled in for you from your max; leave it or change it. −5 and +5 change it quickly, and last time’s numbers can be copied with one tap. Everything saves as you type." },
    { sel: "main .swap", optional: true, title: "Change an exercise", text: "Tap ⇄ to swap an exercise for another or change its sets and reps (no equipment for it, say). Your coach sees what you changed." },
    { sel: "main .film.check", optional: true, title: "Send your coach a clip", text: "Film a set and send it to your coach for a form check. Their reply shows under the exercise." },
    { sel: "main .session-end", optional: true, title: "Log the session", text: "When you finish, tap Log session. The day gets its ✓ and you’ll see a summary of what you did." },
    { sel: ".menu", title: "Everything else", text: "Program is this page. Progress shows your numbers and testing over time, and Nutrition (once your coach sets it up) has your meal plan." },
    { sel: ".tour-help", title: "That’s it", text: "Tap ? any time to see this again. The sun and moon on the right switch between light and dark." },
  ];
  let tourTried = false;

  function render() {
    derived = [];
    if (view === "equipment") {
      // the first time through there is no menu: the survey comes before anything else
      app.replaceChildren(el("div", { class: "top" }, el("div", { class: "brand" }, logo(), el("div", { class: "who" }, data.athlete.name || "My Equipment"))), equipmentView(), equipment.surveyedAt && plan ? menu() : "");
      return;
    }
    if (view === "plan") {
      app.replaceChildren(el("div", { class: "top" }, el("div", { class: "brand" }, logo(), el("div", { class: "who" }, data.athlete.name || "My Plan"))), planView(), menu());
      return;
    }
    if (view === "progress") {
      app.replaceChildren(el("div", { class: "top" }, el("div", { class: "brand" }, logo(), el("div", { class: "who" }, data.athlete.name || "My Progress"))), progressView(), menu());
      return;
    }
    if (view === "nutrition") {
      app.replaceChildren(el("div", { class: "top" }, el("div", { class: "brand" }, logo(), el("div", { class: "who" }, data.athlete.name || "My Nutrition"))), nutritionView(), menu());
      return;
    }
    // nothing on the plan yet: the program page says so, and a coach gets their tools right there to put
    // something on it (a quick session for today, or a saved program)
    if (!(plan.blocks || []).some((b) => b.programId)) {
      const parts = [el("div", { class: "top" },
        window.DSTTour ? el("button", { class: "tour-help", "aria-label": "How this app works", title: "How this app works", onclick: () => window.DSTTour.start(PHONE_TOUR) }, "?") : null,
        el("div", { class: "brand" }, logo(), el("div", { class: "who" }, data.athlete.name || "My Program")))];
      const tip = installTip();
      if (tip) parts.push(tip);
      parts.push(el("main", null, el("div", { class: "card no-program" },
        el("div", { class: "card-title" }, "No program yet"),
        staff
          ? el("div", { class: "card-sub" }, "Nothing is on your plan yet. Build a session for today, or put a saved program on your plan, and it shows here. The same tools put a program on an athlete’s plan.")
          : el("div", { class: "card-sub" }, "Your coach hasn’t put a program on your plan yet. It shows up here as soon as they do. Until then, Progress has your testing results."),
        staff ? el("div", { class: "swap-actions" }, quickTools()) : null)));
      parts.push(menu());
      app.replaceChildren(...parts);
      shown = null;
      if (!tourTried && window.DSTTour) {
        tourTried = true;
        setTimeout(() => { if (view === "program" && !overlay.className.includes("show")) window.DSTTour.autoPlay("phone", PHONE_TOUR, { useLogin: false }); }, 700);
      }
      return;
    }
    const items = itemsAt(weekIdx);
    itemIdx = Math.min(itemIdx, Math.max(0, items.length - 1));
    const item = items[itemIdx];
    const sessions = item ? (item.week.sessions || []) : [];
    dayIdx = Math.min(dayIdx, Math.max(0, sessions.length - 1));
    const go = (fn) => () => { fn(); render(); window.scrollTo(0, 0); };

    const top = el("div", { class: "top" },
      window.DSTTour && !coachId ? el("button", { class: "tour-help", "aria-label": "How this app works", title: "How this app works", onclick: () => window.DSTTour.start(PHONE_TOUR) }, "?") : null,
      el("div", { class: "brand" }, logo(), el("div", { class: "who" }, data.athlete.name || "My Program")),
      el("div", { class: "weekbar" },
        el("button", { class: "nav", "aria-label": "Previous week", disabled: weekIdx <= 0, onclick: go(() => { weekIdx -= 1; dayIdx = 0; }) }, "‹"),
        el("h1", null, `Week ${weekIdx + 1} of ${plan.weeks}${weekIdx === currentWeek() ? " · This week" : ""}`, el("small", null, weekDates(weekIdx))),
        el("button", { class: "nav", "aria-label": "Next week", disabled: weekIdx >= plan.weeks - 1, onclick: go(() => { weekIdx += 1; dayIdx = 0; }) }, "›")));

    const parts = [top];
    const tip = installTip();
    if (tip) parts.push(tip);
    if (items.length > 1) {
      // the week's programs (Strength, Speed, ...) as one tab bar across the screen, the open one underlined
      parts.push(el("div", { class: "lane-tabs", role: "tablist" }, items.map((it, i) => el("button", { class: `lane-tab${i === itemIdx ? " on" : ""}`, role: "tab", "aria-selected": i === itemIdx ? "true" : "false", onclick: go(() => { itemIdx = i; dayIdx = 0; }) }, it.lane.name))));
    }
    if (sessions.length > 1) {
      parts.push(el("div", { class: "chips days" }, sessions.map((s, i) => { const done = logged(item.program.id, sessionKey(item, i)); return el("button", { class: `chip${i === dayIdx ? " on" : ""}${done ? " done" : ""}`, title: done ? "Session logged" : null, onclick: go(() => { dayIdx = i; }) }, done ? "✓ " : "", s.name || `Day ${i + 1}`); })));
    }

    const main = el("main");
    if (!item) {
      main.append(el("div", { class: "empty" }, "Nothing is scheduled for this week."));
      shown = null;
      if (coachId && window.parent !== window) window.parent.postMessage({ type: "coach-preview", aid: String(coachId), title: "Nothing is scheduled for this week.", sub: "", warmup: "", rows: [], hasDay: false, done: false }, window.location.origin);
    }
    else {
      const s = sessions[dayIdx];
      // a sent session's week (quick strength session, group speed) is named by the session itself: its day and what it is
      // a coach's own app: Change on a program moves it to another week, swaps it or takes it off (quick_assign.js)
      const canChange = staff && window.QuickAssign && !window.isSentProgram(item.program.id) && item.block.id;
      main.append(el("p", { class: "program-name" }, window.isSentProgram(item.program.id)
        ? `${item.lane.name} · ${(s && s.name) || item.program.name}`
        : `${item.program.name} · ${item.week.name || `Week ${item.weekNo}`} (${item.weekNo} of ${item.program.weeks.length})`,
        canChange ? el("button", { class: "program-change", title: "Start it another week, swap it, or take it off", onclick: () => window.QuickAssign.open({ overlay, close: closeVideo, status: showStatus, manage: item.block.id, onAssignedSelf: () => setTimeout(() => window.location.reload(), 600) }) }, "Change") : null));
      const rows = s ? (s.exercises || []).filter((e) => (e.name || "").trim()) : [];
      if (s && weekIdx === currentWeek()) main.append(weighIn(item));
      if (s && (s.warmup || "").trim()) main.append(el("div", { class: "warmup" }, el("strong", null, "Warm-up: "), s.warmup));
      if (!rows.length) main.append(el("div", { class: "empty" }, "No exercises for this day."));
      const labels = window.exerciseLabels(rows);
      // Coach Mode shows the whole day as plain text beside this page, so the coach can read it without scrolling
      shown = s ? { item, dayIdx } : null;
      if (coachId && window.parent !== window) {
        window.parent.postMessage({
          type: "coach-preview", aid: String(coachId),
          title: `${s && s.name ? s.name : `Day ${dayIdx + 1}`} · ${item.week.name || `Week ${item.weekNo}`}`,
          sub: item.program.name,
          warmup: s ? (s.warmup || "").trim() : "",
          day: s && s.name ? s.name : `Day ${dayIdx + 1}`, week: item.week.name || `Week ${item.weekNo}`, hasDay: !!s,
          done: !!s && !!logged(item.program.id, sessionKey(item, dayIdx)),
          rows: rows.map((e, ei) => ({
            label: labels[ei] || "", name: e.name.trim(), first: !(ei > 0 && e.linked),
            rx: Rx.groups(e).map((g) => Rx.groupText(e, g)).join(", "),
            meta: [e.tempo ? `Tempo ${e.tempo}` : "", e.rest ? `Rest ${e.rest}` : "", Rx.extrasText(e), Rx.tagText(e)].filter(Boolean).join(" · "),
            notes: e.notes || "",
          })),
        }, window.location.origin);
      }
      let group = null;
      const blocks = []; // each card (A, B, ...) and its exercises, so it can fold up once it's done
      // A speed day (speed_builder.js) is shown in its sections, each a card with its time, and its series as
      // headings over their drills: "3 × @7yds", the coach's note, and a box for a best time where the drill asks for
      // one. Each section folds up with its Done button, as a block does.
      if (s && window.isSpeedSession(s)) {
        window.speedSections(s).forEach((sec) => {
          const drills = sec.series.flatMap((x) => x.drills).map((d) => d.e).filter((e) => (e.name || "").trim());
          if (!drills.length) return;
          const card = el("div", { class: "group spd" }, el("div", { class: "spd-sec" }, el("span", null, sec.name), sec.time ? el("small", null, sec.time) : null),
            (sec.description || "").trim() ? el("div", { class: "spd-sec-desc" }, sec.description.trim()) : null);
          main.append(card);
          blocks.push({ card, rows: drills, letter: sec.name });
          sec.series.forEach((sr) => {
            const list = sr.drills.map((d) => d.e).filter((e) => (e.name || "").trim());
            if (!list.length) return;
            if (sr.name) card.append(el("div", { class: "spd-ser" }, sr.name));
            list.forEach((e) => {
              const info = exerciseInfo(e.name);
              const rx = window.speedText(window.speedNormalize(JSON.parse(JSON.stringify(e)))); // "3 × 4 reps @ 10 yd"
              // boxes the coach added with the builder's "+" (Time, Height...): the athlete writes in their own, with the
              // coach's target shown when there is one. A drill from before the "+" that asked for a best time keeps
              // its Time box (and what was written in it, kept where it always was).
              const boxes = (Array.isArray(e.extras) ? e.extras : []).map((x) => ({ label: x.label || "", target: `${x.value || ""}`.trim(), key: `${e.id}|x|${(x.label || "").toLowerCase()}` }));
              if (e.record && !boxes.some((b) => /^time$/i.test(b.label))) boxes.unshift({ label: "Time", target: "", key: Rx.logKey(e, 0) });
              const time = boxes.length ? el("div", { class: "spd-boxes" }, boxes.map((b) => {
                const box = el("input", { class: "spd-time-box", type: "text", placeholder: b.target || b.label.toLowerCase(), "aria-label": `${b.label} for ${e.name}`, autocomplete: "off", value: logged(item.program.id, b.key) });
                box.addEventListener("blur", () => save(item.program.id, b.key, box.value.trim()));
                return el("label", { class: "spd-box" }, el("span", null, b.label, b.target ? el("small", null, ` target ${b.target}`) : null), box);
              })) : null;
              card.append(el("div", { class: `ex spd-drill${sr.name ? " in-series" : ""}` },
                el("div", { class: "ex-head" },
                  info && (info.videoUrl || info.cues) ? el("button", { class: "name", onclick: () => openVideo(info) }, e.name) : el("span", { class: "name" }, e.name),
                  info && info.videoUrl ? videoThumb(info) : null,
                  canFilm && !(info && info.videoUrl) ? (() => { const b = el("button", { class: "film", "aria-label": `Film a video for ${e.name}`, title: "Film a video for this exercise", onclick: () => filmVideo(e) }); b.innerHTML = CAMERA; return b; })() : null,
                  rx ? el("span", { class: "spd-rx" }, rx) : null),
                e.notes ? el("div", { class: "notes coach-note" }, e.notes) : null,
                time));
            });
          });
        });
      }
      else rows.forEach((e, ei) => {
        if (!group || !(ei > 0 && e.linked)) { // a superset shares one card
          group = el("div", { class: "group" });
          main.append(group);
          blocks.push({ card: group, rows: [], letter: (/^[A-Z]+/.exec(labels[ei] || "") || [String(blocks.length + 1)])[0] });
        }
        blocks[blocks.length - 1].rows.push(e);
        const info = exerciseInfo(e.name);
        const groups = Rx.groups(e);
        group.append(el("div", { class: "ex" },
          el("div", { class: "ex-head" },
            el("span", { class: "label" }, labels[ei]),
            info && (info.videoUrl || info.cues) ? el("button", { class: "name", onclick: () => openVideo(info) }, e.name) : el("span", { class: "name" }, e.name),
            info && info.videoUrl ? videoThumb(info) : null,
            canFilm && !(info && info.videoUrl) ? (() => { const b = el("button", { class: "film", "aria-label": `Film a video for ${e.name}`, title: "Film a video for this exercise", onclick: () => filmVideo(e) }); b.innerHTML = CAMERA; return b; })() : null,
            canSendChecks() ? (() => { const b = el("button", { class: "film check", "aria-label": `Film a set of ${e.name} for your coach`, title: "Film a set and send it to your coach", onclick: () => sendCheck(item, e, (s && s.name) || `Day ${dayIdx + 1}`) }); b.innerHTML = CAMERA; return b; })() : null,
            el("button", { class: `swap${e._coach ? " on" : ""}`, "aria-label": `Change ${e.name} or its sets and reps`, title: "Change exercise or sets and reps", onclick: () => openSwap(item, dayIdx, e) }, "⇄")),
          e._coach ? el("div", { class: "notes" }, `You changed this. Coach: ${e._coach.name}${e._coach.text ? `, ${e._coach.text}` : ""}`) : null,
          (e.tempo || e.rest || Rx.extras(e).length) ? el("div", { class: "meta" }, e.tempo ? el("span", { class: "tempo" }, `Tempo ${e.tempo}`) : null, e.rest ? el("span", null, `Rest ${e.rest}`) : null, Rx.extras(e).map((x) => el("span", null, `${x.label} ${x.value}`))) : null,
          e.notes ? el("div", { class: "notes coach-note" }, e.notes) : null, // only when the coach added one
          canSendChecks() ? checkLine(item, e) : null,
          groups.length ? el("div", { class: "sets" }, groups.map((g, gi) => setBox(item, dayIdx, e, g, gi))) : null));
      });
      blocks.forEach((b) => { if (!b.card.classList.contains("spd")) edtBar(item, b); foldable(item, dayIdx, b); });
      // end of the day: mark the session as done
      if (rows.length) {
        const done = logged(item.program.id, sessionKey(item, dayIdx));
        main.append(el("div", { class: "session-end" },
          done
            ? sessionSummary(item, dayIdx, rows)
            : el("button", { class: "session-log", onclick: () => logSession(item, dayIdx, rows) }, "Log session")));
      }
    }
    parts.push(main);
    parts.push(menu());
    app.replaceChildren(...parts);
    // the first time the program shows on this phone (never in Coach Mode, which has its own tour)
    if (!tourTried && !coachId && window.DSTTour) {
      tourTried = true;
      setTimeout(() => { if (view === "program" && !overlay.className.includes("show")) window.DSTTour.autoPlay("phone", PHONE_TOUR, { useLogin: false }); }, 700);
    }
  }

  async function start() {
    if (!token && !coachId) { message(standalone() ? "This icon was saved without your code. Delete it, open the link your coach texted you, and add it to your home screen again from there." : "This link is missing its code. Ask your coach to send it again."); return; }
    let res;
    try { res = await api.get(); }
    catch (e) { res = { error: e }; }
    if (res.error && res.error.signedOut) { message("Sign in in Coach Mode to see this athlete."); return; }
    if (res.error) { message("Could not load your program. Check your connection and try again."); return; }
    if (!res.data) { message("This link is no longer active. Ask your coach for a new one."); return; }
    data = res.data;
    // the camera button is for signed-in coaches: Coach Mode always is; a coach's own link once they've signed in here
    if (coachId) canFilm = true;
    else if (staff) { try { const { data: s } = await sb.auth.getSession(); canFilm = !!(s && s.session); } catch (e) { canFilm = false; } }
    remote = !!(data.athlete && data.athlete.remote);
    if (data.equipment) equipment = { access: data.equipment.access || null, custom: data.equipment.custom || [], surveyedAt: data.equipment.surveyedAt || null };
    document.title = data.athlete.name ? `${data.athlete.name} · Program` : "My Program";
    // No program yet: the app still opens (Progress, Plan and, for a coach, their coach tools), with a note where the
    // program goes. Coach Mode keeps its one-line message for an athlete with nothing on their plan.
    if (coachId && !(data.plan && (data.plan.blocks || []).some((b) => b.programId))) { message("No program is on this athlete's plan yet."); return; }
    const given = data.plan || {};
    plan = { ...given, blocks: given.blocks || [], lanes: given.lanes || [], startDate: given.startDate || localDay(), weeks: Number(given.weeks) || 1, programLog: {} };
    // what's been logged: the older entries kept on the plan, then the log table laid over them
    Object.entries(given.programLog || {}).forEach(([pid, one]) => { plan.programLog[pid] = { ...one }; });
    (data.logs || []).forEach((r) => {
      const one = (plan.programLog[r.programId] = plan.programLog[r.programId] || {});
      if (r.value) one[r.key] = r.value; else delete one[r.key];
    });
    (data.overrides || []).forEach((r) => { (overrides[r.programId] = overrides[r.programId] || {})[r.exerciseId] = r.data; });
    data.exercises = data.exercises || [];
    Rx.setLiftNames(data.exercises); // names that are another name for a library exercise track as that lift (canon)
    if (data.rmChart && typeof data.rmChart === "object") Rx.chart = () => data.rmChart;
    else Rx.chart = () => ({ 1: 100, 2: 95, 3: 92.5, 4: 90, 5: 87.5, 6: 85, 7: 82.5, 8: 80, 9: 77.5, 10: 75, 11: 72.5, 12: 70, 13: 67.5, 14: 65, 15: 60, 16: 55, 17: 50 });
    weekIdx = currentWeek();
    // open on the next workout: the first day of this week's program that has not been logged yet
    {
      const first = itemsAt(weekIdx)[0];
      const days = first ? (first.week.sessions || []) : [];
      const next = days.findIndex((s, i) => !logged(first.program.id, sessionKey(first, i)));
      if (next > 0) dayIdx = next;
      // ...unless a quick strength session is set for today and not logged yet (sent by a coach, or a coach's own lift
      // added from Coach › Assign a program): that opens first
      itemsAt(weekIdx).some((it, ii) => {
        if (!String(it.program.id).startsWith("gstrength-")) return false;
        const at = (it.week.sessions || []).findIndex((s, i) => s.date === localDay() && !logged(it.program.id, sessionKey(it, i)));
        if (at < 0) return false;
        itemIdx = ii; dayIdx = at;
        return true;
      });
    }
    // a remote athlete fills in their equipment before they see the program for the first time
    if (remote && !equipment.surveyedAt) view = "equipment";
    render();
    // testing results are only needed for the Progress tab and the end-of-session summary, so they don't hold up the program
    api.tests().catch(() => []).then((t) => { tests = Array.isArray(t) ? t : []; if (view === "progress") render(); });
    api.bodyComp().catch(() => null).then((b) => { bodyComp = b; if (view === "progress" && b) render(); });
    api.cmj().catch(() => []).then((c) => { cmjTests = Array.isArray(c) ? c : []; if (view === "progress" && cmjTests.length) render(); });
    // the last two weeks of the food log (none until migration_023 has been run)
    api.foodLog(shiftDay(todayKey(), -14)).catch(() => null).then((rows) => {
      if (!Array.isArray(rows)) return;
      foodDays = {};
      rows.forEach((r) => { foodDays[String(r.day).slice(0, 10)] = Array.isArray(r.entries) ? r.entries : []; });
      checkPlanned();
      if (view === "nutrition" && !overlay.className.includes("show")) redrawKeep();
    });
    // the shared food library (none until migration_024 has been run); only searched, so nothing to redraw
    if (api.foodLibrary) api.foodLibrary().catch(() => null).then((rows) => { if (Array.isArray(rows)) libraryFoods = rows; });
    // their food allergies (none until migration_026 has been run): the Nutrition tab asks the first time
    if (api.allergies) api.allergies().catch(() => null).then((a) => {
      allergyLoaded = true;
      if (!a && view === "nutrition" && !overlay.className.includes("show")) redrawKeep(); // no answer to look up (migration_026 not run): the plan opens
      if (!a) return;
      allergyInfo = a;
      if (view === "nutrition" && !overlay.className.includes("show")) redrawKeep();
    });
    // My meals (none until migration_025 has been run)
    if (api.savedMeals) api.savedMeals().catch(() => null).then((rows) => {
      if (!Array.isArray(rows)) return;
      savedMeals = rows.filter((r) => r && r.data && Array.isArray(r.data.items));
      if (view === "nutrition" && savedMeals.length && !overlay.className.includes("show")) redrawKeep();
    });
    // the nutrition plan: once it's in, the menu gets its Nutrition button (not redrawn mid-entry or with a sheet open)
    api.nutrition().catch(() => null).then((nu) => {
      nutrition = nu || null;
      checkPlanned();
      const typing = document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
      if ((nutrition || view === "nutrition") && !typing && !overlay.className.includes("show")) { const y = window.scrollY; render(); window.scrollTo(0, y); }
    });
    api.logTimes().catch(() => []).then((t) => {
      logTimes = {};
      (Array.isArray(t) ? t : []).forEach((r) => { logTimes[`${r.programId}|${r.key}`] = r.at; });
      // the program's "last time" lines say the day each was done (not redrawn mid-entry or with a sheet open)
      const typing = document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
      if (view === "plan" || (view === "program" && !typing && !overlay.className.includes("show"))) { const y = window.scrollY; render(); window.scrollTo(0, y); }
    });
    // a remote athlete's form checks from the past week and the coach's replies (shown under each exercise)
    if (canSendChecks()) {
      sb.rpc("athlete_portal_form_checks", { p_token: token }).then((r) => {
        if (r.error || !Array.isArray(r.data)) return;
        formChecks = r.data;
        const typing = document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
        if (formChecks.length && view === "program" && !typing && !overlay.className.includes("show")) render();
      }, () => {});
    }
  }
  start();
})();
