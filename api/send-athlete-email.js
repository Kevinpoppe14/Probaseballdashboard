// "Email to Athlete" — a coach reviews/edits a subject+message on a specific tab (Biomechanical
// Assessment or Player Plan), then this renders that exact tab to a PDF (via a headless browser,
// so it's pixel-for-pixel the same as the tab's own "Print / Save PDF" button) and sends it
// through Gmail, from the coach's own @dynamicsportstraining.com address.
//
// Sending "as the coach" uses Gmail API domain-wide delegation: a Google Cloud service account is
// authorized in the Workspace Admin Console (Security > API Controls > Domain-wide Delegation) to
// impersonate any address in the domain for the gmail.send scope. That means no per-coach OAuth or
// password is ever stored here — only the service account's own key (GMAIL_SERVICE_ACCOUNT_JSON).
//
// PDF rendering signs into the live app as a dedicated, low-privilege Supabase account
// (PDF_RENDER_EMAIL/PDF_RENDER_PASSWORD) rather than forwarding the coach's own session token to
// this server — the coach's real token never leaves their browser.

const SUPABASE_URL = "https://avgfxwhxglftftmlydiz.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF2Z2Z4d2h4Z2xmdGZ0bWx5ZGl6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAxMTc3NzcsImV4cCI6MjEwNTY5Mzc3N30.-g6HIvyDfsCIiVt4fIhswKqhLNMY8jqSDFbAN2pOHYs";
const APP_BASE_URL = "https://probaseballdashboard.vercel.app";
const TABS = { assessment: { renderEvent: "dst-render-assessment-prep", landscape: true }, plan: { renderEvent: "dst-render-plan-prep", landscape: false } };

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Verifies the bearer token against Supabase's own auth endpoint (not just "some string was sent")
// and returns the real signed-in coach's email — that's the identity Gmail will send as, so it must
// come from a verified session, never from the request body.
async function getSignedInCoachEmail(bearerToken) {
  if (!bearerToken) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${bearerToken}` },
    });
    if (!res.ok) return null;
    const user = await res.json();
    return (user && user.email) || null;
  } catch (e) {
    return null;
  }
}

async function renderTabPdf({ athleteId, tab }) {
  const chromium = require("@sparticuz/chromium");
  const puppeteer = require("puppeteer-core");
  const renderEmail = requireEnv("PDF_RENDER_EMAIL");
  const renderPassword = requireEnv("PDF_RENDER_PASSWORD");
  const { landscape, renderEvent } = TABS[tab];

  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: { width: 1600, height: 1200 },
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
  });
  try {
    const page = await browser.newPage();

    // First load: sign in as the dedicated rendering account. A fresh page load (rather than a
    // client-side route change — this app has no router) is what makes the second navigation below
    // pick the deep link up on mount.
    await page.goto(APP_BASE_URL, { waitUntil: "networkidle0", timeout: 45000 });
    await page.evaluate(async (email, password) => {
      const { error } = await window.supabaseClient.auth.signInWithPassword({ email, password });
      if (error) throw new Error(`Supabase sign-in failed: ${error.message}`);
    }, renderEmail, renderPassword);
    // Supabase's session persists to localStorage, which survives the navigation below — but give
    // initFromSupabase a beat to actually finish loading before moving on, same as a real sign-in.
    await page.waitForFunction(
      () => window.AthleteStore && typeof window.AthleteStore.counts === "function",
      { timeout: 20000 }
    );

    // Second load: the deep link (?athlete=&tab=) is read once on App's mount, so this has to be an
    // actual navigation, not a history.pushState — the already-persisted session skips the login
    // screen and goes straight to loading this athlete's data.
    await page.goto(`${APP_BASE_URL}/?athlete=${encodeURIComponent(athleteId)}&tab=${encodeURIComponent(tab)}`, {
      waitUntil: "networkidle0",
      timeout: 90000, // initFromSupabase can be slow under Supabase load — see store.js's withRetry
    });
    const wrapSelector = tab === "assessment" ? ".assess-wrap" : ".period-wrap";
    await page.waitForSelector(wrapSelector, { timeout: 20000 });
    await sleep(800); // let the just-mounted tab finish its own render pass (charts, computed fields)

    await page.evaluate((evtName) => window.dispatchEvent(new Event(evtName)), renderEvent);
    await sleep(600); // the prep is synchronous DOM measurement, but give React a tick to settle

    const pdf = await page.pdf({
      format: "letter",
      landscape,
      printBackground: true,
      preferCSSPageSize: false,
    });
    return pdf;
  } finally {
    await browser.close();
  }
}

function buildRawEmail({ from, to, subject, bodyText, filename, pdfBase64 }) {
  const boundary = `dst_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const encodeHeader = (s) => `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`;
  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 7bit",
    "",
    bodyText,
    "",
    `--${boundary}`,
    `Content-Type: application/pdf; name="${filename}"`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename="${filename}"`,
    "",
    pdfBase64,
    `--${boundary}--`,
    "",
  ];
  return Buffer.from(lines.join("\r\n"), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function sendAsCoach({ coachEmail, to, subject, bodyText, pdfBuffer, filename }) {
  const { google } = require("googleapis");
  const creds = JSON.parse(requireEnv("GMAIL_SERVICE_ACCOUNT_JSON"));
  const jwtClient = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/gmail.send"],
    subject: coachEmail, // domain-wide delegation: send AS this coach, not as the service account
  });
  const gmail = google.gmail({ version: "v1", auth: jwtClient });
  const raw = buildRawEmail({ from: coachEmail, to, subject, bodyText, filename, pdfBase64: pdfBuffer.toString("base64") });
  await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }
  const auth = req.headers.authorization || "";
  const coachEmail = await getSignedInCoachEmail(auth.replace(/^Bearer\s+/i, ""));
  if (!coachEmail) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const { athleteId, tab, to, subject, body: bodyText, filename } = req.body || {};
  if (!athleteId || !TABS[tab]) {
    res.status(400).json({ error: "athleteId and a valid tab ('assessment' or 'plan') are required" });
    return;
  }
  if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
    res.status(400).json({ error: "a valid recipient email is required" });
    return;
  }
  if (!subject || !bodyText) {
    res.status(400).json({ error: "subject and body are required" });
    return;
  }

  try {
    const pdf = await renderTabPdf({ athleteId, tab });
    await sendAsCoach({
      coachEmail,
      to,
      subject,
      bodyText,
      pdfBuffer: pdf,
      filename: filename || `${tab}.pdf`,
    });
    res.status(200).json({ ok: true, sentAs: coachEmail, to });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
};
