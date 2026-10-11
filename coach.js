// Coach Board — several athletes' programs side by side, for a coach running a session from a tablet, a phone
// or a browser. The coach signs in with their dashboard account, adds whichever athletes they want (anyone on
// any roster), and taps between them. Each athlete's program is the same page the athlete sees on their own
// phone link (athlete.html), shown in a frame in "coach" mode: it reads and writes under the coach's login, so
// weights, reps and sessions logged here are recorded as entered by a coach. No link or token is involved.
//
// Which athletes are on the board is remembered on this device only (per signed-in coach).
(function () {
  const sb = window.supabaseClient;
  const $ = (id) => document.getElementById(id);
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

  let user = null;
  let athletes = []; // everyone, as { id, name, sub, cubs }
  let picked = []; // ids on the board, in the order they were added
  let active = null; // id being shown
  const frames = new Map(); // id -> the athlete's page, kept alive while they are on the board

  const storeKey = () => `coachBoard:${user.id}`;
  const remember = () => { try { localStorage.setItem(storeKey(), JSON.stringify({ picked, active })); } catch (e) { /* private window: the board just won't be remembered */ } };
  const recall = () => { try { return JSON.parse(localStorage.getItem(storeKey()) || "null") || {}; } catch (e) { return {}; } };
  const byId = (id) => athletes.find((a) => a.id === id);
  const lastFirst = (name) => { const p = (name || "").trim().split(/\s+/); return p.length > 1 ? `${p[p.length - 1]}, ${p.slice(0, -1).join(" ")}` : name || ""; };

  // ---- the athlete list and the picked athlete's page ----------------------------------------------
  function show(id) {
    active = id;
    const stage = $("stage");
    if (!id) { stage.replaceChildren(el("div", { class: "empty" }, picked.length ? "Pick an athlete." : "Add an athlete to see their program.")); frames.forEach((f) => f.remove()); frames.clear(); draw(); remember(); return; }
    stage.querySelectorAll(".empty").forEach((n) => n.remove());
    if (!frames.has(id)) {
      const a = byId(id);
      const frame = el("iframe", { src: `athlete.html?coach=1&aid=${encodeURIComponent(id)}${a && a.cubs ? "&team=cubs" : ""}`, title: a ? a.name : "Athlete" });
      frames.set(id, frame);
      stage.append(frame);
    }
    frames.forEach((f, fid) => { f.hidden = fid !== id; });
    draw();
    remember();
  }
  function add(id) {
    if (!picked.includes(id)) picked.push(id);
    $("search").value = "";
    $("results").hidden = true;
    show(id);
  }
  function remove(id) {
    picked = picked.filter((x) => x !== id);
    const f = frames.get(id);
    if (f) { f.remove(); frames.delete(id); }
    show(active === id ? (picked[picked.length - 1] || null) : active);
  }
  function draw() {
    const list = $("list");
    if (!picked.length) { list.replaceChildren(el("div", { class: "list-hint" }, "No athletes yet. Search above to add one.")); return; }
    list.replaceChildren(...picked.map((id) => {
      const a = byId(id) || { name: "Unknown athlete", sub: "" };
      return el("div", { class: `who${id === active ? " on" : ""}` },
        el("button", { class: "who-pick", onclick: () => show(id), "aria-pressed": id === active ? "true" : "false" }, el("span", null, a.name), el("small", null, a.sub)),
        el("button", { class: "who-x", title: `Take ${a.name} off the board`, "aria-label": `Take ${a.name} off the board`, onclick: () => remove(id) }, "×"));
    }));
  }

  // ---- adding: type a few letters, pick from the matches ---------------------------------------------
  function search() {
    const q = $("search").value.trim().toLowerCase();
    const box = $("results");
    if (!q) { box.hidden = true; return; }
    const hits = athletes.filter((a) => !picked.includes(a.id) && `${a.name} ${a.sub}`.toLowerCase().includes(q)).slice(0, 12);
    box.replaceChildren(...(hits.length
      ? hits.map((a) => el("button", { class: "result", onclick: () => add(a.id) }, lastFirst(a.name), el("small", null, a.sub)))
      : [el("div", { class: "result none" }, athletes.some((a) => picked.includes(a.id) && a.name.toLowerCase().includes(q)) ? "Already on the board." : "No athlete matches that.")]));
    box.hidden = false;
  }

  async function loadAthletes() {
    const all = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from("athletes").select("id,data").range(from, from + 999);
      if (error) throw error;
      all.push(...data);
      if (data.length < 1000) break;
    }
    athletes = all.map((r) => {
      const d = r.data || {};
      const coach = d.rosterGroup === "coaches";
      const cubsRoster = d.rosterGroup === "cubs-40man";
      const where = coach ? "Coach" : d.dstLocation || (cubsRoster ? "Chicago Cubs" : "");
      const status = (d.status || "active").toLowerCase();
      return {
        id: String(r.id),
        name: d.name || "Unnamed",
        sub: [where, d.position && d.position !== "Unassigned" ? d.position : "", status !== "active" ? status : ""].filter(Boolean).join(" · "),
        cubs: cubsRoster && !d.dstLocation, // Cubs-only players get the Cubs look, as on their own link
      };
    }).sort((a, b) => lastFirst(a.name).localeCompare(lastFirst(b.name)));
  }

  // ---- signing in ------------------------------------------------------------------------------------
  async function open(session) {
    user = session.user;
    $("login").hidden = true;
    $("board").hidden = false;
    $("me").textContent = user.email || "";
    try { await loadAthletes(); }
    catch (e) { $("stage").replaceChildren(el("div", { class: "empty" }, "Could not load the roster. Check your connection and reload.")); return; }
    const saved = recall();
    picked = (saved.picked || []).filter((id) => byId(id)); // anyone removed from the roster since drops off
    show(picked.includes(saved.active) ? saved.active : picked[0] || null);
  }
  function close() {
    user = null; picked = []; active = null;
    frames.forEach((f) => f.remove()); frames.clear();
    $("board").hidden = true;
    $("login").hidden = false;
  }

  $("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("login-btn").disabled = true;
    $("login-err").textContent = "";
    const { error } = await sb.auth.signInWithPassword({ email: $("email").value.trim(), password: $("password").value });
    $("login-btn").disabled = false;
    if (error) $("login-err").textContent = error.message || "Sign-in failed.";
    else $("password").value = "";
  });
  $("signout").addEventListener("click", () => sb.auth.signOut());
  $("search").addEventListener("input", search);
  $("search").addEventListener("focus", search);
  $("search").addEventListener("keydown", (e) => {
    if (e.key === "Escape") { $("results").hidden = true; e.target.blur(); }
    if (e.key === "Enter") { const first = $("results").querySelector("button.result"); if (first) first.click(); }
  });
  document.addEventListener("click", (e) => { if (!e.target.closest(".add")) $("results").hidden = true; });

  sb.auth.getSession().then(({ data }) => { if (data && data.session) open(data.session); else close(); });
  sb.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT") close();
    else if (event === "SIGNED_IN" && session && !user) open(session);
  });
})();
