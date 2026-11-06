// Bullpen Video, a queue of pitchers: from the Coach tab of a coach's own phone app (athlete.html, "Coach tools"), and
// full screen from the dashboard's Bullpens tab. For each pitcher in the queue:
//   his TrackMan report: the PDF (trackman_import.js), saved as one of his bullpens at once, or one already on file
//   one long video of the whole bullpen, filmed on a phone
// and the queue works through them one at a time (bullpen_cut.js): the pitches found in the video, each pitch's clip
// from the top of the leg lift to 0.6 s after the ball gets there, matched to the report's pitches in order; the
// video into Google Drive (shared by link) and the clips onto the bullpen, so they play on the dashboard too. Then for
// each: Check the clips (the clips beside the pitches, to move, delete or put gaps in, saved as they change), Make the
// video (the MP4 of the pitches with their TrackMan numbers, video_export.js, from the video on this device), and
// Email the report (bullpen_pdf.js, with the video's link). "Make every video" queues every video still to be made.
// It runs while the page is open: on a phone, with the screen on and the page in front.
//   window.BullpenApp.open({ overlay, close })   the phone app: its sheet layer and its close
//   window.BullpenApp.mountQueue(box)            the dashboard (AthleteStore holds its data)
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
  const BC = () => window.BullpenCut;
  const store = () => window.AthleteStore; // on the dashboard

  // ---- the data: the dashboard's store when it's there, else straight from the database ----
  const data = {
    async pitchers() {
      if (store()) {
        const all = store().allAthletes().filter((a) => (a.status || "active").toLowerCase() === "active" && (a.name || "").trim());
        const p = all.filter((a) => /pitcher/i.test(a.position || "") || a.rosterGroup === "coaches");
        return (p.length ? p : all).map((a) => ({ id: a.id, name: a.name, throws: a.throws, email: a.email, heightIn: a.heightIn })).sort((a, b) => lastFirst(a.name).localeCompare(lastFirst(b.name)));
      }
      const rows = [];
      for (let from = 0; ; from += 1000) {
        const { data: page, error } = await sb.from("athletes").select("id, name:data->>name, status:data->>status, position:data->>position, throws:data->>throws, email:data->>email, height:data->heightIn, group:data->>rosterGroup").range(from, from + 999);
        if (error) throw error;
        rows.push(...page);
        if (page.length < 1000) break;
      }
      return rows.filter((p) => (p.status || "active").toLowerCase() === "active" && (p.name || "").trim() && (/pitcher/i.test(p.position || "") || p.group === "coaches"))
        .map((p) => ({ id: /^\d+$/.test(String(p.id)) ? Number(p.id) : p.id, name: p.name, throws: p.throws, email: p.email, heightIn: Number(p.height) || null }))
        .sort((a, b) => lastFirst(a.name).localeCompare(lastFirst(b.name)));
    },
    async bullpens(id) {
      if (store()) return store().getBullpens(id).slice().sort((a, b) => (b.date || "").localeCompare(a.date || ""));
      const { data: rows, error } = await sb.from("assessments").select("id,data").eq("athlete_id", String(id)).eq("data->>kind", "bullpen").limit(500);
      if (error) throw error;
      return (rows || []).map((r) => ({ ...r.data, id: r.data.id || r.id })).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    },
    async save(rec) {
      if (store()) { store().saveAssessment(rec); return; }
      const res = await sb.from("assessments").upsert({ id: rec.id, athlete_id: String(rec.athleteId), data: rec });
      if (res.error) throw new Error("It didn't save: check your connection and try again.");
    },
    async me() {
      if (store() && store().currentUserEmail) return store().currentUserEmail() || "";
      const { data: d } = await sb.auth.getSession();
      return (d && d.session && d.session.user && d.session.user.email) || "";
    },
  };

  // ---- the phone app: sign in, then the queue, full screen ----
  let ctx = null;
  async function open(options) {
    ctx = { ...(ctx || {}), ...options };
    const { data: d } = await sb.auth.getSession();
    if (!d || !d.session) { signIn(); return; }
    ctx.close();
    const box = el("div");
    const layer = el("div", { class: "mc-app-layer" },
      el("div", { class: "mc-app-bar" }, el("span"), el("button", { class: "mc-app-close", "aria-label": "Close", onclick: () => { if (q.busy() && !window.confirm("The queue is still working. Stop it and close?")) return; q.stop(); layer.remove(); document.body.classList.remove("mc-app-open"); } }, "×")),
      box);
    document.body.append(layer);
    document.body.classList.add("mc-app-open");
    const q = mountQueue(box);
  }
  function signIn() {
    const sheet = (...kids) => { ctx.overlay.replaceChildren(el("div", { class: "sheet" }, el("button", { class: "close", "aria-label": "Close", onclick: ctx.close }, "×"), ...kids)); ctx.overlay.className = "overlay show"; };
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
    sheet(el("h2", null, "Sign in"), el("div", { class: "swap-coach" }, "Sign in with your dashboard account."),
      el("form", { class: "qa-signin", onsubmit: go }, email, password, msg, el("div", { class: "swap-actions" }, el("button", { class: "primary", type: "submit" }, "Sign in"))));
  }

  // ---- the queue ----
  function mountQueue(box) {
    let pitchers = null, stopped = false, working = null, wake = null;
    const entries = []; // each pitcher's: see blank()
    const exp = { layout: window.VideoExport && window.VideoExport.isPhone() ? "vertical" : "horizontal", title: true, plot: true, rate: 1, auto: false };
    const blank = () => ({
      id: uid(), p: null, sessions: null, session: null, fresh: false, file: null, url: null, scan: null, cut: null, clips: null,
      stage: "", f: 0, err: "", uploaded: false, link: "", wantVideo: false, made: null, open: "", mail: null, cancel: false,
    });
    const awake = async (on) => { try { if (on && !wake && navigator.wakeLock) wake = await navigator.wakeLock.request("screen"); else if (!on && wake) { await wake.release(); wake = null; } } catch (e) { wake = null; } };
    const thrown = (e) => (e.session ? (e.session.pitches || []).slice().sort((a, b) => a.no - b.no) : []);
    const clipsFrom = (e, segs) => { const out = {}; thrown(e).forEach((q, i) => { const s = segs[i]; if (s) out[q.no] = { f: 0, start: Math.round(s.start * 1000) / 1000, end: Math.round(s.end * 1000) / 1000 }; }); return out; };
    const filePick = (accept, label, on, primary, disabled) => {
      const input = el("input", { type: "file", accept, hidden: true, onchange: (ev) => { const f = ev.target.files && ev.target.files[0]; ev.target.value = ""; if (f) on(f); } });
      return el("span", null, input, el("button", { type: "button", class: `bpa-btn${primary ? " primary" : ""}`, disabled, onclick: () => input.click() }, label));
    };
    // what an entry is waiting for, or doing
    const needs = (e) => (!e.p ? "Pick the pitcher" : !e.session ? "Choose his report" : !e.file ? "Choose the video" : "");
    const status = (e) => {
      if (e.err) return el("p", { class: "bpa-err" }, e.err);
      if (working === e && e.stage) return el("div", { class: "bpa-busy", role: "status" }, el("progress", { max: 1, value: e.f || 0 }), el("span", null, `${e.stage} ${Math.round((e.f || 0) * 100)}%`),
        el("button", { type: "button", class: "bpa-btn", onclick: () => { e.cancel = true; } }, "Stop"));
      if (needs(e)) return el("p", { class: "bpa-hint" }, `${needs(e)}.`);
      if (!e.uploaded) return el("p", { class: "bpa-hint" }, working ? "Waiting its turn." : "Ready to go.");
      const have = Object.keys(e.clips || {}).length;
      return el("p", { class: have < thrown(e).length ? "bpa-warn" : "bpa-done" }, `Saved: ${have} of ${thrown(e).length} pitches have a clip, the video's in ${e.where || "Google Drive"}.${e.cut && e.cut.segs.some((s) => !s.found) ? ` ${e.cut.segs.filter((s) => !s.found).length} cut around the motion (he wasn't clear in the picture).` : ""}`);
    };

    function render() {
      const parts = [el("h2", null, "Bullpen Video ", el("small", null, "a queue of pitchers"))];
      parts.push(el("p", { class: "bpa-hint" }, "Add a pitcher, his TrackMan report and one video of his whole bullpen (a phone on a tripod, normal speed), then the next. They're worked through one at a time: each pitch's clip from the top of the leg lift to 0.6 s after the ball gets there, the video into Google Drive, the clips onto his bullpen. Keep this page open (on a phone, the screen on and the page in front) until it's done."));
      entries.forEach((e, i) => parts.push(card(e, i)));
      parts.push(el("div", { class: "bpa-row" },
        el("button", { type: "button", class: "bpa-btn primary", onclick: () => { entries.push(blank()); render(); } }, entries.length ? "+ Add another pitcher" : "+ Add a pitcher")));
      // the videos
      const VE = window.VideoExport;
      if (entries.some((e) => e.uploaded) && VE && VE.supported()) {
        const toggle = (label, on, set) => el("label", { class: "bpa-check" }, el("input", { type: "checkbox", checked: on, onchange: (ev) => { set(ev.target.checked); render(); } }), ` ${label}`);
        const left = entries.filter((e) => e.uploaded && !e.made && !e.wantVideo);
        parts.push(el("section", { class: "bpa-step" }, el("h3", null, "The videos"),
          el("div", { class: "bpa-row" }, el("b", null, "Shape"),
            [["vertical", "Vertical (phone)"], ["horizontal", "Horizontal (TV)"]].map(([k, t]) => el("button", { type: "button", class: `bpa-btn${exp.layout === k ? " on" : ""}`, "aria-pressed": exp.layout === k ? "true" : "false", onclick: () => { exp.layout = k; render(); } }, t))),
          el("div", { class: "bpa-row" }, el("b", null, "Show"), toggle("Title card", exp.title, (on) => { exp.title = on; }), toggle("Movement plot", exp.plot, (on) => { exp.plot = on; }),
            el("select", { "aria-label": "Speed", onchange: (ev) => { exp.rate = Number(ev.target.value); } }, [[1, "Speed as filmed"], [0.5, "½ speed"], [0.25, "¼ speed"]].map(([v, t]) => el("option", { value: v, selected: exp.rate === v }, t)))),
          el("p", { class: "bpa-hint" }, `Each is every pitch with its TrackMan numbers, made on this ${VE.isPhone() ? "phone" : "computer"} from the video here, one at a time.${VE.isPhone() ? " Save video on each then puts it in Photos." : " Each goes to your downloads."}`),
          left.length ? el("button", { type: "button", class: "bpa-btn primary", onclick: () => { left.forEach((e) => { e.wantVideo = true; }); pump(); } }, `Make every video (${left.length})`) : null));
      }
      box.replaceChildren(el("div", { class: "bpa" }, ...parts));
    }

    function card(e, i) {
      const kids = [el("h3", null, el("span", { class: "bpa-n" }, i + 1), e.p ? e.p.name : "Pitcher",
        working !== e ? el("button", { type: "button", class: "bpa-x", "aria-label": "Take this pitcher out of the queue", onclick: () => { if (e.uploaded || window.confirm("Take him out of the queue?")) { entries.splice(entries.indexOf(e), 1); if (e.url) URL.revokeObjectURL(e.url); render(); } } }, "✕") : null)];
      const locked = working === e || e.uploaded;
      // who
      if (!e.p) {
        const results = el("div", { class: "qa-list" });
        const search = el("input", { type: "search", class: "bpa-search", placeholder: "Search for a pitcher", "aria-label": "Search for a pitcher", autocomplete: "off" });
        const show = () => {
          const qs = search.value.trim().toLowerCase();
          const hits = (pitchers || []).filter((p) => !qs || p.name.toLowerCase().includes(qs)).slice(0, qs ? 8 : 5);
          results.replaceChildren(...(pitchers ? hits.map((p) => el("button", { type: "button", class: "qa-row", onclick: () => pick(e, p) }, lastFirst(p.name))) : [el("div", { class: "qa-empty" }, "Loading the pitchers…")]),
            ...(qs && pitchers && !hits.length ? [el("div", { class: "qa-empty" }, "No active pitcher matches that.")] : []));
        };
        search.addEventListener("input", show);
        show();
        kids.push(search, results);
        if (i === entries.length - 1) setTimeout(() => search.focus(), 30);
        return el("section", { class: "bpa-step" }, ...kids);
      }
      // his report
      kids.push(el("div", { class: "bpa-line" }, el("b", null, "Report"),
        e.session ? el("span", { class: "bpa-done" }, `${BC().fmtDay(e.session.date)}${e.session.facility ? ` · ${e.session.facility}` : ""} · ${thrown(e).length} pitches${e.fresh ? " (imported)" : ""}`) : null,
        !locked ? filePick("application/pdf,.pdf", e.session ? "Another PDF" : "Choose the TrackMan PDF", (f) => readReport(e, f), !e.session) : null,
        !locked && e.sessions && e.sessions.length ? el("select", { "aria-label": "Or a bullpen on file", onchange: (ev) => { const s = e.sessions.find((x) => x.id === ev.target.value); if (s) { e.session = s; e.fresh = false; e.err = ""; render(); pump(); } } },
          el("option", { value: "" }, "Or one on file…"), e.sessions.slice(0, 30).map((s) => el("option", { value: s.id, selected: e.session && e.session.id === s.id && !e.fresh }, `${s.date} · ${(s.pitches || []).length} pitches${s.video && s.video.files && s.video.files.length ? " · has video" : ""}`))) : null));
      if (e.session && !e.uploaded && e.session.video && e.session.video.files && e.session.video.files.length) kids.push(el("p", { class: "bpa-warn" }, "This bullpen has video already: the new one replaces it."));
      // the video
      if (e.session) kids.push(el("div", { class: "bpa-line" }, el("b", null, "Video"),
        e.file ? el("span", { class: "bpa-done" }, `${e.file.name || "Video"} · ${BC().mb(e.file.size)}`) : null,
        !locked ? filePick("video/*", e.file ? "Another video" : "Choose the video", (f) => { e.file = f; if (e.url) URL.revokeObjectURL(e.url); e.url = URL.createObjectURL(f); e.scan = null; e.cut = null; e.err = ""; render(); pump(); }, !e.file) : null));
      kids.push(status(e));
      // once it's saved
      if (e.uploaded) {
        const VE = window.VideoExport;
        kids.push(el("div", { class: "bpa-row" },
          el("button", { type: "button", class: `bpa-btn${e.open === "match" ? " on" : ""}`, onclick: () => { e.open = e.open === "match" ? "" : "match"; render(); } }, "Check the clips"),
          VE && VE.supported() ? (e.made ? el("button", { type: "button", class: `bpa-btn${e.made.tap ? " primary" : ""}`, onclick: async () => { const how = await VE.download(e.made.blob, e.made.name, { share: VE.isPhone() }); if (how !== "tap") { e.made.tap = false; e.made.files = how === "files"; render(); } } }, VE.isPhone() ? "Save video" : "Download again")
            : e.wantVideo ? el("span", { class: "bpa-hint" }, working === e ? "" : "Video: waiting its turn")
              : el("button", { type: "button", class: "bpa-btn", onclick: () => { e.wantVideo = true; pump(); render(); } }, "Make the video")) : null,
          window.BullpenPdf ? el("button", { type: "button", class: `bpa-btn${e.open === "mail" ? " on" : ""}`, onclick: () => { e.open = e.open === "mail" ? "" : "mail"; if (!e.mail) e.mail = { to: e.p.email || "", body: window.BullpenPdf.mailText({ athlete: e.p, session: e.session, link: e.link }), msg: "", busy: false, sent: false }; render(); } }, "Email the report") : null));
        if (e.made) kids.push(el("p", { class: "bpa-done" }, e.made.tap ? `Video ready (${BC().mb(e.made.blob.size)}): tap Save video, then Save Video in the share sheet.` : e.made.files ? `It went to Files › Downloads instead of Photos: open it in Files, tap Share, then Save Video.` : `Video done: ${e.made.name} (${BC().mb(e.made.blob.size)}).`));
        if (e.open === "match") {
          // mounted once and kept (its undo history and player with it) however often the page is drawn again
          if (!e.holder) {
            e.holder = el("div", { class: "bpa-match" });
            e.matcher = BC().matchClips(e.holder, { session: { ...e.session, video: { files: [{ url: e.url }], clips: e.clips } }, src: e.url, onChange: (clips) => { e.clips = clips; const had = e.made; e.made = null; saveClips(e); if (had) render(); } });
          }
          kids.push(e.holder);
        } else if (e.matcher) { e.matcher.destroy(); e.matcher = null; e.holder = null; }
        if (e.open === "mail") kids.push(mailBox(e));
      }
      return el("section", { class: `bpa-step${working === e ? " working" : ""}` }, ...kids);
    }

    async function pick(e, p) {
      e.p = p; e.err = ""; render();
      try { e.sessions = await data.bullpens(p.id); } catch (err) { e.sessions = []; e.err = "Couldn't read his bullpens. Check your connection."; }
      render();
    }
    async function readReport(e, f) {
      e.err = ""; e.stage = ""; render();
      try {
        if (!window.TrackmanImport) throw new Error("The TrackMan reader didn't load. Reload the page.");
        const r = await window.TrackmanImport.parse(f);
        if (r.athleteName && nameKey(r.athleteName) !== nameKey(e.p.name) && !window.confirm(`The report is for ${r.athleteName}, not ${e.p.name}. Use it for ${e.p.name} anyway?`)) return;
        const first = r.pitches[0] || {};
        const dup = (e.sessions || []).find((b) => b.date === r.date && (b.pitches || []).length === r.pitches.length && ((b.pitches || [])[0] || {}).speed === first.speed);
        if (dup) { e.session = dup; e.fresh = false; }
        else {
          const rec = {
            id: `bp-${uid()}`, kind: "bullpen", athleteId: e.p.id, date: r.date, sessionType: r.sessionType, facility: r.facility,
            reportName: r.athleteName, summary: r.summary, pitches: r.pitches, source: "trackman-pdf", fileName: f.name || "",
            importedAt: new Date().toISOString(), importedBy: await data.me(), notes: "",
          };
          await data.save(rec); // the report is his bullpen now, video or not
          e.session = rec; e.fresh = true;
          e.sessions = [rec, ...(e.sessions || [])];
        }
      } catch (err) { e.err = `Couldn't read that PDF: ${(err && err.message) || err}`; }
      render();
      pump();
    }

    // ---- the work, one thing at a time: an entry's video (found, cut, uploaded, saved), then the videos asked for ----
    async function pump() {
      if (working || stopped) return;
      const next = entries.find((e) => !e.err && e.p && e.session && e.file && !e.uploaded) || entries.find((e) => e.uploaded && e.wantVideo && !e.made && !e.err);
      if (!next) { awake(false); render(); return; }
      working = next; next.cancel = false; awake(true);
      try {
        if (!next.uploaded) await process(next); else await makeVideo(next);
      } catch (err) {
        if ((err && err.message) === "cancelled") { next.err = "Stopped. Choose the video again to start it over."; next.file = null; next.wantVideo = false; }
        else next.err = (err && err.message) || String(err);
      }
      next.stage = ""; working = null; render();
      setTimeout(pump, 50);
    }
    // (Stop takes effect between the steps, and within finding the leg lifts and making the video)
    const progress = (e, stage) => (x) => { e.stage = stage; e.f = x; paint(e); };
    // just the progress bar, not the whole page, while it works
    const paint = (e) => { const b = box.querySelector(".bpa-step.working .bpa-busy"); if (!b) { render(); return; } b.querySelector("progress").value = e.f || 0; b.querySelector("span").textContent = `${e.stage} ${Math.round((e.f || 0) * 100)}%`; };
    async function process(e) {
      e.stage = "Finding the pitches…"; e.f = 0; render();
      if (!e.scan) e.scan = await BC().scanVideo(e.file, progress(e, "Finding the pitches…"));
      if (e.cancel) throw new Error("cancelled");
      e.stage = "Finding each leg lift and release…"; e.f = 0; render();
      e.cut = await BC().cueClips(e.file, e.scan, thrown(e), { onProgress: progress(e, "Finding each leg lift and release…"), cancelled: () => e.cancel });
      e.clips = clipsFrom(e, e.cut.segs);
      const where = (await BC().useDrive()) ? "Google Drive" : "the dashboard's storage";
      e.stage = `Uploading ${BC().mb(e.file.size)} to ${where}…`; e.f = 0; render();
      const stored = await BC().upload(e.file, e.p, e.session.id, progress(e, `Uploading ${BC().mb(e.file.size)} to ${where}…`));
      const old = e.session.video;
      const rec = { ...e.session, video: { files: [stored], clips: e.clips, camera: "phone", cued: true, addedAt: new Date().toISOString(), addedBy: await data.me() } };
      try { await data.save(rec); } catch (err) { BC().removeFiles({ files: [stored] }); throw err; }
      if (old && old.files && old.files.length) BC().removeFiles(old);
      e.session = rec; e.uploaded = true; e.where = where; e.link = stored.link || "";
      if (e.mail && e.link && !e.mail.sent) e.mail.body = window.BullpenPdf.mailText({ athlete: e.p, session: e.session, link: e.link });
      if (exp.auto) e.wantVideo = true;
    }
    // a change in the matching, saved a moment after the last one
    function saveClips(e) {
      clearTimeout(e.saveTimer);
      e.saveTimer = setTimeout(() => { e.session = { ...e.session, video: { ...e.session.video, clips: e.clips } }; data.save(e.session).catch((err) => { e.err = err.message; render(); }); }, 600);
    }
    async function makeVideo(e) {
      const VE = window.VideoExport;
      e.stage = "Making the video…"; e.f = 0; render();
      const live = thrown(e).filter((q) => !q.removed && e.clips[q.no]);
      if (!live.length) throw new Error("No pitch has a clip to put in the video.");
      const local = { ...e.session, video: { files: [{ url: e.url }], clips: e.clips } };
      const segments = live.map((q, i) => BC().pitchSegment({ session: local, athlete: e.p, p: q, i, count: live.length, url: e.url, rate: exp.rate, ball: false, plot: exp.plot }));
      const blob = await VE.render({
        layout: exp.layout, fill: false, segments, cancelled: () => e.cancel,
        title: exp.title ? { lines: [e.p.name || "", `Bullpen · ${BC().fmtDay(e.session.date)}`, `${live.length} pitch${live.length === 1 ? "" : "es"}${e.session.facility ? ` · ${e.session.facility}` : ""}`] } : null,
        onProgress: (text, f) => { e.stage = text; e.f = f; paint(e); },
      });
      const name = VE.fileName(e.p.name, `bullpen-${exp.layout}`, e.session.date, blob);
      const how = await VE.download(blob, name, { share: VE.isPhone() });
      e.made = { blob, name, tap: how === "tap", files: how === "files" };
    }

    // emailing his report (the PDF attached, the video's link in the message), from the coach's address
    function mailBox(e) {
      const m = e.mail;
      const to = el("input", { class: "bpa-in", type: "email", value: m.to, placeholder: "his email", "aria-label": "To", oninput: (ev) => { m.to = ev.target.value; } });
      const body = el("textarea", { class: "bpa-text", rows: 6, "aria-label": "Message", oninput: (ev) => { m.body = ev.target.value; } });
      body.value = m.body;
      const send = async () => {
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(m.to.trim())) { m.msg = "Put in his email address."; render(); return; }
        m.busy = true; m.msg = "Sending…"; render();
        try {
          await window.BullpenPdf.email({ athlete: e.p, session: e.session, notes: "" }, { to: m.to.trim(), subject: `Your bullpen report · ${BC().fmtDay(e.session.date)}`, body: m.body });
          m.sent = true; m.msg = `Sent to ${m.to.trim()}.`;
        } catch (err) { m.msg = (err && err.message) || String(err); }
        m.busy = false; render();
      };
      return el("div", { class: "bpa-mail" }, el("label", { class: "bpa-line" }, el("b", null, "To"), to), body,
        el("p", { class: "bpa-hint" }, `From your own address, his bullpen report (PDF) attached${e.link ? ", the video's link in the message (anyone with it can watch)" : ""}.`),
        el("div", { class: "bpa-row" }, el("button", { type: "button", class: "bpa-btn primary", disabled: m.busy || m.sent, onclick: send }, m.sent ? "Sent" : "Send it"), m.msg ? el("span", { class: "bpa-hint", role: "status" }, m.msg) : null));
    }

    entries.push(blank());
    render();
    data.pitchers().then((list) => { pitchers = list; render(); }, () => { pitchers = []; entries[0].err = "Couldn't load the pitchers. Check your connection and try again."; render(); });
    return { busy: () => !!working, stop: () => { stopped = true; entries.forEach((e) => { e.cancel = true; if (e.matcher) e.matcher.destroy(); if (e.url) URL.revokeObjectURL(e.url); }); awake(false); } };
  }

  window.BullpenApp = { open, mountQueue };
})();
