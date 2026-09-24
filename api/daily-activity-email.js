// Daily activity digest — sent only to Kevin, every morning year-round (no in-season window,
// unlike weekly-roster-email.js — account/roster activity isn't seasonal), covering the last 24
// hours: who signed in (Supabase Auth's own last_sign_in_at per user), emails sent through the app
// (see email_log, migration_003), and coach-driven edits to athletes, assessments, and periodization
// plans. Deliberately leaves out force_tests (the daily Hawkin sync, not a human edit) and
// player_plans (Google-Sheet-synced, same reasoning) — including either would flood this with
// automated noise instead of "what did a coach actually do".
//
// Two cron entries (00:00 and 01:00 UTC — see vercel.json) cover both sides of the Central-time
// DST transition, same reasoning and same real-wall-clock-hour check as weekly-roster-email.js.
// "created_by"/"updated_by" on each table are auth.users uuids (see migration_002_activity_tracking.sql),
// resolved to emails via the profiles table rather than the admin API — cheaper, and this only
// needs the small set of ids that actually show up in the last day's changes.

const SUPABASE_URL = "https://avgfxwhxglftftmlydiz.supabase.co";
const SEND_AS_EMAIL = "kevin@dynamicsportstraining.com";
const RECIPIENT_EMAIL = "kevin@dynamicsportstraining.com";
const EXCLUDED_LOGINS = ["test@test.com"]; // the dev/test login, not a real coach

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

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

function sbHeaders(serviceKey, extra) {
  return { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json", ...extra };
}
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
  const contentRange = firstRes.headers.get("content-range");
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

// Supabase Auth already tracks each user's last sign-in on their own account record — no separate
// login table needed. Like last_sign_in_at itself, this only ever shows the MOST RECENT sign-in per
// user, so someone who logged in twice today only shows up once (with their later time).
async function getRecentLogins(serviceKey, since) {
  const excluded = new Set(EXCLUDED_LOGINS.map((e) => e.toLowerCase()));
  const logins = [];
  let page = 1;
  for (;;) {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=200`, {
      headers: sbHeaders(serviceKey),
    });
    if (!res.ok) throw new Error(`Failed to list users: HTTP ${res.status} ${await res.text()}`);
    const body = await res.json();
    const users = body.users || [];
    users.forEach((u) => {
      if (u.email && u.last_sign_in_at && u.last_sign_in_at >= since && !excluded.has(u.email.toLowerCase())) {
        logins.push({ email: u.email, at: u.last_sign_in_at });
      }
    });
    if (users.length < 200) break;
    page++;
  }
  logins.sort((a, b) => (b.at || "").localeCompare(a.at || ""));
  return logins;
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function fmtTime(iso) {
  return new Date(iso).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function buildDigestHtml({ emails, edits, logins }) {
  const dateLabel = new Date().toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "long", day: "numeric", year: "numeric" });
  const loginRows = logins.length
    ? logins.map((l) => `
        <tr>
          <td style="padding:6px 10px;border-bottom:1px solid #2a2a2a;color:#9a9a9a;font-size:12px;font-family:monospace;white-space:nowrap;">${fmtTime(l.at)}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #2a2a2a;color:#fff;font-size:12px;font-family:Arial,sans-serif;">${escapeHtml(l.email)}</td>
        </tr>`).join("")
    : `<tr><td colspan="2" style="padding:8px 10px;color:#6b6b6b;font-size:12px;font-family:Arial,sans-serif;">No logins.</td></tr>`;
  const emailRows = emails.length
    ? emails.map((e) => `
        <tr>
          <td style="padding:6px 10px;border-bottom:1px solid #2a2a2a;color:#9a9a9a;font-size:12px;font-family:monospace;white-space:nowrap;">${fmtTime(e.sent_at)}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #2a2a2a;color:#fff;font-size:12px;font-family:Arial,sans-serif;">${escapeHtml(e.sent_by || "system")}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #2a2a2a;color:#fff;font-size:12px;font-family:Arial,sans-serif;">${escapeHtml(e.to_email)}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #2a2a2a;color:#9a9a9a;font-size:12px;font-family:Arial,sans-serif;">${escapeHtml(e.subject || "")}</td>
        </tr>`).join("")
    : `<tr><td colspan="4" style="padding:8px 10px;color:#6b6b6b;font-size:12px;font-family:Arial,sans-serif;">No emails sent.</td></tr>`;

  const editRows = edits.length
    ? edits.map((e) => `
        <tr>
          <td style="padding:6px 10px;border-bottom:1px solid #2a2a2a;color:#9a9a9a;font-size:12px;font-family:monospace;white-space:nowrap;">${fmtTime(e.at)}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #2a2a2a;color:#fff;font-size:12px;font-family:Arial,sans-serif;">${escapeHtml(e.by)}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #2a2a2a;color:#fff;font-size:12px;font-family:Arial,sans-serif;">${escapeHtml(e.what)}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #2a2a2a;color:#9a9a9a;font-size:12px;font-family:Arial,sans-serif;">${escapeHtml(e.kind)}</td>
        </tr>`).join("")
    : `<tr><td colspan="4" style="padding:8px 10px;color:#6b6b6b;font-size:12px;font-family:Arial,sans-serif;">No edits.</td></tr>`;

  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#0d0d0d;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0d0d0d;padding:20px 0;">
    <tr><td align="center">
      <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="background:#151515;border-radius:10px;overflow:hidden;">
        <tr><td style="padding:20px 24px;border-bottom:2px solid #b5283a;">
          <div style="color:#fff;font-size:18px;font-weight:700;font-family:Arial,sans-serif;">Daily Dashboard Activity</div>
          <div style="color:#9a9a9a;font-size:12px;font-family:Arial,sans-serif;margin-top:2px;">${dateLabel} &middot; last 24 hours</div>
        </td></tr>
        <tr><td style="padding:18px 14px 4px;">
          <div style="color:#fff;font-size:14px;font-weight:700;font-family:Arial,sans-serif;padding:0 10px 8px;">Logins (${logins.length})</div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${loginRows}</table>
        </td></tr>
        <tr><td style="padding:18px 14px 4px;">
          <div style="color:#fff;font-size:14px;font-weight:700;font-family:Arial,sans-serif;padding:0 10px 8px;">Emails sent (${emails.length})</div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${emailRows}</table>
        </td></tr>
        <tr><td style="padding:18px 14px 20px;">
          <div style="color:#fff;font-size:14px;font-weight:700;font-family:Arial,sans-serif;padding:0 10px 8px;">Roster &amp; record edits (${edits.length})</div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${editRows}</table>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function buildRawHtmlEmail({ from, to, subject, html }) {
  const encodeHeader = (s) => `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`;
  const lines = [`From: ${from}`, `To: ${to}`, `Subject: ${encodeHeader(subject)}`, "MIME-Version: 1.0", 'Content-Type: text/html; charset="UTF-8"', "", html];
  return Buffer.from(lines.join("\r\n"), "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function sendDigestEmail({ to, subject, html }) {
  const { google } = require("googleapis");
  const creds = JSON.parse(requireEnv("GMAIL_SERVICE_ACCOUNT_JSON"));
  const jwtClient = new google.auth.JWT({ email: creds.client_email, key: creds.private_key, scopes: ["https://www.googleapis.com/auth/gmail.send"], subject: SEND_AS_EMAIL });
  const gmail = google.gmail({ version: "v1", auth: jwtClient });
  const raw = buildRawHtmlEmail({ from: SEND_AS_EMAIL, to, subject, html });
  await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
}

async function isSignedInCoach(bearerToken) {
  if (!bearerToken) return false;
  try {
    const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF2Z2Z4d2h4Z2xmdGZ0bWx5ZGl6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAxMTc3NzcsImV4cCI6MjEwNTY5Mzc3N30.-g6HIvyDfsCIiVt4fIhswKqhLNMY8jqSDFbAN2pOHYs";
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${bearerToken}` } });
    return res.ok;
  } catch (e) {
    return false;
  }
}

// Each table's actual columns differ (see supabase/schema.sql) — athletes has no athlete_id
// column (it isn't linked to another athlete, it IS one) and periodization uses athlete_id itself
// as its primary key instead of a separate id — so each entry lists exactly what its table has,
// rather than one query shape assumed to fit all three. Assessments/periodization only store
// athleteId, not a name, so their descriptions need the athletes table's id->name map built in the
// handler below (passed in as `names`).
//
// created_by/created_at are stamped once, at insert, and never touched again (see
// stamp_activity() in migration_002) — updated_by/updated_at get re-stamped on every save,
// including a debounced autosave that fires just from opening a record in the UI. That means a
// row's own updated_by can silently drift to whoever last viewed it, hiding who actually created
// it. So: a row whose created_at falls in today's window gets reported as "created" (credited to
// created_by), not "updated" (credited to whoever happened to touch it afterward).
const EDIT_TABLES = [
  { table: "athletes", select: "id,data,updated_by,updated_at,created_by,created_at", describe: (row, names, action) => `${(row.data && row.data.name) || row.id} ${action}` },
  { table: "assessments", select: "id,athlete_id,data,updated_by,updated_at,created_by,created_at", describe: (row, names, action) => `Assessment for ${names.get(row.athlete_id) || `athlete ${row.athlete_id}`} ${action}` },
  { table: "periodization", select: "athlete_id,data,updated_by,updated_at,created_by,created_at", describe: (row, names, action) => `Periodization plan ${action} for ${names.get(row.athlete_id) || `athlete ${row.athlete_id}`}` },
];

module.exports = async (req, res) => {
  const auth = req.headers.authorization || "";
  const isCron = auth === `Bearer ${process.env.CRON_SECRET}`;
  const isManual = !isCron && (await isSignedInCoach(auth.replace(/^Bearer\s+/i, "")));
  if (!isCron && !isManual) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  // Being a signed-in coach only grants permission to call this at all (for testing) — only an
  // explicit ?force=1 skips the schedule/already-sent checks (see api/weekly-roster-email.js,
  // which learned this the hard way).
  const force = !!(req.query && req.query.force === "1");

  try {
    const now = new Date();
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago", hour: "numeric", hour12: false, month: "numeric", day: "numeric", year: "numeric",
    }).formatToParts(now);
    const get = (type) => parts.find((p) => p.type === type).value;
    const hour = Number(get("hour"));
    const chicagoToday = new Date(Number(get("year")), Number(get("month")) - 1, Number(get("day")));
    const dateKey = chicagoToday.toISOString().slice(0, 10);

    if (!force && hour !== 19) {
      res.status(200).json({ ok: true, skipped: true, reason: "not the scheduled send time", hour });
      return;
    }

    const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

    if (!force) {
      const marker = await sbSelect(serviceKey, "app_meta", "key=eq.lastDailyActivityEmailDate&select=value");
      if (marker.length && marker[0].value === dateKey) {
        res.status(200).json({ ok: true, skipped: true, reason: "already sent today" });
        return;
      }
    }

    const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

    const [emailRows, profileRows, athleteRows, logins, ...editTableRows] = await Promise.all([
      sbSelect(serviceKey, "email_log", `select=sent_at,sent_by,to_email,subject,kind&sent_at=gte.${since}&order=sent_at.desc`),
      sbSelect(serviceKey, "profiles", "select=id,email"),
      sbSelect(serviceKey, "athletes", "select=data"),
      getRecentLogins(serviceKey, since),
      ...EDIT_TABLES.map((t) => sbSelect(serviceKey, t.table, `select=${t.select}&updated_at=gte.${since}&order=updated_at.desc`)),
    ]);

    const emailByUuid = new Map(profileRows.map((p) => [p.id, p.email]));
    const nameByAthleteId = new Map(athleteRows.map((r) => [String(r.data && r.data.id), r.data && r.data.name]));
    const edits = [];
    EDIT_TABLES.forEach((def, i) => {
      editTableRows[i].forEach((row) => {
        const createdNow = !!(row.created_at && row.created_at >= since);
        const action = createdNow ? "created" : "updated";
        edits.push({
          at: createdNow ? row.created_at : row.updated_at,
          by: emailByUuid.get(createdNow ? row.created_by : row.updated_by) || "system / sync",
          what: def.describe(row, nameByAthleteId, action),
          kind: createdNow ? "Created" : "Updated",
        });
      });
    });
    edits.sort((a, b) => (b.at || "").localeCompare(a.at || ""));

    const html = buildDigestHtml({ emails: emailRows, edits, logins });
    const subject = `Daily Dashboard Activity — ${chicagoToday.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;

    await sendDigestEmail({ to: RECIPIENT_EMAIL, subject, html });
    await sbUpsert(serviceKey, "email_log", [{ sent_by: "system", to_email: RECIPIENT_EMAIL, subject, kind: "activity_digest" }]);
    if (!force) await sbUpsert(serviceKey, "app_meta", [{ key: "lastDailyActivityEmailDate", value: dateKey }]);

    res.status(200).json({ ok: true, sent: 1, emails: emailRows.length, edits: edits.length, logins: logins.length });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
};
