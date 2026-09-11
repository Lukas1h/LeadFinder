export const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

const MAX_ATTEMPTS = 3;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface GeminiImagePart {
  inlineData: { mimeType: string; data: string };
}

/**
 * Fetches one photo and base64-encodes it as a Gemini inline_data part —
 * unlike OpenAI's image_url, Gemini needs raw bytes, not a URL (that'd
 * require the separate Files API / a GCS URI). Returns null on any fetch
 * failure so callers can filter out just the broken photo rather than
 * failing the whole request.
 */
export async function fetchImagePart(url: string): Promise<GeminiImagePart | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const mimeType = res.headers.get("content-type")?.split(";")[0] || "image/jpeg";
    const data = Buffer.from(await res.arrayBuffer()).toString("base64");
    return { inlineData: { mimeType, data } };
  } catch {
    return null;
  }
}

// On a 429, Gemini's real wait-time hint lives in the JSON error body, not
// the HTTP Retry-After header (unlike OpenAI) — a google.rpc.RetryInfo
// entry in error.details, e.g. {"@type": ".../google.rpc.RetryInfo",
// "retryDelay": "40s"}. Checking only the header would silently always
// fall back to a guessed backoff.
export function parseGeminiRetryDelayMs(body: string): number | null {
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

export interface CallGeminiInput {
  model: string;
  apiKey: string;
  parts: (GeminiImagePart | { text: string })[];
  generationConfig: Record<string, unknown>;
  /** Prefixes retry/error console logs so they're traceable to the caller (e.g. "scorePhotos", "draftMessage"). */
  logLabel: string;
}

/**
 * POSTs to a Gemini model's generateContent endpoint, retrying 429/5xx with
 * Gemini's own suggested delay when present (see parseGeminiRetryDelayMs).
 * Returns the first candidate's text, or null after exhausting retries or
 * on any non-retryable failure — callers do their own further parsing
 * (JSON.parse for a structured response, or use the text as-is).
 */
export async function callGemini(input: CallGeminiInput): Promise<string | null> {
  const url = `${GEMINI_BASE_URL}/${input.model}:generateContent`;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "x-goog-api-key": input.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [{ parts: input.parts }],
        generationConfig: input.generationConfig,
      }),
    });

    if (!res.ok) {
      const isRetryable = res.status === 429 || res.status >= 500;
      const body = await res.text();
      console.error(`${input.logLabel}: Gemini ${res.status} (attempt ${attempt}/${MAX_ATTEMPTS})`, body);

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

      return null;
    }

    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
  }

  return null;
}
