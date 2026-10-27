// Nutrition plan: the DST nutrition packet (meal rotation, macro lists, breakfast/snack/shake options, grocery list,
// blank rotation, accountability chart, meal prep and hydration) built for an athlete from their body composition and
// a goal. It is the Nutrition tab under Assessments, and can go in the emailed package.
//
// Targets
//   Calories come from the latest body composition. A manual body comp sheet gives its resting rate and activity (or
//   the training-day calories the coach typed over them); without a newer sheet, the latest Evolt scan is used: the
//   sheet's resting-rate equations from weight, age and sex, plus 2 hours of training and 30 minutes of sport at the
//   sheet's 0.075 kcal per kg per minute. The goal moves them as the sheet does: +10% to gain lean muscle, -15% to lose
//   body fat, none for recomp. Thermogenesis is a tenth of what is eaten, so a day's calories are
//   k x (resting + activity) / (1 - 0.1k).
//   Protein, fat and carbohydrate follow Andy Galpin's periodized nutrition ranges (after Louise Burke), in grams per
//   kilogram of body weight, with his own adjustments for a long baseball season (protein at 2.2 or more, never cut):
//   protein and fat are set from the goal, and carbohydrate takes the calories left on a training day, flagged when
//   that falls outside the goal's range. A rest day keeps protein and fat and takes carbohydrate from the goal's
//   rest-day range. Fat loss works protein off the goal weight when the sheet has one.
// Meals
//   The day is spread over six meals (five on a rest day, without the post-workout shake). Each example meal is a
//   template (protein, starch, vegetable and fruit for lunch and dinner, as on the DST meal rotation) whose portions
//   are solved to that meal's targets and rounded to kitchen amounts. The examples are picked at random from the food
//   lists (Shuffle picks again); the macro lists and the blank rotation are for the athlete to build their own meals.
// Food values are USDA figures (cooked weights for meat, fish, rice and pasta; oats dry).
// Saved in the assessments table with kind "nutrition", one per athlete: the goal and the shuffle.
(function () {
  const { useState, useEffect } = React;
  // the plan's sums and food lists (nutrition_engine.js, shared with the phone)
  const { manualBasis, withMinutes, ALLERGIES, ALLERGY_KEYS, BERRIES, BREAKFASTS, CAT_GROUP, DAYS, FOODS, FOOD_TABLE, FRAC, GOALS, GOAL_KEYS, GRAB_AND_GO, GROUPS, MACRO, MAIN_CHOICES, MAIN_FRUIT, MAIN_PROTEINS, MAIN_STARCHES, MAIN_VEG, MORE_BREAKFASTS, MORE_POST, MORE_SNACKS, PACKED_LUNCHES, PACKED_NOTE, PACKING_TIPS, POST, SLOTS, SNACKS, SPLIT, allergensOf, allowed, amountText, buildPlan, buildPlanWith, cycler, firstMade, food, groceryList, hashOf, itemText, kcalOf, macroLists, macroListsWith, mainMeal, mealChoices, mealTimes, missBy, num, part, partsOf, pick, plural, qty, r0, rmrOf, rngOf, round, shuffled, snapshotOf, solve, sortedJson, targetsFor, templated, totalsOf, withAllergies } = window.NutritionEngine;

  const ageOf = (athlete) => (typeof computeAge === "function" ? computeAge(athlete.dob) : null);

  // the body composition the plan is worked from: the latest complete manual sheet or Evolt scan, whichever is newer,
  // or without either, the details entered with the plan
  // Pre-lift weigh-ins logged on the phone's Program page (store.bodyweightLog) after the body composition move the
  // plan with them: the average of the weigh-ins in the week up to the latest one stands in for the scan's weight,
  // at the same body fat, so calories, protein and fat follow the athlete's weight between scans. `bw` on the basis
  // says so: { lb, n, first, last, fromLb }.
  const BW_DAYS = 7;
  function bodyweightSince(athleteId, since) {
    const S = window.AthleteStore;
    const log = (S && S.bodyweightLog ? S.bodyweightLog(athleteId) : []).filter((w) => !since || w.date >= since);
    if (!log.length) return null;
    const last = log[log.length - 1].date, from = new Date(`${last}T12:00:00`);
    from.setDate(from.getDate() - (BW_DAYS - 1));
    const start = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, "0")}-${String(from.getDate()).padStart(2, "0")}`;
    const week = log.filter((w) => w.date >= start);
    return { lb: Math.round((week.reduce((t, w) => t + w.lb, 0) / week.length) * 10) / 10, n: week.length, first: week[0].date, last };
  }
  // training and sport minutes set in the app (rec.minutes) take the place of the basis's own
  function basisFor(athlete, rec) {
    return withMinutes(weighedBasis(athlete, rec), rec && rec.minutes);
  }
  function weighedBasis(athlete, rec) {
    const b = scanBasis(athlete, rec, null);
    const bw = b ? bodyweightSince(athlete.id, b.date) : null;
    if (!bw) return b;
    const moved = scanBasis(athlete, rec, bw.lb);
    return moved ? Object.assign(moved, { bw: Object.assign({ fromLb: b.weightLb }, bw) }) : b;
  }
  function scanBasis(athlete, rec, lbNow) {
    const store = window.AthleteStore;
    const sheets = (store.getBodyCompSheets(athlete.id) || []).filter((s) => s.inputs && s.summary && !s.summary.incomplete);
    const sheet = sheets[sheets.length - 1];
    const scans = (store.getBodyComp(athlete.id) || []).filter((s) => s.date && (s.weightLb != null || s.weightKg != null)).sort((a, b) => a.date.localeCompare(b.date));
    const scan = scans[scans.length - 1];
    // details entered by hand (here, or by a coach in the app) on or after the latest body composition take over from
    // it: an old scan doesn't hold back a weight and goal set since
    const m = rec && rec.manual;
    const bcDate = [sheet && sheet.date, scan && scan.date].filter(Boolean).sort().pop() || "";
    if (m && num(m.weightLb) && (!bcDate || String(m.date || "") >= bcDate)) return manualBasis(m, ageOf(athlete), athlete.gender, lbNow);
    if (sheet && window.BodyCompCalc && (!scan || sheet.date >= scan.date)) {
      const inputs = Object.assign({}, sheet.inputs);
      if (!num(inputs.age)) inputs.age = String(ageOf(athlete) || 25);
      if (lbNow) inputs.weightLb = String(lbNow); // the same skinfolds (body fat), at the weight weighed in
      const c = window.BodyCompCalc(inputs);
      return {
        source: "sheet", date: sheet.date, weightLb: c.cur.weight, kg: c.cur.massKg, pctFat: c.cur.pctFat, age: num(inputs.age), male: c.male,
        rmr: c.rmr, activity: c.dstEE + c.sportEE, trainMin: num(inputs.trainMin) || 0, sportMin: num(inputs.sportMin) || 0,
        typedCal: num(inputs.oTrainCal), goalKg: c.goalSet ? c.goal.massKg : null,
        wakeUp: inputs.wakeUp, lunchTime: inputs.lunchTime,
      };
    }
    if (scan) {
      const lb = lbNow || (scan.weightLb != null ? scan.weightLb : scan.weightKg * 2.20462);
      const kg = lb / 2.2, age = num(scan.age) || ageOf(athlete) || 25;
      const male = !/^f/i.test(String(scan.gender || athlete.gender || "M"));
      return {
        source: "evolt", date: scan.date, weightLb: lb, kg, pctFat: num(scan.bodyFatPct), age, male,
        rmr: rmrOf(kg, age, male), activity: (120 + 30) * kg * 0.075, trainMin: 120, sportMin: 30, typedCal: null, goalKg: null,
      };
    }
    // no body composition on file: the details the coach entered on the Nutrition tab (weight, age, sex, training),
    // worked out the same way as an Evolt scan. A scan or sheet added later takes over.
    if (m && num(m.weightLb)) return manualBasis(m, ageOf(athlete), athlete.gender, lbNow);
    return null;
  }
  const SOURCE_TEXT = { sheet: "body comp sheet", evolt: "Evolt scan" };

  // Without a body composition, the coach enters the basics here and the plan is built from them (saved with the plan)
  function ManualBasisForm({ athlete, rec, basis, onDone }) {
    const m = (rec && rec.manual) || {};
    const [f, setF] = useState(() => ({
      weightLb: (basis && basis.source !== "manual" ? String(Math.round(basis.weightLb * 10) / 10) : m.weightLb) || "", age: m.age || String((basis && basis.age) || ageOf(athlete) || ""), sex: m.sex || (basis ? (basis.male ? "M" : "F") : /^f/i.test(athlete.gender || "") ? "F" : "M"),
      bodyFatPct: m.bodyFatPct || (basis && basis.source !== "manual" && basis.pctFat != null ? String(Math.round(basis.pctFat * 10) / 10) : ""), trainMin: String((rec && rec.minutes && rec.minutes.trainMin != null ? rec.minutes.trainMin : m.trainMin) ?? (basis ? basis.trainMin : "120")), sportMin: String((rec && rec.minutes && rec.minutes.sportMin != null ? rec.minutes.sportMin : m.sportMin) ?? (basis ? basis.sportMin : "30")),
      goal: (rec && rec.goal) || "",
    }));
    const set = (k) => (e) => { const v = e.target.value; setF((p) => Object.assign({}, p, { [k]: v })); };
    const box = (label, k, unit, extra) => (
      <label className="nut-field"><span>{label}</span><input type="number" step="any" inputMode="decimal" value={f[k]} onChange={set(k)} {...(extra || {})} />{unit ? <em>{unit}</em> : null}</label>
    );
    const ok = num(f.weightLb) > 0 && f.goal;
    const save = () => {
      savePlan(athlete, { goal: f.goal, minutes: { trainMin: f.trainMin, sportMin: f.sportMin }, manual: { weightLb: f.weightLb, age: f.age, sex: f.sex, bodyFatPct: f.bodyFatPct, trainMin: f.trainMin, sportMin: f.sportMin, date: new Date().toISOString().slice(0, 10) } });
      if (onDone) onDone();
    };
    return (
      <div className="nut-manual no-print">
        <p className="nut-hint">No body composition on file? Enter the basics and the plan is built from them, the same way as from an Evolt scan. Once a scan or body comp sheet is on file, the plan uses that instead.</p>
        <div className="nut-fields">
          {box("Body weight", "weightLb", "lb", { autoFocus: !m.weightLb })}
          {box("Age", "age", "yrs")}
          <label className="nut-field"><span>Sex</span><select value={f.sex} onChange={set("sex")}><option value="M">Male</option><option value="F">Female</option></select></label>
          {box("Body fat (optional)", "bodyFatPct", "%")}
          {box("Training", "trainMin", "min/day")}
          {box("Sport", "sportMin", "min/day")}
          <label className="nut-field"><span>Goal</span>
            <select value={f.goal} onChange={set("goal")}>
              <option value="">Choose a goal…</option>
              {GOAL_KEYS.map((k) => <option key={k} value={k}>{GOALS[k].label}</option>)}
            </select>
          </label>
        </div>
        <div className="nut-top">
          <button type="button" className="btn btn-assign" disabled={!ok} onClick={save}>{rec && rec.manual ? "Save details" : "Build nutrition plan"}</button>
          {onDone && <button type="button" className="btn btn-secondary" onClick={onDone}>Cancel</button>}
        </div>
      </div>
    );
  }



  // ---- saved plan ------------------------------------------------------------------------------------
  const planOf = (athleteId) => (window.AthleteStore.getNutritionPlan ? window.AthleteStore.getNutritionPlan(athleteId) : null);
  // the athlete's food allergies (their own record, kind "nutrition_prefs": answered on their phone, or set here)
  const prefsOf = (athleteId) => (window.AthleteStore.getNutritionPrefs ? window.AthleteStore.getNutritionPrefs(athleteId) : null);
  const allergiesOf = (athleteId) => { const p = prefsOf(athleteId); return p && Array.isArray(p.allergies) ? p.allergies.filter((a) => ALLERGIES[a]) : []; };
  function saveAllergies(athlete, allergies, other) {
    const prev = prefsOf(athlete.id);
    const record = Object.assign({}, prev || {}, { id: `nutprefs-${athlete.id}`, athleteId: athlete.id, kind: "nutrition_prefs", allergies, other: other || "", asked: true, date: new Date().toISOString().slice(0, 10), source: "coach" });
    window.AthleteStore.saveAssessment(record);
    window.dispatchEvent(new Event("dst-nutrition-changed"));
  }
  // The athlete's allergies on the Nutrition tab, with Edit to change them (the plan is rebuilt without those foods)
  function AllergyLine({ athlete }) {
    const [edit, setEdit] = useState(null); // the allergies being chosen, while editing
    const prefs = prefsOf(athlete.id);
    const list = allergiesOf(athlete.id);
    const other = (prefs && prefs.other) || "";
    const text = list.length ? list.map((a) => ALLERGIES[a].label).join(", ") : prefs && prefs.asked ? "None" : "Not asked yet";
    if (!edit) {
      return (
        <div className="nut-allergies">
          <b>Food allergies:</b> {text}{other ? ` · ${other}` : ""}
          {prefs && prefs.source === "athlete" ? <span className="nut-hint"> (from the athlete’s app)</span> : null}
          {list.length ? <span className="nut-hint"> · the plan leaves those foods out</span> : null}
          <button type="button" className="btn-link no-print" onClick={() => setEdit({ list: list.slice(), other })}>Edit</button>
        </div>
      );
    }
    const toggle = (a) => setEdit((e) => Object.assign({}, e, { list: e.list.includes(a) ? e.list.filter((x) => x !== a) : e.list.concat([a]) }));
    return (
      <div className="nut-allergies no-print">
        <b>Food allergies:</b>
        <div className="nut-allergy-picks">
          {ALLERGY_KEYS.map((a) => (
            <label key={a} className="nut-check-opt"><input type="checkbox" checked={edit.list.includes(a)} onChange={() => toggle(a)} />{ALLERGIES[a].label}</label>
          ))}
          <input className="nut-lib-search" placeholder="Other (noted on the plan)" value={edit.other} onChange={(e) => { const v = e.target.value; setEdit((x) => Object.assign({}, x, { other: v })); }} />
        </div>
        <div className="nut-top">
          <button type="button" className="btn btn-assign" onClick={() => { saveAllergies(athlete, edit.list, edit.other.trim()); setEdit(null); }}>Save allergies</button>
          <button type="button" className="btn btn-secondary" onClick={() => setEdit(null)}>Cancel</button>
        </div>
      </div>
    );
  }
  function savePlan(athlete, patch) {
    const prev = planOf(athlete.id);
    const record = Object.assign({ id: `nutrition-${athlete.id}`, athleteId: athlete.id, kind: "nutrition", seed: Math.floor(Math.random() * 1e9) }, prev || {}, patch, { date: new Date().toISOString().slice(0, 10) });
    if (prev && prev._activity) record._activity = prev._activity;
    window.AthleteStore.saveAssessment(record);
    window.dispatchEvent(new Event("dst-nutrition-changed"));
    return record;
  }
  // redraw when the plan or the body composition changes anywhere on the page
  function useRefresh() {
    const [, bump] = useState(0);
    useEffect(() => {
      const on = () => bump((x) => x + 1);
      window.addEventListener("dst-nutrition-changed", on);
      window.addEventListener("dst-bodycomp-changed", on);
      return () => { window.removeEventListener("dst-nutrition-changed", on); window.removeEventListener("dst-bodycomp-changed", on); };
    }, []);
  }

  // The goal, set here or on the Body Composition tab: choosing one is what builds the plan
  function NutritionGoalPicker({ athlete, onOpen }) {
    useRefresh();
    const rec = planOf(athlete.id);
    const goal = (rec && rec.goal) || "";
    return (
      <div className="nut-goal no-print">
        <label>
          <span>Nutrition goal</span>
          <select value={goal} onChange={(e) => savePlan(athlete, { goal: e.target.value })}>
            <option value="">Choose a goal…</option>
            {GOAL_KEYS.map((k) => <option key={k} value={k}>{GOALS[k].label}</option>)}
          </select>
        </label>
        {onOpen && goal && <button type="button" className="btn btn-secondary" onClick={onOpen}>Open nutrition plan</button>}
        {onOpen && !goal && <span className="nut-hint">Choosing a goal builds this athlete’s nutrition plan from their latest body composition.</span>}
      </div>
    );
  }

  // ---- the tab ---------------------------------------------------------------------------------------
  const g0 = (v) => String(round(v));
  const macroLine = (t) => `${g0(t.kcal != null ? t.kcal : kcalOf(t))} kcal · C ${g0(t.c)} · P ${g0(t.p)} · F ${g0(t.f)}`;
  const shareLine = (t) => { const r = wholeShares(t); return `${r.c}% / ${r.p}% / ${r.f}%`; }; // carbohydrate / protein / fat, adding to 100
  const shortDate = (k) => { const [y, m, d] = (k || "").split("-"); return y ? `${Number(m)}/${Number(d)}/${y.slice(2)}` : ""; };

  // ---- the day's targets, which a coach can change. Calories are always 4 x protein + 4 x carbohydrate + 9 x fat:
  // changing calories scales all three macros (keeping their shares), changing a macro's grams changes the calories,
  // and changing a macro's share keeps the calories and splits what's left between the other two as they were. Grams
  // are kept whole. Saved, they replace the worked-out targets, and every meal, option and list resizes to them.
  const PER_G = { p: 4, c: 4, f: 9 };
  const kcalOfG = (d) => d.p * 4 + d.c * 4 + d.f * 9;
  const wholeG = (d) => ({ p: Math.max(0, Math.round(d.p)), c: Math.max(0, Math.round(d.c)), f: Math.max(0, Math.round(d.f)) });
  const sharesOf = (d) => { const k = kcalOfG(d) || 1; return { p: (d.p * 4 * 100) / k, c: (d.c * 4 * 100) / k, f: (d.f * 9 * 100) / k }; };
  // the shares as whole percents that add to exactly 100 (the leftover from rounding goes to the largest)
  const wholeShares = (d) => { const s = sharesOf(d), r = { p: Math.round(s.p), c: Math.round(s.c), f: Math.round(s.f) }; const off = 100 - r.p - r.c - r.f; if (off && kcalOfG(d)) { const big = ["p", "c", "f"].sort((a, b) => s[b] - s[a])[0]; r[big] += off; } return r; };
  const withKcal = (d, kcal, fallback) => {
    const k = kcalOfG(d);
    if (!k) { const s = sharesOf(fallback); return wholeG({ p: (kcal * s.p) / 100 / 4, c: (kcal * s.c) / 100 / 4, f: (kcal * s.f) / 100 / 9 }); }
    const x = kcal / k;
    return wholeG({ p: d.p * x, c: d.c * x, f: d.f * x });
  };
  const withShare = (d, m, pct) => {
    pct = Math.max(0, Math.min(100, pct));
    const k = kcalOfG(d), s = sharesOf(d), others = ["p", "c", "f"].filter((x) => x !== m);
    const left = 100 - pct, had = s[others[0]] + s[others[1]];
    const out = { [m]: (k * pct) / 100 / PER_G[m] };
    others.forEach((o) => { out[o] = (k * (had ? (left * s[o]) / had : left / 2)) / 100 / PER_G[o]; });
    return wholeG(out);
  };
  // a number box that takes effect when they leave it or press Enter, so typing isn't fought mid-number
  function NumBox({ value, onCommit, width }) {
    const [text, setText] = useState(String(value));
    useEffect(() => { setText(String(value)); }, [value]);
    const commit = () => { const v = parseFloat(text); if (Number.isFinite(v) && v >= 0 && v !== value) onCommit(v); else setText(String(value)); };
    return <input className="nut-num" style={width ? { width } : null} inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />;
  }
  function TargetEditor({ athlete, T }) {
    const [draft, setDraft] = useState(null); // { train: {p,c,f}, rest: {p,c,f} } while being changed
    const perKg = (v) => (v / T.kg).toFixed(1);
    const rows = [["train", "Training day"], ["rest", "Rest day"]];
    if (!draft) {
      return (
        <React.Fragment>
          <table className="nut-table nut-targets">
            <thead><tr><th></th><th>Calories</th><th>Protein</th><th>Carbohydrate</th><th>Fat</th><th>C / P / F</th></tr></thead>
            <tbody>
              {rows.map(([key, label]) => { const d = T[key]; return (
                <tr key={key}>
                  <td><b>{label}</b></td>
                  <td>{g0(kcalOf(d))}</td>
                  <td>{g0(d.p)} g <em>{perKg(d.p)} g/kg</em></td>
                  <td>{g0(d.c)} g <em>{perKg(d.c)} g/kg</em></td>
                  <td>{g0(d.f)} g <em>{perKg(d.f)} g/kg</em></td>
                  <td>{shareLine(d)}</td>
                </tr>
              ); })}
            </tbody>
          </table>
          <div className="nut-target-acts no-print">
            {T.custom && <span className="nut-custom-tag">Coach-set targets</span>}
            {T.custom && <span className="nut-hint">recommended: {g0(kcalOf(T.recommended.train))} cal training · {g0(kcalOf(T.recommended.rest))} cal rest</span>}
            <button type="button" className="btn btn-secondary" onClick={() => setDraft({ train: wholeG(T.train), rest: wholeG(T.rest) })}>Adjust calories &amp; macros</button>
            {T.custom && <button type="button" className="btn-link" onClick={() => savePlan(athlete, { targets: null })}>Back to recommended</button>}
          </div>
        </React.Fragment>
      );
    }
    const change = (key, d) => setDraft((x) => Object.assign({}, x, { [key]: d }));
    return (
      <div className="nut-target-edit no-print">
        <table className="nut-table nut-targets">
          <thead><tr><th></th><th>Calories</th><th>Protein (g)</th><th>Carbs (g)</th><th>Fat (g)</th><th>Protein %</th><th>Carbs %</th><th>Fat %</th></tr></thead>
          <tbody>
            {rows.map(([key, label]) => {
              const d = draft[key], s = wholeShares(d);
              return (
                <tr key={key}>
                  <td><b>{label}</b></td>
                  <td><NumBox value={Math.round(kcalOfG(d))} width={80} onCommit={(v) => change(key, withKcal(d, v, T.recommended[key]))} /></td>
                  {["p", "c", "f"].map((m) => <td key={m}><NumBox value={d[m]} width={64} onCommit={(v) => change(key, wholeG(Object.assign({}, d, { [m]: v })))} /> <em>{perKg(d[m])} g/kg</em></td>)}
                  {["p", "c", "f"].map((m) => <td key={`s${m}`}><NumBox value={s[m]} width={52} onCommit={(v) => change(key, withShare(d, m, v))} />%</td>)}
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="nut-hint">Calories always equal 4 × protein + 4 × carbs + 9 × fat. Change calories and the macros keep their shares; change grams and the calories follow; change a share and the other two macros split what’s left. Every meal resizes when you save.</p>
        <div className="nut-top">
          <button type="button" className="btn btn-assign" onClick={() => { savePlan(athlete, { targets: { train: draft.train, rest: draft.rest } }); setDraft(null); }}>Save targets</button>
          <button type="button" className="btn btn-secondary" onClick={() => setDraft({ train: wholeG(T.recommended.train), rest: wholeG(T.recommended.rest) })}>Fill in the recommended</button>
          <button type="button" className="btn btn-secondary" onClick={() => setDraft(null)}>Cancel</button>
        </div>
      </div>
    );
  }

  function MealCell({ meal }) {
    if (meal.cheat) return <div className="nut-cell nut-cheat">Cheat Meal</div>;
    return (
      <div className="nut-cell">
        {meal.items.map((it, i) => <div key={i}>{itemText(it)}</div>)}
        {meal.note && <div className="nut-note">{meal.note}</div>}
        <small>{round(meal.tot.kcal)} kcal</small>
      </div>
    );
  }
  function OptionCard({ title, meal }) {
    return (
      <div className="nut-card">
        <h4>{title}</h4>
        {meal.items.map((it, i) => <div key={i}>{itemText(it)}</div>)}
        {meal.note && <div className="nut-note">{meal.note}</div>}
        <div className="nut-card-tot">{macroLine(meal.tot)}<br /><span>C / P / F {shareLine(meal.tot)}</span></div>
      </div>
    );
  }


  function NutritionTab({ athlete }) {
    useRefresh();
    const rec = planOf(athlete.id);
    const goalKey = rec && GOALS[rec.goal] ? rec.goal : "";
    const basis = basisFor(athlete, rec);
    const [editing, setEditing] = useState(false); // the entered details open for changing (a plan built without a body composition)
    const first = (athlete.name || "").split(/\s+/)[0] || athlete.name;
    const ready = !!(basis && goalKey);
    const T = ready ? targetsFor(basis, goalKey, rec.targets) : null;
    const allergies = allergiesOf(athlete.id);
    const plan = ready ? buildPlan(T, rec.seed || 1, { school: !!rec.schoolLunch, allergies }) : null;
    const lists = ready ? macroLists(T, { allergies }) : null;
    const times = mealTimes(basis, rec);
    const [timesDraft, setTimesDraft] = useState(null); // the meal times being changed on Daily meal targets
    // the athlete's copy is saved again whenever the plan comes out differently (a new scan, a new goal, a shuffle);
    // this tab is drawn whenever a profile is open, so opening one keeps that athlete's phone up to date
    const snapJson = ready ? JSON.stringify(snapshotOf(basis, T, plan, lists, times)) : "";
    useEffect(() => {
      if (!snapJson || !rec) return;
      // compared with the keys in order, since the database hands a saved object back with its keys reordered
      if (sortedJson(rec.snapshot || null) !== sortedJson(JSON.parse(snapJson))) savePlan(athlete, { snapshot: JSON.parse(snapJson) });
    }, [snapJson]);

    if (!ready) {
      return (
        <div className="panel nut">
          <h2>Nutrition Plan</h2>
          {basis ? (
            <React.Fragment>
              <NutritionGoalPicker athlete={athlete} />
              <div className="empty-state">Choose a goal above to build this athlete’s nutrition plan from their latest body composition.</div>
            </React.Fragment>
          ) : <ManualBasisForm athlete={athlete} rec={rec} />}
          <FoodLibraryPanel />
        </div>
      );
    }

    const g = T.goal;
    const perKg = (v) => (v / T.kg).toFixed(1);
    const slotsPerDay = SLOTS.length;
    const weekly = slotsPerDay * 7;

    return (
      <div className="nut">
        <div className="panel">
          <h2>
            Nutrition Plan <small>{first} · {g.label} · {basis.source === "manual" ? `from details entered ${shortDate(basis.date)}` : `from the ${SOURCE_TEXT[basis.source]} of ${shortDate(basis.date)}`}</small>
          </h2>
          <div className="nut-top no-print">
            <NutritionGoalPicker athlete={athlete} />
            <button type="button" className="btn btn-secondary" title="Pick new example meals" onClick={() => savePlan(athlete, { seed: Math.floor(Math.random() * 1e9) })}>Shuffle examples</button>
            {!editing && <button type="button" className="btn btn-secondary" title={basis.source === "manual" ? undefined : "Enter a weight and details by hand: they take over from the body composition until a newer one is on file"} onClick={() => setEditing(true)}>{basis.source === "manual" ? "Edit details" : "Enter weight & details"}</button>}
            <label className="nut-check-opt" title="For school days: Monday to Friday breakfasts are quick grab-and-go options and lunches pack cold for school">
              <input type="checkbox" checked={!!rec.schoolLunch} onChange={(e) => savePlan(athlete, { schoolLunch: e.target.checked })} />
              Packed school lunches (Mon–Fri)
            </label>
          </div>
          {editing && <ManualBasisForm athlete={athlete} rec={rec} basis={basis} onDone={() => setEditing(false)} />}
          <div className="nut-basis">
            {round(basis.weightLb)} lb ({basis.kg.toFixed(1)} kg){basis.pctFat != null ? ` · ${basis.pctFat.toFixed(1)}% body fat` : ""} ·
            resting {round(basis.rmr)} kcal · training {basis.trainMin} min + sport {basis.sportMin} min ≈ {round(basis.activity)} kcal ·
            {basis.typedCal ? " training-day calories as typed on the sheet" : ` ${g.pct > 0 ? "+" : ""}${g.pct}% for the goal`}
            {T.proteinKg !== T.kg ? ` · protein worked off the goal weight (${(T.proteinKg * 2.2).toFixed(0)} lb)` : ""}
          </div>
          {basis.bw && (
            <div className="nut-basis nut-bw">
              Following {first}’s pre-lift weigh-ins: {basis.bw.lb.toFixed(1)} lb, the average of {basis.bw.n} {basis.bw.n === 1 ? "weigh-in" : "weigh-ins"} ({shortDate(basis.bw.first)}{basis.bw.first !== basis.bw.last ? ` – ${shortDate(basis.bw.last)}` : ""}),
              {" "}{basis.bw.lb >= basis.bw.fromLb ? "up" : "down"} {Math.abs(basis.bw.lb - basis.bw.fromLb).toFixed(1)} lb from {basis.bw.fromLb.toFixed(1)} lb on the {basis.source === "manual" ? "details entered" : SOURCE_TEXT[basis.source]}{basis.pctFat != null ? ", at the same body fat" : ""}.
              {rec.targets && (rec.targets.train || rec.targets.rest) ? " The targets you set by hand stay as they are." : " Calories and macros move with it."}
            </div>
          )}
          <AllergyLine athlete={athlete} />
          <TargetEditor athlete={athlete} T={T} />
          <p className="nut-hint">
            Ranges for {g.label.toLowerCase()} (g/kg): protein {g.protein}, fat {g.fat}, carbohydrate {g.train[0]}–{g.train[1]} on a training day and {g.rest[0]}–{g.rest[1]} on a rest day, after Andy Galpin’s periodized nutrition.
          </p>
          {T.flags.map((f, i) => <div key={i} className="nut-flag">{f}</div>)}
          <h3>Daily meal targets</h3>
          <table className="nut-table">
            <thead><tr><th>Meal</th><th>Time</th><th>Training day</th><th>Rest day</th></tr></thead>
            <tbody>
              {SLOTS.map((s, i) => {
                const t = T.trainMeals.find((m) => m.key === s.key), r = T.restMeals.find((m) => m.key === s.key);
                return (
                  <tr key={s.key}>
                    <td><b>{s.name}</b></td>
                    <td>{timesDraft
                      ? <input className="nut-num nut-time" value={timesDraft[s.key]} placeholder={s.time} maxLength={20} onChange={(e) => { const v = e.target.value; setTimesDraft((x) => Object.assign({}, x, { [s.key]: v })); }} />
                      : times[i]}</td>
                    <td>{macroLine(t.target)}</td>
                    <td>{r ? macroLine(r.target) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {/* the times of day: typed as they should read ("6:30a", "After practice"), and shown on the athlete's phone */}
          <div className="nut-target-acts no-print">
            {timesDraft ? (
              <React.Fragment>
                <button type="button" className="btn btn-assign" onClick={() => {
                  const clean = Object.fromEntries(Object.entries(timesDraft).map(([k, v]) => [k, String(v || "").trim().slice(0, 20)]).filter(([, v]) => v));
                  savePlan(athlete, { times: Object.keys(clean).length ? clean : null });
                  setTimesDraft(null);
                }}>Save times</button>
                <button type="button" className="btn btn-secondary" onClick={() => setTimesDraft(Object.fromEntries(SLOTS.map((s) => [s.key, ""])))}>Use the usual times</button>
                <button type="button" className="btn btn-secondary" onClick={() => setTimesDraft(null)}>Cancel</button>
                <span className="nut-hint">Type each time as it should read, e.g. 6:30a or After practice. Left blank, a meal uses its usual time.</span>
              </React.Fragment>
            ) : (
              <button type="button" className="btn btn-secondary" onClick={() => setTimesDraft(Object.fromEntries(SLOTS.map((s, i) => [s.key, (rec.times && rec.times[s.key]) || times[i]])))}>Edit meal times</button>
            )}
          </div>
        </div>

        {plan.weeks.map((week, w) => (
          <div className="panel" key={w}>
            <h2>Example Meal Rotation <small>Week {w + 1} · training days (on a rest day, skip the post-workout shake and use the rest-day portions in the macro lists)</small></h2>
            <div className="nut-scroll">
              <table className="nut-table nut-rotation">
                <thead><tr><th></th>{DAYS.map((d) => <th key={d}>{d}</th>)}</tr></thead>
                <tbody>
                  {SLOTS.map((s) => (
                    <tr key={s.key}><td className="nut-slot">{s.name}</td>{week.map((day, d) => <td key={d}><MealCell meal={day[s.key]} /></td>)}</tr>
                  ))}
                  <tr className="nut-total"><td className="nut-slot">Day total</td>{week.map((day, d) => <td key={d}>{round(day.tot.kcal)} kcal<br />C {g0(day.tot.c)} · P {g0(day.tot.p)} · F {g0(day.tot.f)}</td>)}</tr>
                </tbody>
              </table>
            </div>
          </div>
        ))}

        <div className="panel">
          <h2>Macro Lists <small>build your own lunch and dinner: one protein, one carbohydrate, one fruit and the vegetables, in these amounts</small></h2>
          <div className="nut-lists">
            {[["Protein", lists.protein], ["Carbohydrate", lists.starch], ["Fruit", lists.fruit], ["Vegetables", lists.veg], ["Add a fat (when a meal is low)", lists.fat]].map(([title, rows]) => {
              const same = rows.every((r) => r.train === r.rest); // one column when rest days are no different
              return (
                <table className="nut-table nut-list" key={title}>
                  <thead><tr><th>{title}</th>{same ? <th>Amount</th> : <React.Fragment><th>Training</th><th>Rest</th></React.Fragment>}</tr></thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.food.key}><td>{r.food.name}</td><td>{amountText(r.food, r.train)}</td>{!same && <td>{amountText(r.food, r.rest)}</td>}</tr>
                    ))}
                  </tbody>
                </table>
              );
            })}
          </div>
        </div>

        <div className="panel">
          <h2>Breakfast, Snack &amp; Shake Options <small>each sized to {first}’s meal targets on a training day</small></h2>
          <h3>Breakfast</h3>
          <div className="nut-cards">{plan.options.breakfast.map((m, i) => <OptionCard key={i} title={m.name} meal={m} />)}</div>
          <h3>Snacks</h3>
          <div className="nut-cards">{plan.options.snack.map((m, i) => <OptionCard key={i} title={m.name} meal={m} />)}</div>
          <h3>Post-workout</h3>
          <div className="nut-cards"><OptionCard title={plan.options.post.name} meal={plan.options.post} /></div>
        </div>

        <div className="panel">
          <h2>Grocery List <small>for the example rotation</small></h2>
          <div className="nut-lists">
            {plan.weeks.map((week, w) => (
              <table className="nut-table nut-list nut-grocery" key={w}>
                <thead><tr><th colSpan={3}>Week {w + 1}</th></tr><tr><th>Food</th><th>Serving</th><th>Week</th></tr></thead>
                <tbody>
                  {groceryList(week).map((grp) => (
                    <React.Fragment key={grp.name}>
                      <tr className="nut-group"><td colSpan={3}>{grp.name}</td></tr>
                      {grp.items.map((it) => <tr key={it.food.key}><td>{it.food.name}</td><td>{amountText(it.food, it.serving)}</td><td>{amountText(it.food, it.total)}</td></tr>)}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            ))}
          </div>
        </div>

        <div className="panel">
          <h2>Your Meal Rotation <small>fill in your own meals from the macro lists and options</small></h2>
          {[1, 2].map((w) => (
            <div className="nut-scroll" key={w}>
              <table className="nut-table nut-rotation nut-blank">
                <thead><tr><th>Week {w}</th>{DAYS.map((d) => <th key={d}>{d}</th>)}</tr></thead>
                <tbody>{SLOTS.map((s) => <tr key={s.key}><td className="nut-slot">{s.name}</td>{DAYS.map((d) => <td key={d}></td>)}</tr>)}</tbody>
              </table>
            </div>
          ))}
        </div>

        <div className="panel">
          <h2>Accountability Chart <small>check off each meal eaten as planned</small></h2>
          <div className="nut-scroll">
            {[0, 1, 2, 3].map((w) => (
              <table className="nut-table nut-check" key={w}>
                <thead><tr><th></th>{DAYS.map((d, i) => <th key={d}>Day {w * 7 + i + 1}</th>)}</tr></thead>
                <tbody>
                  {SLOTS.map((s) => <tr key={s.key}><td className="nut-slot">{s.name}</td>{DAYS.map((d) => <td key={d}></td>)}</tr>)}
                  <tr><td className="nut-slot">Hydration</td>{DAYS.map((d) => <td key={d}></td>)}</tr>
                </tbody>
              </table>
            ))}
          </div>
          <p className="nut-hint">
            To achieve 90% you must be successful {Math.ceil(weekly * 0.9)} out of {weekly} each week; to achieve 80%, {Math.ceil(weekly * 0.8)} out of {weekly}.
          </p>
        </div>

        <div className="panel">
          <h2>Daily Meal Preparation</h2>
          <div className="nut-guides">
            <div>
              <h3>Daily schedule</h3>
              <table className="nut-table">
                <tbody>{SLOTS.map((s, i) => <tr key={s.key}><td>{times[i]}</td><td><b>{s.name}</b></td></tr>)}</tbody>
              </table>
              <p className="nut-hint">The last snack and dinner are interchangeable.</p>
            </div>
            <div>
              <h3>Hydration</h3>
              <p className="nut-hint">A 2–3% loss of body weight can mean a 15–20% drop in performance.</p>
              <ul>
                <li>Weigh before and after practice</li>
                <li>Drink 16 oz of water for every pound lost</li>
                <li>The body absorbs about 16–20 oz of water an hour</li>
                <li>About 128 oz (1 gallon) through the day: two 32 oz bottles in the morning, two in the afternoon</li>
              </ul>
              <h3>Supplements</h3>
              <p className="nut-hint">NSF Certified for Sport only (nsfsport.com).</p>
              <ul>
                <li>Fish oil</li><li>Multi-vitamin</li><li>Electrolytes</li><li>Whey protein</li><li>Creatine, beta-alanine, leucine</li>
              </ul>
            </div>
            <div>
              <h3>Failing to plan is planning to fail</h3>
              <ol>
                <li><b>Get the tools:</b> food containers, a small food scale, zip-lock bags, a food chopper, a small container for dressings, a thermos, a lunch cooler, a grill, a single-serving blender and a rice cooker</li>
                <li><b>Buy your bars and shakes</b></li>
                <li><b>Shop only from the grocery list</b></li>
                <li><b>Post the meal rotation and accountability chart on the fridge</b></li>
                <li><b>Add accountability:</b> a food-tracking app, phone reminders, a training partner and a sleep app</li>
              </ol>
              <h3>Packing a school lunch</h3>
              <ul>
                {PACKING_TIPS.map((t) => <li key={t}>{t}</li>)}
              </ul>
            </div>
          </div>
        </div>
        <FoodLibraryPanel />
      </div>
    );
  }

  // ---- the shared food library (migration_024): custom foods athletes and coaches have entered from labels, which
  // everyone's food log searches beside the built-in food database. Coaches correct, add or delete them here.
  const LIB_UNITS = ["serving", "piece", "g", "oz", "cup", "fl oz", "tbsp", "tsp"];
  const blankFood = () => ({ name: "", sAmt: "1", sUnit: "serving", kcal: "", p: "", c: "", f: "" });
  function FoodLibraryPanel() {
    const [rows, setRows] = useState(null); // null until opened and loaded; "missing" without the table
    const [edit, setEdit] = useState(null); // { id (null for a new one), form }
    const [q, setQ] = useState("");
    const sb = window.supabaseClient;
    const load = async () => {
      const { data, error } = await sb.from("food_library").select("id,data,updated_at").order("updated_at", { ascending: false }).limit(5000);
      setRows(error ? "missing" : (data || []).map((r) => Object.assign({ id: r.id }, r.data || {})));
    };
    const save = async () => {
      const f = edit.form, n = (v) => { const x = parseFloat(v); return Number.isFinite(x) && x >= 0 ? x : 0; };
      if (!f.name.trim() || !(n(f.sAmt) > 0)) { window.alert("Give the food a name and a serving size."); return; }
      const prev = edit.id ? rows.find((r) => r.id === edit.id) : null;
      const { data: s } = await sb.auth.getSession();
      const me = (s && s.session && s.session.user && s.session.user.email) || "";
      const data = Object.assign({}, prev || { source: "coach", addedBy: me },
        { name: f.name.trim().slice(0, 60), sAmt: n(f.sAmt), sUnit: f.sUnit, kcal: Math.round(n(f.kcal) || n(f.p) * 4 + n(f.c) * 4 + n(f.f) * 9), p: n(f.p), c: n(f.c), f: n(f.f) });
      delete data.id;
      const id = edit.id || `fl-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      const { error } = await sb.from("food_library").upsert({ id, data, updated_at: new Date().toISOString() });
      if (error) { window.alert(`That food couldn’t be saved: ${error.message}`); return; }
      setEdit(null);
      load();
    };
    const remove = async (r) => {
      if (!window.confirm(`Delete ${r.name} from the food library? Food logs that already have it keep their figures.`)) return;
      const { error } = await sb.from("food_library").delete().eq("id", r.id);
      if (error) { window.alert(`That food couldn’t be deleted: ${error.message}`); return; }
      load();
    };
    // shared with everyone's food log: a coach's food, a barcode scan, or one a coach shared; an athlete's typed-in food is theirs alone
    const isShared = (r) => r.source !== "athlete" || !!r.barcode || r.shared === true;
    const share = async (r) => {
      const { id, ...data } = r;
      const { error } = await sb.from("food_library").upsert({ id, data: Object.assign({}, data, { shared: true }), updated_at: new Date().toISOString() });
      if (error) { window.alert(`That food couldn’t be shared: ${error.message}`); return; }
      load();
    };
    const setForm = (k, v) => setEdit((e) => Object.assign({}, e, { form: Object.assign({}, e.form, { [k]: v }) }));
    const field = (k, label, type) => <label className="nut-field"><span>{label}</span><input type={type || "number"} step="any" value={edit.form[k]} onChange={(e) => setForm(k, e.target.value)} /></label>;
    const words = q.toLowerCase().trim();
    const shown = Array.isArray(rows) ? rows.filter((r) => !words || String(r.name || "").toLowerCase().includes(words)) : [];
    return (
      <details className="panel nut-library no-print" onToggle={(e) => { if (e.currentTarget.open && rows == null) load(); }}>
        <summary><b>Food library</b> <small>custom foods beside the {(window.DSTFoodDB || []).length} built-in foods: coaches’ foods and barcode scans are in everyone’s food log; a food an athlete types in is theirs until you share it</small></summary>
        {rows == null && <p className="nut-hint">Loading…</p>}
        {rows === "missing" && <p className="nut-hint">The food library isn’t set up yet: run supabase/migration_024_food_library.sql in the Supabase SQL Editor.</p>}
        {Array.isArray(rows) && (
          <React.Fragment>
            <div className="nut-top">
              <input className="nut-lib-search" type="search" placeholder="Search the library" value={q} onChange={(e) => setQ(e.target.value)} />
              <button type="button" className="btn btn-secondary" onClick={() => setEdit({ id: null, form: blankFood() })}>+ Add a food</button>
            </div>
            {edit && (
              <div className="nut-manual">
                <div className="nut-fields">
                  {field("name", "Food", "text")}
                  {field("sAmt", "Serving size")}
                  <label className="nut-field"><span>Unit</span><select value={edit.form.sUnit} onChange={(e) => setForm("sUnit", e.target.value)}>{LIB_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}</select></label>
                  {field("kcal", "Calories")}{field("p", "Protein (g)")}{field("c", "Carbs (g)")}{field("f", "Fat (g)")}
                </div>
                <div className="nut-top">
                  <button type="button" className="btn btn-assign" onClick={save}>Save food</button>
                  <button type="button" className="btn btn-secondary" onClick={() => setEdit(null)}>Cancel</button>
                </div>
              </div>
            )}
            {shown.length ? (
              <table className="nut-table">
                <thead><tr><th>Food</th><th>Serving</th><th>Calories</th><th>P / C / F</th><th>Added by</th><th>Who sees it</th><th></th></tr></thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.id}>
                      <td>{r.name}</td><td>{r.sAmt} {r.sUnit}</td><td>{r.kcal}</td><td>{r.p} / {r.c} / {r.f}</td><td>{r.addedBy || (r.source === "coach" ? "a coach" : "an athlete")}</td>
                      {/* an athlete's typed-in food is theirs alone (migration_030) until a coach shares it */}
                      <td>{isShared(r) ? "Everyone" : <span>Only {r.addedBy || "that athlete"} <button type="button" className="btn-link" title="Put this food in everyone's food log search" onClick={() => share(r)}>Share with everyone</button></span>}</td>
                      <td className="nut-lib-acts">
                        <button type="button" className="btn-link" onClick={() => setEdit({ id: r.id, form: { name: r.name || "", sAmt: String(r.sAmt || 1), sUnit: r.sUnit || "serving", kcal: String(r.kcal || ""), p: String(r.p || ""), c: String(r.c || ""), f: String(r.f || "") } })}>Edit</button>
                        <button type="button" className="btn-link" style={{ color: "var(--danger)" }} onClick={() => remove(r)}>Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="nut-hint">{rows.length ? "No custom foods match that search." : "No custom foods yet. Athletes’ custom foods from the app show up here, and coaches can add their own."}</p>}
          </React.Fragment>
        )}
      </details>
    );
  }

  // ---- the Meal Log: what the athlete logged on their phone (food_logs, migration_023), a week at a time. Each day: a
  // training or rest day, what was eaten against that day's targets, which meals were logged, and a missed day marked;
  // a day opens to its foods, meal by meal.
  const MEAL_KEYS = ["Breakfast", "Mid-Morning Snack", "Lunch", "Mid-Afternoon Snack", "Dinner", "Post-Workout Shake"];
  const dayKeyOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  function MealLog({ athlete }) {
    const [weekStart, setWeekStart] = useState(() => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return dayKeyOf(d); }); // Monday
    const [days, setDays] = useState(null); // "YYYY-MM-DD" -> entries; null while loading, "missing" without the table
    const [openDay, setOpenDay] = useState(null);
    const rec = planOf(athlete.id);
    const snap = rec && rec.snapshot;
    const dates = Array.from({ length: 7 }, (_, i) => { const [y, m, d] = weekStart.split("-").map(Number); return dayKeyOf(new Date(y, m - 1, d + i)); });
    useEffect(() => {
      let live = true;
      setDays(null);
      window.supabaseClient.from("food_logs").select("day,entries").eq("athlete_id", String(athlete.id)).gte("day", dates[0]).lte("day", dates[6]).then(({ data, error }) => {
        if (!live) return;
        if (error) { setDays("missing"); return; }
        const out = {};
        (data || []).forEach((r) => { out[String(r.day).slice(0, 10)] = Array.isArray(r.entries) ? r.entries : []; });
        setDays(out);
      });
      return () => { live = false; };
    }, [athlete.id, weekStart]);
    const shift = (n) => { const [y, m, d] = weekStart.split("-").map(Number); setWeekStart(dayKeyOf(new Date(y, m - 1, d + n * 7))); setOpenDay(null); };
    const today = dayKeyOf(new Date());
    const label = (k) => new Date(`${k}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "numeric", day: "numeric" });
    const sum = (list) => list.reduce((t, e) => ({ kcal: t.kcal + (+e.kcal || 0), p: t.p + (+e.p || 0), c: t.c + (+e.c || 0), f: t.f + (+e.f || 0) }), { kcal: 0, p: 0, c: 0, f: 0 });
    const info = (k) => {
      const all = (days && days !== "missing" && days[k]) || [];
      const tag = all.find((e) => e.id === "daytype");
      const foods = all.filter((e) => e.name);
      const eaten = foods.filter((e) => !e.planned), planned = foods.filter((e) => e.planned);
      const rest = tag ? tag.dayType === "rest" : null;
      const target = snap ? (rest ? snap.rest : snap.train) : null;
      const meals = MEAL_KEYS.filter((mk) => !(rest && mk === "Post-Workout Shake")).map((mk) => ({ name: mk, eaten: eaten.filter((e) => e.meal === mk), planned: planned.filter((e) => e.meal === mk) }));
      const status = eaten.length ? "logged" : k > today ? (planned.length ? "planned" : "upcoming") : k === today ? (planned.length ? "planned" : "today") : "missed";
      const water = all.find((e) => e.id === "water"); // the water tapped in on the phone ({ oz, extra: drink-back added to the goal })
      return { k, eaten, planned, rest, target, meals, status, tot: sum(eaten), water: water && +water.oz > 0 ? water : null };
    };
    const week = dates.map(info);
    const past = week.filter((d) => d.k <= today);
    const loggedDays = past.filter((d) => d.status === "logged");
    const avg = (key) => (loggedDays.length ? Math.round(loggedDays.reduce((s, d) => s + d.tot[key], 0) / loggedDays.length) : null);
    const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);
    const cls = (a, b) => { const p = pct(a, b); return p == null ? "" : p >= 90 && p <= 110 ? "ok" : p >= 75 && p <= 125 ? "near" : "off"; };
    const sel = openDay ? info(openDay) : null;
    return (
      <div className="panel meal-log">
        <h2>Meal Log <small>what {(athlete.name || "").split(/\s+/)[0] || "the athlete"} logged in the app, a week at a time</small></h2>
        <div className="ml-week">
          <button type="button" className="btn btn-secondary" onClick={() => shift(-1)}>‹ Previous week</button>
          <b>Week of {new Date(`${dates[0]}T12:00:00`).toLocaleDateString(undefined, { month: "long", day: "numeric" })}</b>
          <button type="button" className="btn btn-secondary" onClick={() => shift(1)}>Next week ›</button>
        </div>
        {days === null && <p className="nut-hint">Loading…</p>}
        {days === "missing" && <p className="nut-hint">The meal log isn’t set up yet: run supabase/migration_023_food_log.sql in the Supabase SQL Editor.</p>}
        {days && days !== "missing" && (
          <React.Fragment>
            <div className="ml-summary">
              <span><b>{loggedDays.length}</b> of {past.length} day{past.length === 1 ? "" : "s"} logged</span>
              {past.length - loggedDays.length > 0 && <span className="ml-missed-count"><b>{past.length - loggedDays.length}</b> missed</span>}
              {avg("kcal") != null && <span>Average <b>{avg("kcal").toLocaleString()}</b> cal · P {avg("p")} · C {avg("c")} · F {avg("f")}</span>}
              {!snap && <span className="nut-hint">No nutrition plan yet, so there are no targets to compare against.</span>}
            </div>
            <div className="nut-scroll">
              <table className="nut-table ml-grid">
                <thead><tr><th></th>{week.map((d) => <th key={d.k} className={d.k === today ? "ml-today" : ""}>{label(d.k)}</th>)}</tr></thead>
                <tbody>
                  <tr><td className="nut-slot">Day</td>{week.map((d) => <td key={d.k}><span className={`ml-badge ml-${d.status}`}>{d.status}</span>{d.rest != null && <span className={`ml-type ${d.rest ? "rest" : "train"}`}>{d.rest ? "Rest day" : "Training day"}</span>}</td>)}</tr>
                  <tr><td className="nut-slot">Calories</td>{week.map((d) => <td key={d.k} className={d.eaten.length && d.target ? `ml-${cls(d.tot.kcal, d.target.kcal)}` : ""}>{d.eaten.length ? <React.Fragment><b>{Math.round(d.tot.kcal).toLocaleString()}</b>{d.target ? <small> / {d.target.kcal.toLocaleString()} ({pct(d.tot.kcal, d.target.kcal)}%)</small> : null}</React.Fragment> : "—"}</td>)}</tr>
                  {[["p", "Protein"], ["c", "Carbs"], ["f", "Fat"]].map(([mk, name]) => (
                    <tr key={mk}><td className="nut-slot">{name}</td>{week.map((d) => <td key={d.k} className={d.eaten.length && d.target ? `ml-${cls(d.tot[mk], d.target[mk])}` : ""}>{d.eaten.length ? <React.Fragment>{Math.round(d.tot[mk])}g{d.target ? <small> / {d.target[mk]}g</small> : null}</React.Fragment> : "—"}</td>)}</tr>
                  ))}
                  <tr><td className="nut-slot">Water</td>{week.map((d) => <td key={d.k}>{d.water ? <React.Fragment><b>{Math.round(d.water.oz)} oz</b>{+d.water.extra > 0 ? <small> · {Math.round(d.water.extra)} oz drink-back</small> : null}</React.Fragment> : "—"}</td>)}</tr>
                  {MEAL_KEYS.map((mk) => (
                    <tr key={mk}><td className="nut-slot">{mk}</td>{week.map((d) => { const m = d.meals.find((x) => x.name === mk); return <td key={d.k} className="ml-meal">{!m ? "" : m.eaten.length ? <span className="ml-yes">✓ {Math.round(sum(m.eaten).kcal)}</span> : m.planned.length ? <span className="ml-plan">planned</span> : d.k < today || (d.k === today && d.eaten.length) ? <span className="ml-no">✗</span> : ""}</td>; })}</tr>
                  ))}
                  <tr><td className="nut-slot"></td>{week.map((d) => <td key={d.k}>{(d.eaten.length || d.planned.length) ? <button type="button" className="btn-link" onClick={() => setOpenDay(openDay === d.k ? null : d.k)}>{openDay === d.k ? "Hide" : "See foods"}</button> : null}</td>)}</tr>
                </tbody>
              </table>
            </div>
            {sel && (
              <div className="ml-detail">
                <h3>{new Date(`${sel.k}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}{sel.rest != null ? ` · ${sel.rest ? "Rest day" : "Training day"}` : ""}</h3>
                {sel.meals.filter((m) => m.eaten.length || m.planned.length).map((m) => (
                  <div key={m.name} className="ml-detail-meal">
                    <b>{m.name}</b> <small>{Math.round(sum(m.eaten).kcal)} cal logged{m.planned.length ? ` · ${Math.round(sum(m.planned).kcal)} planned` : ""}</small>
                    <ul>
                      {m.eaten.map((e, i) => <li key={`e${i}`}>{e.amount ? `${e.amount} ` : ""}{e.name} <small>{e.kcal} cal · P {e.p} · C {e.c} · F {e.f}</small></li>)}
                      {m.planned.map((e, i) => <li key={`p${i}`} className="ml-planned">{e.amount ? `${e.amount} ` : ""}{e.name} <small>planned</small></li>)}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </React.Fragment>
        )}
      </div>
    );
  }

  // Every athlete's phone copy of their plan, brought up to date when the dashboard opens: a new body comp scan, or a
  // change to the plan's meals and options here, reaches their phone without their profile having to be opened first.
  // Only plans whose copy comes out differently are saved.
  function refreshAll() {
    const store = window.AthleteStore;
    (store.allAthletes ? store.allAthletes() : []).forEach((a) => {
      try {
        const rec = planOf(a.id);
        if (!rec || !GOALS[rec.goal]) return;
        const basis = basisFor(a, rec);
        if (!basis) return;
        const T = targetsFor(basis, rec.goal, rec.targets);
        const times = mealTimes(basis, rec);
        const allergies = allergiesOf(a.id);
        const snap = snapshotOf(basis, T, buildPlan(T, rec.seed || 1, { school: !!rec.schoolLunch, allergies }), macroLists(T, { allergies }), times);
        if (sortedJson(rec.snapshot || null) !== sortedJson(JSON.parse(JSON.stringify(snap)))) savePlan(a, { snapshot: snap });
      } catch (e) { /* one athlete's plan that can't be worked out doesn't stop the rest */ }
    });
  }

  window.NutritionTab = NutritionTab;
  window.NutritionGoalPicker = NutritionGoalPicker;
  window.MealLog = MealLog;
  window.NutritionPlan = { FOODS, GOALS, basisFor, targetsFor, buildPlan, macroLists, solve, snapshotOf, SLOTS, refreshAll }; // refreshAll on load; the rest for checking the sums
})();
