import { db } from "@/db";
import { agents, type Agent } from "@/db/schema";
import { inArray, sql } from "drizzle-orm";
import { marketNews, marketNewsLabel } from "@/lib/marketStatus";
import { naturalStreetName } from "@/lib/sms";
import { loadContactHistory, shortDate } from "./shared";
import type { FeedGroup, FeedItem } from "./types";

/**
 * "Graphics": a reminder, not an outreach ask — homes he shot that just went
 * live or just changed status, the two moments worth a "just listed" or
 * "just sold" post. He makes the graphic himself; the card exists so the
 * moment doesn't pass unnoticed, with a caption to start from.
 *
 * Only his own jobs (bookings), so every candidate is already his photo.
 * Within each window, his newest per agent; "already made" is tracked the
 * same way the other offer feeds track an offer (a note or text mentioning
 * "graphic"), since there's no send to detect this one by.
 */

const DAY = 24 * 60 * 60 * 1000;
const LISTED_WINDOW_DAYS = 10;
const SOLD_WINDOW_DAYS = 14;
const MIN_GAP_DAYS = 3;
const MADE_RE = /graphic/i;

interface Row {
  agentId: string | null;
  address: string | null;
  city: string | null;
  price: number | null;
  listedAt: Date | null;
  foundAt: Date | null;
  status: string | null;
  isComingSoon: boolean;
  marketStatus: string | null;
  marketStatusAt: Date | null;
}

export async function getGraphicsGroups(): Promise<FeedGroup[]> {
  const now = Date.now();

  const result = await db.execute(sql`
    select b.contact_agent_id as agent_id,
      coalesce(l.address, b.address) as address,
      coalesce(l.city, b.city) as city,
      l.price, l.listed_at, l.found_at, l.status, coalesce(l.is_coming_soon, false) as is_coming_soon,
      coalesce(b.market_status, l.market_status) as market_status,
      coalesce(b.market_status_at, l.market_status_at) as market_status_at
    from bookings b
    left join listings l on l.id = b.listing_id
    where b.contact_agent_id is not null
      and (
        (l.id is not null and coalesce(l.listed_at, l.found_at) > now() - make_interval(days => ${LISTED_WINDOW_DAYS}))
        or coalesce(b.market_status_at, l.market_status_at) > now() - make_interval(days => ${SOLD_WINDOW_DAYS})
      )
  `);
  const rows = result.rows as unknown as Row[];
  if (rows.length === 0) return [];

  const ids = [...new Set(rows.map((r) => r.agentId).filter((id): id is string => Boolean(id)))];
  const known = await db.select().from(agents).where(inArray(agents.id, ids));
  const byId = new Map(known.map((a) => [a.id, a]));
  const history = await loadContactHistory(known);
  const made = history.offered(MADE_RE);

  const listed: FeedGroup = { title: "Just listed", items: [], heldBack: 0 };
  const sold: FeedGroup = { title: "Just sold", items: [], heldBack: 0 };
  const newestListed = new Map<string, Row>();
  const newestSold = new Map<string, Row>();

  for (const r of rows) {
    if (!r.agentId || !byId.has(r.agentId)) continue;
    const listedAt = r.listedAt ?? r.foundAt;
    if (listedAt && now - new Date(listedAt).getTime() <= LISTED_WINDOW_DAYS * DAY) {
      const prev = newestListed.get(r.agentId);
      if (!prev || new Date(listedAt) > new Date(prev.listedAt ?? prev.foundAt!)) newestListed.set(r.agentId, r);
    }
    if (r.marketStatusAt && marketNews(r.marketStatus) && now - new Date(r.marketStatusAt).getTime() <= SOLD_WINDOW_DAYS * DAY) {
      const prev = newestSold.get(r.agentId);
      if (!prev || new Date(r.marketStatusAt) > new Date(prev.marketStatusAt!)) newestSold.set(r.agentId, r);
    }
  }

  for (const [agentId, r] of newestListed) {
    if (made.has(agentId)) continue;
    const agent = byId.get(agentId)!;
    if (agent.followUpSnoozedUntil && agent.followUpSnoozedUntil.getTime() > now) continue;
    const touched = history.lastTouch.get(agentId) ?? 0;
    if (touched && now - touched < MIN_GAP_DAYS * DAY) {
      listed.heldBack++;
      continue;
    }
    listed.items.push(listedItem(r, agent, history.lastIn.get(agentId) ?? 0));
  }
  for (const [agentId, r] of newestSold) {
    if (made.has(agentId)) continue;
    const agent = byId.get(agentId)!;
    if (agent.followUpSnoozedUntil && agent.followUpSnoozedUntil.getTime() > now) continue;
    const touched = history.lastTouch.get(agentId) ?? 0;
    if (touched && now - touched < MIN_GAP_DAYS * DAY) {
      sold.heldBack++;
      continue;
    }
    sold.items.push(soldItem(r, agent, history.lastIn.get(agentId) ?? 0));
  }
  return [listed, sold];
}

function listedItem(r: Row, agent: Agent, lastIn: number): FeedItem {
  const street = naturalStreetName(r.address);
  const when = r.listedAt ?? r.foundAt!;
  return {
    agent,
    lastReplyAt: lastIn ? new Date(lastIn) : null,
    label: [r.isComingSoon ? "Coming soon" : "Just listed", shortDate(new Date(when)), r.city].filter(Boolean).join(" · "),
    suggestion: [street ? `${street}${r.city ? `, ${r.city}` : ""}` : r.city, r.isComingSoon ? "Coming soon!" : "Just listed!", r.price ? `$${r.price.toLocaleString()}` : null]
      .filter(Boolean)
      .join(" — "),
    listing: null,
    editorHref: null,
    address: r.address,
    city: r.city,
  };
}

function soldItem(r: Row, agent: Agent, lastIn: number): FeedItem {
  const street = naturalStreetName(r.address);
  const kind = marketNews(r.marketStatus)!;
  return {
    agent,
    lastReplyAt: lastIn ? new Date(lastIn) : null,
    label: [marketNewsLabel(kind, r.marketStatusAt), r.city].filter(Boolean).join(" · "),
    suggestion: [
      street ? `${street}${r.city ? `, ${r.city}` : ""}` : r.city,
      kind === "sold" ? "Just Sold!" : kind === "pending" ? "Pending!" : "Under Contract!",
    ]
      .filter(Boolean)
      .join(" — "),
    listing: null,
    editorHref: null,
    address: r.address,
    city: r.city,
  };
}
