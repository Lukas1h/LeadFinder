import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/appApiAuth";
import { searchAgentsForPortfolio } from "@/app/portfolio-links/actions";

/** `?q=` → up to 8 agents by name, most recently contacted first (nothing under 2 letters). */
export async function GET(req: Request) {
  const denied = requireAppAuth(req);
  if (denied) return denied;
  const q = new URL(req.url).searchParams.get("q") ?? "";
  return NextResponse.json({ agents: await searchAgentsForPortfolio(q) });
}
