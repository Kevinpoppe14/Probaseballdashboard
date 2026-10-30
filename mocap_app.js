// Motion capture from the Coach tab of a coach's own phone app (athlete.html, "Coach tools"): sign in with the
// dashboard account if need be, pick a pitcher, then film or choose his delivery and analyze it full screen with the
// same tool as the dashboard's Pitching › Motion Capture (mocap.js). Sessions save to the pitcher's record, so they
// show on his profile.
//   window.MoCapApp.open({ overlay, close })   overlay and close are the app's sheet layer and its close
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
  const lastFirst = (name) => { const p = (name || "").trim().split(/\s+/); return p.length > 1 ? `${p[p.length - 1]}, ${p.slice(0, -1).join(" ")}` : name || ""; };
  let ctx = null;
  let pitchers = null; // active pitchers, once read

  const sheet = (...kids) => {
    ctx.overlay.replaceChildren(el("div", { class: "sheet" }, el("button", { class: "close", "aria-label": "Close", onclick: ctx.close }, "×"), ...kids));
    ctx.overlay.className = "overlay show";
  };
  const note = (text) => el("div", { class: "swap-coach" }, text);

  async function open(options) {
    ctx = { ...(ctx || {}), ...options };
    sheet(el("h2", null, "Motion Capture"), note("Loading…"));
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
        pitchers = rows.filter((p) => (p.status || "active").toLowerCase() === "active" && (/pitcher/i.test(p.position || "") || p.group === "coaches") && (p.name || "").trim())
          .sort((a, b) => lastFirst(a.name).localeCompare(lastFirst(b.name)));
      }
      pick();
    } catch (e) { sheet(el("h2", null, "Motion Capture"), note("Couldn't load the pitchers. Check your connection and try again.")); }
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

  // which pitcher: type a few letters
  function pick() {
    const results = el("div", { class: "qa-list" });
    const search = el("input", { type: "search", placeholder: "Search for a pitcher or coach", "aria-label": "Search for a pitcher or coach", autocomplete: "off" });
    const show = () => {
      const q = search.value.trim().toLowerCase();
      const hits = (q ? pitchers.filter((p) => p.name.toLowerCase().includes(q)) : pitchers).slice(0, q ? 12 : 8);
      results.replaceChildren(...hits.map((p) => el("button", { class: "qa-row", onclick: () => capture(p) }, lastFirst(p.name))),
        ...(q && !hits.length ? [el("div", { class: "qa-empty" }, "No active pitcher or coach matches that.")] : []));
    };
    search.addEventListener("input", show);
    sheet(el("h2", null, "Motion Capture"), note("Film a delivery in slow motion (tips on the next screen) and get his mechanics in numbers. Who is it?"), search, results);
    show();
    setTimeout(() => search.focus(), 50);
  }

  // the tool, full screen
  async function capture(p) {
    ctx.close();
    const box = el("div");
    const layer = el("div", { class: "mc-app-layer" },
      el("div", { class: "mc-app-bar" }, el("button", { class: "mc-app-back", onclick: () => { layer.remove(); document.body.classList.remove("mc-app-open"); open({}); } }, "‹ Pitchers"),
        el("button", { class: "mc-app-close", "aria-label": "Close", onclick: () => { layer.remove(); document.body.classList.remove("mc-app-open"); } }, "×")),
      box);
    document.body.append(layer);
    document.body.classList.add("mc-app-open");
    box.append(note("Loading…"));
    const { data, error } = await sb.from("assessments").select("id,data").eq("athlete_id", String(p.id)).eq("data->>kind", "mocap").limit(200);
    let history = error ? [] : (data || []).map((r) => r.data);
    box.replaceChildren();
    if (!window.MoCap) { box.append(note("Motion capture didn't load. Reload the page.")); return; }
    window.MoCap.mount(box, {
      athlete: { id: String(p.id), name: p.name, throws: p.throws || "" },
      history: () => history,
      onSave: async (rec) => {
        // the dashboard keeps an athlete's id as a number inside each record
        const record = { ...rec, athleteId: /^\d+$/.test(String(p.id)) ? Number(p.id) : p.id };
        const res = await sb.from("assessments").upsert({ id: rec.id, athlete_id: String(p.id), data: record });
        if (res.error) throw new Error("check your connection and try again");
        history = [...history, record];
      },
    });
  }

  window.MoCapApp = { open };
})();
