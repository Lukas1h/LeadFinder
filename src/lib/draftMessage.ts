import type { AgentRelationshipStatus, PresetType, LeadStatus, Listing, Agent } from "@/db/schema";
import { naturalStreetName } from "@/lib/sms";
import { areaPhrase } from "@/lib/areaPhrase";
import { leadSectionForListing, LEAD_SECTION_LABELS, LEAD_SECTION_BRIEFS } from "@/lib/leadSections";
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
  /**
   * The full listing and agent rows, so the prompt gets everything we know
   * (list date, original price, price cuts, back-on-market date, our own
   * photo score, the agent's listing history) — the model decides what's
   * worth using. See formatListingFacts / formatAgentFacts.
   */
  listing?: Listing | null;
  agent?: Agent | null;
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
// gets the "I'm Lukas! I do some real estate photography …" self-intro. A declined
// agent is treated like a new contact if reconnecting.
const SKIP_INTRO_STATUSES: AgentRelationshipStatus[] = ["warm", "interested", "worked_once", "regular"];

/** Shared by the SMS and email prompts — how to say where he works, honestly. */
function localityNudge(input: DraftMessageInput): string {
  const phrase = areaPhrase(input.city);
  const where = phrase
    ? `Say where he works with exactly this phrase: "I do some real estate photography ${phrase}." Don't swap in a different area or the town's own name.`
    : `The city is unknown, so just say "I do some real estate photography" with no area.`;
  return `Lukas lives in the Roseburg, OR area. ${where} Never call him "local", "based in" a city, or "from" a city.`;
}

/** Shared street-naming rule — the street is the one detail every message references. */
function streetNudge(input: DraftMessageInput, street: string): string {
  return `How to say the street: say it the way a person would in a casual text. The suggested form is "${street}" (full address: ${input.address ?? "unknown"}). Use the street name as given and do NOT add a compass direction that isn't part of the name — no "south", "north", "east" or "west" unless the street is genuinely called that (Southgate, Northgate). "9188 S Bank Dr" is "your listing on Bank Drive", never "your listing on South Bank Drive". Drop the street type when the name stands on its own ("your listing on Burntwood"), keep it when the bare name would sound odd ("Main street", "Oak lane", "5th street"). When you do include the street type, write it in lowercase ("road", "street", "avenue", never "Road"/"Rd").`;
}

// {{area}} is the phrase from areaPhrase ("in the Portland area", "here in
// Roseburg"). #1 is Lukas's own rewrite of an AI draft (2026-10-04) — the
// voice the rest follow: an exclamation after "I'm Lukas!", where he works,
// "I saw your … listing on X," with a comma straight into the question, and
// "I'd love to shoot it for you" instead of a sales line.
const EXAMPLE_BANK = `1. Coming Soon / No Photos (Lukas's own wording — the model for every photo opportunity)
Hey {{firstName}}, I'm Lukas! I do some real estate photography {{area}}. I saw your coming soon listing on {{street}}, do you have photos lined up yet? I'd love to shoot it for you if you don't.

2. Few or No Photos / Active Listing
Hey {{firstName}}, I'm Lukas! I do some real estate photography {{area}}. I saw your listing on {{street}}, do you have more photos coming? I'd love to shoot it for you if not.

3. Poor Photography (preferred — short, never criticize, never say "refresh")
Hey {{firstName}}, I'm Lukas! I do some real estate photography {{area}}. I saw your listing on {{street}}, if you want some professional photos taken for it I'd love to shoot it for you.

4. Poor Photography / Different Take
Hey {{firstName}}, I'm Lukas! I do some real estate photography {{area}}. I came across {{street}} and had a few ideas for how I'd shoot it, I'd love to if you're open to new photos.

5. Video Opportunity
Hey {{firstName}}, I'm Lukas! I do some real estate photography and video {{area}}. I saw your listing on {{street}} doesn't have a video yet, I'd love to shoot one for you if you're interested.

6. High-Value / Visually Interesting Property
Hey {{firstName}}, I'm Lukas! I do some real estate photography {{area}}. I saw your listing on {{street}}, it looks like a great one to shoot. I'd love to do photo and drone for it if you need someone.

7. Established Agent / Backup Photographer
Hey {{firstName}}, I'm Lukas! I do some real estate photography {{area}}. I'm guessing you already have a photographer you like, but I'd love to be a backup if they're ever booked or you need something shot quickly.

8. Backup / Very Casual
Hey {{firstName}}, I'm Lukas! I do some real estate photography {{area}}. Just putting myself on your radar as a backup if you ever need another shooter for photo, drone or video.

9. High-Volume Agent
Hey {{firstName}}, I'm Lukas! I do some real estate photography {{area}}. I've seen a bunch of your listings and it looks like you stay busy, I'd love to help out whenever you need someone.

10. Simple Listing Introduction
Hey {{firstName}}, I'm Lukas! I do some real estate photography {{area}}. I saw your listing on {{street}}, if you still need someone to shoot it I'd love to.`;

/**
 * The 24 hour turnaround is a claim about photography. Video is scheduled
 * differently, so promising a same-day turnaround on a video shoot is a promise
 * Lukas can't keep, and "I do video, 24 hour turnaround" is exactly the pairing
 * that reads as a lie. Enforced two ways: the turnaround nudge is withheld
 * entirely for a listing we're pitching as video, and this rule covers the case
 * the section can't predict — a photo or backup lead where the model picks a
 * video angle on its own.
 *
 * Deliberately phrased as "don't attach a turnaround to video" rather than "the
 * turnaround is for photos only". The message shouldn't promise what can't be
 * delivered, but it also shouldn't volunteer a correction nobody asked for,
 * which would read worse than simply leaving the turnaround out.
 */
const VIDEO_NO_TURNAROUND_RULE = [
  "- The 24 hour turnaround is a claim about photography, not about video.",
  "  If this message is about video in any way, do not mention a turnaround at all:",
  '  not "24 hour", not "quick turnaround", not "same week", not "I can turn it around fast".',
  "  Don't mention what the turnaround does or doesn't cover either, and don't add a correction about it.",
  "  If it doesn't fit, leave it out and say nothing about it.",
].join("\n");

/**
 * The "24 hour turnaround is worth including" nudge, omitted when the listing is
 * one we're pitching as video so the model is never handed the claim in the
 * first place for that message.
 */
function turnaroundNudge(input: DraftMessageInput): string {
  const section = input.listing ? leadSectionForListing(input.listing, input.agentRelationshipStatus) : null;
  if (section === "video") return "";
  return " He can have photos done within 24 hours. Only mention it when speed is the whole angle (a backup for a busy week, a last minute shoot). For a coming soon, missing or poor photos message, leave it out and keep it short.";
}

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (d: Date) => Math.max(0, Math.floor((Date.now() - d.getTime()) / DAY_MS));
const onDate = (d: Date) => `${d.toISOString().slice(0, 10)} (${daysAgo(d)} days ago)`;
const money = (n: number) => `$${n.toLocaleString()}`;

/** Everything we know about the listing. Only non-null fields render, so the prompt doesn't pad out with "unknown"s. */
function formatListingFacts(input: DraftMessageInput): string {
  const l = input.listing;
  const lines: string[] = [];
  if (input.address) lines.push(`Full address: ${[input.address, input.city, input.state, input.zipcode].filter(Boolean).join(", ")}`);
  if (input.price != null) lines.push(`Current price: ${money(input.price)}`);
  if (l?.originalPrice != null && input.price != null && l.originalPrice !== input.price) {
    lines.push(`Original list price: ${money(l.originalPrice)}`);
  }
  if (l?.priceCutAmount != null) {
    const count = l.priceCutCount != null && l.priceCutCount > 1 ? ` (${l.priceCutCount} price cuts so far)` : "";
    lines.push(`Most recent price cut: ${money(l.priceCutAmount)}${l.priceCutAt ? ` on ${onDate(l.priceCutAt)}` : ""}${count}`);
  }
  if (input.homeType) lines.push(`Type: ${input.homeType}`);
  if (input.bedrooms || input.bathrooms) lines.push(`${input.bedrooms ?? "?"} bd / ${input.bathrooms ?? "?"} ba`);
  if (input.livingArea != null) lines.push(`${input.livingArea.toLocaleString()} sqft`);
  if (input.isComingSoon) lines.push("Status: coming soon, not actively listed yet");
  if (l?.listedAt) lines.push(`Listed on the market: ${onDate(l.listedAt)}`);
  else lines.push(`Days on market (or since we found it): ${input.ageDays}`);
  if (l?.resurfacedAt) lines.push(`Came back on the market (relisted) on ${onDate(l.resurfacedAt)}`);
  if (l?.foundAt) lines.push(`We first saw it on ${onDate(l.foundAt)}${l.sourceLabel ? ` via ${l.sourceLabel}` : ""}`);
  lines.push(`Photo count on listing: ${input.photoCount ?? "unknown"}`);
  if (l?.score != null) {
    lines.push(`Our automated photo-quality score: ${l.score}/10${l.scoreReasoning ? ` (${l.scoreReasoning})` : ""} — a second opinion only; judge the attached photos yourself`);
  }
  // Which Leads-page section this listing sits in, and what that section is
  // for. Without it the model picks its own angle from the photo score alone
  // and pitches photo quality at agents whose photos are already fine — the
  // one thing the backup section exists to avoid saying.
  if (input.listing) {
    const section = leadSectionForListing(input.listing, input.agentRelationshipStatus);
    lines.push(`Leads page section: ${LEAD_SECTION_LABELS[section]} — ${LEAD_SECTION_BRIEFS[section]}`);
  }
  if (input.brokerName) lines.push(`Brokerage: ${input.brokerName}`);
  lines.push(`Lukas's pipeline status for this listing: ${input.status}`);
  if (l?.contactedAt) lines.push(`Lukas already contacted the agent about this listing on ${onDate(l.contactedAt)}`);
  if (l?.followUpNote) lines.push(`Lukas's follow-up note: ${l.followUpNote}`);
  if (input.bookingValue != null) lines.push(`Already booked, job value: ${money(input.bookingValue)}`);
  if (input.notes) lines.push(`Lukas's own notes on this listing: ${input.notes}`);
  if (input.listingUrl) lines.push(`Zillow URL: ${input.listingUrl}`);
  return lines.map((line) => `- ${line}`).join("\n");
}

/** Everything we know about the agent beyond name/relationship. */
function formatAgentFacts(input: DraftMessageInput): string {
  const a = input.agent;
  const lines: string[] = [];
  if (a?.avgListingsPerYear != null) lines.push(`Averages about ${Math.round(a.avgListingsPerYear)} listings a year`);
  if (a?.avgListingPrice != null) lines.push(`Average listing price: ${money(a.avgListingPrice)}`);
  if (a?.avgDaysBetweenListings != null) lines.push(`A new listing roughly every ${Math.round(a.avgDaysBetweenListings)} days`);
  if (input.agentLastContactedAt) lines.push(`Lukas last contacted this agent on ${onDate(input.agentLastContactedAt)}`);
  if (a?.createdAt) lines.push(`In Lukas's contacts since ${a.createdAt.toISOString().slice(0, 10)}`);
  return lines.map((line) => `- ${line}`).join("\n");
}

function buildInitialOutreachPrompt(input: DraftMessageInput, street: string, skipIntro: boolean): string {
  return `The purpose of this message is to automatically write a short, personalized text message to a real estate agent based on the listing, the agent, and the attached listing photos. It should feel like a real photographer personally reaching out, not automated marketing.

Analyze the listing details AND the attached photos closely before deciding what to say — you are the one judging the photography here, nothing has been pre-scored for you. Look at composition, lighting, exposure, whether an aerial/drone shot is present, whether a twilight/dusk exterior shot is present, whether windows show real exterior detail (a "window pull") vs. blown out to white, converging/leaning vertical lines (a cellphone tell), and whether the property's best features are actually shown.

How to choose the approach — determine the strongest reason to contact this agent, in this priority order:
1. If the listing is coming soon or has little/no photography, focus on helping them get the listing photographed quickly.
2. If the photos are poor, amateur, cellphone-quality, outdated, poorly composed, or fail to showcase the property, offer to take professional photos for them (get them photographed properly) without insulting the agent or their current photographer.
3. If the photos are good but there's no video or no aerial/drone shot among them, offer the specific missing service.
4. If the listing has been sitting a long time (months on the market) or has had a price cut, that's a strong, natural opening: new professional photos or a video can get a listing that's been sitting a second look from buyers. Mention it tactfully and in passing ("looks like it's been on the market a while" / "saw the price drop"), never implying the agent did something wrong, and never quote the dollar amount of the cut.
5. If the property is unusually expensive, attractive, architectural, unique, or visually interesting, emphasize that strong photography could showcase it particularly well.
6. If the agent appears high-volume or established (see "Listings we've seen from this agent" below) and the photos already look professional, do not try to convince them to replace that photographer — position Lukas as another option or backup for busy weeks, last minute listings, or quick turnarounds.
7. If none of the above clearly applies, simply introduce Lukas as a real estate photographer and put him on the agent's radar.

Do not automatically criticize the photography — if it's already good, acknowledge that implicitly and use the backup/additional-photographer approach (case 3 or 6 above).

Listing — street (use this for {{street}}): ${street}
${formatListingFacts(input)}

Where he works (use this for {{area}}): ${areaPhrase(input.city) ?? "unknown, leave it out"}

Agent (use first name for {{firstName}}):
- Name: ${input.agentName ?? "unknown"}
- City: ${input.city ?? "unknown"}
- Relationship: ${input.agentRelationshipStatus ?? "cold"} — ${RELATIONSHIP_GUIDANCE[input.agentRelationshipStatus ?? "cold"]}
- Listings we've seen from this agent: ${input.agentListingCount}
${formatAgentFacts(input)}
${input.agentNotes ? `- Lukas's own notes on this agent: ${input.agentNotes}\n` : ""}
Writing style:
- Friendly and casual, not professional. Short and to the point: 3 short sentences is ideal, 4 at most.
- The shape, in this order: (1) "Hey {firstName}, I'm Lukas!" (2) "I do some real estate photography {area}." (3) "I saw your … listing on {street}," and a comma straight into the reason, usually a question like "do you have photos lined up yet?" (4) a simple "I'd love to shoot it for you" style offer. Example #1 below is Lukas's own wording; match it closely.
- Coming soon with no photos, only a few, or obvious placeholder/phone photos: use example #1 nearly word for word ("do you have photos lined up yet? I'd love to shoot it for you if you don't."). Coming soon that already has a full set of photos: still say "your coming soon listing on {street}," but offer professional photos like example #3.${skipIntro ? `\n- IMPORTANT override to step (2) above: do NOT say "I'm Lukas," "it's Lukas," or name-drop Lukas at all in this message. The relationship status above means this agent already has him saved in their phone and knows exactly who's texting — treat this like a text from a contact already in their contacts list. Start straight from the greeting into the reason for reaching out.` : ""}
- Avoid sounding like an advertisement or formal business email. Loose, comma-joined phrasing like "I saw your listing on Clay street, do you have photos lined up yet?" is exactly right.
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
- The ideal message should make the agent think: "This guy noticed my listing, he works around here, and it would be easy to use him if I need him." The goal is to start a conversation and eventually be the photographer this agent thinks of — not to force a booking from the first text.`;
}

function buildFollowUpPrompt(input: DraftMessageInput, street: string, skipIntro: boolean): string {
  return `Write a short SMS follow-up to a real estate agent — an initial text about this listing already went out and got no reply yet. This is from Lukas, a real estate photographer. Look at the attached photos yourself to judge whether they're worth mentioning (e.g. as a reason there's still an opening, or to drop if they already look professional).

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
3b. If the listing has been on the market a long time or has had a price cut, new professional photos or a video can get it a second look. Mention it tactfully, never blaming the agent, and don't quote the cut amount.
4. If the property is expensive, visually interesting, or architectural, emphasize how strong photography can showcase it.
5. If the agent appears established and photos look professional, position Lukas as a backup for busy weeks or last minute situations.
6. If none above applies, simply introduce Lukas as a real estate photographer.

Don't automatically criticize the photos — if they're already good, acknowledge that and use the backup approach.

Listing — street (use for {{street}}): ${street}
${formatListingFacts(input)}

Agent (use first name for {{firstName}}, city for {{city}}):
- Name: ${input.agentName ?? "unknown"}
- City: ${input.city ?? "unknown"}
- Relationship: ${input.agentRelationshipStatus ?? "cold"} — ${RELATIONSHIP_GUIDANCE[input.agentRelationshipStatus ?? "cold"]}
- Listings we've seen: ${input.agentListingCount}
${formatAgentFacts(input)}
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
- Direct: "I'm Lukas, I do some real estate photography [area]. I'd love to shoot [street] for you if you need professional photos."
- Backup: "I specialize in real estate photos and video. I'm guessing you have someone already, but I'm around if you ever need a hand."

Final rules:
- Reference the specific street naturally.
- Don't pretend there's a problem that doesn't exist.
- Keep the subject line short (under 50 chars if possible) — something that makes them want to open it.
- The goal: make them think "this person actually looked at my listing, and it would be easy to work with them if I need photos."`;
}

function buildFollowUpEmailPrompt(input: DraftMessageInput, street: string, skipIntro: boolean): string {
  return `Write a short email follow-up to a real estate agent — an initial email about this listing already went out and got no reply. From Lukas, a real estate photographer.

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

export function buildSmsPrompt(input: DraftMessageInput): string {
  const street = naturalStreetName(input.address) ?? input.address ?? "the listing";
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

Location: ${localityNudge(input)}${turnaroundNudge(input)}

${streetNudge(input, street)}

Additional writing rules (these override anything above if they conflict, except Lukas's own instruction above, which wins over everything):
- NEVER use an em dash (—) or en dash (–), anywhere. Use a period or comma instead.
- NEVER use a hyphen (-) to join words. Write "24 hour", "last minute", "coming soon", "quick turnaround". Nobody types a hyphen into a text message, so one there is the clearest possible tell that a machine wrote it. This can't be cleaned up afterwards the way a dash can — a regex would turn "well known" into "wellknown" — so it has to come out right the first time.
${VIDEO_NO_TURNAROUND_RULE}
- Where he works always comes from the location rule above, word for word.
- Exactly one exclamation point, right after "I'm Lukas!" in the greeting. None anywhere else. (When the message doesn't introduce Lukas by name, use none at all.)
- Never use these words/phrases — dead giveaways of AI writing: "I noticed," "I wanted to reach out," "I hope this finds you," "don't hesitate," "in case you," "showcase"/"showcasing," "ensure," "delve," "reach out," "take care of," "beautifully," "stunning," "reliable," "pivotal," "crucial."
- Never use the word "refresh" or "updated photography" when the photos are bad — instead offer to take professional photos for the listing (frame it as getting the place photographed properly, not as sprucing up old photos).
- Don't write in a symmetric "not just X, but Y" or rule-of-three pattern.
- Contractions and plain, slightly imperfect phrasing over polished sentences — this is a text message typed on a phone, not an email.

Respond with ONLY the message text — no quotes, no JSON, no explanation.`;
}

function buildEmailPrompt(input: DraftMessageInput): string {
  const street = naturalStreetName(input.address) ?? input.address ?? "the listing";
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

Location: ${localityNudge(input)}${turnaroundNudge(input)}

${streetNudge(input, street)}

Writing rules:
- NEVER use em dashes (—) or en dashes (–). Use commas or periods instead.
${VIDEO_NO_TURNAROUND_RULE}
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
