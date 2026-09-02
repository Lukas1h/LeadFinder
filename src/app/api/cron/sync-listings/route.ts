import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { listings } from "@/db/schema";
import { fetchNewListings, fetchAgentInfo } from "@/lib/zillapi";
import { scorePhotos } from "@/lib/photoScore";
import { eq } from "drizzle-orm";

export const maxDuration = 30;

const MAX_ITEMS = 50;
const ENRICHMENT_CONCURRENCY = 5;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const fetched = await fetchNewListings({ maxItems: MAX_ITEMS });

  let insertedRows: { id: string; zpid: string; photos: string[] | null }[] = [];
  if (fetched.length > 0) {
    insertedRows = await db
      .insert(listings)
      .values(fetched)
      .onConflictDoNothing({ target: listings.zpid })
      .returning({ id: listings.id, zpid: listings.zpid, photos: listings.photos });
  }

  // Per newly-inserted lead only (never re-fetched for leads we already
  // had): one property-details lookup (1 credit — confirmed the docs' "0
  // credits on cache hit" claim is false) for agent info, plus one
  // gpt-4o-mini vision call (a fraction of a cent) to score the photos.
  // Run together per lead rather than as two passes to keep total sync
  // time down.
  for (let i = 0; i < insertedRows.length; i += ENRICHMENT_CONCURRENCY) {
    const batch = insertedRows.slice(i, i + ENRICHMENT_CONCURRENCY);
    await Promise.all(
      batch.map(async (row) => {
        const [agent, photoScore] = await Promise.all([
          fetchAgentInfo(row.zpid),
          scorePhotos(row.photos),
        ]);

        const update: Record<string, unknown> = {};
        if (agent.agentName) update.agentName = agent.agentName;
        if (agent.agentPhone) update.agentPhone = agent.agentPhone;
        if (agent.brokerName) update.brokerName = agent.brokerName;
        if (photoScore.score != null) update.score = photoScore.score;
        if (photoScore.reasoning) update.scoreReasoning = photoScore.reasoning;

        if (Object.keys(update).length > 0) {
          await db.update(listings).set(update).where(eq(listings.id, row.id));
        }
      })
    );
  }

  return NextResponse.json({ fetched: fetched.length, inserted: insertedRows.length });
}
