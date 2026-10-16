import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/appApiAuth";
import { loadLedger } from "@/lib/finance/ledger";
import { jobsReport } from "@/lib/finance/reports";

/** Every shot job's revenue, gas, expenses, profit, hours and $/hr, plus days that covered several jobs. */
export async function GET(req: Request) {
  const denied = requireAppAuth(req);
  if (denied) return denied;
  return NextResponse.json(jobsReport(await loadLedger()));
}
