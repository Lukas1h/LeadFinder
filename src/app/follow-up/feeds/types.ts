import type { Agent, Listing } from "@/db/schema";

/**
 * Feeds: the sections under the Follow up list, each built around one offer
 * that makes an easy excuse to get back in touch with someone he knows (free
 * drone shots where he'll be driving, a free photo touch-up on a listing
 * that's sitting). The main list is "who's due"; a feed is "who this offer
 * fits". New feeds go in this folder and in getFollowUpFeeds (index.ts).
 */
export type FollowUpFeedKey = "drone" | "photo_touchup";

export interface FeedItem {
  agent: Agent;
  lastReplyAt: Date | null;
  /** Why this offer fits them, in a line: "Price cut Oct 12 · 54 days on market · photos 3/10". */
  label: string;
  /** A text to start from, in his voice. */
  suggestion: string;
  /** The listing the offer is about, when there is one. */
  listing: Listing | null;
  /** Where to do the work once they say yes: the photo editor with this listing loaded. */
  editorHref: string | null;
}

export interface FeedGroup {
  title: string;
  items: FeedItem[];
  /** People this would fit who heard from him too recently to ask, so an empty group explains itself. */
  heldBack: number;
}

export interface FollowUpFeed {
  key: FollowUpFeedKey;
  title: string;
  /** Who's in it and why, a sentence or two. */
  blurb: string;
  groups: FeedGroup[];
}
