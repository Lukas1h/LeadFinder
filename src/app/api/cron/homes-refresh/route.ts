import { NextRequest, NextResponse } from "next/server";
import { homesFetchConfigured } from "@/lib/homesFetch";
import { refreshHomesStats } from "@/lib/homesRefresh";

// Each page comes through the unblocker in 5-30 s, so a run does a few dozen
// agents; whoever doesn't fit goes first tomorrow.
export const maxDuration = 300;
const PER_RUN = 40;
/** Stop starting new agents this long before maxDuration, so the last save finishes. */
const SAFETY_MS = 45_000;

/** Daily: homes.com stats for agents Lukas knows that are missing or over a month old (lib/homesRefresh.ts). */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!homesFetchConfigured()) {
    return NextResponse.json({ skipped: "no unblocker configured (ZYTE_API_KEY or BRIGHTDATA_API_TOKEN + BRIGHTDATA_UNLOCKER_ZONE)" });
  }
  const started = Date.now();
  const summary = await refreshHomesStats({ limit: PER_RUN, deadline: started + maxDuration * 1000 - SAFETY_MS });
  return NextResponse.json(summary);
}
