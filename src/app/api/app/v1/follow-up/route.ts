import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/appApiAuth";
import { getFollowUpBoard, type FollowUpItem } from "@/app/follow-up/data";
import { FOLLOW_UP_GROUPS } from "@/app/follow-up/groups";
import { listingCountsByAgent, listingDatesByAgent } from "@/app/agents/actions";
import { resolveAvgDaysBetweenListings } from "@/app/agents/stats";
import { agentJson, listingJson } from "../serialize";

/**
 * The Follow up page: everyone due to hear from him, strongest reason first,
 * split into today's few and the rest (getFollowUpBoard).
 *
 * `today` and `later` are the page. `news`, `justListed` and `groups` are the
 * same people in the shape app builds from before 2026-10-11 read, so an older
 * build still shows everyone; a newer one ignores them.
 */
export async function GET(req: Request) {
  const denied = requireAppAuth(req);
  if (denied) return denied;

  const [{ today, later, doneToday, dailyTarget }, counts, dates] = await Promise.all([
    getFollowUpBoard(),
    listingCountsByAgent(),
    listingDatesByAgent(),
  ]);

  // `headline` is the reason, in the words to use ("Pending since Oct 5"). A
  // home he shot that was booked by address alone has no listing, so its
  // address leads the headline instead.
  const item = (e: FollowUpItem) => ({
    agent: agentJson(e.agent),
    lastReplyAt: e.lastReplyAt,
    listing: e.listing ? listingJson(e.listing, "first") : null,
    headline: [e.listing ? null : e.address, e.label].filter(Boolean).join(" · "),
    reason: e.reason,
    // The card's "N listings · ~Nd between listings", as the web's AgentCard shows.
    listingCount: counts[e.agent.id] ?? 0,
    avgDaysBetweenListings: resolveAvgDaysBetweenListings(e.agent, dates[e.agent.id] ?? []),
  });
  const entry = (e: FollowUpItem) => ({ agent: agentJson(e.agent), lastReplyAt: e.lastReplyAt });

  const all = [...today, ...later];
  const by = (...reasons: FollowUpItem["reason"][]) => all.filter((e) => reasons.includes(e.reason));
  const quiet = by("quiet");

  return NextResponse.json({
    today: today.map(item),
    later: later.map(item),
    doneToday,
    dailyTarget,

    news: by("news").map(item),
    justListed: by("weak_photos", "just_listed", "price_cut").map(item),
    groups: [
      { label: "Samples sent, no word", entries: by("samples").map(entry) },
      ...FOLLOW_UP_GROUPS.map(({ label, match }) => ({
        label,
        entries: quiet.filter((e) => match(e.agent)).map(entry),
      })),
    ].filter((g) => g.entries.length > 0),
  });
}
