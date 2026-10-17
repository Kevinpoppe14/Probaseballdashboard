// Guided tours: a part of the page is lit while the rest is dimmed, with a card beside it saying what it does, and
// Back / Next / Skip. Used by the dashboard (Team Overview and Player Profiles, index.html) and the phone app
// (athlete.js); Coach Mode has its own (coach.js), which this follows in look.
//
//   DSTTour.start(steps)                         plays a tour now
//   DSTTour.autoPlay(name, steps, { times, who }) plays it by itself the first `times` times (default once) on
//                                                 this login: counted on this device and, when someone is
//                                                 signed in, on their login too, so a second device doesn't
//                                                 play it again
//
// A step is { title, text } plus, to light something, `sel` (a CSS selector; the first match that is showing).
// `optional: true` skips the step when there is nothing to light (an athlete with no warm-up, say); otherwise
// the card sits in the middle of a dimmed screen. The page scrolls to whatever is lit.
(function () {
  const css = `
  .dst-tour { position: fixed; inset: 0; z-index: 3000; }
  .dst-tour.dim { background: rgba(0, 0, 0, 0.72); }
  .dst-tour-spot { position: fixed; border-radius: 10px; box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.72), 0 0 0 2px var(--accent, var(--dst-red, #c8102e)); transition: top 0.25s, left 0.25s, width 0.25s, height 0.25s; pointer-events: none; }
  .dst-tour-card { position: fixed; box-sizing: border-box; width: 360px; padding: 16px 16px 12px; background: var(--panel, #161616); color: var(--text, #f2f2f2); border: 1px solid var(--border, #3a3a3a); border-top: 3px solid var(--accent, var(--dst-red, #c8102e)); border-radius: 12px; box-shadow: 0 16px 40px rgba(0, 0, 0, 0.55); transition: top 0.25s, left 0.25s; font-family: inherit; }
  .dst-tour-count { font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--dim, var(--text-dim, #9a9a9a)); }
  .dst-tour-card h2 { margin: 4px 0 6px; font-size: 19px; font-weight: 800; line-height: 1.15; color: inherit; display: block; }
  .dst-tour-card p { margin: 0 0 12px; font-size: 14px; line-height: 1.45; color: inherit; opacity: 0.88; }
  .dst-tour-foot { display: flex; align-items: center; gap: 8px; }
  .dst-tour-foot button { height: 38px; padding: 0 16px; border-radius: 8px; font: inherit; font-size: 14px; font-weight: 700; cursor: pointer; color: inherit; }
  .dst-tour-skip { margin-right: auto; padding: 0 !important; border: none; background: none; font-weight: 400 !important; text-decoration: underline; opacity: 0.7; }
  .dst-tour-back { border: 1px solid var(--border, #555); background: none; }
  .dst-tour-next { margin-left: auto; border: none; background: var(--accent, var(--dst-red, #c8102e)); color: #fff !important; }
  .dst-tour-back + .dst-tour-next { margin-left: 0; }
  @media print { .dst-tour { display: none; } }`;
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  const el = (tag, attrs, ...kids) => {
    const n = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (v == null || v === false) return;
      if (k === "class") n.className = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    });
    kids.flat().forEach((c) => { if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c))); });
    return n;
  };
  // the first match that is actually on screen (has a size)
  const find = (sel) => {
    if (!sel) return null;
    return Array.from(document.querySelectorAll(sel)).find((n) => { const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0; }) || null;
  };

  // pinned to the screen (a bottom bar, a sticky header): scrolling won't move it
  const pinned = (n) => {
    for (; n && n !== document.body; n = n.parentElement) { const p = getComputedStyle(n).position; if (p === "fixed" || p === "sticky") return true; }
    return false;
  };

  let tourEl = null;
  function end() {
    if (!tourEl) return;
    tourEl._off();
    tourEl.remove();
    tourEl = null;
  }
  function start(steps, opts) {
    end();
    if (!steps || !steps.length) return;
    const onEnd = (opts && opts.onEnd) || null;
    let step = 0;
    const spot = el("div", { class: "dst-tour-spot" });
    const card = el("div", { class: "dst-tour-card", role: "dialog", "aria-modal": "true", "aria-labelledby": "dst-tour-title" });
    tourEl = el("div", { class: "dst-tour" }, spot, card);
    document.body.append(tourEl);
    const place = () => {
      if (!tourEl) return;
      const target = find(steps[step].sel);
      const r = target && target.getBoundingClientRect();
      const vw = window.innerWidth, vh = window.innerHeight, gap = 12;
      card.style.width = `${Math.min(360, vw - 24)}px`;
      const cw = card.offsetWidth, ch = card.offsetHeight;
      let top, left;
      if (!r) { // nothing to light: the card in the middle of a dimmed screen
        spot.hidden = true;
        top = (vh - ch) / 2; left = (vw - cw) / 2;
      } else {
        const pad = 6;
        spot.hidden = false;
        const t = Math.max(2, r.top - pad), l = Math.max(2, r.left - pad); // kept on screen, so the outline shows all round
        Object.assign(spot.style, { top: `${t}px`, left: `${l}px`, width: `${Math.max(0, Math.min(vw - 2, r.right + pad) - l)}px`, height: `${Math.max(0, Math.min(vh - 2, r.bottom + pad) - t)}px` });
        if (r.bottom + gap + ch <= vh - 8) { top = r.bottom + gap; left = r.left; } // below
        else if (r.top - gap - ch >= 8) { top = r.top - gap - ch; left = r.left; } // above
        else if (r.right + gap + cw <= vw - 8) { top = r.top; left = r.right + gap; } // to the right
        else if (r.left - gap - cw >= 8) { top = r.top; left = r.left - gap - cw; } // to the left
        else { top = vh - ch - 12; left = (vw - cw) / 2; } // a big area: along the bottom, over it
      }
      tourEl.classList.toggle("dim", spot.hidden);
      card.style.top = `${Math.max(8, Math.min(top, vh - ch - 8))}px`;
      card.style.left = `${Math.max(8, Math.min(left, vw - cw - 8))}px`;
    };
    const finish = () => { end(); if (onEnd) onEnd(); };
    const go = (n, dir) => {
      if (n < 0) return;
      // optional steps with nothing to light are passed over, in whichever direction we're going
      while (n >= 0 && n < steps.length && steps[n].optional && !find(steps[n].sel)) n += dir || 1;
      if (n < 0) return;
      if (n >= steps.length) { finish(); return; }
      step = n;
      const s = steps[step];
      const shown = steps.filter((x) => x === s || !x.optional || find(x.sel)); // counted without the skipped ones
      const last = shown[shown.length - 1] === s;
      card.replaceChildren(
        el("div", { class: "dst-tour-count" }, `${shown.indexOf(s) + 1} of ${shown.length}`),
        el("h2", { id: "dst-tour-title" }, s.title),
        el("p", null, s.text),
        el("div", { class: "dst-tour-foot" },
          last ? null : el("button", { class: "dst-tour-skip", type: "button", onclick: finish }, "Skip tour"),
          step ? el("button", { class: "dst-tour-back", type: "button", onclick: () => go(step - 1, -1) }, "Back") : null,
          el("button", { class: "dst-tour-next", type: "button", onclick: () => go(step + 1, 1) }, last ? "Done" : step ? "Next" : "Show me")));
      // bring it into view first: its top near the top of the screen when it's taller than the screen
      const target = find(s.sel);
      if (target) {
        const r = target.getBoundingClientRect();
        if (!pinned(target) &&(r.top < 70 || r.bottom > window.innerHeight - 40)) {
          target.scrollIntoView({ block: r.height > window.innerHeight * 0.6 ? "start" : "center" });
          if (r.height > window.innerHeight * 0.6) window.scrollBy(0, -80);
        }
      }
      place();
      setTimeout(place, 60); // again once anything that scrolled has settled
      const next = card.querySelector(".dst-tour-next");
      if (next) next.focus({ preventScroll: true });
    };
    const keys = (e) => {
      if (e.key === "Escape") finish();
      else if (e.key === "ArrowRight") go(step + 1, 1);
      else if (e.key === "ArrowLeft") go(step - 1, -1);
    };
    tourEl._off = () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      document.removeEventListener("keydown", keys);
    };
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    document.addEventListener("keydown", keys);
    go(0, 1);
  }

  // How many times this tour has played by itself for `who`: on this device, and on the signed-in login.
  const key = (name, who) => `tourViews:${name}:${(who || "").toLowerCase()}`;
  const localViews = (name, who) => { try { return Number(localStorage.getItem(key(name, who))) || 0; } catch (e) { return 0; } };
  async function autoPlay(name, steps, opts) {
    const times = (opts && opts.times) || 1, who = (opts && opts.who) || "";
    if (tourEl || localViews(name, who) >= times) return false;
    const sb = window.supabaseClient;
    let user = null;
    if (opts && opts.useLogin !== false && sb) {
      try { const { data } = await sb.auth.getUser(); user = data && data.user; } catch (e) { user = null; }
    }
    const onLogin = user ? Number(((user.user_metadata || {}).tourViews || {})[name]) || 0 : 0;
    const seen = Math.max(localViews(name, who), onLogin);
    if (seen >= times) { try { localStorage.setItem(key(name, who), String(seen)); } catch (e) { /* fine */ } return false; }
    if (tourEl) return false;
    try { localStorage.setItem(key(name, who), String(seen + 1)); } catch (e) { /* private window: the login still counts it */ }
    if (user) sb.auth.updateUser({ data: { tourViews: { ...((user.user_metadata || {}).tourViews || {}), [name]: seen + 1 } } }).catch(() => {});
    start(steps, opts);
    return true;
  }

  window.DSTTour = { start, autoPlay, end, playing: () => !!tourEl };
})();
