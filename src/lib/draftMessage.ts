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

// Picks the one specific, real reason to reach out from what the system
// actually detected — Rule 1 of the writing guide: "Don't write one
// message and reuse it everywhere. Every preset should exist because your
// system detected a specific, real reason to reach out." Ordered roughly
// by how strong/actionable the signal is.
function pickTrigger(input: DraftMessageInput): string {
  const lowPhotoCount = input.photoCount != null && input.photoCount < 5;
  if (input.isComingSoon && (input.photoCount == null || lowPhotoCount)) {
    return "Coming soon, no photos yet — the listing is new and photography is likely still unhandled. Reference that it's fresh/upcoming.";
  }
  if (input.score != null && input.score <= 5) {
    return `Amateur/weak photos (score ${input.score}/10${input.scoreReasoning ? `: ${input.scoreReasoning}` : ""}) — the current photos aren't showing the property well. Word this GENTLY, as an opportunity/refresh, never as criticism of the agent or whoever took them.`;
  }
  if (lowPhotoCount) {
    return `Only ${input.photoCount} photo${input.photoCount === 1 ? "" : "s"} on the listing — reads as photography likely still unhandled.`;
  }
  if (input.score != null && input.score >= 7) {
    return "Photos already look professional/handled — do NOT offer to replace their photographer. Position yourself as a backup/second option (quick turnaround, availability if their usual person is booked), which gets you on their radar without an awkward pitch.";
  }
  if (input.agentListingCount >= 3) {
    return `This agent moves a good volume of listings (${input.agentListingCount} seen so far) — the reason to reach out is their overall pace, not this one property. Position yourself as a resource for whenever they need someone, not a pitch about this specific listing's photos.`;
  }
  return "No strong specific signal on this listing — introduce yourself as a resource/backup option for whenever they need photography, low pressure, no hard pitch.";
}

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
      ? `This is the FIRST message to this agent about this specific listing.

Follow this formula, in order:
1. Greeting + first name ("Hey ${input.agentName ? input.agentName.split(" ")[0] : "there"},")
2. Who you are, briefly ("I'm Lukas.")
3. Proof you looked at THEIR specific listing (name the street, not "a listing")
4. The specific reason below, in your own words
5. A low-friction next step — an offer, not a hard ask ("Happy to help if..." not "Let me know if you want to schedule...")`
      : `This is a FOLLOW-UP — an initial text about this listing already went out and got no reply yet.

Rules specific to follow-ups:
- NEVER say "just checking in," "following up," or anything that adds zero new information — that's the #1 thing to avoid in a follow-up.
- Instead, do ONE of: add something new (new availability, a new observation), lower the stakes ("no worries if you've already got it handled"), or signal this is the last touch (gives them permission to respond or let it go — reduced pressure sometimes prompts a reply on its own).
- Keep it even shorter than the first message.`;

  return `You are Lukas, a local real estate photographer, texting an agent to offer your services. Write ONE short SMS.

${moment}

The specific reason to reach out (name it in your own words, don't just restate this verbatim):
${pickTrigger(input)}

Listing details:
${listingLines.join("\n")}

Agent profile:
${agentLines.join("\n")}

House rules — all of these matter:
- 2-4 sentences max. If it doesn't fit in a few lines, cut it down.
- Casual, how a real person texts — no "Dear", no "Best regards", no corporate tone.
- Sell the outcome, not the service. Weak: "I offer real estate photography." Strong: naming the specific gap and offering to close it.
- Never imply the agent, seller, or current photographer did a bad job — frame everything as an opportunity, never a criticism. This matters especially if they likely already have a photographer: pitch yourself as a backup/second option, never a replacement.
- Confident, not needy — you're offering a solution, not asking a favor. Avoid "whenever works, no rush, totally up to you." Prefer "I've got availability this week and can get you taken care of."
- Use the real street name and first name naturally (never a generic "your listing" or "hi there") — a message that could apply to any listing anywhere reads as mass-sent.
- Match tone to the relationship status above.

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
