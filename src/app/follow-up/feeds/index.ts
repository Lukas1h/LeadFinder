import { getDroneOffers } from "../droneOffers";
import { getPhotoTouchUpGroups } from "./photoTouchUps";
import type { FollowUpFeed } from "./types";

export type { FeedGroup, FeedItem, FollowUpFeed, FollowUpFeedKey } from "./types";

/**
 * Every feed, in the order the page shows them under the Follow up list. A
 * feed with nobody in it is left out.
 *
 * Fetched alongside the main list, so leaving out what it already shows is
 * a second step: withoutListings.
 */
export async function getFollowUpFeeds(): Promise<FollowUpFeed[]> {
  const [touchUps, drone] = await Promise.all([getPhotoTouchUpGroups(), getDroneOffers()]);

  const feeds: FollowUpFeed[] = [
    {
      key: "photo_touchup",
      title: "Free photo touch-ups",
      blurb:
        "Warm and interested agents with a listing that has sat 3+ weeks with weak photos, who haven’t heard from you in two weeks. Offer a few edited photos; when they say yes, open it in the photo editor. A fresh price cut goes first.",
      groups: touchUps,
    },
    {
      key: "drone",
      title: "Free drone shots",
      blurb:
        "Agents you know near where you’re already driving, who haven’t had the offer yet. One free shoot each. To email it instead, pick the “Follow-up: free drone shots” template.",
      groups: drone.map((g) => ({
        title: g.title,
        heldBack: g.heldBack,
        items: g.items.map((e) => ({ ...e, listing: null, editorHref: null })),
      })),
    },
  ];
  return withoutListings(feeds, new Set());
}

/** The feeds without these listings (the ones the main list shows), so one property never comes up twice on the page. */
export function withoutListings(feeds: FollowUpFeed[], listingIds: Set<string>): FollowUpFeed[] {
  return feeds
    .map((f) => ({
      ...f,
      groups: f.groups
        .map((g) => ({ ...g, items: g.items.filter((e) => !e.listing || !listingIds.has(e.listing.id)) }))
        .filter((g) => g.items.length > 0 || g.heldBack > 0),
    }))
    .filter((f) => f.groups.length > 0);
}
