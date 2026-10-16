import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/appApiAuth";
import { loadLedger } from "@/lib/finance/ledger";
import { pacificDate } from "@/lib/finance/math";
import { mileageReport } from "@/lib/finance/reports";
import { writeTrip } from "@/lib/finance/writes";
import { badRequest, readJson, withErrors } from "../../helpers";
import { parseTripInput } from "../shared";

/** The mileage log, newest first, each trip with its gas and deduction, plus the year's totals. */
export async function GET(req: Request) {
  const denied = requireAppAuth(req);
  if (denied) return denied;
  return NextResponse.json(mileageReport(await loadLedger(), pacificDate(new Date())));
}

/** Log a trip: `{ date, purpose, category, stops, miles, driveMinutes, milesEstimated, notes, bookingIds }`. */
export const POST = withErrors(async (req: Request) => {
  const denied = requireAppAuth(req);
  if (denied) return denied;
  const result = await writeTrip(null, parseTripInput(await readJson(req)));
  if (result.error) return badRequest(result.error);
  return NextResponse.json({ ok: true, id: result.id });
});
