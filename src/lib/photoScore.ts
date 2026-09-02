const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";

const RUBRIC = `You are evaluating a real estate listing's photos to judge whether they were taken by a professional real estate photographer or an amateur (e.g. the agent with a cellphone).

Score from 1 (clearly amateur) to 10 (clearly professional).

Strong signals of PROFESSIONAL work (push the score up):
- An aerial/drone shot of the property or neighborhood
- A twilight/dusk exterior shot (warm interior lights glowing against a darkening blue sky)
- Bright, level, well-composed wide-angle interior shots

Strong signals of AMATEUR work (push the score down):
- Crooked or tilted horizons/doorframes
- Dark, poorly lit, or blown-out photos
- Blurry or low-resolution, cellphone-snapshot quality
- Cluttered, unstaged rooms shot straight-on

Respond with ONLY a JSON object: {"score": <integer 1-10>, "reasoning": "<one short sentence>"}`;

interface PhotoScoreResult {
  score: number | null;
  reasoning: string | null;
}

const MOCK_RESULT: PhotoScoreResult = {
  score: 4,
  reasoning: "Mock score — set USE_MOCK_OPENAI=false to call the real API.",
};

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

  const res = await fetch(OPENAI_CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: RUBRIC },
            ...photos.map((url) => ({
              type: "image_url",
              image_url: { url, detail: "low" },
            })),
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
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
