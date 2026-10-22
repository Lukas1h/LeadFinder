import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { matchBookingsToListings } from "@/lib/bookingListingMatch";
import { refreshMarketStatuses } from "@/lib/marketStatus";

// A couple of hundred Compass lookups, four at a time, a second or two each.
export const maxDuration = 300;

/**
 * Nightly: which listings of agents Lukas knows went under contract or sold
 * (see lib/marketStatus.ts). First, a free address match (no lookup) links
 * any booking that was arranged directly with an agent to a tracked listing
 * at the same address, once one exists — so it gets a real market check
 * below instead of just watching the booking's own address.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const matched = await matchBookingsToListings();
  const result = await refreshMarketStatuses();
  if (result.changed.length > 0) revalidatePath("/follow-up");
  return NextResponse.json({ matched, ...result });
}
