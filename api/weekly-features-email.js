// Weekly "What's new" email: every Monday around 9am Central, all year, every coach who has a dashboard login
// gets the new additions to the phone app, the program builder, Coach Mode and the dashboard from the past seven
// days, grouped by area. The additions are written by hand in whats_new.js (newest first); a week with none sends
// nothing. Like api/weekly-roster-email.js: TWO cron entries in vercel.json (14:00 and 15:00 UTC Mondays), one
// for each side of the Central-time DST change, and only the one that lands on 9am Chicago time sends; an app_meta
// marker (lastWeeklyFeaturesEmailDate) keeps it to one send a week. Sent from Kevin's Gmail, as the digest is.
//
// A signed-in coach can call it by hand: ?preview=1 returns the email's HTML without sending (?days=N looks back
// N days instead of 7), and ?force=1 sends now whatever the day.

const SUPABASE_URL = "https://avgfxwhxglftftmlydiz.supabase.co";
const APP_BASE_URL = "https://probaseballdashboard.vercel.app";
const SEND_AS_EMAIL = "kevin@dynamicsportstraining.com";
const EXCLUDED_RECIPIENTS = ["test@test.com"]; // the dev/test login, not a real coach
const { WHATS_NEW, AREAS } = require("../whats_new.js");

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}
function sbHeaders(serviceKey, extra) {
  return { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json", ...extra };
}
async function sbSelect(serviceKey, table, query) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { headers: sbHeaders(serviceKey) });
  if (!res.ok) throw new Error(`Supabase select ${table} failed: HTTP ${res.status} ${await res.text()}`);
  return (await res.json()) || [];
}
async function sbUpsert(serviceKey, table, rows) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: sbHeaders(serviceKey, { Prefer: "resolution=merge-duplicates,return=minimal" }),
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`Supabase upsert ${table} failed: HTTP ${res.status} ${await res.text()}`);
}
// every login (the coaches; athletes use their phone links, not logins), less the excluded ones
async function getRecipients(serviceKey) {
  const users = [];
  for (let page = 1; ; page++) {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=200`, { headers: sbHeaders(serviceKey) });
    if (!res.ok) throw new Error(`Failed to list users: HTTP ${res.status} ${await res.text()}`);
    const list = (await res.json()).users || [];
    list.forEach((u) => { if (u.email) users.push(u.email); });
    if (list.length < 200) break;
  }
  const excluded = new Set(EXCLUDED_RECIPIENTS.map((e) => e.toLowerCase()));
  return [...new Set(users.map((e) => e.toLowerCase()))].filter((e) => !excluded.has(e));
}

// ---- the email -------------------------------------------------------------------------------------------
const AREA_ICON = { "Phone app": "📱", "Program builder": "🏋️", "Coach Mode": "📋", Dashboard: "🖥️" };
function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
// the additions from the `days` days up to and including `today` (YYYY-MM-DD), grouped in AREAS order
function entriesFor(today, days) {
  const end = new Date(`${today}T12:00:00Z`), start = new Date(end.getTime() - (days - 1) * 864e5);
  const iso = (d) => d.toISOString().slice(0, 10);
  const list = WHATS_NEW.filter((e) => e.date >= iso(start) && e.date <= today);
  const areas = [...AREAS, ...[...new Set(list.map((e) => e.area))].filter((a) => !AREAS.includes(a))];
  return areas.map((area) => ({ area, items: list.filter((e) => e.area === area) })).filter((g) => g.items.length);
}
function buildHtml({ groups, rangeText }) {
  const count = groups.reduce((n, g) => n + g.items.length, 0);
  const sections = groups.map((g) => `
      <tr><td style="padding:22px 28px 6px;">
        <div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#a52a34;">${AREA_ICON[g.area] || "•"}&nbsp; ${escapeHtml(g.area)}</div>
      </td></tr>
      ${g.items.map((e) => `
      <tr><td style="padding:8px 28px;">
        <div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;color:#1a1a1a;">${escapeHtml(e.title)}</div>
        <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#444;margin-top:3px;">${escapeHtml(e.detail)}</div>
      </td></tr>`).join("")}`).join("");
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f2f2f2;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f2f2;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:10px;overflow:hidden;">
        <tr><td style="background:#1a1a1a;padding:22px 28px;border-bottom:4px solid #a52a34;">
          <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#d9d9d9;">Dynamic Sports Training · Pro Baseball Dashboard</div>
          <div style="font-family:Arial,Helvetica,sans-serif;font-size:24px;font-weight:800;color:#ffffff;margin-top:6px;">What's new this week</div>
          <div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#bdbdbd;margin-top:4px;">${escapeHtml(rangeText)} · ${count} addition${count === 1 ? "" : "s"}</div>
        </td></tr>
        ${sections}
        <tr><td style="padding:24px 28px 28px;">
          <a href="${APP_BASE_URL}" style="display:inline-block;background:#a52a34;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;text-decoration:none;padding:11px 20px;border-radius:7px;">Open the dashboard</a>
          <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#888;margin-top:16px;">Questions or ideas for what's next? Reply to this email.</div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

// ---- Gmail send (the same domain-wide delegation as api/weekly-roster-email.js) -------------------------
function buildRawHtmlEmail({ from, to, bcc, subject, html }) {
  const encodeHeader = (s) => `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`;
  const lines = [`From: ${from}`, `To: ${to}`, bcc ? `Bcc: ${bcc}` : null, `Subject: ${encodeHeader(subject)}`, "MIME-Version: 1.0", 'Content-Type: text/html; charset="UTF-8"', "", html].filter((l) => l !== null);
  return Buffer.from(lines.join("\r\n"), "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function sendEmail({ to, bcc, subject, html }) {
  const { google } = require("googleapis");
  const creds = JSON.parse(requireEnv("GMAIL_SERVICE_ACCOUNT_JSON"));
  const jwtClient = new google.auth.JWT({ email: creds.client_email, key: creds.private_key, scopes: ["https://www.googleapis.com/auth/gmail.send"], subject: SEND_AS_EMAIL });
  const gmail = google.gmail({ version: "v1", auth: jwtClient });
  await gmail.users.messages.send({ userId: "me", requestBody: { raw: buildRawHtmlEmail({ from: SEND_AS_EMAIL, to, bcc, subject, html }) } });
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

module.exports = async (req, res) => {
  const auth = req.headers.authorization || "";
  const isCron = auth === `Bearer ${process.env.CRON_SECRET}`;
  const isManual = !isCron && (await isSignedInCoach(auth.replace(/^Bearer\s+/i, "")));
  if (!isCron && !isManual) { res.status(401).json({ error: "unauthorized" }); return; }
  const q = req.query || {};
  const preview = isManual && q.preview === "1";
  const force = isManual && q.force === "1"; // only a signed-in coach's explicit ?force=1 skips the schedule

  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", hour12: false, weekday: "short", month: "2-digit", day: "2-digit", year: "numeric" }).formatToParts(new Date());
    const get = (type) => parts.find((p) => p.type === type).value;
    const today = `${get("year")}-${get("month")}-${get("day")}`;
    if (!preview && !force && (get("weekday") !== "Mon" || Number(get("hour")) !== 9)) {
      res.status(200).json({ ok: true, skipped: true, reason: "not the scheduled send time", weekday: get("weekday"), hour: Number(get("hour")) });
      return;
    }

    const days = Math.max(1, Math.min(60, Number(q.days) || 7));
    const groups = entriesFor(today, days);
    const first = new Date(new Date(`${today}T12:00:00Z`).getTime() - (days - 1) * 864e5);
    const fmt = (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    const rangeText = `${fmt(first)} – ${fmt(new Date(`${today}T12:00:00Z`))}`;
    const html = buildHtml({ groups, rangeText });
    if (preview) { res.setHeader("Content-Type", "text/html; charset=utf-8"); res.status(200).send(html); return; }
    if (!groups.length) { res.status(200).json({ ok: true, sent: 0, reason: "nothing new in the past week" }); return; }

    const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
    if (!force) {
      const marker = await sbSelect(serviceKey, "app_meta", "key=eq.lastWeeklyFeaturesEmailDate&select=value");
      if (marker.length && marker[0].value === today) { res.status(200).json({ ok: true, skipped: true, reason: "already sent today" }); return; }
    }
    const recipients = await getRecipients(serviceKey);
    if (!recipients.length) { res.status(200).json({ ok: true, sent: 0, reason: "no recipients found" }); return; }
    const subject = `What's new in the Pro Baseball Dashboard — ${rangeText}`;
    // one email, the coaches in Bcc, so no one sees everyone's address
    await sendEmail({ to: SEND_AS_EMAIL, bcc: recipients.filter((e) => e !== SEND_AS_EMAIL).join(", "), subject, html });
    await sbUpsert(serviceKey, "email_log", [{ sent_by: "system", to_email: recipients.join(", "), subject, kind: "weekly_features" }]);
    if (!force) await sbUpsert(serviceKey, "app_meta", [{ key: "lastWeeklyFeaturesEmailDate", value: today }]);
    res.status(200).json({ ok: true, sent: recipients.length, additions: groups.reduce((n, g) => n + g.items.length, 0) });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
};
