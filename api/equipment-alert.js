// Equipment alert — called by the athlete phone page (athlete.html) right after a remote athlete saves their
// equipment survey. If any exercise in a program on their plan needs something they didn't tick, the coach who
// assigned that program gets an email listing those exercises. It only informs: nothing is blocked or changed.
//
// The caller is not signed in, so nothing in the request is trusted except the athlete's private link token,
// which is looked up here with the service-role key. Everything in the email comes from the database, and an
// athlete can trigger at most one email every ten minutes.
//
// The flagging itself is the same code the dashboard runs (EquipmentCheck in program_rx.js), loaded here with a
// stand-in for the browser's `window`.

const SUPABASE_URL = "https://avgfxwhxglftftmlydiz.supabase.co";
const APP_BASE_URL = "https://probaseballdashboard.vercel.app";
const SEND_AS_EMAIL = "kevin@dynamicsportstraining.com"; // same sender as the weekly roster email
const EXCLUDED_RECIPIENTS = ["test@test.com"]; // the dev/test login, not a real coach
const MIN_MINUTES_BETWEEN_ALERTS = 10;

global.window = global.window || {};
require("../program_rx.js");
const EC = global.window.EquipmentCheck;
const applyOverrides = global.window.applyOverrides;

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}
const sbHeaders = (key, extra) => ({ apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...extra });
// one page of rows; `query` is a PostgREST query string
async function sbGet(key, table, query, offset = 0) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { headers: sbHeaders(key, { Range: `${offset}-${offset + 999}` }) });
  if (!res.ok && res.status !== 206) throw new Error(`Supabase select ${table} failed: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}
// every row, a thousand at a time (Supabase caps an unpaginated select at 1000 rows)
async function sbGetAll(key, table, query) {
  const all = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await sbGet(key, table, query, offset);
    all.push(...page);
    if (page.length < 1000) return all;
  }
}
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const emailRe = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

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
  const token = String((req.body || {}).token || "");
  if (!/^[0-9a-f]{32,128}$/.test(token)) { res.status(400).json({ error: "bad request" }); return; }

  try {
    const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
    const [link] = await sbGet(key, "athlete_links", `token=eq.${token}&select=athlete_id,name`);
    if (!link) { res.status(200).json({ ok: true, sent: 0, reason: "unknown link" }); return; } // says nothing about which links exist
    const id = encodeURIComponent(link.athlete_id);

    const [[athleteRow], [eq], [planRow]] = await Promise.all([
      sbGet(key, "athletes", `id=eq.${id}&select=data`),
      sbGet(key, "athlete_equipment", `athlete_id=eq.${id}&select=access,surveyed_at,alerted_at`),
      sbGet(key, "periodization", `athlete_id=eq.${id}&select=data`),
    ]);
    const athlete = (athleteRow && athleteRow.data) || {};
    const name = athlete.name || link.name || "An athlete";
    if (athlete.dstLocation !== EC.REMOTE_LOCATION) { res.status(200).json({ ok: true, sent: 0, reason: "not a remote athlete" }); return; }
    if (!eq || !Array.isArray(eq.access) || !eq.surveyed_at) { res.status(200).json({ ok: true, sent: 0, reason: "no survey" }); return; }
    if (eq.alerted_at && Date.now() - new Date(eq.alerted_at).getTime() < MIN_MINUTES_BETWEEN_ALERTS * 60000) {
      res.status(200).json({ ok: true, sent: 0, reason: "alerted recently" });
      return;
    }

    const blocks = (((planRow && planRow.data) || {}).blocks || []).filter((b) => b && b.programId);
    if (!blocks.length) { res.status(200).json({ ok: true, sent: 0, reason: "no program assigned" }); return; }
    const ids = [...new Set(blocks.map((b) => String(b.programId)))];
    const [programs, overrideRows, exercises] = await Promise.all([
      sbGet(key, "programs", `id=in.(${ids.map((x) => `"${encodeURIComponent(x)}"`).join(",")})&select=id,data`),
      sbGet(key, "athlete_overrides", `athlete_id=eq.${id}&select=program_id,exercise_id,data`),
      sbGetAll(key, "exercises", "select=name:data->>name,equipment:data->equipment"),
    ]);
    const library = new Map(exercises.filter((x) => x.name).map((x) => [x.name.trim().toLowerCase(), x]));
    const findExercise = (n) => library.get(String(n || "").trim().toLowerCase()) || null;
    const overrides = {};
    overrideRows.forEach((r) => { (overrides[r.program_id] = overrides[r.program_id] || {})[r.exercise_id] = r.data; });

    // per coach: the programs they assigned that have flagged exercises
    const byCoach = new Map();
    let flaggedTotal = 0;
    programs.forEach((p) => {
      const program = applyOverrides({ ...p.data, id: p.id }, overrides[p.id]); // as the athlete does it, with their own swaps
      const flagged = EC.flaggedIn(program, eq.access, findExercise);
      if (!flagged.length) return;
      flaggedTotal += flagged.length;
      const assigners = blocks.filter((b) => String(b.programId) === String(p.id)).map((b) => b.assignedBy).filter(Boolean);
      // who to tell: whoever assigned it, else whoever wrote the program, else the dashboard's own sender
      const to = [...new Set((assigners.length ? assigners : [p.data.createdBy]).filter((e) => e && emailRe.test(e) && !EXCLUDED_RECIPIENTS.includes(e)))];
      (to.length ? to : [SEND_AS_EMAIL]).forEach((coach) => {
        if (!byCoach.has(coach)) byCoach.set(coach, []);
        byCoach.get(coach).push({ program: p.data.name || "Untitled program", flagged });
      });
    });
    if (!flaggedTotal) { res.status(200).json({ ok: true, sent: 0, flagged: 0 }); return; }

    const sent = [];
    for (const [coach, list] of byCoach) {
      const count = list.reduce((n, x) => n + x.flagged.length, 0);
      const html = [
        `<div style="font-family:Arial,sans-serif;font-size:14px;color:#111;line-height:1.5">`,
        `<p><strong>${esc(name)}</strong> filled in their equipment list, and ${count} exercise${count === 1 ? "" : "s"} in a program you assigned need${count === 1 ? "s" : ""} equipment they did not tick.</p>`,
        ...list.map((x) => [
          `<p style="margin:14px 0 4px"><strong>${esc(x.program)}</strong></p>`,
          `<table cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-size:13px">`,
          `<tr><th align="left" style="border-bottom:2px solid #a52a34">Exercise</th><th align="left" style="border-bottom:2px solid #a52a34">Needs</th><th align="left" style="border-bottom:2px solid #a52a34">Used</th></tr>`,
          ...x.flagged.map((f) => `<tr><td style="border-bottom:1px solid #ddd">${esc(f.name)}</td><td style="border-bottom:1px solid #ddd">${esc(f.missing.map(EC.label).join(", "))}</td><td style="border-bottom:1px solid #ddd">${f.count} time${f.count === 1 ? "" : "s"}</td></tr>`),
          `</table>`,
        ].join("")),
        `<p style="margin-top:16px">Open ${esc(name)}'s Player Plan on the <a href="${APP_BASE_URL}">dashboard</a>. The Equipment check above the program builder lets you keep an exercise and add the equipment to their list, or change the exercise for the whole phase.</p>`,
        `<p style="color:#666;font-size:12px">Nothing was changed or blocked. ${esc(name)} can still see and do the program.</p>`,
        `</div>`,
      ].join("");
      await sendEmail({ to: coach, subject: `Equipment check: ${name} is missing equipment for ${count} exercise${count === 1 ? "" : "s"}`, html });
      sent.push(coach);
    }
    await fetch(`${SUPABASE_URL}/rest/v1/athlete_equipment?athlete_id=eq.${id}`, {
      method: "PATCH",
      headers: sbHeaders(key, { Prefer: "return=minimal" }),
      body: JSON.stringify({ alerted_at: new Date().toISOString() }),
    });
    res.status(200).json({ ok: true, sent: sent.length, flagged: flaggedTotal });
  } catch (e) {
    console.error("equipment-alert failed:", e.message || e);
    res.status(500).json({ error: "could not send the alert" });
  }
};
