import { requireAppAuth } from "@/lib/appApiAuth";
import { getSendDetail, recordQuickActionText, sendQuickActionEmail } from "@/app/messaging/replyActions";
import { badRequest, isUuid, notFound, optionalString, readJson, withErrors } from "../../../../helpers";

// An email with a few megabytes of attachments takes a while to hand to SMTP.
export const maxDuration = 60;

/**
 * One of a message's quick actions (GET ../ lists them as `quickActions`).
 * What this does depends on the template's channel:
 *
 * - **email: this sends real email**, to the agent's address on file, or to
 *   `email` when they have none (it's then saved to them). Only ever called
 *   from the app's confirm dialog, which names the template and the address.
 * - **sms: this sends nothing.** The app has already put the text and the
 *   template's files in the Messages composer, and calls this once the
 *   composer reports it sent, to record it. `variantId` is the one the action
 *   was listed with.
 *
 * Either way the agent's reply is recorded the first time (a cold agent turns
 * warm), as "Send samples" always did.
 */
export const POST = withErrors(
  async (req: Request, { params }: { params: Promise<{ id: string; presetId: string }> }) => {
    const denied = requireAppAuth(req);
    if (denied) return denied;

    const { id, presetId } = await params;
    if (!isUuid(id) || !isUuid(presetId)) return notFound();

    const detail = await getSendDetail(id);
    const action = detail?.quickActions.find((a) => a.presetId === presetId);
    if (!action) return notFound();

    const body = await readJson(req);
    if (action.channel === "email") {
      const result = await sendQuickActionEmail(id, presetId, optionalString(body.email, "email") ?? undefined);
      if (result.error) return badRequest(result.error);
      return Response.json({ ok: true, note: result.note ?? null });
    }

    const variantId = optionalString(body.variantId, "variantId") ?? action.variantId;
    if (!isUuid(variantId)) return badRequest("variantId must be a uuid");
    const result = await recordQuickActionText(id, presetId, variantId, true);
    if (result.error) return badRequest(result.error);
    return Response.json({ ok: true, note: null });
  }
);
