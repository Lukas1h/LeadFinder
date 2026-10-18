import type { NewListing } from "@/db/schema";
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

/** The Compass listing page for an address, from the address autocomplete. Null unless street and city both match. */
async function findListingPath(address: string, city: string): Promise<string | null> {
  const suggest = await fetchWithTimeout("https://www.compass.com/api/v3/omnisuggest/autocomplete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      q: `${address} ${city}`,
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
  const wantStreet = streetKey(address);
  const wantCity = city.toLowerCase();
  const match = items.find(
    (i) =>
      i.redirectUrl &&
      i.text &&
      streetKey(i.text) === wantStreet &&
      (i.subText ?? "").toLowerCase().startsWith(wantCity)
  );
  return match?.redirectUrl ?? null;
}

export interface CompassStatus {
  /** Compass's own wording: "Active", "Pending", "Active Under Contract", "Sold", "Closed"… */
  status: string;
  /** When it went under contract, if it has. */
  contractAt: Date | null;
  /** When the sale closed, if it has. */
  closedAt: Date | null;
}

/**
 * Where a listing stands on the market, from the same Compass page the agent
 * lookup reads. The first "localizedStatus" on the page is the listing the
 * page is about (later ones belong to nearby homes), and the "date" object
 * right after it carries the contract and closing dates in epoch ms. Null when
 * Compass doesn't have the address or the page has no status.
 */
export async function fetchCompassStatus(listing: {
  address: string | null;
  city: string | null;
}): Promise<CompassStatus | null> {
  if (!listing.address || !listing.city) return null;
  const path = await findListingPath(listing.address, listing.city);
  if (!path) return null;

  const page = await fetchWithTimeout(`https://www.compass.com${path}`, { redirect: "follow" });
  if (!page) return null;
  const html = await page.text();

  const marker = '"localizedStatus":"';
  const at = html.indexOf(marker);
  if (at < 0) return null;
  const status = html.slice(at + marker.length, html.indexOf('"', at + marker.length));
  if (!status) return null;

  let dates: { contract?: number; closed?: number } = {};
  const dateAt = html.indexOf('"date":{', at);
  // The date object belongs to this status only if it follows closely; further
  // on it would be another home's.
  if (dateAt >= 0 && dateAt - at < 2000) {
    try {
      dates = JSON.parse(html.slice(dateAt + '"date":'.length, html.indexOf("}", dateAt) + 1));
    } catch {
      dates = {};
    }
  }
  const toDate = (ms: unknown) => (typeof ms === "number" && ms > 0 ? new Date(ms) : null);
  return { status, contractAt: toDate(dates.contract), closedAt: toDate(dates.closed) };
}

export async function fetchCompassAgent(listing: {
  address: string | null;
  city: string | null;
  price: number | null;
}): Promise<CompassAgent | null> {
  if (!listing.address || !listing.city) return null;

  const path = await findListingPath(listing.address, listing.city);
  if (!path) return null;

  const page = await fetchWithTimeout(`https://www.compass.com${path}`, { redirect: "follow" });
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

/**
 * Everything a new lead needs, from the listing's Compass page, so an alert
 * listing doesn't cost a Zillapi credit (Zillapi ran about 3,000 credits a
 * month over its plan, nearly all on alert listings, 2026-10-17). The page's
 * window.__INITIAL_DATA__ carries the full listing: every photo (the same
 * count Zillow shows, checked on 2026-10-17), the listing agent's cell and
 * email, the brokerage, price, list date, price history, and size.
 *
 * Null unless it's clearly the same, still-for-sale listing with an agent to
 * text: an active or coming-soon status, a price within 10% of the one we
 * expect (the email's), and a named agent with a phone. Anything less goes to
 * the paid lookup instead.
 */
export interface CompassListing {
  listing: Omit<NewListing, "zpid">;
  agentEmail: string | null;
}

interface CompassInitialListing {
  localizedStatus?: string;
  location?: { city?: string; state?: string; zipCode?: string };
  size?: { bedrooms?: number; totalBathrooms?: number; bathrooms?: number; squareFeet?: number };
  price?: { lastKnown?: number; listed?: number };
  date?: { listed?: number };
  history?: { timestamp?: number; localizedStatus?: string; price?: number }[];
  media?: { category?: number; originalUrl?: string }[];
  fullContacts?: { company?: string; email?: string; contactName?: string; phone?: string; mobile?: string; contactType?: string }[];
  detailedInfo?: { propertyType?: { masterType?: { GLOBAL?: string[] } } };
}

// Compass's property types -> the Zillow homeType values the rest of the app uses.
const HOME_TYPES: [RegExp, string][] = [
  [/single family/i, "SINGLE_FAMILY"],
  [/condo|co-?op/i, "CONDO"],
  [/town/i, "TOWNHOUSE"],
  [/multi/i, "MULTI_FAMILY"],
  [/manufactured|mobile/i, "MANUFACTURED"],
  [/land|lot/i, "LOT"],
];

/** "CAPITOL REAL ESTATE" -> "Capitol Real Estate"; mixed case is left alone. */
function tidyName(name: string): string {
  return /[a-z]/.test(name) ? name.trim() : name.trim().toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/**
 * Price cuts since the latest listing (or relisting), from the page's history,
 * newest first, the same shape summarizePriceHistory gives for Zillow's.
 */
function compassPriceCuts(history: CompassInitialListing["history"]) {
  const events = (history ?? []).filter((e) => e.timestamp).sort((a, b) => b.timestamp! - a.timestamp!);
  const listedIdx = events.findIndex((e) => /listed|coming soon/i.test(e.localizedStatus ?? ""));
  if (listedIdx === -1) return {};
  const sinceListed = events.slice(0, listedIdx + 1);
  const cuts = sinceListed.filter((e, i) => {
    const before = sinceListed[i + 1];
    return /price change/i.test(e.localizedStatus ?? "") && e.price != null && before?.price != null && e.price < before.price;
  });
  const latest = cuts[0];
  const beforeLatest = latest ? sinceListed[sinceListed.indexOf(latest) + 1] : null;
  return {
    originalPrice: events[listedIdx].price ?? null,
    priceCutCount: cuts.length,
    priceCutAt: latest ? new Date(latest.timestamp!) : null,
    priceCutAmount: latest && beforeLatest?.price ? Math.round(beforeLatest.price - latest.price!) : null,
  };
}

export async function fetchCompassListing(listing: {
  address: string;
  city: string;
  price: number | null;
}): Promise<CompassListing | null> {
  const path = await findListingPath(listing.address, listing.city);
  if (!path) return null;
  const page = await fetchWithTimeout(`https://www.compass.com${path}`, { redirect: "follow" });
  if (!page) return null;
  const html = await page.text();

  const marker = "window.__INITIAL_DATA__ = ";
  const start = html.indexOf(marker);
  if (start < 0) return null;
  let blob = html.slice(start + marker.length, html.indexOf("</script>", start)).trim();
  if (blob.endsWith(";")) blob = blob.slice(0, -1);
  let data: CompassInitialListing | undefined;
  try {
    data = (JSON.parse(blob) as { props?: { listingRelation?: { listing?: CompassInitialListing } } }).props?.listingRelation
      ?.listing;
  } catch {
    return null;
  }
  if (!data) return null;

  const status = data.localizedStatus ?? "";
  if (!/^active|coming soon/i.test(status) || /under contract|pending/i.test(status)) return null;

  const price = data.price?.lastKnown ?? data.price?.listed ?? null;
  if (listing.price && price && Math.abs(price - listing.price) / listing.price > 0.1) return null;

  const contact = data.fullContacts?.find((c) => /listing agent/i.test(c.contactType ?? "")) ?? data.fullContacts?.[0];
  // The cell first: it's the number Zillow shows, and the one that takes a text.
  const phone = contact?.mobile || contact?.phone;
  if (!contact?.contactName || !phone) return null;

  // Photos at 1024px: plenty to score and show, a third of the original's size.
  const photos = (data.media ?? [])
    .filter((m) => (m.category ?? 0) === 0 && m.originalUrl)
    .map((m) => m.originalUrl!.replace(/\/origin\.jpg$/, "/1024x768.jpg"));
  const type = data.detailedInfo?.propertyType?.masterType?.GLOBAL?.[0] ?? "";
  const listedFrom = (data.history ?? [])
    .filter((e) => e.timestamp && /listed|coming soon/i.test(e.localizedStatus ?? ""))
    .map((e) => e.timestamp!)
    .sort((a, b) => b - a)[0] ?? data.date?.listed;

  return {
    agentEmail: contact.email ? normalizeEmail(contact.email) : null,
    listing: {
      address: listing.address,
      city: data.location?.city ?? listing.city,
      state: data.location?.state ?? "OR",
      zipcode: data.location?.zipCode ?? null,
      price,
      bedrooms: data.size?.bedrooms != null ? String(data.size.bedrooms) : null,
      bathrooms: (data.size?.totalBathrooms ?? data.size?.bathrooms) != null ? String(data.size?.totalBathrooms ?? data.size?.bathrooms) : null,
      livingArea: data.size?.squareFeet ?? null,
      homeType: HOME_TYPES.find(([re]) => re.test(type))?.[1] ?? null,
      listedAt: listedFrom ? new Date(listedFrom) : null,
      photos,
      photoCount: photos.length,
      isComingSoon: /coming soon/i.test(status),
      brokerName: contact.company ? tidyName(contact.company) : null,
      agentName: normalizeName(contact.contactName),
      agentPhone: normalizePhone(phone),
      ...compassPriceCuts(data.history),
    },
  };
}
