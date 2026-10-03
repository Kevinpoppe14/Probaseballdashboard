// CMJ positional norms + profiling logic for the Performance Metrics tab.
//
// HAWKIN: "Practical Force & Strength Assessments for Baseball Athletes" (Hawkin Dynamics mini-guide),
// MLB normative data, CMJ hands-on-hips. Each table lists 20 values from the top of the distribution
// down, in 5-percentile steps (row 1 = 100th, the "-" median row = 50th, last row = 5th).
// VALD: "VALD Normative Data Report - 2025 MLB Report", ForceDecks CMJ benchmarks by grouped
// position, given as the 5th / 25th / 50th / 75th / 95th percentiles.
//
// Both are hands-on-hips CMJ only, so only plain "Countermovement Jump" tests are profiled (arm-swing,
// weighted, plyo push-up etc. are excluded).
(function () {
  const HAWKIN_GROUPS = [
    { key: "allPosition", label: "All Position Players" },
    { key: "catcher", label: "Catcher" },
    { key: "allInfield", label: "All Infield" },
    { key: "middleInfield", label: "Middle Infield" },
    { key: "cornerInfield", label: "Corner Infield" },
    { key: "outfield", label: "Outfield" },
    { key: "allPitcher", label: "All Pitchers" },
    { key: "rhp", label: "RHP" },
    { key: "lhp", label: "LHP" },
  ];

  // VALD groups: 1 = 1B & C, 2 = 2B/3B/SS, 3 = OF, 4 = P.
  const VALD_GROUP_FOR = {
    allPosition: null, catcher: "g1", allInfield: "g2", middleInfield: "g2", cornerInfield: "g2",
    outfield: "g3", allPitcher: "g4", rhp: "g4", lhp: "g4",
  };
  const VALD_GROUP_LABEL = { g1: "First Base & Catcher", g2: "2B / 3B / SS", g3: "Outfield", g4: "Pitcher" };

  const H = (allPosition, catcher, allInfield, middleInfield, cornerInfield, outfield, allPitcher, rhp, lhp) =>
    ({ allPosition, catcher, allInfield, middleInfield, cornerInfield, outfield, allPitcher, rhp, lhp });

  const HAWKIN_TABLES = {
    jumpHeight: H(
      [0.56, 0.55, 0.52, 0.50, 0.49, 0.48, 0.47, 0.47, 0.46, 0.45, 0.45, 0.44, 0.43, 0.43, 0.41, 0.40, 0.39, 0.37, 0.35, 0.33],
      [0.49, 0.48, 0.47, 0.46, 0.45, 0.44, 0.44, 0.43, 0.42, 0.40, 0.39, 0.38, 0.37, 0.36, 0.35, 0.34, 0.33, 0.33, 0.31, 0.29],
      [0.52, 0.51, 0.50, 0.49, 0.48, 0.47, 0.46, 0.46, 0.45, 0.45, 0.44, 0.43, 0.43, 0.42, 0.41, 0.40, 0.39, 0.38, 0.36, 0.33],
      [0.52, 0.52, 0.50, 0.49, 0.49, 0.48, 0.47, 0.46, 0.45, 0.45, 0.44, 0.43, 0.42, 0.41, 0.41, 0.39, 0.38, 0.36, 0.34, 0.33],
      [0.51, 0.50, 0.49, 0.48, 0.47, 0.46, 0.46, 0.45, 0.45, 0.44, 0.44, 0.44, 0.43, 0.42, 0.42, 0.40, 0.40, 0.39, 0.38, 0.35],
      [0.57, 0.56, 0.55, 0.53, 0.52, 0.51, 0.50, 0.49, 0.48, 0.48, 0.47, 0.46, 0.45, 0.45, 0.44, 0.43, 0.42, 0.41, 0.40, 0.38],
      [0.58, 0.57, 0.54, 0.52, 0.50, 0.49, 0.48, 0.47, 0.46, 0.45, 0.45, 0.44, 0.44, 0.43, 0.42, 0.41, 0.40, 0.39, 0.38, 0.36],
      [0.58, 0.56, 0.53, 0.51, 0.49, 0.48, 0.47, 0.46, 0.46, 0.45, 0.44, 0.44, 0.43, 0.42, 0.42, 0.41, 0.40, 0.39, 0.38, 0.36],
      [0.59, 0.58, 0.56, 0.55, 0.53, 0.51, 0.50, 0.49, 0.48, 0.47, 0.46, 0.46, 0.45, 0.44, 0.44, 0.42, 0.41, 0.40, 0.38, 0.36]
    ),
    jumpMomentum: H(
      [336.8, 329.6, 321.6, 313.5, 307.8, 302.1, 296.1, 291.5, 287.2, 281.7, 277.8, 273.5, 270.3, 265.6, 258.5, 253.6, 249.3, 244.7, 237.8, 228.9],
      [324.9, 323.5, 320.0, 316.1, 311.8, 308.0, 306.2, 300.2, 289.2, 285.2, 278.6, 270.2, 263.5, 257.6, 255.6, 250.6, 247.9, 244.7, 238.0, 225.4],
      [347.7, 342.4, 332.0, 324.8, 305.6, 298.6, 291.4, 284.4, 273.9, 268.9, 261.8, 256.4, 253.6, 249.9, 246.7, 243.8, 240.7, 235.9, 231.3, 218.5],
      [286.8, 285.0, 275.7, 270.8, 264.4, 258.4, 255.7, 253.8, 250.7, 248.1, 246.4, 244.4, 243.1, 240.5, 237.5, 234.8, 233.2, 228.7, 221.4, 213.9],
      [351.3, 349.3, 344.8, 340.0, 334.6, 331.3, 328.6, 324.8, 319.1, 307.2, 303.2, 299.8, 298.3, 295.8, 291.4, 278.9, 270.6, 266.3, 254.9, 251.5],
      [324.3, 320.1, 314.9, 309.4, 305.7, 300.0, 295.0, 292.7, 290.3, 286.9, 283.3, 280.3, 277.5, 274.5, 272.7, 270.2, 267.4, 263.5, 255.4, 245.6],
      [351.4, 339.9, 326.5, 317.6, 310.6, 306.0, 302.2, 298.9, 296.0, 292.9, 289.7, 285.1, 279.3, 275.7, 272.6, 269.2, 263.7, 256.8, 249.8, 238.4],
      [356.2, 337.5, 322.3, 313.6, 306.6, 302.6, 298.8, 295.7, 292.2, 288.9, 284.8, 279.8, 276.9, 274.3, 271.4, 268.6, 264.7, 258.8, 252.8, 245.0],
      [346.6, 341.0, 332.2, 323.3, 317.2, 313.0, 309.6, 306.3, 303.7, 300.8, 298.2, 295.3, 292.4, 287.8, 276.8, 266.2, 254.3, 247.3, 236.2, 221.0]
    ),
    brakingNetImpulse: H(
      [181.5, 175.0, 162.9, 155.8, 149.5, 144.2, 139.7, 135.1, 130.3, 126.3, 123.4, 120.6, 116.7, 113.1, 109.7, 106.0, 100.4, 95.7, 88.8, 79.6],
      [183.3, 179.6, 174.2, 170.3, 166.6, 160.0, 154.6, 147.3, 141.6, 138.6, 135.6, 130.9, 128.6, 125.6, 123.2, 117.6, 111.3, 107.0, 96.2, 81.6],
      [196.1, 186.8, 164.0, 154.2, 147.3, 142.5, 135.4, 130.4, 126.5, 123.6, 121.3, 118.3, 115.9, 113.0, 108.6, 103.3, 97.1, 92.3, 84.6, 72.3],
      [146.9, 144.0, 135.5, 129.4, 125.4, 123.2, 121.5, 118.7, 117.0, 115.0, 111.8, 107.1, 101.6, 97.3, 95.9, 92.1, 87.4, 83.9, 74.0, 66.6],
      [200.1, 197.8, 188.7, 179.5, 169.1, 162.6, 156.8, 153.2, 150.0, 146.7, 142.5, 136.6, 133.8, 129.4, 126.4, 122.8, 117.9, 115.1, 109.8, 106.5],
      [163.4, 159.7, 153.5, 149.7, 144.6, 141.6, 137.7, 133.0, 128.3, 123.6, 120.7, 115.4, 112.9, 110.1, 107.0, 103.2, 99.4, 94.5, 89.3, 84.1],
      [193.7, 185.5, 174.4, 167.6, 162.2, 157.0, 153.6, 150.3, 146.7, 143.2, 139.9, 136.9, 134.2, 130.6, 126.0, 121.9, 115.9, 110.6, 104.1, 93.8],
      [187.8, 179.2, 170.2, 164.6, 159.1, 155.0, 151.8, 148.2, 145.4, 141.8, 139.2, 136.5, 133.7, 130.6, 126.3, 122.4, 117.4, 111.8, 105.2, 93.7],
      [197.6, 192.7, 184.6, 179.0, 172.5, 166.3, 160.6, 156.1, 153.0, 149.5, 145.6, 140.3, 136.6, 131.7, 125.1, 118.9, 112.7, 107.3, 101.8, 95.1]
    ),
    propulsiveNetImpulse: H(
      [338.4, 330.9, 322.9, 314.3, 309.0, 303.3, 297.2, 292.4, 288.3, 282.8, 278.6, 274.5, 271.3, 266.7, 259.2, 254.4, 250.3, 245.6, 238.6, 229.5],
      [325.9, 324.5, 321.3, 317.0, 312.9, 309.7, 307.5, 301.2, 289.9, 286.0, 279.6, 271.6, 264.4, 258.4, 256.6, 252.0, 249.3, 246.1, 238.7, 226.5],
      [348.4, 343.1, 332.5, 325.8, 306.4, 299.5, 292.6, 285.6, 274.7, 269.6, 262.8, 257.0, 254.2, 250.7, 247.1, 244.7, 241.2, 236.3, 232.6, 219.4],
      [288.0, 285.7, 276.7, 271.8, 265.4, 258.9, 256.4, 254.3, 251.5, 249.0, 246.9, 245.2, 243.7, 241.2, 238.3, 235.5, 234.0, 229.4, 222.4, 214.4],
      [352.0, 350.5, 345.8, 341.4, 335.9, 332.2, 329.6, 325.8, 320.8, 308.2, 304.1, 300.9, 298.9, 297.0, 292.1, 279.7, 271.2, 267.5, 255.2, 252.4],
      [325.2, 321.2, 316.1, 310.3, 307.0, 301.0, 296.2, 293.8, 291.4, 287.9, 284.2, 281.1, 278.2, 275.4, 273.4, 271.3, 268.0, 264.6, 255.8, 246.2],
      [352.4, 341.0, 327.5, 318.6, 311.6, 306.9, 303.2, 299.9, 296.9, 293.8, 290.5, 285.9, 280.3, 276.8, 273.5, 270.1, 264.6, 257.5, 250.7, 239.3],
      [357.1, 338.5, 323.3, 314.7, 307.6, 303.4, 299.6, 296.6, 293.4, 289.8, 285.5, 280.7, 277.6, 275.3, 272.3, 269.5, 265.7, 259.9, 253.6, 245.9],
      [347.4, 342.3, 333.3, 324.8, 318.3, 313.9, 310.9, 307.0, 304.4, 301.9, 299.2, 296.1, 293.4, 288.7, 277.6, 267.2, 255.2, 248.5, 236.9, 221.5]
    ),
    peakRelPropPower: H(
      [79.1, 75.6, 71.8, 68.9, 67.2, 65.8, 64.7, 63.8, 63.0, 62.1, 61.3, 60.2, 59.5, 58.6, 57.7, 56.5, 54.9, 52.8, 49.7, 47.0],
      [64.8, 63.1, 61.5, 60.4, 59.9, 59.5, 58.7, 58.1, 56.6, 55.6, 54.5, 53.0, 50.6, 49.2, 48.4, 47.4, 46.7, 46.2, 45.2, 43.7],
      [71.5, 69.5, 68.0, 66.3, 65.5, 64.2, 63.6, 63.1, 62.5, 61.8, 60.5, 59.9, 59.3, 58.2, 57.3, 56.5, 54.8, 53.0, 51.4, 49.0],
      [72.9, 71.7, 69.0, 67.8, 66.4, 65.8, 64.6, 63.7, 63.4, 62.8, 62.2, 61.4, 60.1, 59.2, 58.0, 56.8, 55.9, 54.2, 51.6, 49.0],
      [68.1, 67.5, 65.4, 64.3, 63.7, 63.2, 62.8, 61.8, 60.5, 60.1, 59.7, 59.2, 58.7, 57.8, 56.6, 55.3, 53.5, 52.2, 51.0, 48.9],
      [80.8, 80.1, 75.5, 73.2, 71.1, 69.0, 67.7, 66.6, 65.7, 65.0, 64.5, 63.5, 62.7, 61.8, 61.0, 59.6, 58.6, 57.6, 56.2, 53.3],
      [79.2, 76.7, 72.2, 69.1, 67.0, 65.6, 64.2, 63.1, 62.1, 61.2, 60.5, 59.8, 59.0, 58.3, 57.5, 56.8, 56.1, 55.1, 53.6, 51.4],
      [79.6, 76.2, 70.6, 67.6, 65.9, 64.4, 63.3, 62.2, 61.4, 60.7, 60.0, 59.3, 58.6, 58.0, 57.3, 56.6, 56.0, 55.1, 53.8, 51.6],
      [78.8, 77.5, 74.3, 71.7, 69.6, 68.0, 66.4, 65.3, 64.1, 63.1, 62.1, 61.1, 60.1, 58.9, 58.0, 57.1, 56.0, 55.0, 53.4, 50.9]
    ),
    mRSI: H(
      [0.77, 0.74, 0.68, 0.64, 0.61, 0.60, 0.58, 0.57, 0.55, 0.54, 0.53, 0.52, 0.50, 0.48, 0.46, 0.44, 0.42, 0.40, 0.37, 0.34],
      [0.63, 0.61, 0.59, 0.57, 0.56, 0.55, 0.53, 0.51, 0.49, 0.47, 0.45, 0.43, 0.42, 0.40, 0.40, 0.38, 0.36, 0.35, 0.32, 0.29],
      [0.69, 0.66, 0.63, 0.61, 0.60, 0.58, 0.56, 0.55, 0.55, 0.53, 0.52, 0.51, 0.49, 0.48, 0.47, 0.44, 0.41, 0.39, 0.37, 0.35],
      [0.70, 0.66, 0.63, 0.61, 0.60, 0.59, 0.58, 0.56, 0.55, 0.54, 0.53, 0.51, 0.50, 0.48, 0.46, 0.42, 0.41, 0.39, 0.37, 0.35],
      [0.68, 0.66, 0.61, 0.60, 0.58, 0.57, 0.56, 0.55, 0.54, 0.53, 0.52, 0.51, 0.48, 0.47, 0.47, 0.45, 0.43, 0.40, 0.37, 0.35],
      [0.81, 0.77, 0.73, 0.69, 0.66, 0.64, 0.62, 0.60, 0.58, 0.56, 0.55, 0.54, 0.53, 0.52, 0.50, 0.48, 0.46, 0.45, 0.42, 0.39],
      [0.79, 0.76, 0.70, 0.66, 0.63, 0.61, 0.59, 0.58, 0.56, 0.55, 0.54, 0.52, 0.51, 0.50, 0.49, 0.47, 0.45, 0.43, 0.41, 0.37],
      [0.79, 0.76, 0.69, 0.64, 0.62, 0.61, 0.59, 0.57, 0.56, 0.54, 0.53, 0.52, 0.51, 0.49, 0.48, 0.46, 0.45, 0.42, 0.40, 0.36],
      [0.79, 0.76, 0.71, 0.68, 0.66, 0.64, 0.61, 0.59, 0.58, 0.56, 0.55, 0.54, 0.52, 0.51, 0.50, 0.49, 0.47, 0.46, 0.43, 0.41]
    ),
  };

  // VALD [5th, 25th, 50th, 75th, 95th]. Group 2's printed 25th-percentile body mass reads "0.84",
  // an obvious typo for 84.0.
  const VALD_TABLES = {
    jumpHeightCm: { g1: [33.3, 38.7, 42.8, 47.3, 53.4], g2: [35.1, 40.3, 44.1, 48.0, 53.2], g3: [35.3, 40.7, 44.5, 48.7, 55.4], g4: [33.7, 39.4, 43.3, 47.5, 54.3] },
    mRSI: { g1: [0.45, 0.56, 0.65, 0.74, 0.87], g2: [0.46, 0.57, 0.66, 0.75, 0.87], g3: [0.45, 0.58, 0.68, 0.78, 0.91], g4: [0.43, 0.56, 0.64, 0.72, 0.85] },
    peakPowerBM: { g1: [49, 55, 59, 64, 72], g2: [50, 57, 61, 66, 73], g3: [52, 58, 63, 67, 74], g4: [49, 55, 59, 63, 71] },
    bodyMassKg: { g1: [82.6, 90.7, 96.1, 102.7, 114.7], g2: [77.0, 84.0, 89.7, 96.0, 105.8], g3: [78.7, 87.7, 93.3, 98.8, 107.5], g4: [80.2, 89.8, 96.9, 103.8, 113.7] },
  };

  const num = (v) => (typeof v === "number" && isFinite(v) ? v : null);
  const G = 9.81;

  // Every profiled metric, with how to read it off a raw Hawkin test. `hawkin` / `vald` name the norm
  // table it's compared against (either may be missing). `approx` marks VALD alignments where the two
  // systems define the metric slightly differently.
  const METRICS = [
    { key: "bodyMassKg", label: "Body Weight", unit: "lb", decimals: 0, vald: "bodyMassKg", group: "context",
      raw: (r) => { const w = num(r["System Weight(N)"]); return w ? w / G : null; }, display: (kg) => kg * 2.20462 },
    { key: "jumpHeight", label: "Jump Height", unit: "in", decimals: 1, hawkin: "jumpHeight", vald: "jumpHeightCm", group: "output",
      raw: (r) => num(r["Jump Height(m)"]), display: (m) => m / 0.0254, toVald: (m) => m * 100 },
    { key: "jumpMomentum", label: "Jump Momentum", unit: "kg·m/s", decimals: 0, hawkin: "jumpMomentum", group: "output",
      raw: (r) => num(r["Jump Momentum(kg.m/s)"]) },
    { key: "propulsiveNetImpulse", label: "Propulsive Net Impulse", unit: "N·s", decimals: 0, hawkin: "propulsiveNetImpulse", group: "output",
      raw: (r) => num(r["Propulsive Net Impulse(N.s)"]) },
    { key: "peakRelPropPower", label: "Peak Relative Propulsive Power", unit: "W/kg", decimals: 1, hawkin: "peakRelPropPower", vald: "peakPowerBM", group: "output",
      raw: (r) => num(r["Peak Relative Propulsive Power(W/kg)"]) },
    { key: "brakingNetImpulse", label: "Braking Net Impulse", unit: "N·s", decimals: 0, hawkin: "brakingNetImpulse", group: "braking",
      raw: (r) => num(r["Braking Net Impulse(N.s)"]) },
    { key: "mRSI", label: "mRSI", unit: "", decimals: 2, hawkin: "mRSI", vald: "mRSI", group: "strategy",
      raw: (r) => num(r["mRSI"]) },
  ];

  // Hawkin rows run 100th -> 5th percentile in 5-point steps.
  function hawkinPercentile(table, value, lowerIsBetter) {
    if (!table || value === null) return null;
    const vals = lowerIsBetter ? table.map((v) => -v) : table;
    const v = lowerIsBetter ? -value : value;
    if (v >= vals[0]) return 99;
    for (let i = 1; i < vals.length; i++) {
      if (v >= vals[i]) {
        const span = vals[i - 1] - vals[i];
        const pctHere = 100 - 5 * i;
        return Math.min(99, span > 0 ? pctHere + (5 * (v - vals[i])) / span : pctHere);
      }
    }
    return 2;
  }

  function valdPercentile(points, value) {
    if (!points || value === null) return null;
    const ps = [5, 25, 50, 75, 95];
    if (value <= points[0]) return Math.max(1, 5 * (value / points[0]) ** 4);
    if (value >= points[4]) return Math.min(99, 95 + 4 * Math.min(1, (value - points[4]) / (points[4] - points[3] || 1)));
    for (let i = 1; i < 5; i++) {
      if (value <= points[i]) {
        return ps[i - 1] + ((ps[i] - ps[i - 1]) * (value - points[i - 1])) / (points[i] - points[i - 1] || 1);
      }
    }
    return 50;
  }

  function band(pct) {
    if (pct === null || pct === undefined) return null;
    if (pct >= 77.5) return "Elite";
    if (pct >= 52.5) return "Good";
    if (pct >= 47.5) return "Average";
    if (pct >= 27.5) return "Below";
    return "Poor";
  }

  function defaultGroupFor(position) {
    if (position === "Pitcher") return "allPitcher";
    if (position === "Catcher") return "catcher";
    if (position === "Infield") return "allInfield";
    if (position === "Outfield") return "outfield";
    return "allPosition";
  }

  const PROFILE_WINDOW_DAYS = 30;
  const dayMs = (d) => new Date(`${d}T00:00:00`).getTime();

  // Averages every hands-on-hips CMJ from the PROFILE_WINDOW_DAYS before (and including) the
  // athlete's most recent one, so a single off day doesn't define the profile.
  function buildProfile(tests, groupKey) {
    const cmj = (tests || []).filter((t) => t.testType === "Countermovement Jump" && t.raw && t.date).sort((a, b) => a.date.localeCompare(b.date));
    if (!cmj.length) return null;
    const last = cmj[cmj.length - 1].date;
    const used = cmj.filter((t) => (dayMs(last) - dayMs(t.date)) / 864e5 <= PROFILE_WINDOW_DAYS);
    const valdGroup = VALD_GROUP_FOR[groupKey];
    const rows = METRICS.map((m) => {
      const vals = used.map((t) => m.raw(t.raw)).filter((v) => v !== null);
      if (!vals.length) return { ...m, value: null, hawkinPct: null, valdPct: null };
      const value = vals.reduce((s, v) => s + v, 0) / vals.length;
      const hawkinTable = m.hawkin && HAWKIN_TABLES[m.hawkin][groupKey];
      const valdPoints = m.vald && valdGroup ? VALD_TABLES[m.vald][valdGroup] : null;
      const hawkinPct = hawkinTable ? hawkinPercentile(hawkinTable, value, m.lowerIsBetter) : null;
      const valdPct = valdPoints ? valdPercentile(valdPoints, m.toVald ? m.toVald(value) : value) : null;
      return { ...m, value, displayValue: m.display ? m.display(value) : value, n: vals.length, hawkinPct, valdPct };
    });
    const bodyMassRow = rows.find((r) => r.key === "bodyMassKg");
    return {
      groupKey,
      groupLabel: (HAWKIN_GROUPS.find((g) => g.key === groupKey) || {}).label,
      valdGroup,
      valdGroupLabel: valdGroup ? VALD_GROUP_LABEL[valdGroup] : null,
      firstDate: used[0].date,
      lastDate: last,
      testCount: used.length,
      totalCmj: cmj.length,
      excludedVariants: (tests || []).filter((t) => t.testType && t.testType !== "Countermovement Jump" && /countermovement/i.test(t.testType)).length,
      bodyMassKg: bodyMassRow.value,
      bodyMassValdPct: bodyMassRow.valdPct,
      rows,
    };
  }

  // Offseason = September 1 through May 31 (e.g. Sep 2019 - May 2020 is '19-'20). In-season months
  // (June-August) aren't part of any offseason bucket and are left out of this trend entirely.
  function offseasonKey(dateStr) {
    const d = new Date(`${dateStr}T00:00:00`);
    const y = d.getFullYear(), m = d.getMonth() + 1;
    const yy = (n) => String(n).slice(-2);
    if (m >= 9) return { startYear: y, label: `'${yy(y)}-'${yy(y + 1)}` };
    if (m <= 5) return { startYear: y - 1, label: `'${yy(y - 1)}-'${yy(y)}` };
    return null;
  }

  // One point per offseason, from the athlete's earliest tracked offseason to their most recent —
  // never further back than their own data goes. Each point scores that offseason's average CMJ
  // against the SAME norm table (groupKey) used everywhere else in the profile, so the line reflects
  // real change in the athlete rather than a moving baseline. Offseasons with no tests in between are
  // kept as null (not skipped), so the line visibly gaps instead of connecting across a missed year.
  function offseasonTrend(tests, groupKey) {
    const cmj = (tests || []).filter((t) => t.testType === "Countermovement Jump" && t.raw && t.date);
    if (!cmj.length) return null;
    const byYear = {};
    cmj.forEach((t) => {
      const k = offseasonKey(t.date);
      if (!k) return;
      (byYear[k.startYear] = byYear[k.startYear] || { label: k.label, tests: [] }).tests.push(t);
    });
    const years = Object.keys(byYear).map(Number).sort((a, b) => a - b);
    if (!years.length) return null;
    const hawkinMetrics = METRICS.filter((m) => m.hawkin);
    const valdGroup = VALD_GROUP_FOR[groupKey];
    // Body mass has no Hawkin norm, so it's scored against VALD here same as everywhere else in the
    // profile — included for its own trend line, but kept out of "overall" (that stays Hawkin-only,
    // same metrics as the headline percentile and recommendations).
    const extraMetrics = METRICS.filter((m) => !m.hawkin && m.key === "bodyMassKg");
    const points = [];
    for (let y = years[0]; y <= years[years.length - 1]; y++) {
      const bucket = byYear[y];
      const yy = (n) => String(n).slice(-2);
      const point = { offseason: bucket ? bucket.label : `'${yy(y)}-'${yy(y + 1)}`, startYear: y, n: bucket ? bucket.tests.length : 0 };
      hawkinMetrics.forEach((m) => {
        const vals = bucket ? bucket.tests.map((t) => m.raw(t.raw)).filter((v) => v !== null) : [];
        if (!vals.length) { point[m.key] = null; return; }
        const value = vals.reduce((s, v) => s + v, 0) / vals.length;
        const table = HAWKIN_TABLES[m.hawkin][groupKey];
        point[m.key] = table ? hawkinPercentile(table, value, m.lowerIsBetter) : null;
      });
      extraMetrics.forEach((m) => {
        const vals = bucket ? bucket.tests.map((t) => m.raw(t.raw)).filter((v) => v !== null) : [];
        if (!vals.length) { point[m.key] = null; return; }
        const value = vals.reduce((s, v) => s + v, 0) / vals.length;
        const valdPoints = m.vald && valdGroup ? VALD_TABLES[m.vald][valdGroup] : null;
        point[m.key] = valdPoints ? valdPercentile(valdPoints, value) : null;
      });
      const pcts = hawkinMetrics.map((m) => point[m.key]).filter((v) => typeof v === "number");
      point.overall = pcts.length ? pcts.reduce((s, v) => s + v, 0) / pcts.length : null;
      points.push(point);
    }
    return points;
  }

  const mean = (xs) => { const v = xs.filter((x) => typeof x === "number"); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
  const ord = (n) => { const r = Math.round(n), s = ["th", "st", "nd", "rd"], v = r % 100; return r + (s[(v - 20) % 10] || s[v] || s[0]); };

  // Rule-based read of the profile, following the Hawkin guide's framing: jump height and momentum are
  // the outcome, propulsive impulse and power are what drive it, and mRSI describes how quickly the
  // athlete gets there (strategy). Each item: { tone: "good"|"warn"|"info", text }.
  function recommendations(profile, ctx) {
    if (!profile) return [];
    const by = Object.fromEntries(profile.rows.map((r) => [r.key, r]));
    const hp = (k) => (by[k] ? by[k].hawkinPct : null);
    const items = [];
    const first = (ctx.name || "").trim().split(/\s+/)[0] || "This athlete";
    const isPitcher = ["allPitcher", "rhp", "lhp"].includes(profile.groupKey);

    const hawkinPcts = profile.rows.map((r) => r.hawkinPct).filter((p) => p !== null);
    const overall = mean(hawkinPcts);
    if (overall !== null) {
      items.push({ tone: overall >= 52.5 ? "good" : overall >= 47.5 ? "info" : "warn",
        text: `Overall: ${first}'s CMJ profile averages the ${ord(overall)} percentile across ${hawkinPcts.length} Hawkin MLB metrics for ${profile.groupLabel} (${band(overall)}).` });
    }

    // Relative output (jump height, power per kg) is what the strategy matrix runs on; absolute output
    // (momentum, propulsive impulse) scales with body mass, so it's read separately — a heavy athlete
    // can be high on one and low on the other, and averaging the two hides exactly that.
    const rel = mean(["jumpHeight", "peakRelPropPower"].map(hp));
    const abs = mean(["jumpMomentum", "propulsiveNetImpulse"].map(hp));
    const strategy = hp("mRSI");
    const braking = hp("brakingNetImpulse");
    let massNoted = false;

    if (rel !== null && strategy !== null) {
      if (rel >= 52.5 && strategy < 47.5) {
        items.push({ tone: "warn", text: `Force-capable but slow: jump height / relative power sit in the ${ord(rel)} percentile while mRSI is in the ${ord(strategy)}. Prioritize speed-strength — ballistic and short-contact jump work, loaded jumps with intent to move fast — and track mRSI.` });
      } else if (rel < 47.5 && strategy >= 52.5 && abs !== null && abs >= 52.5) {
        massNoted = true;
        items.push({ tone: "warn", text: `Quick and produces plenty of total force (momentum / propulsive impulse ${ord(abs)} percentile), but it doesn't convert into height for their size (jump height / relative power ${ord(rel)}). Prioritize relative power — explosive and ballistic work, plus body composition if appropriate — and track jump height and relative peak power.` });
      } else if (rel < 47.5 && strategy >= 52.5) {
        items.push({ tone: "warn", text: `Quick but under-powered: mRSI is ${ord(strategy)} percentile but jump height / relative power only ${ord(rel)}. Build force capacity — heavy lower-body strength work to raise propulsive impulse — and track jump height and propulsive net impulse.` });
      } else if (rel < 47.5 && strategy < 47.5) {
        items.push({ tone: "warn", text: `Below the positional standard in both relative output (${ord(rel)}) and speed (${ord(strategy)}). Build foundational strength first, then layer in power and reactive work.` });
      } else if (rel >= 52.5 && strategy >= 52.5) {
        items.push({ tone: "good", text: `Well-rounded: both relative output (${ord(rel)}) and speed of movement (${ord(strategy)}) are above the positional median. Focus on maintaining this and on readiness monitoring against the baseline.` });
      } else {
        items.push({ tone: "info", text: `Balanced around the positional median — relative output ${ord(rel)}, strategy ${ord(strategy)} percentile.` });
      }
    }

    if (braking !== null && hp("propulsiveNetImpulse") !== null && braking <= 40 && hp("propulsiveNetImpulse") - braking >= 20) {
      items.push({ tone: "warn", text: `Braking is the limiter (braking net impulse ${ord(braking)} vs propulsive ${ord(hp("propulsiveNetImpulse"))} percentile). Emphasize eccentric strength and deceleration — tempo and eccentric squats — so the athlete can load faster and deeper.` });
    }

    const jh = hp("jumpHeight"), mom = hp("jumpMomentum");
    if (jh !== null && mom !== null) {
      if (mom - jh >= 25 && massNoted) { /* already covered above */ }
      else if (mom - jh >= 25) items.push({ tone: "info", text: `Jump momentum (${ord(mom)}) outranks jump height (${ord(jh)}): output is mass-driven. That still transfers to swing and throwing force; improving relative power would lift jump height.` });
      else if (jh - mom >= 25) items.push({ tone: "info", text: `Jump height (${ord(jh)}) outranks jump momentum (${ord(mom)}): light for the position. Adding lean mass while holding jump height would raise momentum.` });
    }

    if (isPitcher) {
      const low = ["propulsiveNetImpulse", "peakRelPropPower"].filter((k) => hp(k) !== null && hp(k) < 47.5).map((k) => by[k].label.toLowerCase());
      items.push({ tone: low.length ? "warn" : "info", text: `Pitchers: in Division I pitchers, CMJ propulsive impulse and peak power correlated with fastball velocity (r = 0.71 and 0.68). ${low.length ? `${first}'s ${low.join(" and ")} ${low.length > 1 ? "are" : "is"} below the pitcher median — a velocity-development priority.` : "Both are at or above the pitcher median."}` });
    }

    const days = Math.round((Date.now() - dayMs(profile.lastDate)) / 864e5);
    if (days > 35) items.push({ tone: "warn", text: `Last hands-on-hips CMJ was ${days} days ago. The guide recommends monthly retesting to track adaptation.` });

    return items;
  }

  window.CmjNorms = { HAWKIN_GROUPS, METRICS, buildProfile, offseasonTrend, recommendations, band, defaultGroupFor, PROFILE_WINDOW_DAYS };
})();
