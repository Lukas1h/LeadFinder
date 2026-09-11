import { db } from "@/db";
import {
  listings,
  messageSends,
  bookingLineItems,
  messagePresets,
  agents,
  type MessageChannel,
  type MessageResult,
  type PresetType,
} from "@/db/schema";
import { inArray, desc, eq } from "drizzle-orm";

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
 * Per-variant send stats for the messaging page. Classifies each send's
 * agent as "repeat" (this agent has 2+ sends in the log, any channel) or
 * "new" (exactly one) by counting messageSends.agentId directly — not, as
 * before, by counting listings.agentPhone occurrences, since a cold-emailed
 * realtor may have no listing at all (that old approach would've left every
 * email send looking like a "new agent" forever, even on the 5th email to
 * the same person).
 */
export async function computeVariantStats(): Promise<Record<string, VariantStats>> {
  const sends = await db
    .select({
      variantId: messageSends.variantId,
      listingId: messageSends.listingId,
      agentId: messageSends.agentId,
      respondedAt: messageSends.respondedAt,
      result: messageSends.result,
    })
    .from(messageSends);

  if (sends.length === 0) return {};

  const listingIds = [...new Set(sends.map((s) => s.listingId).filter((id): id is string => id != null))];
  const referencedListings =
    listingIds.length > 0
      ? await db
          .select({ id: listings.id, bookingId: listings.bookingId })
          .from(listings)
          .where(inArray(listings.id, listingIds))
      : [];
  const listingById = new Map(referencedListings.map((l) => [l.id, l]));

  // Revenue now lives as line items on a booking, not a flat column on the
  // listing — sum each referenced booking's line items once, up front.
  const bookingIds = [
    ...new Set(referencedListings.map((l) => l.bookingId).filter((id): id is string => id != null)),
  ];
  const lineItems =
    bookingIds.length > 0
      ? await db
          .select({ bookingId: bookingLineItems.bookingId, amount: bookingLineItems.amount })
          .from(bookingLineItems)
          .where(inArray(bookingLineItems.bookingId, bookingIds))
      : [];
  const totalByBookingId = new Map<string, number>();
  for (const item of lineItems) {
    totalByBookingId.set(item.bookingId, (totalByBookingId.get(item.bookingId) ?? 0) + item.amount);
  }

  const sendCountByAgent = new Map<string, number>();
  for (const s of sends) {
    if (!s.agentId) continue;
    sendCountByAgent.set(s.agentId, (sendCountByAgent.get(s.agentId) ?? 0) + 1);
  }

  const stats: Record<string, VariantStats> = {};
  for (const s of sends) {
    const bucket = (stats[s.variantId] ??= emptyStats());
    bucket.sent += 1;
    if (s.respondedAt) bucket.responded += 1;
    if (s.result === "quoted") bucket.quoted += 1;
    if (s.result === "booked") bucket.booked += 1;
    if (s.result === "declined") bucket.declined += 1;

    const listing = s.listingId ? listingById.get(s.listingId) : undefined;
    const revenue = listing?.bookingId ? totalByBookingId.get(listing.bookingId) : undefined;
    if (s.result === "booked" && revenue != null) bucket.revenue += revenue;

    const isRepeat = !!s.agentId && (sendCountByAgent.get(s.agentId) ?? 0) > 1;
    const agentBucket = isRepeat ? bucket.repeatAgent : bucket.newAgent;
    agentBucket.sent += 1;
    if (s.result === "booked") agentBucket.booked += 1;
  }

  return stats;
}

export interface RecentSend {
  id: string;
  channel: MessageChannel;
  type: PresetType;
  presetName: string;
  sentAt: Date;
  result: MessageResult;
  agentName: string | null;
  agentPhone: string | null;
  listingAddress: string | null;
}

/**
 * Most recent SMS/email sends across every preset — the "Recently sent"
 * feed on the messaging page. Same join shape as getAgentSendHistory
 * (src/app/agents/actions.ts), just not filtered to one agent and adding
 * the listing address, since here (unlike an agent's own detail dialog)
 * which property a send was about isn't otherwise obvious.
 */
export async function getRecentMessageSends(limit = 20): Promise<RecentSend[]> {
  return db
    .select({
      id: messageSends.id,
      channel: messageSends.channel,
      type: messageSends.type,
      sentAt: messageSends.sentAt,
      result: messageSends.result,
      presetName: messagePresets.name,
      agentName: agents.name,
      agentPhone: agents.phone,
      listingAddress: listings.address,
    })
    .from(messageSends)
    .innerJoin(messagePresets, eq(messageSends.presetId, messagePresets.id))
    .leftJoin(agents, eq(messageSends.agentId, agents.id))
    .leftJoin(listings, eq(messageSends.listingId, listings.id))
    .orderBy(desc(messageSends.sentAt))
    .limit(limit);
}
