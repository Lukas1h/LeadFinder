import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/appApiAuth";
import { loadShooterSummary } from "@/lib/shooters";

/**
 * The Finances page's shooter section: what's owed on shot jobs, and every
 * shooter's pay logged this year for the 1099 (lib/shooters.ts).
 */
export async function GET(req: Request) {
  const denied = requireAppAuth(req);
  if (denied) return denied;
  return NextResponse.json(await loadShooterSummary());
}
