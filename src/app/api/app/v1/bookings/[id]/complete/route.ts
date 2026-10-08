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

  await markBookingCompleted(id, {
    driveHours: optionalNumber(body.driveHours, "driveHours"),
    editingHours: optionalNumber(body.editingHours, "editingHours"),
    shootingHours: optionalNumber(body.shootingHours, "shootingHours"),
    logisticsHours: optionalNumber(body.logisticsHours, "logisticsHours"),
    additionalCosts: optionalNumber(body.additionalCosts, "additionalCosts"),
  });

  return NextResponse.json({ ok: true });
});
