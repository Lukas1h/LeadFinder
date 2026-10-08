import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/appApiAuth";
import { dismissListingFollowUp } from "@/app/schedule/actions";
import { isUuid, notFound, withErrors } from "../../../../helpers";

/**
 * Clear a listing's follow-up date from a Schedule item. `previous` comes back
 * so the app can offer Undo the way the web's toast does, by handing those same
 * values to /restore.
 */
export const POST = withErrors(async (req: Request, { params }: { params: Promise<{ listingId: string }> }) => {
  const denied = requireAppAuth(req);
  if (denied) return denied;

  const { listingId } = await params;
  if (!isUuid(listingId)) return notFound();

  const previous = await dismissListingFollowUp(listingId);
  return NextResponse.json({ ok: true, previous });
});
