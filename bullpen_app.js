// Bullpen Video from the Coach tab of a coach's own phone app (athlete.html, "Coach tools"): sign in with the dashboard
// account if need be, pick a pitcher, then
//   1. his TrackMan report: the PDF (trackman_import.js), saved as one of his bullpens, or a bullpen already on file
//   2. the video: one long video of the whole bullpen, filmed on a phone. Each pitch's clip is found in it (bullpen_cut.js):
//      from the top of the leg lift to 0.6 s after the ball gets to the plate, matched to the report's pitches in order
//   3. a look at each clip, and a way to move them a pitch either way if one is off
//   4. saved: the video into Google Drive (or storage here), its clips onto the bullpen, as the dashboard's Bullpens
//      tab keeps them, so it plays there too
//   5. the export: the MP4 of the pitches with their TrackMan numbers (video_export.js), made from the video on this
//      phone (nothing downloaded), saved to Photos from the share sheet
//   window.BullpenApp.open({ overlay, close })   overlay and close are the app's sheet layer and its close
(function () {
  const sb = window.supabaseClient;
  const el = (tag, attrs, ...kids) => {
    const n = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (v == null || v === false) return;
      if (k === "class") n.className = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    });
    kids.flat().forEach((c) => { if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c))); });
    return n;
  };
  const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const lastFirst = (name) => { const p = (name || "").trim().split(/\s+/); return p.length > 1 ? `${p[p.length - 1]}, ${p.slice(0, -1).join(" ")}` : name || ""; };
  const nameKey = (s) => String(s || "").toLowerCase().replace(/[^a-z]/g, "");
  const clock = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0")}`;
  const BC = () => window.BullpenCut;
  let ctx = null;
  let pitchers = null;

  const sheet = (...kids) => {
    ctx.overlay.replaceChildren(el("div", { class: "sheet" }, el("button", { class: "close", "aria-label": "Close", onclick: ctx.close }, "×"), ...kids));
    ctx.overlay.className = "overlay show";
  };
  const note = (text) => el("div", { class: "swap-coach" }, text);

  async function open(options) {
    ctx = { ...(ctx || {}), ...options };
    sheet(el("h2", null, "Bullpen Video"), note("Loading…"));
    const { data } = await sb.auth.getSession();
    if (!data || !data.session) { signIn(); return; }
    try {
      if (!pitchers) {
        const rows = [];
        for (let from = 0; ; from += 1000) {
          const { data: page, error } = await sb.from("athletes").select("id, name:data->>name, status:data->>status, position:data->>position, throws:data->>throws, group:data->>rosterGroup").range(from, from + 999);
          if (error) throw error;
          rows.push(...page);
          if (page.length < 1000) break;
        }
        pitchers = rows.filter((p) => (p.status || "active").toLowerCase() === "active" && (p.name || "").trim() && (/pitcher/i.test(p.position || "") || p.group === "coaches"))
          .sort((a, b) => lastFirst(a.name).localeCompare(lastFirst(b.name)));
      }
      pick();
    } catch (e) { sheet(el("h2", null, "Bullpen Video"), note("Couldn't load the pitchers. Check your connection and try again.")); }
  }

  function signIn() {
    const email = el("input", { type: "email", autocomplete: "username", placeholder: "Email", "aria-label": "Email" });
    const password = el("input", { type: "password", autocomplete: "current-password", placeholder: "Password", "aria-label": "Password" });
    const msg = el("div", { class: "swap-note" });
    const go = async (e) => {
      e.preventDefault();
      msg.textContent = "Signing in…";
      const { error } = await sb.auth.signInWithPassword({ email: email.value.trim(), password: password.value });
      if (error) { msg.textContent = error.message || "Sign-in failed."; return; }
      open({});
    };
    sheet(el("h2", null, "Sign in"), note("Sign in with your dashboard account."),
      el("form", { class: "qa-signin", onsubmit: go }, email, password, msg, el("div", { class: "swap-actions" }, el("button", { class: "primary", type: "submit" }, "Sign in"))));
  }

  function pick() {
    const results = el("div", { class: "qa-list" });
    const search = el("input", { type: "search", placeholder: "Search for a pitcher", "aria-label": "Search for a pitcher", autocomplete: "off" });
    const show = () => {
      const q = search.value.trim().toLowerCase();
      const hits = (q ? pitchers.filter((p) => p.name.toLowerCase().includes(q)) : pitchers).slice(0, q ? 12 : 8);
      results.replaceChildren(...hits.map((p) => el("button", { class: "qa-row", onclick: () => screen(p) }, lastFirst(p.name))),
        ...(q && !hits.length ? [el("div", { class: "qa-empty" }, "No active pitcher matches that.")] : []));
    };
    search.addEventListener("input", show);
    sheet(el("h2", null, "Bullpen Video"), note("His TrackMan report and one video of the whole bullpen: each pitch gets its clip, from the top of the leg lift to just after the ball gets there, with its numbers, and a video to export. Who is it?"), search, results);
    show();
    setTimeout(() => search.focus(), 50);
  }

  // ---- the screen for pitcher p, full screen ----
  async function screen(p) {
    ctx.close();
    const box = el("div", { class: "bpa" });
    const layer = el("div", { class: "mc-app-layer" },
      el("div", { class: "mc-app-bar" }, el("button", { class: "mc-app-back", onclick: () => { if (!busy || window.confirm("Stop and go back?")) { quit(); open({}); } } }, "‹ Back"),
        el("button", { class: "mc-app-close", "aria-label": "Close", onclick: () => { if (!busy || window.confirm("Stop and close?")) quit(); } }, "×")),
      box);
    document.body.append(layer);
    document.body.classList.add("mc-app-open");
    const athleteId = /^\d+$/.test(String(p.id)) ? Number(p.id) : p.id;
    const athlete = { id: athleteId, name: p.name };
    // what's been done so far
    let sessions = [], session = null, fresh = false, file = null, fileUrl = null, scan = null, cut = null, clips = null;
    let busy = null, msg = "", err = "", cancel = false, saved = false, made = null, wake = null, showing = null;
    const exp = { layout: "vertical", types: null, rate: 1, title: true, plot: true };
    const quit = () => { cancel = true; layer.remove(); document.body.classList.remove("mc-app-open"); if (fileUrl) URL.revokeObjectURL(fileUrl); awake(false); };
    // the screen kept on through a long step (an iPhone stops a page's work when it locks)
    const awake = async (on) => {
      try { if (on && !wake && navigator.wakeLock) wake = await navigator.wakeLock.request("screen"); else if (!on && wake) { await wake.release(); wake = null; } } catch (e) { wake = null; }
    };
    const thrown = () => (session ? (session.pitches || []).slice().sort((a, b) => a.no - b.no) : []);
    const clipsFrom = (segs) => { const out = {}; thrown().forEach((q, i) => { const s = segs[i]; if (s) out[q.no] = { f: 0, start: Math.round(s.start * 1000) / 1000, end: Math.round(s.end * 1000) / 1000 }; }); return out; };
    const step = (n, title, ...kids) => el("section", { class: "bpa-step" }, el("h3", null, el("span", { class: "bpa-n" }, n), title), ...kids);
    const progress = () => (busy ? el("div", { class: "bpa-busy", role: "status" }, el("progress", { max: 1, value: busy.f || 0 }), el("span", null, `${busy.text} ${Math.round((busy.f || 0) * 100)}%`),
      busy.stop ? el("button", { type: "button", class: "bpa-btn", onclick: () => { cancel = true; } }, "Cancel") : null) : null);
    const filePick = (accept, label, on, primary) => {
      const input = el("input", { type: "file", accept, hidden: true, onchange: (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ""; if (f) on(f); } });
      return el("span", null, input, el("button", { type: "button", class: `bpa-btn${primary ? " primary" : ""}`, disabled: !!busy, onclick: () => input.click() }, label));
    };

    try {
      const { data, error } = await sb.from("assessments").select("id,data").eq("athlete_id", String(p.id)).eq("data->>kind", "bullpen").limit(500);
      if (error) throw error;
      sessions = (data || []).map((r) => ({ ...r.data, id: r.data.id || r.id })).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    } catch (e) { err = "Couldn't read his bullpens. Check your connection."; }

    function render() {
      const list = thrown();
      const parts = [el("h2", null, "Bullpen Video ", el("small", null, p.name))];
      // 1. the report
      parts.push(step(1, "TrackMan report",
        session ? el("p", { class: "bpa-done" }, `${BC().fmtDay(session.date)}${session.facility ? ` · ${session.facility}` : ""} · ${list.length} pitches${fresh ? " (new: saved with the video)" : " (on file)"}`) : null,
        session && session.video && session.video.files && session.video.files.length && !saved ? el("p", { class: "bpa-warn" }, "This bullpen has video already: saving replaces it.") : null,
        !busy && !saved ? el("div", { class: "bpa-row" },
          filePick("application/pdf,.pdf", session ? "Another PDF" : "Choose the TrackMan PDF", readReport, !session),
          sessions.length ? el("select", { "aria-label": "Or a bullpen on file", onchange: (e) => { const s = sessions.find((x) => x.id === e.target.value); if (s) { session = s; fresh = false; restart(); } } },
            el("option", { value: "" }, "Or one on file…"), sessions.slice(0, 30).map((s) => el("option", { value: s.id, selected: session && session.id === s.id && !fresh }, `${s.date} · ${(s.pitches || []).length} pitches${s.video && s.video.files && s.video.files.length ? " · has video" : ""}`))) : null) : null));
      // 2. the video
      if (session) parts.push(step(2, "Bullpen video",
        el("p", { class: "bpa-hint" }, "One video of the whole bullpen from a phone on a tripod, at normal speed, with him in the picture for every pitch. Each pitch is matched to the report in order, from the top of his leg lift to 0.6 s after the ball gets there. Keep this screen open while it works (a few minutes for a long video)."),
        file ? el("p", { class: "bpa-done" }, `${file.name || "Video"} · ${BC().mb(file.size)}${scan ? ` · ${clock(scan.dur)}` : ""}`) : null,
        cut ? el("p", { class: cut.segs.length < list.length ? "bpa-warn" : "bpa-done" }, `${cut.segs.length} of ${list.length} pitches have a clip: ${cut.segs.filter((s) => s.found).length} from the leg lift${cut.segs.some((s) => !s.found) ? `, ${cut.segs.filter((s) => !s.found).length} around the motion (he wasn't clear in the picture)` : ""}.${cut.seems < list.length ? ` Only ${cut.seems} looked like pitches: check the clips.` : ""}`) : null,
        !busy && !saved ? el("div", { class: "bpa-row" }, filePick("video/*", file ? "Another video" : "Choose the video", readVideo, !file)) : null));
      // 3. the clips
      if (clips) parts.push(step(3, "Check the clips",
        el("p", { class: "bpa-hint" }, "Tap a pitch to watch its clip. If they're off by a pitch (a throw the report didn't catch, or one it caught that isn't here), move that clip and every one after it."),
        el("div", { class: "bpa-player" }, player),
        showing != null ? el("div", { class: "bpa-row" },
          el("button", { type: "button", class: "bpa-btn", disabled: !!busy || saved, onclick: () => shift(-1) }, "‹ It's the pitch before"),
          el("button", { type: "button", class: "bpa-btn", disabled: !!busy || saved, onclick: () => shift(1) }, "It's the pitch after ›")) : null,
        el("div", { class: "bpa-list" }, list.map((q) => {
          const c = clips[q.no];
          return el("button", { type: "button", class: `bpa-pitch${showing === q.no ? " on" : ""}${q.removed ? " out" : ""}`, disabled: !c, onclick: () => watch(q.no) },
            el("b", null, `#${q.no}`), el("span", { class: "bpa-dot", style: `background:${BC().colorOf(q.type)}` }), ` ${q.type || "Pitch"}${q.speed != null ? ` ${Number(q.speed).toFixed(1)}` : ""}`,
            el("small", null, c ? `${clock(c.start)} (${(c.end - c.start).toFixed(1)} s)` : "no clip"));
        }))));
      // 4. saved
      if (clips) parts.push(step(4, "Save it",
        saved ? el("p", { class: "bpa-done" }, `Saved: the video is in ${saved.where} and ${Object.keys(clips).length} pitches have their clip on his ${BC().fmtDay(session.date)} bullpen (the dashboard's Bullpens tab plays them after a reload).`)
          : el("div", null, el("p", { class: "bpa-hint" }, `The video (${BC().mb(file.size)}) uploads from this phone: on Wi-Fi if you can.${fresh ? " The TrackMan report is saved with it." : ""}`),
            !busy ? el("button", { type: "button", class: "bpa-btn primary", onclick: save }, fresh ? "Save the bullpen and its video" : "Save the video to this bullpen") : null)));
      // 5. the export
      if (clips) {
        const VE = window.VideoExport, live = list.filter((q) => !q.removed && clips[q.no]);
        const types = [...new Set(live.map((q) => q.type || "Untagged"))];
        if (!exp.types) exp.types = new Set(types);
        const chosen = live.filter((q) => exp.types.has(q.type || "Untagged"));
        const toggle = (label, on, set) => el("label", { class: "bpa-check" }, el("input", { type: "checkbox", checked: on, onchange: (e) => { set(e.target.checked); render(); } }), ` ${label}`);
        parts.push(step(5, "Export the video",
          !VE || !VE.supported() ? el("p", { class: "bpa-warn" }, "This browser can't make videos: use a recent iPhone, or Chrome.") : el("div", null,
            el("div", { class: "bpa-row" }, el("b", null, "Shape"),
              [["vertical", "Vertical (phone)"], ["horizontal", "Horizontal (TV)"]].map(([k, t]) => el("button", { type: "button", class: `bpa-btn${exp.layout === k ? " on" : ""}`, "aria-pressed": exp.layout === k ? "true" : "false", onclick: () => { exp.layout = k; render(); } }, t))),
            el("div", { class: "bpa-row" }, el("b", null, "Pitches"), types.map((t) => toggle(`${t} (${live.filter((q) => (q.type || "Untagged") === t).length})`, exp.types.has(t), (on) => { if (on) exp.types.add(t); else exp.types.delete(t); }))),
            el("div", { class: "bpa-row" }, el("b", null, "Show"), toggle("Title card", exp.title, (on) => { exp.title = on; }), toggle("Movement plot", exp.plot, (on) => { exp.plot = on; }),
              el("select", { "aria-label": "Speed", onchange: (e) => { exp.rate = Number(e.target.value); } }, [[1, "Speed as filmed"], [0.5, "½ speed"], [0.25, "¼ speed"]].map(([v, t]) => el("option", { value: v, selected: exp.rate === v }, t)))),
            el("p", { class: "bpa-hint" }, `${chosen.length} pitch${chosen.length === 1 ? "" : "es"}, each with its TrackMan numbers. Made on this phone from the video here (about as long as it runs), then Save Video in the share sheet puts it in Photos.`),
            !busy ? el("div", { class: "bpa-row" },
              el("button", { type: "button", class: "bpa-btn primary", disabled: !chosen.length, onclick: () => makeVideo(chosen) }, "Make the video"),
              made ? el("button", { type: "button", class: `bpa-btn${made.tap ? " primary" : ""}`, onclick: async () => { if ((await VE.download(made.blob, made.name, { share: VE.isPhone() })) === "done") { made.tap = false; render(); } } }, VE.isPhone() ? "Save video" : "Download again") : null) : null,
            made ? el("p", { class: "bpa-done" }, made.tap ? `Ready (${BC().mb(made.blob.size)}): tap Save video, then Save Video in the share sheet.` : `Done: ${made.name} (${BC().mb(made.blob.size)}).`) : null)));
      }
      parts.push(progress());
      if (msg) parts.push(el("p", { class: "bpa-done", role: "status" }, msg));
      if (err) parts.push(el("p", { class: "bpa-err", role: "alert" }, err));
      box.replaceChildren(...parts.filter(Boolean));
    }
    const restart = () => { if (file && scan) cutIt(); else render(); };

    // 1. the PDF
    async function readReport(f) {
      err = ""; msg = ""; busy = { text: "Reading the report…", f: 0 }; render();
      try {
        if (!window.TrackmanImport) throw new Error("The TrackMan reader didn't load. Reload the page.");
        const r = await window.TrackmanImport.parse(f);
        if (r.athleteName && nameKey(r.athleteName) !== nameKey(p.name) && !window.confirm(`The report is for ${r.athleteName}, not ${p.name}. Use it for ${p.name} anyway?`)) { busy = null; render(); return; }
        const first = r.pitches[0] || {};
        const dup = sessions.find((b) => b.date === r.date && (b.pitches || []).length === r.pitches.length && ((b.pitches || [])[0] || {}).speed === first.speed);
        if (dup) { session = dup; fresh = false; msg = `That report is already on file (${BC().fmtDay(dup.date)}): using it.`; }
        else {
          const { data } = await sb.auth.getSession();
          session = {
            id: uid(), kind: "bullpen", athleteId, date: r.date, sessionType: r.sessionType, facility: r.facility,
            reportName: r.athleteName, summary: r.summary, pitches: r.pitches, source: "trackman-pdf", fileName: f.name || "",
            importedAt: new Date().toISOString(), importedBy: (data && data.session && data.session.user && data.session.user.email) || "", notes: "",
          };
          fresh = true;
        }
      } catch (e) { err = `Couldn't read that PDF: ${(e && e.message) || e}`; }
      busy = null;
      restart();
    }
    // 2. the video: its motion, then each pitch's clip
    async function readVideo(f) {
      err = ""; msg = ""; saved = false; made = null;
      file = f; if (fileUrl) URL.revokeObjectURL(fileUrl); fileUrl = URL.createObjectURL(f);
      player.src = fileUrl; showing = null;
      scan = null; cut = null; clips = null; cancel = false;
      busy = { text: "Finding the pitches…", f: 0 }; render(); awake(true);
      try {
        scan = await BC().scanVideo(f, (x) => { busy.f = x; paintBusy(); });
      } catch (e) { err = (e && e.message) || String(e); busy = null; awake(false); render(); return; }
      await cutIt();
    }
    async function cutIt() {
      if (!scan || !session) return;
      cancel = false; err = ""; saved = false; made = null;
      busy = { text: "Finding each leg lift and release…", f: 0, stop: true }; render(); awake(true);
      try {
        cut = await BC().cueClips(file, scan, thrown(), { onProgress: (x) => { busy.f = x; paintBusy(); }, cancelled: () => cancel });
        clips = clipsFrom(cut.segs);
        exp.types = null;
        if (player.videoHeight && player.videoWidth > player.videoHeight) exp.layout = "horizontal";
      } catch (e) {
        if ((e && e.message) !== "cancelled") err = (e && e.message) || String(e);
        else { const s = BC().splitByMotion(scan, thrown().length); cut = { segs: s.segs.map((x) => ({ ...x, found: false })), seems: s.seems }; clips = clipsFrom(cut.segs); msg = "Stopped: each pitch is cut around its motion instead (2.5 s before to 1.5 s after)."; }
      }
      busy = null; awake(false); render();
    }
    const paintBusy = () => { const b = box.querySelector(".bpa-busy"); if (!b || !busy) return; b.querySelector("progress").value = busy.f || 0; b.querySelector("span").textContent = `${busy.text} ${Math.round((busy.f || 0) * 100)}%`; };

    // 3. watching a clip, looping it
    const player = el("video", { class: "bpa-video", muted: true, playsinline: true, controls: true, preload: "auto" });
    player.muted = true;
    player.addEventListener("timeupdate", () => { const c = showing != null && clips && clips[showing]; if (c && player.currentTime >= c.end) player.currentTime = c.start; });
    function watch(no) {
      showing = no;
      const c = clips[no];
      render();
      const go = () => { player.currentTime = c.start; player.play().catch(() => {}); };
      if (player.readyState >= 1) go(); else player.addEventListener("loadedmetadata", go, { once: true });
      player.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    function shift(d) {
      const next = BC().shiftClips({ pitches: session.pitches, video: { clips } }, showing, d);
      if (!next) return;
      clips = next.clips;
      const nos = thrown().map((q) => q.no), n = nos[nos.indexOf(showing) + d];
      made = null;
      if (n != null && clips[n]) watch(n); else render();
    }

    // 4. saving: the report (if new), the video into Drive, its clips onto the bullpen
    async function save() {
      err = ""; msg = ""; cancel = false;
      const where = (await BC().useDrive()) ? "Google Drive" : "the dashboard's storage";
      busy = { text: `Uploading ${BC().mb(file.size)} to ${where}…`, f: 0 }; render(); awake(true);
      let stored = null;
      try {
        stored = await BC().upload(file, athlete, session.id, (x) => { busy.f = x; paintBusy(); });
        const { data } = await sb.auth.getSession();
        const old = session.video;
        const rec = { ...session, video: { files: [stored], clips, camera: "phone", cued: true, addedAt: new Date().toISOString(), addedBy: (data && data.session && data.session.user && data.session.user.email) || "" } };
        busy = { text: "Saving the clips…", f: 1 }; paintBusy();
        const res = await sb.from("assessments").upsert({ id: rec.id, athlete_id: String(p.id), data: rec });
        if (res.error) throw new Error("The clips didn't save: check your connection and try again.");
        session = rec; fresh = false;
        sessions = [rec, ...sessions.filter((s) => s.id !== rec.id)];
        if (old && old.files && old.files.length) BC().removeFiles(old);
        saved = { where };
      } catch (e) {
        if (stored) BC().removeFiles({ files: [stored] });
        err = (e && e.message) || String(e);
      }
      busy = null; awake(false); render();
    }

    // 5. the MP4, from the video on this phone
    async function makeVideo(chosen) {
      const VE = window.VideoExport;
      err = ""; made = null; cancel = false;
      busy = { text: "Making the video…", f: 0, stop: true }; render(); awake(true);
      try {
        const local = { ...session, video: { files: [{ url: fileUrl }], clips } };
        const segments = chosen.map((q, i) => BC().pitchSegment({ session: local, athlete, p: q, i, count: chosen.length, url: fileUrl, rate: exp.rate, ball: false, plot: exp.plot }));
        const blob = await VE.render({
          layout: exp.layout, fill: false, segments, cancelled: () => cancel,
          title: exp.title ? { lines: [p.name || "", `Bullpen · ${BC().fmtDay(session.date)}`, `${chosen.length} pitch${chosen.length === 1 ? "" : "es"}${session.facility ? ` · ${session.facility}` : ""}`] } : null,
          onProgress: (text, f) => { busy.text = text; busy.f = f; paintBusy(); },
        });
        const name = VE.fileName(p.name, `bullpen-${exp.layout}`, session.date, blob);
        busy = null; awake(false); render();
        const how = await VE.download(blob, name, { share: VE.isPhone() });
        made = { blob, name, tap: how === "tap" };
      } catch (e) {
        if ((e && e.message) !== "cancelled") err = (e && e.message) || String(e);
      }
      busy = null; awake(false); render();
    }

    render();
  }

  window.BullpenApp = { open };
})();
