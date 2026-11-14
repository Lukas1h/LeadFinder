import { db } from "@/db";
import { agents, portfolioEvents, portfolioLinks } from "@/db/schema";
import { and, desc, eq, inArray, lte } from "drizzle-orm";
import { byPriority, loadContactHistory, shortDate, volumeLine } from "./shared";
import type { FeedGroup, FeedItem } from "./types";

/**
 * "Saved your contact, quiet 3 weeks": agents who tapped "Save my contact" on
 * their portfolio page and then went quiet — no text, call or reply either way
 * for 21+ days. They kept his number, so they meant to use it; a friendly
 * check-in is enough to be the one they think of for the next listing.
 *
 * Gone once either side gets in touch again (a text from here is that), and
 * never for declined or snoozed agents. One card per agent: their newest save.
 */

const DAY = 24 * 60 * 60 * 1000;
const MIN_DAYS = 21;

export async function getSavedContactGroup(): Promise<FeedGroup> {
  const group: FeedGroup = { title: "Saved your contact, quiet 3 weeks", items: [], heldBack: 0 };
  const now = Date.now();
  const saves = await db
    .select({ agentId: portfolioLinks.agentId, at: portfolioEvents.at })
    .from(portfolioEvents)
    .innerJoin(portfolioLinks, eq(portfolioEvents.linkId, portfolioLinks.id))
    .where(
      and(
        eq(portfolioEvents.event, "save_contact"),
        lte(portfolioEvents.at, new Date(now - MIN_DAYS * DAY))
      )
    )
    .orderBy(desc(portfolioEvents.at));
  const savedAt = new Map<string, Date>();
  for (const s of saves) if (s.agentId && !savedAt.has(s.agentId)) savedAt.set(s.agentId, s.at);
  if (savedAt.size === 0) return group;
  const ids = [...savedAt.keys()];

  const people = await db.select().from(agents).where(inArray(agents.id, ids));
  const history = await loadContactHistory(people);

  const items: FeedItem[] = [];
  for (const agent of people) {
    const at = savedAt.get(agent.id)!.getTime();
    if (agent.declinedAt || agent.relationshipStatus === "declined") continue;
    if (agent.followUpSnoozedUntil && agent.followUpSnoozedUntil.getTime() > now) continue;
    // Quiet since the last touch either way, or since the save itself if there's been none.
    const quietSince = Math.max(at, history.lastTouch.get(agent.id) ?? 0);
    if (now - quietSince < MIN_DAYS * DAY) continue;
    const quietDays = Math.floor((now - quietSince) / DAY);

    const firstName = agent.name?.trim().split(/\s+/)[0];
    const lastIn = history.lastIn.get(agent.id) ?? 0;
    items.push({
      agent,
      lastReplyAt: lastIn ? new Date(lastIn) : null,
      label: [`Saved your contact ${shortDate(new Date(at))} · quiet ${quietDays} days`, volumeLine(agent)]
        .filter(Boolean)
        .join(" · "),
      suggestion: `Hey${firstName ? ` ${firstName}` : ""}, it's Lukas, the photographer. Hope your fall's going well! Anything coming up I can help with?`,
      listing: null,
      editorHref: null,
    });
  }
  group.items = byPriority(items);
  return group;
}
