// Program complete: the morning after an athlete's block of a program ends, the coach who assigned it (the block's
// assignedBy) gets an email with how it went: compliance (sessions logged out of those scheduled), strength (each
// lift's estimated 1RM, first two weeks against the last two), force plate jump changes and body weight change, all
// worked out by program_results.js, the same as the program builder's Results panel and Kevin's Program Results page.
//
// Vercel Cron (vercel.json) calls it every morning. A block that ended in the last three days and hasn't been sent is
// sent (so a missed run catches up); each is sent once (app_meta "programCompleteSent" keeps the ones sent).
// Sent from Kevin's Gmail (domain-wide delegation, as the other emails are) to the assigning coach.
//
// A signed-in coach can call it by hand: ?preview=1 returns the next email's HTML without sending it (or a list of
// what would go out, with ?list=1); ?athlete=ID&block=ID previews one block, sent or not.

const SUPABASE_URL = "https://avgfxwhxglftftmlydiz.supabase.co";
const APP_BASE_URL = "https://probaseballdashboard.vercel.app";
const SEND_AS_EMAIL = "kevin@dynamicsportstraining.com";
const PR = require("../program_results.js");

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}
const sbHeaders = (key, extra) => ({ apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...extra });
async function sbSelect(key, table, query) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { headers: sbHeaders(key) });
  if (!res.ok) throw new Error(`Supabase select ${table} failed: HTTP ${res.status} ${await res.text()}`);
  return (await res.json()) || [];
}
// every row of a query, a page at a time
async function sbAll(key, table, query) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { headers: sbHeaders(key, { Range: `${from}-${from + 999}`, "Range-Unit": "items" }) });
    if (!res.ok) throw new Error(`Supabase select ${table} failed: HTTP ${res.status} ${await res.text()}`);
    const rows = (await res.json()) || [];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}
async function sbUpsert(key, table, rows) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, { method: "POST", headers: sbHeaders(key, { Prefer: "resolution=merge-duplicates,return=minimal" }), body: JSON.stringify(rows) });
  if (!res.ok) throw new Error(`Supabase upsert ${table} failed: HTTP ${res.status} ${await res.text()}`);
}
const enc = encodeURIComponent;

// ---- the email -------------------------------------------------------------------------------------------
function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
const fmtDay = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const coachName = (email) => String(email || "").split("@")[0].split(/[._-]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
function buildHtml({ athlete, program, assignedBy, r }) {
  const td = 'style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1a1a1a;padding:7px 10px;border-bottom:1px solid #eee;"';
  const th = 'style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#777;text-align:left;padding:7px 10px;border-bottom:1px solid #ddd;text-transform:uppercase;letter-spacing:0.04em;"';
  const row = (label, value, note) => `<tr><td ${td}><b>${escapeHtml(label)}</b></td><td ${td}>${escapeHtml(value)}</td><td ${td} style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#777;padding:7px 10px;border-bottom:1px solid #eee;">${escapeHtml(note || "")}</td></tr>`;
  const c = r.cmj || {};
  const pairText = (p, unit, dp) => (p ? `${p.before} → ${p.after}${unit ? ` ${unit}` : ""} (${PR.signed(p.change, unit, dp)})` : "no tests to compare");
  const lifts = r.lifts.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:6px;"><tr><th ${th}>Lift</th><th ${th}>Weeks 1–2</th><th ${th}>Last 2 weeks</th><th ${th}>Change</th></tr>${r.lifts.map((l) => `<tr><td ${td}>${escapeHtml(l.name)}</td><td ${td}>${l.early} lb</td><td ${td}>${l.late} lb</td><td ${td}><b>${PR.pctText(l.pct)}</b></td></tr>`).join("")}</table>`
    : `<div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#777;">No lift was logged with weights in both the first two weeks and the last two${r.weeks < 3 ? " (the block was under three weeks)" : ""}.</div>`;
  const pct = r.compliance == null ? "–" : `${Math.round(r.compliance * 100)}%`;
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f2f2f2;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f2f2;padding:24px 0;"><tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:10px;overflow:hidden;">
      <tr><td style="background:#1a1a1a;padding:22px 28px;border-bottom:4px solid #a52a34;">
        <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#d9d9d9;">Program complete</div>
        <div style="font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:800;color:#ffffff;margin-top:6px;">${escapeHtml(athlete.name)} finished ${escapeHtml(program.name)}</div>
        <div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#bdbdbd;margin-top:4px;">${fmtDay(r.from)} – ${fmtDay(r.to)} · ${r.weeks} week${r.weeks === 1 ? "" : "s"}${assignedBy ? ` · assigned by ${escapeHtml(coachName(assignedBy))}` : ""}</div>
      </td></tr>
      <tr><td style="padding:18px 28px 4px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          ${row("Compliance", `${pct} (${r.done} of ${r.scheduled} sessions)`, "sessions with anything logged")}
          ${row("Strength", r.strength == null ? "–" : `${PR.pctText(r.strength)} average`, r.lifts.length ? `estimated 1RM, ${r.lifts.length} lift${r.lifts.length === 1 ? "" : "s"}` : "")}
          ${row("Jump height", pairText(c.jumpHeight, "in", 1), c.beforeDate && c.afterDate ? `${fmtDay(c.beforeDate)} → ${fmtDay(c.afterDate)}` : "")}
          ${row("Relative peak power", pairText(c.relativePeakPower, "W/kg", 1), "")}
          ${row("mRSI", pairText(c.mRSI, "", 2), "")}
          ${row("Body weight", r.bodyweight ? `${r.bodyweight.before} → ${r.bodyweight.after} lb (${PR.signed(r.bodyweight.change, "lb")})` : "no weigh-ins to compare", r.bodyweight ? `${fmtDay(r.bodyweight.beforeDate)} → ${fmtDay(r.bodyweight.afterDate)}` : "")}
        </table>
      </td></tr>
      <tr><td style="padding:14px 28px 4px;">
        <div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#a52a34;">Lifts</div>
        ${lifts}
      </td></tr>
      <tr><td style="padding:20px 28px 26px;">
        <a href="${APP_BASE_URL}/?athlete=${enc(athlete.id)}&tab=programming" style="display:inline-block;background:#a52a34;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;text-decoration:none;padding:11px 20px;border-radius:6px;">Open ${escapeHtml(athlete.name)}'s plan</a>
        <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#888;margin-top:14px;">Jump and body weight compare the test or weigh-in nearest the start of the block with the last one at its end. Strength compares each lift's best estimated 1RM (from weight and reps logged) in the first two weeks with the last two.</div>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

// ---- Gmail send (the same domain-wide delegation as the other emails) -------------------------------------
function buildRawHtmlEmail({ from, to, subject, html }) {
  const encodeHeader = (s) => `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`;
  const lines = [`From: ${from}`, `To: ${to}`, `Subject: ${encodeHeader(subject)}`, "MIME-Version: 1.0", 'Content-Type: text/html; charset="UTF-8"', "", html];
  return Buffer.from(lines.join("\r\n"), "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function sendEmail({ to, subject, html }) {
  const { google } = require("googleapis");
  const creds = JSON.parse(requireEnv("GMAIL_SERVICE_ACCOUNT_JSON"));
  const jwtClient = new google.auth.JWT({ email: creds.client_email, key: creds.private_key, scopes: ["https://www.googleapis.com/auth/gmail.send"], subject: SEND_AS_EMAIL });
  const gmail = google.gmail({ version: "v1", auth: jwtClient });
  await gmail.users.messages.send({ userId: "me", requestBody: { raw: buildRawHtmlEmail({ from: SEND_AS_EMAIL, to, subject, html }) } });
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

// one block's result, from the database
async function resultFor(key, { athleteId, plan, block, programs, today }) {
  const program = programs.find((p) => p.id === block.programId);
  const [athleteRows, logRows, bwRows, testRows] = await Promise.all([
    sbSelect(key, "athletes", `id=eq.${enc(athleteId)}&select=id,data`),
    sbAll(key, "athlete_logs", `athlete_id=eq.${enc(athleteId)}&program_id=eq.${enc(program.id)}&select=key,value`),
    sbAll(key, "athlete_logs", `athlete_id=eq.${enc(athleteId)}&key=like.bw-*&select=key,value`),
    sbAll(key, "force_tests", `athlete_id=eq.${enc(athleteId)}&select=date:data->>date,jumpHeight:data->jumpHeight,relativePeakPower:data->relativePeakPower,rsiModified:data->rsiModified,systemWeight:data->systemWeight`),
  ]);
  const log = { ...(((plan.programLog || {})[program.id]) || {}) };
  logRows.forEach((r) => { log[r.key] = r.value; });
  const athlete = { id: athleteId, name: (athleteRows[0] && athleteRows[0].data && athleteRows[0].data.name) || `Athlete ${athleteId}` };
  const r = PR.blockResult({ plan, block, program, log, forceTests: testRows.map((t) => ({ ...t, jumpHeight: Number(t.jumpHeight), relativePeakPower: t.relativePeakPower == null ? null : Number(t.relativePeakPower), rsiModified: t.rsiModified == null ? null : Number(t.rsiModified), systemWeight: t.systemWeight == null ? null : Number(t.systemWeight) })), weighins: PR.weighinsFrom(bwRows), today });
  return { athlete, program, r };
}

module.exports = async (req, res) => {
  const auth = req.headers.authorization || "";
  const isCron = auth === `Bearer ${process.env.CRON_SECRET}`;
  const isManual = !isCron && (await isSignedInCoach(auth.replace(/^Bearer\s+/i, "")));
  if (!isCron && !isManual) { res.status(401).json({ error: "unauthorized" }); return; }
  const q = req.query || {};
  const preview = isManual && q.preview === "1";
  try {
    const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", month: "2-digit", day: "2-digit", year: "numeric" }).formatToParts(new Date());
    const get = (t) => parts.find((p) => p.type === t).value;
    const today = `${get("year")}-${get("month")}-${get("day")}`;
    const [plans, programRows, sentRows] = await Promise.all([
      sbAll(key, "periodization", "select=athlete_id,data"),
      sbAll(key, "programs", "select=id,data"),
      sbSelect(key, "app_meta", "key=eq.programCompleteSent&select=value"),
    ]);
    const programs = programRows.map((r) => ({ ...r.data, id: r.id }));
    const sent = new Set((sentRows[0] && Array.isArray(sentRows[0].value) && sentRows[0].value) || []);
    // one block asked for by hand
    if (preview && q.athlete && q.block) {
      const row = plans.find((p) => String(p.athlete_id) === String(q.athlete)), plan = row && row.data;
      const block = plan && (plan.blocks || []).find((b) => String(b.id) === String(q.block));
      if (!block || !programs.find((p) => p.id === block.programId)) { res.status(404).json({ error: "no such block with a program" }); return; }
      const out = await resultFor(key, { athleteId: String(q.athlete), plan, block, programs, today });
      res.setHeader("Content-Type", "text/html; charset=utf-8"); res.status(200).send(buildHtml({ ...out, assignedBy: block.assignedBy })); return;
    }
    // the blocks that ended in the last three days, with a coach to tell, not sent yet
    const due = [];
    plans.forEach((row) => {
      const plan = row.data;
      if (!plan || !plan.startDate) return;
      (plan.blocks || []).forEach((b) => {
        if (!b.programId || !b.assignedBy) return;
        const program = programs.find((p) => p.id === b.programId);
        if (!PR.reportable(program)) return;
        const { to } = PR.blockDates(plan, b);
        const tag = `${row.athlete_id}:${b.id}`;
        if (to < today && to >= PR.addDays(today, -3) && !sent.has(tag)) due.push({ athleteId: String(row.athlete_id), plan, block: b, tag });
      });
    });
    if (preview && q.list === "1") { res.status(200).json({ ok: true, today, due: due.map((d) => ({ athlete: d.athleteId, block: d.block.id, program: d.block.label, assignedBy: d.block.assignedBy })) }); return; }
    if (!due.length) { res.status(200).json({ ok: true, sent: 0, reason: "no programs finished in the last three days" }); return; }
    if (preview) {
      const d = due[0], out = await resultFor(key, { ...d, programs, today });
      res.setHeader("Content-Type", "text/html; charset=utf-8"); res.status(200).send(buildHtml({ ...out, assignedBy: d.block.assignedBy })); return;
    }
    const results = [];
    for (const d of due) {
      try {
        const out = await resultFor(key, { ...d, programs, today });
        const pct = out.r.compliance == null ? "" : ` · ${Math.round(out.r.compliance * 100)}% compliance`;
        const subject = `${out.athlete.name} finished ${out.program.name}${pct}`;
        await sendEmail({ to: d.block.assignedBy, subject, html: buildHtml({ ...out, assignedBy: d.block.assignedBy }) });
        await sbUpsert(key, "email_log", [{ sent_by: "system", to_email: d.block.assignedBy, subject, kind: "program_complete" }]).catch(() => null);
        sent.add(d.tag);
        results.push({ athlete: out.athlete.name, program: out.program.name, to: d.block.assignedBy });
      } catch (e) {
        results.push({ athlete: d.athleteId, block: d.block.id, error: e.message || String(e) });
      }
    }
    await sbUpsert(key, "app_meta", [{ key: "programCompleteSent", value: [...sent].slice(-3000) }]);
    res.status(200).json({ ok: true, sent: results.filter((r) => !r.error).length, results });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
};
