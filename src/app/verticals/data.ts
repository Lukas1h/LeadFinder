import { and, count, desc, eq, inArray, max, sql, sum } from "drizzle-orm";
import { db } from "@/db";
import { verticalEvents, verticalLinks, verticalSessions, type VerticalLink } from "@/db/schema";
import { getVertical } from "@/lib/verticals";
import { verticalUrl } from "@/lib/verticalLink";

export type VerticalLinkRow = VerticalLink & {
  url: string;
  visits: number;
  activeSeconds: number;
  maxScrollPct: number;
  savedContact: boolean;
  textedMe: boolean;
  lastSeenAt: Date | null;
};

/** One vertical's links, newest first, each with its visit totals and whether they saved his contact / texted him. */
export async function listVerticalLinks(vertical: string): Promise<VerticalLinkRow[]> {
  const v = getVertical(vertical);
  if (!v) return [];
  const links = await db.select().from(verticalLinks).where(eq(verticalLinks.vertical, v.key)).orderBy(desc(verticalLinks.createdAt));
  if (links.length === 0) return [];
  const ids = links.map((l) => l.id);
  const [visits, events] = await Promise.all([
    db
      .select({
        linkId: verticalSessions.linkId,
        visits: count(),
        activeSeconds: sum(verticalSessions.activeSeconds).mapWith(Number),
        maxScrollPct: max(verticalSessions.maxScrollPct),
        lastSeenAt: max(verticalSessions.lastSeenAt),
      })
      .from(verticalSessions)
      .where(inArray(verticalSessions.linkId, ids))
      .groupBy(verticalSessions.linkId),
    db
      .selectDistinct({ linkId: verticalEvents.linkId, event: verticalEvents.event })
      .from(verticalEvents)
      .where(and(inArray(verticalEvents.linkId, ids), inArray(verticalEvents.event, ["save_contact", "text_me"]))),
  ]);
  const byLink = new Map(visits.map((r) => [r.linkId, r]));
  const has = new Set(events.map((e) => `${e.linkId}:${e.event}`));
  return links.map((l) => {
    const s = byLink.get(l.id);
    return {
      ...l,
      url: verticalUrl(v, l.slug),
      visits: s?.visits ?? 0,
      activeSeconds: s?.activeSeconds ?? 0,
      maxScrollPct: s?.maxScrollPct ?? 0,
      lastSeenAt: s?.lastSeenAt ?? null,
      savedContact: has.has(`${l.id}:save_contact`),
      textedMe: has.has(`${l.id}:text_me`),
    };
  });
}

/** Per vertical: links made, opened, and how many saved his contact. For the /verticals hub. */
export async function verticalCounts(): Promise<Record<string, { links: number; opened: number; saved: number }>> {
  const rows = await db
    .select({
      vertical: verticalLinks.vertical,
      links: count(),
      opened: sql<number>`count(*) filter (where ${verticalLinks.viewCount} > 0)`.mapWith(Number),
      saved: sql<number>`count(*) filter (where exists (select 1 from ${verticalEvents} e where e.link_id = ${verticalLinks.id} and e.event = 'save_contact'))`.mapWith(Number),
    })
    .from(verticalLinks)
    .groupBy(verticalLinks.vertical);
  return Object.fromEntries(rows.map((r) => [r.vertical, { links: r.links, opened: r.opened, saved: r.saved }]));
}
