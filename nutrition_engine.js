// Nutrition engine: the plan's sums and food lists, with no React and no page in mind, so both the dashboard
// (nutrition.js, the Nutrition tab) and the phone (athlete.js, where a coach sets a weight and a goal) build the same
// plan. Food lists, allergies, goals, portions, meal options, targets, the two-week rotation, the macro lists, the
// grocery list and the snapshot the phone shows. Everything is handed out as window.NutritionEngine.
//
// See nutrition.js for how the targets are worked out (Galpin's ranges and the DST packet).
(function () {
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

  // override: the targets a coach set on the Nutrition tab ({ train: { p, c, f }, rest: { p, c, f } } in grams), used in
  // place of the worked-out ones; the meals follow them like any other targets
  function targetsFor(basis, goalKey, override) {
    const g = GOALS[goalKey];
    const k = 1 + g.pct / 100;
    const trainCal = basis.typedCal || (k * (basis.rmr + basis.activity)) / (1 - 0.1 * k);
    const kg = basis.kg;
    const proteinKg = goalKey === "lose" && basis.goalKg ? basis.goalKg : kg; // fat loss: protein off the goal weight
    const p = g.protein * proteinKg, f = g.fat * kg;
    const trainC = Math.max(0, (trainCal - p * 4 - f * 9) / 4);
    let train = { c: trainC, p, f };
    // rest day: the goal's rest-day carbohydrate (the middle of its range), never above a training day's
    const restC = Math.min(trainC, ((g.rest[0] + g.rest[1]) / 2) * kg);
    let rest = { c: restC, p, f };
    const recommended = { train: Object.assign({}, train), rest: Object.assign({}, rest) };
    const set = (o) => (o && [o.p, o.c, o.f].every((v) => Number.isFinite(+v) && +v >= 0) ? { p: +o.p, c: +o.c, f: +o.f } : null);
    const custom = { train: set(override && override.train), rest: set(override && override.rest) };
    if (custom.train) Object.assign(train, custom.train);
    if (custom.rest) rest = custom.rest;
    const flags = [];
    const cKg = trainC / kg;
    if (cKg > g.train[1] + 0.05) flags.push(`Carbohydrate comes to ${cKg.toFixed(1)} g/kg on a training day, above the ${g.train[0]}–${g.train[1]} g/kg range for this goal. The calories are high for this goal: check the training minutes, or raise fat.`);
    if (cKg < g.train[0] - 0.05) flags.push(`Carbohydrate comes to ${cKg.toFixed(1)} g/kg on a training day, below the ${g.train[0]}–${g.train[1]} g/kg range for this goal. The calories are tight for it.`);
    const meals = (day, split) => SLOTS.filter((s) => split[s.key]).map((s) => {
      const [sc, sp, sf] = split[s.key];
      return Object.assign({}, s, { target: { c: day.c * sc, p: day.p * sp, f: day.f * sf } });
    });
    return { goal: g, goalKey, kg, proteinKg, train, rest, recommended, custom: !!(custom.train || custom.rest), trainMeals: meals(train, SPLIT.train), restMeals: meals(rest, SPLIT.rest), flags: custom.train ? [] : flags };
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

  // each meal's time of day: as the coach set it on Daily meal targets, or else breakfast at the wake-up and lunch at
  // the lunch time on the body comp sheet, or else the plan's usual times
  function mealTimes(basis, rec) {
    const set = (rec && rec.times) || {};
    return SLOTS.map((s) => (String(set[s.key] || "").trim()
      || (basis && s.key === "breakfast" && basis.wakeUp ? basis.wakeUp : basis && s.key === "lunch" && basis.lunchTime ? basis.lunchTime : s.time)));
  }
  const DAYS = ["MON", "TUE", "WED", "THUR", "FRI", "SAT", "SUN"];

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
  const BASIS_KEYS = ["source", "date", "weightLb", "kg", "pctFat", "age", "male", "rmr", "activity", "trainMin", "sportMin", "typedCal", "goalKg", "wakeUp", "lunchTime"];
  const basisOut = (b) => Object.fromEntries(BASIS_KEYS.filter((k) => b[k] !== undefined).map((k) => [k, typeof b[k] === "number" ? Math.round(b[k] * 1000) / 1000 : b[k]]));
  function snapshotOf(basis, T, plan, lists, times) {
    const mealOut = (m) => (m.cheat ? { title: "Cheat Meal", cheat: true, items: [], tot: r0(m.tot) } : { title: m.name, items: m.items.map(itemText), parts: partsOf(m), note: m.note || "", tot: r0(m.tot) });
    return {
      v: 2, foods: FOOD_TABLE, school: !!plan.school, allergies: plan.allergies || [], packing: PACKING_TIPS, goal: T.goal.label, goalKey: T.goalKey, source: basis.source, date: basis.date, kg: Math.round(T.kg * 10) / 10,
      // what the targets were worked out from, so the phone can work them out again for another goal (a coach in the app)
      basis: basisOut(basis),
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

  // the basis worked out from details entered by hand (weight, age, sex, body fat, training and sport minutes), the
  // same way as an Evolt scan; `lbNow` stands in for the weight (the weigh-ins since)
  function manualBasis(m, fallbackAge, fallbackSex, lbNow) {
    const lb = lbNow || num(m.weightLb), kg = lb / 2.2, age = num(m.age) || fallbackAge || 25;
    const male = !/^f/i.test(String(m.sex || fallbackSex || "M"));
    const trainMin = num(m.trainMin) != null ? num(m.trainMin) : 120, sportMin = num(m.sportMin) != null ? num(m.sportMin) : 30;
    return {
      source: "manual", date: m.date, weightLb: lb, kg, pctFat: num(m.bodyFatPct), age, male,
      rmr: rmrOf(kg, age, male), activity: (trainMin + sportMin) * kg * 0.075, trainMin, sportMin, typedCal: null, goalKg: null,
    };
  }

  window.NutritionEngine = { manualBasis, ALLERGIES, ALLERGY_KEYS, BANNED, BERRIES, BREAKFASTS, CAT_GROUP, DAYS, FOODS, FOOD_TABLE, FRAC, GOALS, GOAL_KEYS, GRAB_AND_GO, GROUPS, MACRO, MAIN_CHOICES, MAIN_FRUIT, MAIN_PROTEINS, MAIN_STARCHES, MAIN_VEG, MORE_BREAKFASTS, MORE_POST, MORE_SNACKS, PACKED_LUNCHES, PACKED_NOTE, PACKING_TIPS, POST, SLOTS, SNACKS, SPLIT, allergensOf, allowed, amountText, buildPlan, buildPlanWith, cycler, firstMade, food, groceryList, hashOf, itemText, kcalOf, macroLists, macroListsWith, mainMeal, mealChoices, mealTimes, missBy, num, part, partsOf, pick, plural, qty, r0, rmrOf, rngOf, round, shuffled, snapshotOf, solve, sortedJson, targetsFor, templated, totalsOf, withAllergies };
})();
