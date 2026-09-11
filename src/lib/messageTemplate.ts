import { firstName, shortStreetName } from "@/lib/sms";

// sendMessage's variantId sentinel for an AI-drafted send — that variant
// doesn't exist yet (each AI draft is one-off), so sendMessage creates it
// for real at send time instead of it being a pre-existing row like every
// other variant. Lives here (a plain module) rather than in
// messageActions.ts because a "use server" file may only export async
// functions.
export const AI_DRAFT_VARIANT_SENTINEL = "draft";

/** Renders a preset variant body, substituting {{firstName}} and {{street}}. */
export function renderMessageBody(
  body: string,
  agentName: string | null,
  address: string | null
): string {
  const name = firstName(agentName);
  const street = shortStreetName(address) ?? "your property";
  return body.replaceAll("{{firstName}}", name ?? "there").replaceAll("{{street}}", street);
}

/**
 * Renders an email variant's subject line — only {{firstName}}, no
 * {{street}}, since subjects are short and the cold-compose flow (the only
 * place subjects are used) has no listing/address to fill one in with.
 */
export function renderSubject(subject: string, agentName: string | null): string {
  const name = firstName(agentName);
  return subject.replaceAll("{{firstName}}", name ?? "there");
}

// Seed copy for the two presets ensureDefaultPresets creates on first use —
// the same wording the old hardcoded initialOutreachMessage/followUpMessage
// functions produced, rewritten with placeholders.
export const DEFAULT_INITIAL_BODY = `Hey {{firstName}}, I'm Lukas. I just saw your listing on {{street}} go up. Do you have photos handled yet, or could I help you get some taken care of quickly?
I'm a local real estate photographer, I'd be happy to put you down for this week.`;

export const DEFAULT_FOLLOWUP_BODY = `Hi {{firstName}}, just following up on {{street}} — let me know if you're still looking for a photographer!`;

// Seed copy for the default cold-outreach email preset (ensureDefaultEmailPreset
// in composeEmailActions.ts) — Lukas's own real template, given verbatim.
export const DEFAULT_COLD_EMAIL_SUBJECT = `Backup real estate photographer for your listings`;

export const DEFAULT_COLD_EMAIL_BODY = `Hi {{firstName}}!

I'm Lukas. I'm a local real estate photographer.

I'm sure you already have a photographer you normally use, so I'm not looking to replace them. I'd just like to be a reliable backup when you need someone last minute, your usual photographer is booked, or you need a quick turnaround.

I offer 24-hour delivery, free reshoots, flexible scheduling, and photo + drone + video. My goal is simply to make the media side of your listings easy.

I've attached my pricing and a few examples of my work.

Give me a call if there's anything I can help you out with!



Thanks for your time!

Lukas Hahn
Hahn Media
https://www.lukashahn.art/real-estate
(541) 430-3372`;
