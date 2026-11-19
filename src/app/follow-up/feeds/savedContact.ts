import { db } from "@/db";
import { agents } from "@/db/schema";
import { and, isNotNull, lte } from "drizzle-orm";
import { byPriority, loadContactHistory, shortDate, volumeLine } from "./shared";
import type { FeedGroup, FeedItem } from "./types";

/**
 * "Saved your contact, quiet 3 weeks": agents known to have saved Lukas's
 * contact card — automatically when they tapped "Save my contact" on their
 * portfolio page, or marked by hand — and then went quiet: no text, call or
 * reply either way for 21+ days. They kept his number, so they meant to use
 * it; a friendly check-in is enough to be the one they think of for the next
 * listing.
 *
 * Gone once either side gets in touch again (a text from here is that), and
 * never for declined or snoozed agents. One card per agent.
 */

const DAY = 24 * 60 * 60 * 1000;
const MIN_DAYS = 21;

export async function getSavedContactGroup(): Promise<FeedGroup> {
  const group: FeedGroup = { title: "Saved your contact, quiet 3 weeks", items: [], heldBack: 0 };
  const now = Date.now();
  const people = await db
    .select()
    .from(agents)
    .where(and(isNotNull(agents.savedContactAt), lte(agents.savedContactAt, new Date(now - MIN_DAYS * DAY))));
  if (people.length === 0) return group;

  const history = await loadContactHistory(people);

  const items: FeedItem[] = [];
  for (const agent of people) {
    const at = agent.savedContactAt!.getTime();
    if (
      agent.declinedAt ||
      agent.ignoredAt ||
      agent.relationshipStatus === "declined" ||
      agent.relationshipStatus === "ignored"
    )
      continue;
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
