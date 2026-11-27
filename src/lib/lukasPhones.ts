/**
 * Lukas's three numbers, and which one an agent page (and its "Save my
 * contact" card) shows. Client-safe: no db imports, so the builder can show
 * what "Auto" will pick.
 *
 * Rule (Lukas, 2026-11-27): the agent's own area code decides.
 * - 541 (and its 458 overlay) → his 541 number
 * - 503 / 971 (Portland) → (971) 480-3552
 * - any California area code → (916) 820-4640 (until there are more CA numbers)
 * An agent with no phone, or another area code, falls back to the page's
 * market: Portland → 971, a California market → 916, else 541.
 */

export interface LukasPhone {
  e164: string;
  label: string;
}

export const LUKAS_PHONE_541 = "+15414303372";
export const LUKAS_PHONE_971 = "+19714803552";
export const LUKAS_PHONE_916 = "+19168204640";

export const LUKAS_PHONES: LukasPhone[] = [
  { e164: LUKAS_PHONE_541, label: "(541) 430-3372 · Eugene / rest of Oregon" },
  { e164: LUKAS_PHONE_971, label: "(971) 480-3552 · Portland" },
  { e164: LUKAS_PHONE_916, label: "(916) 820-4640 · California" },
];

const PORTLAND_CODES = new Set(["503", "971"]);

/** Every California area code (incl. overlays) as of 2026. */
const CALIFORNIA_CODES = new Set([
  "209", "213", "279", "310", "323", "341", "350", "369", "408", "415", "424", "442", "510", "530",
  "559", "562", "619", "626", "628", "650", "657", "661", "669", "707", "714", "738", "747", "760",
  "805", "818", "820", "831", "837", "840", "858", "909", "916", "925", "949", "951",
]);

/** The 3-digit area code of a US phone in any format ("541-555-1234", "+15415551234"), or null. */
export function areaCodeOf(phone: string | null | undefined): string | null {
  const d = (phone ?? "").replace(/\D/g, "");
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  return ten.length === 10 ? ten.slice(0, 3) : null;
}

/** Lukas's number for an agent's phone, or null when its area code isn't one of his rules. */
export function lukasPhoneForAgentPhone(phone: string | null | undefined): string | null {
  const code = areaCodeOf(phone);
  if (!code) return null;
  if (code === "541" || code === "458") return LUKAS_PHONE_541;
  if (PORTLAND_CODES.has(code)) return LUKAS_PHONE_971;
  if (CALIFORNIA_CODES.has(code)) return LUKAS_PHONE_916;
  return null;
}

/** True when `e164` is one of Lukas's numbers (what content.myPhone may hold). */
export function isLukasPhone(e164: string | null | undefined): e164 is string {
  return LUKAS_PHONES.some((p) => p.e164 === e164);
}

/**
 * The number an agent page shows: the page's own pick (content.myPhone),
 * else the agent's area code, else the page's market (key + state), else 541.
 */
export function resolveLukasPhone(input: {
  myPhone?: string | null;
  agentPhone?: string | null;
  marketKey?: string | null;
  marketState?: string | null;
}): string {
  if (isLukasPhone(input.myPhone)) return input.myPhone;
  const byAgent = lukasPhoneForAgentPhone(input.agentPhone);
  if (byAgent) return byAgent;
  if (input.marketKey === "portland") return LUKAS_PHONE_971;
  if ((input.marketState ?? "").toUpperCase() === "CA") return LUKAS_PHONE_916;
  return LUKAS_PHONE_541;
}
