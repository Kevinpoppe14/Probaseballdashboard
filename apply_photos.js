// Paste this entire file into the browser DevTools Console (F12) while the
// dashboard is open, then press Enter. It looks up each name against the
// current roster and sets their photoUrl to their MLB/MiLB headshot.
// Only the photoUrl field is touched — nothing else is modified.
(function () {
  const PHOTOS = {
    "Austin Dean": 621573,
    "David Hamilton": 666152,
    "Josh Breaux": 677007,
    "Robert Dugger": 667498,
    "Gabriel Klobosits": 656620,
    "Blake Holub": 700183,
    "Julian Brock": 683149,
    "Brice Matthews": 694728,
    "Blake Mitchell": 805810,
    "Cameron Cauley": 695508,
    "Tre Richardson": 693832,
    "Walker Janek": 801075,
    "Braydon Fisher": 680755,
    "Carson McCusker": 676812,
    "Zach Royse": 805942,
    "Jared Kelley": 691721,
    "Trevor Werner": 687731,
    "Jace Laviolette": 702593,
    "Travis Sykora": 805809,
    "Blaine Bullard": 828557,
    "Jared Triolo": 669707,
    "Connor Hollis": 667442,
    "Shane Baz": 669358,
    "Codi Heuer": 676051,
    "Zac Leigh": 684949,
    "Nick Loftin": 679845,
    "Dylan Smith": 681916,
    "Nick Solak": 669256,
    "Hayden Wesneski": 669713,
  };

  const updated = [];
  const notFound = [];

  Object.entries(PHOTOS).forEach(([name, id]) => {
    const url = `https://img.mlbstatic.com/mlb-photos/image/upload/w_213,d_people:generic:headshot:67:current.png,q_auto:best,f_auto/v1/people/${id}/headshot/67/current`;
    const athlete = window.AthleteStore.findAthleteByName(name);
    if (athlete) {
      window.AthleteStore.updateAthlete(athlete.id, { photoUrl: url });
      updated.push(name);
    } else {
      notFound.push(name);
    }
  });

  console.log("Photos applied:", updated);
  console.log("No roster match found for:", notFound);
  alert(
    `Applied photos to ${updated.length} athlete(s).` +
      (notFound.length ? ` ${notFound.length} name(s) didn't match anyone on the roster — see console for details.` : "")
  );
  location.reload();
})();
