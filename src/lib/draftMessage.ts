import type { AgentRelationshipStatus, PresetType } from "@/db/schema";

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";

export interface DraftMessageInput {
  type: PresetType;
  address: string | null;
  city: string | null;
  state: string | null;
  price: number | null;
  bedrooms: string | null;
  bathrooms: string | null;
  livingArea: number | null;
  homeType: string | null;
  isComingSoon: boolean;
  photoCount: number | null;
  score: number | null;
  scoreReasoning: string | null;
  ageDays: number;
  agentName: string | null;
  agentRelationshipStatus: AgentRelationshipStatus | null;
  agentListingCount: number;
  agentLastContactedAt: Date | null;
}

const RELATIONSHIP_GUIDANCE: Record<AgentRelationshipStatus, string> = {
  cold: "Never worked with this agent before — this is a first impression, keep it a clean, low-pressure intro.",
  warm: "Had some back-and-forth with this agent before, but no job yet — write like you're continuing a conversation, not starting cold.",
  interested: "This agent has said before they want to work together but nothing's happened yet — nudge that forward, don't re-introduce yourself.",
  worked_once: "Done one job with this agent already — write casually, like reaching out to someone who already knows your work.",
  regular: "This is a regular, established client — keep it brief and low-friction, like texting a colleague about a new listing.",
};

function buildPrompt(input: DraftMessageInput): string {
  const listingLines = [
    input.address && `Address: ${input.address}${[input.city, input.state].filter(Boolean).length ? ", " + [input.city, input.state].filter(Boolean).join(", ") : ""}`,
    input.price != null && `Price: $${input.price.toLocaleString()}`,
    input.homeType && `Type: ${input.homeType}`,
    (input.bedrooms || input.bathrooms) && `${input.bedrooms ?? "?"} bd / ${input.bathrooms ?? "?"} ba`,
    input.livingArea != null && `${input.livingArea.toLocaleString()} sqft`,
    input.isComingSoon && "Status: coming soon (not actively listed yet)",
    input.photoCount != null && `Photo count: ${input.photoCount}`,
    input.score != null &&
      `Photo quality score: ${input.score}/10${input.scoreReasoning ? ` — ${input.scoreReasoning}` : ""}`,
    `Listed ${input.ageDays} day${input.ageDays === 1 ? "" : "s"} ago`,
  ].filter(Boolean);

  const agentLines = [
    input.agentName && `Name: ${input.agentName}`,
    `Relationship: ${input.agentRelationshipStatus ?? "cold"} — ${RELATIONSHIP_GUIDANCE[input.agentRelationshipStatus ?? "cold"]}`,
    `Listings we've seen from this agent: ${input.agentListingCount}`,
    input.agentLastContactedAt && `Last contacted: ${input.agentLastContactedAt.toDateString()}`,
  ].filter(Boolean);

  const moment =
    input.type === "initial_outreach"
      ? "This is the FIRST message to this agent about this specific listing."
      : "This is a FOLLOW-UP — an initial text about this listing already went out and got no reply yet.";

  return `You are Lukas, a local real estate photographer, texting an agent to offer your services. Write ONE short SMS (2-4 sentences, casual, no corporate tone, no greeting like "Dear" or sign-off like "Best regards" — just how a real person texts).

${moment}

Listing details:
${listingLines.join("\n")}

Agent profile:
${agentLines.join("\n")}

Guidance:
- If the photo score is low or missing, that's the opening — the listing likely needs a photographer.
- If the photo score is already high, don't claim they need photos — lean on the relationship/future-listings angle instead.
- Match the tone to the relationship status above.
- Mention the street name or listing naturally if it helps it read like a real, specific text rather than a template.

Respond with ONLY the message text — no quotes, no JSON, no explanation.`;
}

/**
 * Drafts one message live for this exact listing+agent, using the same
 * gpt-4o-mini model as scorePhotos. Text-only (no image tokens), a single
 * attempt — this runs synchronously while the Send dialog is open, so a
 * failure should just mean "no AI option this time" rather than blocking
 * the dialog with retries. Returns null on any failure.
 */
export async function draftMessage(input: DraftMessageInput): Promise<string | null> {
  if (process.env.USE_MOCK_OPENAI === "true") {
    return `[Mock AI draft — set USE_MOCK_OPENAI=false for a real one] Hey${input.agentName ? ` ${input.agentName.split(" ")[0]}` : ""}, saw your listing${input.address ? ` on ${input.address}` : ""} — got time this week if you need photos?`;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch(OPENAI_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.7,
        messages: [{ role: "user", content: buildPrompt(input) }],
      }),
    });

    if (!res.ok) {
      console.error(`draftMessage: OpenAI ${res.status}`, await res.text());
      return null;
    }

    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content?.trim();
    return content && content.length > 0 ? content : null;
  } catch (err) {
    console.error("draftMessage: request failed", err);
    return null;
  }
}
