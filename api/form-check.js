// Form checks — a remote athlete films a set on their phone page (athlete.html) and sends it to the coach who
// assigned the program (see supabase/migration_017_form_checks.sql).
//
//   POST { action: "start", token, ext }   checks the athlete's private link token and hands back a one-time
//        signed upload link for a new file under their own folder of the private "form-checks" bucket. The phone
//        uploads the clip straight to storage with it (a video is too big to pass through here).
//   POST { action: "done", token, path, programId, exerciseId, exercise, program, week, day, note }
//        once the upload is finished: records the clip in form_checks and emails the coach who assigned the
//        program (else whoever wrote it, else the dashboard's own sender) a link to watch and reply.
//   GET  (the daily cron, with CRON_SECRET)  removes clips and records more than a week old. The same clean-up
//        also runs whenever a clip is sent.
//
// The phone is not signed in, so nothing in a request is trusted except the token, which is looked up here with
// the service-role key. Only athletes who train remotely can send clips, and at most DAILY_LIMIT a day.

const SUPABASE_URL = "https://avgfxwhxglftftmlydiz.supabase.co";
const APP_BASE_URL = "https://probaseballdashboard.vercel.app";
const SEND_AS_EMAIL = "kevin@dynamicsportstraining.com"; // same sender as the other emails
const EXCLUDED_RECIPIENTS = ["test@test.com"]; // the dev/test login, not a real coach
const REMOTE_LOCATION = "DST Remote Training";
const BUCKET = "form-checks";
const KEEP_DAYS = 7;
const DAILY_LIMIT = 15;

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
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const emailRe = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const clip = (s, n) => String(s == null ? "" : s).slice(0, n);
const objectPath = (path) => path.split("/").map(encodeURIComponent).join("/");

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

// the athlete behind a token, or null; only remote athletes can send clips
async function athleteFor(key, token) {
  if (!/^[0-9a-f]{32,128}$/.test(token)) return null;
  const [link] = await sbGet(key, "athlete_links", `token=eq.${token}&select=athlete_id,name`);
  if (!link) return null;
  const [row] = await sbGet(key, "athletes", `id=eq.${encodeURIComponent(link.athlete_id)}&select=data`);
  const data = (row && row.data) || {};
  return { id: String(link.athlete_id), name: data.name || link.name || "An athlete", remote: data.dstLocation === REMOTE_LOCATION };
}

// clips and records older than KEEP_DAYS
async function cleanUp(key) {
  const cutoff = new Date(Date.now() - KEEP_DAYS * 864e5).toISOString();
  const old = await sbGet(key, "form_checks", `created_at=lt.${encodeURIComponent(cutoff)}&select=id,path:data->>path&limit=500`);
  if (!old.length) return 0;
  const paths = old.map((r) => r.path).filter(Boolean);
  if (paths.length) {
    await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}`, { method: "DELETE", headers: sbHeaders(key), body: JSON.stringify({ prefixes: paths }) });
  }
  await fetch(`${SUPABASE_URL}/rest/v1/form_checks?id=in.(${old.map((r) => `"${encodeURIComponent(r.id)}"`).join(",")})`, { method: "DELETE", headers: sbHeaders(key, { Prefer: "return=minimal" }) });
  return old.length;
}

async function start(key, body, res) {
  const who = await athleteFor(key, String(body.token || ""));
  if (!who || !who.remote) { res.status(403).json({ error: "Only athletes who train remotely can send form checks." }); return; }
  const since = new Date(Date.now() - 864e5).toISOString();
  const recent = await sbGet(key, "form_checks", `athlete_id=eq.${encodeURIComponent(who.id)}&created_at=gt.${encodeURIComponent(since)}&select=id`);
  if (recent.length >= DAILY_LIMIT) { res.status(429).json({ error: `That's ${DAILY_LIMIT} clips today. Try again tomorrow.` }); return; }
  const ext = /^(mp4|mov|m4v|webm|3gp)$/i.test(String(body.ext || "")) ? String(body.ext).toLowerCase() : "mp4";
  const path = `${who.id}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
  const sign = await fetch(`${SUPABASE_URL}/storage/v1/object/upload/sign/${BUCKET}/${objectPath(path)}`, { method: "POST", headers: sbHeaders(key), body: "{}" });
  if (!sign.ok) throw new Error(`could not sign the upload: HTTP ${sign.status} ${await sign.text()}`);
  const { url } = await sign.json();
  const uploadToken = new URL(url, SUPABASE_URL).searchParams.get("token");
  if (!uploadToken) throw new Error("no upload token in the signed link");
  res.status(200).json({ ok: true, path, uploadToken });
}

async function done(key, body, res) {
  const who = await athleteFor(key, String(body.token || ""));
  if (!who || !who.remote) { res.status(403).json({ error: "Only athletes who train remotely can send form checks." }); return; }
  const path = String(body.path || "");
  if (!path.startsWith(`${who.id}/`) || path.includes("..")) { res.status(400).json({ error: "bad request" }); return; }
  // the clip has to be there before it is recorded
  const name = path.slice(who.id.length + 1);
  const list = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${BUCKET}`, { method: "POST", headers: sbHeaders(key), body: JSON.stringify({ prefix: who.id, search: name, limit: 5 }) });
  const files = list.ok ? await list.json() : [];
  if (!Array.isArray(files) || !files.some((f) => f.name === name)) { res.status(400).json({ error: "The video didn't finish uploading. Try again." }); return; }

  const programId = clip(body.programId, 100);
  const [[planRow], [program]] = await Promise.all([
    sbGet(key, "periodization", `athlete_id=eq.${encodeURIComponent(who.id)}&select=data`),
    programId ? sbGet(key, "programs", `id=eq.${encodeURIComponent(programId)}&select=data`) : Promise.resolve([]),
  ]);
  const blocks = (((planRow && planRow.data) || {}).blocks || []).filter((b) => b && String(b.programId) === programId);
  const assigners = blocks.map((b) => b.assignedBy).filter(Boolean);
  const coaches = [...new Set((assigners.length ? assigners : [program && program.data && program.data.createdBy]).filter((e) => e && emailRe.test(e) && !EXCLUDED_RECIPIENTS.includes(e)))];
  const to = coaches.length ? coaches : [SEND_AS_EMAIL];

  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const data = {
    path, athleteName: who.name,
    programId, exerciseId: clip(body.exerciseId, 100), exercise: clip(body.exercise, 120) || "An exercise",
    program: clip(body.program, 120) || (program && program.data && program.data.name) || "",
    week: clip(body.week, 60), day: clip(body.day, 60), note: clip(body.note, 600).trim(),
    coach: to.join(", "), reviewed: false,
  };
  const ins = await fetch(`${SUPABASE_URL}/rest/v1/form_checks`, { method: "POST", headers: sbHeaders(key, { Prefer: "return=minimal" }), body: JSON.stringify({ id, athlete_id: who.id, data }) });
  if (!ins.ok) throw new Error(`could not record the form check: HTTP ${ins.status} ${await ins.text()}`);

  const where = [data.program, data.week, data.day].filter(Boolean).join(" · ");
  const html = [
    `<div style="font-family:Arial,sans-serif;font-size:14px;color:#111;line-height:1.5">`,
    `<p><strong>${esc(who.name)}</strong> sent a form check: <strong>${esc(data.exercise)}</strong>${where ? ` <span style="color:#666">(${esc(where)})</span>` : ""}.</p>`,
    data.note ? `<p style="margin:10px 0;padding:10px 12px;background:#f4f4f4;border-left:3px solid #a52a34">${esc(data.note)}</p>` : "",
    `<p><a href="${APP_BASE_URL}/?formcheck=${encodeURIComponent(id)}" style="display:inline-block;padding:10px 16px;background:#a52a34;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold">Watch and reply</a></p>`,
    `<p style="color:#666;font-size:12px">Your reply shows under that exercise on ${esc(who.name)}'s phone. The clip is deleted after ${KEEP_DAYS} days.</p>`,
    `</div>`,
  ].join("");
  try {
    for (const coach of to) await sendEmail({ to: coach, subject: `Form check: ${who.name} · ${data.exercise}`, html });
  } catch (e) {
    console.error("form-check email failed:", e.message || e); // the check is saved and shows on the dashboard's Today panel either way
  }
  try { await cleanUp(key); } catch (e) { console.error("form-check clean-up failed:", e.message || e); }
  res.status(200).json({ ok: true, id });
}

module.exports = async (req, res) => {
  try {
    const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
    if (req.method === "GET") {
      if ((req.headers.authorization || "") !== `Bearer ${process.env.CRON_SECRET}`) { res.status(401).json({ error: "unauthorized" }); return; }
      res.status(200).json({ ok: true, removed: await cleanUp(key) });
      return;
    }
    if (req.method !== "POST") { res.status(405).json({ error: "method not allowed" }); return; }
    const body = req.body || {};
    if (body.action === "start") await start(key, body, res);
    else if (body.action === "done") await done(key, body, res);
    else res.status(400).json({ error: "bad request" });
  } catch (e) {
    console.error("form-check failed:", e.message || e);
    res.status(500).json({ error: "Could not send the video. Check your connection and try again." });
  }
};
