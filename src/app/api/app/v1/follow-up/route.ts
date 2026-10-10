import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/appApiAuth";
import { getFollowUpBoard } from "@/app/follow-up/data";
import { FOLLOW_UP_GROUPS } from "@/app/follow-up/groups";
import { agentJson, listingJson } from "../serialize";

/**
 * The Follow up page: people with a sale to congratulate, people who just listed, then everyone who has gone
 * quiet, bucketed by the same labels the web uses (follow-up/groups.ts).
 * Empty buckets are omitted.
 */
export async function GET(req: Request) {
  const denied = requireAppAuth(req);
  if (denied) return denied;

  const { news, justListed, agents } = await getFollowUpBoard();

  return NextResponse.json({
    // A listing of theirs went under contract or closed: same shape as
    // justListed, plus the words to use ("Pending since Oct 5"). A home he
    // shot that was booked by address alone has no listing, so its address
    // goes in the headline instead.
    news: news.map((e) => ({
      agent: agentJson(e.agent),
      lastReplyAt: e.lastReplyAt,
      listing: e.listing ? listingJson(e.listing, "first") : null,
      headline: [e.listing ? null : e.address, e.label, e.shot ? "you shot it" : null].filter(Boolean).join(" · "),
    })),
    justListed: justListed.map((e) => ({
      agent: agentJson(e.agent),
      lastReplyAt: e.lastReplyAt,
      listing: listingJson(e.listing, "first"),
    })),
    groups: FOLLOW_UP_GROUPS.map(({ label, match }) => ({
      label,
      entries: agents.filter((e) => match(e.agent)).map((e) => ({ agent: agentJson(e.agent), lastReplyAt: e.lastReplyAt })),
    })).filter((g) => g.entries.length > 0),
  });
}
