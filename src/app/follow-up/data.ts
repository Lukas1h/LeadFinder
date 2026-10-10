import { db } from "@/db";
import { agents, agentInteractions, bookings, listings, messageSends, type Agent, type Listing } from "@/db/schema";
import { and, eq, gt, inArray, isNotNull, max } from "drizzle-orm";
import { marketNews, marketNewsLabel, type MarketNews } from "@/lib/marketStatus";

const DAY = 24 * 60 * 60 * 1000;

/** How long a new listing counts as "just listed". */
const JUST_LISTED_DAYS = 21;

/** How long after a listing goes under contract or closes it's still worth a congrats. */
const NEWS_DAYS = 21;

/**
 * Days of silence before someone comes back up. Interested agents asked for
 * samples or pricing, so they're the warmest people Lukas has after his
 * clients and are worth a nudge sooner than the merely warm.
 *
 * A week for them, down from two (2026-10-10): 99% of the replies he has ever
 * had to a text came inside a day, so a week of quiet after the samples went
 * out is already an answer, and nobody who said "sure, send them" in the first
 * 48 had booked. The second touch is where those are won.
 */
const QUIET_DAYS: Record<string, number> = {
  regular: 28,
  worked_once: 28,
  interested: 7,
  warm: 28,
};

export interface FollowUpEntry {
  agent: Agent;
  /** Their latest reply: a send marked replied, or an inbound call/text/email. */
  lastReplyAt: Date | null;
}

export interface JustListedEntry extends FollowUpEntry {
  listing: Listing;
}

export interface NewsEntry extends FollowUpEntry {
  /** The tracked listing, when there is one. A job booked by address alone has none. */
  listing: Listing | null;
  address: string | null;
  city: string | null;
  /** A home Lukas photographed: the congratulation that means the most coming from him. */
  shot: boolean;
  kind: MarketNews;
  /** "Pending since Oct 5" — the words to use, since agents use them precisely. */
  label: string;
  /** When it went under contract or closed. */
  at: Date;
}

/** "1811 NE Alameda Ave" → "1811 alameda". Bookings often aren't linked to a listing, so match by address. */
function addressKey(address: string | null): string | null {
  if (!address) return null;
  const words = address.toLowerCase().replace(/[.,#]/g, " ").split(/\s+/).filter(Boolean);
  const number = words.find((w) => /^\d+$/.test(w));
  const street = words.find((w) => !/^\d/.test(w) && !/^(n|s|e|w|ne|nw|se|sw|north|south|east|west)$/.test(w));
  return number && street ? `${number} ${street}` : null;
}

/**
 * Everything the Follow up page shows:
 *
 * - news: a listing of someone he knows, or a home he shot for them, went
 *   under contract or closed (found by the nightly market check,
 *   lib/marketStatus.ts) and he hasn't been in touch since the check noticed.
 *   Congratulating them is the easiest text there is to send.
 * - justListed: a past client or interested agent put up a listing Lukas
 *   hasn't acted on, and he hasn't been in touch since it appeared. A new
 *   listing is the most natural reason to text someone who already knows him.
 *   Acting on it anywhere (texting them, passing the listing on Leads,
 *   snoozing them here) clears it.
 * - agents: everyone else he knows who has gone quiet, past clients first,
 *   then interested, then warm, longest silence first.
 */
export async function getFollowUpBoard(): Promise<{
  news: NewsEntry[];
  justListed: JustListedEntry[];
  agents: FollowUpEntry[];
}> {
  const candidates = await db
    .select()
    .from(agents)
    .where(inArray(agents.relationshipStatus, ["regular", "worked_once", "interested", "warm"]));
  if (candidates.length === 0) return { news: [], justListed: [], agents: [] };

  const ids = candidates.map((a) => a.id);
  const now = Date.now();

  const newsSince = new Date(now - NEWS_DAYS * DAY);

  const [replies, inbound, outbound, fresh, bookedAddresses, moved, movedJobs] = await Promise.all([
    db
      .select({ agentId: messageSends.agentId, at: max(messageSends.respondedAt) })
      .from(messageSends)
      .where(and(inArray(messageSends.agentId, ids), isNotNull(messageSends.respondedAt)))
      .groupBy(messageSends.agentId),
    db
      .select({ agentId: agentInteractions.agentId, at: max(agentInteractions.occurredAt) })
      .from(agentInteractions)
      .where(and(inArray(agentInteractions.agentId, ids), eq(agentInteractions.direction, "inbound")))
      .groupBy(agentInteractions.agentId),
    db
      .select({ agentId: agentInteractions.agentId, at: max(agentInteractions.occurredAt) })
      .from(agentInteractions)
      .where(and(inArray(agentInteractions.agentId, ids), eq(agentInteractions.direction, "outbound")))
      .groupBy(agentInteractions.agentId),
    db
      .select()
      .from(listings)
      .where(
        and(
          inArray(listings.agentId, ids),
          inArray(listings.status, ["new", "saved"]),
          gt(listings.foundAt, new Date(now - JUST_LISTED_DAYS * DAY))
        )
      ),
    db.select({ address: bookings.address }).from(bookings).where(isNotNull(bookings.address)),
    db
      .select()
      .from(listings)
      .where(and(inArray(listings.agentId, ids), gt(listings.marketStatusAt, newsSince))),
    db
      .select({ booking: bookings, listing: listings })
      .from(bookings)
      .leftJoin(listings, eq(bookings.listingId, listings.id))
      .where(and(inArray(bookings.contactAgentId, ids), gt(bookings.marketStatusAt, newsSince))),
  ]);

  const toMap = (rows: { agentId: string | null; at: Date | null }[]) =>
    new Map(rows.filter((r) => r.agentId && r.at).map((r) => [r.agentId!, r.at!]));
  const replyBySend = toMap(replies);
  const inboundBy = toMap(inbound);
  const outboundBy = toMap(outbound);
  const booked = new Set(bookedAddresses.map((b) => addressKey(b.address)).filter(Boolean));

  const latest = (...dates: (Date | null | undefined)[]): Date | null => {
    const times = dates.filter((d): d is Date => d != null).map((d) => d.getTime());
    return times.length ? new Date(Math.max(...times)) : null;
  };
  const lastReplyAt = (a: Agent) => latest(replyBySend.get(a.id), inboundBy.get(a.id));
  const lastReachedOutAt = (a: Agent) => latest(a.lastContactedAt, outboundBy.get(a.id));
  const lastTouchAt = (a: Agent) => latest(lastReachedOutAt(a), lastReplyAt(a));

  // Newest qualifying listing per agent.
  const newestListing = new Map<string, Listing>();
  for (const l of fresh) {
    if (!l.agentId || l.bookingId) continue;
    const key = addressKey(l.address);
    if (key && booked.has(key)) continue;
    const prev = newestListing.get(l.agentId);
    if (!prev || l.foundAt > prev.foundAt) newestListing.set(l.agentId, l);
  }

  const rank = (s: string) => (s === "regular" || s === "worked_once" ? 0 : s === "interested" ? 1 : 2);

  // One piece of news per agent: a home he shot before anything else of
  // theirs, then whichever happened most recently.
  interface Sale {
    listing: Listing | null;
    address: string | null;
    city: string | null;
    shot: boolean;
    status: string | null;
    at: Date;
    noticedAt: Date | null;
  }
  const latestNews = new Map<string, Sale>();
  const offer = (agentId: string | null, sale: Sale) => {
    if (!agentId || !marketNews(sale.status)) return;
    const prev = latestNews.get(agentId);
    if (!prev || (sale.shot && !prev.shot) || (sale.shot === prev.shot && sale.at > prev.at)) {
      latestNews.set(agentId, sale);
    }
  };
  for (const l of moved) {
    if (!l.marketStatusAt) continue;
    const key = addressKey(l.address);
    offer(l.agentId, {
      listing: l,
      address: l.address,
      city: l.city,
      shot: l.bookingId != null || (key != null && booked.has(key)),
      status: l.marketStatus,
      at: l.marketStatusAt,
      noticedAt: l.marketNoticedAt,
    });
  }
  for (const { booking: b, listing } of movedJobs) {
    if (!b.marketStatusAt) continue;
    offer(b.contactAgentId, {
      listing,
      address: listing?.address ?? b.address,
      city: listing?.city ?? b.city,
      shot: true,
      status: b.marketStatus,
      at: b.marketStatusAt,
      noticedAt: b.marketNoticedAt,
    });
  }

  const news: NewsEntry[] = [];
  const justListed: JustListedEntry[] = [];
  const rest: FollowUpEntry[] = [];

  for (const agent of candidates) {
    const sale = latestNews.get(agent.id);
    if (sale) {
      // Against when the check noticed, not the contract date: a text sent in
      // between, before anyone here knew, wasn't a congratulation.
      const since = (sale.noticedAt ?? sale.at).getTime();
      const reachedOut = lastReachedOutAt(agent);
      const snoozed = agent.followUpDismissedAt && agent.followUpDismissedAt.getTime() > since;
      if (!snoozed && (!reachedOut || reachedOut.getTime() < since)) {
        const kind = marketNews(sale.status)!;
        news.push({
          agent,
          listing: sale.listing,
          address: sale.address,
          city: sale.city,
          shot: sale.shot,
          kind,
          label: marketNewsLabel(kind, sale.at),
          at: sale.at,
          lastReplyAt: lastReplyAt(agent),
        });
        continue;
      }
    }

    const listing = newestListing.get(agent.id);
    if (listing && rank(agent.relationshipStatus) <= 1) {
      const since = listing.foundAt.getTime();
      const reachedOut = lastReachedOutAt(agent);
      const snoozed = agent.followUpDismissedAt && agent.followUpDismissedAt.getTime() > since;
      if (!snoozed && (!reachedOut || reachedOut.getTime() < since)) {
        justListed.push({ agent, listing, lastReplyAt: lastReplyAt(agent) });
        continue;
      }
    }

    const cutoff = now - (QUIET_DAYS[agent.relationshipStatus] ?? 28) * DAY;
    if (agent.followUpDismissedAt && agent.followUpDismissedAt.getTime() > now - 28 * DAY) continue;
    const touched = lastTouchAt(agent);
    if (touched && touched.getTime() >= cutoff) continue;
    rest.push({ agent, lastReplyAt: lastReplyAt(agent) });
  }

  news.sort(
    (a, b) =>
      Number(b.shot) - Number(a.shot) ||
      rank(a.agent.relationshipStatus) - rank(b.agent.relationshipStatus) ||
      b.at.getTime() - a.at.getTime()
  );
  justListed.sort(
    (a, b) =>
      rank(a.agent.relationshipStatus) - rank(b.agent.relationshipStatus) ||
      b.listing.foundAt.getTime() - a.listing.foundAt.getTime()
  );
  rest.sort((a, b) => {
    const diff = rank(a.agent.relationshipStatus) - rank(b.agent.relationshipStatus);
    if (diff !== 0) return diff;
    return (lastTouchAt(a.agent)?.getTime() ?? -Infinity) - (lastTouchAt(b.agent)?.getTime() ?? -Infinity);
  });

  return { news, justListed, agents: rest };
}
