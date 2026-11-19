import { db } from "@/db";
import { agents, messagePresets, messageSends, portfolioLinks } from "@/db/schema";
import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { byPriority, loadContactHistory, shortDate, volumeLine } from "./shared";
import type { FeedGroup, FeedItem } from "./types";

/**
 * "Opened, bounced": agents who got the "Portfolio link" text 3–21 days ago,
 * opened their page but barely looked (agents.portfolio_engagement = "bounced";
 * see isPortfolioBounce in src/lib/portfolioEngagement.ts), and haven't said
 * anything since. Same send window and exclusions as opened.ts — gone once
 * they reply or hear from him again after the link, and never for declined or
 * snoozed agents — but they never really saw the work, so the nudge checks the
 * link came through rather than asking what's in the pipeline.
 */

const DAY = 24 * 60 * 60 * 1000;
const MIN_DAYS = 3;
const MAX_DAYS = 21;
const PRESET_NAME = "Portfolio link";

export async function getOpenedBouncedGroup(): Promise<FeedGroup> {
  const group: FeedGroup = { title: "Opened, bounced", items: [], heldBack: 0 };
  const now = Date.now();
  const sends = await db
    .select({ agentId: messageSends.agentId, sentAt: messageSends.sentAt })
    .from(messageSends)
    .innerJoin(messagePresets, eq(messageSends.presetId, messagePresets.id))
    .where(
      and(
        inArray(messagePresets.name, [PRESET_NAME, "Portfolio link: featured shoot"]),
        gte(messageSends.sentAt, new Date(now - MAX_DAYS * DAY)),
        lte(messageSends.sentAt, new Date(now - MIN_DAYS * DAY))
      )
    )
    .orderBy(desc(messageSends.sentAt));
  const sentAt = new Map<string, Date>();
  for (const s of sends) if (s.agentId && !sentAt.has(s.agentId)) sentAt.set(s.agentId, s.sentAt);
  if (sentAt.size === 0) return group;
  const ids = [...sentAt.keys()];

  const [people, links] = await Promise.all([
    db.select().from(agents).where(inArray(agents.id, ids)),
    db
      .select({ agentId: portfolioLinks.agentId, slug: portfolioLinks.slug })
      .from(portfolioLinks)
      .where(inArray(portfolioLinks.agentId, ids))
      .orderBy(desc(portfolioLinks.createdAt)),
  ]);
  const newestLink = new Map<string, string>();
  for (const l of links) if (l.agentId && !newestLink.has(l.agentId)) newestLink.set(l.agentId, l.slug);
  const history = await loadContactHistory(people);

  const items: FeedItem[] = [];
  for (const agent of people) {
    const at = sentAt.get(agent.id)!.getTime();
    const slug = newestLink.get(agent.id);
    if (!slug) continue;
    if (agent.portfolioEngagement !== "bounced") continue;
    if (
      agent.declinedAt ||
      agent.ignoredAt ||
      agent.relationshipStatus === "declined" ||
      agent.relationshipStatus === "ignored"
    )
      continue;
    if (agent.followUpSnoozedUntil && agent.followUpSnoozedUntil.getTime() > now) continue;
    // Anything from either side after the link (a minute's slack for the send's own record) means it's moved on.
    if ((history.lastTouch.get(agent.id) ?? 0) > at + 60_000) continue;

    const lastIn = history.lastIn.get(agent.id) ?? 0;
    items.push({
      agent,
      lastReplyAt: lastIn ? new Date(lastIn) : null,
      label: [`Link sent ${shortDate(new Date(at))}, opened but barely looked`, volumeLine(agent)].filter(Boolean).join(" · "),
      suggestion:
        "Hey! Not sure if that link came through alright. Here are a couple of my favorite recent shoots, happy to send pricing too if helpful!",
      listing: null,
      editorHref: null,
    });
  }
  group.items = byPriority(items);
  return group;
}
