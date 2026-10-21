// homes.com's agent directory search, from plain server-side fetch.
//
// The search is a JSON API (the site's own AgentAutocompleteOperationClient)
// and, unlike the profile pages, Akamai lets it through without a browser.
// Two things to know, both found by reverse engineering the site's bundle
// (2026-10-21):
//
// - The body must be sent as application/json. fetch() labels a string body
//   text/plain by default, and homes.com answers that with 415.
// - The response is obfuscated, with the key in the `c-content` response
//   header. decodeHomesBody below is the site's own scheme
//   (chunk-common.*.js, the "mo" export), ported verbatim.

export const AUTOCOMPLETE_URL = "https://www.homes.com/routes/res/consumer/agent/autocomplete/";
const ROUTE_PART = "/res";

export const HOMES_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36";

/** One agent out of the directory search. */
export interface HomesSuggestion {
  name: string;
  /** "/real-estate-agents/karen-church/0cxt433/" */
  path: string;
  state: string | null;
  city: string | null;
  brokerage: string | null;
}

// --- The site's decoder ------------------------------------------------------

/** Printable-ASCII shift: code - t, wrapping back into 32..126. */
function shiftDecode(text: string, t: number): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const o = text.charCodeAt(i);
    let s = o;
    if (o >= 32 && o <= 126) {
      s = o - t;
      if (s < 32) s = o + 95 - t;
    }
    out += String.fromCharCode(s);
  }
  return out;
}

/** Sum of char codes, % 10, + 1: the fallback shift amount. */
function keyShift(key: string): number {
  let t = 0;
  for (let i = 0; i < key.length; i++) t += key.charCodeAt(i);
  return (t % 10) + 1;
}

/** FNV-1a, 32-bit. */
function fnv1a(text: string): number {
  let t = 2166136261;
  for (let i = 0; i < text.length; i++) {
    t ^= text.charCodeAt(i);
    t = Math.imul(t, 16777619) >>> 0;
  }
  return t >>> 0 || 1;
}

/** The 95 printable codes shuffled by an xorshift32 PRNG seeded from the key, as a decode table. */
function buildTable(key: string): number[] {
  let t = fnv1a(key);
  const next = () => {
    t = (t ^ (t << 13)) >>> 0;
    t = (t ^ (t >>> 17)) >>> 0;
    t = (t ^ (t << 5)) >>> 0;
    return t >>> 0;
  };
  const r: number[] = [];
  for (let e = 0; e < 95; e++) r[e] = 32 + e;
  for (let e = 94; e > 0; e--) {
    const j = next() % (e + 1);
    [r[e], r[j]] = [r[j], r[e]];
  }
  const table: number[] = [];
  for (let e = 0; e < 128; e++) table[e] = e;
  for (let e = 0; e < 95; e++) table[r[e]] = 32 + e;
  return table;
}

function substituteDecode(text: string, key: string): string {
  const table = buildTable(key);
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const o = text.charCodeAt(i);
    out += String.fromCharCode(o < 128 ? table[o] : o);
  }
  return out;
}

/**
 * The key's length picks the scheme: "" (or "sc") shifts by 3, five chars is
 * a substitution table, four chars is a table seeded with the key plus the
 * request path, anything else shifts by keyShift(key).
 */
export function decodeHomesBody(body: string, key: string, requestUrl: string): string {
  if (!body) return "null";
  if (!key || key === "sc") return shiftDecode(body, 3);
  if (key.length === 5) return substituteDecode(body, key);
  if (key.length === 4) {
    let path = decodeURIComponent(new URL(requestUrl).pathname);
    if (path.startsWith(ROUTE_PART)) path = path.slice(ROUTE_PART.length);
    return substituteDecode(body, key + path);
  }
  return shiftDecode(body, keyShift(key));
}

// --- The search ----------------------------------------------------------------

export class HomesBlockedError extends Error {}

/** Agents in homes.com's directory matching a name, nationwide. */
export async function searchHomesAgents(term: string): Promise<HomesSuggestion[]> {
  const res = await fetch(AUTOCOMPLETE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "*/*",
      "User-Agent": HOMES_USER_AGENT,
      Origin: "https://www.homes.com",
      Referer: "https://www.homes.com/real-estate-agents/",
    },
    body: JSON.stringify({ term, location: null, searchType: null, limitResult: false }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = await res.text();
  const key = res.headers.get("c-content");
  if (!res.ok || key === null) throw new HomesBlockedError(`homes.com search: ${res.status}`);

  const decoded = JSON.parse(decodeHomesBody(body, key, AUTOCOMPLETE_URL)) as {
    suggestions?: {
      agents?: { n?: string; u?: string; g?: { a?: { state?: string; city?: string; other?: string } } }[];
    };
  };
  return (decoded.suggestions?.agents ?? [])
    .filter((a) => a.n && a.u)
    .map((a) => ({
      name: a.n!,
      path: a.u!,
      state: a.g?.a?.state?.toUpperCase() ?? null,
      city: a.g?.a?.city ?? null,
      brokerage: a.g?.a?.other ?? null,
    }));
}
