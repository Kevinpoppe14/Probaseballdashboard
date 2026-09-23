// Vercel Cron target (see vercel.json) — pulls new force-plate tests from Hawkin Dynamics once a
// day and writes them into Supabase's force_tests table. No coach is logged in when this runs, so
// it authenticates to Supabase with the service-role key (server-only env var, bypasses Row Level
// Security) instead of a user session, and to Hawkin with a refresh token (an org admin creates one
// under Settings -> Integrations in Hawkin) instead of a login. No npm dependencies, same reasoning
// as api/news.js: this project has no build step, so everything here is plain fetch() calls.
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
async function getHawkinAthletes(accessToken) {
  const res = await fetch(`${HAWKIN_BASE}/api/v1/athletes`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Hawkin athletes fetch failed: HTTP ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.data || data.athletes || [];
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

module.exports = async (req, res) => {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    // Non-sensitive diagnostic — never the actual values — to tell "env var isn't set on this
    // deployment" apart from "the value doesn't match", instead of guessing. Remove once this
    // has been confirmed working.
    res.status(401).json({
      error: "unauthorized",
      debug: {
        envVarPresent: typeof process.env.CRON_SECRET === "string" && process.env.CRON_SECRET.length > 0,
        envVarLength: (process.env.CRON_SECRET || "").length,
        receivedHeaderPresent: typeof req.headers.authorization === "string",
        receivedHeaderLength: (req.headers.authorization || "").length,
      },
    });
    return;
  }

  const summary = { matched: 0, inserted: 0, skippedAthletes: [], errors: [] };
  try {
    const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
    const accessToken = await getHawkinAccessToken();
    const syncFrom = await getSyncFrom(serviceKey);

    const [testsPayload, hawkinAthletes, localAthletes] = await Promise.all([
      getHawkinTests(accessToken, syncFrom),
      getHawkinAthletes(accessToken),
      getAllAthletes(serviceKey),
    ]);
    const tests = testsPayload.data || [];

    const hawkinNameById = new Map(
      hawkinAthletes.map((a) => [a.id, (a.name || `${a.firstName || ""} ${a.lastName || ""}`).trim()])
    );
    const localIdByName = new Map(localAthletes.map((row) => [normalizeName(row.data.name), row.id]));

    const rowsToInsert = [];
    const seenUnmatched = new Set();
    for (const test of tests) {
      const hawkinName = hawkinNameById.get(test.athleteId) || "";
      const localId = hawkinName ? localIdByName.get(normalizeName(hawkinName)) : undefined;
      if (!localId) {
        const label = hawkinName || test.athleteId;
        if (!seenUnmatched.has(label)) { seenUnmatched.add(label); summary.skippedAthletes.push(label); }
        continue;
      }

      const dateRaw = test.date || test.testDate || test.startTime || test.timestamp;
      const dateObj = dateRaw ? new Date(dateRaw) : null;
      const dateStr = dateObj && !isNaN(dateObj.getTime()) ? dateObj.toISOString().slice(0, 10) : null;

      const record = {
        athleteId: localId,
        date: dateStr,
        testType: test.testTypeName || (test.testType && test.testType.name) || "",
        jumpHeight: jumpHeightInInches(findMetricEntry(test, ["jump height"])),
        rsiModified: metricValue(test, ["rsi"]),
        systemWeight: metricValue(test, ["system weight", "body weight", "bodyweight"]),
        peakPower: metricValue(test, ["peak power"], ["relative", "/bm", "/kg"]),
        relativePeakPower: metricValue(test, ["relative peak power", "peak power / bm", "w/kg"]),
        takeoffVelocity: metricValue(test, ["takeoff velocity"]),
        totalImpulse: metricValue(test, ["total impulse"]),
        brakingRfd: metricValue(test, ["braking rfd"]),
        concentricImpulse: metricValue(test, ["concentric impulse"]),
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
