// Manual body comp sheet — the "Body Comp Template" spreadsheet (anthropometric measurements, daily energy
// expenditure, caloric and macronutrient assignments) as a form on an athlete's Body Composition tab, beside the
// Evolt360 scans. A coach types the measurements and every figure the spreadsheet worked out is worked out here
// the same way, as they type. Each sheet is saved by date, so an athlete builds up a history of them.
//
// The formulas are the spreadsheet's own, constant for constant (2.2 lb per kg, 3.14 for pi), so a sheet entered
// here gives the same numbers as the same sheet in Google Sheets:
//   body density   Jackson-Pollock 7-site (chest, abdomen, iliac, subscapular, tricep, axillary, thigh), by sex
//   percent fat    Brozek: (4.57 / density - 4.142) x 100
//   muscle mass    Matiegka-style: (sum of the four corrected girths / 8) squared x height x 6.5 / 1000, where a
//                  corrected girth is girth / pi minus the skinfold there (in cm)
//   resting rate   17.5 x lean kg + 651 under 18, 15.3 x lean kg + 679 from 18 to 29, 11.6 x lean kg + 879 from 30
//   activity       minutes x body kg x a factor (0.075 for training; by sport for the sport)
// Saved in the assessments table with kind "bodycomp" (see store.getBodyCompSheets).
(function () {
  const { useState, useRef, useEffect } = React;

  const SPORT_FACTORS = { TENNIS: 0.1, HOCKEY: 0.105, FOOTBALL: 0.105, BASKETBALL: 0.105, SOCCER: 0.11, BASEBALL: 0.075, GOLF: 0.05 };
  const SITES = [["chest", "Chest"], ["abdomen", "Abdomen"], ["iliac", "Iliac"], ["subscap", "Subscap"], ["tricep", "Tricep"], ["axillary", "Axillary"], ["thigh", "Thigh"]];
  const GIRTHS = [["gUpperArm", "Upper arm"], ["gForearm", "Max forearm"], ["gThigh", "Mid thigh"], ["gCalf", "Max calf"]];
  const MEALS = ["Breakfast", "Lunch", "Dinner", "Snack 1", "Snack 2", "Post-Workout"];
  const OVERRIDES = ["oRmr", "oTrainCal", "oNonCal", "oTCarb", "oTPro", "oTFat", "oNCarb", "oNPro", "oNFat", "calAdjust", "goalLeanLb"];
  const blank = () => ({
    date: new Date().toISOString().slice(0, 10), tester: "", sport: "BASEBALL",
    weightLb: "", heightCm: "", age: "", sex: "M",
    chest: "", abdomen: "", iliac: "", subscap: "", tricep: "", axillary: "", thigh: "",
    gUpperArm: "", gForearm: "", gThigh: "", gCalf: "",
    sTriceps: "", sBiceps: "", sForearm1: "", sForearm2: "", sThigh: "", sCalf: "",
    goalLeanLb: "", goalMuscleLb: "", goalFatPct: "", auto: true, calAdjust: "",
    oRmr: "", oTrainCal: "", oNonCal: "", oTCarb: "", oTPro: "", oTFat: "", oNCarb: "", oNPro: "", oNFat: "", // figures typed over the automatic ones
    trainMin: "60", sportMin: "30", proteinGkg: "2.2", carbGkg: "3.4",
    meals: MEALS.map(() => ({ qty: "1", cho: "", pro: "", fat: "" })),
    tCarb: "0.5", tPro: "0.3", tFat: "0.2", nCarb: "0.45", nPro: "0.35", nFat: "0.2",
    wakeUp: "", lunchTime: "", bedTime: "", medication: "", allergies: "", goal: "",
  });

  const n = (v) => { const x = parseFloat(v); return Number.isFinite(x) ? x : 0; };
  const has = (v) => String(v == null ? "" : v).trim() !== "";

  // AUTO: how the daily targets and the meal plan are worked out when "work it out automatically" is on.
  // (The spreadsheet left this to the coach: the meals were typed in and the targets taken from their total.)
  //   calories  estimated energy expenditure, plus 10% when the goal weight is above today's (a small surplus
  //             favors lean gain over fat gain) and minus 15% when it is below (roughly half a kilo a week,
  //             the slower rate that best keeps lean mass). The coach can type a different percentage.
  //   protein   the sheet's g/kg figure times body mass (1.6 to 2.2 g/kg covers what training can use)
  //   fat       a share of calories (20% on the sheet; 20 to 35% is the usual range for athletes)
  //   carbs     the calories left over, so they rise and fall with the day's training
  //   rest day  the same sums without the training and sport calories: same protein and fat share, fewer carbs
  //   meals     protein spread evenly across the day with a full serving after training (about 0.4 g/kg a
  //             meal, four or more times a day); carbohydrate weighted to breakfast, lunch and the post-workout
  //             shake to refill glycogen; fat kept low in the shake so it is absorbed quickly.
  //             Order: Breakfast, Lunch, Dinner, Snack 1, Snack 2, Post-Workout. Each column adds up to 1.
  const AUTO = {
    gainPct: 10, lossPct: -15, fatShare: 0.2,
    split: [
      { cho: 0.22, pro: 0.21, fat: 0.25 }, { cho: 0.22, pro: 0.21, fat: 0.25 }, { cho: 0.20, pro: 0.21, fat: 0.25 },
      { cho: 0.08, pro: 0.10, fat: 0.10 }, { cho: 0.08, pro: 0.10, fat: 0.10 }, { cho: 0.20, pro: 0.17, fat: 0.05 },
    ],
  };
  // on for new sheets; a sheet saved before this existed counts as typed by hand if any meal has figures
  const isAuto = (f) => (f.auto === true || f.auto === false ? f.auto : !(f.meals || []).some((m) => has(m.cho) || has(m.pro) || has(m.fat)));

  // every figure on the sheet, from what has been typed (cell references are the spreadsheet's)
  function calc(f) {
    const weight = n(f.weightLb), height = n(f.heightCm), age = n(f.age);
    const massKg = weight / 2.2; // C14
    const male = /^m/i.test(f.sex || "M");
    const sum7 = SITES.reduce((s, [k]) => s + n(f[k]), 0); // C24
    const maleDensity = 1.112 - sum7 * 0.00043499 + 0.00000055 * sum7 * sum7 - 0.00028826 * age; // B49
    const femaleDensity = 1.097 - 0.00046971 * sum7 + 0.00000056 * sum7 * sum7 - 0.00012828 * age; // B50
    const density = male ? maleDensity : femaleDensity; // B47
    const pctFat = (4.57 / density - 4.142) * 100; // G22

    // skinfolds for the muscle equation, mm to cm. Triceps and mid thigh are the same sites as in the body fat
    // equation, so they follow those unless typed here (as the filled-in sheets do with =C21 and =C23).
    const cm = (v) => n(v) / 10;
    const triceps = cm(has(f.sTriceps) ? f.sTriceps : f.tricep), thighSf = cm(has(f.sThigh) ? f.sThigh : f.thigh);
    const CDU = n(f.gUpperArm) / 3.14 - (triceps + cm(f.sBiceps)) / 2; // C43
    const CDF = n(f.gForearm) / 3.14 - (cm(f.sForearm1) + cm(f.sForearm2)) / 2; // C44
    const CDT = n(f.gThigh) / 3.14 - thighSf; // C45
    const CDC = n(f.gCalf) / 3.14 - cm(f.sCalf); // C46
    const girthsIn = GIRTHS.every(([k]) => has(f[k]));
    const muscleKg = Math.pow((CDU + CDF + CDT + CDC) / 8, 2) * height * 6.5 * 0.001; // G21

    const fatLb = (pctFat / 100) * weight, leanLb = weight - fatLb; // G16, G18
    const cur = {
      weight, massKg, fatLb, fatKg: fatLb / 2.2, leanLb, leanKg: leanLb / 2.2,
      muscleLb: muscleKg * 2.2, muscleKg, pctFat, pctMuscle: massKg ? (muscleKg / massKg) * 100 : null,
    };

    // Goal: the coach sets percent body fat and muscle weight, and the goal body weight follows. The goal lean
    // weight is today's lean weight plus the muscle to be gained (everything lean that is not muscle, such as
    // bone and organs, is taken to stay as it is); a goal lean weight typed in is used instead when given, as
    // on the spreadsheet. Goal body weight = goal lean weight / (1 - goal percent fat).
    const muscleKnown = girthsIn && has(f.heightCm);
    const gMuscle = n(f.goalMuscleLb), gFatPct = n(f.goalFatPct);
    const leanFromMuscle = has(f.goalMuscleLb) && muscleKnown ? leanLb + (gMuscle - muscleKg * 2.2) : null;
    const gLean = has(f.goalLeanLb) ? n(f.goalLeanLb) : leanFromMuscle != null ? leanFromMuscle : 0;
    const goalSet = has(f.goalFatPct) && (has(f.goalLeanLb) || leanFromMuscle != null);
    const gWeight = gLean / ((100 - gFatPct) / 100); // G29
    const goal = {
      weight: gWeight, massKg: gWeight / 2.2, fatLb: gWeight - gLean, fatKg: (gWeight - gLean) / 2.2, leanLb: gLean, leanKg: gLean / 2.2,
      muscleLb: gMuscle, muscleKg: gMuscle / 2.2, pctFat: gFatPct, pctMuscle: gWeight ? ((gMuscle / 2.2) / (gWeight / 2.2)) * 100 : null,
    };
    const change = {
      weight: goal.weight - cur.weight, leanLb: goal.leanLb - cur.leanLb, muscleLb: goal.muscleLb - cur.muscleLb, fatLb: goal.fatLb - cur.fatLb,
      pctFat: goal.pctFat - cur.pctFat, pctMuscle: goal.pctMuscle != null && cur.pctMuscle != null ? goal.pctMuscle - cur.pctMuscle : null,
    };

    // meals, then the energy figures that depend on them
    const meals = (f.meals || []).map((m) => ({ cal: (n(m.cho) * 4 + n(m.pro) * 4 + n(m.fat) * 9) * n(m.qty) })); // Q38
    const tot = (k) => (f.meals || []).reduce((s, m) => s + n(m[k]), 0); // M44: grams as typed, not times QTY (as on the sheet)
    const trainCal = meals.reduce((s, m) => s + m.cal, 0); // Q44 = Q34
    const nonTrainCal = trainCal - (meals[5] ? meals[5].cal : 0); // Q32
    const factor = SPORT_FACTORS[String(f.sport || "").trim().toUpperCase()];
    const dstEE = n(f.trainMin) * massKg * 0.075; // Q16
    const sportEE = factor ? massKg * n(f.sportMin) * factor : 0; // Q17
    const dit = trainCal * 0.1; // Q20
    // Resting metabolic rate: the FAO/WHO equations for body weight, by sex and age band. (The spreadsheet put
    // lean mass into the male versions of these for everyone, which read low; this is the corrected form.)
    // A figure typed in by the coach is used instead.
    const rmrAuto = male
      ? (age < 18 ? 17.5 * massKg + 651 : age < 30 ? 15.3 * massKg + 679 : age < 60 ? 11.6 * massKg + 879 : 13.5 * massKg + 487)
      : (age < 18 ? 12.2 * massKg + 746 : age < 30 ? 14.7 * massKg + 496 : age < 60 ? 8.7 * massKg + 829 : 10.5 * massKg + 596);
    const rmr = has(f.oRmr) ? n(f.oRmr) : rmrAuto;
    const split = (cal, c, p, fat) => ({ carbs: (cal * n(c)) / 4, protein: (cal * n(p)) / 4, fat: (cal * n(fat)) / 9, total: n(c) + n(p) + n(fat) });

    // ---- automatic targets and meal plan (see AUTO above). Every figure worked out here can be typed over:
    // the "o…" fields hold what the coach typed, and are used in place of the automatic figure when filled.
    if (isAuto(f)) {
      // calories: expenditure, moved up for a goal of gaining weight and down for one of losing it
      const direction = goalSet ? (goal.weight - weight > 1 ? 1 : goal.weight - weight < -1 ? -1 : 0) : 0;
      const autoAdjust = direction > 0 ? AUTO.gainPct : direction < 0 ? AUTO.lossPct : 0;
      const adjust = has(f.calAdjust) ? n(f.calAdjust) : autoAdjust;
      const k = 1 + adjust / 100;
      // thermogenesis is a tenth of what is eaten, and what is eaten is k times expenditure, so expenditure is
      // (resting + activity) / (1 - 0.1k)
      const autoTrain = (k * (rmr + dstEE + sportEE)) / (1 - 0.1 * k), autoRest = (k * rmr) / (1 - 0.1 * k);
      const calTrain = has(f.oTrainCal) ? n(f.oTrainCal) : autoTrain, calRest = has(f.oNonCal) ? n(f.oNonCal) : autoRest;
      const ditTrain = 0.1 * calTrain;
      const proteinG = n(f.proteinGkg) * massKg;
      const fatShare = has(f.tFat) ? n(f.tFat) : AUTO.fatShare;
      const macros = (cal, p) => {
        const auto = { protein: proteinG, fat: (cal * fatShare) / 9 };
        const protein = has(f[`o${p}Pro`]) ? n(f[`o${p}Pro`]) : auto.protein;
        const fat = has(f[`o${p}Fat`]) ? n(f[`o${p}Fat`]) : auto.fat;
        auto.carbs = Math.max(0, (cal - protein * 4 - fat * 9) / 4); // carbohydrate takes up whatever the other two leave
        const carbs = has(f[`o${p}Carb`]) ? n(f[`o${p}Carb`]) : auto.carbs;
        const kcal = carbs * 4 + protein * 4 + fat * 9;
        return { carbs, protein, fat, auto, kcal, total: 1, shares: kcal ? { carbs: (carbs * 4) / kcal, protein: (protein * 4) / kcal, fat: (fat * 9) / kcal } : { carbs: 0, protein: 0, fat: 0 } };
      };
      const trainMacros = macros(calTrain, "T"), nonMacros = macros(calRest, "N");
      // the meal plan: the automatic spread, with any cell the coach typed used instead
      const autoPlan = AUTO.split.map((s) => ({ qty: "1", cho: String(Math.round(trainMacros.carbs * s.cho)), pro: String(Math.round(trainMacros.protein * s.pro)), fat: String(Math.round(trainMacros.fat * s.fat)) }));
      const typed = f.meals || [];
      const plan = autoPlan.map((m, i) => { const t = typed[i] || {}; return { qty: has(t.qty) ? t.qty : "1", cho: has(t.cho) ? t.cho : m.cho, pro: has(t.pro) ? t.pro : m.pro, fat: has(t.fat) ? t.fat : m.fat }; });
      const planCal = plan.map((m) => ({ cal: (n(m.cho) * 4 + n(m.pro) * 4 + n(m.fat) * 9) * n(m.qty) }));
      const sum = (k2) => plan.reduce((s, m) => s + n(m[k2]), 0);
      const planTotal = planCal.reduce((s, m) => s + m.cal, 0);
      return {
        auto: true, adjust, autoAdjust, direction, mealPlan: plan, autoPlan, autoTrain, autoRest, rmrAuto,
        sum7, maleDensity, femaleDensity, density, male, CDU, CDF, CDT, CDC, girthsIn, cur, goal, goalSet, change, leanFromMuscle,
        meals: planCal, totals: { cho: sum("cho"), pro: sum("pro"), fat: sum("fat"), cal: planTotal },
        trainCal: calTrain, nonTrainCal: calRest, calPerLbTrain: weight ? calTrain / weight : null, calPerLbNon: weight ? calRest / weight : null,
        dstEE, sportEE, sportKnown: !!factor, activityEE: dstEE + sportEE, dit: ditTrain, rmr, tee: rmr + dstEE + sportEE + ditTrain,
        proteinGlb: n(f.proteinGkg) / 2.2, carbGlb: massKg ? trainMacros.carbs / massKg / 2.2 : 0, carbGkg: massKg ? trainMacros.carbs / massKg : 0, proteinG,
        trainMacros, nonMacros,
      };
    }
    return {
      leanFromMuscle, rmrAuto,
      sum7, maleDensity, femaleDensity, density, male, CDU, CDF, CDT, CDC, girthsIn, cur, goal, goalSet, change,
      meals, totals: { cho: tot("cho"), pro: tot("pro"), fat: tot("fat"), cal: trainCal },
      trainCal, nonTrainCal, calPerLbTrain: weight ? trainCal / weight : null, calPerLbNon: weight ? nonTrainCal / weight : null,
      dstEE, sportEE, sportKnown: !!factor, activityEE: dstEE + sportEE, dit, rmr, tee: dstEE + sportEE + rmr + dit,
      proteinGlb: n(f.proteinGkg) / 2.2, carbGlb: n(f.carbGkg) / 2.2,
      trainMacros: split(trainCal, f.tCarb, f.tPro, f.tFat), nonMacros: split(nonTrainCal, f.nCarb, f.nPro, f.nFat),
    };
  }

  const show = (v, digits = 1) => (v == null || !Number.isFinite(v) ? "—" : (Math.round(v * Math.pow(10, digits)) / Math.pow(10, digits)).toLocaleString(undefined, { maximumFractionDigits: digits }));
  const signed = (v, digits = 1) => (v == null || !Number.isFinite(v) ? "—" : `${v > 0 ? "+" : ""}${show(v, digits)}`);

  // ---- the form ---------------------------------------------------------------------------------------
  function SheetForm({ athlete, initial, onSaved, onCancel }) {
    const store = window.AthleteStore;
    // An unfinished new sheet (not enough in it to save yet) is kept as a draft in this browser and brought back the
    // next time a new sheet is opened for this athlete, so leaving the page doesn't lose it.
    const draftKey = `bodyCompDraft:${athlete.id}`;
    const restored = useRef(false);
    const [f, setF] = useState(() => {
      if (!initial) {
        try {
          const d = JSON.parse(localStorage.getItem(draftKey) || "null");
          if (d && typeof d === "object") { restored.current = true; return { ...blank(), ...d }; }
        } catch (e) { /* no draft */ }
      }
      return { ...blank(), ...(initial ? initial.inputs : {}) };
    });
    const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
    const setMeal = (i, k, v) => setF((p) => ({ ...p, meals: p.meals.map((m, j) => (j === i ? { ...m, [k]: v } : m)) }));
    const r = calc(f);
    const ready = has(f.weightLb) && SITES.every(([k]) => has(f[k]));
    // the automatic targets need the body composition and the age (for the resting rate) before they mean anything
    const autoReady = ready && has(f.age);
    const mealsReady = !r.auto || autoReady;
    const overridden = OVERRIDES.some((k) => has(f[k])) || f.meals.some((m) => has(m.cho) || has(m.pro) || has(m.fat) || (has(m.qty) && m.qty !== "1"));
    // Enter moves to the next box down the sheet, like a spreadsheet, instead of doing nothing
    const nextOnEnter = (e) => {
      if (e.key !== "Enter" || e.target.tagName === "TEXTAREA" || e.target.tagName === "BUTTON" || e.target.type === "checkbox") return;
      e.preventDefault();
      const boxes = [...e.currentTarget.querySelectorAll("input:not([type=checkbox]):not([disabled]), select")];
      const next = boxes[boxes.indexOf(e.target) + (e.shiftKey ? -1 : 1)];
      if (next) { next.focus(); if (next.select) next.select(); }
    };
    const num = (k, extra = {}) => <input type="number" step="any" inputMode="decimal" value={f[k]} onChange={(e) => set(k, e.target.value)} {...extra} />;
    const text = (k, placeholder) => <input value={f[k]} placeholder={placeholder || ""} onChange={(e) => set(k, e.target.value)} />;
    const row = (label, control, unit) => <label className="bcs-row"><span>{label}</span>{control}{unit ? <em>{unit}</em> : null}</label>;
    const out = (label, value, unit) => <div className="bcs-row bcs-out"><span>{label}</span><b>{value}</b>{unit ? <em>{unit}</em> : null}</div>;
    const comp = (c, ok) => (
      <React.Fragment>
        {out("Body weight", ok ? show(c.weight) : "—", "lb")}{out("Body mass", ok ? show(c.massKg) : "—", "kg")}
        {out("Fat weight", ok ? show(c.fatLb) : "—", "lb")}{out("Fat mass", ok ? show(c.fatKg) : "—", "kg")}
        {out("Lean weight", ok ? show(c.leanLb) : "—", "lb")}{out("Lean mass", ok ? show(c.leanKg) : "—", "kg")}
        {out("Muscle weight", ok && c.muscleOk ? show(c.muscleLb) : "—", "lb")}{out("Muscle mass", ok && c.muscleOk ? show(c.muscleKg) : "—", "kg")}
        {out("Percent body fat", ok ? show(c.pctFat) : "—", "%")}{out("Percent muscle", ok && c.muscleOk ? show(c.pctMuscle) : "—", "%")}
      </React.Fragment>
    );
    const muscleOk = r.girthsIn && has(f.heightCm);
    // ---- autosave -----------------------------------------------------------------------------------
    // Once the weight, all seven skinfolds and the date are in, the sheet saves itself a moment after each change,
    // and again when it is closed or the page is left. Before that, a new sheet is kept as a draft (above).
    const recordId = useRef(initial ? initial.id : `bcs-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
    const recordOf = (inputs) => {
      const c = calc(inputs);
      const mOk = c.girthsIn && has(inputs.heightCm);
      // a sheet without the weight and all seven skinfolds yet is saved as it is, marked incomplete, with only the
      // figures it has (its weight, say), so it can be opened from any device and finished later
      const complete = has(inputs.weightLb) && SITES.every(([k]) => has(inputs[k]));
      const record = {
        id: recordId.current, athleteId: athlete.id, kind: "bodycomp", date: inputs.date, inputs,
        // the headline figures, kept with the sheet so the list can show them without redoing the sums
        summary: complete
          ? { weightLb: c.cur.weight, pctFat: c.cur.pctFat, leanLb: c.cur.leanLb, fatLb: c.cur.fatLb, muscleLb: mOk ? c.cur.muscleLb : null, sum7: c.sum7, tester: inputs.tester }
          : { weightLb: has(inputs.weightLb) ? n(inputs.weightLb) : null, pctFat: null, leanLb: null, fatLb: null, muscleLb: null, sum7: null, tester: inputs.tester, incomplete: true },
      };
      if (initial && initial._activity) record._activity = initial._activity;
      return record;
    };
    // saved once it has a date and anything measured in it (not just the date, sport and meal defaults)
    const canStore = (inputs) => {
      const b = blank();
      return !!inputs.date && Object.keys(inputs).some((k) => !["date", "sport", "meals", "tester"].includes(k) && typeof inputs[k] !== "object" && has(inputs[k]) && String(inputs[k]) !== String(b[k] == null ? "" : b[k]));
    };
    const fRef = useRef(f);
    fRef.current = f;
    const lastSaved = useRef(JSON.stringify(f));
    const [saveState, setSaveState] = useState(initial ? "saved" : "draft");
    const flush = () => {
      const inputs = fRef.current, json = JSON.stringify(inputs);
      if (json === lastSaved.current) return;
      if (canStore(inputs)) {
        store.saveAssessment(recordOf(inputs));
        window.dispatchEvent(new Event("dst-bodycomp-changed")); // the Body Composition chart redraws
        try { localStorage.removeItem(draftKey); } catch (e) { /* fine */ }
        setSaveState("saved");
      } else if (!initial) {
        try { localStorage.setItem(draftKey, json); } catch (e) { /* not kept */ }
        setSaveState("draft");
      }
      lastSaved.current = json;
    };
    const flushRef = useRef(flush);
    flushRef.current = flush;
    useEffect(() => {
      if (JSON.stringify(f) === lastSaved.current) return undefined;
      setSaveState("pending");
      const t = setTimeout(() => flushRef.current(), 800);
      return () => clearTimeout(t);
    }, [f]); // eslint-disable-line
    useEffect(() => {
      const leave = () => flushRef.current();
      window.addEventListener("beforeunload", leave);
      window.addEventListener("pagehide", leave);
      return () => { window.removeEventListener("beforeunload", leave); window.removeEventListener("pagehide", leave); flushRef.current(); };
    }, []); // eslint-disable-line
    const discardDraft = () => {
      if (!window.confirm("Throw away this unfinished sheet?")) return;
      lastSaved.current = JSON.stringify(fRef.current); // nothing left to save on the way out
      try { localStorage.removeItem(draftKey); } catch (e) { /* fine */ }
      onCancel();
    };
    const save = () => { flush(); onSaved(); };
    return (
      <div className="bcs-form" onKeyDown={nextOnEnter}>
        <div className="bcs-top">
          {row("Date", <input type="date" value={f.date} onChange={(e) => set("date", e.target.value)} />)}
          {row("Tester", text("tester"))}
          {row("Sport", <select value={String(f.sport).toUpperCase()} onChange={(e) => set("sport", e.target.value)}>{Object.keys(SPORT_FACTORS).map((s) => <option key={s} value={s}>{s[0] + s.slice(1).toLowerCase()}</option>)}<option value="OTHER">Other</option></select>)}
        </div>

        <div className="bcs-grid">
          <section>
            <h3>Body fat equation</h3>
            {row("Weight", num("weightLb"), "lb")}
            {row("Height", num("heightCm"), "cm")}
            {row("Height in inches", <input type="number" step="any" inputMode="decimal" value={has(f.heightCm) ? Math.round((n(f.heightCm) / 2.54) * 100) / 100 : ""} onChange={(e) => set("heightCm", has(e.target.value) ? String(Math.round(n(e.target.value) * 2.54 * 100) / 100) : "")} />, "in")}
            {out("Mass", has(f.weightLb) ? show(r.cur.massKg) : "—", "kg")}
            {row("Age", num("age"))}
            {row("Sex", <select value={/^m/i.test(f.sex) ? "M" : "F"} onChange={(e) => set("sex", e.target.value)}><option value="M">M</option><option value="F">F</option></select>)}
            <h4>Skinfolds (mm)</h4>
            {SITES.map(([k, label]) => <React.Fragment key={k}>{row(label, num(k), "mm")}</React.Fragment>)}
            {out("Sum", show(r.sum7), "mm")}
            {out("Body density", ready ? show(r.density, 5) : "—", r.male ? "male" : "female")}
          </section>

          <section>
            <h3>Current body composition</h3>
            {comp({ ...r.cur, muscleOk }, ready)}
            <h3>Goal body composition</h3>
            {row("Goal percent body fat", num("goalFatPct"), "%")}
            {row("Goal muscle weight", num("goalMuscleLb"), "lb")}
            {row("Goal lean weight", num("goalLeanLb", { placeholder: r.leanFromMuscle != null ? String(Math.round(r.leanFromMuscle * 10) / 10) : "" }), "lb")}
            <p className="bcs-hint">Goal lean weight is worked out from the muscle to be gained (today's lean weight plus the added muscle). Type a figure only to override it. Without girths there is no muscle figure, so enter the goal lean weight yourself.</p>
            {out("Goal body weight", r.goalSet ? show(r.goal.weight) : "—", "lb")}
            {out("Goal fat weight", r.goalSet ? show(r.goal.fatLb) : "—", "lb")}
            {out("Goal percent muscle", r.goalSet && has(f.goalMuscleLb) ? show(r.goal.pctMuscle) : "—", "%")}
            <h3>Change to reach the goal</h3>
            {out("Change in weight", ready && r.goalSet ? signed(r.change.weight) : "—", "lb")}
            {out("Change in lean weight", ready && r.goalSet ? signed(r.change.leanLb) : "—", "lb")}
            {out("Change in muscle weight", ready && muscleOk && has(f.goalMuscleLb) ? signed(r.change.muscleLb) : "—", "lb")}
            {out("Change in fat weight", ready && r.goalSet ? signed(r.change.fatLb) : "—", "lb")}
            {out("Change in % fat", ready && r.goalSet ? signed(r.change.pctFat) : "—", "%")}
            {out("Change in % muscle", ready && muscleOk && r.goalSet && has(f.goalMuscleLb) ? signed(r.change.pctMuscle) : "—", "%")}
          </section>

          <section>
            <h3>Muscle mass equation</h3>
            <h4>Girths (cm)</h4>
            {GIRTHS.map(([k, label]) => <React.Fragment key={k}>{row(label, num(k), "cm")}</React.Fragment>)}
            <h4>Skinfolds (mm)</h4>
            {row("Triceps", num("sTriceps", { placeholder: has(f.tricep) ? f.tricep : "" }), "mm")}
            {row("Biceps", num("sBiceps"), "mm")}
            {row("Forearm 1", num("sForearm1"), "mm")}
            {row("Forearm 2", num("sForearm2"), "mm")}
            {row("Mid thigh", num("sThigh", { placeholder: has(f.thigh) ? f.thigh : "" }), "mm")}
            {row("Mid calf", num("sCalf"), "mm")}
            <p className="bcs-hint">Triceps and mid thigh use the body fat skinfolds unless you type a different reading here.</p>
            <h4>Corrected girths</h4>
            {out("CDU (upper arm)", muscleOk ? show(r.CDU, 2) : "—", "cm")}
            {out("CDF (forearm)", muscleOk ? show(r.CDF, 2) : "—", "cm")}
            {out("CDT (thigh)", muscleOk ? show(r.CDT, 2) : "—", "cm")}
            {out("CDC (calf)", muscleOk ? show(r.CDC, 2) : "—", "cm")}
          </section>

          <section>
            <h3>Energy expenditure</h3>
            {row("Average training time", num("trainMin"), "min")}
            {row("Average sport time", num("sportMin"), "min")}
            {out("DST energy expenditure", ready ? show(r.dstEE, 0) : "—", "cal")}
            {out("Sport energy expenditure", ready ? (r.sportKnown ? show(r.sportEE, 0) : "0 (sport not listed)") : "—", "cal")}
            {out("Total physical activity", ready ? show(r.activityEE, 0) : "—", "cal")}
            {out("Dietary induced thermogenesis", r.auto && !(ready && has(f.age)) ? "—" : show(r.dit, 0), "cal")}
            {row("Estimated resting metabolic rate", num("oRmr", { placeholder: ready && has(f.age) ? String(Math.round(r.rmrAuto)) : "" }), "cal")}
            {out("Total estimated energy expenditure", ready && has(f.age) ? show(r.tee, 0) : "—", "cal")}
            <h4>Recommendations</h4>
            {row("Protein intake", num("proteinGkg"), "g/kg")}
            {out("Protein intake", show(r.proteinGlb, 2), "g/lb")}
            {r.auto ? (
              <React.Fragment>
                {out("Protein each day", autoReady ? show(r.proteinG, 0) : "—", "g")}
                {row("Fat, share of calories", num("tFat"), "0.20 to 0.35")}
                {out("Carbohydrate (what is left)", autoReady ? show(r.carbGkg, 1) : "—", "g/kg")}
                {row("Calories against expenditure", num("calAdjust", { placeholder: String(r.autoAdjust) }), "%")}
                <p className="bcs-hint">{r.direction > 0 ? "The goal weight is above today's, so intake is set 10% over expenditure." : r.direction < 0 ? "The goal weight is below today's, so intake is set 15% under expenditure." : "With no weight change in the goal, intake matches expenditure."} Type a percentage to change it (for example 5, or -20).</p>
              </React.Fragment>
            ) : (
              <React.Fragment>
                {row("Carbohydrate intake", num("carbGkg"), "g/kg")}
                {out("Carbohydrate intake", show(r.carbGlb, 2), "g/lb")}
              </React.Fragment>
            )}
            <h4>Assigned intake</h4>
            {r.auto
              ? row("Training day calories", num("oTrainCal", { placeholder: autoReady ? String(Math.round(r.autoTrain)) : "" }), "cal")
              : out("Training day calories", show(r.trainCal, 0), "cal")}
            {out("Training day", !r.auto || autoReady ? show(r.calPerLbTrain, 1) : "—", "cal/lb")}
            {r.auto
              ? row("Non-training day calories", num("oNonCal", { placeholder: autoReady ? String(Math.round(r.autoRest)) : "" }), "cal")
              : out("Non-training day calories", show(r.nonTrainCal, 0), "cal")}
            {out("Non-training day", !r.auto || autoReady ? show(r.calPerLbNon, 1) : "—", "cal/lb")}
          </section>
        </div>

        <h3>Meal plan</h3>
        <label className="vit-check bcs-auto">
          <input type="checkbox" checked={r.auto} onChange={(e) => setF((p) => (e.target.checked ? { ...p, auto: true } : { ...p, auto: false, meals: r.auto && autoReady ? r.mealPlan : p.meals }))} />
          Work out the calories, macros and meal plan automatically from the energy expenditure and the goal
        </label>
        {r.auto && <p className="bcs-hint">Protein is spread evenly through the day with a full serving after training; carbohydrate is weighted to breakfast, lunch and the post-workout shake; fat is kept low in the shake. Untick the box to type the meals yourself, starting from these figures.</p>}
        {r.auto && (
          <p className="bcs-hint">
            The grey figures in the boxes are worked out for you. Type in any box to use your own figure instead, and clear the box to go back to the automatic one.
            {overridden && <React.Fragment> <button className="btn-link" onClick={() => setF((p) => ({ ...p, ...Object.fromEntries(OVERRIDES.map((k) => [k, ""])), meals: MEALS.map(() => ({ qty: "1", cho: "", pro: "", fat: "" })) }))}>Clear everything I typed over</button></React.Fragment>}
          </p>
        )}
        <div className="bcs-scroll">
          <table className="bcs-meals">
            <thead><tr><th>Meal</th><th>Qty</th><th>Carbs (g)</th><th>Protein (g)</th><th>Fat (g)</th><th>Cal density %</th><th>Cal</th></tr></thead>
            <tbody>
              {MEALS.map((name, i) => (
                <tr key={name}>
                  <td>{name}</td>
                  {["qty", "cho", "pro", "fat"].map((k) => (
                    <td key={k}>
                      {r.auto
                        ? <input type="number" step="any" inputMode="decimal" value={f.meals[i][k] === "1" && k === "qty" ? "" : f.meals[i][k]} placeholder={k === "qty" ? "1" : autoReady ? r.autoPlan[i][k] : ""} onChange={(e) => setMeal(i, k, e.target.value)} aria-label={`${name} ${k}`} />
                        : <input type="number" step="any" inputMode="decimal" value={f.meals[i][k]} onChange={(e) => setMeal(i, k, e.target.value)} aria-label={`${name} ${k}`} />}
                    </td>
                  ))}
                  <td>{mealsReady && r.totals.cal ? show((r.meals[i].cal / r.totals.cal) * 100) : "—"}</td>
                  <td><b>{mealsReady ? show(r.meals[i].cal, 0) : "—"}</b></td>
                </tr>
              ))}
              <tr className="bcs-total"><td>Totals</td><td></td><td>{mealsReady ? show(r.totals.cho) : "—"}</td><td>{mealsReady ? show(r.totals.pro) : "—"}</td><td>{mealsReady ? show(r.totals.fat) : "—"}</td><td>{mealsReady && r.totals.cal ? "100" : "—"}</td><td>{mealsReady ? show(r.totals.cal, 0) : "—"}</td></tr>
              <tr className="bcs-target"><td>Training day target</td><td></td><td>{mealsReady ? show(r.trainMacros.carbs) : "—"}</td><td>{mealsReady ? show(r.trainMacros.protein) : "—"}</td><td>{mealsReady ? show(r.trainMacros.fat) : "—"}</td><td></td><td>{r.auto && autoReady ? show(r.trainCal, 0) : ""}</td></tr>
            </tbody>
          </table>
        </div>

        <div className="bcs-grid bcs-two">
          {[["Training day macros (with shake)", "t", r.trainMacros, r.trainCal], ["Non-training day macros (no shake)", "n", r.nonMacros, r.nonTrainCal]].map(([title, p, m, cal]) => (
            <section key={p}>
              <h3>{title}</h3>
              {r.auto ? (
                <React.Fragment>
                  {row("Carbs", num(`o${p.toUpperCase()}Carb`, { placeholder: autoReady ? String(Math.round(m.auto.carbs)) : "" }), autoReady ? `g · ${show(m.shares.carbs * 100, 0)}%` : "g")}
                  {row("Protein", num(`o${p.toUpperCase()}Pro`, { placeholder: autoReady ? String(Math.round(m.auto.protein)) : "" }), autoReady ? `g · ${show(m.shares.protein * 100, 0)}%` : "g")}
                  {row("Fat", num(`o${p.toUpperCase()}Fat`, { placeholder: autoReady ? String(Math.round(m.auto.fat)) : "" }), autoReady ? `g · ${show(m.shares.fat * 100, 0)}%` : "g")}
                  {out("Calories", autoReady ? show(cal, 0) : "—", "cal")}
                </React.Fragment>
              ) : (
                <React.Fragment>
                  {row("Carbs share", num(`${p}Carb`), `= ${show(m.carbs)} g`)}
                  {row("Protein share", num(`${p}Pro`), `= ${show(m.protein)} g`)}
                  {row("Fat share", num(`${p}Fat`), `= ${show(m.fat)} g`)}
                  {out("Shares add up to", show(m.total, 2), Math.abs(m.total - 1) > 0.001 ? "should be 1.00" : "")}
                  {out("Calories", show(cal, 0), "cal")}
                </React.Fragment>
              )}
            </section>
          ))}
        </div>

        <h3>Notes</h3>
        <div className="bcs-top">
          {row("Wake up", text("wakeUp"))}{row("Lunch time", text("lunchTime"))}{row("Bed time", text("bedTime"))}
          {row("Medication", text("medication"))}{row("Allergies", text("allergies"))}{row("Goal", text("goal"))}
        </div>

        <div className="tl-actions">
          <button className="btn btn-assign" onClick={save}>Done</button>
          {!initial && !canStore(f) && <button className="btn-link" onClick={discardDraft}>Discard</button>}
          <span className="timestamp-note">
            {canStore(f)
              ? (saveState === "pending" ? "Saving…" : "✓ Saved automatically")
              : `${restored.current && !initial ? "Your unfinished sheet was brought back. " : ""}Saves automatically once it has a date and something measured in it. It can be finished later; the body fat figures fill in once the weight and all seven skinfolds are in.`}
          </span>
        </div>
      </div>
    );
  }

  // ---- the section on the Body Composition tab --------------------------------------------------------
  function BodyCompSheet({ athlete }) {
    const store = window.AthleteStore;
    const [editing, setEditing] = useState(null); // null, "new", or a saved sheet
    const [, bump] = useState(0);
    const sheets = [...store.getBodyCompSheets(athlete.id)].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    // a sheet started before partial sheets saved, still held as a draft in this browser: shown so it can be finished
    let draft = null;
    try { draft = JSON.parse(localStorage.getItem(`bodyCompDraft:${athlete.id}`) || "null"); } catch (e) { draft = null; }
    const remove = (s) => {
      if (!window.confirm(`Delete the body comp sheet from ${s.date}?`)) return;
      store.deleteAssessment(s.id);
      window.dispatchEvent(new Event("dst-bodycomp-changed"));
      bump((x) => x + 1);
    };
    return (
      <div className="panel">
        <h2>Manual Body Comp Sheet <small>skinfolds, girths, energy expenditure and meal plan · {sheets.length} on file</small></h2>
        {editing ? (
          <SheetForm key={editing === "new" ? "new" : editing.id} athlete={athlete} initial={editing === "new" ? null : editing} onSaved={() => setEditing(null)} onCancel={() => setEditing(null)} />
        ) : (
          <React.Fragment>
            <button className="btn btn-assign no-print" style={{ marginBottom: 12 }} onClick={() => setEditing("new")}>+ New body comp sheet</button>
            {sheets.length === 0 && !draft ? <div className="empty-state">No manual body comp sheets yet for {athlete.name}.</div> : (
              <table>
                <thead><tr><th>Date</th><th>Weight (lb)</th><th>% body fat</th><th>Lean (lb)</th><th>Fat (lb)</th><th>Muscle (lb)</th><th>Sum of 7 (mm)</th><th>Tester</th><th></th></tr></thead>
                <tbody>
                  {draft && (
                    <tr className="bcs-list-row no-print" title="Click to finish this sheet" onClick={() => setEditing("new")}>
                      <td>{draft.date || "—"} <span className="badge warn">Unsaved sheet on this device</span></td>
                      <td>{has(draft.weightLb) ? draft.weightLb : "—"}</td><td colSpan={5}>Started here and not saved yet. Open it to finish; it saves once it has a date and something measured.</td><td>{draft.tester || ""}</td>
                      <td><button className="btn-link" onClick={(e) => { e.stopPropagation(); setEditing("new"); }}>Open</button></td>
                    </tr>
                  )}
                  {sheets.map((s) => {
                    const m = s.summary || {};
                    return (
                      <tr key={s.id} className="bcs-list-row" title="Click to open and edit this sheet" onClick={() => setEditing(s)}>
                        <td>{s.date}{m.incomplete ? <span className="badge warn" title="Not everything for the body fat figures is in yet"> Incomplete</span> : null}</td><td>{show(m.weightLb)}</td><td>{show(m.pctFat)}</td><td>{show(m.leanLb)}</td><td>{show(m.fatLb)}</td><td>{show(m.muscleLb)}</td><td>{show(m.sum7)}</td><td>{m.tester || ""}</td>
                        <td className="no-print"><button className="btn-link" onClick={(e) => { e.stopPropagation(); setEditing(s); }}>Open</button> <button className="btn-link" onClick={(e) => { e.stopPropagation(); remove(s); }}>Delete</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </React.Fragment>
        )}
      </div>
    );
  }

  window.BodyCompSheet = BodyCompSheet;
  window.BodyCompCalc = calc; // exposed for checking against the spreadsheet
})();
