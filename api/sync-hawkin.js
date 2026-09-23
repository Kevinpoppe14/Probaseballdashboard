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

// ---- Supabase (via REST + the service-role key, so this works with no user session) -----------
function sbHeaders(serviceKey, extra) {
  return { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json", ...extra };
}
async function sbSelect(serviceKey, table, query) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { headers: sbHeaders(serviceKey) });
  if (!res.ok) throw new Error(`Supabase select ${table} failed: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}
async function sbUpsert(serviceKey, table, rows) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: sbHeaders(serviceKey, { Prefer: "resolution=merge-duplicates,return=minimal" }),
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`Supabase upsert ${table} failed: HTTP ${res.status} ${await res.text()}`);
}
async function getSyncFrom(serviceKey) {
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
async function getHawkinTests(accessToken, syncFrom) {
  const res = await fetch(`${HAWKIN_BASE}/api/v1?syncFrom=${syncFrom}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Hawkin tests fetch failed: HTTP ${res.status} ${await res.text()}`);
  return res.json();
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
    const syncFrom = await getSyncFrom(serviceKey);

    const [testsPayload, localAthletes] = await Promise.all([
      getHawkinTests(accessToken, syncFrom),
      getAllAthletes(serviceKey),
    ]);
    const tests = testsPayload.data || [];

    const localIdByName = new Map(localAthletes.map((row) => [normalizeName(row.data.name), row.id]));

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

    if (rowsToInsert.length) {
      await sbUpsert(serviceKey, "force_tests", rowsToInsert);
      summary.inserted = rowsToInsert.length;
    }

    const newSyncFrom = testsPayload.lastSyncTime || Math.floor(Date.now() / 1000);
    await setSyncFrom(serviceKey, newSyncFrom);

    res.status(200).json({ ok: true, ...summary, totalTestsSeen: tests.length, syncFrom, newSyncFrom });
  } catch (e) {
    summary.errors.push(String((e && e.message) || e));
    res.status(200).json({ ok: false, ...summary });
  }
};
