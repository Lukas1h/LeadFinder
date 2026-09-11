import { fetchImagePart, callGemini } from "@/lib/gemini";

const MODEL = "gemini-3.5-flash-lite";

// Revised 2026-09-05 after 5 real listings came back mis-scored (2 badly:
// a genuinely professional gallery rated "Amateur", and another rated
// "Amateur" that should've been "Good"). Added the window-pull/blown-window
// pair since it was the specific miss on the underrated listing (good HDR
// window exposure blending wasn't recognized as a strong pro tell). Tested
// against all 5 real complaints before shipping — this version fixed 2 of
// 4 testable cases with no new regressions elsewhere. Two more aggressive
// rubric variants (an explicit "narrow field of view" cue, and an "any
// single tell forces score ≤3" rule) were tried and rejected: the first
// one made the model latch onto "cramped framing" indiscriminately and
// score every listing identically regardless of actual quality, the
// second fixed the remaining bad case but broke two good ones.
//
// Moved from OpenAI gpt-4o-mini to Gemini 3.5 Flash-Lite on 2026-09-09
// (gemini-2.5-flash, requested first, turned out to be deprecated for new
// API keys by this point). The token-cost figures previously measured
// here (2,836 tokens/photo at "low" detail on gpt-4o-mini) are
// OpenAI-specific and don't carry over — Gemini prices images
// differently, so the ~$2-3/month budget math below needs re-measuring
// against real usage before trusting it again.

const RUBRIC = `
I'm a real estate photographer, I'm having you scan listings to determin if I should reach out and offer professional photos for them.

I want you to go through these photos and rate them on a scale from 1 (clearly cellphone/amateur, need new photos) to 10 (clearly professional, don't reach out).

Signs of needing photos: Dark images, crooked images, or images with blown out windows, or obvious cell phone pictures.
Signs of professional photos: Bright images, parallel verticals that are level, window that are not blown out to white, drone images.

Drone images are a dead give away that they have pro photos, that should imediately make it at least a 7.
So are goregous twilight images, or perfect HDR interiors.

Respond with ONLY a JSON object: {"score": <integer 1-10>, "reasoning": "<one short sentence>"}`;

interface PhotoScoreResult {
  score: number | null;
  reasoning: string | null;
  scoredPhotos: string[] | null;
}

const MOCK_RESULT: PhotoScoreResult = {
  score: 4,
  reasoning: "Mock score — set USE_MOCK_GEMINI=false to call the real API.",
  scoredPhotos: []
};

// A listing can have 60+ photos. Capping to a handful, evenly sampled
// across the gallery — see the sampling loop below — keeps each call's
// token cost and (since the Gemini migration) image-fetch/encode time
// bounded. Cut from 10 to 8 on 2026-09-10 specifically to shave per-listing
// latency: fewer photos means fewer server-side fetches to base64-encode
// and a smaller request body, which matters now that sync runs were
// coming in close to the function's time budget (see maxDuration comments
// in the cron route and src/app/page.tsx). Not re-validated for scoring
// accuracy at 8 vs 10 under Gemini — carried over from the OpenAI-era
// assumption that the first/sampled few photos are the most diagnostic.
export const MAX_PHOTOS_TO_SCORE = 8;

export async function scorePhotos(photos: string[] | null): Promise<PhotoScoreResult> {
  if (!photos || photos.length === 0) {
    return { score: null, reasoning: null, scoredPhotos: null };
  }

  if (process.env.USE_MOCK_GEMINI === "true") {
    return MOCK_RESULT;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set");
  }

  let scoredPhotos: string[] = [];
  const step = photos.length / MAX_PHOTOS_TO_SCORE;

  if (photos.length <= MAX_PHOTOS_TO_SCORE) {
    scoredPhotos = photos;
  } else {
    for (let i = 0; i < MAX_PHOTOS_TO_SCORE; i++) {
      scoredPhotos.push(photos[Math.floor(i * step)]);
    }
  }

  // Fetched and base64-encoded once, up front, so a retry doesn't re-fetch.
  const imageParts = (await Promise.all(scoredPhotos.map(fetchImagePart))).filter((part) => part !== null);

  if (imageParts.length === 0) {
    return { score: null, reasoning: null, scoredPhotos: null };
  }

  const content = await callGemini({
    model: MODEL,
    apiKey,
    parts: [{ text: RUBRIC }, ...imageParts],
    generationConfig: { temperature: 0, responseMimeType: "application/json" },
    logLabel: "scorePhotos",
  });
  if (!content) return { score: null, reasoning: null, scoredPhotos: null };

  try {
    const parsed = JSON.parse(content) as { score?: number; reasoning?: string };
    const score = typeof parsed.score === "number" ? Math.max(1, Math.min(10, Math.round(parsed.score))) : null;
    return { score, reasoning: parsed.reasoning ?? null, scoredPhotos };
  } catch {
    return { score: null, reasoning: null, scoredPhotos: null };
  }
}
