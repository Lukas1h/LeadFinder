const TAVILY_SEARCH_URL = "https://api.tavily.com/search";

interface TavilyResult {
  title?: string;
  url?: string;
}

/**
 * Returns up to maxResults results for a query, optionally restricted to
 * one domain via Tavily's include_domains filter — the same "Google
 * result" a person would see by hand, resolved server-side instead of
 * sending the user through a search page themselves.
 *
 * Returns [] on any failure (missing key, network error, no results) so
 * callers can fall back to a plain search link instead of breaking — this
 * is a "nice to have" shortcut, never something a button should hard-fail
 * on.
 */
async function findResults(
  query: string,
  domain?: string,
  maxResults = 1,
  searchDepth: "basic" | "advanced" = "basic"
): Promise<TavilyResult[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return [];

  try {
    const res = await fetch(TAVILY_SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query,
        max_results: maxResults,
        search_depth: searchDepth,
        include_domains: domain ? [domain] : undefined,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];

    const data = (await res.json()) as { results?: TavilyResult[] };
    return data.results ?? [];
  } catch {
    return [];
  }
}

export async function findFirstResultUrl(query: string, domain?: string): Promise<string | null> {
  const [result] = await findResults(query, domain, 1);
  return result?.url ?? null;
}

/**
 * Same as findFirstResultUrl, but for site-restricted address searches
 * where a wrong (or generic search-page) match is worse than no match.
 * Problems verified live on realtor.com, all for real addresses:
 *  - Redfin doesn't have every Zillow-sourced listing indexed, and without
 *    a check Tavily happily returns a *different*, nearby property's page
 *    instead of an empty result (a Winston, OR address returned a listing
 *    three streets over).
 *  - The correct exact-match detail page doesn't reliably rank first, or
 *    even in the top few — one address only surfaced at position 5 of 5
 *    results, another didn't appear at all in 5 results but did in 10 (the
 *    same query against the same index isn't fully deterministic between
 *    calls). Only checking result[0], or too few results, throws away a
 *    real match that exists a few slots down.
 *  - House number alone isn't enough to validate a match: a single town
 *    can have the same house number on several different streets (600
 *    Railroad Ave, 600 Kings Ave, 600 Hilltop Dr all showed up as decoys
 *    for a "600 Queens Ct" search) — a same-number-wrong-street result
 *    would otherwise pass validation if it happened to rank above the
 *    real one.
 * Scanning 10 results at advanced depth and requiring both the house
 * number AND the street name to appear in the title guards against all
 * three.
 */
export async function findFirstAddressResultUrl(query: string, domain: string, streetAddress: string): Promise<string | null> {
  const results = await findResults(query, domain, 10, "advanced");
  const [houseNumber, streetName] = streetAddress.trim().split(/\s+/);
  const match = results.find((r) => {
    const title = r.title?.toLowerCase();
    if (!title) return false;
    if (houseNumber && !title.includes(houseNumber.toLowerCase())) return false;
    if (streetName && !title.includes(streetName.toLowerCase())) return false;
    return true;
  });
  return match?.url ?? null;
}

/**
 * Like findFirstResultUrl, but scans a few results and returns the first
 * whose title contains every word of `name` — a bare-name search for a
 * common surname doesn't reliably rank the right person's own profile
 * first. Verified live on zillow.com: a plain "Chandra Reynolds" search
 * ranked a generic zip-code reviews page above her actual profile, and a
 * differently-phrased query matched an unrelated "Joan Reynolds" outright.
 * Requiring every name token to appear in the title is a cheap guard
 * against landing on the wrong person's page.
 */
export async function findFirstNameMatchResultUrl(name: string, domain: string): Promise<string | null> {
  const results = await findResults(name, domain, 5, "advanced");
  const tokens = name.toLowerCase().split(/\s+/).filter(Boolean);
  const match = results.find((r) => tokens.every((t) => r.title?.toLowerCase().includes(t)));
  return match?.url ?? null;
}
