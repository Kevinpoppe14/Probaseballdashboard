// Reports: the standard one-page reports, built the same way in the dashboard (the Reports tab, window.ReportsEngine)
// and on the server (api/reports.js, require("../reports_engine.js")), so a report reads the same in the preview, the
// printout and the emailed link.
//
//   Individual report: one athlete over the last N weeks. Force plate (countermovement jump: jump height, mRSI,
//     relative peak power, peak power, momentum) with its trend, body weight (weigh-ins, force plate, Evolt scans and
//     body comp sheets) and body fat, strength trends (each lift's best estimated 1RM a week, from the weights logged
//     in the app), testing results, velocity (bullpen fastballs, sprint top speeds) and the current program's
//     compliance.
//   Group report: a location (DST North...), a roster (Cubs 40-man) or a hand-picked list, one row an athlete with the
//     latest numbers and their change, the group's averages and trend, and flags (no jump in three weeks, a drop in
//     jump height, a swing in body weight, low compliance).
//
// The data comes in through `query(table, columns, filters)`, which the dashboard answers with its signed-in Supabase
// client and the server with the service-role key: filters are [column, "eq" | "in" | "gte", value]. Everything else
// here is plain arithmetic and HTML (inline styles, inline SVG charts), with nothing taken from the page it runs in.
(function (root) {
  const PR = root.ProgramResults || (typeof require === "function" ? require("./program_results.js") : null);
  const DAY = 864e5;
  const N_TO_LB = 1 / 4.4482216152605;
  const parse = (s) => new Date(`${s}T12:00:00Z`);
  const iso = (d) => d.toISOString().slice(0, 10);
  const addDays = (s, n) => iso(new Date(parse(s).getTime() + n * DAY));
  const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / DAY);
  const num = (v) => (typeof v === "number" && isFinite(v) ? v : (typeof v === "string" && v.trim() !== "" && isFinite(Number(v)) ? Number(v) : null));
  const r1 = (v) => (v == null || !isFinite(v) ? null : Math.round(v * 10) / 10);
  const r2 = (v) => (v == null || !isFinite(v) ? null : Math.round(v * 100) / 100);
  const mean = (xs) => { const v = xs.filter((x) => x != null && isFinite(x)); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const mondayOf = (s) => { const d = parse(s); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return iso(d); };
  const shortDate = (s) => { if (!s) return ""; const [y, m, d] = s.split("-"); return `${Number(m)}/${Number(d)}/${y.slice(2)}`; };

  const LOCATIONS = ["DST North", "DST West", "DST South", "DST Arizona", "DST Remote Training"];
  const ROSTERS = { "cubs-40man": "Chicago Cubs 40-man", "hs-youth": "High School & Youth" };
  const isCmj = (d) => { const ty = String((d && d.testType) || "").trim().toLowerCase(); return !ty || ty === "countermovement jump" || ty === "cmj"; };
  const activeAthlete = (a) => a && a.rosterGroup !== "coaches" && !/^(alumni|inactive)$/i.test(String(a.status || "active"));

  // ---- gathering -------------------------------------------------------------------------------------------------
  // the athletes a report covers. target: { type: "athlete", id } | { type: "location", location } |
  // { type: "roster", group } | { type: "athletes", ids: [] }
  async function athletesFor(query, target) {
    if (target.type === "athlete") return (await query("athletes", "id,data", [["id", "eq", String(target.id)]])).map((r) => ({ ...r.data, id: r.data.id != null ? r.data.id : r.id }));
    if (target.type === "athletes") return (await query("athletes", "id,data", [["id", "in", (target.ids || []).map(String)]])).map((r) => ({ ...r.data, id: r.data.id != null ? r.data.id : r.id })).filter(activeAthlete);
    const all = (await query("athletes", "id,data", [])).map((r) => ({ ...r.data, id: r.data.id != null ? r.data.id : r.id })).filter(activeAthlete);
    if (target.type === "roster") return all.filter((a) => a.rosterGroup === target.group);
    if (target.type === "location") return all.filter((a) => a.dstLocation === target.location && a.rosterGroup !== "hs-youth");
    return [];
  }

  // every row the reports read, for a set of athletes: { [athleteId]: bundle }
  async function gather(query, athletes) {
    const ids = athletes.map((a) => String(a.id));
    if (!ids.length) return {};
    const chunks = []; for (let i = 0; i < ids.length; i += 60) chunks.push(ids.slice(i, i + 60));
    const many = async (table, cols) => (await Promise.all(chunks.map((c) => query(table, cols, [["athlete_id", "in", c]])))).flat();
    const [tests, scans, assess, kpis, plans, logs] = await Promise.all([
      many("force_tests", "athlete_id,data"), many("body_comp", "athlete_id,data"), many("assessments", "athlete_id,data"),
      many("kpi_entries", "athlete_id,data"), many("periodization", "athlete_id,data"), many("athlete_logs", "athlete_id,program_id,key,value,updated_at"),
    ]);
    const progIds = [...new Set([...logs.map((r) => r.program_id), ...plans.flatMap((p) => ((p.data && p.data.blocks) || []).map((b) => b.programId))].filter(Boolean).map(String))];
    const programs = [];
    for (let i = 0; i < progIds.length; i += 80) programs.push(...(await query("programs", "id,data", [["id", "in", progIds.slice(i, i + 80)]])).map((r) => ({ ...r.data, id: r.id })));
    const by = (rows) => { const m = {}; rows.forEach((r) => { (m[String(r.athlete_id)] = m[String(r.athlete_id)] || []).push(r); }); return m; };
    const T = by(tests), S = by(scans), A = by(assess), K = by(kpis), P = by(plans), L = by(logs);
    const out = {};
    athletes.forEach((a) => {
      const id = String(a.id);
      out[id] = {
        athlete: a,
        forceTests: (T[id] || []).map((r) => r.data).filter((d) => d && d.date),
        scans: (S[id] || []).map((r) => r.data).filter((d) => d && d.date),
        sheets: (A[id] || []).map((r) => r.data).filter((d) => d && d.kind === "bodycomp"),
        bullpens: (A[id] || []).map((r) => r.data).filter((d) => d && d.kind === "bullpen"),
        kpis: (K[id] || []).map((r) => r.data).filter((d) => d && d.date),
        plan: ((P[id] || [])[0] || {}).data || null,
        logs: L[id] || [],
        programs,
      };
    });
    return out;
  }

  // ---- one athlete's numbers ---------------------------------------------------------------------------------------
  const CMJ_METRICS = [
    { key: "jumpHeight", label: "Jump height", unit: "in", get: (t) => num(t.jumpHeight), dp: 1 },
    { key: "mRSI", label: "mRSI", unit: "", get: (t) => num(t.rsiModified), dp: 2 },
    { key: "relativePeakPower", label: "Rel. peak power", unit: "W/kg", get: (t) => num(t.relativePeakPower), dp: 1 },
    { key: "peakPower", label: "Peak power", unit: "W", get: (t) => num(t.peakPower), dp: 0 },
    { key: "jumpMomentum", label: "Momentum", unit: "kg·m/s", get: (t) => num(t.jumpMomentum), dp: 0 },
  ];
  const FASTBALL = /four|4-?seam|fastball|sinker|two-?seam|2-?seam/i;
  // not a lift an estimated 1RM means anything for: jumps and drops, throws and swings, carries, holds and stretches
  const NOT_STRENGTH = /drop|jump|hop|bound|throw|toss|slam|swing|carr(y|ies)|walk|march|sprint|stretch|plank|hold|\biso\b|isometric|extreme|mobility/i;
  const median = (xs) => { const v = xs.filter((x) => x != null && isFinite(x)).sort((a, b) => a - b); if (!v.length) return null; const m = Math.floor(v.length / 2); return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };

  function individual(b, { weeks = 8, today }) {
    const a = b.athlete;
    const from = addDays(today, -weeks * 7);
    const inWin = (d) => d >= from && d <= today;
    // force plate: a day's jumps averaged, so a day with two tests (a sheet and the plate itself) counts once
    const cmjByDay = {};
    b.forceTests.filter(isCmj).forEach((t) => { (cmjByDay[t.date] = cmjByDay[t.date] || []).push(t); });
    const cmjDays = Object.keys(cmjByDay).sort().map((date) => {
      const o = { date };
      CMJ_METRICS.forEach((m) => { o[m.key] = mean(cmjByDay[date].map(m.get)); });
      o.weightLb = mean(cmjByDay[date].map((t) => (num(t.systemWeight) ? t.systemWeight * N_TO_LB : null)));
      return o;
    });
    const winDays = cmjDays.filter((d) => inWin(d.date));
    const latest = cmjDays[cmjDays.length - 1] || null;
    const first = winDays[0] || null;
    const prior = latest ? cmjDays.filter((d) => d.date <= addDays(latest.date, -4) && d.date >= addDays(latest.date, -35)).pop() || null : null;
    const cmj = CMJ_METRICS.map((m) => {
      const v = latest ? latest[m.key] : null, f = first && first !== latest ? first[m.key] : null, p = prior ? prior[m.key] : null;
      const winVals = winDays.map((d) => d[m.key]).filter((x) => x != null);
      return { ...m, latest: v, latestDate: latest ? latest.date : null, sinceStart: v != null && f != null ? v - f : null, sinceStartPct: v != null && f ? (v - f) / f : null,
        vsPrior: v != null && p != null ? v - p : null, vsPriorPct: v != null && p ? (v - p) / p : null, best: winVals.length ? Math.max(...winVals) : null,
        series: winDays.filter((d) => d[m.key] != null).map((d) => ({ date: d.date, v: d[m.key] })) };
    });
    // body weight: scans and body comp sheets first, then the app's weigh-ins, then the force plate
    const weights = {};
    const put = (date, lb, src, rank) => { if (!date || !(lb > 0)) return; if (!weights[date] || weights[date].rank > rank) weights[date] = { date, lb, src, rank }; };
    b.scans.forEach((s) => put(s.date, num(s.weightLb), "Evolt", 0));
    b.sheets.forEach((s) => put(s.date, num((s.summary && s.summary.weightLb) || (s.inputs && s.inputs.weightLb)), "Body comp", 0));
    (PR ? PR.weighinsFrom(b.logs) : []).forEach((w) => put(w.date, w.lb, "Weigh-in", 1));
    cmjDays.forEach((d) => put(d.date, d.weightLb, "Force plate", 2));
    const wAll = Object.values(weights).sort((x, y) => x.date.localeCompare(y.date));
    const wWin = wAll.filter((w) => inWin(w.date));
    const wLatest = wAll[wAll.length - 1] || null, wFirst = wWin[0] || null;
    const fatSrc = [...b.scans.map((s) => ({ date: s.date, pct: num(s.bodyFatPct), lean: num(s.lbmLb), src: "Evolt" })), ...b.sheets.map((s) => ({ date: s.date, pct: num(s.summary && s.summary.pctFat), lean: num(s.summary && s.summary.leanLb), src: "Body comp sheet" }))]
      .filter((x) => x.pct != null).sort((x, y) => x.date.localeCompare(y.date));
    const fat = fatSrc[fatSrc.length - 1] || null, fatPrev = fatSrc.length > 1 ? fatSrc[fatSrc.length - 2] : null;
    const bodyweight = {
      latest: wLatest ? r1(wLatest.lb) : null, latestDate: wLatest ? wLatest.date : null, latestSrc: wLatest ? wLatest.src : "",
      change: wLatest && wFirst && wFirst !== wLatest ? r1(wLatest.lb - wFirst.lb) : null, series: wWin.map((w) => ({ date: w.date, v: r1(w.lb) })),
      fatPct: fat ? fat.pct : null, fatDate: fat ? fat.date : null, fatSrc: fat ? fat.src : "", leanLb: fat ? fat.lean : null, fatChange: fat && fatPrev ? r1(fat.pct - fatPrev.pct) : null,
    };
    // strength: each lift's best estimated 1RM each week, from the weights logged (the day a weight was entered)
    const exIndex = {};
    b.programs.forEach((p) => (p.weeks || []).forEach((w) => (w.sessions || []).forEach((s) => (s.exercises || []).forEach((e) => { if (e && e.id) exIndex[`${p.id}|${e.id}`] = e; }))));
    const logMap = {}; // "program|key" -> { value, at }
    b.logs.forEach((r) => { logMap[`${r.program_id}|${r.key}`] = { value: r.value, at: String(r.updated_at || "").slice(0, 10) }; });
    const lifts = {};
    b.logs.forEach((r) => {
      const m = /^(ex-[^|]+|[^|]+)\|(\d+)$/.exec(r.key || "");
      if (!m) return;
      const e = exIndex[`${r.program_id}|${m[1]}`];
      if (!e || !String(e.name || "").trim()) return;
      const g = (Array.isArray(e.groups) ? e.groups : [])[Number(m[2])] || {};
      const w = parseFloat(r.value), repsLogged = logMap[`${r.program_id}|${r.key}|r`];
      const reps = parseInt((repsLogged && repsLogged.value) || g.reps, 10);
      const at = String(r.updated_at || "").slice(0, 10);
      if (!(w > 0) || !(reps > 0) || reps > 12 || !at || !inWin(at)) return;
      const est = w * (1 + reps / 30);
      const name = e.name.trim(), key = name.toLowerCase().replace(/\s+/g, " "), wk = mondayOf(at);
      const L2 = (lifts[key] = lifts[key] || { name, weeks: {} });
      if (!L2.weeks[wk] || est > L2.weeks[wk]) L2.weeks[wk] = est;
    });
    // A lift's change needs three weeks or more: the best of its last two weeks against the best of its first two (as
    // program_results.js does for a block). Over ±40% reads as a change in how it's loaded (a new rep scheme, one
    // hand to two), not strength, so it's shown but left out of the averages.
    const strength = Object.values(lifts).map((l) => {
      const series = Object.keys(l.weeks).sort().map((date) => ({ date, v: Math.round(l.weeks[date]) }));
      const z = series[series.length - 1];
      let first = null, late = null, pct = null, change = null, unclear = false;
      if (series.length >= 3) {
        first = Math.max(series[0].v, series[1].v); late = Math.max(series[series.length - 1].v, series[series.length - 2].v);
        change = late - first; pct = first ? change / first : null;
        if (pct != null && Math.abs(pct) > 0.4) { unclear = true; }
      }
      return { name: l.name, series, first: first != null ? first : series[0].v, latest: late != null ? late : z.v, best: Math.max(...series.map((s) => s.v)), change, pct: unclear ? null : pct, unclear };
    }).filter((l) => l.series.length >= 1 && !NOT_STRENGTH.test(l.name)).sort((x, y) => (y.series.length - x.series.length) || (y.best - x.best)).slice(0, 8);
    const strengthChange = median(strength.map((l) => l.pct));
    // testing: each test's latest result in the window, against the one before it
    const byTest = {};
    b.kpis.forEach((k) => { const v = num(k.best != null ? k.best : k.value); if (v == null) return; (byTest[k.kpiName] = byTest[k.kpiName] || []).push({ date: k.date, v, unit: k.unit || "", better: k.better || "higher" }); });
    const testing = Object.keys(byTest).map((name) => {
      const list = byTest[name].sort((x, y) => x.date.localeCompare(y.date));
      const z = list[list.length - 1], p = list.length > 1 ? list[list.length - 2] : null;
      return inWin(z.date) ? { name, unit: z.unit, better: z.better, latest: z.v, date: z.date, prev: p ? p.v : null, prevDate: p ? p.date : null, change: p ? z.v - p.v : null, series: list.filter((x) => inWin(x.date)).map((x) => ({ date: x.date, v: x.v })) } : null;
    }).filter(Boolean).sort((x, y) => x.name.localeCompare(y.name));
    // velocity: bullpen fastballs (max and average a session) and sprint top speeds
    const pens = b.bullpens.filter((p) => inWin(p.date)).map((p) => {
      const fb = (p.pitches || []).filter((x) => FASTBALL.test(x.type || "") && num(x.speed));
      const sp = fb.map((x) => num(x.speed));
      return sp.length ? { date: p.date, max: Math.max(...sp), avg: r1(mean(sp)), n: sp.length } : null;
    }).filter(Boolean).sort((x, y) => x.date.localeCompare(y.date));
    const velocity = { bullpens: pens, topSpeeds: testing.filter((t) => /mph/i.test(t.unit)) };
    // the program running now, and how much of it has been logged
    let program = null;
    const plan = b.plan;
    if (plan && plan.startDate && PR) {
      const wkNow = Math.floor(daysBetween(plan.startDate, today) / 7);
      const cur = (plan.blocks || []).filter((bl) => bl.programId && bl.start <= wkNow && wkNow < bl.start + bl.len)
        .map((bl) => ({ bl, p: b.programs.find((x) => String(x.id) === String(bl.programId)) })).filter((x) => x.p && PR.reportable(x.p));
      const pick = cur.find((x) => PR.kindOf(PR.templateOf(x.p, b.programs, a.name)) === "strength") || cur[0];
      if (pick) {
        const log = {}; b.logs.filter((r) => String(r.program_id) === String(pick.p.id)).forEach((r) => { if (r.value) log[r.key] = r.value; });
        const res = PR.blockResult({ plan, block: pick.bl, program: pick.p, kind: PR.kindOf(PR.templateOf(pick.p, b.programs, a.name)) || "strength", log, forceTests: [], weighins: [], assessments: [], kpis: [], today });
        program = { name: pick.p.name, week: wkNow - pick.bl.start + 1, weeks: pick.bl.len, compliance: res.compliance, done: res.done, scheduled: res.scheduled, from: res.from, to: res.to };
      }
    }
    // flags
    const flags = [];
    if (!latest) flags.push("No force plate jump on file");
    else if (daysBetween(latest.date, today) > 21) flags.push(`No jump in ${daysBetween(latest.date, today)} days`);
    const jh = cmj[0];
    if (jh.vsPriorPct != null && jh.vsPriorPct <= -0.05) flags.push(`Jump height down ${Math.abs(Math.round(jh.vsPriorPct * 100))}% from the test before`);
    if (bodyweight.change != null && bodyweight.latest && Math.abs(bodyweight.change / bodyweight.latest) >= 0.03) flags.push(`Body weight ${bodyweight.change > 0 ? "up" : "down"} ${Math.abs(bodyweight.change)} lb in ${weeks} weeks`);
    // compliance, once the program is into its second week (a first week just started reads as 0%)
    if (program && program.compliance != null && program.week >= 2 && program.scheduled >= 3 && program.compliance < 0.7) flags.push(`Compliance ${Math.round(program.compliance * 100)}%`);
    return { athlete: a, weeks, from, to: today, cmj, cmjTests: winDays.length, bodyweight, strength, strengthChange, testing, velocity, program, flags };
  }

  function group(bundles, { weeks = 8, today, title }) {
    const people = Object.values(bundles).map((b) => individual(b, { weeks, today })).sort((x, y) => lastName(x.athlete.name).localeCompare(lastName(y.athlete.name)));
    const m = (k) => people.map((p) => p.cmj.find((c) => c.key === k));
    // the group's weekly average jump height and relative power (each athlete's week averaged first)
    const weekly = {};
    people.forEach((p) => {
      const perWeek = {};
      (p.cmj[0].series || []).forEach((s) => { const wk = mondayOf(s.date); (perWeek[wk] = perWeek[wk] || []).push(s.v); });
      Object.keys(perWeek).forEach((wk) => { (weekly[wk] = weekly[wk] || []).push(mean(perWeek[wk])); });
    });
    const trend = Object.keys(weekly).sort().map((date) => ({ date, v: r2(mean(weekly[date])), n: weekly[date].length }));
    return {
      title, weeks, from: addDays(today, -weeks * 7), to: today, people,
      averages: {
        jumpHeight: r2(mean(m("jumpHeight").map((c) => c.latest))), jumpHeightChange: r2(mean(m("jumpHeight").map((c) => c.sinceStart))),
        mRSI: r2(mean(m("mRSI").map((c) => c.latest))), relativePeakPower: r1(mean(m("relativePeakPower").map((c) => c.latest))),
        bodyweightChange: r1(mean(people.map((p) => p.bodyweight.change))),
        strength: median(people.map((p) => p.strengthChange)),
        compliance: mean(people.map((p) => (p.program ? p.program.compliance : null))),
        tested: people.filter((p) => p.cmjTests > 0).length,
      },
      trend,
    };
  }
  const lastName = (n) => String(n || "").trim().split(/\s+/).filter((w) => !/^(jr|sr|ii|iii|iv)\.?$/i.test(w)).pop() || "";

  // ---- drawing ---------------------------------------------------------------------------------------------------
  const RED = "#a52a34", INK = "#1a1a1a", DIM = "#6b6b6b", LINE = "#e3e3e3", GOOD = "#16a34a", BAD = "#dc2626";
  const show = (v, dp = 1) => (v == null ? "–" : (dp === 0 ? String(Math.round(v)) : String(Number(Number(v).toFixed(dp)))));
  const signed = (v, dp = 1, unit = "") => (v == null ? "" : `${v > 0 ? "+" : v < 0 ? "−" : "±"}${show(Math.abs(v), dp)}${unit ? ` ${unit}` : ""}`);
  const tone = (v, better = "higher") => (v == null || v === 0 ? DIM : (v > 0) === (better !== "lower") ? GOOD : BAD);

  // a small line chart: points [{ date, v }] across the report's window
  function spark(points, { w = 220, h = 54, color = RED, from, to, dp = 1 } = {}) {
    const pts = (points || []).filter((p) => p.v != null);
    if (!pts.length) return `<div style="height:${h}px;display:flex;align-items:center;color:${DIM};font-size:11px">No data in this window</div>`;
    const t0 = parse(from || pts[0].date).getTime(), t1 = Math.max(parse(to || pts[pts.length - 1].date).getTime(), t0 + DAY);
    const vs = pts.map((p) => p.v); let lo = Math.min(...vs), hi = Math.max(...vs); if (hi === lo) { hi += 1; lo -= 1; }
    const pad = 6, X = (d) => pad + ((parse(d).getTime() - t0) / (t1 - t0)) * (w - pad * 2 - 28), Y = (v) => pad + (1 - (v - lo) / (hi - lo)) * (h - pad * 2);
    const path = pts.map((p, i) => `${i ? "L" : "M"}${X(p.date).toFixed(1)},${Y(p.v).toFixed(1)}`).join(" ");
    const last = pts[pts.length - 1];
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" style="display:block">
<line x1="${pad}" y1="${h - pad}" x2="${w - pad - 28}" y2="${h - pad}" stroke="${LINE}"/>
<path d="${path}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
${pts.map((p) => `<circle cx="${X(p.date).toFixed(1)}" cy="${Y(p.v).toFixed(1)}" r="${pts.length > 12 ? 1.6 : 2.4}" fill="${color}"/>`).join("")}
<text x="${w - 26}" y="${Math.max(10, Math.min(h - 4, Y(last.v) + 4)).toFixed(1)}" font-size="10" font-family="Arial" fill="${INK}" font-weight="700">${esc(show(last.v, dp))}</text>
<text x="${w - 26}" y="10" font-size="8" font-family="Arial" fill="${DIM}">${esc(show(hi, dp))}</text>
<text x="${w - 26}" y="${h - 2}" font-size="8" font-family="Arial" fill="${DIM}">${esc(show(lo, dp))}</text>
</svg>`;
  }

  const CSS = `
*{box-sizing:border-box}body{margin:0;background:#f2f2f2;font-family:Arial,Helvetica,sans-serif;color:${INK}}
.page{background:#fff;margin:16px auto;padding:22px 26px;box-shadow:0 1px 4px rgba(0,0,0,.08)}
.p-ind{width:8.5in;min-height:11in}.p-grp{width:11in;min-height:8.5in}
.hd{display:flex;align-items:center;gap:14px;border-bottom:3px solid ${RED};padding-bottom:10px;margin-bottom:12px}
.hd img.ph{width:58px;height:58px;border-radius:50%;object-fit:cover;background:#eee}
.hd h1{margin:0;font-size:22px}.hd .sub{color:${DIM};font-size:12px;margin-top:3px}
.hd .brand{margin-left:auto;text-align:right;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:${DIM}}
.hd .brand b{display:block;color:${RED};font-size:12px;letter-spacing:.08em}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.full{grid-column:1/-1}
.card{border:1px solid ${LINE};border-radius:8px;padding:9px 11px;break-inside:avoid}
.card h2{margin:0 0 6px;font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:${RED}}
.kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:6px}
.kpi{border-left:3px solid ${LINE};padding:2px 0 2px 7px}.kpi .l{font-size:10px;color:${DIM}}.kpi .v{font-size:17px;font-weight:700}
.kpi .d{font-size:10px}.u{font-size:10px;color:${DIM};font-weight:400}
table{width:100%;border-collapse:collapse;font-size:11px}th{text-align:left;font-size:9.5px;color:${DIM};font-weight:700;text-transform:uppercase;letter-spacing:.04em;border-bottom:1px solid ${LINE};padding:3px 4px}
td{padding:3px 4px;border-bottom:1px solid #f1f1f1;vertical-align:middle}td.n{text-align:right;white-space:nowrap}
.flag{display:inline-block;background:#fdecee;color:${BAD};border-radius:10px;padding:1px 7px;font-size:10px;margin:1px 3px 1px 0}
.muted{color:${DIM};font-size:11px}.foot{margin-top:10px;font-size:9.5px;color:${DIM};display:flex;justify-content:space-between}
.bar{height:7px;background:#eee;border-radius:4px;overflow:hidden;width:70px;display:inline-block;vertical-align:middle}.bar i{display:block;height:100%;background:${RED}}
.noprint{position:sticky;top:0;z-index:2;text-align:center;padding:8px;background:${INK}}
.noprint button{background:${RED};color:#fff;border:0;border-radius:6px;padding:8px 16px;font-weight:700;cursor:pointer}
@media print{body{background:#fff}.page{margin:0;box-shadow:none;padding:14px 18px}.noprint{display:none}}`;

  const head = (title, size) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>@page{size:${size};margin:0.3in}${CSS}</style></head><body>`;
  const ageOf = (a) => { const d = a.dob || a.birthDate || a.birthdate; if (!d) return null; const t = new Date(d); return isNaN(t) ? null : Math.floor((Date.now() - t.getTime()) / (365.25 * DAY)); };

  function renderIndividual(R, { printButton = true, generated } = {}) {
    const a = R.athlete;
    const sub = [a.position, a.team, a.dstLocation, ageOf(a) != null ? `Age ${ageOf(a)}` : ""].filter(Boolean).join(" · ");
    const kp = R.cmj.map((c) => `<div class="kpi"><div class="l">${esc(c.label)}</div><div class="v">${esc(show(c.latest, c.dp))}<span class="u"> ${esc(c.unit)}</span></div>
<div class="d" style="color:${tone(c.vsPrior)}">${c.vsPrior != null ? `${esc(signed(c.vsPrior, c.dp))} vs last` : "&nbsp;"}</div><div class="d" style="color:${tone(c.sinceStart)}">${c.sinceStart != null ? `${esc(signed(c.sinceStart, c.dp))} in ${R.weeks} wks` : "&nbsp;"}</div></div>`).join("");
    const bw = R.bodyweight;
    const strength = R.strength.length ? `<table><tr><th>Lift</th><th class="n">First</th><th class="n">Latest</th><th class="n">Change</th><th>Trend (est. 1RM, lb)</th></tr>${R.strength.slice(0, 7).map((l) => `<tr><td>${esc(l.name)}</td><td class="n">${esc(show(l.first, 0))}</td><td class="n"><b>${esc(show(l.latest, 0))}</b></td><td class="n" style="color:${l.unclear ? DIM : tone(l.change)}">${l.pct != null ? esc(`${signed(l.change, 0)} (${signed(l.pct * 100, 1)}%)`) : l.unclear ? "load changed" : "–"}</td><td>${spark(l.series, { w: 150, h: 26, from: R.from, to: R.to, dp: 0 })}</td></tr>`).join("")}</table>`
      : `<div class="muted">No weights logged in the app in this window.</div>`;
    const tests = R.testing.length ? `<table><tr><th>Test</th><th class="n">Latest</th><th class="n">Date</th><th class="n">Change</th></tr>${R.testing.slice(0, 12).map((t) => `<tr><td>${esc(t.name)}</td><td class="n"><b>${esc(show(t.latest, 2))}</b> <span class="u">${esc(t.unit)}</span></td><td class="n">${esc(shortDate(t.date))}</td><td class="n" style="color:${tone(t.change, t.better)}">${t.change != null ? esc(signed(t.change, 2)) : "–"}</td></tr>`).join("")}</table>`
      : `<div class="muted">No testing results in this window.</div>`;
    const pens = R.velocity.bullpens;
    const velo = pens.length || R.velocity.topSpeeds.length ? `${pens.length ? `<div style="display:flex;gap:14px;align-items:center"><div><div class="muted">Fastball, last bullpen (${esc(shortDate(pens[pens.length - 1].date))})</div><div style="font-size:17px;font-weight:700">${esc(show(pens[pens.length - 1].max, 1))} <span class="u">max</span> · ${esc(show(pens[pens.length - 1].avg, 1))} <span class="u">avg mph</span></div></div>${spark(pens.map((p) => ({ date: p.date, v: p.max })), { w: 200, h: 44, from: R.from, to: R.to })}</div>` : ""}
${R.velocity.topSpeeds.map((t) => `<div class="muted" style="margin-top:4px">${esc(t.name)}: <b style="color:${INK}">${esc(show(t.latest, 1))} mph</b> (${esc(shortDate(t.date))})</div>`).join("")}` : `<div class="muted">No bullpens or sprint speeds in this window.</div>`;
    const prog = R.program ? `<div style="font-size:13px"><b>${esc(R.program.name)}</b></div><div class="muted">Week ${R.program.week} of ${R.program.weeks} · ${esc(shortDate(R.program.from))} – ${esc(shortDate(R.program.to))}</div>
<div style="margin-top:6px;font-size:12px">Compliance <b>${R.program.compliance != null ? Math.round(R.program.compliance * 100) + "%" : "–"}</b> <span class="muted">(${R.program.done} of ${R.program.scheduled} sessions logged)</span> <span class="bar"><i style="width:${Math.round((R.program.compliance || 0) * 100)}%"></i></span></div>` : `<div class="muted">No program running on the plan right now.</div>`;
    return `${head(`${a.name} · Report`, "letter portrait")}${printButton ? `<div class="noprint"><button onclick="window.print()">Print / Save as PDF</button></div>` : ""}<div class="page p-ind">
<div class="hd">${a.photoUrl ? `<img class="ph" src="${esc(a.photoUrl)}" alt="">` : ""}<div><h1>${esc(a.name)}</h1><div class="sub">${esc(sub)}</div><div class="sub">Last ${R.weeks} weeks · ${esc(shortDate(R.from))} – ${esc(shortDate(R.to))}</div></div><div class="brand"><b>Dynamic Sports Training</b>Athlete Report</div></div>
${R.flags.length ? `<div style="margin-bottom:8px">${R.flags.map((f) => `<span class="flag">${esc(f)}</span>`).join("")}</div>` : ""}
<div class="grid">
<div class="card full"><h2>Force plate · countermovement jump</h2><div class="kpis">${kp}</div>
<div style="display:flex;gap:16px;margin-top:8px"><div><div class="muted">Jump height (in)</div>${spark(R.cmj[0].series, { w: 330, h: 60, from: R.from, to: R.to })}</div><div><div class="muted">Relative peak power (W/kg)</div>${spark(R.cmj[2].series, { w: 330, h: 60, from: R.from, to: R.to, color: INK })}</div></div>
<div class="muted" style="margin-top:4px">${R.cmjTests} test day${R.cmjTests === 1 ? "" : "s"} in this window${R.cmj[0].latestDate ? ` · latest ${esc(shortDate(R.cmj[0].latestDate))}` : ""}</div></div>
<div class="card"><h2>Body weight</h2><div style="display:flex;justify-content:space-between;align-items:flex-end"><div><div style="font-size:20px;font-weight:700">${esc(show(bw.latest, 1))} <span class="u">lb</span></div>
<div class="muted">${bw.latestDate ? `${esc(bw.latestSrc)}, ${esc(shortDate(bw.latestDate))}` : ""}</div>${bw.change != null ? `<div style="font-size:11px;color:${DIM}">${esc(signed(bw.change, 1, "lb"))} in ${R.weeks} weeks</div>` : ""}</div>
<div style="text-align:right">${bw.fatPct != null ? `<div style="font-size:15px;font-weight:700">${esc(show(bw.fatPct, 1))}% <span class="u">body fat</span></div><div class="muted">${esc(bw.fatSrc)}, ${esc(shortDate(bw.fatDate))}${bw.fatChange != null ? ` · ${esc(signed(bw.fatChange, 1))}%` : ""}</div>${bw.leanLb ? `<div class="muted">Lean ${esc(show(bw.leanLb, 1))} lb</div>` : ""}` : ""}</div></div>
${spark(bw.series, { w: 330, h: 56, from: R.from, to: R.to, color: INK })}</div>
<div class="card"><h2>Program</h2>${prog}<h2 style="margin-top:10px">Velocity</h2>${velo}</div>
<div class="card full"><h2>Strength trends</h2>${strength}</div>
<div class="card full"><h2>Testing</h2>${tests}</div>
</div>
<div class="foot"><span>Force plate numbers are the day's average. Estimated 1RMs (Epley) come from weights logged in the app on sets of 12 or fewer.</span><span>${esc(generated || "")}</span></div>
</div></body></html>`;
  }

  function renderGroup(G, { printButton = true, generated } = {}) {
    const av = G.averages;
    const tile = (label, v, unit, d) => `<div class="kpi"><div class="l">${esc(label)}</div><div class="v">${v}<span class="u"> ${esc(unit)}</span></div><div class="d">${d || "&nbsp;"}</div></div>`;
    const row = (p) => {
      const c = (k) => p.cmj.find((x) => x.key === k);
      const jh = c("jumpHeight"), rs = c("mRSI"), rp = c("relativePeakPower");
      const st = p.strengthChange;
      return `<tr><td><b>${esc(p.athlete.name)}</b><div class="muted" style="font-size:9.5px">${esc([p.athlete.position, p.athlete.team].filter(Boolean).join(" · "))}</div></td>
<td class="n">${esc(show(jh.latest, 1))}</td><td class="n" style="color:${tone(jh.vsPrior)}">${jh.vsPrior != null ? esc(signed(jh.vsPrior, 1)) : ""}</td>
<td class="n">${esc(show(rs.latest, 2))}</td><td class="n">${esc(show(rp.latest, 1))}</td><td class="n">${jh.latestDate ? esc(shortDate(jh.latestDate)) : "–"}</td>
<td class="n">${esc(show(p.bodyweight.latest, 1))}</td><td class="n" style="color:${DIM}">${p.bodyweight.change != null ? esc(signed(p.bodyweight.change, 1)) : ""}</td>
<td class="n" style="color:${tone(st)}">${st != null ? esc(signed(st * 100, 1)) + "%" : "–"}</td>
<td class="n">${p.program && p.program.compliance != null ? Math.round(p.program.compliance * 100) + "%" : "–"}</td>
<td>${p.flags.map((f) => `<span class="flag">${esc(f)}</span>`).join("")}</td></tr>`;
    };
    return `${head(`${G.title} · Group Report`, "letter landscape")}${printButton ? `<div class="noprint"><button onclick="window.print()">Print / Save as PDF</button></div>` : ""}<div class="page p-grp">
<div class="hd"><div><h1>${esc(G.title)}</h1><div class="sub">${G.people.length} athletes · last ${G.weeks} weeks · ${esc(shortDate(G.from))} – ${esc(shortDate(G.to))}</div></div><div class="brand"><b>Dynamic Sports Training</b>Group Report</div></div>
<div class="grid" style="grid-template-columns:1.3fr 1fr">
<div class="card"><h2>Group averages (latest)</h2><div class="kpis" style="grid-template-columns:repeat(4,1fr)">
${tile("Jump height", esc(show(av.jumpHeight, 1)), "in", av.jumpHeightChange != null ? `<span style="color:${tone(av.jumpHeightChange)}">${esc(signed(av.jumpHeightChange, 1))} in ${G.weeks} wks</span>` : "")}
${tile("mRSI", esc(show(av.mRSI, 2)), "", "")}${tile("Rel. peak power", esc(show(av.relativePeakPower, 1)), "W/kg", "")}
${tile("Compliance", av.compliance != null ? Math.round(av.compliance * 100) + "%" : "–", "", `<span class="muted">${av.tested} of ${G.people.length} jumped</span>`)}</div>
<div class="muted" style="margin-top:6px">Body weight ${av.bodyweightChange != null ? esc(signed(av.bodyweightChange, 1, "lb")) : "–"} on average · strength (est. 1RM) ${av.strength != null ? esc(signed(av.strength * 100, 1)) + "%" : "–"} on average</div></div>
<div class="card"><h2>Group jump height by week (in)</h2>${spark(G.trend, { w: 330, h: 70, from: G.from, to: G.to, dp: 1 })}</div>
<div class="card full"><h2>Athletes</h2><table><tr><th>Athlete</th><th class="n">Jump ht (in)</th><th class="n">vs last</th><th class="n">mRSI</th><th class="n">RPP</th><th class="n">Last jump</th><th class="n">Weight (lb)</th><th class="n">${G.weeks} wk</th><th class="n">Strength</th><th class="n">Compliance</th><th>Flags</th></tr>
${G.people.map(row).join("")}</table></div>
</div>
<div class="foot"><span>Latest force plate test per athlete (the day's average). Strength is the average change in each lift's estimated 1RM over the window.</span><span>${esc(generated || "")}</span></div>
</div></body></html>`;
  }

  // ---- the email (no SVG, which most mail apps won't show) --------------------------------------------------------
  function emailSummary({ kind, data, link, setBy, note, unsubscribe }) {
    const cell = "font-family:Arial,sans-serif;font-size:13px;padding:6px 10px;border-bottom:1px solid #eee";
    let body = "", title = "";
    if (kind === "individual") {
      const R = data; title = `${R.athlete.name}: last ${R.weeks} weeks`;
      const rows = [...R.cmj.slice(0, 3).map((c) => [c.label, `${show(c.latest, c.dp)} ${c.unit}`, c.sinceStart != null ? signed(c.sinceStart, c.dp) : ""]),
        ["Body weight", R.bodyweight.latest != null ? `${show(R.bodyweight.latest, 1)} lb` : "–", R.bodyweight.change != null ? signed(R.bodyweight.change, 1) : ""],
        ...(R.program ? [["Compliance", R.program.compliance != null ? `${Math.round(R.program.compliance * 100)}%` : "–", R.program.name]] : []),
        ...R.strength.slice(0, 3).map((l) => [`${l.name} (est. 1RM)`, `${show(l.latest, 0)} lb`, l.change != null ? signed(l.change, 0) : ""])];
      body = `<table style="border-collapse:collapse;width:100%">${rows.map(([a, b2, c]) => `<tr><td style="${cell};color:#555">${esc(a)}</td><td style="${cell};font-weight:700">${esc(b2)}</td><td style="${cell};color:#777">${esc(c)}</td></tr>`).join("")}</table>
${R.flags.length ? `<p style="font-family:Arial;font-size:12px;color:#b91c1c">${R.flags.map(esc).join(" · ")}</p>` : ""}`;
    } else {
      const G = data, av = G.averages; title = `${G.title}: last ${G.weeks} weeks`;
      body = `<p style="font-family:Arial;font-size:13px;color:#333">${G.people.length} athletes · jump height ${esc(show(av.jumpHeight, 1))} in on average${av.jumpHeightChange != null ? ` (${esc(signed(av.jumpHeightChange, 1))})` : ""} · compliance ${av.compliance != null ? Math.round(av.compliance * 100) + "%" : "–"}</p>
<table style="border-collapse:collapse;width:100%"><tr><td style="${cell};font-size:11px;color:#888">Athlete</td><td style="${cell};font-size:11px;color:#888">Jump ht</td><td style="${cell};font-size:11px;color:#888">Weight</td><td style="${cell};font-size:11px;color:#888">Flags</td></tr>
${G.people.slice(0, 30).map((p) => `<tr><td style="${cell}">${esc(p.athlete.name)}</td><td style="${cell}">${esc(show(p.cmj[0].latest, 1))}</td><td style="${cell}">${esc(show(p.bodyweight.latest, 1))}</td><td style="${cell};color:#b91c1c;font-size:11px">${esc(p.flags.join(" · "))}</td></tr>`).join("")}</table>`;
    }
    return `<!doctype html><html><body style="margin:0;background:#f2f2f2"><table role="presentation" width="100%" style="background:#f2f2f2;padding:20px 0"><tr><td align="center">
<table role="presentation" width="600" style="max-width:600px;width:100%;background:#fff;border-radius:10px;overflow:hidden">
<tr><td style="background:#1a1a1a;padding:18px 24px;border-bottom:4px solid ${RED}"><div style="font-family:Arial;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#ccc">Dynamic Sports Training · Report</div><div style="font-family:Arial;font-size:21px;font-weight:800;color:#fff;margin-top:4px">${esc(title)}</div></td></tr>
<tr><td style="padding:16px 24px">${note ? `<p style="font-family:Arial;font-size:13px;color:#333">${esc(note)}</p>` : ""}${body}
<p style="margin:18px 0 6px"><a href="${esc(link)}" style="display:inline-block;background:${RED};color:#fff;font-family:Arial;font-size:14px;font-weight:700;text-decoration:none;padding:11px 20px;border-radius:7px">Open the full report</a></p>
<p style="font-family:Arial;font-size:11px;color:#888">The link shows this report only and works for 30 days. It prints as one page.</p></td></tr>
<tr><td style="padding:12px 24px;border-top:1px solid #eee;font-family:Arial;font-size:11px;color:#888">Set up by ${esc(setBy || "a DST coach")}.${unsubscribe ? ` <a href="${esc(unsubscribe)}" style="color:#888">Stop these emails</a>.` : ""}</td></tr>
</table></td></tr></table></body></html>`;
  }

  // ---- the whole thing, from a target to HTML --------------------------------------------------------------------
  const titleOf = (target, athletes) => (target.type === "location" ? target.location : target.type === "roster" ? ROSTERS[target.group] || target.group : target.type === "athlete" ? (athletes[0] && athletes[0].name) || "Athlete" : target.title || "Selected athletes");
  async function build(query, spec, { today } = {}) {
    const day = today || iso(new Date());
    const weeks = Math.max(2, Math.min(52, Number(spec.weeks) || 8));
    const athletes = await athletesFor(query, spec.target);
    const bundles = await gather(query, athletes);
    if (spec.kind === "individual") {
      const b = bundles[String(athletes[0] && athletes[0].id)];
      if (!b) return { kind: "individual", data: null };
      return { kind: "individual", data: individual(b, { weeks, today: day }) };
    }
    return { kind: "group", data: group(bundles, { weeks, today: day, title: titleOf(spec.target, athletes) }), athletes };
  }
  const render = (built, opts) => (!built.data ? `<!doctype html><html><body style="font-family:Arial;padding:30px">Nothing to report for this selection.</body></html>` : built.kind === "individual" ? renderIndividual(built.data, opts) : renderGroup(built.data, opts));

  const api = { LOCATIONS, ROSTERS, athletesFor, gather, individual, group, build, render, renderIndividual, renderGroup, emailSummary, spark, titleOf };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.ReportsEngine = api;
})(typeof window !== "undefined" ? window : globalThis);
