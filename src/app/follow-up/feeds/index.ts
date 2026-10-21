import type { FollowUpBoard, FollowUpItem, FollowUpReason } from "../data";
import { getDroneOffers } from "../droneOffers";
import { getPhotoTouchUpGroups } from "./photoTouchUps";
import type { FeedGroup, FeedItem, FollowUpFeed } from "./types";

export type { FeedGroup, FeedItem, FollowUpFeed, FollowUpFeedKey } from "./types";

/** The offer feeds: the ones not found by the board. Fetched alongside it, then merged by buildFeeds. */
export interface OfferFeeds {
  touchUps: FeedGroup[];
  drone: FeedGroup[];
}

export async function getOfferFeeds(): Promise<OfferFeeds> {
  const [touchUps, drone] = await Promise.all([getPhotoTouchUpGroups(), getDroneOffers()]);
  return {
    touchUps,
    drone: drone.map((g) => ({
      title: g.title,
      heldBack: g.heldBack,
      items: g.items.map((e) => ({ ...e, listing: null, editorHref: null })),
    })),
  };
}

/**
 * Every feed, in tab order: the reasons strongest first, the offers, and the
 * plain check-ins last. Within a board feed the board's own order holds
 * (nearest first, then whoever lists most…). A feed with nobody in it is
 * left out, and an offer never repeats a listing a board feed already shows.
 */
export function buildFeeds(board: Pick<FollowUpBoard, "today" | "later">, offers: OfferFeeds): FollowUpFeed[] {
  const due = [...board.today, ...board.later];
  const shown = new Set(due.flatMap((e) => (e.listing ? [e.listing.id] : [])));
  const group = (title: string, ...reasons: FollowUpReason[]): FeedGroup => ({
    title,
    heldBack: 0,
    items: due.filter((e) => reasons.includes(e.reason)).map(fromBoard),
  });
  const notShown = (groups: FeedGroup[]) =>
    groups.map((g) => ({ ...g, items: g.items.filter((e) => !e.listing || !shown.has(e.listing.id)) }));

  const feeds: FollowUpFeed[] = [
    {
      key: "new_listings",
      title: "New listings",
      blurb: "They just put up a listing and you haven’t been in touch since. Weak photos first: that one is work.",
      groups: [group("Weak photos", "weak_photos"), group("Just listed", "just_listed")],
    },
    {
      key: "samples",
      title: "Samples",
      blurb: "You emailed samples two to six weeks ago and neither of you has said anything since.",
      groups: [group("No word since the samples", "samples")],
    },
    {
      key: "congrats",
      title: "Congrats",
      blurb: "A listing of theirs, or a home you shot, went under contract or closed since you were last in touch.",
      groups: [group("Under contract, pending or sold", "news")],
    },
    {
      key: "price_cuts",
      title: "Price cuts",
      blurb: "One of their listings with weak photos dropped its price in the last two weeks: the relaunch moment.",
      groups: [group("Cut in the last two weeks", "price_cut")],
    },
    {
      key: "photo_touchup",
      title: "Photo touch-ups",
      blurb:
        "Warm and interested agents with a listing that has sat 3+ weeks with weak photos, who haven’t heard from you in two weeks. Offer a few edited photos; when they say yes, open it in the photo editor.",
      groups: notShown(offers.touchUps),
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
        "Nothing new, it’s just been a while: 2 weeks for interested agents, 3 for warm, 4 for clients, doubling with each follow-up that goes unanswered.",
      muted: true,
      groups: [group("Gone quiet", "quiet")],
    },
  ];
  return feeds
    .map((f) => ({ ...f, groups: f.groups.filter((g) => g.items.length > 0 || g.heldBack > 0) }))
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
