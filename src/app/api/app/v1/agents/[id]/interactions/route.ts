import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/appApiAuth";
import { logInteraction } from "@/app/agents/interactionActions";
import { INTERACTION_CHANNELS, INTERACTION_DIRECTIONS, INTERACTION_OUTCOMES } from "@/db/schema";
import { isUuid, notFound, oneOf, optionalDate, optionalString, readJson, withErrors } from "../../../helpers";

/**
 * Log a call, text or email the app just recorded — the counterpart of the
 * web's Add interaction dialog. Enums are checked against the schema's own
 * arrays, so a typo in the app is a 400 naming the valid values rather than a
 * Postgres error.
 */
export const POST = withErrors(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const denied = requireAppAuth(req);
  if (denied) return denied;

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const body = await readJson(req);

  const listingId = optionalString(body.listingId, "listingId");
  const result = await logInteraction({
    agentId: id,
    listingId,
    channel: oneOf(body.channel, INTERACTION_CHANNELS, "channel"),
    direction: oneOf(body.direction, INTERACTION_DIRECTIONS, "direction"),
    outcome: body.outcome == null ? null : oneOf(body.outcome, INTERACTION_OUTCOMES, "outcome"),
    note: optionalString(body.note, "note"),
    occurredAt: optionalDate(body.occurredAt, "occurredAt") ?? undefined,
  });

  if (result.error) return notFound();
  return NextResponse.json({ ok: true });
});
