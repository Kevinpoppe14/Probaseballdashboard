// Persistence layer for the real roster and imported/manually entered data.
// The roster (state.customAthletes) is the source of truth for who's on the team — it's
// built from Player Plan syncs, other imports, and manual adds, not from data.js's mock
// demo athletes.
//
// Storage model: everything lives in Supabase (shared across every coach who logs in) with
// localStorage kept only as an instant-read cache — a snapshot of the last data seen, so the app
// still has something to show immediately on load and still works (read-only, for whoever's
// already looking at it) if the network drops mid-session. Every read the rest of the app makes
// (allAthletes(), getForceTests(), etc.) stays perfectly synchronous, reading straight out of the
// in-memory `state` object like before — only startup (initFromSupabase, called once from
// index.html after sign-in) and the fire-and-forget sync calls after each write are async.
(function () {
  const STORAGE_KEY = "dst-monitoring-store-v1";

  function emptyState() {
    return {
      customAthletes: [],
      forceTests: [],
      bodyComp: [],
      manualWellness: [],
      playerPlans: [],
      playerPlansSyncedAt: null,
      notes: [],
      periodization: {}, // athleteId -> { startDate, weeks, lanes, blocks } (offseason planner)
      periodTemplates: [], // reusable planner layouts: { id, name, weeks, lanes, blocks }
      assessments: [], // dated movement/physical assessments (see assessment.js) — one athlete can have several over time
    };
  }

  function loadLocal() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return emptyState();
      const parsed = JSON.parse(raw);
      return { ...emptyState(), ...parsed };
    } catch (e) {
      console.error("AthleteStore: failed to read localStorage, starting fresh.", e);
      return emptyState();
    }
  }

  let state = loadLocal();

  function persistLocal() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  // ---- Supabase sync -----------------------------------------------------------------------
  // Every function below is fire-and-forget from the caller's perspective (mutators call these
  // after already updating `state` + localStorage, so the UI never waits on the network) — errors
  // go to the console rather than the UI, since a coach mid-session shouldn't get blocked or see a
  // scary dialog over a dropped connection; their edit is still safe in localStorage and will sync
  // next time a save goes through. Every row id is stored as text in Supabase (see schema.sql) even
  // where the app's own id is a number, so every id gets String()'d on the way out.
  const sb = () => window.supabaseClient;
  const randomId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const wellnessKey = (athleteId, date) => `${athleteId}|${date}`;

  // ---- "Created by / Last updated by" (see migration_002_activity_tracking.sql) -----------------
  // Who made the LAST edit and when is set by a database trigger (auth.uid(), server-side — a
  // coach's browser can't spoof it), not by anything this file sends up. It's exposed to the rest
  // of the app as a `_activity` property tacked onto athlete/assessment records — never sent back
  // to Supabase as part of the record's own `data` (stripActivity strips it first), so it can't get
  // baked into the JSONB blob and drift out of sync with the real columns.
  let currentUser = { id: null, email: null };
  function setCurrentUser(user) { currentUser = user || { id: null, email: null }; }
  function stripActivity(record) {
    if (!record || typeof record !== "object" || !("_activity" in record)) return record;
    const { _activity, ...rest } = record;
    return rest;
  }
  function activityFromRow(row, emailById) {
    const emailFor = (id) => (id ? (emailById.get(id) || id) : null);
    return {
      createdBy: emailFor(row.created_by),
      createdAt: row.created_at || null,
      updatedBy: emailFor(row.updated_by),
      updatedAt: row.updated_at || null,
    };
  }
  // Optimistic local stamp so "Last updated by" reflects an edit immediately, without waiting for a
  // reload — matches what the server trigger will independently set moments later.
  function stampLocalActivity(record, isNew) {
    const now = new Date().toISOString();
    const prev = record._activity || {};
    record._activity = {
      // For an existing record, createdBy/createdAt carry over exactly as they were — including
      // staying null for anything that predates this feature, where who created it genuinely isn't
      // known. Only a truly new record gets the current user stamped as its creator; an *edit*
      // must never backfill a creator, or the signature would credit whoever happens to touch an
      // old record next with having created it.
      createdBy: isNew ? currentUser.email : (prev.createdBy || null),
      createdAt: isNew ? now : (prev.createdAt || null),
      updatedBy: currentUser.email,
      updatedAt: now,
    };
  }

  function logSyncError(what, error) {
    if (error) console.error(`AthleteStore: ${what} failed`, error);
  }

  function syncUpsert(table, id, athleteId, data) {
    const row = { id: String(id), data };
    if (athleteId !== undefined && athleteId !== null) row.athlete_id = String(athleteId);
    sb().from(table).upsert(row).then(({ error }) => logSyncError(`upsert ${table}/${id}`, error));
  }
  function syncInsert(table, id, athleteId, data) {
    sb().from(table).insert({ id: String(id), athlete_id: String(athleteId), data })
      .then(({ error }) => logSyncError(`insert ${table}/${id}`, error));
  }
  function syncDelete(table, id) {
    sb().from(table).delete().eq("id", String(id)).then(({ error }) => logSyncError(`delete ${table}/${id}`, error));
  }
  function syncDeleteByAthlete(table, athleteId) {
    sb().from(table).delete().eq("athlete_id", String(athleteId)).then(({ error }) => logSyncError(`delete ${table} for athlete ${athleteId}`, error));
  }
  function syncUpsertPeriodization(athleteId, data) {
    sb().from("periodization").upsert({ athlete_id: String(athleteId), data }).then(({ error }) => logSyncError(`upsert periodization/${athleteId}`, error));
  }
  function syncDeletePeriodization(athleteId) {
    sb().from("periodization").delete().eq("athlete_id", String(athleteId)).then(({ error }) => logSyncError(`delete periodization/${athleteId}`, error));
  }
  function syncUpsertMeta(key, value) {
    sb().from("app_meta").upsert({ key, value }).then(({ error }) => logSyncError(`upsert app_meta/${key}`, error));
  }
  // player_plans is always replaced wholesale (see setPlayerPlans) rather than edited row by row,
  // so syncing it is a full delete-and-reinsert instead of per-row upserts.
  async function syncReplaceCollection(table, entries, idOf) {
    const { error: delErr } = await sb().from(table).delete().not("id", "is", null);
    logSyncError(`clear ${table}`, delErr);
    if (!entries.length) return;
    const rows = entries.map((e) => ({ id: String(idOf(e)), data: e }));
    const { error } = await sb().from(table).insert(rows);
    logSyncError(`bulk insert ${table}`, error);
  }

  // Supabase caps an unpaginated select at 1000 rows by default — silently, no error, no
  // truncation flag, just fewer rows than actually exist. force_tests crossed that this session
  // (the Hawkin sync alone added 3000+), so any table here needs to page through everything
  // rather than assume one request has it all; this loops on .range() until a page comes back
  // short of a full page.
  async function fetchTable(table) {
    const PAGE_SIZE = 1000;
    let all = [];
    let offset = 0;
    while (true) {
      const { data, error } = await sb().from(table).select("*").range(offset, offset + PAGE_SIZE - 1);
      if (error) { console.error(`AthleteStore: failed to load ${table} from Supabase`, error); break; }
      all = all.concat(data || []);
      if (!data || data.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }
    return all;
  }

  // Pushes everything currently in `state` up to Supabase in one shot — used exactly once, the
  // first time anyone signs in against a brand-new (empty) Supabase project, so whatever was
  // already entered in this browser's localStorage becomes the team's shared starting data instead
  // of silently vanishing behind the (empty) cloud copy.
  async function pushEntireStateToSupabase() {
    const athleteRows = state.customAthletes.map((a) => ({ id: String(a.id), data: stripActivity(a) }));
    const forceRows = state.forceTests.map((t) => ({ id: randomId(), athlete_id: String(t.athleteId), data: t }));
    const bodyRows = state.bodyComp.map((t) => ({ id: randomId(), athlete_id: String(t.athleteId), data: t }));
    const wellnessRows = state.manualWellness.map((w) => ({ id: wellnessKey(w.athleteId, w.date), athlete_id: String(w.athleteId), data: w }));
    const noteRows = state.notes.map((n) => ({ id: n.id, athlete_id: String(n.athleteId), data: n }));
    const planRows = state.playerPlans.map((p, i) => ({ id: p.id != null ? String(p.id) : `pp-${i}-${randomId()}`, data: p }));
    const periodRows = Object.keys(state.periodization).map((athleteId) => ({ athlete_id: String(athleteId), data: state.periodization[athleteId] }));
    const templateRows = state.periodTemplates.map((t) => ({ id: t.id, data: t }));
    const assessRows = state.assessments.map((a) => ({ id: a.id, athlete_id: String(a.athleteId), data: stripActivity(a) }));

    const inserts = [
      ["athletes", athleteRows], ["force_tests", forceRows], ["body_comp", bodyRows],
      ["manual_wellness", wellnessRows], ["notes", noteRows], ["player_plans", planRows],
      ["period_templates", templateRows], ["assessments", assessRows],
    ];
    for (const [table, rows] of inserts) {
      if (!rows.length) continue;
      const { error } = await sb().from(table).insert(rows);
      logSyncError(`initial migration insert into ${table}`, error);
    }
    if (periodRows.length) {
      const { error } = await sb().from("periodization").insert(periodRows);
      logSyncError("initial migration insert into periodization", error);
    }
    if (state.playerPlansSyncedAt) {
      const { error } = await sb().from("app_meta").upsert({ key: "playerPlansSyncedAt", value: state.playerPlansSyncedAt });
      logSyncError("initial migration upsert app_meta", error);
    }
  }

  // Called once from index.html right after a successful sign-in, before the dashboard renders —
  // the whole app reads `state` synchronously, so it needs to already hold real data by the time
  // anything renders. On a brand-new Supabase project (no rows anywhere yet) this migrates
  // whatever's in this browser's localStorage up to Supabase instead of overwriting it with
  // nothing; otherwise Supabase's copy (shared by every coach) wins over this browser's local one.
  async function initFromSupabase() {
    const localSnapshot = state;
    const [athletes, forceTests, bodyComp, manualWellness, notes, playerPlans, periodization, periodTemplates, assessments, appMeta, profiles] =
      await Promise.all([
        fetchTable("athletes"), fetchTable("force_tests"), fetchTable("body_comp"),
        fetchTable("manual_wellness"), fetchTable("notes"), fetchTable("player_plans"),
        fetchTable("periodization"), fetchTable("period_templates"), fetchTable("assessments"),
        fetchTable("app_meta"), fetchTable("profiles"),
      ]);
    const cloudIsEmpty = ![athletes, forceTests, bodyComp, manualWellness, notes, playerPlans, periodization, periodTemplates, assessments]
      .some((rows) => rows.length > 0);

    if (cloudIsEmpty && localSnapshot.customAthletes.length > 0) {
      state = localSnapshot;
      await pushEntireStateToSupabase();
      persistLocal();
      return;
    }

    const emailById = new Map(profiles.map((p) => [p.id, p.email]));
    const next = emptyState();
    // Only athletes and assessments show a "Created by / Last updated by" signature in the UI
    // right now (see activityFromRow) — every table has the underlying columns from the migration,
    // so this is just a matter of reading them here if that ever needs to extend to more tables.
    athletes.forEach((r) => next.customAthletes.push({ ...r.data, _activity: activityFromRow(r, emailById) }));
    forceTests.forEach((r) => next.forceTests.push(r.data));
    bodyComp.forEach((r) => next.bodyComp.push(r.data));
    manualWellness.forEach((r) => next.manualWellness.push(r.data));
    notes.forEach((r) => next.notes.push(r.data));
    playerPlans.forEach((r) => next.playerPlans.push(r.data));
    periodization.forEach((r) => { next.periodization[r.athlete_id] = r.data; });
    periodTemplates.forEach((r) => next.periodTemplates.push(r.data));
    assessments.forEach((r) => next.assessments.push({ ...r.data, _activity: activityFromRow(r, emailById) }));
    const syncedAtRow = appMeta.find((r) => r.key === "playerPlansSyncedAt");
    next.playerPlansSyncedAt = syncedAtRow ? syncedAtRow.value : null;
    state = next;
    persistLocal();
  }

  function normalizeName(n) {
    return (n || "").trim().toLowerCase().replace(/\s+/g, " ");
  }

  function allAthletes() {
    return state.customAthletes;
  }

  function findAthleteByName(name) {
    const norm = normalizeName(name);
    if (!norm) return null;
    return allAthletes().find((a) => normalizeName(a.name) === norm) || null;
  }

  function findOrCreateAthlete(name) {
    const existing = findAthleteByName(name);
    if (existing) return existing;
    const ids = allAthletes().map((a) => a.id);
    const nextId = (ids.length ? Math.max(...ids) : 0) + 1;
    const created = {
      id: nextId,
      name: (name || "Unnamed Athlete").trim(),
      position: "Unassigned",
      jersey: "--",
      status: "active",
      league: "",
      team: "",
      photoUrl: "",
      dstLocation: "",
      wellness: [],
      load: [],
      isCustom: true,
    };
    stampLocalActivity(created, true);
    state.customAthletes.push(created);
    persistLocal();
    syncUpsert("athletes", created.id, undefined, stripActivity(created));
    return created;
  }

  function updateAthlete(id, patch) {
    const idx = state.customAthletes.findIndex((a) => a.id === id);
    if (idx === -1) return null;
    state.customAthletes[idx] = { ...state.customAthletes[idx], ...patch };
    stampLocalActivity(state.customAthletes[idx], false);
    persistLocal();
    syncUpsert("athletes", id, undefined, stripActivity(state.customAthletes[idx]));
    return state.customAthletes[idx];
  }

  function addAthlete({ name, position, jersey, status, league, team, photoUrl, dstLocation }) {
    const athlete = findOrCreateAthlete(name);
    const patch = {};
    if (position) patch.position = position;
    if (jersey) patch.jersey = jersey;
    if (league !== undefined) patch.league = league;
    if (team !== undefined) patch.team = team;
    if (photoUrl !== undefined) patch.photoUrl = photoUrl;
    if (dstLocation !== undefined) patch.dstLocation = dstLocation;
    patch.status = status || athlete.status || "active";
    return updateAthlete(athlete.id, patch);
  }

  function deleteAthlete(id) {
    state.customAthletes = state.customAthletes.filter((a) => a.id !== id);
    state.forceTests = state.forceTests.filter((e) => e.athleteId !== id);
    state.bodyComp = state.bodyComp.filter((e) => e.athleteId !== id);
    state.manualWellness = state.manualWellness.filter((e) => e.athleteId !== id);
    state.playerPlans = state.playerPlans.filter((e) => e.athleteId !== id);
    state.notes = state.notes.filter((n) => n.athleteId !== id);
    state.assessments = state.assessments.filter((a) => a.athleteId !== id);
    delete state.periodization[id];
    persistLocal();
    syncDelete("athletes", id);
    syncDeleteByAthlete("force_tests", id);
    syncDeleteByAthlete("body_comp", id);
    syncDeleteByAthlete("manual_wellness", id);
    syncDeleteByAthlete("notes", id);
    syncDeleteByAthlete("assessments", id);
    syncDeletePeriodization(id);
    // player_plans has no athlete_id filter worth adding for a single delete — it's rebuilt
    // wholesale on the next Player Plan sync (setPlayerPlans), so a stale row here is harmless
    // until then.
  }

  function isRealJersey(j) {
    return !!j && j !== "--";
  }

  // Folds mergeId's data into keepId (wellness, force plate, body comp, plans, notes),
  // backfills any blank profile fields on keep from merge, then deletes the merge record.
  // Used to fix duplicate athletes created by name variants (e.g. "Cam" vs "Cameron").
  function mergeAthletes(keepId, mergeId) {
    if (keepId === mergeId) return null;
    const keep = state.customAthletes.find((a) => a.id === keepId);
    const merge = state.customAthletes.find((a) => a.id === mergeId);
    if (!keep || !merge) return null;

    const patch = {};
    if ((!keep.position || keep.position === "Unassigned") && merge.position && merge.position !== "Unassigned") {
      patch.position = merge.position;
    }
    if (!isRealJersey(keep.jersey) && isRealJersey(merge.jersey)) patch.jersey = merge.jersey;
    if (!keep.league && merge.league) patch.league = merge.league;
    if (!keep.team && merge.team) patch.team = merge.team;
    if (!keep.dstLocation && merge.dstLocation) patch.dstLocation = merge.dstLocation;
    if (!keep.photoUrl && merge.photoUrl) patch.photoUrl = merge.photoUrl;
    if (Object.keys(patch).length) updateAthlete(keepId, patch);

    state.forceTests.forEach((e) => { if (e.athleteId === mergeId) e.athleteId = keepId; });
    state.bodyComp.forEach((e) => { if (e.athleteId === mergeId) e.athleteId = keepId; });
    state.manualWellness.forEach((e) => { if (e.athleteId === mergeId) e.athleteId = keepId; });
    state.playerPlans.forEach((e) => { if (e.athleteId === mergeId) e.athleteId = keepId; });
    state.notes.forEach((n) => { if (n.athleteId === mergeId) n.athleteId = keepId; });
    state.assessments.forEach((a) => { if (a.athleteId === mergeId) a.athleteId = keepId; });
    // Keep the planner from whichever profile has one (the kept profile's wins if both do).
    if (state.periodization[mergeId] && !state.periodization[keepId]) state.periodization[keepId] = state.periodization[mergeId];
    delete state.periodization[mergeId];

    // If both profiles had a manual wellness entry on the same date, keep the one that
    // appears later in the array (whichever was logged most recently).
    const wellnessByKey = new Map();
    state.manualWellness.forEach((e) => wellnessByKey.set(`${e.athleteId}|${e.date}`, e));
    state.manualWellness = Array.from(wellnessByKey.values());

    state.customAthletes = state.customAthletes.filter((a) => a.id !== mergeId);
    persistLocal();

    // Re-sync every row that just changed athlete_id (or got folded/removed), plus the athlete
    // records themselves. This is a heavier resync than a single updateAthlete/delete, but merges
    // are a rare admin action, not something that happens on every save.
    syncDelete("athletes", mergeId);
    syncDeletePeriodization(mergeId);
    state.forceTests.filter((e) => e.athleteId === keepId).forEach((e) => syncInsert("force_tests", randomId(), keepId, e));
    syncDeleteByAthlete("force_tests", mergeId);
    state.bodyComp.filter((e) => e.athleteId === keepId).forEach((e) => syncInsert("body_comp", randomId(), keepId, e));
    syncDeleteByAthlete("body_comp", mergeId);
    syncDeleteByAthlete("manual_wellness", mergeId);
    state.manualWellness.filter((e) => e.athleteId === keepId).forEach((e) => syncUpsert("manual_wellness", wellnessKey(e.athleteId, e.date), keepId, e));
    state.notes.filter((n) => n.athleteId === keepId && n.athleteId !== undefined).forEach((n) => syncUpsert("notes", n.id, keepId, n));
    syncDeleteByAthlete("notes", mergeId);
    state.assessments.filter((a) => a.athleteId === keepId).forEach((a) => syncUpsert("assessments", a.id, keepId, stripActivity(a)));
    syncDeleteByAthlete("assessments", mergeId);
    if (state.periodization[keepId]) syncUpsertPeriodization(keepId, state.periodization[keepId]);

    return state.customAthletes.find((a) => a.id === keepId);
  }

  function computeWellnessComposite(f) {
    const sleepQuality = Number(f.sleepQuality) || 0;
    const mood = Number(f.mood) || 0;
    const soreness = Number(f.soreness) || 0;
    const fatigue = Number(f.fatigue) || 0;
    const stress = Number(f.stress) || 0;
    const sum = sleepQuality + mood + (6 - soreness) + (6 - fatigue) + (6 - stress) - 5;
    return Math.max(0, Math.min(100, Math.round((sum / 20) * 100)));
  }

  function addManualWellness(entry) {
    const composite = computeWellnessComposite(entry);
    const record = { ...entry, wellnessComposite: composite, source: "manual" };
    state.manualWellness = state.manualWellness.filter(
      (e) => !(e.athleteId === entry.athleteId && e.date === entry.date)
    );
    state.manualWellness.push(record);
    persistLocal();
    syncUpsert("manual_wellness", wellnessKey(record.athleteId, record.date), record.athleteId, record);
    return record;
  }

  function addForceTest(entry) {
    const record = { ...entry };
    state.forceTests.push(record);
    persistLocal();
    syncInsert("force_tests", randomId(), record.athleteId, record);
  }

  function addBodyComp(entry) {
    const record = { ...entry };
    state.bodyComp.push(record);
    persistLocal();
    syncInsert("body_comp", randomId(), record.athleteId, record);
  }

  function setPlayerPlans(entries) {
    state.playerPlans = entries;
    state.playerPlansSyncedAt = new Date().toISOString();
    persistLocal();
    syncReplaceCollection("player_plans", entries, (e, i) => (e.id != null ? e.id : `pp-${i}-${randomId()}`));
    syncUpsertMeta("playerPlansSyncedAt", state.playerPlansSyncedAt);
  }

  function getPlayerPlans(athleteId) {
    return state.playerPlans.filter((e) => e.athleteId === athleteId);
  }

  function getAllPlayerPlans() {
    return state.playerPlans;
  }

  function getPlayerPlansSyncedAt() {
    return state.playerPlansSyncedAt;
  }

  function addNote(athleteId, text) {
    const note = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      athleteId,
      text,
      timestamp: new Date().toISOString(),
    };
    state.notes.push(note);
    persistLocal();
    syncUpsert("notes", note.id, athleteId, note);
    return note;
  }

  function getNotes(athleteId) {
    return state.notes
      .filter((n) => n.athleteId === athleteId)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }

  function deleteNote(noteId) {
    state.notes = state.notes.filter((n) => n.id !== noteId);
    persistLocal();
    syncDelete("notes", noteId);
  }

  // ---- Movement / physical assessments (see assessment.js for the field layout) ----
  function getAssessments(athleteId) {
    return state.assessments
      .filter((a) => a.athleteId === athleteId)
      .sort((a, b) => (a.date || "").localeCompare(b.date || "") || a.id.localeCompare(b.id));
  }

  function saveAssessment(record) {
    const idx = state.assessments.findIndex((a) => a.id === record.id);
    stampLocalActivity(record, idx === -1);
    if (idx === -1) state.assessments.push(record);
    else state.assessments[idx] = record;
    persistLocal();
    syncUpsert("assessments", record.id, record.athleteId, stripActivity(record));
    return record;
  }

  function deleteAssessment(id) {
    state.assessments = state.assessments.filter((a) => a.id !== id);
    persistLocal();
    syncDelete("assessments", id);
  }

  // ---- Periodization planner (per-athlete offseason plan) + reusable templates ----
  function getPeriodization(athleteId) {
    return state.periodization[athleteId] || null;
  }

  function setPeriodization(athleteId, plan) {
    state.periodization[athleteId] = plan;
    persistLocal();
    syncUpsertPeriodization(athleteId, plan);
  }

  function allPeriodizationAthleteIds() {
    return Object.keys(state.periodization).map(Number);
  }

  function getPeriodTemplates() {
    return state.periodTemplates;
  }

  function addPeriodTemplate(template) {
    const record = { ...template, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` };
    state.periodTemplates.push(record);
    persistLocal();
    syncUpsert("period_templates", record.id, undefined, record);
    return record;
  }

  function deletePeriodTemplate(id) {
    state.periodTemplates = state.periodTemplates.filter((t) => t.id !== id);
    persistLocal();
    syncDelete("period_templates", id);
  }

  function getManualWellness(athleteId) {
    return state.manualWellness
      .filter((e) => e.athleteId === athleteId)
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  // Hawkin exports carry absolute peak power (W) and relative peak power (W/kg) in similarly
  // named columns, so a column-mapping slip can leave the W/kg figure in the peakPower field
  // (or the reverse). Absolute peak power for an athlete is always well over 1000 W and the
  // relative figure is always well under it, so sort each value into the right field here —
  // on read, so previously imported tests are corrected too.
  function normalizeForceTest(t) {
    const n = { ...t };
    const pp = typeof n.peakPower === "number" ? n.peakPower : null;
    const rpp = typeof n.relativePeakPower === "number" ? n.relativePeakPower : null;
    if (pp !== null && pp < 1000) {
      n.peakPower = null;
      if (rpp === null || rpp >= 1000) n.relativePeakPower = pp;
    }
    if (rpp !== null && rpp >= 1000) {
      if (n.peakPower === null || n.peakPower === undefined) n.peakPower = rpp;
      if (n.relativePeakPower === rpp) n.relativePeakPower = null;
    }
    return n;
  }

  function getForceTests(athleteId) {
    return state.forceTests
      .filter((e) => e.athleteId === athleteId)
      .map(normalizeForceTest)
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  function getBodyComp(athleteId) {
    return state.bodyComp
      .filter((e) => e.athleteId === athleteId)
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  function getWellnessSeries(athlete) {
    const manual = getManualWellness(athlete.id);
    const manualDates = new Set(manual.map((e) => e.date));
    const mock = (athlete.wellness || []).filter((e) => !manualDates.has(e.date));
    return [...mock, ...manual].sort((a, b) => a.date.localeCompare(b.date));
  }

  function counts() {
    return {
      customAthletes: state.customAthletes.length,
      forceTests: state.forceTests.length,
      bodyComp: state.bodyComp.length,
      manualWellness: state.manualWellness.length,
      playerPlans: state.playerPlans.length,
      notes: state.notes.length,
      assessments: state.assessments.length,
    };
  }

  function clearAll() {
    state = emptyState();
    persistLocal();
  }

  window.AthleteStore = {
    initFromSupabase,
    setCurrentUser,
    allAthletes,
    findAthleteByName,
    findOrCreateAthlete,
    updateAthlete,
    addAthlete,
    deleteAthlete,
    mergeAthletes,
    addManualWellness,
    addForceTest,
    addBodyComp,
    getManualWellness,
    getForceTests,
    getBodyComp,
    getWellnessSeries,
    computeWellnessComposite,
    setPlayerPlans,
    getPlayerPlans,
    getAllPlayerPlans,
    getPlayerPlansSyncedAt,
    getPeriodization,
    setPeriodization,
    allPeriodizationAthleteIds,
    getPeriodTemplates,
    addPeriodTemplate,
    deletePeriodTemplate,
    addNote,
    getNotes,
    deleteNote,
    getAssessments,
    saveAssessment,
    deleteAssessment,
    counts,
    clearAll,
  };
})();
