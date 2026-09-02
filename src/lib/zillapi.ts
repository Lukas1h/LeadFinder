import type { NewListing } from "@/db/schema";
import mockListings from "../../data/mock-listings.json";

const ZILLAPI_BASE_URL = "https://api.zillapi.com/v1/listings";

/**
 * Zillapi's documented response fields for /v1/listings aren't fully
 * specified (see README). This type is intentionally loose — treat every
 * field as possibly-missing and verify against a real response before
 * relying on a new one.
 */
interface RawZillapiListing {
  zpid?: string | number;
  address?: string;
  streetAddress?: string;
  city?: string;
  state?: string;
  zipcode?: string;
  zipCode?: string;
  price?: number;
  bedrooms?: number;
  bathrooms?: number;
  livingArea?: number;
  homeType?: string;
  homeStatus?: string;
  latitude?: number;
  longitude?: number;
  detailUrl?: string;
  hdpUrl?: string;
  listingUrl?: string;
  datePostedString?: string;
  listedDate?: string;
  timeOnZillow?: string;
  [key: string]: unknown;
}

interface ZillapiListResponse {
  results?: RawZillapiListing[];
  listings?: RawZillapiListing[];
  [key: string]: unknown;
}

function zillowLinkFromZpid(zpid: string): string {
  return `https://www.zillow.com/homedetails/${zpid}_zpid/`;
}

export function normalizeListing(raw: RawZillapiListing): NewListing | null {
  const zpid = raw.zpid != null ? String(raw.zpid) : null;
  if (!zpid) return null;

  const listingUrl =
    raw.detailUrl ?? raw.hdpUrl ?? raw.listingUrl ?? zillowLinkFromZpid(zpid);

  const listedAtRaw = raw.datePostedString ?? raw.listedDate;
  const listedAt = listedAtRaw ? new Date(listedAtRaw) : null;

  return {
    zpid,
    address: raw.address ?? raw.streetAddress ?? null,
    city: raw.city ?? null,
    state: raw.state ?? null,
    zipcode: raw.zipcode ?? raw.zipCode ?? null,
    price: raw.price != null ? Math.round(raw.price) : null,
    bedrooms: raw.bedrooms != null ? String(raw.bedrooms) : null,
    bathrooms: raw.bathrooms != null ? String(raw.bathrooms) : null,
    livingArea: raw.livingArea != null ? Math.round(raw.livingArea) : null,
    homeType: raw.homeType ?? null,
    listingUrl,
    listedAt: listedAt && !isNaN(listedAt.getTime()) ? listedAt : null,
  };
}

interface FetchNewListingsOptions {
  maxItems?: number;
}

/**
 * Pulls listings posted in roughly the last day within SEARCH_BBOX.
 *
 * Set USE_MOCK_ZILLAPI=true to read from data/mock-listings.json instead of
 * calling the real API — use this for all local dev/testing once you've
 * captured one real response, so you don't burn free-tier credits.
 */
export async function fetchNewListings(
  options: FetchNewListingsOptions = {}
): Promise<NewListing[]> {
  const maxItems = options.maxItems ?? 50;

  if (process.env.USE_MOCK_ZILLAPI === "true") {
    const raw = (mockListings as RawZillapiListing[]).slice(0, maxItems);
    return raw.map(normalizeListing).filter((l): l is NewListing => l !== null);
  }

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

  const res = await fetch(`${ZILLAPI_BASE_URL}?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Zillapi request failed: ${res.status} ${body}`);
  }

  const data = (await res.json()) as ZillapiListResponse;
  const raw = data.results ?? data.listings ?? [];

  return raw
    .map(normalizeListing)
    .filter((l): l is NewListing => l !== null);
}
