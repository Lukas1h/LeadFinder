import { normalizeEmail, normalizeName, normalizePhone } from "./normalize";

/**
 * Listing-agent lookup through Compass, for listings Zillow can't name an
 * agent for.
 *
 * Southern and Central Oregon listings (Medford, Grants Pass, Ashland, Bend)
 * reach Zillow through Oregon Datashare, whose rules only let Zillow show the
 * brokerage — so Zillapi returns a broker and no agent for every one of them,
 * and those listings landed on Leads with nobody to text (about 110 a week,
 * 2026-10-06). Compass's listing pages carry the listing agent's name, phone
 * and email for the same MLS in their schema.org data, answer plain fetches,
 * and cost nothing.
 *
 * Two plain requests: the address autocomplete gives the listing page, and the
 * page's JSON-LD names the agent. Returns null on anything unexpected rather
 * than guessing — a wrong agent is worse than none.
 */

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
const TIMEOUT_MS = 15_000;

export interface CompassAgent {
  agentName: string | null;
  agentPhone: string | null;
  agentEmail: string | null;
}

/** "1811 NE Alameda Ave." → "1811 ne alameda ave" */
function streetKey(s: string): string {
  return s.toLowerCase().replace(/[.,#]/g, " ").replace(/\s+/g, " ").trim();
}

async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, headers: { "user-agent": UA, ...init.headers }, signal: controller.signal });
    return res.ok ? res : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

interface LdPerson {
  "@type"?: string;
  name?: string;
  telephone?: string;
  email?: string;
}

function findOffer(node: unknown): { offeredBy: LdPerson | LdPerson[]; price?: number } | null {
  if (!node || typeof node !== "object") return null;
  const obj = node as Record<string, unknown>;
  if (obj.offeredBy) return { offeredBy: obj.offeredBy as LdPerson, price: typeof obj.price === "number" ? obj.price : undefined };
  for (const value of Object.values(obj)) {
    const found = findOffer(value);
    if (found) return found;
  }
  return null;
}

export async function fetchCompassAgent(listing: {
  address: string | null;
  city: string | null;
  price: number | null;
}): Promise<CompassAgent | null> {
  if (!listing.address || !listing.city) return null;

  const suggest = await fetchWithTimeout("https://www.compass.com/api/v3/omnisuggest/autocomplete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      q: `${listing.address} ${listing.city}`,
      sources: [0, 1, 7, 8, 2, 6, 5, 9, 11, 25, 4, 3, 18, 36],
      preferredUcGeoIdForRanking: "portland_or",
      urlStrategy: 2,
      listingTypes: [2],
    }),
  });
  if (!suggest) return null;

  const data = (await suggest.json().catch(() => null)) as {
    categories?: { items?: { text?: string; subText?: string; redirectUrl?: string }[] }[];
  } | null;
  const items = data?.categories?.flatMap((c) => c.items ?? []) ?? [];
  const wantStreet = streetKey(listing.address);
  const wantCity = listing.city.toLowerCase();
  const match = items.find(
    (i) =>
      i.redirectUrl &&
      i.text &&
      streetKey(i.text) === wantStreet &&
      (i.subText ?? "").toLowerCase().startsWith(wantCity)
  );
  if (!match?.redirectUrl) return null;

  const page = await fetchWithTimeout(`https://www.compass.com${match.redirectUrl}`, { redirect: "follow" });
  if (!page) return null;
  const html = await page.text();

  for (const [, json] of html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      continue;
    }
    const offer = findOffer(parsed);
    if (!offer) continue;

    // The page is whatever Compass last had at this address, which can be an
    // old sale with a different agent. Only trust it when the asking price
    // is close to the listing's.
    if (listing.price && offer.price && Math.abs(offer.price - listing.price) / listing.price > 0.1) return null;

    const people = (Array.isArray(offer.offeredBy) ? offer.offeredBy : [offer.offeredBy]).filter(
      (p) => p?.["@type"] === "Person" && p.name
    );
    const agent = people[0];
    if (!agent) return null;

    return {
      agentName: agent.name ? normalizeName(agent.name) : null,
      agentPhone: agent.telephone ? normalizePhone(agent.telephone) : null,
      agentEmail: agent.email ? normalizeEmail(agent.email) : null,
    };
  }
  return null;
}
