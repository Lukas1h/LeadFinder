import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/appApiAuth";
import { dismissFollowUpAgent } from "@/app/agents/actions";
import { isUuid, notFound, withErrors } from "../../../helpers";

/** "Not now" on a Follow up card — the same dismiss the web's snooze does. */
export const POST = withErrors(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const denied = requireAppAuth(req);
  if (denied) return denied;

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  await dismissFollowUpAgent(id);
  return NextResponse.json({ ok: true });
});
