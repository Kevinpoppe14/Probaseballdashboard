// Bullpen video kept in the company's Google Drive instead of Supabase storage, so a clip of any size can be kept
// (bullpen_video.js). The files live in one Drive folder (DRIVE_VIDEO_FOLDER_ID: best a folder in a Shared Drive),
// a folder per athlete inside it. Each video is opened to anyone with its link once it's up (action share), so it can be
// sent to the athlete; the folders and anything not shared stay private to signed-in dashboard coaches.
//
// It uses the service account the athlete emails already use (GMAIL_SERVICE_ACCOUNT_JSON), either
//   as itself: add its client_email to the Shared Drive (or folder) as a Content manager, or
//   as a Workspace user (DRIVE_VIDEO_AS, e.g. video@dynamicsportstraining.com): add the Drive scope
//   https://www.googleapis.com/auth/drive to its domain-wide delegation in the Admin Console.
//
// POST, with the coach's Supabase session as the bearer token, { action, ... }:
//   status                                  -> { configured }
//   start  { name, mimeType, size, athleteId, athleteName, sessionId }
//                                           -> { uploadUrl }: a resumable upload the browser sends the file to itself,
//                                              in pieces (so nothing big passes through here)
//   token                                   -> { accessToken, expiresAt }: read-only, about an hour, for watching
//   share  { id }                           -> { link }: the video opened to anyone with its link (to send it)
//   delete { ids }                          -> { deleted }
// Google stopped taking an access token in a download link in 2020, so the browser fetches a clip with this token in
// its Authorization header and plays it from memory.

const SUPABASE_URL = "https://avgfxwhxglftftmlydiz.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF2Z2Z4d2h4Z2xmdGZ0bWx5ZGl6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAxMTc3NzcsImV4cCI6MjEwNTY5Mzc3N30.-g6HIvyDfsCIiVt4fIhswKqhLNMY8jqSDFbAN2pOHYs";
const DRIVE = "https://www.googleapis.com/auth/drive";
const DRIVE_READ = "https://www.googleapis.com/auth/drive.readonly";
const FOLDER_TYPE = "application/vnd.google-apps.folder";

const configured = () => !!(process.env.GMAIL_SERVICE_ACCOUNT_JSON && process.env.DRIVE_VIDEO_FOLDER_ID);

// the signed-in coach (verified with Supabase itself), or null
async function signedIn(bearer) {
  if (!bearer) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${bearer}` } });
    if (!res.ok) return null;
    const user = await res.json();
    return (user && user.email) || null;
  } catch (e) {
    return null;
  }
}

async function accessToken(scope) {
  const { google } = require("googleapis");
  const creds = JSON.parse(process.env.GMAIL_SERVICE_ACCOUNT_JSON);
  const jwt = new google.auth.JWT({ email: creds.client_email, key: creds.private_key, scopes: [scope], subject: process.env.DRIVE_VIDEO_AS || undefined });
  const { token, res } = await jwt.getAccessToken();
  const expiry = (res && res.data && res.data.expiry_date) || jwt.credentials.expiry_date || Date.now() + 50 * 60 * 1000;
  return { token, expiry };
}

async function drive(token, path, { method = "GET", query = {}, body, headers = {} } = {}) {
  const q = new URLSearchParams({ supportsAllDrives: "true", ...query });
  const res = await fetch(`https://www.googleapis.com/drive/v3/${path}?${q}`, {
    method, headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok && res.status !== 204) throw new Error(`Google Drive said ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.status === 204 ? null : res.json();
}

// the athlete's own folder in the video folder (found by the athlete id it's tagged with, or made)
async function athleteFolder(token, athleteId, athleteName) {
  const root = process.env.DRIVE_VIDEO_FOLDER_ID;
  const q = `'${root}' in parents and mimeType = '${FOLDER_TYPE}' and appProperties has { key='athleteId' and value='${String(athleteId).replace(/'/g, "")}' } and trashed = false`;
  const found = await drive(token, "files", { query: { q, fields: "files(id)", includeItemsFromAllDrives: "true", corpora: "allDrives", pageSize: "1" } });
  if (found.files && found.files.length) return found.files[0].id;
  const made = await drive(token, "files", { method: "POST", query: { fields: "id" }, body: { name: athleteName || `Athlete ${athleteId}`, mimeType: FOLDER_TYPE, parents: [root], appProperties: { athleteId: String(athleteId) } } });
  return made.id;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") { res.status(405).json({ error: "method not allowed" }); return; }
  const coach = await signedIn((req.headers.authorization || "").replace(/^Bearer\s+/i, ""));
  if (!coach) { res.status(401).json({ error: "unauthorized" }); return; }
  const { action, ...p } = req.body || {};
  try {
    if (action === "status") { res.status(200).json({ configured: configured() }); return; }
    if (!configured()) { res.status(503).json({ error: "Google Drive video storage isn't set up yet (DRIVE_VIDEO_FOLDER_ID in Vercel)." }); return; }

    if (action === "start") {
      if (!p.name || !p.size || !p.athleteId) { res.status(400).json({ error: "name, size and athleteId are required" }); return; }
      const { token } = await accessToken(DRIVE);
      const parent = await athleteFolder(token, p.athleteId, p.athleteName);
      // the upload is started here and finished by the browser: Google lets the page that started it (its Origin)
      // send the file to the address it gives back
      const start = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,name,size", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Type": p.mimeType || "video/mp4", "X-Upload-Content-Length": String(p.size),
          ...(req.headers.origin ? { Origin: req.headers.origin } : {}),
        },
        body: JSON.stringify({
          name: p.name, parents: [parent],
          description: `Added from the dashboard by ${coach}`,
          appProperties: { athleteId: String(p.athleteId), sessionId: String(p.sessionId || ""), addedBy: coach },
        }),
      });
      if (!start.ok) throw new Error(`Google Drive wouldn't start the upload (${start.status}): ${(await start.text()).slice(0, 300)}`);
      res.status(200).json({ uploadUrl: start.headers.get("location") });
      return;
    }

    if (action === "token") {
      const { token, expiry } = await accessToken(DRIVE_READ);
      res.status(200).json({ accessToken: token, expiresAt: expiry });
      return;
    }

    // a video opened to anyone with its link (to send to the athlete), and that link
    if (action === "share") {
      if (!/^[\w-]{10,}$/.test(String(p.id || ""))) { res.status(400).json({ error: "id is required" }); return; }
      const { token } = await accessToken(DRIVE);
      try {
        await drive(token, `files/${p.id}/permissions`, { method: "POST", body: { role: "reader", type: "anyone", allowFileDiscovery: false } });
      } catch (e) {
        res.status(403).json({ error: `Google Drive wouldn't share the video by link (the Shared Drive may not allow sharing outside the company): ${e.message || e}` });
        return;
      }
      const f = await drive(token, `files/${p.id}`, { query: { fields: "webViewLink" } });
      res.status(200).json({ link: f.webViewLink || `https://drive.google.com/file/d/${p.id}/view` });
      return;
    }

    if (action === "delete") {
      const ids = (p.ids || []).filter((x) => /^[\w-]{10,}$/.test(String(x)));
      const { token } = await accessToken(DRIVE);
      let deleted = 0;
      for (const id of ids) {
        // moved to the Drive's trash (kept 30 days there), not destroyed outright
        try { await drive(token, `files/${id}`, { method: "PATCH", body: { trashed: true } }); deleted += 1; } catch (e) { /* already gone */ }
      }
      res.status(200).json({ deleted });
      return;
    }

    res.status(400).json({ error: "unknown action" });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
};
