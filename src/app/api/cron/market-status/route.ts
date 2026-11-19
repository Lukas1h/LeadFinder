import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { matchBookingsToListings } from "@/lib/bookingListingMatch";
import { refreshMarketStatuses } from "@/lib/marketStatus";
import { recordMissingSquareFees } from "@/lib/squareInvoice";
import { markIgnoredAgents } from "@/lib/coldFollowUp/ignore";
import { refreshRelistedAfterContact } from "@/lib/relistedAfterContact";
import { refreshAllPortfolioEngagement } from "@/lib/portfolioEngagement";

// A couple of hundred Compass lookups, four at a time, a second or two each.
export const maxDuration = 300;

/**
 * Nightly: which listings of agents Lukas knows went under contract or sold
 * (see lib/marketStatus.ts). First, a free address match (no lookup) links
 * any booking that was arranged directly with an agent to a tracked listing
 * at the same address, once one exists — so it gets a real market check
 * below instead of just watching the booking's own address. Also logs any
 * Square fee that hadn't settled when its payment came in.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const matched = await matchBookingsToListings();
  const result = await refreshMarketStatuses();
  if (result.changed.length > 0) revalidatePath("/follow-up");
  // Riding along: Square fees that hadn't settled when their payment came in.
  const squareFees = await recordMissingSquareFees().catch(() => 0);
  // Also riding along: cold agents silent 3 days after their cold follow-up.
  const ignored = await markIgnoredAgents().catch(() => [] as string[]);
  if (ignored.length > 0) revalidatePath("/agents");
  // And the two night-time recomputes: "Listed without you" (warm/interested
  // agents who listed again after contact) and how each agent took their
  // portfolio page across every visit.
  const [relisted] = await Promise.all([
    refreshRelistedAfterContact().catch(() => null),
    refreshAllPortfolioEngagement().catch(() => null),
  ]);
  if (typeof relisted === "number") revalidatePath("/agents");
  return NextResponse.json({ matched, squareFees, ignored: ignored.length, relisted, ...result });
}
