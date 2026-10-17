/**
 * One-off: runs the drone airspace check (src/lib/airspace.ts) on bookings
 * saved before it existed. Only jobs still ahead matter: every booking with
 * a street address that isn't completed yet, plus any with a job date from
 * today on. Bookings already checked at their current address are skipped,
 * so it's safe to run again.
 *
 *   npx tsx --env-file=.env.local scripts/backfill-airspace.mts
 *
 * Needs the bookings.airspace columns pushed first (npm run db:push).
 */

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { bookings, listings } from "@/db/schema";
import { refreshBookingAirspace } from "@/lib/airspace";

const today = new Date();
today.setHours(0, 0, 0, 0);

const rows = await db
  .select({
    id: bookings.id,
    address: bookings.address,
    listingAddress: listings.address,
    completedAt: bookings.completedAt,
    jobDate: bookings.jobDate,
  })
  .from(bookings)
  .leftJoin(listings, eq(listings.id, bookings.listingId));

const due = rows.filter(
  (b) => (b.listingAddress ?? b.address)?.trim() && (!b.completedAt || (b.jobDate && b.jobDate >= today))
);
console.log(`${due.length} of ${rows.length} bookings to check`);

let controlled = 0;
let failed = 0;
for (const [i, b] of due.entries()) {
  // Nominatim asks for at most one request a second.
  if (i > 0) await new Promise((r) => setTimeout(r, 1200));
  const check = await refreshBookingAirspace(b.id);
  if (!check) failed++;
  else if (check.status === "controlled") controlled++;
  console.log(`${check?.status ?? "FAILED"}  ${b.listingAddress ?? b.address}${check ? `  ${check.summary}` : ""}`);
}

console.log(`Done: ${controlled} in controlled airspace, ${failed} couldn't be checked.`);
