import { connection } from "next/server";
import type { FollowUpBoard, FollowUpItem, FollowUpReason } from "../data";
import { getDroneOffers } from "../droneOffers";
import { getBackOnMarketGroup } from "./backOnMarket";
import { getGraphicsGroups } from "./graphics";
import { getPhotoTouchUpGroups } from "./photoTouchUps";
import { byPriority } from "./shared";
import { FEED_STATS_DAYS, getFeedStats, type FeedStats } from "./stats";
import { getStagingGroup } from "./staging";
import { getTwilightGiftGroup } from "./twilightGifts";
import type { FeedGroup, FeedItem, FollowUpFeed } from "./types";

export type { FeedGroup, FeedItem, FollowUpFeed, FollowUpFeedKey } from "./types";

/** The offer feeds: the ones not found by the board. Fetched alongside it, then merged by buildFeeds. */
export interface OfferFeeds {
  touchUps: FeedGroup[];
  backOnMarket: FeedGroup;
  twilight: FeedGroup;
  staging: FeedGroup;
  graphics: FeedGroup[];
  drone: FeedGroup[];
  stats: Map<string, FeedStats>;
}

export async function getOfferFeeds(): Promise<OfferFeeds> {
  // Before anything below reads Date.now(): request-time rendering has to be
  // established before any of these parallel branches touch the clock, or
  // whichever gets there first (not necessarily this one) fails the build.
  await connection();
  const [touchUps, backOnMarket, staging, graphics, drone, stats] = await Promise.all([
    getPhotoTouchUpGroups(),
    getBackOnMarketGroup(),
    getStagingGroup(),
    getGraphicsGroups(),
    getDroneOffers(),
    getFeedStats(),
  ]);
  // A twilight gift is for an agent with nothing better on offer: not someone already in Relaunch.
  const relaunching = new Set([...touchUps, backOnMarket].flatMap((g) => g.items.map((e) => e.agent.id)));
  const twilight = await getTwilightGiftGroup(relaunching);
  return {
    touchUps,
    backOnMarket,
    twilight,
    staging,
    graphics,
    drone: drone.map((g) => ({
      title: g.title,
      heldBack: g.heldBack,
      items: byPriority(g.items.map((e) => ({ ...e, listing: null, editorHref: null }))),
    })),
    stats,
  };
}

/**
 * Every feed, in tab order: the reasons strongest first, the offers, the
 * plain check-ins last. Within a board feed the board's own order holds (it
 * already ranks by Lukas's volume/price/location priority); the offer feeds
 * sort by the same priority themselves. A feed with nobody in it is left out,
 * and an offer never repeats a listing a board feed already shows.
 *
 * Cut 2026-10-21: warm agents' "just checking in" and their good-photo "just
 * listed" (the board no longer raises either), and the separate Price cuts
 * and Photo touch-ups tabs, which were the same moment and now share Relaunch.
 */
export function buildFeeds(board: Pick<FollowUpBoard, "today" | "later">, offers: OfferFeeds): FollowUpFeed[] {
  const due = [...board.today, ...board.later];
  const shown = new Set(due.flatMap((e) => (e.listing ? [e.listing.id] : [])));
  const group = (title: string, match: (e: FollowUpItem) => boolean): FeedGroup => ({
    title,
    heldBack: 0,
    items: due.filter(match).map(fromBoard),
  });
  const reason = (...reasons: FollowUpReason[]) => (e: FollowUpItem) => reasons.includes(e.reason);
  const notShown = (g: FeedGroup): FeedGroup => ({
    ...g,
    items: g.items.filter((e) => !e.listing || !shown.has(e.listing.id)),
  });
  const [touchUpCuts, touchUpSitting] = offers.touchUps;
  const boardCuts = group("Price cut", reason("price_cut"));

  const feeds: FollowUpFeed[] = [
    {
      key: "new_listings",
      title: "New listings",
      blurb: "They just put up a listing and you haven’t been in touch since. Weak photos first: that one is work. Good-photo listings only show for clients and interested agents.",
      groups: [group("Weak photos", reason("weak_photos")), group("Just listed", reason("just_listed"))],
    },
    {
      key: "relaunch",
      title: "Relaunch",
      blurb:
        "A listing that isn’t selling: back on the market after a deal fell through, a price cut, or sitting 3+ weeks with weak photos. Offer one edited photo as a demo, then the reshoot.",
      groups: [
        notShown(offers.backOnMarket),
        {
          title: "Price cut",
          heldBack: (touchUpCuts?.heldBack ?? 0) + boardCuts.heldBack,
          items: byPriority([...boardCuts.items, ...(touchUpCuts ? notShown(touchUpCuts).items : [])]),
        },
        ...(touchUpSitting ? [notShown(touchUpSitting)] : []),
      ],
    },
    {
      key: "samples",
      title: "Samples",
      blurb: "You emailed samples two to six weeks ago and neither of you has said anything since.",
      groups: [group("No word since the samples", reason("samples"))],
    },
    {
      key: "congrats",
      title: "Congrats",
      blurb: "A listing of theirs, or a home you shot, went under contract or closed since you were last in touch.",
      groups: [
        group("Homes you shot", (e) => e.reason === "news" && e.label.endsWith("you shot it")),
        group("Their sales", (e) => e.reason === "news" && !e.label.endsWith("you shot it")),
      ],
    },
    {
      key: "twilight_gift",
      title: "Twilight gift",
      blurb:
        "Warm and interested agents whose newest listing already has good photos. Make a twilight version of the front photo (it opens in the editor on the sunset preset), then offer it. A yes is what turns warm into interested.",
      groups: [notShown(offers.twilight)],
    },
    {
      key: "staging",
      title: "Virtual staging",
      blurb:
        "Warm and interested agents with a vacant listing. Offer to virtually stage one photo (done outside the app) as a free demo of how the space could look furnished.",
      groups: [notShown(offers.staging)],
    },
    {
      key: "graphics",
      title: "Graphics",
      blurb:
        "Homes you shot that just went live or just changed status: a \u201cjust listed\u201d or \u201cjust sold\u201d moment worth a graphic. You make it yourself; the caption is a starting point.",
      groups: offers.graphics,
    },
    {
      key: "drone",
      title: "Drone shots",
      blurb:
        "Agents you know near where you’re already driving, who haven’t had the offer yet. One free shoot each. To email it instead, pick the “Follow-up: free drone shots” template.",
      groups: offers.drone,
    },
    {
      key: "check_ins",
      title: "Check-ins",
      blurb:
        "Interested agents and clients with nothing new: 2 weeks since you last talked for interested, 4 for clients, doubling with each follow-up that goes unanswered. Warm agents only come back for a reason or an offer.",
      muted: true,
      groups: [group("Gone quiet", reason("quiet"))],
    },
  ];
  return feeds
    .map((f) => {
      const s = offers.stats.get(f.key);
      return {
        ...f,
        groups: f.groups.filter((g) => g.items.length > 0 || g.heldBack > 0),
        ...(s ? { stats: { ...s, days: FEED_STATS_DAYS } } : {}),
      };
    })
    .filter((f) => f.groups.length > 0);
}

function fromBoard(e: FollowUpItem): FeedItem {
  return {
    agent: e.agent,
    lastReplyAt: e.lastReplyAt,
    label: e.label,
    suggestion: e.suggestion,
    listing: e.listing,
    // The listing-photo reasons are the ones a touch-up could answer too.
    editorHref:
      e.listing && (e.reason === "weak_photos" || e.reason === "price_cut") ? `/photo-editor?listing=${e.listing.id}` : null,
    address: e.address,
    city: e.city,
  };
}
