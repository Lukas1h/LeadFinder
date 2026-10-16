import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/appApiAuth";
import { markBookingCompleted } from "@/app/booked/actions";
import { isUuid, notFound, optionalNumber, readJson, withErrors } from "../../../helpers";

/**
 * Finish a job. Every hours figure is optional — null means "not recorded",
 * which is what the web's completion dialog writes when Lukas leaves one blank,
 * and it's what keeps the "Avg per hour" stat honest about a missing number
 * rather than counting it as zero.
 */
export const POST = withErrors(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const denied = requireAppAuth(req);
  if (denied) return denied;

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const body = await readJson(req);

  // driveHours and additionalCosts are ignored: drive time and costs come
  // from the job's trips and expenses now (see src/lib/finance).
  await markBookingCompleted(id, {
    editingHours: optionalNumber(body.editingHours, "editingHours"),
    shootingHours: optionalNumber(body.shootingHours, "shootingHours"),
    logisticsHours: optionalNumber(body.logisticsHours, "logisticsHours"),
  });

  return NextResponse.json({ ok: true });
});
