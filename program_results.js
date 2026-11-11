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

  // One athlete's block of a program. `kind`: what it is (kindOf: "strength", "speed" or "armcare"), which says what
  // it measures. `log`: { key: value } logged against this program (athlete_logs); `forceTests`: his countermovement
  // jumps [{ date, jumpHeight, relativePeakPower, rsiModified, systemWeight }]; `weighins`: [{ date, lb }];
  // `assessments`: perfTestsFrom(...) of his assessments; `kpis`: his Group Testing results; `today` YYYY-MM-DD.
  function blockResult({ plan, block, program, kind = "strength", log, forceTests, weighins, assessments, kpis, today }) {
    const { from, to } = blockDates(plan, block);
    const weeks = (program && program.weeks) || [];
    const W = weeks.length, len = block.len || 1;
    const out = { from, to, complete: to < today, weeks: len, scheduled: 0, done: 0, compliance: null, strength: null, lifts: [], cmj: {}, bodyweight: null, kind, sprint: null, sprints: [], shoulder: null, shoulderTests: [] };
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
    // ---- strength (a strength program): each lift's best estimated 1RM, first two weeks against the last two
    if (kind === "strength" && !program.daily && len >= 3) {
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
    out.cmj = kind === "strength" || kind === "speed" ? {
      jumpHeight: pair((t) => num(t.jumpHeight)),
      relativePeakPower: pair((t) => num(t.relativePeakPower)),
      mRSI: pair((t) => num(t.rsiModified)),
      beforeDate: before ? before.date : null, afterDate: after ? after.date : null,
    } : {};
    // ---- body weight: weigh-ins and the force plate's system weight, the nearest to the start and the latest at the end
    const weights = [...(weighins || []).map((w) => ({ date: w.date, lb: Number(w.lb) })), ...tests.filter((t) => num(t.systemWeight)).map((t) => ({ date: t.date, lb: t.systemWeight * N_TO_LB }))]
      .filter((w) => w.date && w.lb > 0).sort((a, b) => a.date.localeCompare(b.date));
    const startW = weights.filter((w) => w.date >= addDays(from, -10) && w.date <= addDays(from, 10)).sort((a, b) => Math.abs(daysBetween(a.date, from)) - Math.abs(daysBetween(b.date, from)))[0] || null;
    const endW = weights.filter((w) => w.date >= addDays(to, -10) && w.date <= addDays(to, 3) && (!startW || w.date > startW.date)).pop() || null;
    out.bodyweight = kind === "strength" && startW && endW ? { before: r1(startW.lb), after: r1(endW.lb), change: r1(endW.lb - startW.lb), beforeDate: startW.date, afterDate: endW.date } : null;
    // ---- tests from assessments and Group Testing: a result near the start of the block against the last one at its
    // end, each test (and side) on its own; the change as a share of where he started
    const testPairs = (rows, fromLo, fromHi, toLo, toHi) => {
      const byName = {};
      rows.forEach((x) => { if (x.v != null && isFinite(x.v) && x.v > 0) (byName[x.name] = byName[x.name] || []).push(x); });
      return Object.keys(byName).map((name) => {
        const list = byName[name].sort((a, b) => a.date.localeCompare(b.date));
        const b0 = list.filter((x) => x.date >= addDays(from, fromLo) && x.date <= addDays(from, fromHi)).pop();
        const b1 = list.filter((x) => x.date >= addDays(to, toLo) && x.date <= addDays(to, toHi) && (!b0 || x.date > b0.date)).pop();
        return b0 && b1 ? { name, unit: b0.unit || "", before: r2(b0.v), after: r2(b1.v), change: r2(b1.v - b0.v), pct: (b1.v - b0.v) / b0.v, beforeDate: b0.date, afterDate: b1.date } : null;
      }).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
    };
    const perf = (keys) => (assessments || []).flatMap((a) => keys.flatMap(([key, label, single]) => {
      const t = (a.tests || {})[key] || {};
      return single ? [{ date: a.date, name: label, v: parseFloat(t.left) }] : [{ date: a.date, name: `${label} L`, v: parseFloat(t.left) }, { date: a.date, name: `${label} R`, v: parseFloat(t.right) }];
    }));
    const kpiRows = (test) => (kpis || []).filter((e) => e && e.date && test(e)).map((e) => ({ date: e.date, name: e.kpiName, unit: e.unit, v: parseFloat(e.best != null ? e.best : e.value) }));
    if (kind === "speed") {
      // sprint times: lower is faster, so the change is shown as how much faster (a negative change is better)
      const sprintKpi = (e) => e.better === "lower" && (/^s(ec)?$/i.test(String(e.unit || "").trim()) || /yard|yd|sprint|dash|fly|start/i.test(e.kpiName || ""));
      out.sprints = testPairs([...kpiRows(sprintKpi), ...perf([["tenYdStart", "10 yd start (assessment)", true], ["flying5", "Flying 5 (assessment)", true]])], -28, 6, -13, 7);
      out.sprint = out.sprints.length ? mean(out.sprints.map((s) => -s.pct)) : null; // + is faster
    }
    if (kind === "armcare") {
      // shoulder strength and grip: the HHD tests on his assessments, each side, and any grip or shoulder Group Testing
      const armKpi = (e) => e.better !== "lower" && /grip|shoulder|scaption|\b(er|ir)\b|rotation/i.test(e.kpiName || "");
      out.shoulderTests = testPairs([...perf([["hhdGrip", "Grip"], ["hhd9090Er", "90/90 ER"], ["hhd9090Ir", "90/90 IR"], ["hhdErNeutral", "ER neutral"], ["hhdScaption", "Scaption"]]), ...kpiRows(armKpi)], -42, 10, -21, 21);
      out.shoulder = out.shoulderTests.length ? mean(out.shoulderTests.map((s) => s.pct)) : null;
    }
    return out;
  }

  // Averages over a set of block results: { n, compliance, strength, jumpHeight, relativePeakPower, mRSI, bodyweight }
  // (each { value, n }, the value null when no athlete has it)
  function summarize(list) {
    const results = (list || []).map((x) => (x && x.result) || x); // block results, or the rows that carry them
    const avg = (get) => { const v = results.map(get).filter((x) => x != null && isFinite(x)); return { value: v.length ? v.reduce((s, x) => s + x, 0) / v.length : null, n: v.length }; };
    return {
      n: results.length,
      compliance: avg((r) => r.compliance),
      strength: avg((r) => r.strength),
      jumpHeight: avg((r) => r.cmj && r.cmj.jumpHeight && r.cmj.jumpHeight.change),
      relativePeakPower: avg((r) => r.cmj && r.cmj.relativePeakPower && r.cmj.relativePeakPower.change),
      mRSI: avg((r) => r.cmj && r.cmj.mRSI && r.cmj.mRSI.change),
      bodyweight: avg((r) => r.bodyweight && r.bodyweight.change),
      sprint: avg((r) => r.sprint),
      shoulder: avg((r) => r.shoulder),
    };
  }

  // His assessments' performance tests, from a biomechanical assessment (performanceTesting: { key: { left, right } })
  // or a monthly re-assessment (values: { "performanceTesting.key": { left, right } }): [{ date, tests: { key: { left, right } } }]
  function perfTestsFrom(records) {
    return (records || []).filter((r) => r && r.date).map((r) => {
      const tests = { ...(r.performanceTesting || {}) };
      Object.keys(r.values || {}).forEach((k) => { const m = /^performanceTesting\.(.+)$/.exec(k); if (m) tests[m[1]] = r.values[k]; });
      return { date: r.date, tests };
    });
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

  // The program a block runs from: an athlete's own copy counts toward the library program it came from, however it
  // got there. Up its chain of copies first (a copy of another athlete's copy goes back to that one's program); where
  // the chain breaks (a copy in between deleted, or a copy with no link back), by its name less the athlete's ("Happ -
  // Re-Eds Movement EDT / Core Stability" is "Re-Eds Movement EDT / Core Stability"). A copy with no library program of
  // that name is grouped with the other copies of the same name.
  const normName = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
  function baseName(name, athleteName) {
    let n = String(name || "").trim();
    const parts = String(athleteName || "").trim().split(/\s+/).filter(Boolean);
    const last = parts.length ? parts[parts.length - 1] : "";
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // "<Last> - ", "<First Last> - ", "<Last> " in front
    if (parts.length) n = n.replace(new RegExp(`^(${esc(parts.join(" "))}|${esc(last)})\\s*[-–:]?\\s+`, "i"), "");
    // any other short name in front of " - " (one or two words, no numbers): "Bullard - Re-Education"
    const m = /^([A-Za-z'’.]+(?: [A-Za-z'’.]+)?)\s+[-–]\s+(.+)$/.exec(n);
    if (m) n = m[2];
    return n.trim();
  }
  function templateOf(program, programs, athleteName) {
    if (!program) return null;
    const byId = new Map((programs || []).map((p) => [p.id, p]));
    let p = program;
    const seen = new Set();
    while (p && p.athleteId && p.basedOn && !seen.has(p.id)) { seen.add(p.id); const up = byId.get(p.basedOn); if (!up) break; p = up; }
    if (p && !p.athleteId) return p; // a library program
    // the chain ends at an athlete program: one whose link back is to a program since deleted, or one from before copies
    // kept a link, is still a copy of the library program of its name, if there is one
    if (p) {
      const base = baseName(program.name, athleteName);
      const lib = (programs || []).find((q) => !q.athleteId && normName(q.name) === normName(base));
      if (lib) return lib;
    }
    // not copied from the library: the athlete program it all started from is the original
    return p || program;
  }

  // What a program is, for what its results measure: "strength" (strength, jump and body weight), "speed" (jump and
  // sprint times), "armcare" (shoulder strength and grip), or null for what isn't tracked (re-ed, throwing, a daily
  // program). The library folder it's filed in says first (Speed, Strength, an Arm Care folder wherever it sits,
  // Throwing, Re-Education), then its layout, then its name or tags (an athlete's original, filed in his own folder).
  function kindOf(t) {
    if (!t || t.daily || t.layout === "series") return null;
    const folder = String(t.folder || "").toLowerCase(), top = folder.split("/")[0].trim();
    if (/arm\s*-?\s*care/.test(folder)) return "armcare";
    if (top === "speed") return "speed";
    if (top === "strength") return "strength";
    if (/throwing|re-?ed|re-?education/.test(top)) return null;
    if (t.layout === "speed") return "speed";
    if (t.layout === "reed" || t.layout === "throwing") return null;
    const text = `${t.name || ""} ${(Array.isArray(t.tags) ? t.tags : []).join(" ")}`;
    if (/arm\s*-?\s*care/i.test(text)) return "armcare";
    if (/re-?ed|re-?education|throwing/i.test(text)) return null;
    if (/\bspeed\b|sprint|accel|max ?velo/i.test(text)) return "speed";
    return "strength";
  }
  // Blocks worth reporting on: a program with weeks in it, not a one-off session sent to the app or a saved series
  const reportable = (program) => !!program && (program.weeks || []).length > 0 && !/^(gspeed-|gstrength-|series-)/.test(String(program.id || ""));

  // text helpers for the panels and the email
  const pctText = (v) => (v == null ? "–" : `${v > 0 ? "+" : ""}${(v * 100).toFixed(1)}%`);
  const signed = (v, unit, dp = 1) => (v == null ? "–" : `${v > 0 ? "+" : ""}${Number(v).toFixed(dp)}${unit ? ` ${unit}` : ""}`);

  const api = { blockDates, blockResult, summarize, weighinsFrom, perfTestsFrom, templateOf, kindOf, reportable, pctText, signed, addDays };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ProgramResults = api;
})(typeof window !== "undefined" ? window : this);
