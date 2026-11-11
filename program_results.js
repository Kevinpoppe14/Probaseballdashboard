// Program results: what an athlete's block of a program did for him, and the same averaged over everyone who has
// finished a program (or every program a coach wrote). Shared by the dashboard (the Results panel in the program
// builder and Kevin's Program Results page, window.ProgramResults) and the program-complete email
// (api/program-complete-email.js, require("../program_results.js")), so all three show the same numbers.
//
// One block's result (blockResult), over the block's dates (its plan's start date + its weeks):
//   compliance   sessions with anything logged ÷ sessions scheduled (weeks that have started only). A daily program
//                (re-ed) counts days.
//   strength     each lift's estimated 1RM (Epley, from the weight and reps logged on each set of 12 reps or fewer;
//                the reps prescribed when none were written in) at its best in the first two weeks of the block and in
//                the last two; the change, and the average change over the lifts logged in both. Blocks of 3 weeks or
//                more only.
//   cmj          jump height, relative peak power and mRSI: the latest force plate test from 4 weeks before the block
//                to the end of its first week, against the latest from its last two weeks to a week after it ends.
//   bodyweight   the same, from the phone's pre-lift weigh-ins and the force plate's system weight.
// Averages (summarize) leave out any athlete without that number and say how many it's over.
(function (root) {
  const DAY = 864e5;
  const parse = (s) => new Date(`${s}T12:00:00Z`);
  const iso = (d) => d.toISOString().slice(0, 10);
  const addDays = (s, n) => iso(new Date(parse(s).getTime() + n * DAY));
  const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / DAY);
  const N_TO_LB = 1 / 4.4482216152605;
  const r1 = (v) => (v == null || !isFinite(v) ? null : Math.round(v * 10) / 10);
  const r2 = (v) => (v == null || !isFinite(v) ? null : Math.round(v * 100) / 100);
  const mean = (xs) => { const v = xs.filter((x) => x != null && isFinite(x)); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };

  // a block's first and last day (inclusive), from its plan
  function blockDates(plan, b) {
    const from = addDays(plan.startDate, (b.start || 0) * 7);
    return { from, to: addDays(from, (b.len || 1) * 7 - 1) };
  }
  const groupsOf = (e) => (Array.isArray(e.groups) && e.groups.length ? e.groups : [{ sets: e.sets, reps: e.reps, intensity: e.intensity }]);
  const leadInt = (v) => { const m = /^\s*(\d+)/.exec(String(v == null ? "" : v)); return m ? Number(m[1]) : null; };
  const epley = (w, r) => (w > 0 && r > 0 && r <= 12 ? w * (1 + r / 30) : null);
  const liftName = (e) => String(e.name || "").trim().toLowerCase().replace(/\s+/g, " ");
  const filled = (v) => v != null && String(v).trim() !== "";

  // One athlete's block of a program. `log`: { key: value } logged against this program (athlete_logs); `forceTests`:
  // [{ date, jumpHeight, relativePeakPower, rsiModified, systemWeight }]; `weighins`: [{ date, lb }]; `today` YYYY-MM-DD.
  function blockResult({ plan, block, program, log, forceTests, weighins, today }) {
    const { from, to } = blockDates(plan, block);
    const weeks = (program && program.weeks) || [];
    const W = weeks.length, len = block.len || 1;
    const out = { from, to, complete: to < today, weeks: len, scheduled: 0, done: 0, compliance: null, strength: null, lifts: [], cmj: {}, bodyweight: null };
    if (!W) return out;
    const keys = Object.keys(log || {}).filter((k) => filled(log[k]));
    // ---- compliance
    if (program.daily) {
      const days = Math.max(0, Math.min(len * 7, daysBetween(from, today < to ? today : to) + 1));
      const tags = new Set(keys.map((k) => (/^(\d{8})~/.exec(k) || [])[1]).filter(Boolean).filter((t) => { const d = `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`; return d >= from && d <= to; }));
      out.scheduled = days; out.done = Math.min(days, tags.size);
    } else {
      const started = Math.max(0, Math.min(len, Math.floor(daysBetween(from, today < to ? today : to) / 7) + 1));
      const prefixes = new Set(keys.map((k) => k.split("|")[0]));
      for (let k = 0; k < started; k++) {
        (weeks[k % W].sessions || []).forEach((s) => {
          const named = (s.exercises || []).filter((e) => String(e.name || "").trim());
          if (!named.length) return;
          out.scheduled += 1;
          if (named.some((e) => prefixes.has(String(e.id)))) out.done += 1;
        });
      }
    }
    out.compliance = out.scheduled ? out.done / out.scheduled : null;
    // ---- strength: each lift's best estimated 1RM, first two weeks against the last two
    if (!program.daily && len >= 3) {
      const best = {}; // name -> { early, late }
      for (let k = 0; k < len; k++) {
        const phase = k < 2 ? "early" : k >= len - 2 ? "late" : null;
        if (!phase) continue;
        (weeks[k % W].sessions || []).forEach((s) => (s.exercises || []).forEach((e) => {
          const name = liftName(e);
          if (!name) return;
          groupsOf(e).forEach((g, gi) => {
            const w = parseFloat(log[`${e.id}|${gi}`]), r = leadInt(log[`${e.id}|${gi}|r`]) || leadInt(g.reps);
            const est = epley(w, r);
            if (est == null) return;
            const b = (best[name] = best[name] || { name: e.name.trim(), early: null, late: null });
            if (b[phase] == null || est > b[phase]) b[phase] = est;
          });
        }));
      }
      out.lifts = Object.values(best).filter((b) => b.early && b.late).map((b) => ({ name: b.name, early: Math.round(b.early), late: Math.round(b.late), pct: b.late / b.early - 1 }))
        .sort((a, b) => b.early - a.early);
      out.strength = out.lifts.length ? mean(out.lifts.map((l) => l.pct)) : null;
    }
    // ---- force plate: before the block against its end
    const tests = (forceTests || []).filter((t) => t && t.date).slice().sort((a, b) => a.date.localeCompare(b.date));
    const before = tests.filter((t) => t.date >= addDays(from, -28) && t.date <= addDays(from, 6)).pop() || null;
    const after = tests.filter((t) => t.date >= addDays(to, -13) && t.date <= addDays(to, 7) && (!before || t.date > before.date)).pop() || null;
    const pair = (get) => { const a = before && get(before), b = after && get(after); return a != null && b != null ? { before: r2(a), after: r2(b), change: r2(b - a), pct: a ? (b - a) / a : null } : null; };
    const num = (v) => (typeof v === "number" && isFinite(v) ? v : null);
    out.cmj = {
      jumpHeight: pair((t) => num(t.jumpHeight)),
      relativePeakPower: pair((t) => num(t.relativePeakPower)),
      mRSI: pair((t) => num(t.rsiModified)),
      beforeDate: before ? before.date : null, afterDate: after ? after.date : null,
    };
    // ---- body weight: weigh-ins and the force plate's system weight, the nearest to the start and the latest at the end
    const weights = [...(weighins || []).map((w) => ({ date: w.date, lb: Number(w.lb) })), ...tests.filter((t) => num(t.systemWeight)).map((t) => ({ date: t.date, lb: t.systemWeight * N_TO_LB }))]
      .filter((w) => w.date && w.lb > 0).sort((a, b) => a.date.localeCompare(b.date));
    const startW = weights.filter((w) => w.date >= addDays(from, -10) && w.date <= addDays(from, 10)).sort((a, b) => Math.abs(daysBetween(a.date, from)) - Math.abs(daysBetween(b.date, from)))[0] || null;
    const endW = weights.filter((w) => w.date >= addDays(to, -10) && w.date <= addDays(to, 3) && (!startW || w.date > startW.date)).pop() || null;
    out.bodyweight = startW && endW ? { before: r1(startW.lb), after: r1(endW.lb), change: r1(endW.lb - startW.lb), beforeDate: startW.date, afterDate: endW.date } : null;
    return out;
  }

  // Averages over a set of block results: { n, compliance, strength, jumpHeight, relativePeakPower, mRSI, bodyweight }
  // (each { value, n }, the value null when no athlete has it)
  function summarize(results) {
    const avg = (get) => { const v = results.map(get).filter((x) => x != null && isFinite(x)); return { value: v.length ? v.reduce((s, x) => s + x, 0) / v.length : null, n: v.length }; };
    return {
      n: results.length,
      compliance: avg((r) => r.compliance),
      strength: avg((r) => r.strength),
      jumpHeight: avg((r) => r.cmj && r.cmj.jumpHeight && r.cmj.jumpHeight.change),
      relativePeakPower: avg((r) => r.cmj && r.cmj.relativePeakPower && r.cmj.relativePeakPower.change),
      mRSI: avg((r) => r.cmj && r.cmj.mRSI && r.cmj.mRSI.change),
      bodyweight: avg((r) => r.bodyweight && r.bodyweight.change),
    };
  }

  // Pre-lift weigh-ins out of an athlete's log rows ("bw-YYYYMMDD|0"), one a day: [{ date, lb }]
  function weighinsFrom(rows) {
    const byDay = {};
    (rows || []).forEach((r) => {
      const m = /^bw-(\d{4})(\d{2})(\d{2})\|0$/.exec(r.key || ""), lb = parseFloat(r.value);
      if (m && lb > 0) byDay[`${m[1]}-${m[2]}-${m[3]}`] = lb;
    });
    return Object.keys(byDay).sort().map((date) => ({ date, lb: byDay[date] }));
  }

  // The program a block runs from: an athlete's own copy goes back to the library program it came from
  const templateOf = (program, programs) => (program && program.basedOn && programs.find((p) => p.id === program.basedOn)) || program || null;
  // Blocks worth reporting on: a program with weeks in it, not a one-off session sent to the app or a saved series
  const reportable = (program) => !!program && (program.weeks || []).length > 0 && !/^(gspeed-|gstrength-|series-)/.test(String(program.id || ""));

  // text helpers for the panels and the email
  const pctText = (v) => (v == null ? "–" : `${v > 0 ? "+" : ""}${(v * 100).toFixed(1)}%`);
  const signed = (v, unit, dp = 1) => (v == null ? "–" : `${v > 0 ? "+" : ""}${Number(v).toFixed(dp)}${unit ? ` ${unit}` : ""}`);

  const api = { blockDates, blockResult, summarize, weighinsFrom, templateOf, reportable, pctText, signed, addDays };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ProgramResults = api;
})(typeof window !== "undefined" ? window : this);
