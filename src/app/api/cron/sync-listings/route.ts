import { NextRequest, NextResponse } from "next/server";
import { runSync } from "@/lib/sync";

// See matching comment in src/app/page.tsx — Hobby plan's real ceiling is
// 300s with Fluid compute, and 60 wasn't leaving enough margin.
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await runSync();
  return NextResponse.json(result);
}
