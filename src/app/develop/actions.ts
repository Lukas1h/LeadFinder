"use server";

import { db } from "@/db";
import { listings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { scorePhotos, MAX_PHOTOS_TO_SCORE } from "@/lib/photoScore";

export interface PhotoScoreTestResult {
  score: number | null;
  reasoning: string | null;
  photosScored: string[];
  error: string | null;
}

/**
 * Runs the real scorePhotos() rubric against an already-saved listing's
 * photos, for iterating on the rubric without needing a live sync — does
 * NOT write the result back to the listing, so it's safe to re-run
 * repeatedly while tweaking src/lib/photoScore.ts.
 */
export async function runPhotoScoreTest(listingId: string): Promise<PhotoScoreTestResult> {
  const [listing] = await db
    .select({ photos: listings.photos })
    .from(listings)
    .where(eq(listings.id, listingId));

  if (!listing) {
    return { score: null, reasoning: null, photosScored: [], error: "Listing not found" };
  }
  if (!listing.photos || listing.photos.length === 0) {
    return { score: null, reasoning: null, photosScored: [], error: "This listing has no photos" };
  }

  const result = await scorePhotos(listing.photos);
  return {
    score: result.score,
    reasoning: result.reasoning,
    photosScored: listing.photos.slice(0, MAX_PHOTOS_TO_SCORE),
    error: result.score == null ? "scorePhotos returned no score — check server logs" : null,
  };
}
