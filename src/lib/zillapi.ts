import type { NewListing } from "@/db/schema";
import mockListings from "../../data/mock-listings.json";

const ZILLAPI_LISTINGS_URL = "https://api.zillapi.com/v1/listings";
const ZILLAPI_PROPERTIES_URL = "https://api.zillapi.com/v1/properties";

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

interface FetchNewListingsOptions {
  maxItems?: number;
}

/**
 * Pulls listings posted in roughly the last day within SEARCH_BBOX,
 * excluding for-sale-by-owner listings.
 *
 * Set USE_MOCK_ZILLAPI=true to read from data/mock-listings.json instead of
 * calling the real API — use this for all local dev/testing once you've
 * captured one real response, so you don't burn free-tier credits.
 */
export async function fetchNewListings(
  options: FetchNewListingsOptions = {}
): Promise<NewListing[]> {
  const maxItems = options.maxItems ?? 50;

  let raw: RawZillapiListing[];

  if (process.env.USE_MOCK_ZILLAPI === "true") {
    raw = (mockListings as RawZillapiListing[]).slice(0, maxItems);
  } else {
    const apiKey = process.env.ZILLAPI_KEY;
    if (!apiKey) {
      throw new Error("ZILLAPI_KEY is not set");
    }

    const bbox = process.env.SEARCH_BBOX;
    if (!bbox) {
      throw new Error("SEARCH_BBOX is not set");
    }

    const params = new URLSearchParams({
      status: "for_sale",
      bbox,
      days_on_zillow: "1",
      max_items: String(maxItems),
    });

    if (process.env.SEARCH_PRICE_MIN) {
      params.set("price_min", process.env.SEARCH_PRICE_MIN);
    }
    if (process.env.SEARCH_PRICE_MAX) {
      params.set("price_max", process.env.SEARCH_PRICE_MAX);
    }
    if (process.env.SEARCH_HOME_TYPES) {
      params.set("home_types", process.env.SEARCH_HOME_TYPES);
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
