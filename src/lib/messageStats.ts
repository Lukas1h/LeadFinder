import { db } from "@/db";
import { listings, messageSends } from "@/db/schema";
import { inArray } from "drizzle-orm";

export interface AgentBucketStats {
  sent: number;
  booked: number;
}

export interface VariantStats {
  sent: number;
  responded: number;
  quoted: number;
  booked: number;
  declined: number;
  revenue: number;
  newAgent: AgentBucketStats;
  repeatAgent: AgentBucketStats;
}

function emptyStats(): VariantStats {
  return {
    sent: 0,
    responded: 0,
    quoted: 0,
    booked: 0,
    declined: 0,
    revenue: 0,
    newAgent: { sent: 0, booked: 0 },
    repeatAgent: { sent: 0, booked: 0 },
  };
}

/**
 * Per-variant send stats for the presets page. Classifies each send's agent
 * as "repeat" (appears on 2+ listings we've ever seen) or "new" (exactly
 * one) using data already in the listings table — no separate agent
 * tracking needed for that split.
 */
export async function computeVariantStats(): Promise<Record<string, VariantStats>> {
  const sends = await db
    .select({
      variantId: messageSends.variantId,
      listingId: messageSends.listingId,
      respondedAt: messageSends.respondedAt,
      result: messageSends.result,
    })
    .from(messageSends);

  if (sends.length === 0) return {};

  const listingIds = [...new Set(sends.map((s) => s.listingId))];
  const [referencedListings, allListings] = await Promise.all([
    db
      .select({ id: listings.id, agentPhone: listings.agentPhone, bookingValue: listings.bookingValue })
      .from(listings)
      .where(inArray(listings.id, listingIds)),
    db.select({ agentPhone: listings.agentPhone }).from(listings),
  ]);
  const listingById = new Map(referencedListings.map((l) => [l.id, l]));

  const countByPhone = new Map<string, number>();
  for (const l of allListings) {
    if (!l.agentPhone) continue;
    countByPhone.set(l.agentPhone, (countByPhone.get(l.agentPhone) ?? 0) + 1);
  }

  const stats: Record<string, VariantStats> = {};
  for (const s of sends) {
    const bucket = (stats[s.variantId] ??= emptyStats());
    bucket.sent += 1;
    if (s.respondedAt) bucket.responded += 1;
    if (s.result === "quoted") bucket.quoted += 1;
    if (s.result === "booked") bucket.booked += 1;
    if (s.result === "declined") bucket.declined += 1;

    const listing = listingById.get(s.listingId);
    if (s.result === "booked" && listing?.bookingValue != null) bucket.revenue += listing.bookingValue;

    const isRepeat = !!listing?.agentPhone && (countByPhone.get(listing.agentPhone) ?? 0) > 1;
    const agentBucket = isRepeat ? bucket.repeatAgent : bucket.newAgent;
    agentBucket.sent += 1;
    if (s.result === "booked") agentBucket.booked += 1;
  }

  return stats;
}
