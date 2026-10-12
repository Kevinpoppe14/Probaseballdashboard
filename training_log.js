// Training Log — what an athlete actually did, on the far-right tab of their profile. It reads the weights and
// reps typed in for each set (from the athlete's phone page, or by a coach) and any exercise or sets / reps
// changes the athlete made, and lays them out one session at a time, newest first, with the time each was entered.
// Read only: the program builder on the Player Plan is where a program is written; this is the record of it.
(function () {
  const { useState, useEffect } = React;
  const Rx = window.ProgramRx;

  const fmtWhen = (iso) => {
    if (!iso) return "";
    const d = new Date(iso);
    return isNaN(d) ? "" : d.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  };
  const fmtDay = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric", year: "numeric" }); };
  const SOURCES = { athlete: "Athlete (phone)", coach: "Coach" };

  // Sorts every logged entry into its session (one day of one program week), with each exercise's set groups
  // showing what was prescribed beside what was done. Sessions come back newest first by their latest entry.
  function buildSessions(athleteId, plan) {
    const store = window.AthleteStore;
    const entries = store.athleteLogEntries(athleteId, plan);
    const overrides = store.overridesFor(athleteId);
    const byProgram = {};
    entries.forEach((en) => { (byProgram[en.programId] = byProgram[en.programId] || []).push(en); });
    const programIds = new Set([...Object.keys(byProgram), ...Object.keys(overrides).filter((pid) => Object.keys(overrides[pid] || {}).length)]);
    const sessions = [];
    const changes = {};
    programIds.forEach((pid) => {
      const raw = store.allPrograms().find((p) => p.id === pid);
      if (!raw) return;
      const program = window.applyOverrides(raw, overrides[pid]);
      const logged = {};
      (byProgram[pid] || []).forEach((en) => { logged[en.key] = en; });
      (program.weeks || []).forEach((w, wi) => (w.sessions || []).forEach((s, si) => {
        const named = (s.exercises || []).filter((e) => (e.name || "").trim());
        const labels = window.exerciseLabels(named);
        let latest = null;
        const seen = (at) => { if (at && (!latest || at > latest)) latest = at; };
        const rows = named.map((e, ei) => {
          const groups = Rx.groups(e).map((g, gi) => {
            const w8 = logged[Rx.logKey(e, gi)], reps = logged[Rx.repsLogKey(e, gi)];
            if (w8) seen(w8.at);
            if (reps) seen(reps.at);
            const at = [w8 && w8.at, reps && reps.at].filter(Boolean).sort().pop() || null;
            return {
              rx: Rx.groupText(e, g), fail: !!Rx.failure(g),
              weight: w8 ? w8.value : "", reps: reps ? reps.value : "", at,
              source: (w8 && w8.source) || (reps && reps.source) || "",
              est: Rx.failure(g) && w8 && reps ? Rx.estimate1RM(w8.value, reps.value) : null,
            };
          });
          if (e._coach) seen(e._coach.at);
          return { label: labels[ei], name: e.name, coach: e._coach || null, groups, done: groups.some((g) => g.weight || g.reps) };
        });
        // a change the athlete made, counted once however many weeks they applied it to
        rows.filter((r) => r.coach).forEach((r) => {
          const key = `${pid}|${r.coach.name}|${r.name}|${r.groups.map((g) => g.rx).join(" ")}`;
          const c = (changes[key] = changes[key] || { program: program.name, from: r.coach.name, fromText: r.coach.text, to: r.name, toText: r.groups.map((g) => g.rx).join("  "), at: r.coach.at, weeks: [] });
          if (!c.weeks.includes(wi + 1)) c.weeks.push(wi + 1);
          if (r.coach.at && (!c.at || r.coach.at > c.at)) c.at = r.coach.at;
        });
        // a session is listed once something in it has been logged
        // A session counts as logged when the athlete pressed Log session on their phone (a mark kept in the log
        // under its own key), or when any weight or reps was entered for it. A marked session lists the whole
        // day, so a workout logged without weights still shows what it was.
        const mark = logged[`session-${wi}-${si}|0`] || null;
        const when = (mark && mark.at) || latest;
        if (mark || rows.some((r) => r.done)) sessions.push({ id: `${pid}|${wi}|${si}`, program: program.name, week: w.name || `Week ${wi + 1}`, day: s.name || `Day ${si + 1}`, rows: mark ? rows : rows.filter((r) => r.done || r.coach), latest: when, marked: !!mark, markedAt: mark ? mark.at : null, weights: rows.some((r) => r.done) });
      }));
    });
    // sessions with a time first (newest at the top), then older entries that were logged before times were kept
    sessions.sort((a, b) => (b.latest || "").localeCompare(a.latest || ""));
    return { sessions, changes: Object.values(changes).sort((a, b) => (b.at || "").localeCompare(a.at || "")) };
  }

  // KPI results from Group Testing in Coach Mode (a 10-yard start, a jump, anything not in a program): one card per
  // KPI with its results over time as a line, the best one marked, and each result listed newest first.
  function KpiTrend({ rows, better }) {
    const pts = [...rows].sort((a, b) => `${a.date}${a.at || ""}`.localeCompare(`${b.date}${b.at || ""}`));
    if (pts.length < 2) return null;
    const W = 320, H = 90, P = 10;
    const vals = pts.map((p) => p.value), lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
    const x = (i) => P + (i / (pts.length - 1)) * (W - 2 * P);
    const y = (v) => P + (1 - (v - lo) / span) * (H - 2 * P);
    const best = better === "lower" ? lo : hi;
    return (
      <svg className="tl-kpi-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Results over time">
        <polyline points={pts.map((p, i) => `${x(i)},${y(p.value)}`).join(" ")} />
        {pts.map((p, i) => <circle key={i} cx={x(i)} cy={y(p.value)} r={p.value === best ? 4.5 : 3} className={p.value === best ? "best" : ""}><title>{`${p.date}: ${p.value}`}</title></circle>)}
      </svg>
    );
  }
  function KpiSection({ athlete }) {
    const store = window.AthleteStore;
    const [rows, setRows] = useState(null);
    const load = () => store.loadKpiEntries(athlete.id).then(setRows);
    useEffect(() => { load(); /* eslint-disable-next-line */ }, [athlete.id]);
    if (!rows || !rows.length) return null;
    const groups = {};
    rows.forEach((r) => { (groups[r.kpiId || r.kpiName] = groups[r.kpiId || r.kpiName] || []).push(r); });
    const remove = async (r) => {
      if (!window.confirm(`Delete this ${r.kpiName} result (${r.value}${r.unit ? ` ${r.unit}` : ""}, ${r.date})?`)) return;
      if (await store.deleteKpiEntry(r.id)) load();
    };
    return (
      <div className="panel">
        <h2>KPIs <small>results from Group Testing in Coach Mode</small></h2>
        <div className="tl-kpis">
          {Object.values(groups).sort((a, b) => a[0].kpiName.localeCompare(b[0].kpiName)).map((list) => {
            const k = list[0];
            const vals = list.map((r) => r.value);
            const best = k.better === "lower" ? Math.min(...vals) : Math.max(...vals);
            const u = k.unit ? ` ${k.unit}` : "";
            const trialsOf = (r) => (Array.isArray(r.trials) && r.trials.length ? r.trials : [r.value]);
            const all = list.flatMap(trialsOf);
            const average = Math.round((all.reduce((s, v) => s + v, 0) / all.length) * 100) / 100;
            const newest = [...list].sort((a, b) => `${b.date}${b.at || ""}`.localeCompare(`${a.date}${a.at || ""}`));
            return (
              <div className="tl-kpi" key={k.kpiId || k.kpiName}>
                <h3>{k.kpiName} <small>PR {best}{u} · average {average}{u} · {list.length} session{list.length === 1 ? "" : "s"}</small></h3>
                <KpiTrend rows={list} better={k.better} />
                <table className="tl-table">
                  <thead><tr><th>Session</th><th>Best</th><th>Avg</th><th>Trials</th><th>Entered by</th><th className="no-print"></th></tr></thead>
                  <tbody>
                    {newest.map((r) => (
                      <tr key={r.id}>
                        <td>{fmtDay(`${r.date}T12:00:00`)}</td>
                        <td className="tl-done">{r.value}{u}{r.value === best ? <em> PR</em> : null}</td>
                        <td>{r.avg != null ? r.avg : r.value}{u}</td>
                        <td className="tl-when">{trialsOf(r).join(", ")}</td>
                        <td className="tl-when">{r.by || ""}</td>
                        <td className="no-print"><button className="btn-link" onClick={() => remove(r)}>Delete</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  function TrainingLogTab({ athlete }) {
    const store = window.AthleteStore;
    const [tick, setTick] = useState(0);
    const [loading, setLoading] = useState(true);
    // pick up what the athlete has entered on their phone since the dashboard loaded
    const refresh = () => {
      setLoading(true);
      store.refreshAthleteLogs(athlete.id).then(() => { setLoading(false); setTick((n) => n + 1); });
    };
    useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [athlete.id]);

    const { sessions, changes } = buildSessions(athlete.id, store.getPeriodization(athlete.id));
    const weeksText = (ws) => { const s = [...ws].sort((a, b) => a - b); return s.length === 1 ? `week ${s[0]}` : `weeks ${s.join(", ")}`; };
    return (
      <div className="tl-wrap" key={tick}>
        <div className="panel">
          <h2>Training Log <small>What was actually done, newest first. Times are when each entry was typed in.</small></h2>
          <div className="tl-actions no-print">
            <button className="btn btn-secondary" onClick={refresh} disabled={loading}>{loading ? "Loading…" : "Refresh"}</button>
            <span className="timestamp-note">{sessions.length} session{sessions.length === 1 ? "" : "s"} with something logged for {athlete.name}.</span>
          </div>
        </div>

        <KpiSection athlete={athlete} />

        {changes.length > 0 && (
          <div className="panel">
            <h2>Changes by the athlete <small>exercises or sets and reps they switched on their phone</small></h2>
            <ul className="tl-changes">
              {changes.map((c, i) => (
                <li key={i}>
                  <strong>{c.from}</strong>{c.fromText ? ` (${c.fromText})` : ""} → <strong>{c.to}</strong>{c.toText ? ` (${c.toText})` : ""}
                  <small>{c.program}, {weeksText(c.weeks)}{c.at ? ` · ${fmtWhen(c.at)}` : ""}</small>
                </li>
              ))}
            </ul>
          </div>
        )}

        {sessions.length === 0 && !loading && (
          <div className="panel"><div className="empty-state">Nothing logged yet. Weights and reps {athlete.name} enters on their phone link will show up here.</div></div>
        )}

        {sessions.map((s) => (
          <div className="panel tl-session" key={s.id}>
            <h2>
              {s.latest ? fmtDay(s.latest) : "Date not recorded"}
              <small>{s.program} · {s.week} · {s.day}</small>
              <span className={`tl-badge ${s.marked ? "marked" : "weights"}`}>
                {s.marked ? `Logged with the Log session button${s.markedAt ? ` · ${fmtWhen(s.markedAt)}` : ""}${s.weights ? "" : " · no weights entered"}` : "Weights entered, Log session not pressed"}
              </span>
            </h2>
            <table className="tl-table">
              <thead><tr><th>Exercise</th><th>Prescribed</th><th>Done</th><th>Entered</th></tr></thead>
              <tbody>
                {s.rows.map((r, ri) => (
                  <React.Fragment key={ri}>
                    {(r.groups.length ? r.groups : [null]).map((g, gi) => (
                      <tr key={gi} className={gi === 0 ? "tl-first" : ""}>
                        {gi === 0 && (
                          <td rowSpan={Math.max(1, r.groups.length)} className="tl-ex">
                            <strong className="superset-label">{r.label}</strong> {r.name}
                            {r.coach && <div className="tl-changed">Changed by athlete{r.coach.at ? ` ${fmtWhen(r.coach.at)}` : ""}. Coach: {r.coach.name}{r.coach.text ? `, ${r.coach.text}` : ""}</div>}
                          </td>
                        )}
                        <td>{g ? g.rx : "—"}</td>
                        <td className="tl-done">
                          {g && (g.weight || g.reps)
                            ? <span>{g.weight || "?"}{g.reps ? ` x ${g.reps}` : ""}{g.est ? <em> (est. 1RM {g.est})</em> : null}</span>
                            : <span className="tl-none">not logged</span>}
                        </td>
                        <td className="tl-when">{g && (g.weight || g.reps) ? `${fmtWhen(g.at) || "time not recorded"}${SOURCES[g.source] ? ` · ${SOURCES[g.source]}` : ""}` : ""}</td>
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    );
  }

  window.TrainingLogTab = TrainingLogTab;
})();
