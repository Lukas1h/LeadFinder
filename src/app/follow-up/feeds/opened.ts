import { db } from "@/db";
import { agents, messagePresets, messageSends, portfolioLinks, portfolioSessions } from "@/db/schema";
import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { byPriority, loadContactHistory, shortDate, volumeLine } from "./shared";
import type { FeedGroup, FeedItem } from "./types";

/**
 * "Opened, no reply": agents who got the "Portfolio link" text 3–21 days ago,
 * opened their page (a real portfolio_sessions visit), and haven't said
 * anything since. The other half of unopened.ts, with the same exclusions:
 * gone once they reply or hear from him again after the link, and never for
 * declined or snoozed agents.
 */

const DAY = 24 * 60 * 60 * 1000;
const MIN_DAYS = 3;
const MAX_DAYS = 21;
const PRESET_NAME = "Portfolio link";

export async function getOpenedNoReplyGroup(): Promise<FeedGroup> {
  const group: FeedGroup = { title: "Opened, no reply", items: [], heldBack: 0 };
  const now = Date.now();
  const sends = await db
    .select({ agentId: messageSends.agentId, sentAt: messageSends.sentAt })
    .from(messageSends)
    .innerJoin(messagePresets, eq(messageSends.presetId, messagePresets.id))
    .where(
      and(
        eq(messagePresets.name, PRESET_NAME),
        gte(messageSends.sentAt, new Date(now - MAX_DAYS * DAY)),
        lte(messageSends.sentAt, new Date(now - MIN_DAYS * DAY))
      )
    )
    .orderBy(desc(messageSends.sentAt));
  const sentAt = new Map<string, Date>();
  for (const s of sends) if (s.agentId && !sentAt.has(s.agentId)) sentAt.set(s.agentId, s.sentAt);
  if (sentAt.size === 0) return group;
  const ids = [...sentAt.keys()];

  const [people, links, opened] = await Promise.all([
    db.select().from(agents).where(inArray(agents.id, ids)),
    db
      .select({ agentId: portfolioLinks.agentId, slug: portfolioLinks.slug })
      .from(portfolioLinks)
      .where(inArray(portfolioLinks.agentId, ids))
      .orderBy(desc(portfolioLinks.createdAt)),
    db
      .selectDistinct({ agentId: portfolioLinks.agentId })
      .from(portfolioSessions)
      .innerJoin(portfolioLinks, eq(portfolioSessions.linkId, portfolioLinks.id))
      .where(inArray(portfolioLinks.agentId, ids)),
  ]);
  const seen = new Set(opened.map((o) => o.agentId));
  const newestLink = new Map<string, string>();
  for (const l of links) if (l.agentId && !newestLink.has(l.agentId)) newestLink.set(l.agentId, l.slug);
  const history = await loadContactHistory(people);

  const items: FeedItem[] = [];
  for (const agent of people) {
    const at = sentAt.get(agent.id)!.getTime();
    const slug = newestLink.get(agent.id);
    if (!slug || !seen.has(agent.id)) continue;
    if (agent.declinedAt || agent.relationshipStatus === "declined") continue;
    if (agent.followUpSnoozedUntil && agent.followUpSnoozedUntil.getTime() > now) continue;
    // Anything from either side after the link (a minute's slack for the send's own record) means it's moved on.
    if ((history.lastTouch.get(agent.id) ?? 0) > at + 60_000) continue;

    const lastIn = history.lastIn.get(agent.id) ?? 0;
    items.push({
      agent,
      lastReplyAt: lastIn ? new Date(lastIn) : null,
      label: [`Link sent ${shortDate(new Date(at))}, opened, no reply`, volumeLine(agent)].filter(Boolean).join(" · "),
      suggestion: "Anything coming up for you in November? I'd love to include free drone shots on your first shoot with me.",
      listing: null,
      editorHref: null,
    });
  }
  group.items = byPriority(items);
  return group;
}
