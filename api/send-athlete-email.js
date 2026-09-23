// "Email to Athlete" — a coach reviews/edits a subject+message on a specific tab (Biomechanical
// Assessment or Player Plan), the browser renders that tab to a PDF itself (see renderTabToPdf in
// index.html — html2canvas snapshotting the already-signed-in coach's own live view, no
// server-side rendering needed), and this endpoint just sends the result through Gmail.
//
// Sending "as the coach" uses Gmail API domain-wide delegation: a Google Cloud service account is
// authorized in the Workspace Admin Console (Security > API Controls > Domain-wide Delegation) to
// impersonate any address in the domain for the gmail.send scope. That means no per-coach OAuth or
// password is ever stored here — only the service account's own key (GMAIL_SERVICE_ACCOUNT_JSON).

const SUPABASE_URL = "https://avgfxwhxglftftmlydiz.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF2Z2Z4d2h4Z2xmdGZ0bWx5ZGl6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAxMTc3NzcsImV4cCI6MjEwNTY5Mzc3N30.-g6HIvyDfsCIiVt4fIhswKqhLNMY8jqSDFbAN2pOHYs";

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

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

function buildRawEmail({ from, to, cc, subject, bodyText, filename, pdfBase64 }) {
  const boundary = `dst_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const encodeHeader = (s) => `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`;
  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    ...(cc ? [`Cc: ${cc}`] : []),
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

async function sendAsCoach({ coachEmail, to, cc, subject, bodyText, filename, pdfBase64 }) {
  const { google } = require("googleapis");
  const creds = JSON.parse(requireEnv("GMAIL_SERVICE_ACCOUNT_JSON"));
  const jwtClient = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/gmail.send"],
    subject: coachEmail, // domain-wide delegation: send AS this coach, not as the service account
  });
  const gmail = google.gmail({ version: "v1", auth: jwtClient });
  const raw = buildRawEmail({ from: coachEmail, to, cc, subject, bodyText, filename, pdfBase64 });
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

  const { to, cc, subject, body: bodyText, filename, pdfBase64 } = req.body || {};
  const emailRe = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  if (!to || !emailRe.test(to)) {
    res.status(400).json({ error: "a valid recipient email is required" });
    return;
  }
  const ccList = (cc || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (ccList.some((addr) => !emailRe.test(addr))) {
    res.status(400).json({ error: "one of the CC addresses is not a valid email" });
    return;
  }
  if (!subject || !bodyText) {
    res.status(400).json({ error: "subject and body are required" });
    return;
  }
  if (!pdfBase64) {
    res.status(400).json({ error: "pdfBase64 is required" });
    return;
  }

  try {
    await sendAsCoach({ coachEmail, to, cc: ccList.join(", "), subject, bodyText, filename: filename || "attachment.pdf", pdfBase64 });
    res.status(200).json({ ok: true, sentAs: coachEmail, to, cc: ccList });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
};
