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
      offseasonFacilities: [], // shared directory of off-season training facilities: { id, name, address1, city, ... } (see migration_004)
      exercises: [], // exercise library: { id, name, videoUrl, tier, pattern, region, laterality, equipment: [], cues } (see migration_006)
      rmChart: null, // reps-to-failure -> % of 1RM chart; null until a coach edits it (then the default applies)
      programFolders: null, // folder paths for the Programs tab; null until a coach changes them (then the defaults apply)
      programs: [], // reusable training program templates: { id, name, description, weeks: [{ name, sessions: [{ name, exercises: [...] }] }] } (see migration_005)
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

  // localStorage has a hard per-origin size cap (typically 5-10MB) — this is only ever a
  // fallback cache, so a write that doesn't fit (QuotaExceededError) must not crash whatever
  // called it. It used to: persistLocal is called synchronously inside initFromSupabase, with
  // nothing catching an exception there, so a full storage quota turned into an unhandled promise
  // rejection that silently broke sign-in — the whole app stuck on "Loading..." forever, with the
  // real error visible only in the console, not on screen. Local caching not working for a
  // session just means that session falls back to Supabase-only (still correct, just not
  // offline-resilient); it must never block the app from loading in the first place.
  function persistLocal() {
    try {
      // The full raw Hawkin metric object (~70 fields) rides along on every synced force test for
      // reference, but nothing in the UI reads it — it's the single biggest contributor to
      // exceeding the quota above, so the local cache (unlike the in-memory copy, and unlike what's
      // in Supabase) goes without it.
      const lightState = { ...state, forceTests: state.forceTests.map(({ raw, ...rest }) => rest) };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(lightState));
    } catch (e) {
      console.error("AthleteStore: couldn't cache to localStorage (probably over quota) — continuing without the local fallback copy.", e);
    }
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

  // Caps how many Supabase requests are ever in flight at once, shared across every table's fetch
  // AND every page within a table (initFromSupabase fetches ~10 tables in parallel, and force_tests
  // needs several pages at its current size). Originally 4 — but even that turned out high enough
  // that force_tests pages (the biggest rows, full raw Hawkin metric blobs) occasionally hit a
  // Postgres statement timeout under concurrent load, not just a connection-pool queueing delay.
  // Confirmed by hand: the same pages that failed at concurrency succeeded individually in under a
  // second run one at a time. 2 is the more conservative number that's actually been verified not
  // to trigger this.
  function makeLimiter(concurrency) {
    let active = 0;
    const queue = [];
    const runNext = () => {
      if (active >= concurrency || queue.length === 0) return;
      active++;
      const { fn, resolve, reject } = queue.shift();
      fn().then(resolve, reject).finally(() => { active--; runNext(); });
    };
    return (fn) => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); runNext(); });
  }
  const dbLimit = makeLimiter(2);

  // A page that fails (a statement timeout, a dropped connection) is retried a couple of times
  // with a short backoff before giving up — the alternative (store.js's old behavior) was to log
  // an error and silently continue with that page's rows missing, which nobody would notice short
  // of counting rows by hand.
  async function withRetry(fn, label, attempts = 3) {
    let lastError;
    for (let i = 0; i < attempts; i++) {
      const result = await fn();
      if (!result.error) return result;
      lastError = result.error;
      console.error(`AthleteStore: ${label} failed (attempt ${i + 1}/${attempts})`, result.error);
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
    return { data: null, error: lastError };
  }

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
  // ---- Overwrite guard for plans and programs ---------------------------------------------------------
  // A plan or a program is saved as one whole document, so with two coaches (or one coach on two devices) in
  // the same one, whoever saved last used to replace the other's work without either knowing. Now each save
  // first looks at when the saved copy was last changed. If that is not what this page last saw, someone else
  // has saved in between, and the coach is asked what to do: keep their own version (replacing the other
  // change) or take the other one (the page reloads with it). Nothing is replaced without that question.
  //   versions    "table/id" -> the updated_at this page last saw (from loading, or from its own last save)
  //   saveQueues  saves to one document run one after another, so each sees the result of the one before
  const versions = new Map();
  const saveQueues = new Map();
  let userEmails = new Map(); // user id -> email, for saying who made the other change
  function guardedUpsert(table, keyCol, id, data, what) {
    const key = String(id), k = `${table}/${key}`;
    const run = async () => {
      const known = versions.get(k);
      if (known) {
        const { data: row, error } = await sb().from(table).select("*").eq(keyCol, key).maybeSingle();
        if (!error && row && row.updated_at && row.updated_at !== known) {
          const who = row.updated_by && row.updated_by === currentUser.id ? "You (in another tab or on another device)" : userEmails.get(row.updated_by) || "Another coach or device";
          const when = new Date(row.updated_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
          const keepMine = window.confirm(`${who} changed ${what} on ${when}, after this page loaded it.\n\nOK: save your version. Their change is replaced.\nCancel: keep their version. This page reloads and your last change here is dropped.`);
          if (!keepMine) { window.location.reload(); return; }
        }
      }
      // updated_at is sent for tables with no trigger of their own to stamp it; where there is one, the server's time wins
      const { data: saved, error } = await sb().from(table).upsert({ [keyCol]: key, data, updated_at: new Date().toISOString() }).select("updated_at").maybeSingle();
      logSyncError(`upsert ${table}/${key}`, error);
      if (!error && saved && saved.updated_at) versions.set(k, saved.updated_at);
    };
    const next = (saveQueues.get(k) || Promise.resolve()).then(run, run);
    saveQueues.set(k, next);
    return next;
  }
  const planLabel = (athleteId) => { const a = allAthletes().find((x) => String(x.id) === String(athleteId)); return a ? `${a.name}'s plan` : "this plan"; };

  function syncUpsertPeriodization(athleteId, data) {
    guardedUpsert("periodization", "athlete_id", athleteId, data, planLabel(athleteId));
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
  // rather than assume one request has it all. The first page also asks for an exact count, so
  // every remaining page can be requested up front instead of one round trip at a time — each one
  // still goes through dbLimit, though, alongside every other table's own fetch, so this can't be
  // the thing that re-creates the connection-pool pileup it's meant to avoid.
  async function fetchTable(table) {
    const PAGE_SIZE = 1000;
    const first = await withRetry(
      () => dbLimit(() => sb().from(table).select("*", { count: "exact" }).range(0, PAGE_SIZE - 1)),
      `load ${table} (page 1)`
    );
    if (first.error) { console.error(`AthleteStore: giving up on ${table} — no data loaded for this table this session`, first.error); return []; }
    let all = first.data || [];
    const total = typeof first.count === "number" ? first.count : all.length;
    if (total > all.length) {
      const pageFetches = [];
      for (let offset = PAGE_SIZE; offset < total; offset += PAGE_SIZE) {
        pageFetches.push(withRetry(
          () => dbLimit(() => sb().from(table).select("*").range(offset, offset + PAGE_SIZE - 1)),
          `load ${table} (offset ${offset})`
        ));
      }
      const pages = await Promise.all(pageFetches);
      pages.forEach(({ data, error }) => {
        if (error) console.error(`AthleteStore: giving up on a page of ${table} — some rows may be missing this session`, error);
        else all = all.concat(data || []);
      });
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
    const [athletes, forceTests, bodyComp, manualWellness, notes, playerPlans, periodization, periodTemplates, assessments, appMeta, profiles, offseasonFacilityRows, programRows, exerciseRows, linkRows, logRows, overrideRows, equipmentRows] =
      await Promise.all([
        fetchTable("athletes"), fetchTable("force_tests"), fetchTable("body_comp"),
        fetchTable("manual_wellness"), fetchTable("notes"), fetchTable("player_plans"),
        fetchTable("periodization"), fetchTable("period_templates"), fetchTable("assessments"),
        fetchTable("app_meta"), fetchTable("profiles"), fetchTable("offseason_facilities"), fetchTable("programs"), fetchTable("exercises"),
        fetchTable("athlete_links"), fetchTable("athlete_logs"), fetchTable("athlete_overrides"), fetchTable("athlete_equipment"),
      ]);
    athleteOverrides = {};
    athleteEquipment = {};
    equipmentRows.forEach(putEquipmentRow);
    overrideRows.forEach(putOverrideRow);
    athleteLinks = {};
    linkRows.forEach((r) => { athleteLinks[r.athlete_id] = r.token; });
    athleteLogs = {};
    logRows.forEach(putLogRow);
    const cloudIsEmpty = ![athletes, forceTests, bodyComp, manualWellness, notes, playerPlans, periodization, periodTemplates, assessments]
      .some((rows) => rows.length > 0);

    if (cloudIsEmpty && localSnapshot.customAthletes.length > 0) {
      state = localSnapshot;
      await pushEntireStateToSupabase();
      persistLocal();
      return;
    }

    accounts = profiles.filter((p) => p.email).map((p) => ({ id: p.id, email: p.email }));
    const emailById = new Map(profiles.map((p) => [p.id, p.email]));
    userEmails = emailById;
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
    periodization.forEach((r) => { if (r.updated_at) versions.set(`periodization/${r.athlete_id}`, r.updated_at); });
    periodTemplates.forEach((r) => next.periodTemplates.push(r.data));
    assessments.forEach((r) => next.assessments.push({ ...r.data, _activity: activityFromRow(r, emailById) }));
    offseasonFacilityRows.forEach((r) => next.offseasonFacilities.push({ ...r.data, id: r.id }));
    programRows.forEach((r) => next.programs.push({ ...r.data, id: r.id }));
    programRows.forEach((r) => { if (r.updated_at) versions.set(`programs/${r.id}`, r.updated_at); });
    exerciseRows.forEach((r) => next.exercises.push({ ...r.data, id: r.id }));
    const syncedAtRow = appMeta.find((r) => r.key === "playerPlansSyncedAt");
    next.playerPlansSyncedAt = syncedAtRow ? syncedAtRow.value : null;
    const foldersRow = appMeta.find((r) => r.key === "programFolders");
    next.programFolders = foldersRow && Array.isArray(foldersRow.value) ? foldersRow.value : null;
    const rmRow = appMeta.find((r) => r.key === "rmChart");
    next.rmChart = rmRow && rmRow.value && typeof rmRow.value === "object" ? rmRow.value : null;
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

  // Everyone with a login (from the profiles table), as [{ id, email }].
  let accounts = [];
  function accountHolders() {
    return accounts;
  }
  // Makes sure each account holder has a record of their own in `rosterGroup` (the Coaches group), so they can
  // build a plan and run programs for themselves like an athlete. Matched by login id, so renaming one is safe.
  // Returns how many were created.
  function ensureCoachRecords(rosterGroup, nameFor) {
    let made = 0;
    accounts.forEach((acct) => {
      if (state.customAthletes.some((a) => a.coachUserId === acct.id)) return;
      const ids = allAthletes().map((a) => a.id);
      const created = {
        id: (ids.length ? Math.max(...ids) : 0) + 1,
        name: nameFor(acct.email),
        position: "Unassigned", jersey: "--", status: "active", league: "", team: "", photoUrl: "", dstLocation: "",
        wellness: [], load: [], isCustom: true,
        rosterGroup, coachUserId: acct.id, coachEmail: acct.email,
      };
      stampLocalActivity(created, true);
      state.customAthletes.push(created);
      syncUpsert("athletes", created.id, undefined, stripActivity(created));
      made += 1;
    });
    if (made) persistLocal();
    return made;
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
      author: currentUser.email,
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
  // Pitching assessments (pitching_assessment.js) share the table, marked kind: "pitching"; each getter
  // returns only its own kind, so one never counts as the other.
  // Manual body comp sheets (bodycomp_sheet.js) share it too, marked kind: "bodycomp".
  const assessmentsOf = (athleteId, kind) => state.assessments
    .filter((a) => a.athleteId === athleteId && (a.kind || "") === kind)
    .sort((a, b) => (a.date || "").localeCompare(b.date || "") || a.id.localeCompare(b.id));
  function getAssessments(athleteId) {
    return assessmentsOf(athleteId, "");
  }
  function getPitchingAssessments(athleteId) {
    return assessmentsOf(athleteId, "pitching");
  }
  function getBodyCompSheets(athleteId) {
    return assessmentsOf(athleteId, "bodycomp");
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

  // ---- off-season facility directory ---------------------------------------------------------
  function allOffseasonFacilities() {
    return [...state.offseasonFacilities].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }

  // Adds a new facility (no id yet) or replaces an existing one with the same id. The record is
  // stored whole, so a field the coach cleared really goes away instead of lingering in the cloud.
  function saveOffseasonFacility(rec) {
    const id = rec.id != null ? String(rec.id) : randomId();
    const { id: _ignored, ...data } = rec;
    const full = { ...data, id };
    const idx = state.offseasonFacilities.findIndex((f) => f.id === id);
    if (idx === -1) state.offseasonFacilities.push(full);
    else state.offseasonFacilities[idx] = full;
    persistLocal();
    syncUpsert("offseason_facilities", id, undefined, data);
    return full;
  }

  // ---- training programs ------------------------------------------------------------------------
  function allPrograms() {
    return [...state.programs].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }

  // Adds a new program (no id yet) or replaces the one with the same id. The whole document is stored each time.
  function saveProgram(rec) {
    const id = rec.id != null ? String(rec.id) : randomId();
    const { id: _ignored, ...data } = rec;
    const idx = state.programs.findIndex((p) => p.id === id);
    // who built it is stamped once, when the program is first saved, and carried along on every later edit
    if (idx === -1) {
      if (!data.createdBy && currentUser.email) data.createdBy = currentUser.email;
      if (!data.createdAt) data.createdAt = new Date().toISOString();
    } else {
      if (!data.createdBy && state.programs[idx].createdBy) data.createdBy = state.programs[idx].createdBy;
      if (!data.createdAt && state.programs[idx].createdAt) data.createdAt = state.programs[idx].createdAt;
    }
    const full = { ...data, id };
    if (idx === -1) state.programs.push(full);
    else state.programs[idx] = full;
    persistLocal();
    guardedUpsert("programs", "id", id, data, `the program "${data.name || "Untitled"}"`);
    return full;
  }

  // ---- exercise library ------------------------------------------------------------------------
  // Programs link to the library by exercise name, so names are compared without case or extra spaces.
  const exerciseKey = (name) => (name || "").trim().toLowerCase().replace(/\s+/g, " ");
  function allExercises() {
    return [...state.exercises].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }
  // An exercise also answers to the names of any exercises merged into it (`aliases`), so programs written with
  // either wording link to the same entry, video and cues.
  function findExerciseByName(name) {
    const key = exerciseKey(name);
    if (!key) return null;
    return state.exercises.find((e) => exerciseKey(e.name) === key)
      || state.exercises.find((e) => (e.aliases || []).some((a) => exerciseKey(a) === key)) || null;
  }
  // Merges the exercise `mergeId` into `keepId`: the kept one keeps its name and everything filled in on it, takes
  // whatever it is missing from the other (video, cues, tier, pattern, region, laterality), gains the other's
  // equipment and tags, and answers to the other's name (and any names already merged into it) from now on. The
  // other entry is removed. Returns the kept exercise.
  function mergeExercises(keepId, mergeId) {
    const keep = state.exercises.find((e) => e.id === String(keepId));
    const other = state.exercises.find((e) => e.id === String(mergeId));
    if (!keep || !other || keep === other) return null;
    const pick = (k) => (String(keep[k] || "").trim() ? keep[k] : other[k] || "");
    const union = (k) => [...new Set([...(keep[k] || []), ...(other[k] || [])])];
    const aliases = [...(keep.aliases || []), other.name, ...(other.aliases || [])]
      .filter((a) => a && exerciseKey(a) !== exerciseKey(keep.name))
      .filter((a, i, list) => list.findIndex((b) => exerciseKey(b) === exerciseKey(a)) === i);
    const merged = saveExercise({
      ...keep,
      videoUrl: pick("videoUrl"), cues: pick("cues"), tier: pick("tier"), pattern: pick("pattern"), region: pick("region"), laterality: pick("laterality"),
      equipment: union("equipment"), tags: union("tags"), aliases,
    });
    deleteExercise(other.id);
    return merged;
  }
  function saveExercise(rec) {
    const id = rec.id != null ? String(rec.id) : randomId();
    const { id: _ignored, ...data } = rec;
    const full = { ...data, id };
    const idx = state.exercises.findIndex((e) => e.id === id);
    if (idx === -1) state.exercises.push(full);
    else state.exercises[idx] = full;
    persistLocal();
    syncUpsert("exercises", id, undefined, data);
    return full;
  }
  function deleteExercise(id) {
    state.exercises = state.exercises.filter((e) => e.id !== id);
    persistLocal();
    syncDelete("exercises", id);
  }

  // Folders for organizing programs: a list of paths ("Strength", "Strength/Lower Body"), kept in app_meta so
  // an empty folder still exists. A program's own `folder` field says which path it sits in.
  const DEFAULT_PROGRAM_FOLDERS = ["Speed", "Strength"];
  function getProgramFolders() {
    return [...(state.programFolders || DEFAULT_PROGRAM_FOLDERS)].sort((a, b) => a.localeCompare(b));
  }
  function setProgramFolders(list) {
    state.programFolders = [...new Set(list)];
    persistLocal();
    syncUpsertMeta("programFolders", state.programFolders);
  }

  // Reps reached on a set taken to failure -> the % of 1RM that weight is taken to be. Used to estimate a 1RM
  // from "BM" (Beast Mode) and "TF" (Technical Failure) sets. Coaches can edit it on the Programs tab.
  // The default is the DST percentage chart (2RM = 95%, then 2.5% less per rep, down to 14RM = 65%), then
  // 15 = 60%, 16 = 55% and 50% for 17 reps or more (the 17 row covers everything above it).
  const DEFAULT_RM_CHART = { 1: 100, 2: 95, 3: 92.5, 4: 90, 5: 87.5, 6: 85, 7: 82.5, 8: 80, 9: 77.5, 10: 75, 11: 72.5, 12: 70, 13: 67.5, 14: 65, 15: 60, 16: 55, 17: 50 };
  function getRmChart() {
    return { ...(state.rmChart || DEFAULT_RM_CHART) };
  }
  function setRmChart(chart) {
    state.rmChart = chart ? { ...chart } : null;
    persistLocal();
    syncUpsertMeta("rmChart", state.rmChart);
  }

  // ---- athlete phone page (athlete.html, see migration_007) ----------------------------------------
  // Each athlete can have one private link. Its token, and the weights / reps written in for each set, live in
  // their own tables and are kept in memory only (not in `state`, so they stay out of this browser's storage).
  let athleteLinks = {}; // athleteId -> token
  let athleteLogs = {}; // athleteId -> programId -> key -> value ("" = cleared)
  let athleteLogMeta = {}; // same shape, holding { at, source } for each entry: when it was typed in, and by whom
  function putLogRow(r) {
    const a = (athleteLogs[r.athlete_id] = athleteLogs[r.athlete_id] || {});
    (a[r.program_id] = a[r.program_id] || {})[r.key] = r.value || "";
    const m = (athleteLogMeta[r.athlete_id] = athleteLogMeta[r.athlete_id] || {});
    (m[r.program_id] = m[r.program_id] || {})[r.key] = { at: r.updated_at || null, source: r.source || "" };
  }
  // When anything was last logged for an athlete (a weight, reps, or a finished session), or null if nothing
  // ever has been. Used by the Today panel on the home page.
  function lastLoggedAt(athleteId) {
    const meta = athleteLogMeta[String(athleteId)] || {}, values = athleteLogs[String(athleteId)] || {};
    let last = null;
    Object.keys(meta).forEach((pid) => Object.keys(meta[pid]).forEach((key) => {
      const at = meta[pid][key].at;
      if (at && (values[pid] || {})[key] && (!last || at > last)) last = at;
    }));
    return last;
  }
  // Everything logged for an athlete, one entry per weight or reps box: { programId, key, value, at, source }.
  // Entries from before the log table existed (kept on the plan itself) have no time or source.
  function athleteLogEntries(athleteId, plan) {
    const out = [];
    const merged = programLogFor(athleteId, plan);
    const meta = athleteLogMeta[String(athleteId)] || {};
    Object.keys(merged).forEach((pid) => Object.keys(merged[pid]).forEach((key) => {
      const m = (meta[pid] || {})[key] || {};
      out.push({ programId: pid, key, value: merged[pid][key], at: m.at || null, source: m.source || "" });
    }));
    return out;
  }
  // Changes an athlete made on their phone to an exercise or its sets and reps (see migration_009):
  // athleteId -> programId -> exercise id -> { name, groups, from }
  let athleteOverrides = {};
  function putOverrideRow(r) {
    const a = (athleteOverrides[r.athlete_id] = athleteOverrides[r.athlete_id] || {});
    (a[r.program_id] = a[r.program_id] || {})[r.exercise_id] = { ...r.data, _at: r.updated_at || null }; // _at: when the change was made
  }
  // What a remote athlete has to train with (see migration_010): athleteId -> { access, custom, surveyedAt, source }.
  // Its own table, so the athlete filling it in on their phone and a coach editing their record never collide.
  let athleteEquipment = {};
  function putEquipmentRow(r) {
    athleteEquipment[r.athlete_id] = {
      access: Array.isArray(r.access) ? r.access : [],
      custom: Array.isArray(r.custom) ? r.custom : [],
      surveyedAt: r.surveyed_at || null,
      source: r.source || "",
    };
  }
  // `access` is null until someone has set it. Before the table existed the list sat on the athlete's own record.
  function getEquipment(athleteId) {
    const row = athleteEquipment[String(athleteId)];
    if (row) return row;
    const a = state.customAthletes.find((x) => String(x.id) === String(athleteId)) || {};
    return {
      access: Array.isArray(a.equipmentAccess) ? a.equipmentAccess : null,
      custom: Array.isArray(a.equipmentCustom) ? a.equipmentCustom : [],
      surveyedAt: null,
      source: "",
    };
  }
  function setEquipment(athleteId, { access, custom }) {
    const prev = getEquipment(athleteId);
    const next = { ...prev, access: access || [], custom: custom || [], source: "coach" };
    athleteEquipment[String(athleteId)] = next;
    sb().from("athlete_equipment")
      .upsert({ athlete_id: String(athleteId), access: next.access, custom: next.custom, source: "coach", updated_at: new Date().toISOString() })
      .then(({ error }) => logSyncError(`upsert athlete_equipment/${athleteId}`, error));
    return next;
  }
  // KPI results logged from the Coach Mode (see migration_011): read for one athlete when their Training Log is
  // opened, not kept in memory. Each is { id, kpiId, kpiName, unit, better, value, date, by, at }.
  async function loadKpiEntries(athleteId) {
    const { data, error } = await sb().from("kpi_entries").select("id,data").eq("athlete_id", String(athleteId)).limit(5000);
    logSyncError(`load kpi_entries/${athleteId}`, error);
    return error || !data ? [] : data.map((r) => ({ ...r.data, id: r.id }));
  }
  async function deleteKpiEntry(id) {
    const { error } = await sb().from("kpi_entries").delete().eq("id", String(id));
    logSyncError(`delete kpi_entries/${id}`, error);
    return !error;
  }
  // Speed groups and the programs assigned to them (see Coach Mode, coach.js): small shared lists kept in
  // app_meta under "speedGroups" and "speedAssignments". Read fresh each time, as coaches change them from
  // Coach Mode too.
  async function loadMeta(key) {
    const { data, error } = await sb().from("app_meta").select("value").eq("key", key).maybeSingle();
    logSyncError(`load app_meta/${key}`, error);
    return error || !data ? null : data.value;
  }
  async function saveMeta(key, value) {
    const { error } = await sb().from("app_meta").upsert({ key, value });
    logSyncError(`upsert app_meta/${key}`, error);
    return !error;
  }
  // Velocity data imported from Vitruve for one athlete (see vitruve.js and migration_013): read when their
  // Training Log is opened, written by the CSV import there.
  async function loadVitruveRows(athleteId) {
    const all = [];
    for (let from = 0; from < 50000; from += 1000) {
      const { data, error } = await sb().from("vitruve_rows").select("id,data").eq("athlete_id", String(athleteId)).range(from, from + 999);
      logSyncError(`load vitruve_rows/${athleteId}`, error);
      if (error || !data) break;
      all.push(...data.map((r) => ({ ...r.data, id: r.id })));
      if (data.length < 1000) break;
    }
    return all;
  }
  async function saveVitruveRows(athleteId, rows) {
    for (let i = 0; i < rows.length; i += 500) {
      const batch = rows.slice(i, i + 500).map((r) => ({ id: r.id, athlete_id: String(athleteId), data: r.data, updated_at: new Date().toISOString() }));
      const { error } = await sb().from("vitruve_rows").upsert(batch);
      logSyncError(`upsert vitruve_rows/${athleteId}`, error);
      if (error) return false;
    }
    return true;
  }
  async function deleteVitruveDay(athleteId, date) {
    const { error } = await sb().from("vitruve_rows").delete().eq("athlete_id", String(athleteId)).eq("data->>date", date);
    logSyncError(`delete vitruve_rows/${athleteId}/${date}`, error);
    return !error;
  }
  // Group speed sessions logged as done for this athlete in Coach Mode (see migration_012): read when their
  // Training Log is opened.
  async function loadSpeedLogs(athleteId) {
    const { data, error } = await sb().from("speed_logs").select("id,data").eq("athlete_id", String(athleteId)).limit(5000);
    logSyncError(`load speed_logs/${athleteId}`, error);
    return error || !data ? [] : data.map((r) => ({ ...r.data, id: r.id }));
  }
  async function deleteSpeedLog(id) {
    const { error } = await sb().from("speed_logs").delete().eq("id", String(id));
    logSyncError(`delete speed_logs/${id}`, error);
    return !error;
  }
  async function refreshEquipment(athleteId) {
    const { data, error } = await sb().from("athlete_equipment").select("*").eq("athlete_id", String(athleteId)).limit(1);
    logSyncError(`load athlete_equipment/${athleteId}`, error);
    if (error || !data) return false;
    if (data.length) putEquipmentRow(data[0]);
    return true;
  }
  function overridesFor(athleteId) {
    return athleteOverrides[String(athleteId)] || {};
  }
  // Puts the coach's version of one exercise back.
  function removeAthleteOverride(athleteId, programId, exerciseId) {
    const one = (athleteOverrides[String(athleteId)] || {})[programId];
    if (one) delete one[exerciseId];
    sb().from("athlete_overrides").delete().eq("athlete_id", String(athleteId)).eq("program_id", String(programId)).eq("exercise_id", String(exerciseId))
      .then(({ error }) => logSyncError(`delete athlete_overrides/${athleteId}/${exerciseId}`, error));
  }
  // When a shared program on an athlete's plan is replaced by their own copy (same weeks and exercise ids, new
  // program id), what they logged and changed on their phone against the old one is copied to the new one, with
  // its original time and source, so their history and swaps carry on. The old rows are left as they were.
  function carryAthleteRecords(athleteId, fromProgramId, toProgramId, plan) {
    const aid = String(athleteId), from = String(fromProgramId), to = String(toProgramId);
    if (!from || !to || from === to) return;
    const values = programLogFor(aid, plan)[from] || {};
    const meta = (athleteLogMeta[aid] || {})[from] || {};
    const logRows = Object.keys(values).filter((k) => values[k]).map((key) => ({
      athlete_id: aid, program_id: to, key, value: values[key], source: (meta[key] || {}).source || "coach", updated_at: (meta[key] || {}).at || new Date().toISOString(),
    }));
    logRows.forEach(putLogRow);
    if (logRows.length) sb().from("athlete_logs").upsert(logRows).then(({ error }) => logSyncError(`copy athlete_logs/${aid}/${from}->${to}`, error));
    const ov = (athleteOverrides[aid] || {})[from] || {};
    const ovRows = Object.keys(ov).map((exId) => {
      const { _at, ...data } = ov[exId];
      return { athlete_id: aid, program_id: to, exercise_id: exId, data, source: "athlete", updated_at: _at || new Date().toISOString() };
    });
    ovRows.forEach(putOverrideRow);
    if (ovRows.length) sb().from("athlete_overrides").upsert(ovRows).then(({ error }) => logSyncError(`copy athlete_overrides/${aid}/${from}->${to}`, error));
  }
  function getAthleteLink(athleteId) {
    return athleteLinks[String(athleteId)] || null;
  }
  // Makes a new link for the athlete (replacing any old one, which stops working). Resolves to the token, or
  // null if it could not be saved.
  async function createAthleteLink(athleteId, name) {
    const bytes = new Uint8Array(24);
    window.crypto.getRandomValues(bytes);
    const token = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    const { error } = await sb().from("athlete_links").upsert({ athlete_id: String(athleteId), token, name: name || "", created_at: new Date().toISOString() });
    logSyncError(`upsert athlete_links/${athleteId}`, error);
    if (error) return null;
    athleteLinks[String(athleteId)] = token;
    return token;
  }
  async function removeAthleteLink(athleteId) {
    const { error } = await sb().from("athlete_links").delete().eq("athlete_id", String(athleteId));
    logSyncError(`delete athlete_links/${athleteId}`, error);
    if (error) return false;
    delete athleteLinks[String(athleteId)];
    return true;
  }
  // What has been logged against each program on an athlete's plan: the entries from athlete_logs laid over
  // the older ones kept on the plan itself (plan.programLog), with cleared entries left out.
  function programLogFor(athleteId, plan) {
    const out = {};
    const add = (all) => Object.keys(all || {}).forEach((pid) => { out[pid] = { ...(out[pid] || {}), ...all[pid] }; });
    add((plan || {}).programLog);
    add(athleteLogs[String(athleteId)]);
    Object.keys(out).forEach((pid) => Object.keys(out[pid]).forEach((k) => { if (!out[pid][k]) delete out[pid][k]; }));
    return out;
  }
  function setAthleteLog(athleteId, programId, key, value) {
    const row = { athlete_id: String(athleteId), program_id: String(programId), key, value: value || "", source: "coach", updated_at: new Date().toISOString() };
    putLogRow(row);
    sb().from("athlete_logs").upsert(row).then(({ error }) => logSyncError(`upsert athlete_logs/${athleteId}/${key}`, error));
  }
  // Re-reads one athlete's log, to pick up what they have entered on their phone since the dashboard loaded.
  async function refreshAthleteLogs(athleteId) {
    const { data, error } = await sb().from("athlete_logs").select("*").eq("athlete_id", String(athleteId)).limit(20000);
    logSyncError(`load athlete_logs/${athleteId}`, error);
    if (error || !data) return false;
    delete athleteLogs[String(athleteId)];
    delete athleteLogMeta[String(athleteId)];
    data.forEach(putLogRow);
    const ov = await sb().from("athlete_overrides").select("*").eq("athlete_id", String(athleteId)).limit(5000);
    logSyncError(`load athlete_overrides/${athleteId}`, ov.error);
    if (!ov.error && ov.data) { delete athleteOverrides[String(athleteId)]; ov.data.forEach(putOverrideRow); }
    return true;
  }

  function deleteProgram(id) {
    state.programs = state.programs.filter((p) => p.id !== id);
    persistLocal();
    syncDelete("programs", id);
  }

  function deleteOffseasonFacility(id) {
    state.offseasonFacilities = state.offseasonFacilities.filter((f) => f.id !== id);
    persistLocal();
    syncDelete("offseason_facilities", id);
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
    getPitchingAssessments,
    getBodyCompSheets,
    saveAssessment,
    deleteAssessment,
    allOffseasonFacilities,
    saveOffseasonFacility,
    deleteOffseasonFacility,
    allPrograms,
    saveProgram,
    deleteProgram,
    getProgramFolders,
    setProgramFolders,
    accountHolders,
    ensureCoachRecords,
    getRmChart,
    setRmChart,
    getAthleteLink,
    createAthleteLink,
    removeAthleteLink,
    programLogFor,
    setAthleteLog,
    carryAthleteRecords,
    refreshAthleteLogs,
    athleteLogEntries,
    lastLoggedAt,
    overridesFor,
    getEquipment,
    setEquipment,
    refreshEquipment,
    loadKpiEntries,
    deleteKpiEntry,
    loadSpeedLogs,
    loadVitruveRows,
    saveVitruveRows,
    deleteVitruveDay,
    loadMeta,
    saveMeta,
    deleteSpeedLog,
    currentUserEmail: () => currentUser.email,
    removeAthleteOverride,
    allExercises,
    findExerciseByName,
    mergeExercises,
    saveExercise,
    deleteExercise,
    counts,
    clearAll,
  };
})();
