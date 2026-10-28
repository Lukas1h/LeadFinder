import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/appApiAuth";
import { resolvePendingInteraction, startPendingInteraction } from "@/app/agents/interactionActions";
import { isUuid, notFound, optionalString, withErrors } from "../../../helpers";

/**
 * Record a text sent to an agent directly (no listing behind it) — the app's
 * equivalent of the agent row's Text button.
 *
 * Confirms on the spot for the same reason /listings/:id/texts does: the
 * native composer told us it was sent, so there's no "did it go?" prompt to
 * park it for. startPendingInteraction still writes the outbound interaction,
 * so the text shows up in the timeline exactly as the web's does.
 */
export const POST = withErrors(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const denied = requireAppAuth(req);
  if (denied) return denied;

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  // A text started from a Follow up tab says which (`followUpFeed`), for that tab's reply rate (follow-up/feeds/stats.ts).
  const body = (await req.json().catch(() => null)) as { followUpFeed?: unknown } | null;
  const followUpFeed = optionalString(body?.followUpFeed, "followUpFeed");
  const interactionId = await startPendingInteraction({ agentId: id, channel: "text", followUpFeed });
  if (interactionId) await resolvePendingInteraction(interactionId, "sent");

  return NextResponse.json({ ok: true, interactionId });
});
