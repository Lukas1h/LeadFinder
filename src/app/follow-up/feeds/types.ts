import type { Agent, Listing } from "@/db/schema";

/**
 * Feeds: the Follow up page is nothing but these, one tab each. Some are a
 * reason the board found (getFollowUpBoard: a new listing, a sale, a price
 * cut, samples with no answer, a plain check-in); the rest are built around
 * one offer that makes an easy excuse to get back in touch (free drone shots
 * where he'll be driving, a free touch-up on a listing that's sitting). New
 * feeds go in this folder and in buildFeeds (index.ts).
 */
export type FollowUpFeedKey =
  | "new_listings"
  | "relaunch"
  | "samples"
  | "unopened"
  | "congrats"
  | "twilight_gift"
  | "staging"
  | "graphics"
  | "drone"
  | "check_ins";

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
  /** For a home he shot that was booked by address alone, which has no listing row. */
  address?: string | null;
  city?: string | null;
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
  /** A plain "it's been a while" rather than a reason; its cards' lines are muted. */
  muted?: boolean;
  /** How texts from this feed have done lately (feeds/stats.ts), once there are any. */
  stats?: { reached: number; replied: number; days: number };
  groups: FeedGroup[];
}
