import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/appApiAuth";
import { searchJobsForPortfolio } from "@/app/portfolio-links/actions";

/** `?q=` → finished jobs with a gallery, matched on address or city, as editable listing cards. */
export async function GET(req: Request) {
  const denied = requireAppAuth(req);
  if (denied) return denied;
  const q = new URL(req.url).searchParams.get("q") ?? "";
  return NextResponse.json({ listings: await searchJobsForPortfolio(q) });
}
