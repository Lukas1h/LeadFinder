import { NextRequest, NextResponse } from "next/server";
import { startPendingCallForListing, startPendingInteraction, startTextHandoff } from "@/app/agents/interactionActions";
import { startQueuedTextHandoff } from "@/app/queue/actions";
import type { HandoffPayload } from "@/lib/handoff";

/**
 * Receives the beacon a Call/Text button fires as it opens the dialer or
 * Messages (see src/lib/handoff.ts) and records the pending "how did it go?"
 * question. A plain route rather than a server action because sendBeacon can
 * only POST to a URL — and a beacon is the one request iOS reliably delivers
 * after the PWA has been frozen by the other app opening.
 */
export async function POST(req: NextRequest) {
  let payload: HandoffPayload;
  try {
    payload = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "bad payload" }, { status: 400 });
  }

  switch (payload.kind) {
    case "text":
      await startTextHandoff(payload);
      break;
    case "call":
      if (payload.agentId) await startPendingInteraction({ agentId: payload.agentId, listingId: payload.listingId, channel: "call" });
      else if (payload.listingId) await startPendingCallForListing(payload.listingId);
      break;
    case "queued":
      await startQueuedTextHandoff(payload.queuedMessageId);
      break;
    default:
      return NextResponse.json({ error: "unknown kind" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
