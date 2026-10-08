import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/appApiAuth";
import { restoreListingFollowUp } from "@/app/schedule/actions";
import { isUuid, notFound, optionalDate, optionalString, readJson, withErrors } from "../../../../helpers";

/**
 * Put a dismissed follow-up back, from whatever /dismiss returned as
 * `previous`. followUpAt is an ISO string here; the column stores a plain date
 * as UTC midnight (see loadScheduleItems), which is what the web's own restore
 * writes too.
 */
export const POST = withErrors(async (req: Request, { params }: { params: Promise<{ listingId: string }> }) => {
  const denied = requireAppAuth(req);
  if (denied) return denied;

  const { listingId } = await params;
  if (!isUuid(listingId)) return notFound();

  const body = await readJson(req);
  await restoreListingFollowUp(
    listingId,
    optionalDate(body.followUpAt, "followUpAt"),
    optionalString(body.followUpNote, "followUpNote")
  );

  return NextResponse.json({ ok: true });
});
