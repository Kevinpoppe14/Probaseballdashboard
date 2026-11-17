// Slot machine: one pull for each food an athlete logs, on the phone app (athlete.html), for the athletes listed in
// SLOT_ATHLETES only (Shane Baz). Three DST logos wins a free DST t-shirt, once: about 1 pull in 50.
//
// The caller is not signed in, so nothing in the request is trusted except the athlete's private link token, looked
// up here with the service-role key. The pull is decided here, not on the phone. Pulls are earned by food actually
// saved that day (each eaten entry in food_logs, up to MAX_PULLS_PER_DAY), so deleting and re-adding a food doesn't
// earn more. Pulls used and the win are kept in app_meta (key "slotMachine"). A win emails Kevin.
//
// POST { token, day: "YYYY-MM-DD" (the phone's today), peek: true }  -> { eligible, left, won }
// POST { token, day }                                                 -> { eligible, reels: [3 symbols], win, left, won }

const crypto = require("crypto");
const SUPABASE_URL = "https://avgfxwhxglftftmlydiz.supabase.co";
const SEND_AS_EMAIL = "kevin@dynamicsportstraining.com";
const NOTIFY = ["kevin@dynamicsportstraining.com"];
const SLOT_ATHLETES = ["70"]; // Shane Baz
const ODDS = 50; // 1 in 50 pulls is three DST logos
const MAX_PULLS_PER_DAY = 8;
const SYMBOLS = ["dst", "baseball", "fire", "muscle", "banana", "steak"];
const META_KEY = "slotMachine";

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

// a losing spin: three symbols that aren't all DST (two DST now and then, for a near miss)
function losingReels() {
  for (;;) {
    const r = [0, 1, 2].map(() => SYMBOLS[crypto.randomInt(SYMBOLS.length)]);
    if (!r.every((s) => s === "dst")) return r;
  }
}

module.exports = async (req, res) => {
  if (req.method !== "POST") { res.status(405).json({ error: "method not allowed" }); return; }
  const body = req.body || {};
  const token = String(body.token || "");
  const day = String(body.day || "");
  if (!/^[0-9a-f]{32,128}$/.test(token) || !/^\d{4}-\d{2}-\d{2}$/.test(day)) { res.status(400).json({ error: "bad request" }); return; }
  // the phone's today, within a day of the server's (time zones), so pulls can't be earned on other days' food
  const diffDays = Math.abs(Date.parse(`${day}T12:00:00Z`) - Date.now()) / 864e5;
  if (!(diffDays <= 1.6)) { res.status(200).json({ eligible: false }); return; }

  try {
    const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
    const [link] = await sbGet(key, "athlete_links", `token=eq.${token}&select=athlete_id`);
    const id = link ? String(link.athlete_id) : "";
    if (!SLOT_ATHLETES.includes(id)) { res.status(200).json({ eligible: false }); return; } // says nothing about which links exist

    const [[foodRow], [metaRow]] = await Promise.all([
      sbGet(key, "food_logs", `athlete_id=eq.${encodeURIComponent(id)}&day=eq.${day}&select=entries`),
      sbGet(key, "app_meta", `key=eq.${META_KEY}&select=value`),
    ]);
    const eaten = ((foodRow && foodRow.entries) || []).filter((e) => e && e.name && !e.planned).length;
    const meta = (metaRow && metaRow.value) || {};
    const mine = meta[id] || { days: {} };
    const used = (mine.days || {})[day] || 0;
    const left = Math.max(0, Math.min(MAX_PULLS_PER_DAY, eaten) - used);
    const won = !!mine.wonAt;
    if (body.peek) { res.status(200).json({ eligible: true, left, won }); return; }
    if (!left) { res.status(200).json({ eligible: true, left: 0, won, reels: null }); return; }

    // the pull: one in ODDS is three DST logos, while the shirt hasn't been won yet
    const win = !won && crypto.randomInt(ODDS) === 0;
    const reels = win ? ["dst", "dst", "dst"] : losingReels();
    const next = { ...mine, days: { ...(mine.days || {}), [day]: used + 1 }, pulls: (mine.pulls || 0) + 1 };
    if (win) { next.wonAt = new Date().toISOString(); next.prize = "DST t-shirt"; }
    const up = await fetch(`${SUPABASE_URL}/rest/v1/app_meta?on_conflict=key`, {
      method: "POST",
      headers: sbHeaders(key, { Prefer: "resolution=merge-duplicates,return=minimal" }),
      body: JSON.stringify({ key: META_KEY, value: { ...meta, [id]: next } }),
    });
    if (!up.ok) throw new Error(`Saving the pull failed: HTTP ${up.status} ${await up.text()}`);

    if (win) {
      const [[athleteRow]] = await Promise.all([sbGet(key, "athletes", `id=eq.${encodeURIComponent(id)}&select=data`)]);
      const name = ((athleteRow && athleteRow.data) || {}).name || "An athlete";
      const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#111;line-height:1.5"><p><strong>${esc(name)}</strong> hit three DST logos on the food-log slot machine and won a free DST t-shirt.</p><p style="color:#666;font-size:12px">Pull ${next.pulls} since it started, on ${esc(day)}. The shirt can only be won once.</p></div>`;
      for (const to of NOTIFY) { try { await sendEmail({ to, subject: `${name} won a DST t-shirt on the slot machine`, html }); } catch (e) { console.error("slot win email failed:", e.message || e); } }
    }
    res.status(200).json({ eligible: true, reels, win, left: left - 1, won: won || win });
  } catch (e) {
    console.error("slot-pull failed:", e.message || e);
    res.status(500).json({ error: "could not pull" });
  }
};
