// Mock athlete monitoring data generator.
// Produces wellness (subjective) + load (objective) daily entries for a roster,
// then derives composite readiness scores and ACWR (acute:chronic workload ratio).

(function () {
  const POSITION_GROUPS = ["Pitcher", "Catcher", "Infield", "Outfield"];

  const FIRST_NAMES = [
    "Jake", "Marcus", "Diego", "Tyler", "Kenta", "Nico", "Wyatt", "Carlos",
    "Ryan", "Elijah", "Hunter", "Mateo", "Cody", "Braylon", "Isaiah", "Owen",
    "Kai", "Trevor",
  ];
  const LAST_NAMES = [
    "Rivera", "Thompson", "Nakamura", "Bennett", "Ortiz", "Sullivan", "Reyes",
    "Foster", "Delgado", "Whitfield", "Castillo", "Harper", "Suzuki", "Malone",
    "Cabrera", "Donovan", "Reeves", "Alvarado",
  ];

  const DAYS_OF_HISTORY = 60;

  function mulberry32(seed) {
    return function () {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function dateKey(d) {
    return d.toISOString().slice(0, 10);
  }

  function buildAthlete(id) {
    const rand = mulberry32(id * 7919 + 13);
    const first = FIRST_NAMES[id % FIRST_NAMES.length];
    const last = LAST_NAMES[(id * 3 + 5) % LAST_NAMES.length];
    const position = POSITION_GROUPS[id % POSITION_GROUPS.length];
    const jersey = 10 + ((id * 7) % 89);

    // Each athlete has a baseline "profile" that biases their random walk,
    // so some are chronically fatigued / overloaded and some are steady.
    const wellnessBaseline = clamp(rand() * 0.5 + 0.4, 0.35, 0.9); // 0-1, higher = better baseline wellness
    const loadTrend = rand() * 0.6 - 0.2; // -0.2..0.4, drift in training load over time
    const loadVolatility = rand() * 0.4 + 0.3;
    const injuryRisk = rand() < 0.22; // ~22% of roster trending into risk territory

    const wellnessEntries = [];
    const loadEntries = [];

    let sleepState = wellnessBaseline;
    let sorenessState = 1 - wellnessBaseline;
    let acuteDrift = 0;

    const today = new Date();
    for (let i = DAYS_OF_HISTORY - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = dateKey(d);
      const dayIndex = DAYS_OF_HISTORY - 1 - i;

      // --- Wellness (subjective survey) ---
      sleepState = clamp(sleepState + (rand() - 0.5) * 0.15, 0.15, 0.98);
      sorenessState = clamp(
        sorenessState + (rand() - 0.5) * 0.15 + (injuryRisk ? 0.01 : -0.002),
        0.05,
        0.97
      );

      const sleepHours = +(6 + sleepState * 3.2).toFixed(1);
      const sleepQuality = Math.round(1 + sleepState * 4);
      const soreness = Math.round(1 + sorenessState * 4);
      const fatigue = Math.round(
        clamp(1 + (1 - sleepState) * 3 + (rand() - 0.5) * 1.2, 1, 5)
      );
      const stress = Math.round(clamp(1 + rand() * 3.2, 1, 5));
      const mood = Math.round(
        clamp(1 + sleepState * 3 + (rand() - 0.5) * 1.5, 1, 5)
      );

      const wellnessComposite = clamp(
        ((sleepQuality + mood + (6 - soreness) + (6 - fatigue) + (6 - stress) - 5) /
          20) *
          100,
        0,
        100
      );

      wellnessEntries.push({
        date: key,
        sleepHours,
        sleepQuality,
        soreness,
        fatigue,
        stress,
        mood,
        wellnessComposite: Math.round(wellnessComposite),
      });

      // --- Training load (objective) ---
      const seasonProgress = dayIndex / DAYS_OF_HISTORY;
      const isRestDay = rand() < 0.15;
      acuteDrift = clamp(
        acuteDrift + (rand() - 0.48 + loadTrend * 0.05) * 0.1,
        -0.3,
        injuryRisk ? 0.9 : 0.5
      );

      const intensityFactor = clamp(
        0.5 + acuteDrift + seasonProgress * loadTrend + (rand() - 0.5) * loadVolatility,
        0.05,
        1.6
      );

      const durationMin = isRestDay ? 0 : Math.round(45 + intensityFactor * 70);
      const sessionRPE = isRestDay ? 0 : Math.round(clamp(3 + intensityFactor * 6, 1, 10));
      const srpeLoad = durationMin * sessionRPE;

      const totalDistanceM = isRestDay
        ? 0
        : Math.round(1200 + intensityFactor * 3200 + rand() * 400);
      const highSpeedDistanceM = isRestDay
        ? 0
        : Math.round(totalDistanceM * (0.08 + intensityFactor * 0.12));
      const sprintCount = isRestDay ? 0 : Math.round(intensityFactor * 12 + rand() * 4);
      const pitchCount =
        position === "Pitcher" && !isRestDay && rand() < 0.55
          ? Math.round(15 + intensityFactor * 55)
          : 0;

      loadEntries.push({
        date: key,
        isRestDay,
        durationMin,
        sessionRPE,
        srpeLoad,
        totalDistanceM,
        highSpeedDistanceM,
        sprintCount,
        pitchCount,
      });
    }

    // Derive rolling acute (7d) / chronic (28d) load + ACWR for each day.
    const derived = loadEntries.map((entry, idx) => {
      const acuteWindow = loadEntries.slice(Math.max(0, idx - 6), idx + 1);
      const chronicWindow = loadEntries.slice(Math.max(0, idx - 27), idx + 1);
      const acuteAvg =
        acuteWindow.reduce((s, e) => s + e.srpeLoad, 0) / acuteWindow.length;
      const chronicAvg =
        chronicWindow.reduce((s, e) => s + e.srpeLoad, 0) / chronicWindow.length;
      const acwr = chronicAvg > 0 ? acuteAvg / chronicAvg : 0;
      return {
        ...entry,
        acuteLoad: Math.round(acuteAvg),
        chronicLoad: Math.round(chronicAvg),
        acwr: +acwr.toFixed(2),
      };
    });

    return {
      id,
      name: `${first} ${last}`,
      position,
      jersey,
      wellness: wellnessEntries,
      load: derived,
    };
  }

  const ROSTER_SIZE = 18;
  const athletes = Array.from({ length: ROSTER_SIZE }, (_, i) => buildAthlete(i + 1));

  function acwrZone(acwr) {
    if (acwr === 0) return { label: "No Data", tone: "neutral" };
    if (acwr < 0.8) return { label: "Undertrained", tone: "info" };
    if (acwr <= 1.3) return { label: "Optimal", tone: "good" };
    if (acwr <= 1.5) return { label: "Caution", tone: "warn" };
    return { label: "High Risk", tone: "danger" };
  }

  function wellnessZone(score) {
    if (score >= 75) return { label: "Good", tone: "good" };
    if (score >= 60) return { label: "Monitor", tone: "warn" };
    return { label: "Flagged", tone: "danger" };
  }

  window.AthleteData = {
    athletes,
    acwrZone,
    wellnessZone,
    DAYS_OF_HISTORY,
  };
})();
