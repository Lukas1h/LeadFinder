import { NextRequest, NextResponse } from "next/server";
import { createAllocationReminder } from "@/lib/finance/allocationReminder";
import { pacificDate } from "@/lib/finance/math";

/**
 * Daily, though it only does something on Profit First allocation days (the
 * 10th and 25th): drops a "move the money" reminder on the Schedule page with
 * the amounts to move — the report's since-last-allocation window — and
 * pushes it. Runs again on the same day is a no-op, so a retried cron is safe.
 * Scheduled at 16:00 UTC, 8–9am Pacific.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  return NextResponse.json(await createAllocationReminder(pacificDate(new Date())));
}
