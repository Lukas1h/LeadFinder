import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { listings } from "@/db/schema";
import { fetchNewListings, fetchAgentInfo } from "@/lib/zillapi";
import { eq } from "drizzle-orm";

export const maxDuration = 30;

const MAX_ITEMS = 50;
const AGENT_LOOKUP_CONCURRENCY = 5;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const fetched = await fetchNewListings({ maxItems: MAX_ITEMS });

  let insertedRows: { id: string; zpid: string }[] = [];
  if (fetched.length > 0) {
    insertedRows = await db
      .insert(listings)
      .values(fetched)
      .onConflictDoNothing({ target: listings.zpid })
      .returning({ id: listings.id, zpid: listings.zpid });
  }

  // One property-details lookup per newly-inserted lead only (1 credit
  // each — confirmed the docs' "0 credits on cache hit" claim is false)
  // — never re-fetched for leads we already had.
  for (let i = 0; i < insertedRows.length; i += AGENT_LOOKUP_CONCURRENCY) {
    const batch = insertedRows.slice(i, i + AGENT_LOOKUP_CONCURRENCY);
    await Promise.all(
      batch.map(async (row) => {
        const agent = await fetchAgentInfo(row.zpid);
        if (agent.agentName || agent.agentPhone || agent.brokerName) {
          await db
            .update(listings)
            .set({
              agentName: agent.agentName,
              agentPhone: agent.agentPhone,
              ...(agent.brokerName ? { brokerName: agent.brokerName } : {}),
            })
            .where(eq(listings.id, row.id));
        }
      })
    );
  }

  return NextResponse.json({ fetched: fetched.length, inserted: insertedRows.length });
}
