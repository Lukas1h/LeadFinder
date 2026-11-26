/**
 * One-off (2026-11-25): moves the hardcoded markets (the old SHOOTER_MARKETS
 * in src/lib/markets.ts) into the `markets` table and fills in the shooters'
 * new columns. Idempotent: upserts by key / name.
 *
 *   npx tsx scripts/seed-markets.mts
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

const { db } = await import("@/db");
const { markets, shooters, searchSources } = await import("@/db/schema");
const { COAST_CITIES, PORTLAND_CITIES } = await import("@/lib/marketCities");
const { eq, sql } = await import("drizzle-orm");

// Clark County, WA: the old config put every WA listing in Portland by state.
const CLARK_COUNTY: Record<string, [number, number]> = {
  vancouver: [45.6387, -122.6615],
  camas: [45.5871, -122.3995],
  washougal: [45.5826, -122.3534],
  "battle ground": [45.7807, -122.5337],
  ridgefield: [45.8151, -122.7429],
  "la center": [45.8623, -122.6704],
  yacolt: [45.8659, -122.4065],
  "brush prairie": [45.7329, -122.5468],
  "hazel dell": [45.6715, -122.6629],
  orchards: [45.6665, -122.5609],
  "salmon creek": [45.7107, -122.6487],
  felida: [45.7101, -122.7051],
  amboy: [45.9101, -122.4465],
  woodland: [45.9043, -122.7437],
};

const rows = [
  {
    key: "local",
    label: "Local",
    kind: "local",
    status: "active",
    sortOrder: 0,
    notes: "Around Winston / Roseburg, within 45 minutes by the drive table. Lukas shoots these.",
  },
  {
    key: "regional",
    label: "Regional",
    kind: "regional",
    status: "active",
    sortOrder: 10,
    notes: "The rest of Oregon Lukas drives to himself: Eugene to Salem, Medford, the coast outside the Coast market, Bend.",
  },
  {
    key: "portland",
    label: "Portland",
    kind: "shooter",
    status: "active",
    sortOrder: 20,
    state: "OR",
    states: ["WA"],
    base: { name: "Oregon City", lat: 45.3573, lng: -122.6068 },
    cities: { ...PORTLAND_CITIES, ...CLARK_COUNTY },
    pointArea: { minLat: 45.2, radiusMiles: 30 },
    areaCodes: ["503", "971", "360"],
    drive: { startMinutes: 5, minutesPerMile: 1.6 },
    areaPhrase: "in the Portland area",
    portfolioArea: "the Portland area",
    pageLocation: "Portland, Oregon",
    vcardCity: "Portland",
    vcardNote: "Portland area.",
    jobsPerWeek: 2,
    prices: { photo: 324, video: 424 },
    launchedAt: new Date("2026-11-12T12:00:00-08:00"),
    notes: "Multnomah, Washington, Clackamas, Yamhill, Columbia counties + Clark County WA. Salem / Marion County stay regional.",
  },
  {
    key: "central_coast",
    label: "Coast",
    kind: "shooter",
    status: "active",
    sortOrder: 30,
    state: "OR",
    states: [],
    base: { name: "Tillamook", lat: 45.4562, lng: -123.844 },
    cities: COAST_CITIES,
    pointArea: { minLat: 44.27, maxLat: 45.76, maxLng: -123.55, radiusMiles: 85 },
    areaCodes: [],
    drive: { startMinutes: 5, minutesPerMile: 1.7 },
    areaPhrase: "here on the coast",
    portfolioArea: "the coast",
    pageLocation: "Oregon Coast",
    vcardCity: "Tillamook",
    vcardNote: "Oregon Coast.",
    jobsPerWeek: 1,
    prices: {},
    launchedAt: new Date("2026-11-16T12:00:00-08:00"),
    notes: "Tillamook + Lincoln County, Lincoln City to Yachats, inland to Siletz / Eddyville. Clatsop County and Florence stay regional.",
  },
];

for (const row of rows) {
  await db
    .insert(markets)
    .values(row as typeof markets.$inferInsert)
    .onConflictDoUpdate({ target: markets.key, set: { ...(row as object), updatedAt: new Date() } });
}

const people: { name: string; set: Partial<typeof shooters.$inferInsert> }[] = [
  {
    name: "Chris",
    set: {
      marketKey: "portland", label: "Chris", role: "main", lat: 45.4795, lng: -122.6105, freeMinutes: 60, drivePerHour: null,
      rates: { photo: 175, photoDrone: 225 },
      portfolioPhotos: [], // filled below from the old hardcoded set
    },
  },
  {
    name: "Elijah",
    set: { marketKey: "portland", label: "Elijah", role: "main", lat: 45.3139, lng: -122.5547, freeMinutes: 20, drivePerHour: 50 },
  },
  {
    name: "Jenny Bocko",
    set: {
      marketKey: "central_coast", label: "Jenny", role: "main", lat: 45.4318, lng: -123.9453, freeMinutes: 45, drivePerHour: null,
      rates: { photo: 175, photoDrone: 225 },
    },
  },
  {
    name: "Emily Castleberry",
    set: { marketKey: "central_coast", label: "Emily", role: "backup", lat: 44.6368, lng: -124.0535, freeMinutes: 30, drivePerHour: null },
  },
];

const { PORTLAND_SHOOTER_PHOTOS } = await import("@/lib/agentPage").catch(() => ({ PORTLAND_SHOOTER_PHOTOS: null }));
if (PORTLAND_SHOOTER_PHOTOS) people[0].set.portfolioPhotos = PORTLAND_SHOOTER_PHOTOS.photos.map((p: { src: string; alt: string }) => ({ src: p.src, alt: p.alt }));

for (const p of people) {
  const res = await db.update(shooters).set(p.set).where(eq(shooters.name, p.name)).returning({ id: shooters.id });
  console.log(`shooter ${p.name}: ${res.length ? "updated" : "MISSING"}`);
}

// Tag the search sources with their market by name.
const tags: [string, string][] = [
  ["Portland metro", "portland"],
  ["Coast (Tillamook County, all listings)", "central_coast"],
  ["Central Coast (Lincoln County, all listings)", "central_coast"],
  ["Central Coast (Yachats–Pacific City)", "central_coast"],
  ["Roseburg", "local"],
];
for (const [name, key] of tags) await db.update(searchSources).set({ market: key }).where(eq(searchSources.name, name));
await db.update(searchSources).set({ market: "regional" }).where(sql`${searchSources.market} is null`);

console.log(await db.select({ key: markets.key, label: markets.label, status: markets.status }).from(markets));
process.exit(0);
