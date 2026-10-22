// Links a booking arranged directly with an agent (no listingId: he was
// hired off-Zillow, so there was nothing to attach at the time) to a tracked
// listing at the same address, once one turns up from a normal scrape — free,
// since it's a match against listings we already have, never a lookup.
//
// Once linked, the booking inherits that listing's photos, price and status
// everywhere a feed reads coalesce(listing, booking) — in particular the
// nightly market check (lib/marketStatus.ts) then has a real listing to
// watch instead of just the booking's own address, so "went pending/sold"
// is caught for these jobs too, not only the ones that started from a
// tracked listing.

import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { bookings, listings } from "@/db/schema";
import { addressKey } from "@/app/follow-up/data";

export interface BookingListingMatchResult {
  linked: number;
  /** Address keys that fit more than one listing, left unlinked rather than guessed at. */
  ambiguous: number;
}

export async function matchBookingsToListings(): Promise<BookingListingMatchResult> {
  const [unmatched, candidates] = await Promise.all([
    db
      .select({ id: bookings.id, address: bookings.address })
      .from(bookings)
      .where(and(isNull(bookings.listingId), sql`${bookings.address} is not null`)),
    db.select({ id: listings.id, address: listings.address }).from(listings).where(sql`${listings.address} is not null`),
  ]);
  if (unmatched.length === 0) return { linked: 0, ambiguous: 0 };

  const byKey = new Map<string, string[]>();
  for (const l of candidates) {
    const key = addressKey(l.address);
    if (!key) continue;
    (byKey.get(key) ?? byKey.set(key, []).get(key)!).push(l.id);
  }

  let linked = 0;
  let ambiguous = 0;
  for (const b of unmatched) {
    const key = addressKey(b.address);
    if (!key) continue;
    const matches = byKey.get(key);
    if (!matches || matches.length === 0) continue;
    if (matches.length > 1) {
      ambiguous++;
      continue;
    }
    await db.update(bookings).set({ listingId: matches[0] }).where(eq(bookings.id, b.id));
    linked++;
  }
  return { linked, ambiguous };
}
