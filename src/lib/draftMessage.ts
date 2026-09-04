import type { AgentRelationshipStatus, PresetType } from "@/db/schema";
import { shortStreetName } from "@/lib/sms";

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";

// Interactive, synchronous call (blocks the Send dialog) — capped lower
// than photoScore's batch-job limit of 20. The first few photos are
// almost always the hero/exterior/kitchen shots anyway, enough to judge
// quality, room coverage, drone presence, and architectural interest.
const MAX_PHOTOS_FOR_DRAFT = 6;

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
  photos: string[] | null;
  score: number | null;
  scoreReasoning: string | null;
  ageDays: number;
  agentName: string | null;
  agentRelationshipStatus: AgentRelationshipStatus | null;
  agentListingCount: number;
  agentLastContactedAt: Date | null;
}

const RELATIONSHIP_GUIDANCE: Record<AgentRelationshipStatus, string> = {
  cold: "Never worked with this agent before — first impression.",
  warm: "Had some back-and-forth before, but no job yet — write like continuing a conversation, not starting cold.",
  interested: "This agent has said before they want to work together but nothing's happened yet — nudge that forward.",
  worked_once: "Done one job with this agent already — write casually, like texting someone who already knows the work.",
  regular: "Regular, established client — keep it brief and low-friction, like texting a colleague about a new listing.",
};

// Confirmed with Lukas: he doesn't re-introduce himself to agents who
// already know him. Only a genuinely cold contact (or a follow-up to one)
// gets the "I'm Lukas, local real estate photographer" self-intro.
const SKIP_INTRO_STATUSES: AgentRelationshipStatus[] = ["warm", "interested", "worked_once", "regular"];

const EXAMPLE_BANK = `1. Coming Soon / No Photos
Hey {{firstName}}, I'm Lukas. I just saw your coming-soon listing on {{street}}. Do you have photos lined up yet? If not, I'd be happy to get you taken care of this week. I'm local and shoot photo + drone.

2. Coming Soon / Convenience
Hey {{firstName}}, I'm Lukas. Just saw your coming-soon listing on {{street}}. Do you already have photography handled? If not, I can take care of the photos + drone and get everything turned around quickly.

3. Poor Photography
Hey {{firstName}}, I'm Lukas. I came across {{street}} and noticed the listing could probably benefit from some updated photography. If you're looking to give it a refresh, I'd be happy to help. I do photo + drone locally.

4. Poor Photography / More Direct
Hey {{firstName}}, I'm Lukas. I just saw {{street}} and noticed the current photos aren't really showing the property at its best. If you'd like to refresh the listing with professional photo + drone, I'd be happy to take care of it.

5. Poor Photography / Don't Criticize
Hey {{firstName}}, I'm Lukas. I came across {{street}} and had a few ideas for how I'd photograph the property differently. If you're considering updating the listing photos, I'd be happy to help.

6. Video Opportunity
Hey {{firstName}}, I'm Lukas. I came across {{street}} and noticed there's no video on the listing. If you're looking to add video to help showcase the property, I'd be happy to shoot one for you. I also do photo + drone.

7. High-Value / Visually Interesting Property
Hey {{firstName}}, I'm Lukas. I came across {{street}} and it looks like a property where strong photography could really make a difference. If you need photo + drone for it, I'd be happy to help.

8. Established Agent / Backup Photographer
Hey {{firstName}}, I'm Lukas. I'm guessing you probably already have a photographer you like, so I'm not trying to replace them. I'd just like to be a backup if they're booked, out of town, or you ever need something shot quickly. I'm local and do photo + drone.

9. Backup / Very Casual
Hey {{firstName}}, I'm Lukas. Just putting myself on your radar as a local backup photographer. If you ever get a last-minute listing or need a quick turnaround, feel free to text me. I do photo, drone, and video.

10. Agent Relationship / No Specific Need
Hey {{firstName}}, I'm Lukas. I'm a local real estate photographer and wanted to introduce myself. I shoot professional photo + drone, and I'm always happy to help if you ever need another photographer.

11. High-Volume Agent
Hey {{firstName}}, I'm Lukas. I've seen your listings around {{city}} and it looks like you stay pretty busy. I'm a local real estate photographer and wanted to introduce myself. I do photo + drone and would be happy to help whenever you need someone.

12. Simple Listing Introduction
Hey {{firstName}}, I'm Lukas. I just saw your listing on {{street}} and wanted to reach out. I'm a local real estate photographer and shoot photo + drone. If you still need someone for the property, I'd be happy to get you taken care of.`;

function buildInitialOutreachPrompt(input: DraftMessageInput, street: string, skipIntro: boolean): string {
  return `The purpose of this message is to automatically write a short, personalized text message to a real estate agent based on the listing, the agent, and the available listing photos. It should feel like a real local photographer personally reaching out, not automated marketing.

Analyze the listing details AND the attached photos (if any) before deciding what to say.

How to choose the approach — determine the strongest reason to contact this agent, in this priority order:
1. If the listing is coming soon or has little/no photography, focus on helping them get the listing photographed quickly.
2. If the photos are poor, amateur, cellphone-quality, outdated, poorly composed, or fail to showcase the property, offer a professional refresh without insulting the agent or their current photographer.
3. If the photos are good but there's no video or no aerial/drone shot among them, offer the specific missing service.
4. If the property is unusually expensive, attractive, architectural, unique, or visually interesting, emphasize that strong photography could showcase it particularly well.
5. If the agent appears high-volume or established (see "Listings we've seen from this agent" below) and likely already has a photographer, do not try to convince them to replace that photographer — position Lukas as another local option or backup for busy/last-minute/quick-turnaround situations.
6. If none of the above clearly applies, simply introduce Lukas as a local real estate photographer and put him on the agent's radar.

What to look for in the photos: cellphone/amateur look, poor lighting or exposure, awkward composition, too few photos, important rooms or features not shown, weak exterior shots, whether an aerial/drone shot is present, whether the property has strong architectural or design features that could be showcased better. Do not automatically criticize the photography — if it's already good, acknowledge that implicitly and use the backup/additional-photographer approach (case 3 or 5 above).

Listing:
- Street (use this for {{street}}): ${street}
${input.price != null ? `- Price: $${input.price.toLocaleString()}\n` : ""}${input.homeType ? `- Type: ${input.homeType}\n` : ""}${input.bedrooms || input.bathrooms ? `- ${input.bedrooms ?? "?"} bd / ${input.bathrooms ?? "?"} ba\n` : ""}${input.livingArea != null ? `- ${input.livingArea.toLocaleString()} sqft\n` : ""}${input.isComingSoon ? "- Status: coming soon, not actively listed yet\n" : ""}- Photo count on listing: ${input.photoCount ?? "unknown"}
${input.score != null ? `- Existing photo-quality score (1-10, technique only): ${input.score}/10${input.scoreReasoning ? ` — ${input.scoreReasoning}` : ""}\n` : ""}
Agent (use first name for {{firstName}}, city for {{city}}):
- Name: ${input.agentName ?? "unknown"}
- City: ${input.city ?? "unknown"}
- Relationship: ${input.agentRelationshipStatus ?? "cold"} — ${RELATIONSHIP_GUIDANCE[input.agentRelationshipStatus ?? "cold"]}
- Listings we've seen from this agent: ${input.agentListingCount}

Writing style:
- Short, conversational, natural, low-pressure. 2-4 sentences.
- The message should usually: (1) address the agent by first name, (2) introduce Lukas as a local real estate photographer, (3) reference the specific listing/street, (4) give a natural reason for reaching out, (5) offer an easy way for Lukas to help.${skipIntro ? `\n- IMPORTANT override to step (2) above: do NOT say "I'm Lukas," "it's Lukas," or name-drop Lukas at all in this message. The relationship status above means this agent already has him saved in their phone and knows exactly who's texting — treat this like a text from a contact already in their contacts list. Start straight from the greeting into the reason for reaching out.` : ""}
- Avoid sounding like an advertisement or formal business email.
- Do not use exaggerated sales language such as "take your listing to the next level," "elevate your brand," "best-in-class," or "earn your business."
- Do not immediately push packages, discounts, or long explanations.

Example messages — use these as patterns for tone and structure. Adapt the wording to the actual situation above rather than blindly copying one:
${EXAMPLE_BANK}

Final rules:
- Choose the approach based on the strongest available evidence from the listing, photos, and agent — don't default to the same one every time.
- Don't mention information that isn't useful to the outreach.
- Don't pretend the listing has a problem it doesn't have.
- Don't over-personalize just for the sake of personalization.
- Don't assume the agent needs a photographer if they probably already have one.
- The ideal message should make the agent think: "This guy noticed my listing, he's local, and it would be easy to use him if I need him." The goal is to start a conversation and eventually be the photographer this agent thinks of — not to force a booking from the first text.`;
}

function buildFollowUpPrompt(input: DraftMessageInput, street: string, skipIntro: boolean): string {
  return `Write a short SMS follow-up to a real estate agent — an initial text about this listing already went out and got no reply yet. This is from Lukas, a local real estate photographer.

Rules specific to follow-ups:
- NEVER say "just checking in," "following up," or anything that adds zero new information — that's the #1 thing to avoid in a follow-up.
- Instead, do ONE of: add something new (new availability, a new observation), lower the stakes ("no worries if you've already got it handled"), or signal this is the last touch (gives them permission to respond or let it go).
- Keep it short — 1-3 sentences, shorter than a first message.
- ${skipIntro ? `Do NOT say "I'm Lukas," "it's Lukas," or name-drop Lukas at all — the relationship below means this agent already has him saved in their phone.` : "A brief self-introduction is fine since this is still effectively a first-ever contact."}
- Reference the street (${street}) naturally, don't just say "the listing."

Listing: ${street}${input.price != null ? `, $${input.price.toLocaleString()}` : ""}${input.score != null ? `. Photo score ${input.score}/10${input.scoreReasoning ? ` (${input.scoreReasoning})` : ""}` : ""}.

Agent: ${input.agentName ?? "unknown"}, relationship: ${input.agentRelationshipStatus ?? "cold"} — ${RELATIONSHIP_GUIDANCE[input.agentRelationshipStatus ?? "cold"]}`;
}

function buildPrompt(input: DraftMessageInput): string {
  const street = shortStreetName(input.address) ?? input.address ?? "the listing";
  const status = input.agentRelationshipStatus ?? "cold";
  const skipIntro = SKIP_INTRO_STATUSES.includes(status);

  const scenarioPrompt =
    input.type === "initial_outreach"
      ? buildInitialOutreachPrompt(input, street, skipIntro)
      : buildFollowUpPrompt(input, street, skipIntro);

  return `You are Lukas, texting a real estate agent to offer photography services. Write ONE text message.

${scenarioPrompt}

Additional writing rules (these override anything above if they conflict):
- NEVER use an em dash (—) or en dash (–), anywhere. Use a period or comma instead.
- Zero or one exclamation point in the whole message, never more. Prefer a period.
- Never use these words/phrases — dead giveaways of AI writing: "I noticed," "I wanted to reach out," "I hope this finds you," "don't hesitate," "in case you," "showcase"/"showcasing," "ensure," "delve," "reach out," "take care of," "beautifully," "stunning," "reliable," "pivotal," "crucial."
- Don't write in a symmetric "not just X, but Y" or rule-of-three pattern.
- Contractions and plain, slightly imperfect phrasing over polished sentences — this is a text message typed on a phone, not an email.

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
 * Drafts one message live for this exact listing+agent. Vision-capable —
 * sends a handful of the listing's actual photos (gpt-4o-mini, same model
 * as scorePhotos) alongside the text context, since the writing guide
 * calls for judging composition/coverage/drone-presence/architectural
 * interest directly from the photos, not just the pre-computed technique
 * score. Runs synchronously while the Send dialog is open, so a failure
 * should just mean "no AI option this time" rather than blocking the
 * dialog with retries. Returns null on any failure.
 */
export async function draftMessage(input: DraftMessageInput): Promise<string | null> {
  if (process.env.USE_MOCK_OPENAI === "true") {
    return `[Mock AI draft, set USE_MOCK_OPENAI=false for a real one] Hey${input.agentName ? ` ${input.agentName.split(" ")[0]}` : ""}, saw your listing${input.address ? ` on ${input.address}` : ""}. Got time this week if you need photos?`;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const promptText = buildPrompt(input);
  const photos = (input.photos ?? []).slice(0, MAX_PHOTOS_FOR_DRAFT);

  const content =
    photos.length > 0
      ? [
          { type: "text", text: promptText },
          ...photos.map((url) => ({ type: "image_url", image_url: { url, detail: "low" } })),
        ]
      : promptText;

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
        // every time — see the "Additional writing rules" in buildPrompt.
        presence_penalty: 0.4,
        frequency_penalty: 0.3,
        messages: [{ role: "user", content }],
      }),
    });

    if (!res.ok) {
      console.error(`draftMessage: OpenAI ${res.status}`, await res.text());
      return null;
    }

    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = data.choices?.[0]?.message?.content?.trim();
    return text && text.length > 0 ? stripDashes(text) : null;
  } catch (err) {
    console.error("draftMessage: request failed", err);
    return null;
  }
}
