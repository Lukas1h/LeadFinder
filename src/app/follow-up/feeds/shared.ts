import { db } from "@/db";
import { agentInteractions, bookings, messageSends, type Agent, type Listing } from "@/db/schema";
import { inArray, isNotNull } from "drizzle-orm";
import { scoreAgent } from "@/lib/agentBadge";
import { marketNews } from "@/lib/marketStatus";
import { addressKey } from "../data";

/** What the offer feeds need to know about each agent's history with him. */
export interface ContactHistory {
  /** Last touch either way: a send, a reply, a logged call or text. */
  lastTouch: Map<string, number>;
  /** Their last reply. */
  lastIn: Map<string, number>;
  /** Agents who've had an offer, by a pattern in what he sent or logged. */
  offered: (pattern: RegExp) => Set<string>;
}

export async function loadContactHistory(agents: Agent[]): Promise<ContactHistory> {
  const ids = agents.map((a) => a.id);
  const [sends, interactions] = ids.length
    ? await Promise.all([
        db
          .select({ agentId: messageSends.agentId, sentAt: messageSends.sentAt, respondedAt: messageSends.respondedAt, body: messageSends.body })
          .from(messageSends)
          .where(inArray(messageSends.agentId, ids)),
        db
          .select({ agentId: agentInteractions.agentId, at: agentInteractions.occurredAt, direction: agentInteractions.direction, note: agentInteractions.note })
          .from(agentInteractions)
          .where(inArray(agentInteractions.agentId, ids)),
      ])
    : [[], []];

  const lastTouch = new Map<string, number>();
  const lastIn = new Map<string, number>();
  const bump = (map: Map<string, number>, id: string, t: number) => map.set(id, Math.max(map.get(id) ?? 0, t));
  for (const a of agents) if (a.lastContactedAt) bump(lastTouch, a.id, a.lastContactedAt.getTime());
  for (const s of sends) {
    if (!s.agentId) continue;
    bump(lastTouch, s.agentId, s.sentAt.getTime());
    if (s.respondedAt) {
      bump(lastTouch, s.agentId, s.respondedAt.getTime());
      bump(lastIn, s.agentId, s.respondedAt.getTime());
    }
  }
  for (const i of interactions) {
    bump(lastTouch, i.agentId, i.at.getTime());
    if (i.direction === "inbound") bump(lastIn, i.agentId, i.at.getTime());
  }
  const offered = (pattern: RegExp) => {
    const out = new Set<string>();
    for (const s of sends) if (s.agentId && pattern.test(s.body ?? "")) out.add(s.agentId);
    for (const i of interactions) if (i.direction === "outbound" && pattern.test(i.note ?? "")) out.add(i.agentId);
    return out;
  };
  return { lastTouch, lastIn, offered };
}

/** Addresses of homes he's shot: an agent's listing there is his work, not a lead. */
export async function shotAddresses(): Promise<Set<string>> {
  const rows = await db.select({ address: bookings.address }).from(bookings).where(isNotNull(bookings.address));
  return new Set(rows.map((b) => addressKey(b.address)).filter((k): k is string => Boolean(k)));
}

export function shotByHim(listing: Listing, shot: Set<string>): boolean {
  const key = addressKey(listing.address);
  return listing.bookingId != null || (key != null && shot.has(key));
}

/** Still for sale, as far as anything knows. Most listings have never had a market check (null). */
export function stillActive(l: Listing): boolean {
  if (marketNews(l.marketStatus)) return false;
  return !l.marketStatus || /^active$|coming soon/i.test(l.marketStatus.trim());
}

/**
 * Lukas's priority (scoreAgent): local first, then high volume further out,
 * then high price, then low volume far away; within a tier, whoever lists
 * most. The order every offer feed is in.
 */
export function byPriority<T extends { agent: Agent }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const x = scoreAgent(a.agent);
    const y = scoreAgent(b.agent);
    return x.rank - y.rank || (y.volumePerYear ?? 0) - (x.volumePerYear ?? 0);
  });
}

export const shortDate = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Los_Angeles" });

/** "~12 deals/yr · ~$450K": the homes.com numbers behind the priority, when we have them. */
export function volumeLine(agent: Agent): string | null {
  const s = scoreAgent(agent);
  const parts = [
    s.volumePerYear != null ? `~${s.volumePerYear} deals/yr` : null,
    s.avgPrice != null ? `~$${Math.round(s.avgPrice / 1000)}K avg` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}
