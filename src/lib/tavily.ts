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
 * where a wrong (or generic search-page) match is worse than no match. Two
 * problems verified live on realtor.com for the same real address:
 *  - Redfin doesn't have every Zillow-sourced listing indexed, and without
 *    a check Tavily happily returns a *different*, nearby property's page
 *    instead of an empty result (searching a Winston, OR address on
 *    redfin.com returned a listing three streets over).
 *  - The correct exact-match detail page can rank well below a generic
 *    county/city search page rather than first — for that same Winston
 *    address it only surfaced at position 5 of 5, and only with
 *    search_depth "advanced" (basic depth didn't surface it in the top 5
 *    at all). Only checking result[0] would've thrown away a real match
 *    that existed a few slots down.
 * Scanning several results with advanced depth and requiring the house
 * number to actually appear in the title finds that real match instead of
 * settling for "well, it wasn't first" and falling back to a search link.
 */
export async function findFirstAddressResultUrl(query: string, domain: string, streetAddress: string): Promise<string | null> {
  const results = await findResults(query, domain, 5, "advanced");
  const houseNumber = streetAddress.match(/^\d+/)?.[0];
  const match = results.find((r) => !houseNumber || r.title?.includes(houseNumber));
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
