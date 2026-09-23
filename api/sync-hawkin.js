// Vercel Cron target (see vercel.json) — pulls new force-plate tests from Hawkin Dynamics once a
// day and writes them into Supabase's force_tests table. Also callable on demand from the "Sync
// Now" button on the Import & Manual Entry page (see HawkinSyncPanel below). Either way, it always
// writes via the Supabase service-role key (server-only env var, bypasses Row Level Security)
// rather than a coach's own session — the cron path has no session at all, and reusing the same
// write path for both keeps the insert/matching logic identical regardless of who triggered it.
// It authenticates to Hawkin with a refresh token (an org admin creates one under Settings ->
// Integrations in Hawkin) instead of a login. No npm dependencies, same reasoning as api/news.js:
// this project has no build step, so everything here is plain fetch() calls.
//
// Athlete matching is by name only (same as the existing manual CSV import), not by caching a
// Hawkin athlete id onto the athlete record — that would mean this job writing to the athletes
// table, which would blow away the "Last updated by <coach>" signature on that athlete's profile
// (the activity trigger stamps updated_by from the request's auth context, and a service-role
// request has none). Re-matching by name on every run costs nothing at this roster size and keeps
// this job's writes confined to force_tests.
//
// Unmatched Hawkin athletes are skipped and reported in the response rather than auto-created —
// an unattended daily job silently adding a roster entry because of a name mismatch is a much
// worse failure mode than a coach noticing "N unmatched" in the logs and fixing a name once.

const HAWKIN_BASE = "https://cloud.hawkindynamics.com"; // Americas region; EU/APAC have their own base URLs — see connect.hawkindynamics.com/api
const SUPABASE_URL = "https://avgfxwhxglftftmlydiz.supabase.co";

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

function normalizeName(n) {
  return (n || "").trim().toLowerCase().replace(/\s+/g, " ");
}

// Caps concurrent Supabase requests from this function — see store.js's identical dbLimit for why:
// firing every page of a paginated read at once overwhelmed Supabase's connection pool badly
// enough that requests hung rather than queued.
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
const dbLimit = makeLimiter(4);

// ---- Supabase (via REST + the service-role key, so this works with no user session) -----------
function sbHeaders(serviceKey, extra) {
  return { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json", ...extra };
}
// Supabase caps an unpaginated select at 1000 rows by default (silently — no error, no
// truncation flag), so this pages through with Range headers rather than assume one request has
// everything. Only athletes/app_meta go through this today (well under 1000 rows), but the roster
// won't stay that small forever, and this is cheap insurance against the exact bug that made
// force_tests silently truncate client-side (see store.js's own fetchTable). The first page asks
// for an exact total (Prefer: count=exact) so every remaining page can be fetched in parallel
// instead of one at a time — same reasoning as store.js's version of this.
async function sbSelect(serviceKey, table, query) {
  const PAGE_SIZE = 1000;
  const fetchPage = async (offset) => {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
      headers: sbHeaders(serviceKey, { Range: `${offset}-${offset + PAGE_SIZE - 1}` }),
    });
    if (!res.ok && res.status !== 206) throw new Error(`Supabase select ${table} failed: HTTP ${res.status} ${await res.text()}`);
    return res;
  };
  const firstRes = await dbLimit(() => fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: sbHeaders(serviceKey, { Range: `0-${PAGE_SIZE - 1}`, Prefer: "count=exact" }),
  }));
  if (!firstRes.ok && firstRes.status !== 206) throw new Error(`Supabase select ${table} failed: HTTP ${firstRes.status} ${await firstRes.text()}`);
  let all = (await firstRes.json()) || [];
  const contentRange = firstRes.headers.get("content-range"); // "0-999/8724"
  const total = contentRange ? Number(contentRange.split("/")[1]) : all.length;
  if (total > all.length) {
    const pageFetches = [];
    for (let offset = PAGE_SIZE; offset < total; offset += PAGE_SIZE) pageFetches.push(dbLimit(() => fetchPage(offset)));
    const pages = await Promise.all(pageFetches);
    for (const res of pages) all = all.concat((await res.json()) || []);
  }
  return all;
}
async function sbUpsert(serviceKey, table, rows) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: sbHeaders(serviceKey, { Prefer: "resolution=merge-duplicates,return=minimal" }),
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`Supabase upsert ${table} failed: HTTP ${res.status} ${await res.text()}`);
}
async function getSyncFrom(serviceKey, overrideSince) {
  if (overrideSince != null) return overrideSince; // manual backfill (?since=) — see module.exports
  const rows = await sbSelect(serviceKey, "app_meta", "key=eq.hawkinSyncedAt&select=value");
  if (rows.length && rows[0].value != null) return Number(rows[0].value);
  // First run ever: back-fill a short recent window (not all-time — Hawkin data already manually
  // CSV-imported for older tests would otherwise get duplicated alongside the freshly-synced copy)
  // and not "now" either, so the very first run actually proves the pipeline works end to end.
  return Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60;
}
async function setSyncFrom(serviceKey, unixSeconds) {
  await sbUpsert(serviceKey, "app_meta", [{ key: "hawkinSyncedAt", value: unixSeconds }]);
}
// Separate from hawkinSyncedAt on purpose: that value is a data cursor (how far into Hawkin's own
// test timestamps this has caught up to), which often doesn't change between runs if nothing new
// was tested — showing *that* as "Last synced" in the UI would make a successful "Sync Now" click
// look like it did nothing. This tracks wall-clock "when did the job last actually run" instead.
async function setLastRunAt(serviceKey) {
  await sbUpsert(serviceKey, "app_meta", [{ key: "hawkinLastRunAt", value: Math.floor(Date.now() / 1000) }]);
}
async function getAllAthletes(serviceKey) {
  return sbSelect(serviceKey, "athletes", "select=id,data");
}

// ---- Hawkin Dynamics -----------------------------------------------------------------------
async function getHawkinAccessToken() {
  const refreshToken = requireEnv("HAWKIN_REFRESH_TOKEN");
  const res = await fetch(`${HAWKIN_BASE}/api/token`, { headers: { Authorization: `Bearer ${refreshToken}` } });
  if (!res.ok) throw new Error(`Hawkin token exchange failed: HTTP ${res.status} ${await res.text()}`);
  const data = await res.json();
  const token = data.access_token || data.accessToken || data.token;
  if (!token) throw new Error(`Hawkin token exchange returned no access token (got: ${JSON.stringify(data)})`);
  return token;
}
// Loops through cursor pagination (hasMore/nextCursor) rather than assuming one response has
// everything — needed for a wide window like a full-year backfill, where a single team's test
// count alone can run into the thousands. Capped at 200 pages as a sanity backstop, not a limit
// expected to actually be hit.
async function getHawkinTests(accessToken, syncFrom, syncTo) {
  let all = [];
  let cursor = null;
  let lastSyncTime = null;
  for (let page = 0; page < 200; page++) {
    let url = `${HAWKIN_BASE}/api/v1?syncFrom=${syncFrom}`;
    if (syncTo != null) url += `&syncTo=${syncTo}`;
    if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) throw new Error(`Hawkin tests fetch failed: HTTP ${res.status} ${await res.text()}`);
    const payload = await res.json();
    all = all.concat(payload.data || []);
    if (payload.lastSyncTime != null) lastSyncTime = payload.lastSyncTime;
    if (!payload.hasMore || !payload.nextCursor) break;
    cursor = payload.nextCursor;
  }
  return { data: all, lastSyncTime };
}
// ---- Metric extraction -----------------------------------------------------------------------
// Hawkin's metric field names vary by test type and aren't fully pinned down in their public docs
// (e.g. "Jump Height(m)") — matched the same fuzzy way the manual CSV importer already matches
// spreadsheet headers, rather than assuming one exact key. The full raw test object is always kept
// too (see `raw` below), so nothing is lost even where a specific field isn't recognized.
function findMetricEntry(test, guesses, excludes) {
  for (const k of Object.keys(test)) {
    const lower = k.toLowerCase();
    if (excludes && excludes.some((x) => lower.includes(x))) continue;
    if (!guesses.some((g) => lower.includes(g))) continue;
    const raw = test[k];
    const num = typeof raw === "number" ? raw : (typeof raw === "string" && raw.trim() !== "" ? Number(raw) : null);
    if (num == null || isNaN(num)) continue;
    return { key: k, value: num };
  }
  return null;
}
function jumpHeightInInches(entry) {
  if (!entry) return null;
  const k = entry.key.toLowerCase();
  if (k.includes("(m)") || /\bmeters?\b/.test(k)) return entry.value * 39.3701;
  if (k.includes("(cm)") || /centimet/.test(k)) return entry.value * 0.393701;
  return entry.value; // assume already inches if no unit marker is present
}
function metricValue(test, guesses, excludes) {
  const entry = findMetricEntry(test, guesses, excludes);
  return entry ? entry.value : null;
}

// Same anon key the dashboard itself uses (supabase-client.js) — safe to have here, it only proves
// *which* Supabase project a token belongs to, not that the token is valid on its own.
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF2Z2Z4d2h4Z2xmdGZ0bWx5ZGl6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAxMTc3NzcsImV4cCI6MjEwNTY5Mzc3N30.-g6HIvyDfsCIiVt4fIhswKqhLNMY8jqSDFbAN2pOHYs";

// A logged-in coach clicking "Sync Now" sends their own Supabase session token instead of the
// cron secret (which never reaches the browser) — verified for real against Supabase's auth
// endpoint, not just "is a Bearer token present", so a made-up string can't pass as a coach.
async function isSignedInCoach(bearerToken) {
  if (!bearerToken) return false;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${bearerToken}` },
    });
    return res.ok;
  } catch (e) {
    return false;
  }
}

module.exports = async (req, res) => {
  const auth = req.headers.authorization || "";
  const isCron = auth === `Bearer ${process.env.CRON_SECRET}`;
  const isManual = !isCron && (await isSignedInCoach(auth.replace(/^Bearer\s+/i, "")));
  if (!isCron && !isManual) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const summary = { matched: 0, inserted: 0, skippedAthletes: [], errors: [] };
  try {
    const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
    const accessToken = await getHawkinAccessToken();
    // ?since=<unix seconds> is a manual backfill override (e.g. a coach's Hawkin history for a
    // less-active athlete falls outside the normal incremental window) — bypasses the stored
    // cursor for this one run. ?until=<unix seconds> bounds it to a specific historical window
    // (e.g. re-importing one year at a time so each request finishes within the function's time
    // limit) — a bounded run like that is a deliberate one-off replay, not "how far normal daily
    // syncing has gotten", so it leaves the stored cursor alone rather than dragging it backward.
    const overrideSince = req.query.since != null ? Number(req.query.since) : null;
    const overrideUntil = req.query.until != null ? Number(req.query.until) : null;
    const syncFrom = await getSyncFrom(serviceKey, overrideSince);

    const [testsPayload, localAthletes] = await Promise.all([
      getHawkinTests(accessToken, syncFrom, overrideUntil),
      getAllAthletes(serviceKey),
    ]);
    const tests = testsPayload.data || [];

    // row.id is the Supabase text primary key ("196") — row.data.id is the athlete's own id as
    // the rest of the app stores and compares it (a number, 196). A force_tests row's athleteId
    // has to match that number, or every synced test silently fails to show up anywhere (the
    // athlete_id *column* was always fine — it's always String()'d before being written — this
    // was only about what ends up inside the JSON `data` itself).
    const localIdByName = new Map(localAthletes.map((row) => [normalizeName(row.data.name), row.data.id]));

    const rowsToInsert = [];
    const seenUnmatched = new Set();
    for (const test of tests) {
      // The athlete is embedded directly on the test (test.athlete = {id, name, ...}), not a flat
      // athleteId field. This org's Hawkin account also covers ~2,780 athletes total (far more
      // than this roster's 190), so most "unmatched" names here are expected, not a bug — they're
      // athletes at the facility who aren't on this particular roster.
      const hawkinName = (test.athlete && test.athlete.name) || "";
      const localId = hawkinName ? localIdByName.get(normalizeName(hawkinName)) : undefined;
      if (!localId) {
        const label = hawkinName || (test.athlete && test.athlete.id) || "unknown";
        if (!seenUnmatched.has(label)) { seenUnmatched.add(label); summary.skippedAthletes.push(label); }
        continue;
      }

      // timestamp is Unix seconds.
      const dateObj = test.timestamp ? new Date(test.timestamp * 1000) : null;
      const dateStr = dateObj && !isNaN(dateObj.getTime()) ? dateObj.toISOString().slice(0, 10) : null;

      const record = {
        athleteId: localId,
        date: dateStr,
        testType: (test.testType && test.testType.name) || "",
        jumpHeight: jumpHeightInInches(findMetricEntry(test, ["jump height"])),
        // "RSI" and "mRSI" are two different metrics Hawkin reports side by side — guessing just
        // "rsi" matches "RSI" first and silently grabs the wrong one, so this targets "mRSI"
        // specifically (the CSV import's "RSI-Modified" column is the same metric).
        rsiModified: metricValue(test, ["mrsi"]),
        systemWeight: metricValue(test, ["system weight"]),
        // Hawkin's API has no single "Peak Power" metric — "peak power" in jump testing
        // conventionally means the propulsive (concentric) phase's peak, which is what these map to.
        peakPower: metricValue(test, ["peak propulsive power"], ["relative"]),
        relativePeakPower: metricValue(test, ["peak relative propulsive power"]),
        takeoffVelocity: metricValue(test, ["takeoff velocity"]),
        totalImpulse: metricValue(test, ["propulsive net impulse"], ["relative"]),
        brakingRfd: metricValue(test, ["braking rfd"], ["avg", "l|r"]),
        // "Concentric" and "Propulsive" are the same jump phase in Hawkin's naming.
        concentricImpulse: metricValue(test, ["propulsive impulse"], ["net", "relative", "p1", "p2"]),
        source: "hawkin-sync",
        hawkinTestId: test.id,
        raw: test,
      };
      rowsToInsert.push({ id: `hawkin-${test.id}`, athlete_id: String(localId), data: record });
      summary.matched++;
    }

    // A CMJ session is usually several trials (3-5 jumps) sharing one calendar date — the
    // established rule (same as the manual CSV import) is one test per athlete per day, keeping
    // whichever trial had the highest jump height. Collapsing this run's own batch first means a
    // session's several trials count as a single candidate below, not several separate look-ups.
    const bestPerDay = new Map();
    for (const row of rowsToInsert) {
      const key = `${row.athlete_id}|${row.data.date}`;
      const prev = bestPerDay.get(key);
      const jh = typeof row.data.jumpHeight === "number" ? row.data.jumpHeight : -Infinity;
      const prevJh = prev && typeof prev.data.jumpHeight === "number" ? prev.data.jumpHeight : -Infinity;
      if (!prev || jh > prevJh) bestPerDay.set(key, row);
    }
    let candidateRows = Array.from(bestPerDay.values());
    summary.collapsedDuplicateTrials = rowsToInsert.length - candidateRows.length;

    // Same "a date already on file is skipped" rule as the CSV importer — don't re-litigate a day
    // that was already recorded, whether that record came from an earlier sync or a CSV import.
    // Scoped to just the athletes this run touched, not the whole (8000+ row) table.
    const touchedAthleteIds = [...new Set(candidateRows.map((r) => r.athlete_id))];
    if (touchedAthleteIds.length) {
      const existingRows = await sbSelect(serviceKey, "force_tests", `select=athlete_id,data&athlete_id=in.(${touchedAthleteIds.join(",")})`);
      const existingKeys = new Set(existingRows.map((r) => `${r.athlete_id}|${r.data.date}`));
      candidateRows = candidateRows.filter((r) => !existingKeys.has(`${r.athlete_id}|${r.data.date}`));
    }

    // Batched rather than one giant request — a full-year backfill can mean thousands of rows,
    // and Supabase/PostgREST rejects or times out on very large single inserts.
    const BATCH_SIZE = 500;
    for (let i = 0; i < candidateRows.length; i += BATCH_SIZE) {
      await sbUpsert(serviceKey, "force_tests", candidateRows.slice(i, i + BATCH_SIZE));
    }
    summary.inserted = candidateRows.length;

    const newSyncFrom = testsPayload.lastSyncTime || Math.floor(Date.now() / 1000);
    if (overrideUntil == null) await setSyncFrom(serviceKey, newSyncFrom);
    await setLastRunAt(serviceKey);

    res.status(200).json({ ok: true, ...summary, totalTestsSeen: tests.length, syncFrom, newSyncFrom, cursorAdvanced: overrideUntil == null });
  } catch (e) {
    summary.errors.push(String((e && e.message) || e));
    res.status(200).json({ ok: false, ...summary });
  }
};
