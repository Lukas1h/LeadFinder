import { COLD_FEED_KEYS, COLD_TRIGGERS, type ColdFeedKey, type ColdTrigger } from "@/lib/coldFollowUp/pool";
import { loadAgentSegments, type AgentSegment } from "@/lib/coldFollowUp/segment";
import { getColdFollowUpCandidates, type ColdCandidate } from "@/lib/coldFollowUp/triggers";
import { loadColdTemplates, pitchFeedKey, renderColdTexts } from "@/lib/coldFollowUp/messages";
import { shortDate } from "./shared";
import type { FeedGroup, FeedItem } from "./types";

/**
 * The cold feeds: agents Lukas texted once who never answered, on the Follow
 * up page's own "Cold" tabs after the warm ones. One tab per pitch, so every
 * card on a tab sends the same second text and that tab's own numbers
 * (`follow_up_feed`) measure that pitch; the trigger — the excuse text 1 leads
 * with — is a group inside the tab.
 *
 * The pool and triggers (21 days of silence, one cold follow-up ever, the
 * strongest available excuse) live in src/lib/coldFollowUp/; this is just the
 * page's shape of them.
 */

/** The triggers the page draws candidates from. New listing on its own while the other two wait for the portfolio page. */
export const ENABLED_COLD_TRIGGERS: ColdTrigger[] = ["new_listing"];

/** Tab titles, one per pitch (feeds/index.ts), warm feeds' style: short, in his words. */
export const COLD_FEED_TITLES: Record<ColdFeedKey, string> = {
  cold_samples: "Cold: samples ask",
  cold_video: "Cold: video (high end)",
  cold_turnaround: "Cold: turnaround",
  cold_soft: "Cold: soft nudge",
};

/**
 * What each cold tab is: who lands on it, and which second text it sends. The
 * tail is the same on all four, since the pool and the one-follow-up rule are.
 */
const COLD_ONLY =
  " Cold agents you texted 3+ weeks ago who never replied, with a fresh excuse. One follow-up only: no answer in 3 days and they’re marked Ignored.";

export const COLD_FEED_BLURBS: Record<ColdFeedKey, string> = {
  cold_samples:
    "Cold agents first texted before Oct 5, so they never got the samples question. Text 1 is the excuse, text 2 asks if you can send a few samples." +
    COLD_ONLY,
  cold_video:
    "High-end cold agents who already have a photographer. Text 2 asks whether their photographer does video." +
    COLD_ONLY,
  cold_turnaround:
    "Cold agents who already have a photographer. Text 2 asks how fast their photographer delivers." + COLD_ONLY,
  cold_soft:
    "Cold agents without a regular photographer (or no photo data). Text 2 is a soft nudge offering a few pics from a recent shoot." +
    COLD_ONLY,
};

/** Group title per trigger: the excuse the card leads with (the tab already says the pitch). */
const GROUP_TITLES: Record<ColdTrigger, string> = {
  new_listing: "Listed since your text",
  near_shoot: "Near a recent shoot",
  in_area: "In their area",
};

/** The one line under the agent's name: dates, and what they already have. */
function label(c: ColdCandidate, seg: AgentSegment | undefined): string {
  const listedAt = c.listing.listedAt ?? c.listing.foundAt;
  const photos =
    seg?.segment === "has_photographer"
      ? `has a photographer${seg.weightedScore != null ? ` ${seg.weightedScore.toFixed(1)}` : ""}`
      : seg?.segment === "no_photographer"
        ? `no regular photographer${seg.weightedScore != null ? ` ${seg.weightedScore.toFixed(1)}` : ""}`
        : "photos unknown";
  return [`Listed ${shortDate(listedAt)}`, `Texted ${shortDate(c.lastTextedAt)}`, photos].join(" · ");
}

/**
 * Every cold feed's groups, empty ones included and in COLD_TRIGGERS order: the
 * page decides what to show, and buildFeeds drops the tabs with nobody on them.
 */
export async function getColdFollowUpGroups(): Promise<Record<ColdFeedKey, FeedGroup[]>> {
  const items = {} as Record<ColdFeedKey, Record<ColdTrigger, FeedItem[]>>;
  for (const key of COLD_FEED_KEYS) {
    items[key] = { near_shoot: [], in_area: [], new_listing: [] };
  }

  const candidates = await getColdFollowUpCandidates(Date.now(), ENABLED_COLD_TRIGGERS);
  if (candidates.length > 0) {
    const [segments, templates] = await Promise.all([
      loadAgentSegments(candidates.map((c) => c.agent.id)),
      loadColdTemplates(),
    ]);

    // The candidates arrive strongest trigger first, then longest silence: kept as-is.
    for (const c of candidates) {
      const seg = segments.get(c.agent.id);
      const { text1, text2, pitch } = renderColdTexts(c, seg, templates);
      items[pitchFeedKey(pitch)][c.trigger].push({
        agent: c.agent,
        lastReplyAt: null,
        listing: c.listing,
        editorHref: null,
        suggestion: text1,
        secondText: text2,
        label: label(c, seg),
      });
    }
  }

  const groups = {} as Record<ColdFeedKey, FeedGroup[]>;
  for (const key of COLD_FEED_KEYS) {
    // A trigger with nobody in it has no heading to explain, so it's left out.
    groups[key] = COLD_TRIGGERS.filter((t) => items[key][t].length > 0).map((t) => ({
      title: GROUP_TITLES[t],
      items: items[key][t],
      heldBack: 0,
    }));
  }
  return groups;
}
