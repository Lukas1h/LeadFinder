import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { listings } from "@/db/schema";
import { fetchNewListings } from "@/lib/zillapi";

export const maxDuration = 30;

const MAX_ITEMS = 50;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const fetched = await fetchNewListings({ maxItems: MAX_ITEMS });

  let inserted = 0;
  if (fetched.length > 0) {
    const result = await db
      .insert(listings)
      .values(fetched)
      .onConflictDoNothing({ target: listings.zpid })
      .returning({ id: listings.id });
    inserted = result.length;
  }

  return NextResponse.json({ fetched: fetched.length, inserted });
}
