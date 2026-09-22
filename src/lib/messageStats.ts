import { db } from "@/db";
import {
  listings,
  messageSends,
  bookings,
  bookingLineItems,
  messagePresets,
  agents,
  type MessageChannel,
  type MessageResult,
  type PresetType,
} from "@/db/schema";
import { desc, eq, isNotNull } from "drizzle-orm";

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
      id: messageSends.id,
      variantId: messageSends.variantId,
      agentId: messageSends.agentId,
      respondedAt: messageSends.respondedAt,
      result: messageSends.result,
    })
    .from(messageSends);

  if (sends.length === 0) return {};

  // Revenue follows bookings.messageSendId, the booking's own pointer at the
  // outreach that won it. It used to be derived send -> listing -> booking,
  // which silently produced nothing for a job booked directly with an agent —
  // and since every booking so far has had no listing, per-variant revenue was
  // structurally always zero no matter how much work the outreach brought in.
  const bookedRows = await db
    .select({ messageSendId: bookings.messageSendId, amount: bookingLineItems.amount })
    .from(bookings)
    .innerJoin(bookingLineItems, eq(bookingLineItems.bookingId, bookings.id))
    .where(isNotNull(bookings.messageSendId));

  const revenueBySendId = new Map<string, number>();
  for (const row of bookedRows) {
    if (!row.messageSendId) continue;
    revenueBySendId.set(row.messageSendId, (revenueBySendId.get(row.messageSendId) ?? 0) + row.amount);
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

    bucket.revenue += revenueBySendId.get(s.id) ?? 0;

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
