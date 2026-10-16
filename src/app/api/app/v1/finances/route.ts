import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/appApiAuth";
import { loadLedger } from "@/lib/finance/ledger";
import { pacificDate } from "@/lib/finance/math";
import { overviewReport } from "@/lib/finance/reports";

/** The Finances Overview: this month, the year so far, the monthly table and where the money went. */
export async function GET(req: Request) {
  const denied = requireAppAuth(req);
  if (denied) return denied;
  return NextResponse.json(overviewReport(await loadLedger(), pacificDate(new Date())));
}
