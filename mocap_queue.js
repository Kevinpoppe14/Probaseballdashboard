// Video Queue: motion capture for several athletes at once, worked through in the background. From the dashboard (the
// Video queue button in any Motion Capture tab: Sprint, Jump, Pitching, Hitting, Movement Screen) and from a coach's
// phone app (athlete.html, Coach tools). Pick the movement and the day it was filmed (a sprint lines up with that day's
// timed 10-yard starts in Group Testing, a jump with that day's force plate jumps), drop each athlete's videos on him,
// and each video is, one after another (mocap.js, mount with opts.auto):
//   tracked (the whole clip), worked out (a sprint's slow motion from his steps; his height and weight from his
//   profile), saved as one of his sessions on that day with its video, then made into its MP4 (horizontal for a
//   sprint, following him, his steps counted) and kept in his Google Drive folder, in the folder for that movement
//   (Sprints, Jumps…; api/drive-video.js).
// It runs while the page is open. Hide puts it away and it carries on (a pill in the corner shows how far it's got and
// brings it back); on a phone, keep the screen on and the page in front.
//   window.MoCapQueue.open({ kind, date })            full screen over the page (the dashboard, or the phone app)
//   window.MoCapQueue.open({ overlay, close })        the phone app's Coach tools (closes its sheet first)
(function () {
  const sb = () => window.supabaseClient;
  const el = (tag, attrs, ...kids) => {
    const n = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (v == null || v === false) return;
      if (k === "class") n.className = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else if (k === "value") n.value = v;
      else n.setAttribute(k, v === true ? "" : v);
    });
    kids.flat().forEach((c) => { if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c))); });
    return n;
  };
  const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const lastFirst = (name) => { const p = (name || "").trim().split(/\s+/); return p.length > 1 ? `${p[p.length - 1]}, ${p.slice(0, -1).join(" ")}` : name || ""; };
  const mb = (n) => `${Math.max(1, Math.round((n || 0) / 1048576))} MB`;
  const store = () => window.AthleteStore; // on the dashboard
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const dayText = (iso) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : "");
  const idOf = (id) => (/^\d+$/.test(String(id)) ? Number(id) : id);

  const MOVES = [["sprint", "Sprint"], ["jump", "Jump"], ["pitching", "Pitching"], ["hitting", "Hitting"], ["screen", "Movement Screen"]];
  const offered = () => MOVES.filter(([k]) => window.MoCap && window.MoCap.kinds && window.MoCap.kinds[k]);
  const kindOf = (k) => (window.MoCap && window.MoCap.kinds && window.MoCap.kinds[k]) || null;

  // ---- the data: the dashboard's store when it's there, else straight from the database ----
  const data = {
    async athletes() {
      if (store()) {
        return store().allAthletes().filter((a) => (a.status || "active").toLowerCase() === "active" && (a.name || "").trim())
          .map((a) => ({ id: a.id, name: a.name, throws: a.throws, bats: a.bats, email: a.email, position: a.position, group: a.rosterGroup }))
          .sort((a, b) => lastFirst(a.name).localeCompare(lastFirst(b.name)));
      }
      const rows = [];
      for (let from = 0; ; from += 1000) {
        const { data: page, error } = await sb().from("athletes").select("id, name:data->>name, status:data->>status, position:data->>position, throws:data->>throws, bats:data->>bats, email:data->>email, group:data->>rosterGroup").range(from, from + 999);
        if (error) throw error;
        rows.push(...page);
        if (page.length < 1000) break;
      }
      return rows.filter((p) => (p.status || "active").toLowerCase() === "active" && (p.name || "").trim())
        .map((p) => ({ ...p, id: idOf(p.id) })).sort((a, b) => lastFirst(a.name).localeCompare(lastFirst(b.name)));
    },
    // who was tested that day: a sprint's timed 10-yard starts (Group Testing), a jump's force plate jumps
    async tested(kind, date) {
      const safe = (q) => q.then((r) => (r.error ? [] : r.data || []), () => []);
      if (kind === "sprint") {
        const rows = await safe(sb().from("kpi_entries").select("athlete_id, best:data->best, value:data->value").eq("data->>kpiId", "10-yard-start").eq("data->>date", date).limit(500));
        const out = {};
        rows.forEach((r) => { const v = parseFloat(r.best != null ? r.best : r.value); const k = String(r.athlete_id); if (!out[k] || (v > 0 && v < out[k])) out[k] = v > 0 ? v : out[k] || null; });
        return Object.entries(out).map(([id, v]) => ({ id: idOf(id), note: v ? `${v.toFixed(2)} s` : "" }));
      }
      if (kind === "jump") {
        const rows = await safe(sb().from("force_tests").select("athleteId:data->>athleteId").eq("data->>date", date).limit(2000));
        return [...new Set(rows.map((r) => String(r.athleteId)))].map((id) => ({ id: idOf(id), note: "force plate" }));
      }
      return [];
    },
    async history(id) {
      if (store() && store().getMocap) return store().getMocap(id) || [];
      const { data: rows, error } = await sb().from("assessments").select("id,data").eq("athlete_id", String(id)).eq("data->>kind", "mocap").limit(300);
      return error ? [] : (rows || []).map((r) => ({ ...r.data, id: r.data.id || r.id }));
    },
    async save(rec) {
      if (store()) { store().saveAssessment(rec); return; }
      const res = await sb().from("assessments").upsert({ id: rec.id, athlete_id: String(rec.athleteId), data: rec });
      if (res.error) throw new Error("It didn't save: check your connection and try again.");
    },
    // his height (profile) and latest weight (mocap_app.js reads them from the database, on either page)
    async body(p) {
      const fromProfile = store() ? (store().allAthletes().find((a) => String(a.id) === String(p.id)) || {}).heightIn : null;
      const b = window.MoCapApp && window.MoCapApp.bodyNumbers ? await window.MoCapApp.bodyNumbers(p.id).catch(() => ({})) : {};
      return { heightIn: Number(fromProfile) || b.heightIn || null, weightLb: b.weightLb || null, weightFrom: b.weightFrom || "" };
    },
  };

  // ---- the queue: one per page, kept while the page is open (hidden or not) ----
  const Q = {
    set: { kind: "sprint", variant: "", date: today(), skeleton: true, follow: true, drive: true, download: false, layout: "horizontal" },
    groups: [], // { id, p, items: [{ id, file, kind, variant, date, status, stage, f, err, out, cancel }] }
    athletes: null, tested: { key: "", list: [] }, adding: false, working: null, layer: null, box: null, pill: null, wake: null, drive: null,
  };
  const allItems = () => Q.groups.flatMap((g) => g.items.map((it) => ({ g, it })));
  const awake = async (on) => { try { if (on && !Q.wake && navigator.wakeLock) Q.wake = await navigator.wakeLock.request("screen"); else if (!on && Q.wake) { await Q.wake.release(); Q.wake = null; } } catch (e) { Q.wake = null; } };

  function open(options = {}) {
    if (options.close) options.close(); // the phone app's sheet
    if (options.kind && MOVES.some(([k]) => k === options.kind)) Q.set.kind = options.kind;
    if (options.date) Q.set.date = options.date;
    if (!Q.layer) {
      Q.box = el("div");
      Q.layer = el("div", { class: "bpa-layer mcq-layer" },
        el("div", { class: "bpa-layer-bar" },
          el("button", { type: "button", class: "bpa-btn", title: "Put the queue away: it carries on, and the corner shows how far it's got", onclick: hide }, "Hide"),
          el("button", { type: "button", class: "bpa-btn", onclick: closeAll }, "✕ Close")),
        Q.box);
    }
    if (!Q.layer.isConnected) document.body.append(Q.layer);
    Q.layer.hidden = false;
    document.body.classList.add("mc-app-open");
    if (!Q.athletes) {
      (async () => {
        // the phone app: signed in with a dashboard account first (Coach tools › Motion Capture signs in)
        if (!store()) { const { data: d } = await sb().auth.getSession(); if (!d || !d.session) throw new Error("signin"); }
        return data.athletes();
      })().then((list) => { Q.athletes = list; Q.err = ""; render(); }, (e) => {
        Q.athletes = null;
        Q.err = (e && e.message) === "signin" ? "Sign in with your dashboard account first: close this, then Coach tools › Motion Capture signs you in." : "Couldn't load the athletes. Check your connection and try again.";
        render();
      });
    }
    if (Q.drive == null && window.BullpenCut && window.BullpenCut.useDrive) window.BullpenCut.useDrive().then((on) => { Q.drive = on; render(); }, () => { Q.drive = false; });
    render();
    pillPaint();
  }
  function hide() { if (Q.layer) Q.layer.hidden = true; document.body.classList.remove("mc-app-open"); pillPaint(); }
  function closeAll() {
    if (Q.working && !window.confirm("The queue is still working. Stop it and close? (What's done is saved.)")) return;
    allItems().forEach(({ it }) => { if (it.status === "waiting" || it.status === "working") it.cancel = true; });
    Q.groups = []; awake(false);
    if (Q.layer) Q.layer.remove();
    document.body.classList.remove("mc-app-open");
    pillPaint();
  }

  // the corner pill while it's hidden: how far it's got, and a way back
  function pillPaint() {
    const left = allItems().filter(({ it }) => it.status === "waiting" || it.status === "working").length;
    const show = Q.layer && Q.layer.hidden && (left || allItems().length);
    if (!show) { if (Q.pill) Q.pill.remove(); Q.pill = null; return; }
    if (!Q.pill) { Q.pill = el("button", { type: "button", class: "mcq-pill", onclick: () => open() }); document.body.append(Q.pill); }
    const w = Q.working;
    const failed = allItems().filter(({ it }) => it.status === "failed").length;
    Q.pill.textContent = w ? `Video queue · ${w.g.p.name}: ${w.it.stage || "working"} ${Math.round((w.it.f || 0) * 100)}% · ${left} to go` : left ? `Video queue · ${left} waiting` : `Video queue · done${failed ? ` (${failed} didn't work)` : ""}`;
  }

  // ---- the page ----
  function render() {
    if (!Q.box) return;
    const s = Q.set, K = kindOf(s.kind);
    const parts = [el("h2", null, "Video Queue ", el("small", null, "motion capture, several athletes at once"))];
    if (Q.err) { Q.box.replaceChildren(el("div", { class: "bpa mcq" }, ...parts, el("p", { class: "bpa-err" }, Q.err))); return; }
    parts.push(el("p", { class: "bpa-hint" }, "Pick the movement and the day it was filmed, then drop each athlete's videos on him (as many as you like). They're worked through one at a time in the background: tracked, worked out, saved to his sessions on that day with the video, then made into the video with his numbers and the DST logo and kept in his Google Drive folder. Hide the queue and keep working; keep this page open until it's done (on a phone, the screen on and the page in front)."));
    // the movement, its kind of start or jump, the day
    const variants = K && K.variants ? K.variants.options : null;
    if (variants && !variants.some((o) => o[0] === s.variant)) s.variant = variants[0][0];
    const dateIn = el("input", { type: "date", class: "bpa-in mcq-date", value: s.date, max: today(), onchange: (e) => { s.date = e.target.value || today(); loadTested(); render(); } });
    const tested = Q.tested.key === `${s.kind}|${s.date}` ? Q.tested.list : null;
    parts.push(el("section", { class: "bpa-step" },
      el("div", { class: "bpa-row" }, el("b", null, "Movement"),
        offered().map(([k, t]) => el("button", { type: "button", class: `bpa-btn${s.kind === k ? " on" : ""}`, "aria-pressed": s.kind === k ? "true" : "false", onclick: () => { s.kind = k; s.variant = ""; loadTested(); render(); } }, t))),
      variants ? el("div", { class: "bpa-row" }, el("b", null, K.variants.label || "Type"),
        el("select", { "aria-label": K.variants.label || "Type", onchange: (e) => { s.variant = e.target.value; } }, variants.map(([v, t]) => el("option", { value: v, selected: s.variant === v }, t)))) : null,
      el("div", { class: "bpa-row" }, el("b", null, "Filmed"), dateIn, el("span", { class: "bpa-hint" }, dayText(s.date))),
      s.kind === "sprint" ? el("p", { class: "bpa-hint" }, "Each video lines up with that day's timed 10-yard start from Group Testing (his latest before it if he wasn't timed that day). Filmed in slow motion: 240 or 120 is worked out from his steps.") : null,
      el("div", { class: "bpa-row" }, el("b", null, "Video"),
        toggle("Skeleton", s.skeleton, (on) => { s.skeleton = on; }),
        s.kind === "sprint" ? toggle("Follow him", s.follow, (on) => { s.follow = on; }) : null,
        Q.drive === false ? el("span", { class: "bpa-hint" }, "Google Drive isn't set up, so each video goes to your downloads.") : toggle("Save to Google Drive", s.drive, (on) => { s.drive = on; }),
        toggle("Download each", s.download || Q.drive === false, (on) => { s.download = on; }, Q.drive === false)),
      s.kind === "sprint" ? el("p", { class: "bpa-hint" }, "A sprint's video is horizontal (16:9).") : el("div", { class: "bpa-row" }, el("b", null, "Shape"),
        [["horizontal", "Horizontal (TV)"], ["vertical", "Vertical (phone)"]].map(([k, t]) => el("button", { type: "button", class: `bpa-btn${s.layout === k ? " on" : ""}`, onclick: () => { s.layout = k; render(); } }, t)))));
    // who was tested that day, to add with a tap
    if (tested && tested.length && Q.athletes) {
      const known = tested.map((t) => ({ ...t, p: Q.athletes.find((a) => String(a.id) === String(t.id)) })).filter((t) => t.p && !Q.groups.some((g) => String(g.p.id) === String(t.id)));
      if (known.length) {
        parts.push(el("section", { class: "bpa-step" },
          el("h3", null, s.kind === "sprint" ? `Timed on ${dayText(s.date)}` : `Jumped on ${dayText(s.date)}`),
          el("div", { class: "mcq-chips" }, known.sort((a, b) => lastFirst(a.p.name).localeCompare(lastFirst(b.p.name))).map((t) =>
            el("button", { type: "button", class: "bpa-btn mcq-chip", onclick: () => { addGroup(t.p); } }, `+ ${t.p.name}${t.note ? ` · ${t.note}` : ""}`))),
          known.length > 1 ? el("button", { type: "button", class: "bpa-btn", onclick: () => { known.forEach((t) => addGroup(t.p, true)); render(); } }, `Add all ${known.length}`) : null));
      }
    }
    Q.groups.forEach((g, i) => parts.push(card(g, i)));
    // another athlete
    if (Q.adding || !Q.groups.length) parts.push(picker());
    else parts.push(el("div", { class: "bpa-row" }, el("button", { type: "button", class: "bpa-btn primary", onclick: () => { Q.adding = true; render(); } }, "+ Add an athlete")));
    const items = allItems(), done = items.filter(({ it }) => it.status === "done").length, failed = items.filter(({ it }) => it.status === "failed").length, left = items.filter(({ it }) => it.status === "waiting" || it.status === "working").length;
    if (items.length) parts.push(el("p", { class: "bpa-hint mcq-sum" }, `${items.length} video${items.length === 1 ? "" : "s"}: ${done} done${failed ? `, ${failed} didn't work` : ""}${left ? `, ${left} to go` : ""}.`));
    Q.box.replaceChildren(el("div", { class: "bpa mcq" }, ...parts));
    pillPaint();
  }
  const toggle = (label, on, set, disabled) => el("label", { class: "bpa-check" }, el("input", { type: "checkbox", checked: on, disabled, onchange: (ev) => { set(ev.target.checked); render(); } }), ` ${label}`);

  function picker() {
    const results = el("div", { class: "qa-list" });
    const search = el("input", { type: "search", class: "bpa-search", placeholder: "Search for an athlete", "aria-label": "Search for an athlete", autocomplete: "off" });
    const show = () => {
      const q = search.value.trim().toLowerCase();
      const pool = (Q.athletes || []).filter((a) => !Q.groups.some((g) => String(g.p.id) === String(a.id)));
      const hits = pool.filter((a) => !q || a.name.toLowerCase().includes(q)).slice(0, q ? 10 : 6);
      results.replaceChildren(...(Q.athletes ? hits.map((a) => el("button", { type: "button", class: "qa-row", onclick: () => { addGroup(a); } }, lastFirst(a.name))) : [el("div", { class: "qa-empty" }, "Loading the athletes…")]),
        ...(q && Q.athletes && !hits.length ? [el("div", { class: "qa-empty" }, "No active athlete matches that.")] : []));
    };
    search.addEventListener("input", show);
    show();
    setTimeout(() => { if (search.isConnected) search.focus(); }, 30);
    return el("section", { class: "bpa-step" }, el("h3", null, "Add an athlete",
      Q.groups.length ? el("button", { type: "button", class: "bpa-x", "aria-label": "Cancel", onclick: () => { Q.adding = false; render(); } }, "✕") : null), search, results);
  }
  function addGroup(p, quiet) {
    if (!Q.groups.some((g) => String(g.p.id) === String(p.id))) Q.groups.push({ id: uid(), p, items: [] });
    Q.adding = false;
    if (!quiet) render();
  }
  // his videos, added with the movement, kind and day as they're set now
  function addFiles(g, files) {
    const vids = [...files].filter((f) => /^video\//.test(f.type || "") || /\.(mov|mp4|m4v|webm|avi)$/i.test(f.name || ""));
    if (!vids.length) return;
    const s = Q.set;
    vids.forEach((file) => g.items.push({ id: uid(), file, kind: s.kind, variant: s.variant, date: s.date, opt: { skeleton: s.skeleton, follow: s.follow, drive: s.drive && Q.drive !== false, download: s.download || Q.drive === false, layout: s.kind === "sprint" ? "horizontal" : s.layout }, status: "waiting", stage: "", f: 0, err: "", out: null, cancel: false }));
    render();
    pump();
  }

  function card(g, i) {
    const input = el("input", { type: "file", accept: "video/*", multiple: true, hidden: true, onchange: (ev) => { const fs = ev.target.files; addFiles(g, fs ? [...fs] : []); ev.target.value = ""; } });
    const busy = g.items.some((it) => it.status === "working");
    const drop = el("div", { class: "mcq-drop", tabindex: "0", role: "button", "aria-label": `Add videos for ${g.p.name}`, onclick: () => input.click(), onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } } },
      el("b", null, g.items.length ? "+ More videos" : "Drop his videos here"), el("span", null, " or tap to choose"));
    drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("over"));
    drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); addFiles(g, e.dataTransfer && e.dataTransfer.files ? [...e.dataTransfer.files] : []); });
    return el("section", { class: `bpa-step${busy ? " working" : ""}` },
      el("h3", null, el("span", { class: "bpa-n" }, i + 1), g.p.name,
        !busy ? el("button", { type: "button", class: "bpa-x", "aria-label": `Take ${g.p.name} out of the queue`, onclick: () => { g.items.forEach((it) => { it.cancel = true; }); Q.groups.splice(Q.groups.indexOf(g), 1); render(); } }, "✕") : null),
      g.items.map((it) => itemRow(g, it)), drop, input);
  }
  const moveName = (k) => (MOVES.find((m) => m[0] === k) || [k, k])[1];
  const variantName = (it) => { const K = kindOf(it.kind); return K && K.variants && it.variant ? (K.variants.options.find((o) => o[0] === it.variant) || [it.variant, it.variant])[1] : ""; };
  function itemRow(g, it) {
    const what = [it.file.name || "Video", mb(it.file.size), moveName(it.kind), variantName(it), dayText(it.date)].filter(Boolean).join(" · ");
    const kids = [el("div", { class: "mcq-file" }, what)];
    if (it.status === "working") {
      kids.push(el("div", { class: "bpa-busy", "data-item": it.id, role: "status" }, el("progress", { max: 1, value: it.f || 0 }), el("span", null, `${it.stage || "Starting"} ${Math.round((it.f || 0) * 100)}%`),
        el("button", { type: "button", class: "bpa-btn", onclick: () => { it.cancel = true; it.stage = "Stopping"; paint(it); } }, "Stop")));
    } else if (it.status === "waiting") {
      kids.push(el("div", { class: "bpa-row" }, el("span", { class: "bpa-hint" }, "Waiting its turn."), el("button", { type: "button", class: "bpa-btn", onclick: () => { g.items.splice(g.items.indexOf(it), 1); render(); } }, "Remove")));
    } else if (it.status === "failed") {
      kids.push(el("p", { class: "bpa-err" }, it.err), el("div", { class: "bpa-row" },
        el("button", { type: "button", class: "bpa-btn", onclick: () => { it.status = "waiting"; it.err = ""; it.cancel = false; render(); pump(); } }, "Try again"),
        el("button", { type: "button", class: "bpa-btn", onclick: () => { g.items.splice(g.items.indexOf(it), 1); render(); } }, "Remove")));
    } else if (it.status === "done") {
      const o = it.out || {};
      const nums = o.rec && o.rec.metrics ? summaryText(it.kind, o.rec.metrics) : "";
      kids.push(el("p", { class: "bpa-done" }, `Saved to his ${moveName(it.kind)} sessions on ${dayText(it.date)}${o.drive ? ` and his Google Drive folder (${o.drive.folder})` : ""}.${nums ? ` ${nums}` : ""}${o.warn || ""}`),
        el("div", { class: "bpa-row" },
          o.drive ? el("a", { class: "bpa-btn bpa-a", href: o.drive.link, target: "_blank", rel: "noopener" }, "Watch in Drive") : null,
          o.blob && window.VideoExport ? el("button", { type: "button", class: "bpa-btn", onclick: () => window.VideoExport.download(o.blob, o.name, { share: window.VideoExport.isPhone() }) }, window.VideoExport.isPhone() ? "Save to camera roll" : "Download") : null));
    }
    return el("div", { class: `mcq-item ${it.status}` }, ...kids);
  }
  // a few of its numbers, for a glance
  function summaryText(kind, m) {
    const pick = kind === "sprint" ? [["stepsTo10", "steps to 10 yd"], ["stepsTo5", "steps to 5 yd"], ["stepRate", "steps/s"]]
      : kind === "jump" ? [["jumpHeight", "in jump"], ["height", "in"]]
        : [];
    const bits = pick.filter(([k]) => m[k] != null && m[k] !== "").map(([k, t]) => `${m[k]} ${t}`);
    return bits.length ? `${bits.join(", ")}.` : "";
  }
  // just the progress bar while it works, not the whole page
  function paint(it) {
    pillPaint();
    if (!Q.box || (Q.layer && Q.layer.hidden)) return;
    const b = Q.box.querySelector(`.bpa-busy[data-item="${it.id}"]`);
    if (!b) { render(); return; }
    b.querySelector("progress").value = it.f || 0;
    b.querySelector("span").textContent = `${it.stage || "Working"} ${Math.round((it.f || 0) * 100)}%`;
  }

  // who was tested on the day chosen, for the movement chosen
  function loadTested() {
    const key = `${Q.set.kind}|${Q.set.date}`;
    if (Q.tested.key === key) return;
    Q.tested = { key, list: [] };
    data.tested(Q.set.kind, Q.set.date).then((list) => { if (Q.tested.key === key) { Q.tested.list = list; render(); } }, () => {});
  }

  // ---- the work: one video at a time ----
  async function pump() {
    if (Q.working) return;
    const next = allItems().find(({ it }) => it.status === "waiting");
    if (!next) { awake(false); render(); return; }
    Q.working = next;
    const { g, it } = next;
    it.status = "working"; it.stage = "Starting"; it.f = 0; it.cancel = false;
    awake(true); render();
    const hidden = el("div", { class: "mcq-hidden", "aria-hidden": "true" });
    document.body.append(hidden);
    let tool = null;
    try {
      if (!window.MoCap) throw new Error("Motion capture didn't load. Reload the page.");
      const [body, history] = await Promise.all([data.body(g.p), data.history(g.p.id)]);
      let hist = history.slice();
      tool = window.MoCap.mount(hidden, {
        kind: it.kind, date: it.date,
        athlete: { id: g.p.id, name: g.p.name, throws: g.p.throws || "", bats: g.p.bats || "", email: g.p.email || "", heightIn: body.heightIn, weightLb: body.weightLb, weightFrom: body.weightFrom },
        history: () => hist,
        onSave: async (rec) => { const r = { ...rec, athleteId: idOf(g.p.id) }; await data.save(r); hist = [...hist.filter((h) => h.id !== r.id), r]; },
        auto: {
          file: it.file, variant: it.variant, ...it.opt,
          onStatus: (text, fr) => { it.stage = text; it.f = fr; paint(it); },
          cancelled: () => it.cancel,
        },
      });
      it.out = await tool.done;
      it.status = "done";
    } catch (e) {
      it.status = "failed";
      it.err = (e && e.message) === "cancelled" ? "Stopped. Try again to start it over." : `Couldn't do it: ${(e && e.message) || e}`;
    }
    try { if (tool) tool.close(); } catch (e) { /* gone anyway */ }
    hidden.remove();
    it.stage = ""; Q.working = null;
    render();
    setTimeout(pump, 50);
  }

  // leaving with work still to do
  window.addEventListener("beforeunload", (e) => { if (Q.working || allItems().some(({ it }) => it.status === "waiting")) { e.preventDefault(); e.returnValue = ""; } });

  window.MoCapQueue = { open: (o) => { open(o); loadTested(); }, busy: () => !!Q.working };
})();
