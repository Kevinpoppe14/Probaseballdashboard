// What's new: the additions coaches hear about in the weekly "What's new" email (api/weekly-features-email.js),
// newest first. Each entry is { date: "YYYY-MM-DD" (when it went live), area, title, detail } in plain words for
// a coach, not a developer. The email each Monday lists the entries from the seven days before it, grouped by
// area, and isn't sent at all in a week with none. Add an entry whenever something coaches or athletes will
// notice goes live. Plain JavaScript, usable from the dashboard (window.WHATS_NEW) and the email (require).
(function (root) {
  const AREAS = ["Phone app", "Program builder", "Coach Mode", "Dashboard"]; // the order they appear in the email

  const WHATS_NEW = [
    // ---- week of Oct 22-28, 2026 ----
    { date: "2026-10-28", area: "Dashboard", title: "Kyle Kleeman's NFL Intensification programs", detail: "Two new 3-week programs in Programs › Strength › NFL Intensification, one for linemen and one for skill players. Their Corrective lines pick from each athlete's own re-ed drills once the program is on a player's plan." },
    { date: "2026-10-28", area: "Program builder", title: "Re-Ed placeholders pick from the athlete's own drills", detail: "In a player's program, an exercise named Re-Ed, Corrective, Insert Re-Ed, Mobility Drill and the like gets a pick list of that player's re-ed drills, their current Re-Ed program first, or type in anything else. Choose this week only or every week after, and for more than one week the series opens across the weeks to set the sets and reps." },
    { date: "2026-10-28", area: "Dashboard", title: "What's new, in the top bar", detail: "Everything new in the dashboard, the program builder, Coach Mode and the athletes' app, week by week. A red dot shows when there's something you haven't seen, and the same list comes by email every Monday." },
    { date: "2026-10-28", area: "Program builder", title: "Table view is now the standard", detail: "Programs open as a spreadsheet: one row per exercise with Sets, Reps and Intensity cells. Tab, Enter and the arrow keys move between cells like Google Sheets. Boxes is still one click away, and your choice is remembered." },
    { date: "2026-10-28", area: "Program builder", title: "Copy and paste like a sheet", detail: "Drag across cells (or Shift+click) to highlight a block, then Ctrl+C, Ctrl+V, Ctrl+X or Delete. Rows copied from Google Sheets or Excel paste straight in, and a 1, 1, 2, 2 or A1, A2 column sets the supersets." },
    { date: "2026-10-28", area: "Program builder", title: "Color-coded blocks", detail: "A1, A2 and A3 share a color and an outline box, B gets the next color, and so on. Rows line up across the days, so every A2 sits level with the other days' A2." },
    { date: "2026-10-28", area: "Program builder", title: "Progress a day across the weeks", detail: "The green ↗ on a day (or a block) opens that day for every week side by side. Type in new sets, reps and percentages, or fill the later weeks in one step: same every week, intensity +2.5 / +5, reps -1 and more." },
    { date: "2026-10-28", area: "Program builder", title: "\"With sets 1–2\" for a changing partner", detail: "When the A2 exercise changes partway through A1's sets, keep A1 as one 4x5 and tag A2 \"with sets 1–2\" and A3 \"with sets 3–4\" instead of splitting it into A and B. The tissue compliance programs are already fixed this way." },
    { date: "2026-10-28", area: "Program builder", title: "Tempo, EDT and set weights", detail: "Tempo takes isos and ladders (*5* for a 5-second iso, 6-1 descending, 6-1-6 down and back up). EDT is its own setting with a minutes box. Intensity can be a weight: type 135 lb or 60 kg." },
    { date: "2026-10-28", area: "Program builder", title: "Add a column to every exercise at once", detail: "+ Column adds Tempo, Rest, Notes, Time, Distance, Speed or a box you name to a whole day (or every day of the week). A new day starts with just Sets, Reps and Intensity." },
    { date: "2026-10-28", area: "Program builder", title: "Re-Education programs", detail: "A new program type laid out in sections and series (Tissue Prep, Upper Body, Lower Body and Movement Re-Education) with sets, reps, a time and a weight for each drill. Build one from the Programs page." },
    { date: "2026-10-28", area: "Program builder", title: "Speed and throwing builders get the table too", detail: "Section titles in red tabs with the column titles under each one, every series boxed in its own color, undo and redo (Ctrl+Z), and copy and paste. Throwing days are colored by intensity: green Low, yellow Medium, red High." },
    { date: "2026-10-28", area: "Coach Mode", title: "Add a whole location at once", detail: "Pick a location (DST North, say) and tap + Add all to put everyone there on the board, then take off anyone who isn't in today." },
    { date: "2026-10-28", area: "Coach Mode", title: "Fold away the side bars", detail: "‹ Hide at the bottom of the athletes list, and the › at the top right for the day summary, give the program the whole screen. Coach Mode remembers what you closed." },
    { date: "2026-10-28", area: "Dashboard", title: "Refresh keeps your place", detail: "Reloading the page opens the same page, athlete, tab or program you were on, instead of starting over at the Team Overview." },
    { date: "2026-10-28", area: "Dashboard", title: "No more duplicate program copies", detail: "Editing a player's program no longer makes extra copies of it in the background." },
    { date: "2026-10-27", area: "Phone app", title: "Save or print the program and nutrition plan", detail: "Athletes can save their program (one day to a page, all its weeks across) and their nutrition plan (one section to a page) as a PDF, then share, save or print it from their phone." },
    { date: "2026-10-27", area: "Phone app", title: "Clearer prescriptions", detail: "Athletes see \"With sets 1–2\" on a changing superset partner, a set weight like \"135 lb\" beside the box, and tempos in place of notes on the iso work." },
    { date: "2026-10-27", area: "Phone app", title: "Water: type your own amount", detail: "Besides +8, +16 and the rest, an \"Other oz\" box takes any amount." },
    { date: "2026-10-27", area: "Dashboard", title: "Bigger food database", detail: "224 foods from the DST Food Database & Macro Tracker were added for the food log. A food a coach adds goes into everyone's database; one an athlete adds stays theirs." },
    { date: "2026-10-27", area: "Dashboard", title: "Kyle Kleeman's programs", detail: "His 10-week speed program and three strength programs are in the Programs library, listed as written by Kyle Kleeman." },
  ];

  const api = { WHATS_NEW, AREAS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.WhatsNew = api;
})(typeof window !== "undefined" ? window : this);
