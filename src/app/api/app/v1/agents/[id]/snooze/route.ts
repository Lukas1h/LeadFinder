import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/appApiAuth";
import { dismissFollowUpAgent } from "@/app/agents/actions";
import { isUuid, notFound, withErrors } from "../../../helpers";

/**
 * "Not now" on a Follow up card — the same dismiss the web's snooze does.
 * Body `{ "days": 7 | 14 | 28 }`; a build that sends none gets a week.
 */
export const POST = withErrors(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const denied = requireAppAuth(req);
  if (denied) return denied;

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const body = (await req.json().catch(() => null)) as { days?: unknown } | null;
  await dismissFollowUpAgent(id, typeof body?.days === "number" ? body.days : undefined);
  return NextResponse.json({ ok: true });
});
