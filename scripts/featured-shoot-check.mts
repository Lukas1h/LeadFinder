// Dry run for the featured shoot a portfolio page leads with
// (lib/portfolioFeatured.ts): the most recent booking with highlight photos,
// as getFeaturedShoot returns it. Read-only.
//   npx tsx scripts/featured-shoot-check.mts
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

const { sql, isNotNull, desc } = await import("drizzle-orm");
const { db } = await import("../src/db");
const { bookings } = await import("../src/db/schema");
const { getFeaturedShoot } = await import("../src/lib/portfolioFeatured");

const picks = await db
  .select({ id: bookings.id, address: bookings.address, jobDate: bookings.jobDate })
  .from(bookings)
  .where(isNotNull(bookings.highlightPhotos))
  .orderBy(sql`${bookings.jobDate} desc nulls last`, desc(bookings.createdAt))
  .limit(10);

if (picks.length === 0) {
  console.log("No booking has highlight photos yet — nothing to show.");
  process.exit(0);
}

for (const pick of picks) {
  const shoot = await getFeaturedShoot(pick.id, "test");
  if (!shoot) {
    console.log(`${pick.id} (${pick.address ?? "no address"}): no featured shoot (no folder or no photos)`);
    continue;
  }
  console.log(JSON.stringify(shoot, null, 2));
  break;
}
process.exit(0);
