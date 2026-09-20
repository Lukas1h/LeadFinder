import { NextRequest, NextResponse } from "next/server";
import { fetchFullListing } from "@/lib/zillapi";
import { insertAndEnrichListings } from "@/lib/sync";
import type { NewListing } from "@/db/schema";

export const maxDuration = 60;

// Temporary: backfills a lead that arrived via the AgentMail webhook while
// the DB was rejecting queries (Neon quota outage, 2026-09-20). Deleted
// after use.
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { zpid } = (await req.json()) as { zpid: string };
  const full = await fetchFullListing(zpid);
  if (!full) return NextResponse.json({ error: "fetchFullListing returned null" }, { status: 500 });

  const candidate = { ...full, sourceLabel: "Zillow email alert" } satisfies NewListing;
  const inserted = await insertAndEnrichListings([candidate]);
  return NextResponse.json({ inserted });
}
