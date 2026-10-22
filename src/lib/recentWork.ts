import { and, desc, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { bookings } from "@/db/schema";
import { citiesNear } from "@/lib/areaPhrase";
import { naturalStreetName } from "@/lib/sms";

const DAY = 24 * 60 * 60 * 1000;
/** "just finished": a job delivered this recently still reads that way. */
const RECENT_DAYS = 60;
/** How far back to look for a candidate before giving up on finding one nearby. */
const LOOKBACK = 80;
const WEBSITE_URL = "https://www.lukashahn.art/real-estate";

/**
 * The "Response to Text Message" email's {{recentWork}} line (Lukas's own
 * wording, 2026-10-22): a job he just delivered near the agent's town, linked
 * to its public gallery — or, with nothing recent enough nearby, a nudge to
 * the site instead. Matches the same city grouping {{area}} uses, so "near"
 * means the same thing in both places.
 */
export async function recentWorkLine(city: string | null): Promise<string> {
  const cities = new Set(citiesNear(city));
  if (cities.size > 0) {
    const rows = await db
      .select({ address: bookings.address, city: bookings.city, galleryToken: bookings.galleryToken, completedAt: bookings.completedAt })
      .from(bookings)
      .where(and(isNotNull(bookings.galleryToken), isNotNull(bookings.completedAt), isNotNull(bookings.city)))
      .orderBy(desc(bookings.completedAt))
      .limit(LOOKBACK);
    const cutoff = Date.now() - RECENT_DAYS * DAY;
    const match = rows.find((r) => r.completedAt!.getTime() > cutoff && cities.has(r.city!.trim().toLowerCase()));
    if (match) {
      const street = naturalStreetName(match.address) ?? "a property";
      return (
        `Here's ${street}${match.city ? ` in ${match.city.trim()}` : ""} we just finished, if you'd like to check it out: ` +
        `https://gallery.lukashahn.art/${match.galleryToken}`
      );
    }
  }
  return `Video work is on our website at: ${WEBSITE_URL}`;
}
