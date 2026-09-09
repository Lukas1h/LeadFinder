import { db } from "@/db";
import { listings, searchSources, type NewListing } from "@/db/schema";
import { fetchNewListings, fetchAgentInfo } from "@/lib/zillapi";
import { scorePhotos } from "@/lib/photoScore";
import { notifyNewListings } from "@/lib/push";
import { FEW_PHOTOS_THRESHOLD } from "@/lib/pipeline";
import { and, eq, gte, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";

const MAX_ITEMS_PER_SOURCE = 50;
// Kept low deliberately: scorePhotos' vision calls can each run 20k+
// tokens for a photo-heavy listing (see MAX_PHOTOS_TO_SCORE in
// photoScore.ts), and firing too many at once burns through the vision
// API's per-minute budget — a batch of 5 concurrent scores is what caused
// several listings in one Refresh to silently come back with no score.
const ENRICHMENT_CONCURRENCY = 2;

// scorePhotos already retries transient errors internally (see
// MAX_ATTEMPTS there), but a listing that still comes back null after that
// was previously stuck that way forever — fixing it took a one-off manual
// SQL backfill (see the 2026-09-05 commit that introduced
// FEW_PHOTOS_THRESHOLD gating above; the 2026-09-09 OpenAI->Gemini move in
// photoScore.ts hit the same thing again, from what looks like the fresh
// GEMINI_API_KEY needing a few minutes to fully activate right after
// setup — confirmed the integration itself is fine by replaying the exact
// failed request against the real key once it'd had time to settle).
// retryMissingPhotoScores below automates that backfill as a sweep run
// from runSync, so both the daily cron and the manual Refresh button
// self-heal recently-failed scores instead of leaving them null until
// someone notices and fixes it by hand.
const SCORE_RETRY_WINDOW_DAYS = 3;
const SCORE_RETRY_LIMIT = 20;

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
  await retryMissingPhotoScores();
  return { fetched: fetched.length, inserted };
}

/**
 * Re-attempts scorePhotos for recently-found listings that have enough
 * photos to score but still have a null score — see the comment on
 * SCORE_RETRY_WINDOW_DAYS above for why this exists. Bounded to a recent
 * window and a small candidate cap so a listing whose photos are
 * permanently unscoreable (a dead/broken image URL, say) doesn't burn an
 * OpenAI/Gemini call on every single sync run forever.
 */
async function retryMissingPhotoScores(): Promise<number> {
  const cutoff = new Date(Date.now() - SCORE_RETRY_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const candidates = await db
    .select({ id: listings.id, photos: listings.photos })
    .from(listings)
    .where(and(isNull(listings.score), gte(listings.foundAt, cutoff)));

  const eligible = candidates
    .filter((row) => (row.photos?.length ?? 0) >= FEW_PHOTOS_THRESHOLD)
    .slice(0, SCORE_RETRY_LIMIT);
  if (eligible.length === 0) return 0;

  let rescored = 0;
  for (let i = 0; i < eligible.length; i += ENRICHMENT_CONCURRENCY) {
    const batch = eligible.slice(i, i + ENRICHMENT_CONCURRENCY);
    await Promise.all(
      batch.map(async (row) => {
        const result = await scorePhotos(row.photos);
        if (result.score == null) return;
        await db
          .update(listings)
          .set({ score: result.score, scoreReasoning: result.reasoning })
          .where(eq(listings.id, row.id));
        rescored++;
      })
    );
  }

  if (rescored > 0) {
    revalidatePath("/");
    revalidatePath("/pipeline");
  }

  return rescored;
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
        // Fewer than FEW_PHOTOS_THRESHOLD photos already gets its own
        // "only N photos" badge (see FewPhotosBadge) regardless of score —
        // there's nothing a photo-technique judgment adds for a gallery
        // this thin, so skip the vision call entirely rather than pay for
        // a score nobody needs.
        const enoughPhotosToScore = (row.photos?.length ?? 0) >= FEW_PHOTOS_THRESHOLD;
        const [agent, photoScore] = await Promise.all([
          row.agentPhone ? null : fetchAgentInfo(row.zpid),
          enoughPhotosToScore ? scorePhotos(row.photos) : Promise.resolve({ score: null, reasoning: null }),
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

  await notifyNewListings(insertedRows.length);

  if (insertedRows.length > 0) {
    // The cron route and the AgentMail webhook both land here with no
    // Server Action of their own to revalidate on the way out — without
    // this, pages cached via "use cache" (see src/app/page.tsx et al.)
    // keep serving the pre-sync render until their time-based revalidate
    // window passes, so a lead notified about here wouldn't show up yet.
    revalidatePath("/");
    revalidatePath("/pipeline");
  }

  return insertedRows.length;
}
