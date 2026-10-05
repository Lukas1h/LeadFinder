// Shared by the AI drafts (draftMessage.ts) and the {{area}} template
// placeholder (messageTemplate.ts), so a template and an AI draft always
// describe the same city the same way.

// How Lukas says where he works, per city — his own wording (2026-10-04):
// Portland metro is "in the Portland area"; Salem metro, where he's done
// work, is "here in the Salem area"; Roseburg, Eugene and Springfield get
// "here in" the city itself, and their smaller neighbors "here in the
// Roseburg/Eugene area"; the Oregon coast is "here around the coast". Medford
// is a regular area for him too. Anywhere else is "in the {City} area".
const AREA_PHRASES: [string, string[]][] = [
  ["in the Portland area", [
    "portland", "beaverton", "hillsboro", "gresham", "lake oswego", "tigard", "tualatin", "west linn",
    "oregon city", "milwaukie", "happy valley", "clackamas", "wilsonville", "sherwood", "troutdale",
    "fairview", "wood village", "gladstone", "cornelius", "forest grove", "north plains", "damascus",
    "sandy", "boring", "canby", "estacada", "scappoose", "st. helens", "st helens", "newberg", "aloha",
    "king city", "durham", "oak grove", "jennings lodge", "west slope", "raleigh hills", "garden home",
    "vancouver", "camas", "washougal", "battle ground", "ridgefield",
  ]],
  ["here in the Salem area", [
    "salem", "keizer", "turner", "aumsville", "stayton", "sublimity", "silverton", "mount angel",
    "woodburn", "monmouth", "independence", "dallas", "jefferson", "gervais", "brooks", "mill city",
    "scio", "hubbard", "aurora", "donald", "st. paul", "st paul",
  ]],
  ["here in Roseburg", ["roseburg"]],
  ["here in the Roseburg area", [
    "winston", "sutherlin", "myrtle creek", "canyonville", "oakland", "drain", "elkton", "glide",
    "tenmile", "green", "lookingglass", "days creek", "riddle", "winchester", "umpqua", "dillard",
  ]],
  ["here in Eugene", ["eugene"]],
  ["here in Springfield", ["springfield"]],
  ["here in the Eugene area", [
    "cottage grove", "creswell", "pleasant hill", "junction city", "coburg", "veneta", "lowell",
    "oakridge", "marcola", "harrisburg", "dexter", "elmira",
  ]],
  ["here around the coast", [
    "coos bay", "north bend", "lakeside", "reedsport", "winchester bay", "charleston", "bandon",
    "coquille", "myrtle point", "port orford", "langlois", "gold beach", "brookings", "florence",
    "dunes city", "yachats", "waldport", "seal rock", "newport", "toledo", "siletz", "otter rock",
    "depoe bay", "gleneden beach", "lincoln city", "otis", "neskowin", "pacific city", "cloverdale",
    "tillamook", "netarts", "oceanside", "bay city", "garibaldi", "rockaway beach", "wheeler",
    "nehalem", "manzanita", "arch cape", "cannon beach", "tolovana park", "seaside", "gearhart",
    "warrenton", "hammond", "astoria",
  ]],
  ["here in the Medford area", [
    "medford", "ashland", "central point", "phoenix", "talent", "white city", "eagle point",
    "jacksonville", "gold hill", "rogue river", "shady cove", "butte falls", "grants pass",
  ]],
];

/** "in the Portland area", "here in Roseburg", "in the Bend area", … — null only with no city at all. */
export function areaPhrase(city: string | null | undefined): string | null {
  const name = city?.trim();
  if (!name) return null;
  const key = name.toLowerCase();
  return AREA_PHRASES.find(([, cities]) => cities.includes(key))?.[0] ?? `in the ${name} area`;
}
