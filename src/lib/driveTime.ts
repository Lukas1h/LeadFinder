/**
 * Free, no-API drive time estimate — a hardcoded table of real-world drive
 * times FROM WINSTON, OR (Lukas's home base) TO each city he might get a
 * lead/booking from. No geometry, no routing engine, just known Oregon
 * highway drive times so short valley hops read short and coastal/mountain
 * roads read appropriately slow (a generic straight-line-distance formula
 * can't tell a flat I-5 shot from a curvy 2-lane highway apart, which is
 * why this replaced that approach). Fixed to Winston for now — if the home
 * base ever needs to be configurable, this table would need to become
 * per-origin, but that's not worth the complexity until it's actually
 * needed. Returns null for any city not listed rather than guessing.
 */

const DRIVE_TIME_FROM_WINSTON: Record<string, string> = {
  winston: "~5 min drive",
  roseburg: "~10 min drive",
  "myrtle creek": "~15 min drive",
  riddle: "~15 min drive",
  sutherlin: "~20 min drive",
  canyonville: "~25 min drive",
  glide: "~25 min drive",
  elkton: "~35 min drive",
  "days creek": "~30 min drive",
  yoncalla: "~30 min drive",
  drain: "~35 min drive",
  scottsburg: "~45 min drive",
  "cottage grove": "~55 min drive",
  reedsport: "~55 min drive",
  "winchester bay": "~1h drive",
  "gold hill": "~1h 15m drive",
  "pleasant hill": "~1h 15m drive",
  "grants pass": "~1h 5m drive",
  creswell: "~1h 20m drive",
  "rogue river": "~1h 20m drive",
  elmira: "~1h 20m drive",
  veneta: "~1h 25m drive",
  springfield: "~1h 25m drive",
  eugene: "~1h 30m drive",
  medford: "~1h 30m drive",
  cheshire: "~1h 30m drive",
  "central point": "~1h 40m drive",
  jacksonville: "~1h 40m drive",
  "coos bay": "~1h 40m drive",
  "junction city": "~1h 40m drive",
  phoenix: "~1h 50m drive",
  harrisburg: "~1h 45m drive",
  florence: "~1h 45m drive",
  "north bend": "~1h 45m drive",
  talent: "~1h 55m drive",
  philomath: "~1h 55m drive",
  oakridge: "~1h 55m drive",
  ashland: "~2h drive",
  corvallis: "~2h drive",
  albany: "~2h 5m drive",
  independence: "~2h 15m drive",
  dallas: "~2h 15m drive",
  lebanon: "~2h 15m drive",
  newport: "~2h 15m drive",
  "sweet home": "~2h 25m drive",
  salem: "~2h 30m drive",
  keizer: "~2h 30m drive",
  mcminnville: "~2h 30m drive",
  sheridan: "~2h 30m drive",
  "lincoln city": "~2h 30m drive",
  monmouth: "~2h 45m drive",
  silverton: "~2h 45m drive",
  woodburn: "~2h 45m drive",
  wilsonville: "~2h 40m drive",
  sherwood: "~2h 45m drive",
  "klamath falls": "~2h 45m drive",
  beaverton: "~2h 50m drive",
  tigard: "~2h 50m drive",
  hillsboro: "~2h 55m drive",
  "oregon city": "~2h 55m drive",
  molalla: "~2h 55m drive",
  portland: "~3h drive",
  bend: "~3h drive",
  tillamook: "~3h drive",
  gresham: "~3h 10m drive",
  estacada: "~3h 10m drive",
  redmond: "~3h 5m drive",
  sandy: "~3h 15m drive",
  prineville: "~3h 15m drive",
  madras: "~3h 20m drive",
  "the dalles": "~3h 30m drive",
  astoria: "~3h 45m drive",
  "hood river": "~3h 45m drive",
  lakeview: "~4h drive",
  burns: "~4h drive",
  pendleton: "~4h 45m drive",
  "john day": "~4h 30m drive",
  "la grande": "~5h 15m drive",
  "baker city": "~5h 45m drive",
  ontario: "~6h 30m drive",
};

function normalizeCity(city: string): string {
  return city.trim().toLowerCase();
}

/** Rough "~1h 30m drive" from Winston, OR, or null if the city isn't in the table. */
export function estimateDriveTime(city: string): string | null {
  return DRIVE_TIME_FROM_WINSTON[normalizeCity(city)] ?? null;
}
