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

  // ---- food lists ------------------------------------------------------------------------------------
  // per one unit: kcal, carbohydrate, protein, fat (g). step: the smallest portion; max: the largest in one meal.
  const FOODS = {};
  const food = (key, cat, name, unit, step, kcal, c, p, f, more) => { FOODS[key] = Object.assign({ key, cat, name, unit, step, kcal, c, p, f, max: 99 }, more || {}); };
  // protein (cooked)
  food("chicken", "protein", "Chicken Breast", "oz", 0.5, 47, 0, 8.8, 1.0, { min: 3, max: 12 });
  food("turkey", "protein", "Turkey Breast", "oz", 0.5, 42, 0, 8.5, 0.7, { min: 3, max: 12 });
  food("gturkey", "protein", "93% Lean Ground Turkey", "oz", 0.5, 57, 0, 7.7, 3.0, { min: 3, max: 10 });
  food("gbeef", "protein", "90% Lean Ground Beef", "oz", 0.5, 61, 0, 7.4, 3.3, { min: 3, max: 9 });
  food("sirloin", "protein", "Sirloin Steak", "oz", 0.5, 55, 0, 8.4, 2.2, { min: 3, max: 10 });
  food("tenderloin", "protein", "Tenderloin Steak", "oz", 0.5, 58, 0, 8.0, 2.7, { min: 3, max: 9 });
  food("pork", "protein", "Pork Tenderloin", "oz", 0.5, 41, 0, 7.4, 1.0, { min: 3, max: 12 });
  food("salmon", "protein", "Salmon", "oz", 0.5, 58, 0, 7.3, 3.0, { min: 3, max: 9 });
  food("tilapia", "protein", "Tilapia", "oz", 0.5, 36, 0, 7.4, 0.8, { min: 3, max: 12 });
  food("cod", "protein", "Cod", "oz", 0.5, 30, 0, 6.5, 0.2, { min: 3, max: 12 });
  food("mahi", "protein", "Mahi Mahi", "oz", 0.5, 31, 0, 6.7, 0.3, { min: 3, max: 12 });
  food("shrimp", "protein", "Shrimp", "oz", 0.5, 28, 0.1, 6.8, 0.1, { min: 3, max: 12 });
  food("tuna", "protein", "Tuna (canned in water)", "oz", 0.5, 33, 0, 7.2, 0.3, { min: 3, max: 10 });
  // deli and breakfast protein
  food("ham", "deli", "Deli Ham", "oz", 1, 31, 0.8, 5.0, 1.0, { max: 8 });
  food("dturkey", "deli", "Deli Turkey", "oz", 1, 30, 1.0, 5.0, 0.5, { max: 8 });
  food("roastbeef", "deli", "Deli Roast Beef", "oz", 1, 35, 0.5, 6.0, 1.0, { max: 8 });
  food("jerky", "deli", "Beef Jerky", "oz", 1, 80, 6, 11, 1, { max: 3 });
  food("eggs", "dairy", "Egg", "item", 1, 72, 0.4, 6.3, 4.8, { pl: "Eggs", min: 2, max: 6 });
  food("whites", "dairy", "Liquid Egg Whites", "cup", 0.25, 126, 1.8, 26.3, 0.4, { max: 1.5 });
  food("greek", "dairy", "Nonfat Greek Yogurt", "cup", 0.25, 133, 8.0, 23.6, 0.9, { min: 0.5, max: 2 });
  food("cottage", "dairy", "2% Cottage Cheese", "cup", 0.25, 183, 9.5, 23.5, 5.1, { min: 0.5, max: 1.5 });
  food("milk", "dairy", "2% Milk", "cup", 0.5, 122, 12, 8, 4.8, { max: 2 });
  food("almondmilk", "dairy", "Almond Milk", "cup", 0.5, 59, 8, 1, 2.5, { max: 2 });
  food("cheese", "dairy", "Cheddar Cheese", "oz", 0.5, 114, 0.4, 7.1, 9.4, { max: 2 });
  food("stringcheese", "dairy", "String Cheese", "item", 1, 80, 1, 7, 6, { pl: "String Cheese", max: 2 });
  food("whey", "dairy", "Whey Protein", "scoop", 0.5, 120, 3, 24, 1.5, { min: 1, max: 2.5 });
  // starch (cooked unless noted)
  food("rice", "starch", "White Rice", "cup", 0.25, 206, 44.6, 4.3, 0.4, { max: 2.5 });
  food("brownrice", "starch", "Brown Rice", "cup", 0.25, 216, 44.8, 5.0, 1.8, { max: 2.5 });
  food("pasta", "starch", "Pasta", "cup", 0.25, 220, 43, 8.1, 1.3, { max: 2.5 });
  food("wwpasta", "starch", "Whole Wheat Pasta", "cup", 0.25, 174, 37.2, 7.5, 0.8, { max: 2.5 });
  food("quinoa", "starch", "Quinoa", "cup", 0.25, 222, 39.4, 8.1, 3.6, { max: 2.5 });
  food("couscous", "starch", "Couscous", "cup", 0.25, 176, 36.5, 6.0, 0.3, { max: 2.5 });
  food("sweetpotato", "starch", "Sweet Potato (medium)", "item", 0.5, 103, 23.6, 2.3, 0.2, { pl: "Sweet Potatoes (medium)", max: 3 });
  food("redpotato", "starch", "Red Potato (small)", "item", 0.5, 123, 27.1, 3.2, 0.2, { pl: "Red Potatoes (small)", max: 3 });
  food("blackbeans", "starch", "Black Beans", "cup", 0.25, 227, 40.8, 15.2, 0.9, { max: 1.5 });
  food("oats", "starch", "Old Fashioned Oats (dry)", "cup", 0.25, 300, 54, 10, 5, { min: 0.25, max: 1.5 });
  food("bread", "starch", "Whole Wheat Bread", "slice", 1, 80, 14, 4, 1.1, { max: 4 });
  food("bagel", "starch", "Whole Wheat Bagel", "item", 0.5, 245, 48, 10, 1.7, { pl: "Whole Wheat Bagels", max: 1.5 });
  food("granola", "starch", "Granola", "cup", 0.25, 440, 80, 10, 8, { max: 1 });
  food("ricecakes", "starch", "Rice Cake", "item", 1, 35, 7.3, 0.7, 0.3, { pl: "Rice Cakes", max: 4 });
  food("honey", "starch", "Honey", "tbsp", 0.5, 64, 17.3, 0.1, 0, { max: 2 });
  // fruit
  food("apple", "fruit", "Apple", "item", 0.5, 95, 25.1, 0.5, 0.3, { pl: "Apples", max: 2 });
  food("banana", "fruit", "Banana", "item", 0.5, 105, 27, 1.3, 0.4, { pl: "Bananas", max: 2 });
  food("orange", "fruit", "Orange", "item", 0.5, 62, 15.4, 1.2, 0.2, { pl: "Oranges", max: 2 });
  food("pear", "fruit", "Pear", "item", 0.5, 101, 27, 0.6, 0.2, { pl: "Pears", max: 2 });
  food("strawberries", "fruit", "Strawberries", "cup", 0.5, 49, 11.7, 1.0, 0.5, { max: 2 });
  food("blueberries", "fruit", "Blueberries", "cup", 0.5, 84, 21.4, 1.1, 0.5, { max: 2 });
  food("blackberries", "fruit", "Blackberries", "cup", 0.5, 62, 13.8, 2.0, 0.7, { max: 2 });
  food("raspberries", "fruit", "Raspberries", "cup", 0.5, 64, 14.7, 1.5, 0.8, { max: 2 });
  food("pineapple", "fruit", "Pineapple", "cup", 0.5, 82, 21.6, 0.9, 0.2, { max: 2 });
  food("grapes", "fruit", "Grapes", "cup", 0.5, 104, 27.3, 1.1, 0.2, { max: 2 });
  food("cantaloupe", "fruit", "Cantaloupe", "cup", 0.5, 54, 13, 1.3, 0.3, { max: 2 });
  food("mango", "fruit", "Mango", "cup", 0.5, 99, 24.7, 1.4, 0.6, { max: 2 });
  // vegetables (cooked unless noted)
  food("broccoli", "veg", "Broccoli", "cup", 0.5, 55, 11.2, 3.7, 0.6);
  food("greenbeans", "veg", "Green Beans", "cup", 0.5, 44, 9.9, 2.4, 0.4);
  food("carrots", "veg", "Carrots", "cup", 0.5, 54, 12.8, 1.2, 0.3);
  food("asparagus", "veg", "Asparagus", "cup", 0.5, 40, 7.4, 4.3, 0.4);
  food("cauliflower", "veg", "Cauliflower", "cup", 0.5, 29, 5.1, 2.3, 0.6);
  food("spinach", "veg", "Spinach", "cup", 0.5, 41, 6.8, 5.3, 0.5);
  food("brussels", "veg", "Brussels Sprouts", "cup", 0.5, 56, 11.1, 4.0, 0.8);
  food("zucchini", "veg", "Zucchini", "cup", 0.5, 27, 4.8, 2.1, 0.6);
  food("peas", "veg", "Peas", "cup", 0.5, 134, 25, 8.6, 0.4, { max: 1 });
  food("greens", "veg", "Mixed Salad Greens (raw)", "cup", 1, 9, 1.7, 0.7, 0.1);
  food("bellpepper", "veg", "Bell Pepper", "item", 0.5, 37, 7.2, 1.2, 0.4, { pl: "Bell Peppers", max: 2 });
  // fats
  food("oliveoil", "fat", "Olive Oil", "tsp", 1, 40, 0, 0, 4.5, { max: 3 });
  food("avocado", "fat", "Avocado", "item", 0.25, 320, 17, 4, 29.5, { pl: "Avocados", max: 0.5 });
  food("pb", "fat", "Peanut Butter (all natural)", "tbsp", 0.5, 95, 3.5, 3.6, 8.2, { max: 2 });
  food("almondbutter", "fat", "Almond Butter", "tbsp", 0.5, 98, 3.0, 3.4, 8.9, { max: 2 });
  food("almonds", "fat", "Almonds", "oz", 0.5, 164, 6.1, 6.0, 14.2, { max: 1.5 });
  food("nuts", "fat", "Mixed Nuts", "oz", 0.5, 172, 6.0, 5.0, 15.0, { max: 1.5 });
  food("dressing", "fat", "Italian Dressing", "tbsp", 0.5, 70, 1.5, 0.1, 7.1, { max: 2 });
  // bars
  food("zone", "bar", "Zone Perfect Bar", "item", 1, 210, 22, 16, 7, { pl: "Zone Perfect Bars", max: 2 });
  // for the meal options (salad bowl, wraps, pasta, chocolate milk, as on the DST salad and grocery lists)
  food("chickpeas", "starch", "Chickpeas", "cup", 0.25, 269, 45, 14.5, 4.2, { max: 1 });
  food("tortilla", "starch", "Whole Wheat Tortilla", "item", 1, 130, 22, 4, 3.5, { pl: "Whole Wheat Tortillas", max: 3 });
  food("marinara", "starch", "Marinara Sauce", "cup", 0.25, 132, 20, 3.5, 4, { max: 1 });
  food("chocmilk", "dairy", "Low-Fat Chocolate Milk", "cup", 0.5, 158, 26, 8.5, 2.5, { max: 3 });
  food("cucumber", "veg", "Cucumber", "cup", 0.5, 16, 3.8, 0.7, 0.1);
  food("onion", "veg", "Red Onion", "cup", 0.25, 64, 15, 1.8, 0.2, { max: 0.5 });
  food("mushrooms", "veg", "Mushrooms", "cup", 0.5, 15, 2.3, 2.2, 0.2);
  // a dairy-free protein powder (pea based), for athletes who can't have whey
  food("plantprotein", "dairy", "Plant Protein (pea)", "scoop", 0.5, 120, 4, 21, 2.5, { min: 1, max: 2.5 });

  // ---- food allergies: the foods each one rules out. A plan built with allergies (buildPlan, macroLists) leaves these
  // out of every sample meal, option, list and swap: a meal that can't do without one is dropped, and a food it can
  // do without is left out of it. (Oats count as gluten: most aren't certified gluten-free.)
  const ALLERGIES = {
    peanut: { label: "Peanuts", foods: ["pb", "nuts", "zone"] },
    treenut: { label: "Tree nuts", foods: ["almonds", "nuts", "almondbutter", "almondmilk", "granola"] },
    fish: { label: "Fish", foods: ["salmon", "tilapia", "cod", "mahi", "tuna"] },
    shellfish: { label: "Shellfish", foods: ["shrimp"] },
    dairy: { label: "Dairy", foods: ["milk", "greek", "cottage", "cheese", "stringcheese", "whey", "chocmilk", "zone"] },
    egg: { label: "Eggs", foods: ["eggs", "whites"] },
    gluten: { label: "Gluten / wheat", foods: ["bread", "bagel", "pasta", "wwpasta", "couscous", "granola", "tortilla", "oats", "jerky", "zone"] },
    soy: { label: "Soy", foods: ["jerky", "zone"] },
    sesame: { label: "Sesame", foods: [] },
  };
  const ALLERGY_KEYS = Object.keys(ALLERGIES);
  const allergensOf = (key) => ALLERGY_KEYS.filter((a) => ALLERGIES[a].foods.includes(key));
  let BANNED = new Set(); // the foods ruled out while a plan is being built
  const allowed = (key) => !BANNED.has(key);
  // runs fn with the foods those allergies rule out left out
  const withAllergies = (allergies, fn) => {
    const prev = BANNED;
    BANNED = new Set((allergies || []).flatMap((a) => (ALLERGIES[a] ? ALLERGIES[a].foods : [])));
    try { return fn(); } finally { BANNED = prev; }
  };

  const MAIN_PROTEINS = ["chicken", "turkey", "gturkey", "gbeef", "sirloin", "tenderloin", "pork", "salmon", "tilapia", "cod", "mahi", "shrimp"];
  const MAIN_STARCHES = ["rice", "brownrice", "pasta", "wwpasta", "quinoa", "couscous", "sweetpotato", "redpotato"];
  const MAIN_VEG = ["broccoli", "greenbeans", "carrots", "asparagus", "cauliflower", "spinach", "brussels", "zucchini"];
  const MAIN_FRUIT = ["apple", "banana", "orange", "pear", "strawberries", "blueberries", "blackberries", "raspberries", "pineapple", "grapes", "cantaloupe", "mango"];
  const BERRIES = ["strawberries", "blueberries", "blackberries", "raspberries"];

  // ---- goals (Galpin's ranges, g/kg body weight) ------------------------------------------------------
  const GOALS = {
    gain: { label: "Gain lean muscle", pct: 10, protein: 2.2, fat: 0.9, train: [5, 7], rest: [4, 5] },
    lose: { label: "Lose body fat", pct: -15, protein: 2.3, fat: 0.8, train: [3, 4], rest: [3, 3.5] },
    recomp: { label: "Recomp / performance", pct: 0, protein: 2.1, fat: 0.9, train: [4, 5], rest: [3, 4] },
  };
  const GOAL_KEYS = ["gain", "lose", "recomp"];

  // the day spread over the meals: each meal's share of the day's carbohydrate, protein and fat (each column adds to 1).
  // Lunch and dinner carry the most protein (the protein-centered plates of the DST rotation); carbohydrate is weighted to
  // breakfast, the snacks and the post-workout shake, which is kept low in fat so it absorbs fast.
  const SLOTS = [
    { key: "breakfast", name: "Breakfast", time: "6:00a" },
    { key: "snack1", name: "Mid-Morning Snack", time: "10:00a" },
    { key: "lunch", name: "Lunch", time: "12:00p" },
    { key: "snack2", name: "Mid-Afternoon Snack", time: "3:00p" },
    { key: "dinner", name: "Dinner", time: "6:00p" },
    { key: "post", name: "Post-Workout Shake", time: "After training" },
  ];
  const SPLIT = {
    train: { breakfast: [0.22, 0.20, 0.25], snack1: [0.12, 0.08, 0.15], lunch: [0.18, 0.27, 0.20], snack2: [0.12, 0.08, 0.15], dinner: [0.16, 0.27, 0.22], post: [0.20, 0.10, 0.03] },
    rest: { breakfast: [0.24, 0.20, 0.25], snack1: [0.14, 0.10, 0.15], lunch: [0.22, 0.30, 0.22], snack2: [0.14, 0.10, 0.16], dinner: [0.26, 0.30, 0.22] },
  };

  // ---- small helpers ---------------------------------------------------------------------------------
  const num = (v) => { const x = parseFloat(v); return Number.isFinite(x) ? x : null; };
  const round = (v) => Math.round(v);
  const kcalOf = (m) => m.c * 4 + m.p * 4 + m.f * 9;
  // seeded random numbers, so a plan shows the same examples until Shuffle is pressed
  const rngOf = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  // a random one of the list, leaving out any food an allergy rules out (if every one is, the first: the meal using it is dropped)
  const pick = (rng, list) => { const ok = list.filter((k) => typeof k !== "string" || allowed(k)); const from = ok.length ? ok : list; return from[Math.floor(rng() * from.length)]; };
  const shuffled = (rng, list) => { const a = list.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; };
  // a list handed out in a random order, reshuffled each time round, never the same twice in a row
  const cycler = (rng, list) => {
    let order = [], last = null;
    return () => {
      if (!order.length) { order = shuffled(rng, list); if (order[0] === last && order.length > 1) order.push(order.shift()); }
      last = order.shift();
      return last;
    };
  };

  const FRAC = { 0: "", 0.25: "¼", 0.5: "½", 0.75: "¾" };
  const qty = (a) => { const w = Math.floor(a + 1e-9), r = Math.round((a - w) * 4) / 4; const s = (w ? String(w) : "") + (FRAC[r] || ""); return s || "0"; };
  const plural = (f, a) => (a > 1 ? f.pl || `${f.name}s` : f.name);
  function itemText(it) {
    const f = it.food, a = it.amt, q = qty(a);
    if (f.unit === "oz") return `${q} oz ${f.name}`;
    if (f.unit === "cup") return `${q} C. ${f.name}`;
    if (f.unit === "tsp" && a >= 3 && a % 3 === 0) return `${qty(a / 3)} tbsp ${f.name}`;
    if (f.unit === "tbsp" || f.unit === "tsp") return `${q} ${f.unit} ${f.name}`;
    if (f.unit === "scoop") return `${q} ${a > 1 ? "Scoops" : "Scoop"} ${f.name}`;
    if (f.unit === "slice") return `${q} ${a > 1 ? "Slices" : "Slice"} ${f.name}`;
    return `${q} ${plural(f, a)}`;
  }
  const totalsOf = (items) => items.reduce((t, it) => ({ kcal: t.kcal + it.food.kcal * it.amt, c: t.c + it.food.c * it.amt, p: t.p + it.food.p * it.amt, f: t.f + it.food.f * it.amt }), { kcal: 0, c: 0, p: 0, f: 0 });

  // ---- portions --------------------------------------------------------------------------------------
  // A meal is a list of parts. "fixed" parts have a set amount; a "protein", "carb" or "fat" part is sized to the
  // meal's target for that macro, after whatever the other parts bring (worked over a few rounds, since chicken has a
  // little fat and rice a little protein). Amounts are then rounded to the food's step; an optional part that comes to
  // nothing is left out.
  const MACRO = { protein: "p", carb: "c", fat: "f" };
  function solve(target, parts) {
    const amt = parts.map((x) => (x.role === "fixed" ? x.amt : 0));
    for (let round_ = 0; round_ < 6; round_++) {
      ["protein", "carb", "fat"].forEach((role) => {
        const m = MACRO[role];
        const mine = parts.map((x, i) => (x.role === role ? i : -1)).filter((i) => i >= 0);
        if (!mine.length) return;
        let need = target[m] - parts.reduce((s, x, i) => s + (mine.includes(i) ? 0 : amt[i] * x.food[m]), 0);
        mine.forEach((i) => {
          const x = parts[i], per = x.food[m] || 0.0001;
          const a = Math.max(0, Math.min(x.max != null ? x.max : x.food.max, need / per));
          amt[i] = a;
          need -= a * per;
        });
      });
    }
    const items = parts.map((x, i) => {
      const step = x.food.step;
      if (x.role === "fixed") return { food: x.food, amt: x.amt };
      let a = Math.round(amt[i] / step) * step;
      const min = x.min != null ? x.min : x.opt ? 0 : x.food.min || step;
      if (a < min) a = x.opt && amt[i] < min / 2 ? 0 : min;
      return { food: x.food, amt: a };
    }).filter((it) => it.amt > 0);
    return { items, tot: totalsOf(items) };
  }
  const part = (key, role, more) => Object.assign({ food: FOODS[key], role, banned: !allowed(key) }, more || {});

  // lunch and dinner, as on the DST rotation: a protein, a starch, a vegetable and a fruit (a little oil when the
  // protein is lean and the meal still needs fat). Bigger meals get more vegetables and a whole fruit.
  function mainMeal(target, keys) {
    const kcal = kcalOf(target);
    const veg = kcal < 600 ? 1 : kcal < 850 ? 1.5 : 2;
    const fruitFood = FOODS[keys.fruit];
    const fruit = kcal < 650 ? (fruitFood.unit === "cup" ? 0.5 : 0.5) : 1;
    return solve(target, [
      part(keys.protein, "protein"), part(keys.starch, "carb"),
      part(keys.veg, "fixed", { amt: veg }), part(keys.fruit, "fixed", { amt: fruit }),
      part(keys.fat || "oliveoil", "fat", { opt: true }),
    ]);
  }
  const BREAKFASTS = [
    { name: "DST Shake", parts: (rng) => [part("whey", "protein"), part("oats", "carb"), part("banana", "fixed", { amt: 0.5 }), part("pb", "fat", { opt: true }), part(pick(rng, ["milk", "almondmilk"]), "fixed", { amt: 1 })], note: "Blend with 1½ C. ice" },
    { name: "Egg Scramble", parts: (rng) => [part("eggs", "fat"), part(pick(rng, ["ham", "dturkey"]), "protein", { opt: true }), part(pick(rng, ["bellpepper", "spinach"]), "fixed", { amt: 1 }), part(pick(rng, ["bread", "oats", "bagel"]), "carb"), part(pick(rng, BERRIES), "carb", { min: 0.5 })] },
    { name: "Yogurt Bowl", parts: (rng) => [part("greek", "protein"), part("granola", "carb"), part(pick(rng, BERRIES), "fixed", { amt: 1 }), part("almonds", "fat", { opt: true })] },
    { name: "Protein Oatmeal", parts: (rng) => [part("oats", "carb"), part("whey", "protein"), part("banana", "fixed", { amt: 0.5 }), part(pick(rng, ["pb", "almondbutter"]), "fat", { opt: true })] },
  ];
  const SNACKS = [
    { name: "Bar & Fruit", parts: (rng) => [part("zone", "fixed", { amt: 1 }), part(pick(rng, ["orange", "apple", "banana"]), "carb", { min: 0.5 }), part("ricecakes", "carb", { opt: true })] },
    { name: "Fruit & Nuts", parts: (rng) => [part("apple", "carb", { min: 0.5 }), part(pick(rng, ["almonds", "nuts"]), "fat", { min: 0.5 }), part("jerky", "protein", { opt: true })] },
    { name: "Turkey Sandwich", parts: (rng) => [part("bread", "carb", { min: 2 }), part(pick(rng, ["dturkey", "ham", "roastbeef"]), "protein", { min: 2 }), part("cheese", "fat", { opt: true })] },
    { name: "Yogurt & Berries", parts: (rng) => [part("greek", "protein"), part(pick(rng, ["blueberries", "strawberries", "raspberries"]), "carb", { min: 0.5, max: 1.5 }), part("granola", "carb", { opt: true }), part("almonds", "fat", { opt: true })] },
    { name: "Cottage Cheese & Pineapple", parts: () => [part("cottage", "protein"), part("pineapple", "carb"), part("granola", "carb", { opt: true }), part("almonds", "fat", { opt: true })] },
    { name: "Eggs & Fruit", parts: (rng) => [part("eggs", "protein", { max: 4 }), part(pick(rng, ["orange", "apple", "banana", "grapes"]), "carb", { min: 0.5 }), part("ricecakes", "carb", { opt: true })] },
  ];
  const POST = { name: "Post-Workout Shake", parts: () => [part("whey", "protein"), part("banana", "carb", { min: 0.5 }), part("oats", "carb", { opt: true, max: 0.75 }), part("honey", "carb", { opt: true }), part("milk", "fixed", { amt: 1 })] };
  // a template sized to a meal; null when it needs a food an allergy rules out (one it can do without is left out)
  const templated = (target, tpl, rng) => {
    const parts = tpl.parts(rng);
    if (parts.some((p) => p.banned && !p.opt)) return null;
    return Object.assign({ name: tpl.name, note: tpl.note }, solve(target, parts.filter((p) => !p.banned)));
  };
  // the first of the templates (from a starting place) that can be made, for the rotation
  const firstMade = (target, tpls, start, rng) => { for (let i = 0; i < tpls.length; i++) { const m = templated(target, tpls[(start + i) % tpls.length], rng); if (m && m.items.length) return m; } return null; };

  // ---- meal options: alternatives for each meal, sized to that meal's targets ----------------------------
  // The athlete taps a meal in the app and picks from these (shakes and whole-food breakfasts; bars, fruit and nuts,
  // yogurt and sandwiches for snacks; plates, bowls, wraps, pasta and stir fry for lunch and dinner). The templates
  // above are among them; these are added to them, so the example rotation itself is unchanged.
  const MORE_BREAKFASTS = [
    { name: "Breakfast Sandwich", parts: (rng) => [part("bagel", "carb", { min: 0.5 }), part("eggs", "fat"), part(pick(rng, ["ham", "dturkey"]), "protein", { opt: true }), part(pick(rng, ["orange", "apple", "banana"]), "carb", { opt: true })] },
    { name: "Overnight Oats", parts: (rng) => [part("oats", "carb"), part("greek", "protein"), part("milk", "fixed", { amt: 0.5 }), part(pick(rng, BERRIES), "carb", { min: 0.5 }), part("almonds", "fat", { opt: true })], note: "Mix the night before and refrigerate" },
    { name: "Sweet Potato Hash", parts: () => [part("sweetpotato", "carb"), part("eggs", "fat"), part("gturkey", "protein", { opt: true }), part("bellpepper", "fixed", { amt: 1 }), part("onion", "fixed", { amt: 0.25 }), part("bread", "carb", { opt: true })] },
    { name: "Bagel, PB & Chocolate Milk", parts: () => [part("bagel", "carb", { min: 0.5 }), part("chocmilk", "protein", { min: 1, max: 2 }), part("pb", "fat", { opt: true })] },
    // without eggs, dairy or gluten (and fine for everyone)
    { name: "Turkey & Sweet Potato Hash", parts: (rng) => [part("gturkey", "protein"), part("sweetpotato", "carb"), part("bellpepper", "fixed", { amt: 1 }), part("onion", "fixed", { amt: 0.25 }), part(pick(rng, BERRIES), "carb", { opt: true }), part("oliveoil", "fat", { opt: true })] },
    { name: "Breakfast Rice Bowl", parts: (rng) => [part(pick(rng, ["gturkey", "chicken"]), "protein"), part("rice", "carb"), part("blackbeans", "fixed", { amt: 0.25 }), part("bellpepper", "fixed", { amt: 0.5 }), part("avocado", "fat", { opt: true }), part(pick(rng, ["orange", "banana"]), "carb", { opt: true })] },
    { name: "Plant Protein Smoothie", parts: (rng) => [part("plantprotein", "protein"), part("banana", "carb", { min: 0.5, max: 1.5 }), part(pick(rng, BERRIES), "carb", { opt: true }), part("oats", "carb", { opt: true, max: 0.5 }), part("almondmilk", "fixed", { amt: 1, opt: true }), part("almondbutter", "fat", { opt: true })], note: "Blend with ice" },
  ];
  const MORE_SNACKS = [
    { name: "Chocolate Milk & Banana", parts: () => [part("chocmilk", "protein", { min: 1, max: 2 }), part("banana", "carb", { opt: true })] },
    { name: "PB & Banana Toast", parts: () => [part("bread", "carb", { min: 1, max: 3 }), part("pb", "fat", { min: 0.5 }), part("banana", "fixed", { amt: 0.5 }), part("stringcheese", "protein", { opt: true })] },
    { name: "Jerky & Mixed Nuts", parts: (rng) => [part("jerky", "protein"), part("nuts", "fat", { min: 0.5 }), part(pick(rng, ["apple", "orange"]), "carb", { opt: true }), part("ricecakes", "carb", { opt: true })] },
    { name: "Turkey & Rice Cakes", parts: (rng) => [part("dturkey", "protein", { min: 2 }), part("ricecakes", "carb"), part(pick(rng, ["apple", "grapes", "orange", "banana"]), "carb", { opt: true }), part("avocado", "fat", { opt: true })] },
    { name: "Turkey Roll-Ups & Fruit", parts: (rng) => [part("dturkey", "protein", { min: 2 }), part(pick(rng, ["apple", "pear", "grapes"]), "carb", { min: 0.5 }), part("ricecakes", "carb", { opt: true }), part("avocado", "fat", { opt: true })] },
    { name: "Tuna & Rice Cakes", parts: (rng) => [part("tuna", "protein"), part("ricecakes", "carb"), part(pick(rng, ["apple", "grapes", "orange"]), "carb", { opt: true }), part("cucumber", "fixed", { amt: 0.5 }), part("avocado", "fat", { opt: true })] },
  ];
  const MORE_POST = [
    { name: "Chocolate Milk", parts: () => [part("chocmilk", "carb", { min: 1, max: 2 }), part("banana", "carb", { opt: true }), part("whey", "protein", { opt: true })] },
    { name: "Recovery Smoothie", parts: (rng) => [part("whey", "protein"), part("banana", "carb", { min: 0.5, max: 1 }), part(pick(rng, ["strawberries", "blueberries", "pineapple"]), "carb", { opt: true }), part("almondmilk", "fixed", { amt: 1, opt: true }), part("honey", "carb", { opt: true })], note: "Blend with ice" },
    { name: "Plant Protein Shake", parts: (rng) => [part("plantprotein", "protein"), part("banana", "carb", { min: 0.5, max: 2 }), part(pick(rng, ["strawberries", "blueberries", "pineapple", "mango"]), "carb", { opt: true }), part("honey", "carb", { opt: true })], note: "Blend with water and ice" },
    { name: "Rice Cakes, Banana & Honey", parts: () => [part("ricecakes", "carb", { min: 2 }), part("banana", "carb", { min: 0.5 }), part("honey", "carb", { opt: true }), part("dturkey", "protein", { opt: true })] },
    { name: "Yogurt & Fruit", parts: (rng) => [part("greek", "protein"), part(pick(rng, ["banana", "pineapple", "mango"]), "carb", { min: 0.5 }), part("honey", "carb", { opt: true }), part("granola", "carb", { opt: true })] },
  ];
  // lunch and dinner beyond the plate: the DST salad, and bowls, wraps, pasta and stir fry
  // From the DST high school meal rotation: grab-and-go breakfasts for school mornings, and lunches that pack cold
  // for school (an insulated bag and an ice pack). With "packed school lunches" on, the rotation's Monday to Friday
  // breakfasts and lunches come from these; they're among every athlete's options either way.
  const GRAB_AND_GO = [
    { name: "Egg & Turkey Breakfast Sandwich", parts: (rng) => [part("bread", "carb", { min: 2, max: 4 }), part("eggs", "fat", { min: 1, max: 3 }), part(pick(rng, ["dturkey", "ham"]), "protein", { min: 2 }), part(pick(rng, ["strawberries", "blueberries", "orange"]), "carb", { opt: true }), part("banana", "carb", { opt: true })] },
    { name: "Peanut Butter Banana Toast", parts: () => [part("bread", "carb", { min: 2, max: 4 }), part("banana", "carb", { min: 1, max: 2 }), part("pb", "fat", { min: 0.5 }), part("eggs", "protein", { opt: true, max: 3 }), part("almondmilk", "fixed", { amt: 1 })] },
    { name: "Eggs, Toast & Fruit", parts: (rng) => [part("eggs", "fat", { min: 2 }), part("bread", "carb", { min: 1, max: 4 }), part(pick(rng, ["strawberries", "cantaloupe", "pineapple"]), "carb", { opt: true }), part("banana", "carb", { opt: true }), part("dturkey", "protein", { opt: true })] },
    { name: "Oatmeal & Hard-Boiled Eggs", parts: (rng) => [part("oats", "carb"), part("eggs", "protein", { max: 3 }), part(pick(rng, BERRIES), "carb", { opt: true })] },
    { name: "Bar, Nuts & Fruit", parts: (rng) => [part("zone", "fixed", { amt: 1 }), part(pick(rng, ["cantaloupe", "apple", "orange"]), "carb", { opt: true }), part("banana", "carb", { opt: true }), part("oats", "carb", { opt: true, max: 0.75 }), part("nuts", "fat", { opt: true }), part("whey", "protein", { opt: true })], note: "Oats as overnight oats or in a shake" },
  ];
  const PACKED_NOTE = "Packs cold for school";
  const PACKING_TIPS = [
    "Use an insulated bag with an ice pack for meat and egg lunches",
    "Pack sandwich vegetables and fruit separately so nothing gets soggy",
    "Rice bowls and pasta salads can be eaten cold, or microwaved if the school has one",
    "School mornings: keep breakfast quick (a breakfast sandwich, PB banana toast, oatmeal with eggs, or a shake)",
    "Add a snack or a shake around practice when you need more",
  ];
  const PACKED_LUNCHES = [
    { name: "Deli Sandwich", note: PACKED_NOTE, parts: (rng) => [part("bread", "carb", { min: 2, max: 4 }), part(pick(rng, ["dturkey", "ham", "roastbeef"]), "protein", { min: 2 }), part(pick(rng, ["carrots", "broccoli"]), "fixed", { amt: 1 }), part(pick(rng, ["apple", "orange", "banana"]), "carb", { opt: true }), part("cheese", "fat", { opt: true })] },
    { name: "Cold Chicken Pasta Salad", note: PACKED_NOTE, parts: (rng) => [part("chicken", "protein"), part("wwpasta", "carb"), part(pick(rng, ["broccoli", "carrots"]), "fixed", { amt: 1 }), part(pick(rng, ["apple", "orange"]), "carb", { opt: true }), part("dressing", "fat", { opt: true })] },
    { name: "Roast Beef Pasta Salad", note: PACKED_NOTE, parts: (rng) => [part("roastbeef", "protein", { min: 3 }), part("wwpasta", "carb"), part("broccoli", "fixed", { amt: 1 }), part(pick(rng, ["apple", "orange"]), "carb", { opt: true }), part("dressing", "fat", { opt: true })] },
    { name: "Chicken Rice Bowl", note: PACKED_NOTE, parts: (rng) => [part("chicken", "protein"), part(pick(rng, ["brownrice", "rice"]), "carb"), part("greenbeans", "fixed", { amt: 1 }), part(pick(rng, ["orange", "apple"]), "carb", { opt: true }), part("oliveoil", "fat", { opt: true })] },
    { name: "Chicken & Potato Bowl", note: PACKED_NOTE, parts: (rng) => [part("chicken", "protein"), part("redpotato", "carb"), part("greenbeans", "fixed", { amt: 1 }), part(pick(rng, ["orange", "apple"]), "carb", { opt: true }), part("oliveoil", "fat", { opt: true })] },
    { name: "Turkey Roll-Ups", note: PACKED_NOTE, parts: (rng) => [part("dturkey", "protein", { min: 3 }), part(pick(rng, ["sweetpotato", "redpotato"]), "carb"), part("carrots", "fixed", { amt: 1 }), part(pick(rng, ["orange", "apple"]), "carb", { opt: true }), part("cheese", "fat", { opt: true })] },
  ];
  const MAIN_CHOICES = [
    { name: "Salad Bowl", parts: (rng) => [part("greens", "fixed", { amt: 2 }), part(pick(rng, ["salmon", "chicken", "tuna", "shrimp"]), "protein"), part("chickpeas", "carb"), part("cucumber", "fixed", { amt: 0.5 }), part("carrots", "fixed", { amt: 0.5 }), part("onion", "fixed", { amt: 0.25 }), part("eggs", "fixed", { amt: 1 }), part("dressing", "fat", { opt: true }), part("bread", "carb", { opt: true })] },
    { name: "Burrito Bowl", parts: (rng) => [part(pick(rng, ["rice", "brownrice"]), "carb"), part("blackbeans", "fixed", { amt: 0.5 }), part(pick(rng, ["chicken", "gturkey", "gbeef", "sirloin"]), "protein"), part("bellpepper", "fixed", { amt: 1 }), part("avocado", "fat", { opt: true })] },
    { name: "Wrap", parts: (rng) => [part("tortilla", "carb", { min: 1, max: 3 }), part(pick(rng, ["chicken", "dturkey", "turkey"]), "protein"), part("greens", "fixed", { amt: 1 }), part("cheese", "fat", { opt: true }), part(pick(rng, ["apple", "orange", "grapes"]), "carb", { opt: true })] },
    { name: "Pasta Bowl", parts: (rng) => [part(pick(rng, ["pasta", "wwpasta"]), "carb"), part("marinara", "fixed", { amt: 0.5 }), part(pick(rng, ["gturkey", "gbeef", "chicken"]), "protein"), part(pick(rng, ["spinach", "zucchini", "mushrooms"]), "fixed", { amt: 1 }), part("oliveoil", "fat", { opt: true })] },
    { name: "Stir Fry", parts: (rng) => [part(pick(rng, ["rice", "brownrice", "quinoa"]), "carb"), part(pick(rng, ["chicken", "shrimp", "sirloin", "pork"]), "protein"), part("broccoli", "fixed", { amt: 1 }), part("bellpepper", "fixed", { amt: 1 }), part("oliveoil", "fat", { opt: true })] },
  ];
  // how far a meal is from its targets: calories counted once, and the three macros between them once more
  const missBy = (t, target) => {
    const tk = kcalOf(target) || 1;
    return Math.abs(t.kcal - tk) / tk + (Math.abs(t.p - target.p) / Math.max(target.p, 1) + Math.abs(t.c - target.c) / Math.max(target.c, 1) + Math.abs(t.f - target.f) / Math.max(target.f, 1)) / 3;
  };
  const hashOf = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };
  // every meal's options, training and rest day, closest to the meal's targets first
  function mealChoices(T, seed) {
    const out = {};
    const build = (meals, dayKey) => meals.forEach((m) => {
      const rng = rngOf((seed + hashOf(`${m.key}|${dayKey}`)) >>> 0);
      let list;
      if (m.key === "lunch" || m.key === "dinner") {
        // four plates with different proteins, starches, vegetables and fruit, then the bowls, wrap, pasta and stir fry
        const proteins = shuffled(rng, MAIN_PROTEINS.filter(allowed)), starches = shuffled(rng, MAIN_STARCHES.filter(allowed)), veg = shuffled(rng, MAIN_VEG.filter(allowed)), fruit = shuffled(rng, MAIN_FRUIT.filter(allowed));
        const plates = [0, 1, 2, 3].filter((i) => proteins[i] && starches.length).map((i) => Object.assign({ name: `${FOODS[proteins[i]].name} Plate` }, mainMeal(m.target, { protein: proteins[i], starch: starches[i % starches.length], veg: veg[i % veg.length], fruit: fruit[i % fruit.length] })));
        list = plates.concat((m.key === "lunch" ? PACKED_LUNCHES : []).concat(MAIN_CHOICES).map((tpl) => templated(m.target, tpl, rng)));
      } else {
        const tpls = m.key === "breakfast" ? BREAKFASTS.concat(MORE_BREAKFASTS, GRAB_AND_GO) : m.key === "post" ? [POST].concat(MORE_POST) : SNACKS.concat(MORE_SNACKS);
        list = tpls.map((tpl) => templated(m.target, tpl, rng));
      }
      list = list.filter((x) => x && x.items.length).sort((a, b) => missBy(a.tot, m.target) - missBy(b.tot, m.target));
      // only those within 15% of the meal's calories (kitchen-sized steps throw a small snack further off), and
      // never fewer than five
      const tk = kcalOf(m.target) || 1;
      const close = list.filter((x) => Math.abs(x.tot.kcal / tk - 1) <= 0.15);
      list = close.length >= 5 ? close : list.slice(0, 5);
      (out[m.name] = out[m.name] || {})[dayKey] = list;
    });
    build(T.trainMeals, "train");
    build(T.restMeals, "rest");
    return out;
  }

  // ---- targets ---------------------------------------------------------------------------------------
  const rmrOf = (kg, age, male) => (male
    ? (age < 18 ? 17.5 * kg + 651 : age < 30 ? 15.3 * kg + 679 : age < 60 ? 11.6 * kg + 879 : 13.5 * kg + 487)
    : (age < 18 ? 12.2 * kg + 746 : age < 30 ? 14.7 * kg + 496 : age < 60 ? 8.7 * kg + 829 : 10.5 * kg + 596));
  const ageOf = (athlete) => (typeof computeAge === "function" ? computeAge(athlete.dob) : null);

  // the body composition the plan is worked from: the latest complete manual sheet or Evolt scan, whichever is newer,
  // or without either, the details entered with the plan
  function basisFor(athlete, rec) {
    const store = window.AthleteStore;
    const sheets = (store.getBodyCompSheets(athlete.id) || []).filter((s) => s.inputs && s.summary && !s.summary.incomplete);
    const sheet = sheets[sheets.length - 1];
    const scans = (store.getBodyComp(athlete.id) || []).filter((s) => s.date && (s.weightLb != null || s.weightKg != null)).sort((a, b) => a.date.localeCompare(b.date));
    const scan = scans[scans.length - 1];
    if (sheet && window.BodyCompCalc && (!scan || sheet.date >= scan.date)) {
      const inputs = Object.assign({}, sheet.inputs);
      if (!num(inputs.age)) inputs.age = String(ageOf(athlete) || 25);
      const c = window.BodyCompCalc(inputs);
      return {
        source: "sheet", date: sheet.date, weightLb: c.cur.weight, kg: c.cur.massKg, pctFat: c.cur.pctFat, age: num(inputs.age), male: c.male,
        rmr: c.rmr, activity: c.dstEE + c.sportEE, trainMin: num(inputs.trainMin) || 0, sportMin: num(inputs.sportMin) || 0,
        typedCal: num(inputs.oTrainCal), goalKg: c.goalSet ? c.goal.massKg : null,
        wakeUp: inputs.wakeUp, lunchTime: inputs.lunchTime,
      };
    }
    if (scan) {
      const lb = scan.weightLb != null ? scan.weightLb : scan.weightKg * 2.20462;
      const kg = lb / 2.2, age = num(scan.age) || ageOf(athlete) || 25;
      const male = !/^f/i.test(String(scan.gender || athlete.gender || "M"));
      return {
        source: "evolt", date: scan.date, weightLb: lb, kg, pctFat: num(scan.bodyFatPct), age, male,
        rmr: rmrOf(kg, age, male), activity: (120 + 30) * kg * 0.075, trainMin: 120, sportMin: 30, typedCal: null, goalKg: null,
      };
    }
    // no body composition on file: the details the coach entered on the Nutrition tab (weight, age, sex, training),
    // worked out the same way as an Evolt scan. A scan or sheet added later takes over.
    const m = rec && rec.manual;
    if (m && num(m.weightLb)) {
      const lb = num(m.weightLb), kg = lb / 2.2, age = num(m.age) || ageOf(athlete) || 25;
      const male = !/^f/i.test(String(m.sex || athlete.gender || "M"));
      const trainMin = num(m.trainMin) != null ? num(m.trainMin) : 120, sportMin = num(m.sportMin) != null ? num(m.sportMin) : 30;
      return {
        source: "manual", date: m.date, weightLb: lb, kg, pctFat: num(m.bodyFatPct), age, male,
        rmr: rmrOf(kg, age, male), activity: (trainMin + sportMin) * kg * 0.075, trainMin, sportMin, typedCal: null, goalKg: null,
      };
    }
    return null;
  }
  const SOURCE_TEXT = { sheet: "body comp sheet", evolt: "Evolt scan" };

  // Without a body composition, the coach enters the basics here and the plan is built from them (saved with the plan)
  function ManualBasisForm({ athlete, rec, onDone }) {
    const m = (rec && rec.manual) || {};
    const [f, setF] = useState(() => ({
      weightLb: m.weightLb || "", age: m.age || String(ageOf(athlete) || ""), sex: m.sex || (/^f/i.test(athlete.gender || "") ? "F" : "M"),
      bodyFatPct: m.bodyFatPct || "", trainMin: m.trainMin != null ? m.trainMin : "120", sportMin: m.sportMin != null ? m.sportMin : "30",
      goal: (rec && rec.goal) || "",
    }));
    const set = (k) => (e) => { const v = e.target.value; setF((p) => Object.assign({}, p, { [k]: v })); };
    const box = (label, k, unit, extra) => (
      <label className="nut-field"><span>{label}</span><input type="number" step="any" inputMode="decimal" value={f[k]} onChange={set(k)} {...(extra || {})} />{unit ? <em>{unit}</em> : null}</label>
    );
    const ok = num(f.weightLb) > 0 && f.goal;
    const save = () => {
      savePlan(athlete, { goal: f.goal, manual: { weightLb: f.weightLb, age: f.age, sex: f.sex, bodyFatPct: f.bodyFatPct, trainMin: f.trainMin, sportMin: f.sportMin, date: new Date().toISOString().slice(0, 10) } });
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

  function targetsFor(basis, goalKey) {
    const g = GOALS[goalKey];
    const k = 1 + g.pct / 100;
    const trainCal = basis.typedCal || (k * (basis.rmr + basis.activity)) / (1 - 0.1 * k);
    const kg = basis.kg;
    const proteinKg = goalKey === "lose" && basis.goalKg ? basis.goalKg : kg; // fat loss: protein off the goal weight
    const p = g.protein * proteinKg, f = g.fat * kg;
    const trainC = Math.max(0, (trainCal - p * 4 - f * 9) / 4);
    const train = { c: trainC, p, f };
    // rest day: the goal's rest-day carbohydrate (the middle of its range), never above a training day's
    const restC = Math.min(trainC, ((g.rest[0] + g.rest[1]) / 2) * kg);
    const rest = { c: restC, p, f };
    const flags = [];
    const cKg = trainC / kg;
    if (cKg > g.train[1] + 0.05) flags.push(`Carbohydrate comes to ${cKg.toFixed(1)} g/kg on a training day, above the ${g.train[0]}–${g.train[1]} g/kg range for this goal. The calories are high for this goal: check the training minutes, or raise fat.`);
    if (cKg < g.train[0] - 0.05) flags.push(`Carbohydrate comes to ${cKg.toFixed(1)} g/kg on a training day, below the ${g.train[0]}–${g.train[1]} g/kg range for this goal. The calories are tight for it.`);
    const meals = (day, split) => SLOTS.filter((s) => split[s.key]).map((s) => {
      const [sc, sp, sf] = split[s.key];
      return Object.assign({}, s, { target: { c: day.c * sc, p: day.p * sp, f: day.f * sf } });
    });
    return { goal: g, goalKey, kg, proteinKg, train, rest, trainMeals: meals(train, SPLIT.train), restMeals: meals(rest, SPLIT.rest), flags };
  }

  // ---- the plan --------------------------------------------------------------------------------------
  // opts.school: packed school lunches and grab-and-go breakfasts Monday to Friday; opts.allergies: foods to leave out
  function buildPlan(T, seed, opts) { return withAllergies(opts && opts.allergies, () => buildPlanWith(T, seed, opts)); }
  function buildPlanWith(T, seed, opts) {
    const school = !!(opts && opts.school);
    const rng = rngOf(seed);
    const mealT = (key) => T.trainMeals.find((m) => m.key === key).target;
    const weeks = [0, 1].map((w) => {
      // like the DST rotation, each week works through a few foods (three proteins, three starches, three vegetables,
      // four fruits) so its grocery list stays short; the second week draws its own
      const few = (list, count) => cycler(rng, shuffled(rng, list).slice(0, count));
      const next = { protein: few(MAIN_PROTEINS.filter(allowed), 3), starch: few(MAIN_STARCHES.filter(allowed), 3), veg: few(MAIN_VEG.filter(allowed), 3), fruit: few(MAIN_FRUIT.filter(allowed), 4) };
      let lastBreakfast = null;
      const packed = cycler(rng, PACKED_LUNCHES), grab = cycler(rng, GRAB_AND_GO);
      return [0, 1, 2, 3, 4, 5, 6].map((d) => {
        const schoolDay = school && d < 5;
        let bi = Math.floor(rng() * BREAKFASTS.length);
        if (bi === lastBreakfast) bi = (bi + 1) % BREAKFASTS.length;
        lastBreakfast = bi;
        const s1 = Math.floor(rng() * SNACKS.length);
        let s2 = Math.floor(rng() * SNACKS.length);
        if (s2 === s1) s2 = (s2 + 1) % SNACKS.length;
        const main = (key) => Object.assign({ name: (SLOTS.find((s) => s.key === key) || { name: "Meal" }).name }, mainMeal(mealT(key), { protein: next.protein(), starch: next.starch(), veg: next.veg(), fruit: next.fruit() }));
        const day = {
          breakfast: (schoolDay ? firstMade(mealT("breakfast"), [grab()].concat(GRAB_AND_GO, BREAKFASTS), 0, rng) : firstMade(mealT("breakfast"), BREAKFASTS.concat(MORE_BREAKFASTS), bi, rng)) || main("breakfast"),
          snack1: firstMade(mealT("snack1"), SNACKS.concat(MORE_SNACKS), s1, rng) || main("snack1"),
          lunch: (schoolDay && firstMade(mealT("lunch"), [packed()].concat(PACKED_LUNCHES), 0, rng)) || main("lunch"),
          snack2: firstMade(mealT("snack2"), SNACKS.concat(MORE_SNACKS), s2, rng) || main("snack2"),
          dinner: d === 5 ? { cheat: true, name: "Cheat Meal", items: [], tot: Object.assign({ kcal: kcalOf(mealT("dinner")) }, mealT("dinner")) } : main("dinner"),
          post: firstMade(mealT("post"), [POST].concat(MORE_POST, SNACKS, MORE_SNACKS), 0, rng) || main("post"),
        };
        day.tot = SLOTS.reduce((t, s) => { const m = day[s.key].tot; return { kcal: t.kcal + m.kcal, c: t.c + m.c, p: t.p + m.p, f: t.f + m.f }; }, { kcal: 0, c: 0, p: 0, f: 0 });
        return day;
      });
    });
    // one of each breakfast, snack and shake, sized to this athlete (the options pages)
    const options = {
      breakfast: BREAKFASTS.map((tpl) => templated(mealT("breakfast"), tpl, rng)).filter(Boolean),
      snack: SNACKS.map((tpl) => templated(mealT("snack1"), tpl, rng)).filter(Boolean),
      post: firstMade(mealT("post"), [POST].concat(MORE_POST), 0, rng),
    };
    return { weeks, options, choices: mealChoices(T, seed), school, allergies: (opts && opts.allergies) || [] };
  }

  // the macro lists: for a lunch or dinner, the portion of each food that fills its place in the meal (the protein
  // with the meal's protein, the starch with what carbohydrate is left after a fruit and the vegetables), so the
  // athlete can build their own meals by picking one of each
  function macroLists(T, opts) { return withAllergies(opts && opts.allergies, () => macroListsWith(T)); }
  function macroListsWith(T) {
    const avg = (meals) => { const l = meals.find((m) => m.key === "lunch").target, d = meals.find((m) => m.key === "dinner").target; return { c: (l.c + d.c) / 2, p: (l.p + d.p) / 2, f: (l.f + d.f) / 2 }; };
    const sizes = (t) => {
      const kcal = kcalOf(t);
      const veg = kcal < 600 ? 1 : kcal < 850 ? 1.5 : 2;
      const fruitC = kcal < 650 ? 12 : 22; // about half a fruit, or a whole one
      const proteinNeed = Math.max(10, t.p - veg * 3 - 4); // the starch and vegetables bring a little protein
      const carbNeed = Math.max(10, t.c - veg * 9 - fruitC);
      return { veg, fruitC, proteinNeed, carbNeed };
    };
    const train = sizes(avg(T.trainMeals)), rest = sizes(avg(T.restMeals));
    const portion = (f, grams, macro) => { const a = Math.round(grams / f[macro] / f.step) * f.step; return Math.max(f.step, Math.min(f.max, a)); };
    const row = (key, macro, tg, rg) => { const f = FOODS[key]; return { food: f, train: portion(f, tg, macro), rest: portion(f, rg, macro) }; };
    return {
      protein: MAIN_PROTEINS.concat(["tuna"]).filter(allowed).map((k) => row(k, "p", train.proteinNeed, rest.proteinNeed)),
      starch: MAIN_STARCHES.concat(["blackbeans", "bread", "oats"]).filter(allowed).map((k) => row(k, "c", train.carbNeed, rest.carbNeed)),
      fruit: MAIN_FRUIT.filter(allowed).map((k) => row(k, "c", train.fruitC, rest.fruitC)),
      veg: MAIN_VEG.concat(["peas", "greens", "bellpepper"]).filter(allowed).map((k) => { const f = FOODS[k]; const a = k === "peas" ? 0.5 : k === "greens" ? 2 : k === "bellpepper" ? 1 : null; return { food: f, train: a || train.veg, rest: a || rest.veg }; }),
      fat: ["oliveoil", "avocado", "pb", "almondbutter", "almonds", "nuts", "cheese", "dressing"].filter(allowed).map((k) => { const f = FOODS[k]; const a = Math.max(f.step, Math.round(9 / f.f / f.step) * f.step); return { food: f, train: a, rest: a }; }),
    };
  }

  // the week's shopping, from the example rotation
  const CAT_GROUP = { protein: "Protein", deli: "Protein", starch: "Carbohydrate", fruit: "Fruit", veg: "Vegetable", dairy: "Dairy & Misc", fat: "Dairy & Misc", bar: "Dairy & Misc" };
  const GROUPS = ["Protein", "Carbohydrate", "Fruit", "Vegetable", "Dairy & Misc"];
  function groceryList(week) {
    const byFood = {};
    week.forEach((day) => SLOTS.forEach((s) => (day[s.key].items || []).forEach((it) => {
      const g = byFood[it.food.key] || (byFood[it.food.key] = { food: it.food, total: 0, amts: {} });
      g.total += it.amt;
      g.amts[it.amt] = (g.amts[it.amt] || 0) + 1;
    })));
    const list = Object.values(byFood).map((g) => {
      const serving = Number(Object.keys(g.amts).sort((a, b) => g.amts[b] - g.amts[a])[0]);
      return Object.assign(g, { serving, group: CAT_GROUP[g.food.cat] || "Dairy & Misc" });
    });
    return GROUPS.map((name) => ({ name, items: list.filter((g) => g.group === name).sort((a, b) => a.food.name.localeCompare(b.food.name)) })).filter((g) => g.items.length);
  }
  // an amount on its own, for the lists that name the food in a column beside it
  const amountText = (food, a) => {
    const q = qty(a);
    if (food.unit === "oz") return `${q} oz`;
    if (food.unit === "cup") return `${q} C.`;
    if (food.unit === "tsp" && a >= 3 && a % 3 === 0) return `${qty(a / 3)} tbsp`;
    if (food.unit === "tbsp" || food.unit === "tsp") return `${q} ${food.unit}`;
    if (food.unit === "scoop") return `${q} ${a > 1 ? "scoops" : "scoop"}`;
    if (food.unit === "slice") return `${q} ${a > 1 ? "slices" : "slice"}`;
    return q;
  };

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
  const shareLine = (t) => { const k = kcalOf(t) || 1; return `${round((t.c * 4 * 100) / k)}% / ${round((t.p * 4 * 100) / k)}% / ${round((t.f * 9 * 100) / k)}%`; };
  const DAYS = ["MON", "TUE", "WED", "THUR", "FRI", "SAT", "SUN"];
  const shortDate = (k) => { const [y, m, d] = (k || "").split("-"); return y ? `${Number(m)}/${Number(d)}/${y.slice(2)}` : ""; };

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

  // The plan as the athlete's phone shows it (athlete.js, Nutrition): every figure worked out and every food written
  // out, so the app needs none of the sums or food lists. It is kept with the saved plan and handed to the athlete's
  // link by athlete_portal_nutrition (supabase/migration_022_athlete_portal_nutrition.sql).
  const sortedJson = (v) => (Array.isArray(v) ? `[${v.map(sortedJson).join(",")}]`
    : v && typeof v === "object" ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${sortedJson(v[k])}`).join(",")}}` : JSON.stringify(v));
  // for the phone's food log: the food lists ([name, unit, step, kcal, carbohydrate, protein, fat, plural, group, largest amount, allergies] by key),
  // and each meal's foods as [key, amount], so "Log this meal" can add them one by one
  const FOOD_TABLE = Object.fromEntries(Object.values(FOODS).map((f) => [f.key, [f.name, f.unit, f.step, f.kcal, f.c, f.p, f.f, f.pl || "", f.cat, f.max, allergensOf(f.key)]]));
  const partsOf = (m) => m.items.map((it) => [it.food.key, it.amt]);
  const r0 = (t) => ({ kcal: round(t.kcal != null ? t.kcal : kcalOf(t)), c: round(t.c), p: round(t.p), f: round(t.f) });
  function snapshotOf(basis, T, plan, lists, times) {
    const mealOut = (m) => (m.cheat ? { title: "Cheat Meal", cheat: true, items: [], tot: r0(m.tot) } : { title: m.name, items: m.items.map(itemText), parts: partsOf(m), note: m.note || "", tot: r0(m.tot) });
    return {
      v: 2, foods: FOOD_TABLE, school: !!plan.school, allergies: plan.allergies || [], packing: PACKING_TIPS, goal: T.goal.label, source: basis.source, date: basis.date, kg: Math.round(T.kg * 10) / 10,
      train: r0(T.train), rest: r0(T.rest),
      meals: SLOTS.map((s, i) => {
        const t = T.trainMeals.find((m) => m.key === s.key), r = T.restMeals.find((m) => m.key === s.key);
        return { name: s.name, time: times[i], train: r0(t.target), rest: r ? r0(r.target) : null };
      }),
      weeks: plan.weeks.map((week) => week.map((day, d) => ({ day: DAYS[d], meals: SLOTS.map((s) => Object.assign({ slot: s.name }, mealOut(day[s.key]))), tot: r0(day.tot) }))),
      lists: [["Protein", lists.protein], ["Carbohydrate", lists.starch], ["Fruit", lists.fruit], ["Vegetables", lists.veg], ["Add a fat (when a meal is low)", lists.fat]].map(([title, rows]) => ({
        title, same: rows.every((r) => r.train === r.rest), rows: rows.map((r) => [r.food.name, amountText(r.food, r.train), amountText(r.food, r.rest)]),
      })),
      options: [["Breakfast", plan.options.breakfast], ["Snacks", plan.options.snack], ["Post-workout", [plan.options.post].filter(Boolean)]].map(([group, meals]) => ({
        group, meals: meals.map((m) => ({ name: m.name, items: m.items.map(itemText), parts: partsOf(m), note: m.note || "", tot: r0(m.tot) })),
      })),
      // each meal's options by meal name, for a training day and a rest day
      choices: Object.fromEntries(Object.entries(plan.choices).map(([name, days]) => [name, Object.fromEntries(Object.entries(days).map(([d, list]) => [d,
        list.map((m) => ({ name: m.name, items: m.items.map(itemText), parts: partsOf(m), note: m.note || "", tot: r0(m.tot) }))]))])),
      grocery: plan.weeks.map((week) => groceryList(week).map((grp) => ({ group: grp.name, rows: grp.items.map((it) => [it.food.name, amountText(it.food, it.serving), amountText(it.food, it.total)]) }))),
    };
  }

  function NutritionTab({ athlete }) {
    useRefresh();
    const rec = planOf(athlete.id);
    const goalKey = rec && GOALS[rec.goal] ? rec.goal : "";
    const basis = basisFor(athlete, rec);
    const [editing, setEditing] = useState(false); // the entered details open for changing (a plan built without a body composition)
    const first = (athlete.name || "").split(/\s+/)[0] || athlete.name;
    const ready = !!(basis && goalKey);
    const T = ready ? targetsFor(basis, goalKey) : null;
    const allergies = allergiesOf(athlete.id);
    const plan = ready ? buildPlan(T, rec.seed || 1, { school: !!rec.schoolLunch, allergies }) : null;
    const lists = ready ? macroLists(T, { allergies }) : null;
    const times = SLOTS.map((s) => (basis && s.key === "breakfast" && basis.wakeUp ? basis.wakeUp : basis && s.key === "lunch" && basis.lunchTime ? basis.lunchTime : s.time));
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
            {basis.source === "manual" && !editing && <button type="button" className="btn btn-secondary" onClick={() => setEditing(true)}>Edit details</button>}
            <label className="nut-check-opt" title="For school days: Monday to Friday breakfasts are quick grab-and-go options and lunches pack cold for school">
              <input type="checkbox" checked={!!rec.schoolLunch} onChange={(e) => savePlan(athlete, { schoolLunch: e.target.checked })} />
              Packed school lunches (Mon–Fri)
            </label>
          </div>
          {basis.source === "manual" && editing && <ManualBasisForm athlete={athlete} rec={rec} onDone={() => setEditing(false)} />}
          <div className="nut-basis">
            {round(basis.weightLb)} lb ({basis.kg.toFixed(1)} kg){basis.pctFat != null ? ` · ${basis.pctFat.toFixed(1)}% body fat` : ""} ·
            resting {round(basis.rmr)} kcal · training {basis.trainMin} min + sport {basis.sportMin} min ≈ {round(basis.activity)} kcal ·
            {basis.typedCal ? " training-day calories as typed on the sheet" : ` ${g.pct > 0 ? "+" : ""}${g.pct}% for the goal`}
            {T.proteinKg !== T.kg ? ` · protein worked off the goal weight (${(T.proteinKg * 2.2).toFixed(0)} lb)` : ""}
          </div>
          <AllergyLine athlete={athlete} />
          <table className="nut-table nut-targets">
            <thead><tr><th></th><th>Calories</th><th>Protein</th><th>Carbohydrate</th><th>Fat</th><th>C / P / F</th></tr></thead>
            <tbody>
              {[["Training day", T.train], ["Rest day", T.rest]].map(([label, d]) => (
                <tr key={label}>
                  <td><b>{label}</b></td>
                  <td>{g0(kcalOf(d))}</td>
                  <td>{g0(d.p)} g <em>{perKg(d.p)} g/kg</em></td>
                  <td>{g0(d.c)} g <em>{perKg(d.c)} g/kg</em></td>
                  <td>{g0(d.f)} g <em>{perKg(d.f)} g/kg</em></td>
                  <td>{shareLine(d)}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
                    <td><b>{s.name}</b></td><td>{times[i]}</td>
                    <td>{macroLine(t.target)}</td>
                    <td>{r ? macroLine(r.target) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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
    const setForm = (k, v) => setEdit((e) => Object.assign({}, e, { form: Object.assign({}, e.form, { [k]: v }) }));
    const field = (k, label, type) => <label className="nut-field"><span>{label}</span><input type={type || "number"} step="any" value={edit.form[k]} onChange={(e) => setForm(k, e.target.value)} /></label>;
    const words = q.toLowerCase().trim();
    const shown = Array.isArray(rows) ? rows.filter((r) => !words || String(r.name || "").toLowerCase().includes(words)) : [];
    return (
      <details className="panel nut-library no-print" onToggle={(e) => { if (e.currentTarget.open && rows == null) load(); }}>
        <summary><b>Food library</b> <small>custom foods athletes and coaches have added, searched by everyone’s food log beside {(window.DSTFoodDB || []).length} built-in foods</small></summary>
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
                <thead><tr><th>Food</th><th>Serving</th><th>Calories</th><th>P / C / F</th><th>Added by</th><th></th></tr></thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.id}>
                      <td>{r.name}</td><td>{r.sAmt} {r.sUnit}</td><td>{r.kcal}</td><td>{r.p} / {r.c} / {r.f}</td><td>{r.addedBy || (r.source === "coach" ? "a coach" : "an athlete")}</td>
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
        const T = targetsFor(basis, rec.goal);
        const times = SLOTS.map((s) => (s.key === "breakfast" && basis.wakeUp ? basis.wakeUp : s.key === "lunch" && basis.lunchTime ? basis.lunchTime : s.time));
        const allergies = allergiesOf(a.id);
        const snap = snapshotOf(basis, T, buildPlan(T, rec.seed || 1, { school: !!rec.schoolLunch, allergies }), macroLists(T, { allergies }), times);
        if (sortedJson(rec.snapshot || null) !== sortedJson(JSON.parse(JSON.stringify(snap)))) savePlan(a, { snapshot: snap });
      } catch (e) { /* one athlete's plan that can't be worked out doesn't stop the rest */ }
    });
  }

  window.NutritionTab = NutritionTab;
  window.NutritionGoalPicker = NutritionGoalPicker;
  window.NutritionPlan = { FOODS, GOALS, basisFor, targetsFor, buildPlan, macroLists, solve, snapshotOf, SLOTS, refreshAll }; // refreshAll on load; the rest for checking the sums
})();
