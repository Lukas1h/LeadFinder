import type { AgentRelationshipStatus, PresetType, LeadStatus } from "@/db/schema";
import { shortStreetName } from "@/lib/sms";
import { fetchImagePart, callGemini } from "@/lib/gemini";

// Gemini 3.5 Flash (not Lite) — this is a low-volume, synchronous,
// interactive call (one draft per Send-dialog open, not a batch job like
// photoScore), so the free-tier rate-limit headroom Lite buys matters much
// less here than the writing/reasoning quality the full model gives.
const MODEL = "gemini-3.5-flash";

// Interactive, synchronous call (blocks the Send dialog) — capped lower
// than photoScore's batch-job limit of 8. The first few photos are almost
// always the hero/exterior/kitchen shots anyway, enough to judge quality,
// room coverage, drone presence, and architectural interest.
const MAX_PHOTOS_FOR_DRAFT = 6;

export interface DraftMessageInput {
  type: PresetType;
  address: string | null;
  city: string | null;
  state: string | null;
  zipcode: string | null;
  price: number | null;
  bedrooms: string | null;
  bathrooms: string | null;
  livingArea: number | null;
  homeType: string | null;
  isComingSoon: boolean;
  listingUrl: string | null;
  brokerName: string | null;
  status: LeadStatus;
  notes: string | null;
  bookingValue: number | null;
  photoCount: number | null;
  photos: string[] | null;
  ageDays: number;
  agentName: string | null;
  agentRelationshipStatus: AgentRelationshipStatus | null;
  agentListingCount: number;
  agentLastContactedAt: Date | null;
  agentNotes: string | null;
  /** Lukas's own steering for this specific draft — see buildPrompt. Set when re-drafting after "I don't like this, try again with X." */
  instruction?: string | null;
}

export interface DraftEmailOutput {
  subject: string;
  body: string;
}

const RELATIONSHIP_GUIDANCE: Record<AgentRelationshipStatus, string> = {
  cold: "Never worked with this agent before — first impression.",
  warm: "Had some back-and-forth before, but no job yet — write like continuing a conversation, not starting cold.",
  interested: "This agent has said before they want to work together but nothing's happened yet — nudge that forward.",
  worked_once: "Done one job with this agent already — write casually, like texting someone who already knows the work.",
  regular: "Regular, established client — keep it brief and low-friction, like texting a colleague about a new listing.",
  declined: "This agent has declined — typically not contacted unless reconnecting after 30+ days.",
};

// Confirmed with Lukas: he doesn't re-introduce himself to agents who
// already know him. Only a genuinely cold contact (or a follow-up to one)
// gets the "I'm Lukas, local real estate photographer" self-intro. A declined
// agent is treated like a new contact if reconnecting.
const SKIP_INTRO_STATUSES: AgentRelationshipStatus[] = ["warm", "interested", "worked_once", "regular"];

// Cities Lukas actually works out of — based in Roseburg, OR, and actively
// serving the Roseburg / Eugene / Medford areas. For a listing in any of
// these (or "cities near" them, listed below), it's accurate to call him a
// local photographer. Anywhere else and a "local"/"based in" claim would be
// a lie, so the prompt tells the model to fall back on his 24-hour
// turnaround and quick delivery instead.
const LOCAL_AREA_CITIES = new Set([
  "roseburg", "winston", "sutherlin", "myrtle creek", "canyonville", "oakland",
  "drain", "elkton", "reedsport", "glide", "tenmile", "green", "lookingglass",
  "days creek", "riddle", "winchester", "umpqua",
  "eugene", "springfield", "cottage grove", "creswell", "pleasant hill",
  "junction city", "coburg", "veneta", "lowell", "oakridge", "marcola",
  "medford", "ashland", "central point", "phoenix", "talent", "white city",
  "eagle point", "jacksonville", "gold hill", "rogue river", "shady cove",
  "butte falls", "grants pass",
]);

function isLocalArea(city: string | null | undefined): boolean {
  if (!city) return false;
  return LOCAL_AREA_CITIES.has(city.trim().toLowerCase());
}

/** One conditional nudge shared by the SMS and email prompts — keep locality claims honest, and lean on the 24-hour turnaround for anywhere outside his home area. Soft guidance, not a hard rule. */
function localityNudge(input: DraftMessageInput): string {
  if (isLocalArea(input.city)) {
    return `Lukas is based in Roseburg, OR and this listing is in his home area, so it's fine to call him a local photographer here.`;
  }
  return `Lukas is based in Roseburg, OR, not ${input.city ?? "the listing's city"} — it reads wrong to claim he's local or "based in" that city. Better to lean on his 24-hour turnaround and that he can get it done quickly.`;
}

const EXAMPLE_BANK = `1. Coming Soon / No Photos
Hey {{firstName}}, I'm Lukas. I just saw your coming-soon listing on {{street}}. Do you have photos lined up yet? If not, I'd be happy to get you taken care of this week. I'm local and shoot photo + drone.

2. Coming Soon / Convenience
Hey {{firstName}}, I'm Lukas. Just saw your coming-soon listing on {{street}}. Do you already have photography handled? If not, I can take care of the photos + drone and get everything turned around quickly.

3. Poor Photography
Hey {{firstName}}, I'm Lukas. I came across {{street}} and the current photos honestly don't do the property justice. If you want professional photos taken, I'd be happy to do photo + drone locally.

4. Poor Photography / More Direct
Hey {{firstName}}, I'm Lukas. I just saw {{street}} and the current photos aren't really showing the property at its best. If you'd like professional photos taken, I'd be happy to come shoot photo + drone.

5. Poor Photography / Don't Criticize
Hey {{firstName}}, I'm Lukas. I came across {{street}} and had a few ideas for how I'd photograph the property differently. If you're looking to get professional photos taken, I'd be happy to help.

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

/** Only non-null fields render — keeps the prompt from padding out with a wall of "unknown"s. */
function formatListingFacts(input: DraftMessageInput): string {
  const lines: string[] = [];
  if (input.price != null) lines.push(`Price: $${input.price.toLocaleString()}`);
  if (input.homeType) lines.push(`Type: ${input.homeType}`);
  if (input.bedrooms || input.bathrooms) lines.push(`${input.bedrooms ?? "?"} bd / ${input.bathrooms ?? "?"} ba`);
  if (input.livingArea != null) lines.push(`${input.livingArea.toLocaleString()} sqft`);
  if (input.zipcode) lines.push(`Zip: ${input.zipcode}`);
  if (input.isComingSoon) lines.push("Status: coming soon, not actively listed yet");
  else lines.push(`Pipeline status: ${input.status}`);
  lines.push(`Photo count on listing: ${input.photoCount ?? "unknown"}`);
  lines.push(`Days on market (or since found): ${input.ageDays}`);
  if (input.brokerName) lines.push(`Brokerage: ${input.brokerName}`);
  if (input.listingUrl) lines.push(`Zillow URL: ${input.listingUrl}`);
  if (input.bookingValue != null) lines.push(`Already booked, job value: $${input.bookingValue.toLocaleString()}`);
  if (input.notes) lines.push(`Lukas's own notes on this listing: ${input.notes}`);
  return lines.map((l) => `- ${l}`).join("\n");
}

function buildInitialOutreachPrompt(input: DraftMessageInput, street: string, skipIntro: boolean): string {
  return `The purpose of this message is to automatically write a short, personalized text message to a real estate agent based on the listing, the agent, and the attached listing photos. It should feel like a real local photographer personally reaching out, not automated marketing.

Analyze the listing details AND the attached photos closely before deciding what to say — you are the one judging the photography here, nothing has been pre-scored for you. Look at composition, lighting, exposure, whether an aerial/drone shot is present, whether a twilight/dusk exterior shot is present, whether windows show real exterior detail (a "window pull") vs. blown out to white, converging/leaning vertical lines (a cellphone tell), and whether the property's best features are actually shown.

How to choose the approach — determine the strongest reason to contact this agent, in this priority order:
1. If the listing is coming soon or has little/no photography, focus on helping them get the listing photographed quickly.
2. If the photos are poor, amateur, cellphone-quality, outdated, poorly composed, or fail to showcase the property, offer to take professional photos for them (get them photographed properly) without insulting the agent or their current photographer.
3. If the photos are good but there's no video or no aerial/drone shot among them, offer the specific missing service.
4. If the property is unusually expensive, attractive, architectural, unique, or visually interesting, emphasize that strong photography could showcase it particularly well.
5. If the agent appears high-volume or established (see "Listings we've seen from this agent" below) and the photos already look professional, do not try to convince them to replace that photographer — position Lukas as another local option or backup for busy/last-minute/quick-turnaround situations.
6. If none of the above clearly applies, simply introduce Lukas as a local real estate photographer and put him on the agent's radar.

Do not automatically criticize the photography — if it's already good, acknowledge that implicitly and use the backup/additional-photographer approach (case 3 or 5 above).

Listing — street (use this for {{street}}): ${street}
${formatListingFacts(input)}

Agent (use first name for {{firstName}}, city for {{city}}):
- Name: ${input.agentName ?? "unknown"}
- City: ${input.city ?? "unknown"}
- Relationship: ${input.agentRelationshipStatus ?? "cold"} — ${RELATIONSHIP_GUIDANCE[input.agentRelationshipStatus ?? "cold"]}
- Listings we've seen from this agent: ${input.agentListingCount}
${input.agentNotes ? `- Lukas's own notes on this agent: ${input.agentNotes}\n` : ""}
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
  return `Write a short SMS follow-up to a real estate agent — an initial text about this listing already went out and got no reply yet. This is from Lukas, a local real estate photographer. Look at the attached photos yourself to judge whether they're worth mentioning (e.g. as a reason there's still an opening, or to drop if they already look professional).

Rules specific to follow-ups:
- NEVER say "just checking in," "following up," or anything that adds zero new information — that's the #1 thing to avoid in a follow-up.
- Instead, do ONE of: add something new (new availability, a new observation), lower the stakes ("no worries if you've already got it handled"), or signal this is the last touch (gives them permission to respond or let it go).
- Keep it short — 1-3 sentences, shorter than a first message.
- ${skipIntro ? `Do NOT say "I'm Lukas," "it's Lukas," or name-drop Lukas at all — the relationship below means this agent already has him saved in their phone.` : "A brief self-introduction is fine since this is still effectively a first-ever contact."}
- Reference the street (${street}) naturally, don't just say "the listing."

Listing — street: ${street}
${formatListingFacts(input)}

Agent: ${input.agentName ?? "unknown"}, relationship: ${input.agentRelationshipStatus ?? "cold"} — ${RELATIONSHIP_GUIDANCE[input.agentRelationshipStatus ?? "cold"]}${input.agentNotes ? `\nLukas's own notes on this agent: ${input.agentNotes}` : ""}`;
}

function buildInitialOutreachEmailPrompt(input: DraftMessageInput, street: string, skipIntro: boolean): string {
  return `Write a short, personalized email to a real estate agent. Analyze the listing details AND the attached photos closely before deciding what to say — judge the photography yourself (composition, lighting, exposure, drone presence, etc.) rather than being handed a score.

How to choose the email subject and approach — determine the strongest reason to contact, in priority order:
1. If the listing is coming soon or has little/no photography, focus on quick turnaround and getting photos done.
2. If the photos are poor quality, offer to take professional photos for them (get them photographed properly) without insulting their current photographer.
3. If the photos are good but there's no video or drone shot, offer the specific missing service.
4. If the property is expensive, visually interesting, or architectural, emphasize how strong photography can showcase it.
5. If the agent appears established and photos look professional, position Lukas as a backup for busy/last-minute situations.
6. If none above applies, simply introduce Lukas as a local real estate photographer.

Don't automatically criticize the photos — if they're already good, acknowledge that and use the backup approach.

Listing — street (use for {{street}}): ${street}
${formatListingFacts(input)}

Agent (use first name for {{firstName}}, city for {{city}}):
- Name: ${input.agentName ?? "unknown"}
- City: ${input.city ?? "unknown"}
- Relationship: ${input.agentRelationshipStatus ?? "cold"} — ${RELATIONSHIP_GUIDANCE[input.agentRelationshipStatus ?? "cold"]}
- Listings we've seen: ${input.agentListingCount}
${input.agentNotes ? `- Lukas's notes: ${input.agentNotes}\n` : ""}
Writing style:
- Casual, brief, personable — sounds like a real photographer, not automated marketing.
- Email can be 2-3 short paragraphs, not multiple pages.
- Start with a natural greeting and reference to the listing.
- Keep offers simple and action-oriented.${skipIntro ? `\n- IMPORTANT: Do NOT say "I'm Lukas," "introduce myself," or name-drop Lukas. This agent knows who's emailing — write like an existing contact.` : ""}
- Avoid corporate language like "take your listing to the next level," "elevate," "best-in-class."
- No exaggerated sales pitch or pressure.

Example tone (not templates to copy, just style guidance):
- Casual: "Hey [name], I came across your listing on [street] and thought you might want professional photos taken."
- Direct: "I'm Lukas, a local photographer. [street] could use professional photos. Happy to help if that's something you need."
- Backup: "I specialize in real estate photos and video. I'm guessing you have someone, but I'm here if you ever need a quick turnaround."

Final rules:
- Reference the specific street naturally.
- Don't pretend there's a problem that doesn't exist.
- Keep the subject line short (under 50 chars if possible) — something that makes them want to open it.
- The goal: make them think "this person actually looked at my listing, and it would be easy to work with them if I need photos."`;
}

function buildFollowUpEmailPrompt(input: DraftMessageInput, street: string, skipIntro: boolean): string {
  return `Write a short email follow-up to a real estate agent — an initial email about this listing already went out and got no reply. From Lukas, a local real estate photographer.

Rules for email follow-ups:
- NEVER waste their time with "just checking in" or "following up" — that adds zero value.
- DO ONE: add something genuinely new, lower the pressure ("no pressure if you've already got someone"), or signal this is the last touch.
- Keep it 1-2 short paragraphs, much briefer than the first email.
- ${skipIntro ? `Do NOT name-drop Lukas — this agent has your email in their history.` : ""}
- Reference the street (${street}) naturally.

Listing: ${street}
${formatListingFacts(input)}

Agent: ${input.agentName ?? "unknown"}, relationship: ${input.agentRelationshipStatus ?? "cold"}`;
}

function buildSmsPrompt(input: DraftMessageInput): string {
  const street = shortStreetName(input.address) ?? input.address ?? "the listing";
  const status = input.agentRelationshipStatus ?? "cold";
  const skipIntro = SKIP_INTRO_STATUSES.includes(status);

  const scenarioPrompt =
    input.type === "initial_outreach"
      ? buildInitialOutreachPrompt(input, street, skipIntro)
      : buildFollowUpPrompt(input, street, skipIntro);

  const instructionBlock = input.instruction?.trim()
    ? `\nLukas's own instruction for THIS message — follow this over any conflicting guidance below, including the approach/example-bank choice above: ${input.instruction.trim()}\n`
    : "";

  return `You are Lukas, texting a real estate agent to offer photography services. Write ONE text message.
${instructionBlock}
${scenarioPrompt}

A gentle nudge on location: ${localityNudge(input)} The 24-hour turnaround is worth including when it fits naturally — he can have photos done within a day.

Additional writing rules (these override anything above if they conflict, except Lukas's own instruction above, which wins over everything):
- NEVER use an em dash (—) or en dash (–), anywhere. Use a period or comma instead.
- Zero or one exclamation point in the whole message, never more. Prefer a period.
- Never use these words/phrases — dead giveaways of AI writing: "I noticed," "I wanted to reach out," "I hope this finds you," "don't hesitate," "in case you," "showcase"/"showcasing," "ensure," "delve," "reach out," "take care of," "beautifully," "stunning," "reliable," "pivotal," "crucial."
- Never use the word "refresh" or "updated photography" when the photos are bad — instead offer to take professional photos for the listing (frame it as getting the place photographed properly, not as sprucing up old photos).
- Don't write in a symmetric "not just X, but Y" or rule-of-three pattern.
- Contractions and plain, slightly imperfect phrasing over polished sentences — this is a text message typed on a phone, not an email.

Respond with ONLY the message text — no quotes, no JSON, no explanation.`;
}

function buildEmailPrompt(input: DraftMessageInput): string {
  const street = shortStreetName(input.address) ?? input.address ?? "the listing";
  const status = input.agentRelationshipStatus ?? "cold";
  const skipIntro = SKIP_INTRO_STATUSES.includes(status);

  const scenarioPrompt =
    input.type === "initial_outreach"
      ? buildInitialOutreachEmailPrompt(input, street, skipIntro)
      : buildFollowUpEmailPrompt(input, street, skipIntro);

  const instructionBlock = input.instruction?.trim()
    ? `\nLukas's own instruction for THIS email — follow over any conflicting guidance above: ${input.instruction.trim()}\n`
    : "";

  return `You are Lukas, writing an email to a real estate agent to offer photography services.
${instructionBlock}
${scenarioPrompt}

A gentle nudge on location: ${localityNudge(input)} The 24-hour turnaround is worth including when it fits naturally — he can have photos done within a day.

Writing rules:
- NEVER use em dashes (—) or en dashes (–). Use commas or periods instead.
- Zero or one exclamation point total, prefer none. Emails are professional.
- Avoid these AI giveaways: "I noticed," "I wanted to reach out," "I hope this finds you," "don't hesitate," "in case you," "showcase," "ensure," "delve," "take care of," "beautifully," "stunning," "reliable," "pivotal," "crucial."
- Never use the word "refresh" or "updated photography" when the photos are bad — instead offer to take professional photos for the listing (frame it as getting the place photographed properly, not as sprucing up old photos).
- No corporate jargon or sales-speak.
- Natural, conversational tone but still professional — this is email, not a text.
- Contractions are fine and help sound natural.

Respond with ONLY JSON in this exact format, no other text:
{
  "subject": "subject line here",
  "body": "email body here"
}`;
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
 * Drafts one SMS message live for this exact listing+agent, judging the actual
 * listing photos directly (Gemini vision, same provider as scorePhotos)
 * rather than being handed a pre-computed score — the writing guide calls
 * for judging composition/coverage/drone-presence/architectural interest
 * itself. Runs synchronously while the Send dialog is open, so a failure
 * should just mean "no AI option this time" rather than blocking the
 * dialog with retries. Returns null on any failure.
 */
export async function draftMessage(input: DraftMessageInput): Promise<string | null> {
  if (process.env.USE_MOCK_GEMINI === "true") {
    return `[Mock AI draft, set USE_MOCK_GEMINI=false for a real one] Hey${input.agentName ? ` ${input.agentName.split(" ")[0]}` : ""}, saw your listing${input.address ? ` on ${input.address}` : ""}. Got time this week if you need photos?`;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const promptText = buildSmsPrompt(input);
  const photos = (input.photos ?? []).slice(0, MAX_PHOTOS_FOR_DRAFT);
  const imageParts = (await Promise.all(photos.map(fetchImagePart))).filter((part) => part !== null);

  try {
    const text = await callGemini({
      model: MODEL,
      apiKey,
      parts: [{ text: promptText }, ...imageParts],
      // presencePenalty/frequencyPenalty (used under the old OpenAI setup
      // to push against repetitive phrasing) aren't supported on this
      // model — confirmed via a real 400 ("Penalty is not enabled for
      // this model") — so that job falls entirely to the prompt's banned
      // words/phrases list and temperature instead.
      generationConfig: {
        temperature: 0.9,
      },
      logLabel: "draftMessage",
    });
    return text ? stripDashes(text.trim()) : null;
  } catch (err) {
    console.error("draftMessage: request failed", err);
    return null;
  }
}

/**
 * Drafts one email (subject + body) live for this listing+agent, analyzing
 * the actual listing photos with Gemini vision to judge photography quality
 * and determine the best approach. Runs synchronously while the Send dialog
 * is open, so a failure means "no AI option this time." Returns null on failure.
 */
export async function draftEmailMessage(input: DraftMessageInput): Promise<DraftEmailOutput | null> {
  if (process.env.USE_MOCK_GEMINI === "true") {
    return {
      subject: "[Mock] Photography for your listing",
      body: `Hi${input.agentName ? ` ${input.agentName.split(" ")[0]}` : ""}, saw your listing${input.address ? ` on ${input.address}` : ""}. Would love to help with professional photos if you need them.`,
    };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const promptText = buildEmailPrompt(input);
  const photos = (input.photos ?? []).slice(0, MAX_PHOTOS_FOR_DRAFT);
  const imageParts = (await Promise.all(photos.map(fetchImagePart))).filter((part) => part !== null);

  try {
    const response = await callGemini({
      model: MODEL,
      apiKey,
      parts: [{ text: promptText }, ...imageParts],
      generationConfig: {
        temperature: 0.9,
      },
      logLabel: "draftEmailMessage",
    });

    if (!response) return null;

    const parsed = JSON.parse(response.trim());
    if (parsed.subject && parsed.body) {
      return {
        subject: stripDashes(parsed.subject.trim()),
        body: stripDashes(parsed.body.trim()),
      };
    }
  } catch (err) {
    console.error("draftEmailMessage: request failed", err);
  }

  return null;
}
