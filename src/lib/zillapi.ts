import type { NewListing } from "@/db/schema";
import mockListings from "../../data/mock-listings.json";

const ZILLAPI_LISTINGS_URL = "https://api.zillapi.com/v1/listings";
const ZILLAPI_PROPERTIES_URL = "https://api.zillapi.com/v1/properties";
const ZILLAPI_ME_URL = "https://api.zillapi.com/v1/me";

/**
 * Verified against a real GET /v1/listings response on 2026-09-01 — Zillapi's
 * docs don't spell this out. Nested under listingPrice/listingAddress, no
 * exact "listed date" field (only a daysOnZillow count), FSBO indicated by
 * listingType.isFSBO.
 */
interface RawZillapiListing {
  zpid?: string | number;
  listingPrice?: { amount?: number };
  listingAddress?: {
    street?: string;
    city?: string;
    state?: string;
    zipCode?: string;
  };
  bedrooms?: number;
  bathrooms?: number;
  livingArea?: number;
  homeType?: string;
  propertyUrl?: string;
  daysOnZillow?: number;
  listingType?: { isFSBO?: boolean; isComingSoon?: boolean };
  listingPhotos?: { url?: string }[];
  photoCount?: number;
  broker?: { name?: string };
  [key: string]: unknown;
}

interface ZillapiListResponse {
  data?: RawZillapiListing[];
  meta?: { count?: number };
  [key: string]: unknown;
}

function zillowLinkFromZpid(zpid: string): string {
  return `https://www.zillow.com/homedetails/${zpid}_zpid/`;
}

export function normalizeListing(raw: RawZillapiListing): NewListing | null {
  const zpid = raw.zpid != null ? String(raw.zpid) : null;
  if (!zpid) return null;

  const listedAt =
    raw.daysOnZillow != null
      ? new Date(Date.now() - raw.daysOnZillow * 24 * 60 * 60 * 1000)
      : null;

  return {
    zpid,
    address: raw.listingAddress?.street ?? null,
    city: raw.listingAddress?.city ?? null,
    state: raw.listingAddress?.state ?? null,
    zipcode: raw.listingAddress?.zipCode ?? null,
    price: raw.listingPrice?.amount != null ? Math.round(raw.listingPrice.amount) : null,
    bedrooms: raw.bedrooms != null ? String(raw.bedrooms) : null,
    bathrooms: raw.bathrooms != null ? String(raw.bathrooms) : null,
    livingArea: raw.livingArea != null ? Math.round(raw.livingArea) : null,
    homeType: raw.homeType ?? null,
    listingUrl: raw.propertyUrl ?? zillowLinkFromZpid(zpid),
    // Approximate — Zillapi returns a daysOnZillow count, not an exact date.
    listedAt,
    photos: raw.listingPhotos?.map((p) => p.url).filter((u): u is string => !!u) ?? null,
    photoCount: raw.photoCount ?? null,
    isComingSoon: raw.listingType?.isComingSoon ?? false,
    brokerName: raw.broker?.name ?? null,
  };
}

export interface ZillapiAccountUsage {
  creditsBalance: number;
  creditsPerCycle: number;
}

/**
 * GET /v1/me — verified 2026-09-03 against the real account: returns
 * data.credits.balance and data.plan.credits_per_cycle. Free to call, no
 * credits charged (confirmed via a real call that left the balance
 * unchanged) — safe to call on every Settings page load.
 */
export async function fetchAccountUsage(): Promise<ZillapiAccountUsage | null> {
  const apiKey = process.env.ZILLAPI_KEY;
  if (!apiKey) return null;

  const res = await fetch(ZILLAPI_ME_URL, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) return null;

  const parsed = (await res.json()) as {
    data?: { credits?: { balance?: number }; plan?: { credits_per_cycle?: number } };
  };

  if (parsed.data?.credits?.balance == null) return null;

  return {
    creditsBalance: parsed.data.credits.balance,
    creditsPerCycle: parsed.data.plan?.credits_per_cycle ?? 0,
  };
}

export interface SearchSourceFilter {
  bbox: string;
  priceMin?: number | null;
  priceMax?: number | null;
  homeTypes?: string | null;
}

interface FetchNewListingsOptions extends SearchSourceFilter {
  maxItems?: number;
}

/**
 * Pulls listings posted in roughly the last day within the given source's
 * bbox/filters, excluding for-sale-by-owner listings. One call per search
 * source (see runSync in src/lib/sync.ts) — each source is its own bbox,
 * its own Zillapi credits.
 *
 * Set USE_MOCK_ZILLAPI=true to read from data/mock-listings.json instead of
 * calling the real API — use this for all local dev/testing once you've
 * captured one real response, so you don't burn free-tier credits. Mock
 * mode ignores the source's actual filters and just returns the fixture.
 */
export async function fetchNewListings(options: FetchNewListingsOptions): Promise<NewListing[]> {
  const maxItems = options.maxItems ?? 50;

  let raw: RawZillapiListing[];

  if (process.env.USE_MOCK_ZILLAPI === "true") {
    raw = (mockListings as RawZillapiListing[]).slice(0, maxItems);
  } else {
    const apiKey = process.env.ZILLAPI_KEY;
    if (!apiKey) {
      throw new Error("ZILLAPI_KEY is not set");
    }

    const params = new URLSearchParams({
      status: "for_sale",
      bbox: options.bbox,
      days_on_zillow: "1",
      max_items: String(maxItems),
    });

    if (options.priceMin != null) {
      params.set("price_min", String(options.priceMin));
    }
    if (options.priceMax != null) {
      params.set("price_max", String(options.priceMax));
    }
    if (options.homeTypes) {
      params.set("home_types", options.homeTypes);
    }

    const res = await fetch(`${ZILLAPI_LISTINGS_URL}?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Zillapi request failed: ${res.status} ${body}`);
    }

    const parsed = (await res.json()) as ZillapiListResponse;
    raw = parsed.data ?? [];
  }

  return raw
    .filter((item) => item.listingType?.isFSBO !== true)
    .map(normalizeListing)
    .filter((l): l is NewListing => l !== null);
}

interface AgentInfo {
  agentName: string | null;
  agentPhone: string | null;
  brokerName: string | null;
}

/**
 * GET /v1/properties/{zpid} — the full property details endpoint, NOT the
 * dedicated /v1/properties/{zpid}/agent sub-resource. Always 1 credit per
 * call — confirmed via the x-credits-charged response header, even on a
 * repeat call for a zpid already fetched minutes earlier, so the docs'
 * "0 credits on a cache hit ≤24h" claim doesn't hold in practice. Verified
 * against 2 real RMLS (OR) listings: the dedicated /agent endpoint never
 * returns a phone number despite its docs claiming it does, but this one
 * reliably does, under data.agent.phoneNumber / data.broker.phoneNumber.
 */
export async function fetchAgentInfo(zpid: string): Promise<AgentInfo> {
  if (process.env.USE_MOCK_ZILLAPI === "true") {
    const mock = (
      mockListings as { zpid: string; mockAgentName?: string; mockAgentPhone?: string }[]
    ).find((m) => m.zpid === zpid);
    return {
      agentName: mock?.mockAgentName ?? null,
      agentPhone: mock?.mockAgentPhone ?? null,
      brokerName: null,
    };
  }

  const apiKey = process.env.ZILLAPI_KEY;
  if (!apiKey) {
    throw new Error("ZILLAPI_KEY is not set");
  }

  const res = await fetch(`${ZILLAPI_PROPERTIES_URL}/${zpid}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!res.ok) {
    return { agentName: null, agentPhone: null, brokerName: null };
  }

  const parsed = (await res.json()) as {
    data?: {
      agent?: { name?: string; phoneNumber?: string };
      broker?: { name?: string };
    };
  };

  return {
    agentName: parsed.data?.agent?.name ?? null,
    agentPhone: parsed.data?.agent?.phoneNumber ?? null,
    brokerName: parsed.data?.broker?.name ?? null,
  };
}

interface RawZillapiProperty {
  zpid?: string | number;
  price?: number;
  address?: { street?: string; city?: string; state?: string; zipcode?: string };
  bedrooms?: number;
  bathrooms?: number;
  livingArea?: number;
  homeType?: string;
  hdpUrl?: string;
  daysOnZillow?: number;
  isComingSoon?: boolean;
  photos?: { url?: string }[];
  photoCount?: number;
  agent?: { name?: string; phoneNumber?: string };
  broker?: { name?: string };
  [key: string]: unknown;
}

/**
 * GET /v1/properties/{zpid} used as a single-listing lookup for zpids that
 * arrive outside the bbox search — e.g. discovered from a Zillow email
 * alert (see src/app/api/webhooks/agentmail/route.ts) rather than from
 * fetchNewListings. Shape here is UNVERIFIED against a real response
 * (unlike fetchAgentInfo's data.agent/data.broker nesting, which was
 * cross-checked against a real listing) — nested fields default to null
 * rather than throwing if Zillapi's actual field names differ, so a wrong
 * guess degrades gracefully into a listing with sparse data instead of a
 * dropped lead. Re-verify field names against a real response before this
 * runs against real email traffic.
 */
export async function fetchFullListing(zpid: string): Promise<NewListing | null> {
  const apiKey = process.env.ZILLAPI_KEY;
  if (!apiKey) {
    throw new Error("ZILLAPI_KEY is not set");
  }

  const res = await fetch(`${ZILLAPI_PROPERTIES_URL}/${zpid}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!res.ok) return null;

  const parsed = (await res.json()) as { data?: RawZillapiProperty };
  const raw = parsed.data;
  if (!raw) return null;

  const listedAt =
    raw.daysOnZillow != null
      ? new Date(Date.now() - raw.daysOnZillow * 24 * 60 * 60 * 1000)
      : null;

  return {
    zpid,
    address: raw.address?.street ?? null,
    city: raw.address?.city ?? null,
    state: raw.address?.state ?? null,
    zipcode: raw.address?.zipcode ?? null,
    price: raw.price != null ? Math.round(raw.price) : null,
    bedrooms: raw.bedrooms != null ? String(raw.bedrooms) : null,
    bathrooms: raw.bathrooms != null ? String(raw.bathrooms) : null,
    livingArea: raw.livingArea != null ? Math.round(raw.livingArea) : null,
    homeType: raw.homeType ?? null,
    listingUrl: raw.hdpUrl ?? zillowLinkFromZpid(zpid),
    listedAt,
    photos: raw.photos?.map((p) => p.url).filter((u): u is string => !!u) ?? null,
    photoCount: raw.photoCount ?? null,
    isComingSoon: raw.isComingSoon ?? false,
    brokerName: raw.broker?.name ?? null,
    agentName: raw.agent?.name ?? null,
    agentPhone: raw.agent?.phoneNumber ?? null,
  };
}
