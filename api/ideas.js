// Ideas box: athletes (from their phone app, athlete.html) and coaches (the dashboard's Ideas page, or their own
// phone app) send ideas for making the dashboard and the app better. Each one is kept in app_meta (key "ideas",
// newest last) and emailed to Kevin. Coaches see every idea on the dashboard's Ideas page; Kevin marks each one
// New, Planned, Done or Not now.
//
// Who sent it is never taken from the request: an athlete is the athlete behind their private link token (looked up
// with the service-role key), a coach the signed-in dashboard login (their Supabase session, checked with Supabase).
//
// POST { action: "add", token?, text, area }   (a coach: their session as the bearer token instead of a link token)
//   -> { ok: true }
// POST { action: "list" }                          signed-in coaches -> { ideas: [...], canEdit }
// POST { action: "status", id, status }            Kevin only        -> { ok: true }

const SUPABASE_URL = "https://avgfxwhxglftftmlydiz.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF2Z2Z4d2h4Z2xmdGZ0bWx5ZGl6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAxMTc3NzcsImV4cCI6MjEwNTY5Mzc3N30.-g6HIvyDfsCIiVt4fIhswKqhLNMY8jqSDFbAN2pOHYs";
const APP_BASE_URL = "https://probaseballdashboard.vercel.app";
const SEND_AS_EMAIL = "kevin@dynamicsportstraining.com";
const OWNERS = ["kevin@dynamicsportstraining.com"]; // who marks ideas Planned, Done or Not now
const META_KEY = "ideas";
const AREAS = ["Phone app", "Dashboard", "Program builder", "Coach Mode", "Other"];
const STATUSES = ["new", "planned", "done", "not now"];
const MAX_IDEAS = 2000;
const MAX_PER_DAY = 10; // from one sender

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}
const sbHeaders = (key, extra) => ({ apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...extra });
async function sbGet(key, table, query) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { headers: sbHeaders(key) });
  if (!res.ok) throw new Error(`Supabase select ${table} failed: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}
async function readIdeas(key) {
  const [row] = await sbGet(key, "app_meta", `key=eq.${META_KEY}&select=value`);
  return row && Array.isArray(row.value) ? row.value : [];
}
async function writeIdeas(key, list) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/app_meta?on_conflict=key`, {
    method: "POST",
    headers: sbHeaders(key, { Prefer: "resolution=merge-duplicates,return=minimal" }),
    body: JSON.stringify({ key: META_KEY, value: list.slice(-MAX_IDEAS) }),
  });
  if (!res.ok) throw new Error(`Saving the ideas failed: HTTP ${res.status} ${await res.text()}`);
}
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// the signed-in coach's email (verified with Supabase itself), or null
async function signedIn(bearer) {
  if (!bearer) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${bearer}` } });
    if (!res.ok) return null;
    const user = await res.json();
    return (user && user.email && user.email.toLowerCase()) || null;
  } catch (e) {
    return null;
  }
}

async function sendEmail({ to, subject, html }) {
  const { google } = require("googleapis");
  const creds = JSON.parse(requireEnv("GMAIL_SERVICE_ACCOUNT_JSON"));
  const jwtClient = new google.auth.JWT({ email: creds.client_email, key: creds.private_key, scopes: ["https://www.googleapis.com/auth/gmail.send"], subject: SEND_AS_EMAIL });
  const gmail = google.gmail({ version: "v1", auth: jwtClient });
  const encodeHeader = (s) => `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`;
  const lines = [`From: ${SEND_AS_EMAIL}`, `To: ${to}`, `Subject: ${encodeHeader(subject)}`, "MIME-Version: 1.0", 'Content-Type: text/html; charset="UTF-8"', "", html];
  const raw = Buffer.from(lines.join("\r\n"), "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
}

module.exports = async (req, res) => {
  if (req.method !== "POST") { res.status(405).json({ error: "method not allowed" }); return; }
  const body = req.body || {};
  const action = String(body.action || "");
  try {
    const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
    const coach = await signedIn(String(req.headers.authorization || "").replace(/^Bearer\s+/i, ""));

    if (action === "list") {
      if (!coach) { res.status(401).json({ error: "Sign in to see the ideas." }); return; }
      const ideas = await readIdeas(key);
      res.status(200).json({ ideas: ideas.slice().reverse(), canEdit: OWNERS.includes(coach) });
      return;
    }

    if (action === "status") {
      if (!coach || !OWNERS.includes(coach)) { res.status(403).json({ error: "Only Kevin can change an idea's status." }); return; }
      const status = String(body.status || "");
      if (!STATUSES.includes(status)) { res.status(400).json({ error: "bad status" }); return; }
      const ideas = await readIdeas(key);
      const idea = ideas.find((x) => x.id === String(body.id || ""));
      if (!idea) { res.status(404).json({ error: "no such idea" }); return; }
      idea.status = status;
      idea.statusAt = new Date().toISOString();
      await writeIdeas(key, ideas);
      res.status(200).json({ ok: true });
      return;
    }

    if (action !== "add") { res.status(400).json({ error: "bad request" }); return; }
    const text = String(body.text || "").trim().slice(0, 2000);
    if (text.length < 3) { res.status(400).json({ error: "Write a few words about your idea first." }); return; }
    const area = AREAS.includes(body.area) ? body.area : "Other";

    // who it's from: the signed-in coach, else the athlete behind the link
    let from = null;
    if (coach) {
      const [rec] = await sbGet(key, "athletes", `select=data&data->>rosterGroup=eq.coaches&data->>coachEmail=ilike.${encodeURIComponent(coach)}`);
      from = { kind: "coach", name: (rec && rec.data && rec.data.name) || coach, email: coach };
    } else {
      const token = String(body.token || "");
      if (!/^[0-9a-f]{32,128}$/.test(token)) { res.status(401).json({ error: "This link can't send ideas. Ask your coach for a new link." }); return; }
      const [link] = await sbGet(key, "athlete_links", `token=eq.${token}&select=athlete_id,name`);
      if (!link) { res.status(401).json({ error: "This link can't send ideas. Ask your coach for a new link." }); return; }
      const [row] = await sbGet(key, "athletes", `id=eq.${encodeURIComponent(link.athlete_id)}&select=data`);
      const data = (row && row.data) || {};
      from = { kind: data.rosterGroup === "coaches" ? "coach" : "athlete", name: data.name || link.name || "An athlete", athleteId: String(link.athlete_id) };
    }

    const ideas = await readIdeas(key);
    const who = (x) => (from.email ? x.from && x.from.email === from.email : x.from && x.from.athleteId === from.athleteId);
    const since = Date.now() - 864e5;
    if (ideas.filter((x) => who(x) && Date.parse(x.at) > since).length >= MAX_PER_DAY) { res.status(429).json({ error: `That's ${MAX_PER_DAY} ideas today. Thank you! Send more tomorrow.` }); return; }
    const idea = { id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, at: new Date().toISOString(), text, area, from, status: "new" };
    ideas.push(idea);
    await writeIdeas(key, ideas);

    const html = [
      `<div style="font-family:Arial,sans-serif;font-size:14px;color:#111;line-height:1.5">`,
      `<p><strong>${esc(from.name)}</strong> (${from.kind}) sent an idea for the <strong>${esc(area)}</strong>:</p>`,
      `<p style="margin:10px 0;padding:10px 12px;background:#f4f4f4;border-left:3px solid #a52a34;white-space:pre-wrap">${esc(text)}</p>`,
      `<p>Every idea is on the <a href="${APP_BASE_URL}">dashboard</a> under <strong>Ideas</strong> in the top bar, where you can mark it Planned, Done or Not now.</p>`,
      `</div>`,
    ].join("");
    try { await sendEmail({ to: SEND_AS_EMAIL, subject: `Idea from ${from.name}: ${text.slice(0, 60)}${text.length > 60 ? "…" : ""}`, html }); }
    catch (e) { console.error("idea email failed:", e.message || e); } // it's saved on the Ideas page either way
    res.status(200).json({ ok: true });
  } catch (e) {
    console.error("ideas failed:", e.message || e);
    res.status(500).json({ error: "Couldn't send that. Check your connection and try again." });
  }
};
