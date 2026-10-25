import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/appApiAuth";
import { getPortfolioActivity, listPortfolioLinks } from "@/app/portfolio-links/actions";

const EVENTS_SHOWN = 30;
// Carousel arrows are noise in a feed of what happened.
const QUIET_EVENTS = new Set(["listing_prev", "listing_next"]);

/**
 * Home's portfolio card: how the links he's sent are doing, over the 50 newest
 * (what the list shows). `opened` is links with at least one visit; the
 * averages are per visit (time on the page, deepest scroll). `events` is the
 * newest first across every link: each visit as it started, and each tap in
 * it. Built from the web's own list and activity functions.
 */
export async function GET(req: Request) {
  const denied = requireAppAuth(req);
  if (denied) return denied;

  const links = await listPortfolioLinks();
  const activities = (
    await Promise.all(links.filter((l) => l.visits > 0).map((l) => getPortfolioActivity(l.id)))
  ).filter((a) => a != null);

  const visits = activities.flatMap((a) => a.visits);
  const mean = (values: number[]) => (values.length ? values.reduce((n, v) => n + v, 0) / values.length : null);

  const events = activities
    .flatMap((a) =>
      a.visits.flatMap((v) => [
        {
          id: v.id,
          linkId: a.id,
          agentName: a.agentName,
          event: "visit",
          detail: [v.device, v.location].filter(Boolean).join(" · ") || null,
          at: v.startedAt,
          activeSeconds: v.activeSeconds,
          maxScrollPct: v.maxScrollPct,
        },
        ...v.events
          .filter((e) => !QUIET_EVENTS.has(e.event))
          .map((e) => ({
            id: e.id,
            linkId: a.id,
            agentName: a.agentName,
            event: e.event,
            detail: e.detail,
            at: e.at,
            activeSeconds: null,
            maxScrollPct: null,
          })),
      ])
    )
    .sort((x, y) => y.at.getTime() - x.at.getTime())
    .slice(0, EVENTS_SHOWN);

  return NextResponse.json({
    sent: links.length,
    opened: links.filter((l) => l.visits > 0).length,
    visits: visits.length,
    avgActiveSeconds: mean(visits.map((v) => v.activeSeconds)),
    avgScrollPct: mean(visits.map((v) => v.maxScrollPct)),
    events,
  });
}
