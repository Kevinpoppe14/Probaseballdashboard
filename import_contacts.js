// Paste this entire file into the browser DevTools Console (F12) while the
// dashboard is open, then press Enter.
//
// For each row below it finds-or-creates an athlete by exact name match (so
// anyone already on the roster gets merged into, not duplicated) and fills in
// Position / Date of Birth / Gender / Email.
//
// Merge behavior is ADDITIVE ONLY: if the athlete already has a non-blank
// value for a field (e.g. you already set their Position via the dropdown),
// this script will NOT overwrite it — it only fills in fields that are
// currently blank. Anything skipped for that reason is logged to the console
// as a "kept existing value" note so you can review/override manually.
(function () {
  // [firstName, lastName, rawPosition, dob ("YYYY-MM-DD" or ""), gender, email]
  const ROWS = [
    ["Aaron", "Haase", "P", "", "male", "haase.aaron.11@gmail.com"],
    ["Adam", "Oller", "RHP", "1994-10-17", "male", "adam.oller35@gmail.com"],
    ["Adam", "Kloffenstein", "RHP", "2000-08-25", "male", "adamk3434@gmail.com"],
    ["Alec", "Bohm", "INF", "1996-08-03", "male", "abohm4@yahoo.com"],
    ["Alex", "Lange", "RHP", "1995-10-02", "male", "alexlange1002@gmail.com"],
    ["Alex", "Bregman", "3B", "1994-03-30", "male", "alexbregman02@gmail.com"],
    ["Alexander", "Johnson", "RH Pitcher", "2000-07-02", "male", "ahfoster2000@yahoo.com"],
    ["Austin", "Dean", "OF / 1B", "1993-10-14", "male", "ajdean355@gmail.com"],
    ["Austin", "Pruitt", "RHP", "1989-08-31", "male", "austinpruitt89@gmail.com"],
    ["Blaine", "Bullard", "", "2006-08-16", "male", "blainebullard@gmail.com"],
    ["Blake", "Holub", "RHP", "", "male", "blakeholub57@gmail.com"],
    ["Blake", "Mitchell", "C", "2004-08-03", "male", "blakemitchell25@yahoo.com"],
    ["Brandon", "Birdsell", "", "", "male", "brandon.birdsellrhp2018@gmail.com"],
    ["Braydon", "Fisher", "P", "", "", "braydonfisher11@gmail.com"],
    ["Brice", "Matthews", "SS", "2002-03-12", "male", "bricem03@icloud.com"],
    ["Bryan", "Warzek", "", "", "", "bwarzek13@gmail.com"],
    ["Bryce", "Tassin", "RHP", "1997-01-11", "male", "brycetassin@yahoo.com"],
    ["Cal", "Carver", "", "2000-07-28", "male", "cjcarver9@yahoo.com"],
    ["Cam", "Smith", "OF", "", "", "cameron.smith2413@gmail.com"],
    ["Carlos", "Correa", "SS", "1994-09-22", "male", "carlosjcorrea01@gmail.com"],
    ["Carson", "McCusker", "P", "1998-05-22", "male", "carsonmccusker@ymail.com"],
    ["Chuckie", "Robinson", "", "1994-12-14", "male", "chuckier123@yahoo.com"],
    ["Codi", "Heuer", "RHP", "1996-07-03", "male", "codiheuer@gmail.com"],
    ["Cody", "Poteet", "", "1994-07-30", "male", "codypoteet59@gmail.com"],
    ["Cody", "Morse", "LHP", "2003-04-25", "male", "codysm28@gmail.com"],
    ["Cole", "Wesneski", "RHP", "", "male", "colewesneski@gmail.com"],
    ["Connor", "Hollis", "UTL", "1994-11-18", "male", "cohollis@gmail.com"],
    ["Connor", "Phillips", "RHP", "2001-05-04", "male", "txcap09@gmail.com"],
    ["Connor", "Wong", "", "", "", "connorwong10@gmail.com"],
    ["Corbin", "Martin", "RHP", "1995-12-28", "male", "corbinmartin66@yahoo.com"],
    ["Corey", "Julks", "", "", "", "coreyjulks@yahoo.com"],
    ["Craig", "Yoho", "", "1999-10-23", "male", "yohocraig@gmail.com"],
    ["Daniel", "Durazo", "", "", "", "17ddurazo@gmail.com"],
    ["Dane", "Lemaster", "", "", "", "dane.lemaster@gmail.com"],
    ["David", "Harris", "OF", "1991-08-10", "male", "dharris1414@yahoo.com"],
    ["David", "Hamilton", "INF", "", "male", "david.hamilton217@gmail.com"],
    ["David", "Hensley", "", "", "male", "david.hensley15@yahoo.com"],
    ["Dondrei", "Hubbard", "UTL", "1995-05-05", "male", "hubbarddondrei@yahoo.com"],
    ["Dustin", "Saenz", "LHP", "1999-06-02", "male", "saenzdustin4@gmail.com"],
    ["Dylan", "Smith", "RHP", "2000-05-28", "male", "dsmith25133@gmail.com"],
    ["Forrest", "Whitley", "", "", "male", "cfw2655@gmail.com"],
    ["Framber", "Valdez", "LHP", "", "male", "frambervaldez8@gmail.com"],
    ["Francisco", "Ruíz", "C", "2000-01-29", "male", "franciscoruizbaseball@gmail.com"],
    ["Fred", "Schlichtholz", "LHP", "", "male", "fred.slick@gmail.com"],
    ["Gabe", "Klobosits", "RHP", "", "male", "gabe_klobosits@yahoo.com"],
    ["Gianna", "Yancey", "", "2010-05-22", "female", "giannayancey052210@icloud.com"],
    ["Hayden", "Wesneski", "RHP", "1997-12-05", "male", "hwesneski@yahoo.com"],
    ["Hudson", "Head", "OF", "", "male", "hudhead1@gmail.com"],
    ["Jace", "LaViolette", "", "2003-12-04", "male", "jace12laviolette@gmail.com"],
    ["Jackson", "Mayo", "", "", "male", "k.jackson.mayo@gmail.com"],
    ["Jakob", "Marsee", "", "2001-06-28", "male", "jmarsee32@yahoo.com"],
    ["Jared", "Triolo", "INF", "1998-02-08", "male", "jaredtriolo@gmail.com"],
    ["Jared", "Kelley", "RHP", "2001-10-03", "male", "jaredkelley6@icloud.com"],
    ["Javen", "Coleman", "LHP", "2001-12-03", "male", "javencoleman@icloud.com"],
    ["Jeremy", "Pena", "", "", "male", "jeremypena221@gmail.com"],
    ["Jonathan", "Loaisiga", "", "", "male", "jloaisigany@gmail.com"],
    ["Jose", "Trevino", "C", "1992-11-28", "male", "jatrevino5@yahoo.com"],
    ["Jose", "Quintana", "", "1989-01-24", "male", "josenym01@hotmail.com"],
    ["Joseph", "Menefee", "LHP", "", "", "menefee.joseph1@yahoo.com"],
    ["Josh", "Breaux", "C", "1997-10-07", "male", "joshuabreaux22@gmail.com"],
    ["Joshua", "Blum", "RHP", "", "male", "jblum7@icloud.com"],
    ["Julian", "Brock", "", "", "", "jsbrock2001@gmail.com"],
    ["Kendall", "George", "OF", "2004-10-29", "male", "kendallgeorge88@yahoo.com"],
    ["Kyle", "Hendricks", "", "1990-12-07", "male", "kylehendricks@me.com"],
    ["Lance", "McCullers", "SP", "1993-10-02", "male", "lmccullers41@gmail.com"],
    ["Lance", "Garza", "", "1992-02-14", "male", "lancegarza16@yahoo.com"],
    ["Logan", "Henderson", "RHP", "2002-03-02", "male", "loganblake2@yahoo.com"],
    ["Lucas", "Luetge", "LHP", "1987-03-24", "", "lucasluetge@yahoo.com"],
    ["Mack", "Mueller", "OF", "", "male", "muellerbaseball27@gmail.com"],
    ["Madeline", "Panozzo", "", "", "", "madelinejpanozzo@gmail.com"],
    ["Marques", "Titialii", "", "1998-10-21", "", "marquestitialii25@gmail.com"],
    ["Mason", "Marriott", "RHP", "2002-08-14", "male", "mmarriott0814@gmail.com"],
    ["Matt", "Gaitan", "", "1992-01-02", "male", "mgaitan@lacanteraresort.com"],
    ["Matthew", "Linskey", "P", "2002-04-19", "male", "matthewlinskey44@gmail.com"],
    ["Max", "Stassi", "C", "1991-03-15", "male", "maxrstassi@gmail.com"],
    ["Michael", "Cuevas", "Pitcher", "2001-06-29", "male", "mikeycuevas8@gmail.com"],
    ["Nathan", "Eovaldi", "", "", "", "miamimonster213@aol.com"],
    ["Nathan", "Tarver", "3B/INF", "2001-09-27", "male", "nt36bsbl@gmail.com"],
    ["Nick", "Hernandez", "RHP", "1994-12-30", "male", "hernandeznick2@gmail.com"],
    ["Nick", "Solak", "INF", "1995-01-11", "male", "nicholasbsolak@aol.com"],
    ["Nick", "Loftin", "UTL", "1998-09-25", "male", "nick_loftin1@yahoo.com"],
    ["Nico", "O'Donnell", "P", "1999-06-11", "male", "nicoodonnell9@gmail.com"],
    ["Nolan", "Watson", "RHP", "1997-01-25", "male", "nolanwatson20@icloud.com"],
    ["Nolan", "Lamere", "", "1999-10-06", "other", "nolanlameremets@gmail.com"],
    ["Omar", "Cruz", "LHP", "1999-01-26", "male", "omarcruz5@hotmail.com"],
    ["Patrick", "Young", "RHP", "1992-03-24", "male", "pckyoung24@gmail.com"],
    ["Ray-Patrick", "Didder", "SS", "1994-01-10", "male", "ray-patrick_didder@hotmail.com"],
    ["Rhett", "Kouba", "", "", "male", "rhettmoney@gmail.com"],
    ["Robby", "Snelling", "LHP", "2003-12-19", "male", "lancerrobby89@icloud.com"],
    ["Robert", "Dugger", "RHP", "1995-07-03", "male", "robertdugger7@yahoo.com"],
    ["Ryan", "Pressly", "P", "", "male", "ryan.pressly@yahoo.com"],
    ["Ryan", "Jennings", "", "1999-06-23", "male", "ryantrey99@hotmail.com"],
    ["Ryan", "Hendrix", "RHP", "1994-12-16", "male", "ryanhendrix11@gmail.com"],
    ["Ryan", "Bergert", "RHP", "2000-03-08", "male", "ryan10bergert@gmail.com"],
    ["Rylan", "Kaufman", "LHP", "1999-06-23", "male", "rylank131@gmail.com"],
    ["Sam", "Hentges", "", "", "", "samhentges1@gmaill.com"],
    ["Shane", "Baz", "RHP", "1999-06-17", "male", "shane.a.baz@gmail.com"],
    ["Spencer", "Arrighetti", "RHP", "2000-01-02", "male", "szarrighetti@icloud.com"],
    ["Stanley", "Tucker", "", "", "male", "standaman0422@yahoo.com"],
    ["Te'Relle", "George", "", "2003-06-11", "male", "terellestt340@gmail.com"],
    ["Thomas", "Ponticelli", "RHP", "1997-04-15", "male", "tmoss27@hotmail.com"],
    ["Travis", "Sykora", "", "", "male", "travissykora4@gmail.com"],
    ["Tre", "Richardson", "", "", "", "robertrichardson903@gmail.com"],
    ["Trevor", "Lubking", "", "", "", "trevor.lubking@gmail.com"],
    ["Trevor", "Stephan", "RHP", "", "male", "trevorstephan@me.com"],
    ["Trevor", "Werner", "", "2000-09-03", "male", "trevorwerner12@gmail.com"],
    ["Trey", "Supak", "RHP", "1996-05-31", "male", "trey_supak@yahoo.com"],
    ["Tyler", "Duffey", "", "", "", "t_duff13@yahoo.com"],
    ["Tyler", "Davis", "", "1998-10-03", "male", "tylerddavis18@gmail.com"],
    ["Walker", "Janek", "C", "", "", "walkerjanek21@gmail.com"],
    ["Will", "Maynard", "", "2003-06-19", "male", "willmaynard33@gmail.com"],
    ["Wyatt", "Wilson", "", "2005-06-27", "male", "iamwyattwilson@gmail.com"],
    ["Zac", "Leigh", "", "", "male", "zacleigh@yahoo.com"],
    ["Zach", "Royse", "P", "2004-03-20", "male", "zacharyrroyse@icloud.com"],
  ];

  // Known nickname/spelling aliases that DON'T match an existing roster name
  // via exact (case/whitespace-insensitive) comparison, so they'd otherwise
  // create a duplicate profile instead of merging into the real one.
  const NAME_ALIASES = {
    "gabe klobosits": "Gabriel Klobosits",
  };

  function mapPosition(raw) {
    const r = (raw || "").trim().toLowerCase();
    if (!r) return null;
    if (["p", "rhp", "lhp", "sp", "rh pitcher", "pitcher"].includes(r)) return "Pitcher";
    if (r === "c") return "Catcher";
    if (["inf", "ss", "3b", "2b", "1b", "3b/inf"].includes(r)) return "Infield";
    if (r.startsWith("of")) return "Outfield";
    return null; // e.g. "UTL" — ambiguous, leave unset rather than guess
  }

  const created = [];
  const merged = [];
  const keptExisting = [];
  const failed = [];

  // try/catch per row: one bad row (bad data, unexpected character, etc.) must not
  // silently kill every row after it — a plain forEach would otherwise abort entirely
  // on the first thrown error, which is almost certainly why a prior run of this
  // script left a chunk of names at the end of the list never even attempted.
  ROWS.forEach(([first, last, rawPos, dob, gender, email]) => {
    const fullName = `${first.trim()} ${last.trim()}`;
    try {
      const aliasTarget = NAME_ALIASES[fullName.toLowerCase()];
      const lookupName = aliasTarget || fullName;

      const existedBefore = !!window.AthleteStore.findAthleteByName(lookupName);
      const athlete = window.AthleteStore.findOrCreateAthlete(lookupName);

      const position = mapPosition(rawPos);
      const patch = {};

      if (position && (!athlete.position || athlete.position === "Unassigned")) {
        patch.position = position;
      } else if (position && athlete.position && athlete.position !== position) {
        keptExisting.push(`${fullName}: position already "${athlete.position}", not overwritten with "${position}"`);
      }

      if (dob && !athlete.dob) {
        patch.dob = dob;
      } else if (dob && athlete.dob && athlete.dob !== dob) {
        keptExisting.push(`${fullName}: dob already "${athlete.dob}", not overwritten with "${dob}"`);
      }

      if (gender && !athlete.gender) {
        patch.gender = gender;
      }

      if (email && !athlete.email) {
        patch.email = email;
      } else if (email && athlete.email && athlete.email.toLowerCase() !== email.toLowerCase()) {
        keptExisting.push(`${fullName}: email already "${athlete.email}", not overwritten with "${email}"`);
      }

      if (Object.keys(patch).length) {
        window.AthleteStore.updateAthlete(athlete.id, patch);
      }

      if (existedBefore) {
        merged.push(fullName);
      } else {
        created.push(fullName);
      }
    } catch (e) {
      console.error(`Row for "${fullName}" failed:`, e);
      failed.push(`${fullName}: ${e.message}`);
    }
  });

  console.log(`Created ${created.length} new athlete(s):`, created);
  console.log(`Merged info into ${merged.length} existing athlete(s):`, merged);
  if (keptExisting.length) {
    console.log(`Kept ${keptExisting.length} existing value(s) instead of overwriting — review these manually:`, keptExisting);
  }
  if (failed.length) {
    console.log(`${failed.length} row(s) failed — see errors above:`, failed);
  }
  alert(
    `Import complete.\nCreated: ${created.length}\nMerged into existing profiles: ${merged.length}` +
      (keptExisting.length ? `\n${keptExisting.length} field(s) were left as-is because a value already existed — see console for details.` : "") +
      (failed.length ? `\n${failed.length} row(s) FAILED — see console for details.` : "")
  );
  location.reload();
})();
