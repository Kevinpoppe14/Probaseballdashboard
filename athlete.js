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
      // program name gets the entry it matches, under that name
      const wanted = new Set([...names].map((n) => n.toLowerCase()));
      const exercises = [];
      const lib = await window.ExerciseVideo.readLibrary("data"); // every row, a page at a time
      lib.forEach((r) => {
        const d = r.data || {};
        [d.name, ...(d.aliases || [])].forEach((n) => { if (n && wanted.has(n.trim().toLowerCase())) exercises.push({ name: n.trim(), videoUrl: d.videoUrl, cues: d.cues }); });
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
  // the logo, with the day's greeting under it on a holiday (see holiday.js)
  const logo = () => {
    const holiday = window.Holiday && window.Holiday.today();
    return [
      cubs
        ? el("img", { src: "https://www.mlbstatic.com/team-logos/112.svg", alt: "Chicago Cubs" })
        : el("img", { src: "assets/dst-logo-light.png", alt: "Dynamic Sports Training" }),
      holiday ? el("div", { class: "holiday-greeting" }, holiday.greeting) : null,
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
  let bodyComp = null; // { scans, sheets }: their Evolt scans and manual body comp sheets, loaded the same way
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
    pending.set(`${programId} ${key}`, { programId, key, value });
    flush();
    derived.forEach((fn) => fn());
  };

  // ---- exercise video ----------------------------------------------------------------------------
  const exerciseInfo = (name) => (data.exercises || []).find((x) => (x.name || "").trim().toLowerCase() === (name || "").trim().toLowerCase()) || null;
  const closeVideo = () => { overlay.className = "overlay"; overlay.replaceChildren(); };
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
  // earlier week of this block, looking back from last week. Returns { week, text } or null.
  function lastLogged(item, si, e, gi) {
    const pid = item.program.id, name = (e.name || "").trim().toLowerCase();
    const same = (x) => (x.name || "").trim().toLowerCase() === name;
    const today = ((item.week.sessions || [])[si] || {}).exercises || [];
    const nth = today.filter(same).indexOf(e); // which one, if the exercise is on the day more than once
    for (let wk = weekIdx - 1; wk >= item.block.start; wk -= 1) {
      const week = item.program.weeks[(wk - item.block.start) % item.program.weeks.length];
      const prev = ((((week || {}).sessions || [])[si] || {}).exercises || []).filter(same)[Math.max(0, nth)];
      if (!prev || prev.id === e.id) continue;
      const w = logged(pid, Rx.logKey(prev, gi)), r = logged(pid, Rx.repsLogKey(prev, gi));
      if (w || r) return { week: wk + 1, text: r ? `${w || "?"} x ${r}` : w, w, r };
    }
    return null;
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
  const eachSide = (text) => /(?:-\s*E\b|\beach\b|\/side\b|\bper side\b)/i.test(`${text || ""}`);
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
  function openTimer(name, seconds, sides) {
    let left = seconds, running = false, tick = null, round = 1, last = 0;
    const rounds = sides ? 2 : 1;
    const face = el("div", { class: "timer-face" }, clock(left));
    const label = el("div", { class: "timer-round" }, sides ? "First side" : "");
    const go = el("button", { class: "primary" }, "Start");
    const reset = el("button", null, "Reset");
    const stop = () => { running = false; clearInterval(tick); tick = null; };
    const draw = () => {
      face.textContent = clock(left);
      face.className = `timer-face${left <= 3 && running ? " ending" : ""}${left <= 0 ? " done" : ""}`;
      go.textContent = running ? "Pause" : left <= 0 ? (round < rounds ? "Other side" : "Again") : left < seconds ? "Resume" : "Start";
    };
    const run = () => {
      if (running) { stop(); draw(); return; }
      if (left <= 0) {
        if (round < rounds) { round += 1; label.textContent = "Second side"; } else { round = 1; label.textContent = sides ? "First side" : ""; }
        left = seconds;
      }
      running = true; last = Date.now();
      tick = setInterval(() => {
        if (Date.now() - last < 1000) return;
        last += 1000; left -= 1;
        if (left <= 0) { left = 0; stop(); beep(); }
        draw();
      }, 100);
      draw();
    };
    go.addEventListener("click", run);
    reset.addEventListener("click", () => { stop(); left = seconds; round = 1; label.textContent = sides ? "First side" : ""; draw(); });
    const close = () => { stop(); closeVideo(); };
    overlay.replaceChildren(el("div", { class: "sheet timer-sheet" },
      el("button", { class: "close", "aria-label": "Close", onclick: close }, "×"),
      el("h2", null, name),
      label, face,
      el("div", { class: "swap-actions" }, go, reset, el("button", { onclick: close }, "Done"))));
    overlay.className = "overlay show";
  }
  // the timer button for a set group, when its reps (or the exercise's Time box) are a time
  const timerFor = (e, g) => {
    const timeBox = (Rx.extras(e).find((x) => /^time$/i.test((x.label || "").trim())) || {}).value;
    const secs = secondsIn(g.reps) || secondsIn(timeBox);
    if (!secs || secs > 3600) return null;
    const sides = eachSide(g.reps);
    return el("button", { class: "timer-btn", title: `Time this set: ${clock(secs)}${sides ? " each side" : ""}`, onclick: () => openTimer(e.name, secs, sides) }, `⏱ ${clock(secs)}`);
  };

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
    const sets = b.rows.flatMap((e) => Rx.groups(e).map((g, gi) => ({ e, g, gi }))).filter((x) => !unloaded(item, x.e) || Rx.failure(x.g));
    const filled = ({ e, g, gi }) => (unloaded(item, e)
      ? !!logged(pid, Rx.repsLogKey(e, gi))
      : !!logged(pid, Rx.logKey(e, gi)) && (!Rx.failure(g) || !!logged(pid, Rx.repsLogKey(e, gi))));
    const isDone = () => !!logged(pid, sessionKey(item, si)) || tappedDone(item, si).includes(b.letter) || (sets.length > 0 && sets.every(filled));
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
      const max = window.planMaxes(plan, programById).before(e.name, weekIdx, si);
      const suggest = max && Rx.normalize(e).intensityUnit === "%" ? Rx.weightAt(max.value, g) : null;
      const has = logged(pid, wKey);
      auto = suggest && !has ? suggest : null;
      if (document.activeElement !== weight) { weight.value = has || (auto ? `${auto}` : ""); weight.className = auto ? "auto" : ""; }
      if (reps && document.activeElement !== reps) reps.value = logged(pid, rKey);
      const used = has || (auto ? `${auto}` : "");
      const value = fail ? Rx.estimate1RM(used, logged(pid, rKey)) : null;
      est.textContent = value ? `Est. 1RM ${value}` : "";
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
      last ? el("button", { class: "last", title: `Logged in week ${last.week}. Tap to use the same numbers.`, onclick: useLast }, `Wk ${last.week}: ${last.text}`, el("b", null, " · use")) : null,
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
  };
  const menu = () => el("nav", { class: "menu", role: "tablist" },
    [["program", "Program"], ["progress", "Progress"], ["plan", "Plan"]].concat(remote ? [["equipment", "Equipment"]] : [], staff ? [["coach", "Coach"]] : []).map(([id, text]) => {
      const icon = el("span", { class: "menu-icon", "aria-hidden": "true" });
      icon.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${MENU_ICONS[id]}</svg>`;
      // the coach button offers Coach Mode or the dashboard, each its own page with a way back here
      const go = id === "coach" ? openCoachMenu : () => { view = id; render(); window.scrollTo(0, 0); };
      return el("button", { class: `menu-item${view === id ? " on" : ""}${id === "coach" ? " to-coach" : ""}`, role: id === "coach" ? null : "tab", "aria-selected": id === "coach" ? null : view === id ? "true" : "false", onclick: go }, icon, el("span", null, text));
    }));
  function openCoachMenu() {
    const to = (href) => () => { window.location.href = href; };
    overlay.replaceChildren(el("div", { class: "sheet coach-menu" },
      el("button", { class: "close", "aria-label": "Close", onclick: closeVideo }, "×"),
      el("h2", null, "Coach tools"),
      el("div", { class: "swap-coach" }, "Sign in with your dashboard account. Each has a way back to your program."),
      el("div", { class: "swap-actions" },
        el("button", { class: "primary", onclick: to("coach.html?from=app") }, "Coach Mode"),
        el("button", { class: "primary", onclick: to("index.html?from=app") }, "Dashboard"),
        el("button", { onclick: closeVideo }, "Cancel"))));
    overlay.className = "overlay show";
  }
  const blockDates = (b) => {
    const a = parseISO(plan.startDate); a.setDate(a.getDate() + b.start * 7);
    const z = new Date(a); z.setDate(z.getDate() + b.len * 7 - 1);
    const f = (d) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    return `Wk ${b.start + 1}${b.len > 1 ? `–${b.start + b.len}` : ""} · ${f(a)} – ${f(z)}`;
  };
  function planView() {
    const now = currentWeek();
    const main = el("main");
    const started = new Date(new Date().toDateString()) >= parseISO(plan.startDate);
    const end = parseISO(plan.startDate); end.setDate(end.getDate() + plan.weeks * 7 - 1);
    const fmt = (d) => d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    main.append(el("div", { class: "card" },
      el("div", { class: "card-title" }, started ? `Week ${now + 1} of ${plan.weeks}` : `Starts ${fmt(parseISO(plan.startDate))}`),
      el("div", { class: "bar" }, el("span", { style: `width:${started ? Math.round(((now + 1) / plan.weeks) * 100) : 0}%` })),
      el("div", { class: "card-sub" }, `${fmt(parseISO(plan.startDate))} – ${fmt(end)}`)));

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
        if (unloaded(item, e) && !Rx.failure(g)) return; // nothing to weigh on a sprint or a mobility drill
        const fail = Rx.failure(g);
        if (logged(pid, Rx.logKey(e, gi)) && (!fail || logged(pid, Rx.repsLogKey(e, gi)))) return;
        const max = maxes.before(e.name, weekIdx, si);
        sets.push({ g, gi, fail, suggest: max && Rx.normalize(e).intensityUnit === "%" ? Rx.weightAt(max.value, g) : null });
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
  function bcGraph(series, unit, joinAll) {
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
    box.innerHTML = `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Body composition graph">${grid}${joined}${lines}<text x="${l}" y="${h - 6}" class="bc-axis">${bcDay(t0)}</text><text x="${w - r}" y="${h - 6}" text-anchor="end" class="bc-axis">${bcDay(t1)}</text></svg>`;
    return box;
  }
  function bodyCompSection() {
    const scans = (bodyComp && bodyComp.scans) || [], sheets = ((bodyComp && bodyComp.sheets) || []).filter((s) => s.date && s.summary);
    if (!scans.length && !sheets.length) return null;
    const has = { evolt: scans.length > 0, sheet: sheets.length > 0 };
    const source = has.evolt && has.sheet ? (BC_SOURCES[bcView.source] ? bcView.source : "evolt") : has.evolt ? "evolt" : "sheet";
    const metric = BC_METRICS.find((m) => m.key === bcView.metric) || BC_METRICS[0];
    const range = BC_RANGES.find((x) => x.key === bcView.range) || BC_RANGES[BC_RANGES.length - 1];
    const from = range.days ? Date.now() - range.days * 86400000 : -Infinity;
    const at = (d, time) => new Date(`${d}T${time || "12:00"}:00`).getTime();
    const num = (v) => (typeof v === "number" && isFinite(v) ? Math.round(v * 10) / 10 : null);
    // anything entered in kilograms before Evolt came in pounds is shown in pounds
    const lb = (s, lbKey, kgKey) => (s[lbKey] != null ? s[lbKey] : s[kgKey] != null ? s[kgKey] * 2.20462 : null);
    const series = [];
    if (source !== "sheet") series.push({ name: "Evolt", color: "var(--label, var(--accent))", points: scans.map((s) => ({ t: at(s.date, s.time), v: num(metric.evolt({ ...s, weightLb: lb(s, "weightLb", "weightKg"), smmLb: lb(s, "smmLb", "skeletalMuscleKg") })) })) });
    if (source !== "evolt") series.push({ name: "Manual sheet", color: BC_SHEET_COLOR, points: sheets.map((s) => ({ t: at(s.date), v: num(metric.sheet(s.summary)) })) });
    series.forEach((s) => { s.points = s.points.filter((p) => p.v != null && p.t >= from).sort((a, b) => a.t - b.t); });
    const shown = series.filter((s) => s.points.length);
    const chips = (items, on, pick) => el("div", { class: "chips bc-chips" }, items.map(([k, label]) => el("button", { class: `chip${on === k ? " on" : ""}`, onclick: () => pick(k) }, label)));
    const unitText = (v) => `${nice(v)}${metric.unit === "%" ? "%" : " lb"}`;
    const card = el("div", { class: "card" },
      has.evolt && has.sheet ? chips(Object.entries(BC_SOURCES), source, (k) => setBcView({ source: k })) : null,
      chips(BC_METRICS.map((m) => [m.key, m.label]), metric.key, (k) => setBcView({ metric: k })),
      chips(BC_RANGES.map((x) => [x.key, x.label]), range.key, (k) => setBcView({ range: k })),
      shown.length ? bcGraph(shown, metric.unit, source === "both") : el("div", { class: "card-sub" }, `No ${metric.label.toLowerCase()} in the last ${range.label.toLowerCase()}. All time shows everything.`),
      // the latest of each, and the change across the window
      shown.map((s) => {
        const a = s.points[0], z = s.points[s.points.length - 1], d = Math.round((z.v - a.v) * 10) / 10;
        return el("div", { class: "bc-latest" }, el("span", { class: "bc-key", style: `background:${s.color}` }), el("span", null, `${s.name}: `, el("b", null, unitText(z.v)), s.points.length > 1 ? el("small", null, ` ${d > 0 ? "+" : ""}${unitText(d)} since ${bcDay(a.t)}`) : el("small", null, ` ${bcDay(z.t)}`)));
      }),
      source === "both" ? el("div", { class: "card-sub" }, "One line through every measurement in date order, scans and sheets alike, with the dashed trend through all of them. A scan and a skinfold sheet measure a little differently, so the line can step where it changes from one to the other.") : null);
    return [el("h2", { class: "section" }, "Body composition", el("small", null, [has.evolt && `${scans.length} scan${scans.length === 1 ? "" : "s"}`, has.sheet && `${sheets.length} sheet${sheets.length === 1 ? "" : "s"}`].filter(Boolean).join(" · "))), card];
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
      const key = e.name.trim().toLowerCase();
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
          const key = name.toLowerCase(), pw = b.start + wi;
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

    // Evolt scans and manual body comp sheets
    const bc = bodyCompSection();
    if (bc) main.append(...bc);

    if (!byLift.size && !lifts.size && !byTest.size && !bc) {
      main.append(el("div", { class: "empty" }, "Log your weights and your progress will show up here: your top weights each week, estimated maxes from sets to failure, and your testing results."));
    }
    return main;
  }

  // ---- the page ----------------------------------------------------------------------------------
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
    const items = itemsAt(weekIdx);
    itemIdx = Math.min(itemIdx, Math.max(0, items.length - 1));
    const item = items[itemIdx];
    const sessions = item ? (item.week.sessions || []) : [];
    dayIdx = Math.min(dayIdx, Math.max(0, sessions.length - 1));
    const go = (fn) => () => { fn(); render(); window.scrollTo(0, 0); };

    const top = el("div", { class: "top" },
      el("div", { class: "brand" }, logo(), el("div", { class: "who" }, data.athlete.name || "My Program")),
      el("div", { class: "weekbar" },
        el("button", { class: "nav", "aria-label": "Previous week", disabled: weekIdx <= 0, onclick: go(() => { weekIdx -= 1; dayIdx = 0; }) }, "‹"),
        el("h1", null, `Week ${weekIdx + 1} of ${plan.weeks}${weekIdx === currentWeek() ? " · This week" : ""}`, el("small", null, weekDates(weekIdx))),
        el("button", { class: "nav", "aria-label": "Next week", disabled: weekIdx >= plan.weeks - 1, onclick: go(() => { weekIdx += 1; dayIdx = 0; }) }, "›")));

    const parts = [top];
    const tip = installTip();
    if (tip) parts.push(tip);
    if (items.length > 1) {
      parts.push(el("div", { class: "chips" }, items.map((it, i) => el("button", { class: `chip${i === itemIdx ? " on" : ""}`, onclick: go(() => { itemIdx = i; dayIdx = 0; }) }, it.lane.name))));
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
      main.append(el("p", { class: "program-name" }, `${item.program.name} · ${item.week.name || `Week ${item.weekNo}`} (${item.weekNo} of ${item.program.weeks.length})`));
      const s = sessions[dayIdx];
      const rows = s ? (s.exercises || []).filter((e) => (e.name || "").trim()) : [];
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
            meta: [e.tempo ? `Tempo ${e.tempo}` : "", e.rest ? `Rest ${e.rest}` : "", Rx.extrasText(e)].filter(Boolean).join(" · "),
            notes: e.notes || "",
          })),
        }, window.location.origin);
      }
      let group = null;
      const blocks = []; // each card (A, B, ...) and its exercises, so it can fold up once it's done
      rows.forEach((e, ei) => {
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
      blocks.forEach((b) => foldable(item, dayIdx, b));
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
    if (!data.plan || !(data.plan.blocks || []).length) {
      // no program yet: a remote athlete can still fill in their equipment, so the coach can build around it
      if (remote) { view = "equipment"; render(); } else message(coachId ? "No program is on this athlete's plan yet." : "Your coach has not put a program on your plan yet.");
      return;
    }
    plan = { ...data.plan, weeks: Number(data.plan.weeks) || 1, programLog: {} };
    // what's been logged: the older entries kept on the plan, then the log table laid over them
    Object.entries(data.plan.programLog || {}).forEach(([pid, one]) => { plan.programLog[pid] = { ...one }; });
    (data.logs || []).forEach((r) => {
      const one = (plan.programLog[r.programId] = plan.programLog[r.programId] || {});
      if (r.value) one[r.key] = r.value; else delete one[r.key];
    });
    (data.overrides || []).forEach((r) => { (overrides[r.programId] = overrides[r.programId] || {})[r.exerciseId] = r.data; });
    data.exercises = data.exercises || [];
    if (data.rmChart && typeof data.rmChart === "object") Rx.chart = () => data.rmChart;
    else Rx.chart = () => ({ 1: 100, 2: 95, 3: 92.5, 4: 90, 5: 87.5, 6: 85, 7: 82.5, 8: 80, 9: 77.5, 10: 75, 11: 72.5, 12: 70, 13: 67.5, 14: 65, 15: 60, 16: 55, 17: 50 });
    weekIdx = currentWeek();
    // open on the next workout: the first day of this week's program that has not been logged yet
    {
      const first = itemsAt(weekIdx)[0];
      const days = first ? (first.week.sessions || []) : [];
      const next = days.findIndex((s, i) => !logged(first.program.id, sessionKey(first, i)));
      if (next > 0) dayIdx = next;
    }
    // a remote athlete fills in their equipment before they see the program for the first time
    if (remote && !equipment.surveyedAt) view = "equipment";
    render();
    // testing results are only needed for the Progress tab and the end-of-session summary, so they don't hold up the program
    api.tests().catch(() => []).then((t) => { tests = Array.isArray(t) ? t : []; if (view === "progress") render(); });
    api.bodyComp().catch(() => null).then((b) => { bodyComp = b; if (view === "progress" && b) render(); });
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
