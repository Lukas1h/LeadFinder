import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { refreshMarketStatuses } from "@/lib/marketStatus";

// A couple of hundred Compass lookups, four at a time, a second or two each.
export const maxDuration = 300;

/** Nightly: which listings of agents Lukas knows went under contract or sold (see lib/marketStatus.ts). */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await refreshMarketStatuses();
  if (result.changed.length > 0) revalidatePath("/follow-up");
  return NextResponse.json(result);
}
