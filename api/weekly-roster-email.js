// Weekly roster digest — Vercel Cron sends a roster overview (grouped by DST Location, active
// athletes only) to every coach who has ever signed in, every Sunday around 11am Central, from
// September 1 through March 1. See vercel.json: TWO cron entries fire it (16:00 and 17:00 UTC),
// one for each side of the Nov/March Central-time DST transition — a single fixed UTC hour would
// drift an hour off "11am Central" for half the year. Whichever entry actually lands on 11am
// America/Chicago wall-clock time is the one that sends; the other one no-ops. An app_meta marker
// (lastWeeklyRosterEmailDate) makes that safe even if both somehow matched in the same run.
//
// Ports the same three roster-row indicators the dashboard itself shows (see index.html's
// WeekOverWeekTicker / ProgramStatusBadge / AssessmentDueBadge and periodization.js's
// planProgress) since this runs with no browser involved — there's nothing to call into.

const SUPABASE_URL = "https://avgfxwhxglftftmlydiz.supabase.co";
const APP_BASE_URL = "https://probaseballdashboard.vercel.app";
const SEND_AS_EMAIL = "kevin@dynamicsportstraining.com"; // Kevin's own choice, not a shared/dedicated mailbox
const EXCLUDED_RECIPIENTS = ["test@test.com"]; // the dev/test login, not a real coach

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
// Same paginated-select pattern as api/sync-hawkin.js — Supabase silently caps an unpaginated
// select at 1000 rows.
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

// Every coach who has ever signed in, via the Supabase Admin API (service-role only) — no list to
// maintain by hand, a new coach's login just starts showing up here.
async function getRecipients(serviceKey) {
  const emails = [];
  let page = 1;
  for (;;) {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=200`, {
      headers: sbHeaders(serviceKey),
    });
    if (!res.ok) throw new Error(`Failed to list users: HTTP ${res.status} ${await res.text()}`);
    const body = await res.json();
    const users = body.users || [];
    users.forEach((u) => { if (u.email) emails.push(u.email); });
    if (users.length < 200) break;
    page++;
  }
  const excluded = new Set(EXCLUDED_RECIPIENTS.map((e) => e.toLowerCase()));
  return [...new Set(emails)].filter((e) => !excluded.has(e.toLowerCase()));
}

// ---- roster-row indicators, ported from the client (index.html / periodization.js) ------------
const N_TO_LBF = 4.44822;
const WEEK_METRICS = [
  { abbrev: "BW", getValue: (t) => (typeof t.systemWeight === "number" ? t.systemWeight / N_TO_LBF : null) },
  { abbrev: "JH", getValue: (t) => (typeof t.jumpHeight === "number" ? t.jumpHeight : null) },
  { abbrev: "RPP", getValue: (t) => (typeof t.relativePeakPower === "number" ? t.relativePeakPower : null) },
];
const WEEK_MIN_GAP_DAYS = 4;
const WEEK_MAX_GAP_DAYS = 10;
const WEEK_MAX_RECENCY_DAYS = 10;

function weekOverWeekDelta(tests, metric) {
  const withValue = tests
    .map((t) => ({ t, v: metric.getValue(t) }))
    .filter((r) => typeof r.v === "number")
    .sort((a, b) => (a.t.date || "").localeCompare(b.t.date || ""));
  if (!withValue.length) return null;
  const latest = withValue[withValue.length - 1];
  const latestMs = new Date(`${latest.t.date}T00:00:00`).getTime();
  if ((Date.now() - latestMs) / 864e5 > WEEK_MAX_RECENCY_DAYS) return null;
  let prev = null;
  for (let i = withValue.length - 2; i >= 0; i--) {
    const daysBack = (latestMs - new Date(`${withValue[i].t.date}T00:00:00`).getTime()) / 864e5;
    if (daysBack > WEEK_MAX_GAP_DAYS) break;
    if (daysBack >= WEEK_MIN_GAP_DAYS) { prev = withValue[i]; break; }
  }
  if (!prev || !prev.v) return null;
  return { abbrev: metric.abbrev, delta: latest.v - prev.v };
}

function parseISO(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function planProgress(plan, today) {
  const start = parseISO(plan.startDate);
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const days = Math.round((t0 - start) / 864e5);
  const totalDays = plan.weeks * 7;
  if (days < 0) return { state: "upcoming", week: 0 };
  if (days >= totalDays) return { state: "complete", week: plan.weeks };
  return { state: "active", week: Math.floor(days / 7) + 1 };
}
function programStatus(plan, today) {
  if (!plan) return { tone: "neutral", label: "No Program" };
  const progress = planProgress(plan, today);
  if (progress.state === "upcoming") return { tone: "neutral", label: "Upcoming" };
  if (progress.state === "complete") return { tone: "neutral", label: "Complete" };
  const wk = progress.week - 1;
  const endedLastWeek = (plan.blocks || []).some(
    (b) => b.start + b.len - 1 === wk - 1 && !(plan.blocks || []).some((o) => o.lane === b.lane && o.start <= wk && wk < o.start + o.len)
  );
  if (endedLastWeek) return { tone: "danger", label: "Program gap" };
  const endsThisWeek = (plan.blocks || []).some((b) => b.start + b.len - 1 === wk);
  if (endsThisWeek) return { tone: "warn", label: "Ending this week" };
  return { tone: "good", label: "On track" };
}
function assessmentStatus(assessments, today) {
  if (!assessments.length) return { tone: "danger", label: "Due for Assessment" };
  const latest = [...assessments].sort((a, b) => (a.date || "").localeCompare(b.date || ""))[assessments.length - 1];
  const daysSince = Math.floor((today.getTime() - new Date(`${latest.date}T00:00:00`).getTime()) / 864e5);
  if (daysSince >= 30) return { tone: "warn", label: `Due (${daysSince}d)` };
  return null;
}

// ---- HTML email -----------------------------------------------------------------------------
const TONE_COLORS = { good: "#16a34a", warn: "#d97706", danger: "#dc2626", neutral: "#6b7280" };

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function initialsOf(name) {
  return (name || "").split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
}
function badgeHtml(tone, label) {
  const color = TONE_COLORS[tone] || TONE_COLORS.neutral;
  return `<span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;color:#fff;background:${color};white-space:nowrap;">${escapeHtml(label)}</span>`;
}
function tickerHtml(entries) {
  if (!entries.length) return '<span style="color:#9a9a9a;font-size:12px;">&mdash;</span>';
  return entries
    .map((e) => {
      const flat = Math.abs(e.delta) < 0.05;
      const color = flat ? "#9a9a9a" : e.delta > 0 ? TONE_COLORS.good : TONE_COLORS.danger;
      const arrow = flat ? "&#9644;" : e.delta > 0 ? "&#9650;" : "&#9660;";
      return `<span style="color:${color};font-size:11px;font-family:monospace;white-space:nowrap;">${e.abbrev} ${arrow}${Math.abs(e.delta).toFixed(2)}</span>`;
    })
    .join('<br>');
}

function buildDigestHtml({ locations, today }) {
  const dateLabel = today.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const sections = locations
    .map(({ location, athletes }) => {
      const rows = athletes
        .map((a) => {
          const photo = a.photoUrl
            ? `<img src="${escapeHtml(a.photoUrl)}" width="40" height="40" style="border-radius:50%;object-fit:cover;display:block;" alt="">`
            : `<div style="width:40px;height:40px;border-radius:50%;background:#2a2a2a;color:#9a9a9a;font-size:13px;font-weight:600;text-align:center;line-height:40px;">${escapeHtml(initialsOf(a.name))}</div>`;
          return `
            <tr>
              <td style="padding:8px 10px;border-bottom:1px solid #2a2a2a;">${photo}</td>
              <td style="padding:8px 10px;border-bottom:1px solid #2a2a2a;color:#fff;font-size:13px;font-family:Arial,sans-serif;white-space:nowrap;">${escapeHtml(a.name)}</td>
              <td style="padding:8px 10px;border-bottom:1px solid #2a2a2a;">${tickerHtml(a.ticker)}</td>
              <td style="padding:8px 10px;border-bottom:1px solid #2a2a2a;">${badgeHtml(a.program.tone, a.program.label)}</td>
              <td style="padding:8px 10px;border-bottom:1px solid #2a2a2a;">${a.assessment ? badgeHtml(a.assessment.tone, a.assessment.label) : ""}</td>
            </tr>`;
        })
        .join("");
      return `
        <tr><td colspan="5" style="padding:18px 10px 6px;color:#fff;font-size:15px;font-weight:700;font-family:Arial,sans-serif;">${escapeHtml(location)} <span style="color:#9a9a9a;font-weight:400;font-size:12px;">(${athletes.length})</span></td></tr>
        ${rows}`;
    })
    .join("");

  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#0d0d0d;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0d0d0d;padding:20px 0;">
    <tr><td align="center">
      <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="background:#151515;border-radius:10px;overflow:hidden;">
        <tr><td style="padding:20px 24px;border-bottom:2px solid #b5283a;">
          <div style="color:#fff;font-size:18px;font-weight:700;font-family:Arial,sans-serif;">Weekly Pro Baseball Snapshot</div>
          <div style="color:#9a9a9a;font-size:12px;font-family:Arial,sans-serif;margin-top:2px;">${dateLabel} &middot; Dynamic Sports Training</div>
        </td></tr>
        <tr><td style="padding:0 14px 20px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${sections}
          </table>
        </td></tr>
        <tr><td style="padding:14px 24px;border-top:1px solid #2a2a2a;color:#6b6b6b;font-size:11px;font-family:Arial,sans-serif;">
          <a href="${APP_BASE_URL}" style="color:#9a9a9a;">Open the dashboard</a> for full detail on any athlete.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ---- Gmail send (domain-wide delegation — see api/send-athlete-email.js for the same setup) ---
function buildRawHtmlEmail({ from, to, subject, html }) {
  const encodeHeader = (s) => `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`;
  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="UTF-8"',
    "",
    html,
  ];
  return Buffer.from(lines.join("\r\n"), "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function sendDigestEmail({ to, subject, html }) {
  const { google } = require("googleapis");
  const creds = JSON.parse(requireEnv("GMAIL_SERVICE_ACCOUNT_JSON"));
  const jwtClient = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/gmail.send"],
    subject: SEND_AS_EMAIL,
  });
  const gmail = google.gmail({ version: "v1", auth: jwtClient });
  const raw = buildRawHtmlEmail({ from: SEND_AS_EMAIL, to, subject, html });
  await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
}

// ---- coach auth (for manual ?force=1 testing — see api/sync-hawkin.js for the identical pattern)
async function isSignedInCoach(bearerToken) {
  if (!bearerToken) return false;
  try {
    const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF2Z2Z4d2h4Z2xmdGZ0bWx5ZGl6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAxMTc3NzcsImV4cCI6MjEwNTY5Mzc3N30.-g6HIvyDfsCIiVt4fIhswKqhLNMY8jqSDFbAN2pOHYs";
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
  // Being a signed-in coach only grants access to call this at all (for testing) — it must NOT by
  // itself skip the schedule/date/already-sent checks below, or every plain status-check request
  // becomes a real send. Only an explicit ?force=1 does that.
  const force = !!(req.query && req.query.force === "1");

  try {
    const now = new Date();
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago", hour: "numeric", hour12: false, weekday: "short", month: "numeric", day: "numeric", year: "numeric",
    }).formatToParts(now);
    const get = (type) => parts.find((p) => p.type === type).value;
    const hour = Number(get("hour"));
    const weekday = get("weekday");
    const month = Number(get("month"));
    const day = Number(get("day"));
    const chicagoToday = new Date(Number(get("year")), month - 1, day);

    const inSeasonWindow = month >= 9 || month <= 2 || (month === 3 && day === 1);
    const isSunday = weekday === "Sun";
    const isElevenAm = hour === 11;

    if (!force && (!isSunday || !isElevenAm || !inSeasonWindow)) {
      res.status(200).json({ ok: true, skipped: true, reason: "not the scheduled send time", weekday, hour, month, day });
      return;
    }

    const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
    const dateKey = chicagoToday.toISOString().slice(0, 10);

    if (!force) {
      const marker = await sbSelect(serviceKey, "app_meta", "key=eq.lastWeeklyRosterEmailDate&select=value");
      if (marker.length && marker[0].value === dateKey) {
        res.status(200).json({ ok: true, skipped: true, reason: "already sent today" });
        return;
      }
    }

    const [athleteRows, forceTestRows, periodRows, assessRows] = await Promise.all([
      sbSelect(serviceKey, "athletes", "select=id,data"),
      sbSelect(serviceKey, "force_tests", "select=athlete_id,data"),
      sbSelect(serviceKey, "periodization", "select=athlete_id,data"),
      sbSelect(serviceKey, "assessments", "select=athlete_id,data"),
    ]);

    const activeAthletes = athleteRows
      .map((r) => r.data)
      .filter((a) => a && (a.status || "active").toLowerCase() === "active");

    const testsByAthlete = new Map();
    forceTestRows.forEach((r) => {
      const list = testsByAthlete.get(r.athlete_id) || [];
      list.push(r.data);
      testsByAthlete.set(r.athlete_id, list);
    });
    const planByAthlete = new Map(periodRows.map((r) => [r.athlete_id, r.data]));
    const assessByAthlete = new Map();
    assessRows.forEach((r) => {
      const list = assessByAthlete.get(r.athlete_id) || [];
      list.push(r.data);
      assessByAthlete.set(r.athlete_id, list);
    });

    const enriched = activeAthletes.map((a) => {
      const key = String(a.id);
      const tests = testsByAthlete.get(key) || [];
      return {
        name: a.name,
        photoUrl: a.photoUrl || "",
        dstLocation: a.dstLocation || "No Location Set",
        ticker: WEEK_METRICS.map((m) => weekOverWeekDelta(tests, m)).filter(Boolean),
        program: programStatus(planByAthlete.get(key) || null, chicagoToday),
        assessment: assessmentStatus(assessByAthlete.get(key) || [], chicagoToday),
      };
    });

    const lastNameOnly = (n) => (n || "").trim().split(/\s+/).slice(-1)[0] || "";
    const byLocation = new Map();
    enriched.forEach((a) => {
      const list = byLocation.get(a.dstLocation) || [];
      list.push(a);
      byLocation.set(a.dstLocation, list);
    });
    const locations = [...byLocation.entries()]
      .sort(([a], [b]) => (a === "No Location Set" ? 1 : b === "No Location Set" ? -1 : a.localeCompare(b)))
      .map(([location, athletes]) => ({ location, athletes: athletes.sort((a, b) => lastNameOnly(a.name).localeCompare(lastNameOnly(b.name))) }));

    const html = buildDigestHtml({ locations, today: chicagoToday });
    const subject = `Weekly Pro Baseball Snapshot — ${chicagoToday.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
    const recipients = await getRecipients(serviceKey);

    if (!recipients.length) {
      res.status(200).json({ ok: true, sent: 0, reason: "no recipients found" });
      return;
    }

    await sendDigestEmail({ to: recipients.join(", "), subject, html });
    await sbUpsert(serviceKey, "email_log", [{ sent_by: "system", to_email: recipients.join(", "), subject, kind: "weekly_digest" }]);
    if (!force) await sbUpsert(serviceKey, "app_meta", [{ key: "lastWeeklyRosterEmailDate", value: dateKey }]);

    res.status(200).json({ ok: true, sent: recipients.length, recipients, athletes: enriched.length, locations: locations.map((l) => l.location) });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
};
