// Reports (the dashboard's Reports tab): the standard one-page reports (reports_engine.js), sent by email on a
// schedule and opened from the email by a private link.
//
//   GET  ?t=<token>                  the report the link is for, built fresh, as a printable page. Links last 30 days.
//   GET  ?unsub=<token>              takes that recipient off the schedule the link came from.
//   GET  (Vercel Cron, CRON_SECRET)  sends every schedule due today (Central time). On Mondays it also emails Kevin the
//                                    reports that went to addresses outside DST over the week before.
//   POST (a signed-in coach, their Supabase session as the bearer token) { action, ... }:
//        list                          -> { schedules, log }
//        save { schedule }             -> { schedule }   (new when it has no id)
//        delete { id }                 -> { ok }
//        send { id }                   -> { sent }       send a schedule now, whatever its day
//        sendOnce { spec, recipients, note } -> { sent }
//
// A schedule: { id, name, kind: "group" | "individual", target (see reports_engine.js), weeks, freq: "daily" |
// "weekly" | "biweekly" | "monthly", dow (0 Sunday-6), dom (1-28), recipients: { me, coaches: [], emails: [],
// athletes }, note, paused, createdBy, createdAt, lastSent, unsubscribed: [] }. "athletes" sends each athlete on the
// report his own individual page. Schedules, links and the send log live in app_meta ("reportSchedules",
// "reportLinks", "reportLog"). Mail goes from Kevin's Gmail (domain-wide delegation, as the other emails do) with
// the coach who set it up as the reply-to, and names that coach in every email; addresses outside DST also get a
// link to stop them.

const crypto = require("crypto");
const Engine = require("../reports_engine.js");

const SUPABASE_URL = "https://avgfxwhxglftftmlydiz.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF2Z2Z4d2h4Z2xmdGZ0bWx5ZGl6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAxMTc3NzcsImV4cCI6MjEwNTY5Mzc3N30.-g6HIvyDfsCIiVt4fIhswKqhLNMY8jqSDFbAN2pOHYs";
const APP_BASE_URL = "https://probaseballdashboard.vercel.app";
const SEND_AS_EMAIL = "kevin@dynamicsportstraining.com";
const OWNER = "kevin@dynamicsportstraining.com";
const LINK_DAYS = 30;
const DST_DOMAIN = /@dynamicsportstraining\.com$/i;
const emailRe = /^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$/;

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}
const sbHeaders = (key, extra) => ({ apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...extra });
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// the engine's query(table, columns, filters), answered with the service-role key, every page of it
function queryWith(key) {
  return async (table, cols, filters) => {
    const q = [`select=${encodeURIComponent(cols)}`];
    (filters || []).forEach(([col, op, val]) => {
      if (op === "in") q.push(`${col}=in.(${val.map((v) => `"${encodeURIComponent(String(v))}"`).join(",")})`);
      else q.push(`${col}=${op}.${encodeURIComponent(String(val))}`);
    });
    const out = [];
    for (let from = 0; ; from += 1000) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${q.join("&")}`, { headers: sbHeaders(key, { Range: `${from}-${from + 999}`, "Range-Unit": "items" }) });
      if (!res.ok && res.status !== 206) throw new Error(`Supabase select ${table} failed: HTTP ${res.status} ${await res.text()}`);
      const rows = (await res.json()) || [];
      out.push(...rows);
      if (rows.length < 1000) break;
    }
    return out;
  };
}
async function meta(key, name, fallback) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/app_meta?key=eq.${name}&select=value`, { headers: sbHeaders(key) });
  if (!res.ok) throw new Error(`app_meta ${name}: HTTP ${res.status}`);
  const [row] = await res.json();
  return row && row.value != null ? row.value : fallback;
}
async function setMeta(key, name, value) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/app_meta?on_conflict=key`, { method: "POST", headers: sbHeaders(key, { Prefer: "resolution=merge-duplicates,return=minimal" }), body: JSON.stringify({ key: name, value }) });
  if (!res.ok) throw new Error(`saving app_meta ${name}: HTTP ${res.status} ${await res.text()}`);
}

async function signedIn(bearer) {
  if (!bearer) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${bearer}` } });
    if (!res.ok) return null;
    const u = await res.json();
    return (u && u.email && u.email.toLowerCase()) || null;
  } catch (e) { return null; }
}

async function sendEmail({ to, subject, html, replyTo }) {
  const { google } = require("googleapis");
  const creds = JSON.parse(requireEnv("GMAIL_SERVICE_ACCOUNT_JSON"));
  const jwt = new google.auth.JWT({ email: creds.client_email, key: creds.private_key, scopes: ["https://www.googleapis.com/auth/gmail.send"], subject: SEND_AS_EMAIL });
  const gmail = google.gmail({ version: "v1", auth: jwt });
  const enc = (s) => `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`;
  const lines = [`From: DST Reports <${SEND_AS_EMAIL}>`, `To: ${to}`, replyTo && replyTo !== SEND_AS_EMAIL ? `Reply-To: ${replyTo}` : null, `Subject: ${enc(subject)}`, "MIME-Version: 1.0", 'Content-Type: text/html; charset="UTF-8"', "", html].filter((l) => l !== null);
  const raw = Buffer.from(lines.join("\r\n"), "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
}

// today in Chicago: { day: "YYYY-MM-DD", dow: 0-6, dom }
function chicagoToday() {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }).formatToParts(new Date());
  const g = (t) => p.find((x) => x.type === t).value;
  return { day: `${g("year")}-${g("month")}-${g("day")}`, dow: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(g("weekday")), dom: Number(g("day")) };
}
const daysBetween = (a, b) => Math.round((new Date(`${b}T12:00:00Z`) - new Date(`${a}T12:00:00Z`)) / 864e5);
function isDue(s, t) {
  if (!s || s.paused) return false;
  const last = s.lastSent ? String(s.lastSent).slice(0, 10) : "";
  if (last === t.day) return false;
  if (s.freq === "daily") return true;
  if (s.freq === "weekly") return Number(s.dow) === t.dow;
  if (s.freq === "biweekly") return Number(s.dow) === t.dow && (!last || daysBetween(last, t.day) >= 13);
  if (s.freq === "monthly") return Number(s.dom || 1) === t.dom;
  return false;
}
const describe = (s) => (s.freq === "daily" ? "daily" : s.freq === "weekly" ? `every ${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][s.dow] || ""}` : s.freq === "biweekly" ? `every other ${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][s.dow] || ""}` : `monthly on the ${s.dom || 1}`);

// one report to one address: a link of its own (so a stop request is that address's alone), the summary email
async function deliver(key, ctx, { built, spec, to, sched, setBy, note, athleteEmail }) {
  const token = crypto.randomBytes(24).toString("hex");
  const now = Date.now();
  ctx.links[token] = { spec, schedId: sched ? sched.id : null, to, created: new Date(now).toISOString(), exp: new Date(now + LINK_DAYS * 864e5).toISOString() };
  const outside = !DST_DOMAIN.test(to) && (!athleteEmail || athleteEmail.toLowerCase() !== to.toLowerCase());
  const html = Engine.emailSummary({ kind: built.kind, data: built.data, link: `${APP_BASE_URL}/api/reports?t=${token}`, setBy, note, unsubscribe: sched && outside ? `${APP_BASE_URL}/api/reports?unsub=${token}` : null });
  const title = built.kind === "individual" ? built.data.athlete.name : built.data.title;
  const subject = `${sched && sched.name ? `${sched.name}: ` : ""}${title} report · ${ctx.today}`;
  await sendEmail({ to, subject, html, replyTo: sched ? sched.createdBy : setBy });
  ctx.log.push({ at: new Date().toISOString(), schedId: sched ? sched.id : null, name: sched ? sched.name : "One-off", report: title, to, outside, by: (sched && sched.createdBy) || setBy });
  await fetch(`${SUPABASE_URL}/rest/v1/email_log`, { method: "POST", headers: sbHeaders(key, { Prefer: "return=minimal" }), body: JSON.stringify([{ sent_by: (sched && sched.createdBy) || setBy || "system", to_email: to, subject, kind: "report" }]) }).catch(() => null);
  return 1;
}

// every email a schedule (or a one-off) makes
async function run(key, ctx, { spec, recipients, sched, setBy, note }) {
  const query = queryWith(key);
  const built = await Engine.build(query, spec, { today: ctx.today });
  if (!built.data) return 0;
  const skip = new Set(((sched && sched.unsubscribed) || []).map((e) => e.toLowerCase()));
  const to = new Set();
  if (recipients.me && (sched ? sched.createdBy : setBy)) to.add((sched ? sched.createdBy : setBy).toLowerCase());
  [...(recipients.coaches || []), ...(recipients.emails || [])].map((e) => String(e).trim().toLowerCase()).filter((e) => emailRe.test(e)).forEach((e) => to.add(e));
  let sent = 0;
  for (const addr of to) if (!skip.has(addr)) sent += await deliver(key, ctx, { built, spec, to: addr, sched, setBy, note });
  // each athlete on the report, his own page, to the email on his profile
  if (recipients.athletes) {
    // (a group report already has each athlete's own numbers worked out: built.data.people)
    const people = built.kind === "individual" ? [built.data] : built.data.people || [];
    for (const p of people) {
      const a = p.athlete, addr = String(a.email || "").trim().toLowerCase();
      if (!emailRe.test(addr) || skip.has(addr)) continue;
      const aspec = { kind: "individual", target: { type: "athlete", id: a.id }, weeks: spec.weeks };
      sent += await deliver(key, ctx, { built: { kind: "individual", data: p }, spec: aspec, to: addr, sched, setBy, note, athleteEmail: addr });
    }
  }
  return sent;
}

async function save(key, ctx) {
  const now = Date.now();
  Object.keys(ctx.links).forEach((t) => { if (Date.parse(ctx.links[t].exp) < now) delete ctx.links[t]; });
  await setMeta(key, "reportLinks", ctx.links);
  await setMeta(key, "reportLog", ctx.log.slice(-600));
}

// a schedule as a coach sent it, cleaned up
function clean(s, email, old) {
  const kind = s.kind === "individual" ? "individual" : "group";
  const t = s.target || {};
  const target = t.type === "athlete" ? { type: "athlete", id: String(t.id) } : t.type === "roster" ? { type: "roster", group: String(t.group) } : t.type === "athletes" ? { type: "athletes", ids: (t.ids || []).map(String), title: String(t.title || "Selected athletes").slice(0, 80) } : { type: "location", location: String(t.location || "") };
  const list = (v) => [...new Set((Array.isArray(v) ? v : String(v || "").split(/[\s,;]+/)).map((e) => String(e).trim().toLowerCase()).filter((e) => emailRe.test(e)))].slice(0, 40);
  return {
    id: (old && old.id) || `rs-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`,
    name: String(s.name || "").slice(0, 80) || (kind === "individual" ? "Athlete report" : "Group report"),
    kind, target, weeks: Math.max(2, Math.min(52, Number(s.weeks) || 8)),
    freq: ["daily", "weekly", "biweekly", "monthly"].includes(s.freq) ? s.freq : "weekly",
    dow: Math.max(0, Math.min(6, Number(s.dow) || 1)), dom: Math.max(1, Math.min(28, Number(s.dom) || 1)),
    recipients: { me: !!(s.recipients && s.recipients.me), athletes: !!(s.recipients && s.recipients.athletes), coaches: list(s.recipients && s.recipients.coaches), emails: list(s.recipients && s.recipients.emails) },
    note: String(s.note || "").slice(0, 500), paused: !!s.paused,
    createdBy: (old && old.createdBy) || email, createdAt: (old && old.createdAt) || new Date().toISOString(), updatedBy: email,
    lastSent: (old && old.lastSent) || null, unsubscribed: (old && old.unsubscribed) || [],
  };
}

const page = (title, msg) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head><body style="font-family:Arial,sans-serif;background:#f2f2f2;margin:0;padding:40px 16px"><div style="max-width:520px;margin:auto;background:#fff;border-radius:10px;padding:24px;border-top:4px solid #a52a34"><h2 style="margin-top:0">${esc(title)}</h2><p style="color:#444;line-height:1.5">${esc(msg)}</p></div></body></html>`;

module.exports = async (req, res) => {
  const q = req.query || {};
  const auth = String(req.headers.authorization || "");
  try {
    const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
    // ---- a report link
    if (req.method === "GET" && q.t) {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("X-Robots-Tag", "noindex");
      const links = await meta(key, "reportLinks", {});
      const link = /^[0-9a-f]{48}$/.test(String(q.t)) ? links[q.t] : null;
      if (!link) { res.status(404).send(page("Report not found", "This report link isn't valid. Ask your coach to send it again.")); return; }
      if (Date.parse(link.exp) < Date.now()) { res.status(410).send(page("This link has expired", "Report links work for 30 days. Ask your coach for a new one.")); return; }
      const built = await Engine.build(queryWith(key), link.spec, { today: chicagoToday().day });
      res.status(200).send(Engine.render(built, { printButton: true, generated: `Generated ${chicagoToday().day} · Dynamic Sports Training` }));
      return;
    }
    // ---- stop these emails
    if (req.method === "GET" && q.unsub) {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      const links = await meta(key, "reportLinks", {});
      const link = /^[0-9a-f]{48}$/.test(String(q.unsub)) ? links[q.unsub] : null;
      if (!link || !link.schedId) { res.status(404).send(page("Link not found", "This link isn't valid any more.")); return; }
      const schedules = await meta(key, "reportSchedules", []);
      const s = schedules.find((x) => x.id === link.schedId);
      if (s && !(s.unsubscribed || []).includes(link.to)) { s.unsubscribed = [...(s.unsubscribed || []), link.to]; await setMeta(key, "reportSchedules", schedules); }
      res.status(200).send(page("You're unsubscribed", `${link.to} won't get this report any more. The coach who set it up can see that you stopped it.`));
      return;
    }
    // ---- the daily run
    if (req.method === "GET") {
      if (auth !== `Bearer ${process.env.CRON_SECRET}`) { res.status(401).json({ error: "unauthorized" }); return; }
      const t = chicagoToday();
      const schedules = await meta(key, "reportSchedules", []);
      const ctx = { today: t.day, links: await meta(key, "reportLinks", {}), log: await meta(key, "reportLog", []) };
      const results = [];
      for (const s of schedules.filter((x) => isDue(x, t))) {
        try { const n = await run(key, ctx, { spec: { kind: s.kind, target: s.target, weeks: s.weeks }, recipients: s.recipients, sched: s, note: s.note }); s.lastSent = new Date().toISOString(); results.push({ id: s.id, name: s.name, sent: n }); }
        catch (e) { results.push({ id: s.id, name: s.name, error: e.message || String(e) }); }
      }
      if (results.length) await setMeta(key, "reportSchedules", schedules);
      // Mondays: what went outside DST in the week before, to Kevin
      if (t.dow === 1) {
        const last = await meta(key, "reportOutsideDigest", "");
        if (last !== t.day) {
          const since = Date.now() - 7 * 864e5;
          const out = ctx.log.filter((x) => x.outside && Date.parse(x.at) >= since);
          if (out.length) {
            const rows = out.map((x) => `<tr><td style="padding:4px 8px">${esc(x.at.slice(0, 10))}</td><td style="padding:4px 8px">${esc(x.report)}</td><td style="padding:4px 8px">${esc(x.to)}</td><td style="padding:4px 8px">${esc(x.by)}</td></tr>`).join("");
            await sendEmail({ to: OWNER, subject: `Reports sent outside DST last week (${out.length})`, html: `<div style="font-family:Arial;font-size:13px"><p>Reports emailed to addresses outside @dynamicsportstraining.com in the last 7 days:</p><table style="border-collapse:collapse;font-size:12px"><tr><th align="left">Date</th><th align="left">Report</th><th align="left">To</th><th align="left">Set up by</th></tr>${rows}</table></div>` });
          }
          await setMeta(key, "reportOutsideDigest", t.day);
        }
      }
      await save(key, ctx);
      res.status(200).json({ ok: true, day: t.day, results });
      return;
    }
    // ---- a coach in the dashboard
    if (req.method !== "POST") { res.status(405).json({ error: "method not allowed" }); return; }
    const email = await signedIn(auth.replace(/^Bearer\s+/i, ""));
    if (!email) { res.status(401).json({ error: "Sign in to manage reports." }); return; }
    const body = req.body || {};
    const schedules = await meta(key, "reportSchedules", []);
    if (body.action === "list") {
      const log = await meta(key, "reportLog", []);
      res.status(200).json({ schedules: schedules.map((s) => ({ ...s, when: describe(s) })), log: log.slice(-200).reverse(), me: email });
      return;
    }
    if (body.action === "save") {
      const old = body.schedule && body.schedule.id ? schedules.find((s) => s.id === body.schedule.id) : null;
      if (old && old.createdBy !== email && email !== OWNER) { res.status(403).json({ error: "Only the coach who set this up (or Kevin) can change it." }); return; }
      const s = clean(body.schedule || {}, email, old);
      if (!s.recipients.me && !s.recipients.athletes && !s.recipients.coaches.length && !s.recipients.emails.length) { res.status(400).json({ error: "Pick at least one person to send it to." }); return; }
      if (s.target.type === "location" && !Engine.LOCATIONS.includes(s.target.location)) { res.status(400).json({ error: "Pick a location." }); return; }
      const next = old ? schedules.map((x) => (x.id === s.id ? s : x)) : [...schedules, s];
      await setMeta(key, "reportSchedules", next);
      res.status(200).json({ schedule: { ...s, when: describe(s) } });
      return;
    }
    if (body.action === "delete") {
      const old = schedules.find((s) => s.id === body.id);
      if (!old) { res.status(404).json({ error: "no such schedule" }); return; }
      if (old.createdBy !== email && email !== OWNER) { res.status(403).json({ error: "Only the coach who set this up (or Kevin) can delete it." }); return; }
      await setMeta(key, "reportSchedules", schedules.filter((s) => s.id !== body.id));
      res.status(200).json({ ok: true });
      return;
    }
    if (body.action === "send" || body.action === "sendOnce") {
      const t = chicagoToday();
      const ctx = { today: t.day, links: await meta(key, "reportLinks", {}), log: await meta(key, "reportLog", []) };
      let sent;
      if (body.action === "send") {
        const s = schedules.find((x) => x.id === body.id);
        if (!s) { res.status(404).json({ error: "no such schedule" }); return; }
        sent = await run(key, ctx, { spec: { kind: s.kind, target: s.target, weeks: s.weeks }, recipients: s.recipients, sched: s, note: s.note });
        s.lastSent = new Date().toISOString();
        await setMeta(key, "reportSchedules", schedules);
      } else {
        const s = clean({ ...(body.spec || {}), recipients: body.recipients, note: body.note }, email, null);
        sent = await run(key, ctx, { spec: { kind: s.kind, target: s.target, weeks: s.weeks }, recipients: s.recipients, sched: null, setBy: email, note: s.note });
      }
      await save(key, ctx);
      res.status(200).json({ sent });
      return;
    }
    res.status(400).json({ error: "bad request" });
  } catch (e) {
    console.error("reports failed:", e.message || e);
    res.status(500).json({ error: "Something went wrong with the report. Try again." });
  }
};
