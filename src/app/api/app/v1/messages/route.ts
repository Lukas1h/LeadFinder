import { requireAppAuth } from "@/lib/appApiAuth";
import { computeMessagingStats, getRecentMessageSends, type MessagingStats } from "@/lib/messageStats";
import { etagged } from "../helpers";

/**
 * The stats card and the message history — the two read-only halves of the web's
 * /messaging page (MessagingStatsCard and MessageHistoryCard), for the phone's
 * Messages tab.
 *
 * The counts come straight from computeMessagingStats, which is the same
 * function the web card renders, so the numbers can't disagree between the two
 * surfaces. Same for getRecentMessageSends.
 *
 * Nothing here can send a message. The web's "Send samples" and "Compose" are
 * real SMTP sends and stay on the web; the phone only gets the two actions that
 * record an outcome.
 */

/** How many templates the card lists, as on the web. */
const TOP_TEMPLATES = 3;

/**
 * The web's filter for the "Top templates" table: templates that actually got a
 * reply, that aren't archived, and that aren't follow-ups (those are replies to
 * a conversation rather than outreach). Done here rather than in the app so the
 * two surfaces cut the same list.
 *
 * Texts only, matching the web card. Cold email was a one-off campaign, and its
 * 0.8% reply rate sat next to live texting at 28% doing neither of them any
 * favours.
 */
function topTemplates(templates: MessagingStats["templates"]): MessagingStats["templates"] {
  return templates
    .filter((t) => t.channel === "sms" && t.replied > 0 && !t.archived && t.type !== "follow_up")
    .sort((a, b) => b.replied - a.replied || b.booked - a.booked)
    .slice(0, TOP_TEMPLATES);
}

export async function GET(req: Request) {
  const denied = requireAppAuth(req);
  if (denied) return denied;

  const [stats, sends] = await Promise.all([computeMessagingStats(), getRecentMessageSends(100)]);

  const body = JSON.stringify({
    stats: {
      sms: stats.sms,
      email: stats.email,
      revenue: stats.revenue,
      templates: topTemplates(stats.templates),
      byDay: stats.byDay,
    },
    sends,
  });

  return etagged(body, req.headers.get("if-none-match"));
}