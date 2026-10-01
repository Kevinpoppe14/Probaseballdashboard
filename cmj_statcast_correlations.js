// Correlates CMJ force-plate percentiles (window.CmjNorms) against Baseball Savant Statcast
// percentiles (athlete.mlbPercentiles, fetched by PercentileRankingsPanel) to see whether offseason
// jump profile shows up in the following season's on-field output. Pure data/logic, no React —
// same split as cmj_norms.js, consumed by components in index.html.
(function () {
  // Statcast target metrics read off Savant's own percentile-rankings leaderboard (already 0-100,
  // same scale as the Hawkin/VALD CMJ percentiles — see cmj_norms.js), split by the same
  // pitcher/batter grouping PercentileRankingsPanel uses.
  const STATCAST_METRICS = {
    pitcher: [{ key: "fb_velocity", label: "Pitch Velocity" }],
    batter: [
      { key: "bat_speed", label: "Bat Speed" },
      { key: "exit_velocity", label: "Exit Velocity" },
      { key: "sprint_speed", label: "Sprint Speed" },
    ],
  };

  function pearson(xs, ys) {
    const n = xs.length;
    if (n < 2) return null;
    let sx = 0, sy = 0;
    for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; }
    const mx = sx / n, my = sy / n;
    let num = 0, dx2 = 0, dy2 = 0;
    for (let i = 0; i < n; i++) {
      const dx = xs[i] - mx, dy = ys[i] - my;
      num += dx * dy; dx2 += dx * dx; dy2 += dy * dy;
    }
    const denom = Math.sqrt(dx2 * dy2);
    return denom ? num / denom : null;
  }

  // One row per (CMJ offseason -> the season immediately after it) pair where both sides have
  // data, for one athlete — e.g. the '24-'25 offseason (Sept '24-May '25) pairs with the 2025
  // season, testing whether offseason jump gains show up in that year's on-field numbers. Each row
  // carries every CMJ metric percentile and every Statcast percentile for the athlete's group, so
  // callers can correlate any CMJ metric against any Statcast metric without re-deriving this.
  function athletePairs(athlete) {
    const N = window.CmjNorms;
    const mp = athlete.mlbPercentiles;
    if (!N || !mp || !mp.trendRows) return { type: null, rows: [] };
    const type = mp.type === "pitcher" ? "pitcher" : "batter";
    const groupKey = N.defaultGroupFor(athlete.position);
    const tests = window.AthleteStore.getForceTests(athlete.id);
    const trend = N.offseasonTrend(tests, groupKey);
    if (!trend) return { type, rows: [] };
    const statcastMetrics = STATCAST_METRICS[type];
    const rows = [];
    trend.forEach((pt) => {
      const statcastYear = pt.startYear + 1;
      const statRow = mp.trendRows[statcastYear];
      if (!statRow) return;
      const row = { offseason: pt.offseason, statcastYear, cmj: {}, statcast: {} };
      N.METRICS.forEach((m) => { row.cmj[m.key] = typeof pt[m.key] === "number" ? pt[m.key] : null; });
      statcastMetrics.forEach((m) => {
        const raw = statRow[m.key];
        row.statcast[m.key] = raw !== undefined && raw !== null && raw !== "" ? Number(raw) : null;
      });
      rows.push(row);
    });
    return { type, rows };
  }

  function collectAthletePairs(athletes) {
    return athletes
      .map((a) => ({ athlete: a, ...athletePairs(a) }))
      .filter((p) => p.type && p.rows.length);
  }

  // Pools every athlete-season pair in a group into one correlation per (cmjKey, statcastKey) —
  // `n` is athlete-seasons, not athletes, so the panel also reports the distinct athlete count
  // alongside it (pooling is the only way to get enough points to say anything at this roster size).
  function buildOverallMatrix(athletes, type) {
    const N = window.CmjNorms;
    const pairs = collectAthletePairs(athletes).filter((p) => p.type === type);
    const statcastMetrics = STATCAST_METRICS[type];
    const matrix = {};
    N.METRICS.forEach((m) => {
      matrix[m.key] = {};
      statcastMetrics.forEach((s) => {
        const xs = [], ys = [];
        const athletesSeen = new Set();
        pairs.forEach(({ athlete, rows }) => {
          rows.forEach((row) => {
            const x = row.cmj[m.key], y = row.statcast[s.key];
            if (typeof x === "number" && typeof y === "number") { xs.push(x); ys.push(y); athletesSeen.add(athlete.id); }
          });
        });
        matrix[m.key][s.key] = { r: pearson(xs, ys), n: xs.length, athletes: athletesSeen.size };
      });
    });
    return matrix;
  }

  // Per-athlete correlation for each (cmjKey, statcastKey), using only that one athlete's own
  // offseason->season pairs — surfaces individuals whose own jump/output link is strong even when
  // the pooled (overall) correlation across the whole roster is weak or noisy. `minN` guards against
  // reporting a "correlation" built from 2 points, which is trivially +/-1 and means nothing.
  function buildIndividualCorrelations(athletes, type, minN) {
    const N = window.CmjNorms;
    const statcastMetrics = STATCAST_METRICS[type];
    const results = [];
    collectAthletePairs(athletes).filter((p) => p.type === type).forEach(({ athlete, rows }) => {
      N.METRICS.forEach((m) => {
        statcastMetrics.forEach((s) => {
          const xs = [], ys = [];
          rows.forEach((row) => {
            const x = row.cmj[m.key], y = row.statcast[s.key];
            if (typeof x === "number" && typeof y === "number") { xs.push(x); ys.push(y); }
          });
          if (xs.length < minN) return;
          const r = pearson(xs, ys);
          if (r === null) return;
          results.push({
            athleteId: athlete.id, athleteName: athlete.name,
            cmjKey: m.key, cmjLabel: m.label, statcastKey: s.key, statcastLabel: s.label,
            r, n: xs.length,
          });
        });
      });
    });
    return results.sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
  }

  window.CmjStatcastCorrelations = {
    STATCAST_METRICS, pearson, athletePairs, buildOverallMatrix, buildIndividualCorrelations,
  };
})();
