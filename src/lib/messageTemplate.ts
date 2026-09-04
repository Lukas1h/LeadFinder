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

// Seed copy for the two presets ensureDefaultPresets creates on first use —
// the same wording the old hardcoded initialOutreachMessage/followUpMessage
// functions produced, rewritten with placeholders.
export const DEFAULT_INITIAL_BODY = `Hey {{firstName}}, I'm Lukas. I just saw your listing on {{street}} go up. Do you have photos handled yet, or could I help you get some taken care of quickly?
I'm a local real estate photographer, I'd be happy to put you down for this week.`;

export const DEFAULT_FOLLOWUP_BODY = `Hi {{firstName}}, just following up on {{street}} — let me know if you're still looking for a photographer!`;
