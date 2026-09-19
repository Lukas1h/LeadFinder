/**
 * Shared normalizers for the three fields that showed up with inconsistent
 * formatting across agent/listing rows (see the Torres/Snyder/Mattox/Bloom
 * duplicate-agent incidents) — applied at every write site going forward,
 * not just at import, so a manual edit or an MCP call can't reintroduce
 * the same drift a scraped listing did.
 */

/**
 * Canonical phone format — "541-555-1234", no country code, no
 * parens/spaces. This is also what Zillapi returns natively, so choosing
 * it keeps freshly-scraped listings.agentPhone and manually-entered/
 * researched agents.phone in the same shape without a conversion step
 * either way — the exact-string match between them (used throughout the
 * Agents/Leads/Pipeline pages) depends on this.
 *
 * Falls back to the trimmed original for anything that isn't a clean
 * 10-digit US number (extensions, foreign numbers, garbage input) —
 * better to store an odd-but-honest value than silently mangle it.
 */
export function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, "").replace(/^1(\d{10})$/, "$1");
  if (digits.length !== 10) return trimmed;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Fixes the one specific, safe-to-assume-broken case — a name with zero
 * capitalization information (ALL CAPS or all lowercase), which Zillow
 * agent listings frequently have. Anything that already mixes case
 * ("McDonald", "O'Brien", "DeWitt") is left completely alone: a naive
 * word-capitalize would silently break those, and there's no reliable way
 * to tell a real mixed-case name from one that needs fixing without a
 * name database. Leaving a handful of ALL-CAPS names as-is is a much
 * smaller cost than corrupting a name that was already right.
 *
 * Known limitation: suffixes like "III" or "JR" get title-cased too
 * ("Iii", "Jr") when the whole name was shouting — rare enough among real
 * estate agent names not to special-case.
 */
export function normalizeName(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  if (/[a-z]/.test(trimmed) && /[A-Z]/.test(trimmed)) return trimmed;
  return trimmed.toLowerCase().replace(/[a-z]+/g, (word) => word[0].toUpperCase() + word.slice(1));
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function hasValidPhoneDigitCount(phone: string): boolean {
  return phone.replace(/\D/g, "").length >= 10;
}
