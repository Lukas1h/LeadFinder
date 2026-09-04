const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";

const RUBRIC = `Your goal: determine whether these real estate listing photos were taken
by a professional real estate photographer, or on a cellphone by the agent/
homeowner. Score from 1 (clearly cellphone/amateur) to 10 (clearly professional).

Strong signals of PROFESSIONAL work (push the score up):
- An aerial/drone shot of the property or neighborhood
- A twilight/dusk exterior shot (warm interior lights glowing against a darkening blue sky)
- Perfectly straight vertical lines — door frames, window frames, and wall corners
  running truly vertical, not leaning inward/outward. Pros keep the camera level
  (tripod) or correct perspective in post; this is one of the most reliable tells.
- Bright, well-exposed, wide-angle interior shots

Strong signals of CELLPHONE/AMATEUR work (push the score down):
- Converging/leaning vertical lines — door frames, window frames, or wall corners
  that lean inward at the top or outward at the bottom. This happens when the
  camera is tilted up or down instead of held level, and is extremely common in
  cellphone real estate photos. If most of the interior shots show this, it's a
  reliable, decisive signal on its own — score 4 or below even if the photos are
  otherwise bright and clear.
- Crooked or tilted horizons
- Dark, poorly lit, or blown-out photos
- Blurry or low-resolution, cellphone-snapshot quality

Judge PHOTOGRAPHY TECHNIQUE ONLY. Do not factor in staging, furniture,
decor, landscaping, or how clean/cluttered the property itself is — a
messy room shot with perfect technique is still a professional photo, and
a pristine, well-staged room shot on a tilted cellphone is still amateur.

Respond with ONLY a JSON object: {"score": <integer 1-10>, "reasoning": "<one short sentence>"}`;

interface PhotoScoreResult {
  score: number | null;
  reasoning: string | null;
}

const MOCK_RESULT: PhotoScoreResult = {
  score: 4,
  reasoning: "Mock score — set USE_MOCK_OPENAI=false to call the real API.",
};

// A listing can have 60+ photos; sending all of them at "low" detail still
// runs ~2,800 tokens/photo for this model (not the flat 85 tokens/image
// gpt-4o gets at "low" — verified empirically, gpt-4o-mini prices images
// differently). A handful of concurrent full-gallery scores during a sync
// can blow well past OpenAI's per-minute token limit. Capping to the first
// N photos — which are almost always the hero/exterior/kitchen shots, the
// most diagnostic ones anyway — keeps each call's token cost bounded.
const MAX_PHOTOS_TO_SCORE = 20;

const MAX_ATTEMPTS = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function scorePhotos(photos: string[] | null): Promise<PhotoScoreResult> {
  if (!photos || photos.length === 0) {
    return { score: null, reasoning: null };
  }

  if (process.env.USE_MOCK_OPENAI === "true") {
    return MOCK_RESULT;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set");
  }

  const scoredPhotos = photos.slice(0, MAX_PHOTOS_TO_SCORE);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await fetch(OPENAI_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        temperature: 0,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: RUBRIC },
              ...scoredPhotos.map((url) => ({
                type: "image_url",
                image_url: { url, detail: "low" },
              })),
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      // 429 (rate limit) and 5xx are transient — retry with backoff. A
      // 429's retry-after header is authoritative when present; otherwise
      // back off hard since these requests are large enough that a short
      // wait rarely clears the per-minute token budget.
      const isRetryable = res.status === 429 || res.status >= 500;
      const body = await res.text();
      console.error(`scorePhotos: OpenAI ${res.status} (attempt ${attempt}/${MAX_ATTEMPTS})`, body);

      if (isRetryable && attempt < MAX_ATTEMPTS) {
        const retryAfterHeader = Number(res.headers.get("retry-after"));
        const waitMs = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
          ? retryAfterHeader * 1000
          : attempt * 15000;
        await sleep(waitMs);
        continue;
      }

      return { score: null, reasoning: null };
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) return { score: null, reasoning: null };

    try {
      const parsed = JSON.parse(content) as { score?: number; reasoning?: string };
      const score =
        typeof parsed.score === "number" ? Math.max(1, Math.min(10, Math.round(parsed.score))) : null;
      return { score, reasoning: parsed.reasoning ?? null };
    } catch {
      return { score: null, reasoning: null };
    }
  }

  return { score: null, reasoning: null };
}
