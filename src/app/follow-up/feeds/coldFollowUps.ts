import { COLD_FEED_KEYS, type ColdFeedKey } from "@/lib/coldFollowUp/pool";
import { loadAgentSegments, type AgentSegment } from "@/lib/coldFollowUp/segment";
import { getColdFollowUpCandidates, type ColdCandidate } from "@/lib/coldFollowUp/triggers";
import { loadColdTemplates, renderColdTexts, type ColdPitch } from "@/lib/coldFollowUp/messages";
import { shortDate } from "./shared";
import type { FeedGroup, FeedItem } from "./types";

/**
 * The cold feeds: agents Lukas texted once who never answered, on the Follow
 * up page's own "Cold" tabs after the warm ones. Each card has two texts —
 * the excuse for writing now, then the pitch — because the first text is the
 * one this person already ignored.
 *
 * The pool and triggers (21 days of silence, one cold follow-up ever, the
 * strongest available excuse) live in src/lib/coldFollowUp/; this is just the
 * page's shape of them.
 */

/** The cold tabs the page shows. One at a time while they're being written, so the list stays small. */
export const ENABLED_COLD_FEEDS: ColdFeedKey[] = ["cold_new_listing"];

/** Tab titles for the cold feeds (feeds/index.ts), warm feeds' style: short, in his words. */
export const COLD_FEED_TITLES: Record<ColdFeedKey, string> = {
  cold_new_listing: "Cold: new listing",
  cold_near_shoot: "Cold: shot one near you",
  cold_in_area: "Cold: in the area",
};

/**
 * What each cold tab is, in a sentence or two. All three share the shape: cold
 * agents, one follow-up ever, Ignored if they stay quiet 3 days, text 1 the
 * excuse and text 2 the pitch.
 */
const COLD_ONLY =
  "One follow-up only: if they don’t answer within 3 days they’re marked Ignored. Text 1 is the excuse, text 2 the pitch (picked by whether they already have a photographer).";

export const COLD_FEED_BLURBS: Record<ColdFeedKey, string> = {
  cold_new_listing:
    "Cold agents you texted 3+ weeks ago who never replied, with a listing put up in the last 10 days. " + COLD_ONLY,
  cold_near_shoot:
    "Cold agents you texted 3+ weeks ago who never replied, with a listing for sale near a home you shot in the last 30 days. " +
    COLD_ONLY,
  cold_in_area:
    "Cold agents you texted 3+ weeks ago who never replied, with a listing within 15 miles of a job you shot in the last 10 days, outside Roseburg. " +
    COLD_ONLY,
};

/** Group title per trigger: the reason the card leads with. */
const GROUP_TITLES: Record<ColdFeedKey, string> = {
  cold_new_listing: "Listed since your text",
  cold_near_shoot: "Near a recent shoot",
  cold_in_area: "In their area",
};

/** The one line under the agent's name: dates, what they already have, and the pitch. */
function label(c: ColdCandidate, seg: AgentSegment | undefined, pitch: ColdPitch): string {
  const listedAt = c.listing.listedAt ?? c.listing.foundAt;
  const photos =
    seg?.segment === "has_photographer"
      ? `has a photographer${seg.weightedScore != null ? ` ${seg.weightedScore.toFixed(1)}` : ""}`
      : seg?.segment === "no_photographer"
        ? `no regular photographer${seg.weightedScore != null ? ` ${seg.weightedScore.toFixed(1)}` : ""}`
        : "photos unknown";
  return [
    `Listed ${shortDate(listedAt)}`,
    `Texted ${shortDate(c.lastTextedAt)}`,
    photos,
    `pitch: ${pitch}`,
  ].join(" · ");
}

/**
 * Every cold feed, empty ones included: the page decides what to show, and a
 * tab with nobody due should explain itself rather than vanish.
 */
export async function getColdFollowUpGroups(): Promise<Record<ColdFeedKey, FeedGroup>> {
  const groups = {} as Record<ColdFeedKey, FeedGroup>;
  for (const key of COLD_FEED_KEYS) {
    groups[key] = { title: GROUP_TITLES[key], items: [], heldBack: 0 };
  }

  const candidates = await getColdFollowUpCandidates(Date.now(), ENABLED_COLD_FEEDS);
  if (candidates.length === 0) return groups;

  const [segments, templates] = await Promise.all([
    loadAgentSegments(candidates.map((c) => c.agent.id)),
    loadColdTemplates(),
  ]);

  // The candidates arrive strongest trigger first, then longest silence: kept as-is.
  for (const c of candidates) {
    const seg = segments.get(c.agent.id);
    const { text1, text2, pitch } = renderColdTexts(c, seg, templates);
    const item: FeedItem = {
      agent: c.agent,
      lastReplyAt: null,
      listing: c.listing,
      editorHref: null,
      suggestion: text1,
      secondText: text2,
      label: label(c, seg, pitch),
    };
    groups[c.trigger].items.push(item);
  }
  return groups;
}
