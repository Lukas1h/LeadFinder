import { requireAppAuth } from "@/lib/appApiAuth";
import { markSendReply } from "@/app/messaging/replyActions";
import { badRequest, isUuid, notFound, oneOf, readJson, withErrors } from "../../../helpers";

/**
 * Records what a message led to: "keep_in_touch" or "declined".
 *
 * This is the web's own markSendReply, which is the same pair of buttons on the
 * message dialog. It writes an interaction, stamps the reply time, and moves the
 * agent's relationship status and the listing's status — but **it sends
 * nothing**. Emailing samples is its own endpoint (`./samples`).
 */
export const POST = withErrors(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const denied = requireAppAuth(req);
  if (denied) return denied;

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const body = await readJson(req);
  const outcome = oneOf(body.outcome, ["keep_in_touch", "declined"] as const, "outcome");

  const result = await markSendReply(id, outcome);
  if (result.error) return badRequest(result.error);

  return Response.json({ ok: true });
});