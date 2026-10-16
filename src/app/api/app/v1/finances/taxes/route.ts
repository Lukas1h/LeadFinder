import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/appApiAuth";
import { loadLedger } from "@/lib/finance/ledger";
import { pacificDate } from "@/lib/finance/math";
import { taxReport } from "@/lib/finance/reports";

/** The year as the tax return sees it, and the estimated tax on it. `?year=` defaults to this year. */
export async function GET(req: Request) {
  const denied = requireAppAuth(req);
  if (denied) return denied;
  const param = Number(new URL(req.url).searchParams.get("year"));
  const year = Number.isInteger(param) && param > 2000 ? param : Number(pacificDate(new Date()).slice(0, 4));
  return NextResponse.json(taxReport(await loadLedger(), year));
}
