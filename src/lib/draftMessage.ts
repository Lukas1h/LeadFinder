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
  cold: "Never worked with this agent before — this is a first impression, keep it a clean, low-pressure intro. This is the ONLY relationship status that gets a self-introduction (\"I'm Lukas\").",
  warm: "Had some back-and-forth with this agent before, but no job yet — write like you're continuing a conversation. Do NOT re-introduce yourself, they already know who you are — skip straight to why you're texting.",
  interested: "This agent has said before they want to work together but nothing's happened yet — nudge that forward. Do NOT re-introduce yourself.",
  worked_once: "Done one job with this agent already — write casually, like texting someone who already knows your work. Do NOT re-introduce yourself.",
  regular: "This is a regular, established client — keep it brief and low-friction, like texting a colleague about a new listing. Do NOT re-introduce yourself.",
};

const SKIP_INTRO_STATUSES: AgentRelationshipStatus[] = ["warm", "interested", "worked_once", "regular"];

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

  const status = input.agentRelationshipStatus ?? "cold";
  const skipIntro = SKIP_INTRO_STATUSES.includes(status);
  const firstName = input.agentName ? input.agentName.split(" ")[0] : "there";

  const introStep = skipIntro
    ? `1. Greeting + first name ("Hey ${firstName}," or similar — vary it, don't reuse this exact wording every time)\n2. SKIP self-introduction — they already know who you are. Go straight from the greeting into why you're texting.`
    : `1. Greeting + first name ("Hey ${firstName}," or similar)\n2. Who you are, briefly, worked naturally into the sentence — not a robotic "I'm Lukas." stapled on`;

  const moment =
    input.type === "initial_outreach"
      ? `This is the FIRST message to this agent about this specific listing.

Loose shape (don't follow this as a rigid template — vary the phrasing and sentence order between messages so they don't all read the same):
${introStep}
3. Proof you looked at THEIR specific listing (name the street, not "a listing")
4. The specific reason below, in your own words
5. A low-friction next step — an offer, not a hard ask`
      : `This is a FOLLOW-UP — an initial text about this listing already went out and got no reply yet.

Rules specific to follow-ups:
- NEVER say "just checking in," "following up," or anything that adds zero new information — that's the #1 thing to avoid in a follow-up.
- Instead, do ONE of: add something new (new availability, a new observation), lower the stakes ("no worries if you've already got it handled"), or signal this is the last touch (gives them permission to respond or let it go — reduced pressure sometimes prompts a reply on its own).
- Keep it even shorter than the first message.
- ${skipIntro ? "Skip the self-introduction, same as above." : "Brief self-introduction is fine since this is still a first-ever contact."}`;

  return `You are Lukas, a local real estate photographer, texting an agent to offer your services. Write ONE short SMS.

${moment}

The specific reason to reach out (name it in your own words, don't just restate this verbatim):
${pickTrigger(input)}

Listing details:
${listingLines.join("\n")}

Agent profile:
${agentLines.join("\n")}

Content rules:
- 2-4 sentences max. If it doesn't fit in a few lines, cut it down.
- Sell the outcome, not the service. Weak: "I offer real estate photography." Strong: naming the specific gap and offering to close it.
- Never imply the agent, seller, or current photographer did a bad job — frame everything as an opportunity, never a criticism, even when the reason involves weak photos. Bad: "your photos look pretty amateur" or "the current photos are dark and blurry" (this still reads as pointing out a flaw). Good: "the listing could probably use a refresh, happy to help if you're interested" (opportunity-framed, no direct critique of the existing photos). This matters especially if they likely already have a photographer: pitch yourself as a backup/second option, never a replacement.
- Confident, not needy — you're offering a solution, not asking a favor. Don't hedge with "whenever works, no rush, totally up to you."
- Use the real street name and first name naturally (never a generic "your listing" or "hi there") — a message that could apply to any listing anywhere reads as mass-sent.
- Match tone to the relationship status above.

Writing style — this needs to read like a real text from a busy contractor typing on his phone between jobs, NOT like AI-generated marketing copy. Specifically:
- NEVER use an em dash (—) or en dash (–), anywhere, for any reason. If you're tempted to use one, just end the sentence with a period and start a new one, or use "and"/"so"/"but".
- Don't stack enthusiasm — zero or one exclamation point in the whole message, never more. Prefer a period. Skip filler enthusiasm like "looks like a great opportunity" or "looks great" — get to the point instead.
- Never use these words/phrases, they're dead giveaways of AI writing: "I noticed," "I wanted to reach out," "I hope this finds you," "don't hesitate," "in case you," "showcase"/"showcasing," "ensure," "delve," "reach out," "take care of," "beautifully," "stunning," "reliable," "pivotal," "crucial."
- Don't write in a symmetric "not just X, but Y" or rule-of-three pattern — that's a classic AI tell. Say the thing plainly, once.
- Contractions and slightly imperfect, plain phrasing over polished sentences. Short clauses. This is a text message, not an email.

Respond with ONLY the message text — no quotes, no JSON, no explanation.`;
}

// Belt-and-suspenders: the prompt bans em/en dashes outright, but the
// model can still slip one through occasionally. Swap it for a period
// (the safest universal stand-in for how these get used as a clause
// break) rather than trust the prompt alone — this is the #1 thing that
// reads as AI-generated, so it isn't worth leaving to compliance.
const COORDINATING_CONJUNCTIONS = new Set(["and", "but", "so", "or", "yet", "nor"]);

function stripDashes(text: string): string {
  const withoutDashes = text.replace(/\s*[—–]\s*(\w+)?/g, (_match, nextWord: string | undefined) => {
    // "...St — and it could use..." should become "...St, and it could
    // use..." (comma), not "...St. And it could use..." (a period right
    // before a conjunction reads as an awkward run-on).
    if (nextWord && COORDINATING_CONJUNCTIONS.has(nextWord.toLowerCase())) {
      return `, ${nextWord}`;
    }
    return nextWord ? `. ${nextWord[0].toUpperCase()}${nextWord.slice(1)}` : ". ";
  });
  return withoutDashes.replace(/\.\s*\.\s*/g, ". ");
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
    return `[Mock AI draft, set USE_MOCK_OPENAI=false for a real one] Hey${input.agentName ? ` ${input.agentName.split(" ")[0]}` : ""}, saw your listing${input.address ? ` on ${input.address}` : ""}. Got time this week if you need photos?`;
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
        temperature: 0.9,
        // Pushes against the model's default tendency to reach for the
        // same stock phrasing (and the same banned punctuation/words)
        // every time — see the "Writing style" rules in buildPrompt.
        presence_penalty: 0.4,
        frequency_penalty: 0.3,
        messages: [{ role: "user", content: buildPrompt(input) }],
      }),
    });

    if (!res.ok) {
      console.error(`draftMessage: OpenAI ${res.status}`, await res.text());
      return null;
    }

    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content?.trim();
    return content && content.length > 0 ? stripDashes(content) : null;
  } catch (err) {
    console.error("draftMessage: request failed", err);
    return null;
  }
}
