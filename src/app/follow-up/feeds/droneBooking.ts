import { db } from "@/db";
import { agentInteractions, agents, messagePresets, messagePresetVariants, messageSends } from "@/db/schema";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { scoreAgent } from "@/lib/agentBadge";
import { renderMessageBody } from "@/lib/messageTemplate";
import { loadContactHistory, shortDate, volumeLine } from "./shared";
import type { FeedGroup, FeedItem } from "./types";

/**
 * "Free drone with booking": the winter offer (2026-11-09), free drone with
 * any shoot booked through December.
 *
 * Who shows: warm and interested agents he has texted before (it's a text, and
 * a first text to someone he's only emailed reads oddly), not declined or
 * snoozed, with no contact either way in MIN_GAP_DAYS, who haven't had this
 * offer. Biggest agents first: more deals a year, then higher average price.
 *
 * The text is the "Free drone with booking" template's (Messages settings),
 * so it can be edited there; FALLBACK only if that template is gone.
 */

export const FEED_KEY = "drone_booking";
const DAY = 24 * 60 * 60 * 1000;
const MIN_GAP_DAYS = 21;
const PRESET_NAME = "Free drone with booking";
const FALLBACK =
  "Hey {{firstName}}, winter's slowing down on my end, so I'm including free drone with any shoot booked through December. Anything coming up before the end of the year? No worries if not!";
const OFFERED_RE = /free drone with any shoot/i;

export async function getDroneBookingGroup(): Promise<FeedGroup> {
  const group: FeedGroup = { title: "Haven’t talked in 3+ weeks", items: [], heldBack: 0 };
  const known = await db
    .select()
    .from(agents)
    .where(and(inArray(agents.relationshipStatus, ["interested", "warm"]), isNull(agents.declinedAt)));
  if (known.length === 0) return group;
  const ids = known.map((a) => a.id);
  const now = Date.now();

  const [texts, smsSends, [template], history] = await Promise.all([
    db
      .select({ agentId: agentInteractions.agentId, outcome: agentInteractions.outcome, feed: agentInteractions.followUpFeed })
      .from(agentInteractions)
      .where(
        and(
          inArray(agentInteractions.agentId, ids),
          eq(agentInteractions.channel, "text"),
          eq(agentInteractions.direction, "outbound")
        )
      ),
    db
      .selectDistinct({ agentId: messageSends.agentId })
      .from(messageSends)
      .innerJoin(messagePresets, eq(messageSends.presetId, messagePresets.id))
      .where(and(inArray(messageSends.agentId, ids), eq(messagePresets.channel, "sms"))),
    db
      .select({ body: messagePresetVariants.body })
      .from(messagePresetVariants)
      .innerJoin(messagePresets, eq(messagePresetVariants.presetId, messagePresets.id))
      .where(and(eq(messagePresets.name, PRESET_NAME), eq(messagePresetVariants.enabled, true)))
      .orderBy(messagePresetVariants.label)
      .limit(1),
    loadContactHistory(known),
  ]);
  const texted = new Set<string>(texts.filter((t) => t.outcome !== "not_sent").map((t) => t.agentId));
  for (const s of smsSends) if (s.agentId) texted.add(s.agentId);
  const offered = history.offered(OFFERED_RE);
  for (const t of texts) if (t.feed === FEED_KEY) offered.add(t.agentId);
  const body = template?.body ?? FALLBACK;

  const items: FeedItem[] = [];
  for (const agent of known) {
    if (!texted.has(agent.id) || offered.has(agent.id)) continue;
    if (agent.followUpSnoozedUntil && agent.followUpSnoozedUntil.getTime() > now) continue;
    const last = history.lastTouch.get(agent.id) ?? 0;
    if (now - last < MIN_GAP_DAYS * DAY) {
      group.heldBack++;
      continue;
    }
    const lastIn = history.lastIn.get(agent.id) ?? 0;
    items.push({
      agent,
      lastReplyAt: lastIn ? new Date(lastIn) : null,
      label: [last ? `Last in touch ${shortDate(new Date(last))}` : null, volumeLine(agent)].filter(Boolean).join(" · "),
      suggestion: renderMessageBody(body, agent.name, null),
      listing: null,
      editorHref: null,
    });
  }
  // More deals a year first, then higher average price; no numbers at all last.
  const score = new Map(items.map((e) => [e.agent.id, scoreAgent(e.agent)]));
  group.items = items.sort((a, b) => {
    const x = score.get(a.agent.id)!;
    const y = score.get(b.agent.id)!;
    return (y.volumePerYear ?? -1) - (x.volumePerYear ?? -1) || (y.avgPrice ?? -1) - (x.avgPrice ?? -1);
  });
  return group;
}
