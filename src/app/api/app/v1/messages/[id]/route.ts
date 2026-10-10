import { requireAppAuth } from "@/lib/appApiAuth";
import { getSendDetail } from "@/app/messaging/replyActions";
import { agentJson, listingJson } from "../../serialize";
import { isUuid, notFound } from "../../helpers";

/**
 * One message in full, for the phone's message detail screen: who it went to,
 * which listing it was about, and the text as it reads for them.
 *
 * The text is re-rendered from the stored variant rather than the exact bytes
 * that went out — the web notes that edits made at send time aren't persisted,
 * so this is the template, not a receipt.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireAppAuth(req);
  if (denied) return denied;

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const detail = await getSendDetail(id);
  if (!detail) return notFound();

  return Response.json({
    send: {
      id: detail.id,
      channel: detail.channel,
      type: detail.type,
      sentAt: detail.sentAt,
      respondedAt: detail.respondedAt,
      result: detail.result,
      presetName: detail.presetName,
    },
    text: detail.text,
    // A send can have no agent or no listing attached (a cold email goes out
    // with neither), so both are nullable rather than a 404.
    agent: detail.agent ? agentJson(detail.agent) : null,
    listing: detail.listing ? listingJson(detail.listing, "first") : null,
    // The preset "Send samples" would email, so the app can name it in its
    // confirm. Sending is POST ./samples.
    followUpEmail: detail.followUpEmail,
  });
}