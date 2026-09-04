import { db } from "@/db";
import { listings, searchSources, type NewListing } from "@/db/schema";
import { fetchNewListings, fetchAgentInfo } from "@/lib/zillapi";
import { scorePhotos } from "@/lib/photoScore";
import { eq } from "drizzle-orm";

const MAX_ITEMS_PER_SOURCE = 50;
// Kept low deliberately: scorePhotos' vision calls can each run 100k+
// tokens for a photo-heavy listing (see MAX_PHOTOS_TO_SCORE in
// photoScore.ts), and firing too many at once burns through OpenAI's
// per-minute token budget — a batch of 5 concurrent scores is what caused
// several listings in one Refresh to silently come back with no score.
const ENRICHMENT_CONCURRENCY = 2;

export interface SyncResult {
  fetched: number;
  inserted: number;
}

/**
 * Pulls new listings from every enabled search source and enriches
 * newly-inserted ones with agent info + an AI photo score. Shared by the
 * daily cron route and the manual "Refresh" button — same cost either way
 * (1 Zillapi credit per listing *returned* per source, even ones we
 * already have and skip inserting). Each source is its own bbox/filters
 * and its own Zillapi call, run in parallel — see the Settings page for
 * managing sources.
 */
export async function runSync(): Promise<SyncResult> {
  const sources = await db.select().from(searchSources).where(eq(searchSources.enabled, true));

  const fetchedPerSource = await Promise.all(
    sources.map(async (source) => {
      const results = await fetchNewListings({
        bbox: source.bbox,
        priceMin: source.priceMin,
        priceMax: source.priceMax,
        homeTypes: source.homeTypes,
        maxItems: MAX_ITEMS_PER_SOURCE,
      });
      return results.map((l) => ({ ...l, sourceLabel: source.name }));
    })
  );
  const fetched = fetchedPerSource.flat();

  const inserted = await insertAndEnrichListings(fetched);
  return { fetched: fetched.length, inserted };
}

/**
 * Inserts new listings (deduped by zpid via onConflictDoNothing) and, for
 * ones actually new, enriches with agent info + an AI photo score. Shared
 * by the bbox sync above and the AgentMail email-alert webhook — same
 * enrichment either way, only the source of the listing rows differs.
 * Rows that already have agent info (from fetchFullListing, used by the
 * email path) skip the extra fetchAgentInfo lookup rather than paying for
 * a redundant Zillapi credit.
 */
export async function insertAndEnrichListings(candidates: NewListing[]): Promise<number> {
  if (candidates.length === 0) return 0;

  const insertedRows = await db
    .insert(listings)
    .values(candidates)
    .onConflictDoNothing({ target: listings.zpid })
    .returning({
      id: listings.id,
      zpid: listings.zpid,
      photos: listings.photos,
      agentPhone: listings.agentPhone,
    });

  for (let i = 0; i < insertedRows.length; i += ENRICHMENT_CONCURRENCY) {
    const batch = insertedRows.slice(i, i + ENRICHMENT_CONCURRENCY);
    await Promise.all(
      batch.map(async (row) => {
        const [agent, photoScore] = await Promise.all([
          row.agentPhone ? null : fetchAgentInfo(row.zpid),
          scorePhotos(row.photos),
        ]);

        const update: Record<string, unknown> = {};
        if (agent?.agentName) update.agentName = agent.agentName;
        if (agent?.agentPhone) update.agentPhone = agent.agentPhone;
        if (agent?.brokerName) update.brokerName = agent.brokerName;
        if (photoScore.score != null) update.score = photoScore.score;
        if (photoScore.reasoning) update.scoreReasoning = photoScore.reasoning;

        if (Object.keys(update).length > 0) {
          await db.update(listings).set(update).where(eq(listings.id, row.id));
        }
      })
    );
  }

  return insertedRows.length;
}
