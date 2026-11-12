import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/appApiAuth";
import { passFollowUpAgent } from "@/app/agents/actions";
import { badRequest, isUuid, withErrors } from "../../helpers";

/**
 * Pass on a Follow up card: off this one feed, not the others.
 * Body `{ "agentId": uuid, "feed": "congrats", "listingId"?: uuid | null }`.
 * With a listing, only that listing is passed in that feed (see
 * follow-up/feeds/history.ts). Nobody is contacted.
 */
export const POST = withErrors(async (req: Request) => {
  const denied = requireAppAuth(req);
  if (denied) return denied;

  const body = (await req.json().catch(() => null)) as { agentId?: unknown; feed?: unknown; listingId?: unknown } | null;
  const agentId = body?.agentId;
  const feed = body?.feed;
  const listingId = body?.listingId;
  if (typeof agentId !== "string" || !isUuid(agentId)) return badRequest("agentId must be a uuid");
  if (typeof feed !== "string" || !feed.trim()) return badRequest("feed is required");
  if (listingId != null && (typeof listingId !== "string" || !isUuid(listingId))) return badRequest("listingId must be a uuid");

  await passFollowUpAgent(agentId, feed, listingId ?? null);
  return NextResponse.json({ ok: true });
});
