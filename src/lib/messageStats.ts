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
import { desc, eq, isNotNull, sql } from "drizzle-orm";

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

export interface SendCounts {
  sent: number;
  /** Sent in the last 30 days. */
  sentRecent: number;
  replied: number;
  booked: number;
}

export interface TemplateSendStats extends SendCounts {
  presetId: string;
  name: string;
  channel: MessageChannel;
  type: PresetType;
  archived: boolean;
}

export interface DayBucket {
  label: string;
  sent: number;
  replied: number;
  /**
   * The day's reply rate with the template mix taken out: what the channel's
   * average would have been if this day's sends had done as well against their
   * own templates' usual rates as they did. A day that only looks good because
   * a strong template happened to go out on it lands back at the average.
   * Null with no sends.
   */
  adjustedRate: number | null;
}

export interface MessagingStats {
  sms: SendCounts;
  email: SendCounts;
  /** Line-item total of bookings won by a send (bookings.messageSendId). */
  revenue: number;
  /** Every template with at least one send, most-sent first. */
  templates: TemplateSendStats[];
  /** Reply rate by the Pacific weekday a message went out, Mon–Sun, per channel. */
  byDay: Record<MessageChannel, DayBucket[]>;
}

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// The time zone is a literal, not a bound parameter, so the same expression
// can appear in both SELECT and GROUP BY.
const sentDow = sql<number>`extract(isodow from ${messageSends.sentAt} at time zone 'America/Los_Angeles')::int`;

/**
 * Totals for the stats card at the top of the messaging page — per channel
 * and per template, deliberately not per variant (PresetCard has those).
 * Aggregated in SQL: there are thousands of cold-email sends.
 */
export async function computeMessagingStats(): Promise<MessagingStats> {
  // Each template's own reply rate, all days together.
  const templateRates = db
    .select({
      presetId: messageSends.presetId,
      rate: sql<number>`(count(${messageSends.respondedAt})::float / count(*))`.as("rate"),
    })
    .from(messageSends)
    .groupBy(messageSends.presetId)
    .as("template_rates");

  const [rows, [revenueRow], dayRows] = await Promise.all([
    db
      .select({
        presetId: messageSends.presetId,
        channel: messageSends.channel,
        name: messagePresets.name,
        type: messagePresets.type,
        archived: sql<boolean>`${messagePresets.archivedAt} is not null`,
        sent: sql<number>`count(*)::int`,
        sentRecent: sql<number>`count(*) filter (where ${messageSends.sentAt} > now() - interval '30 days')::int`,
        replied: sql<number>`count(${messageSends.respondedAt})::int`,
        booked: sql<number>`count(*) filter (where ${messageSends.result} = 'booked')::int`,
      })
      .from(messageSends)
      .innerJoin(messagePresets, eq(messageSends.presetId, messagePresets.id))
      .groupBy(
        messageSends.presetId,
        messageSends.channel,
        messagePresets.name,
        messagePresets.type,
        messagePresets.archivedAt
      )
      .orderBy(desc(sql`count(*)`)),
    db
      .select({ total: sql<number>`coalesce(sum(${bookingLineItems.amount}), 0)::float` })
      .from(bookings)
      .innerJoin(bookingLineItems, eq(bookingLineItems.bookingId, bookings.id))
      .where(isNotNull(bookings.messageSendId)),
    // `expected` is the replies the day would have had if each send had done
    // exactly as well as its template does overall.
    db
      .select({
        channel: messageSends.channel,
        dow: sentDow,
        sent: sql<number>`count(*)::int`,
        replied: sql<number>`count(${messageSends.respondedAt})::int`,
        expected: sql<number>`coalesce(sum(${templateRates.rate}), 0)::float`,
      })
      .from(messageSends)
      .innerJoin(templateRates, eq(templateRates.presetId, messageSends.presetId))
      .groupBy(messageSends.channel, sentDow),
  ]);

  const emptyWeek = (): DayBucket[] => DAY_LABELS.map((label) => ({ label, sent: 0, replied: 0, adjustedRate: null }));
  const byDay: Record<MessageChannel, DayBucket[]> = { sms: emptyWeek(), email: emptyWeek() };
  const channelTotals = new Map<MessageChannel, { sent: number; replied: number }>();
  for (const row of dayRows) {
    const t = channelTotals.get(row.channel) ?? { sent: 0, replied: 0 };
    channelTotals.set(row.channel, { sent: t.sent + row.sent, replied: t.replied + row.replied });
  }
  for (const row of dayRows) {
    const t = channelTotals.get(row.channel)!;
    const overall = t.sent > 0 ? t.replied / t.sent : 0;
    byDay[row.channel][row.dow - 1] = {
      label: DAY_LABELS[row.dow - 1],
      sent: row.sent,
      replied: row.replied,
      // A day whose templates never get replies has nothing to compare against: fall back to the plain rate.
      adjustedRate: row.expected > 0 ? overall * (row.replied / row.expected) : row.sent > 0 ? row.replied / row.sent : null,
    };
  }

  const empty = (): SendCounts => ({ sent: 0, sentRecent: 0, replied: 0, booked: 0 });
  const byChannel: Record<MessageChannel, SendCounts> = { sms: empty(), email: empty() };
  for (const row of rows) {
    const total = byChannel[row.channel];
    total.sent += row.sent;
    total.sentRecent += row.sentRecent;
    total.replied += row.replied;
    total.booked += row.booked;
  }

  return { ...byChannel, revenue: revenueRow?.total ?? 0, templates: rows, byDay };
}

export interface RecentSend {
  id: string;
  channel: MessageChannel;
  type: PresetType;
  presetName: string;
  sentAt: Date;
  respondedAt: Date | null;
  result: MessageResult;
  agentId: string | null;
  agentName: string | null;
  agentPhone: string | null;
  agentEmail: string | null;
  listingAddress: string | null;
  /** The name the message greeted. Differs from agentName when two people share a number. */
  recipientName: string | null;
}

/**
 * Most recent SMS/email sends across every preset — the "Message history"
 * feed on the messaging page. Same join shape as getAgentSendHistory
 * (src/app/agents/actions.ts), just not filtered to one agent and adding
 * the listing address, since here (unlike an agent's own detail dialog)
 * which property a send was about isn't otherwise obvious.
 */
export async function getRecentMessageSends(limit = 100): Promise<RecentSend[]> {
  return db
    .select({
      id: messageSends.id,
      channel: messageSends.channel,
      type: messageSends.type,
      sentAt: messageSends.sentAt,
      respondedAt: messageSends.respondedAt,
      result: messageSends.result,
      presetName: messagePresets.name,
      agentId: messageSends.agentId,
      agentName: agents.name,
      agentPhone: agents.phone,
      agentEmail: agents.email,
      listingAddress: listings.address,
      // Who the message greeted; older sends didn't store it, and a listing's were written to its agent name.
      recipientName: sql<string | null>`coalesce(${messageSends.recipientName}, ${listings.agentName})`,
    })
    .from(messageSends)
    .innerJoin(messagePresets, eq(messageSends.presetId, messagePresets.id))
    .leftJoin(agents, eq(messageSends.agentId, agents.id))
    .leftJoin(listings, eq(messageSends.listingId, listings.id))
    .orderBy(desc(messageSends.sentAt))
    .limit(limit);
}
