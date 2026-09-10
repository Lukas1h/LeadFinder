const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent";

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

const MAX_ATTEMPTS = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// On a 429, Gemini's real wait-time hint lives in the JSON error body, not
// the HTTP Retry-After header (unlike OpenAI) — a google.rpc.RetryInfo
// entry in error.details, e.g. {"@type": ".../google.rpc.RetryInfo",
// "retryDelay": "40s"}. Checking only the header (the original mistake
// here) meant this was silently always falling back to a guessed backoff.
function parseGeminiRetryDelayMs(body: string): number | null {
  try {
    const parsed = JSON.parse(body) as {
      error?: { details?: { "@type"?: string; retryDelay?: string }[] };
    };
    const retryInfo = parsed.error?.details?.find((d) => d["@type"]?.includes("RetryInfo"));
    const match = retryInfo?.retryDelay?.match(/^([\d.]+)s$/);
    if (!match) return null;
    const seconds = Number(match[1]);
    return Number.isFinite(seconds) ? seconds * 1000 : null;
  } catch {
    return null;
  }
}

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


  let scoredPhotos = [];
  const step = photos.length / MAX_PHOTOS_TO_SCORE

  if (photos.length <= MAX_PHOTOS_TO_SCORE) {
    scoredPhotos = photos;
  } else {
    for (let i = 0; i < MAX_PHOTOS_TO_SCORE; i++) {
      console.log("Scoring photo #", Math.floor(i * step))
      scoredPhotos.push(photos[Math.floor(i * step)]);
    }
  }



  // const scoredPhotos = photos.slice(0, MAX_PHOTOS_TO_SCORE);

  // Gemini's inline_data parts need raw bytes, not a URL — unlike OpenAI's
  // image_url, there's no way to hand it a hosted photo URL directly
  // (that requires the separate Files API / a GCS URI). Fetch and
  // base64-encode each photo once, up front, so a retry doesn't re-fetch.
  const imageParts = (
    await Promise.all(
      scoredPhotos.map(async (url) => {
        try {
          const res = await fetch(url);
          if (!res.ok) return null;
          const mimeType = res.headers.get("content-type")?.split(";")[0] || "image/jpeg";
          const data = Buffer.from(await res.arrayBuffer()).toString("base64");
          return { inlineData: { mimeType, data } };
        } catch {
          return null;
        }
      })
    )
  ).filter((part): part is { inlineData: { mimeType: string; data: string } } => part !== null);

  if (imageParts.length === 0) {
    return { score: null, reasoning: null, scoredPhotos: null };
  }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await fetch(GEMINI_URL, {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: RUBRIC }, ...imageParts],
          },
        ],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
        },
      }),
    });

    if (!res.ok) {
      // 429 (rate limit) and 5xx are transient — retry with backoff.
      // Gemini's own suggested delay (in the error body) is authoritative
      // when present; the Retry-After header is a fallback in case that
      // ever changes; a fixed guess is the last resort.
      const isRetryable = res.status === 429 || res.status >= 500;
      const body = await res.text();
      console.error(`scorePhotos: Gemini ${res.status} (attempt ${attempt}/${MAX_ATTEMPTS})`, body);

      if (isRetryable && attempt < MAX_ATTEMPTS) {
        const retryAfterHeader = Number(res.headers.get("retry-after"));
        const waitMs =
          parseGeminiRetryDelayMs(body) ??
          (Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
            ? retryAfterHeader * 1000
            : attempt * 15000);
        await sleep(waitMs);
        continue;
      }

      return { score: null, reasoning: null, scoredPhotos: null };
    }

    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!content) return { score: null, reasoning: null, scoredPhotos: null };

    try {
      const parsed = JSON.parse(content) as { score?: number; reasoning?: string };
      const score =
        typeof parsed.score === "number" ? Math.max(1, Math.min(10, Math.round(parsed.score))) : null;
      return { score, reasoning: parsed.reasoning ?? null, scoredPhotos: scoredPhotos };
    } catch {
      return { score: null, reasoning: null, scoredPhotos: null };
    }
  }

  return { score: null, reasoning: null, scoredPhotos: null };
}
