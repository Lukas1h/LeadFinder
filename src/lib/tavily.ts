const TAVILY_SEARCH_URL = "https://api.tavily.com/search";

interface TavilyResult {
  title?: string;
  url?: string;
}

/**
 * Returns the top result for a query, optionally restricted to one domain
 * via Tavily's include_domains filter — the same "first Google result" a
 * person would click by hand, resolved server-side instead of sending the
 * user through a search page themselves.
 *
 * Returns null on any failure (missing key, network error, no results) so
 * callers can fall back to a plain search link instead of breaking — this
 * is a "nice to have" shortcut, never something a button should hard-fail
 * on.
 */
async function findFirstResult(query: string, domain?: string): Promise<TavilyResult | null> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch(TAVILY_SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query,
        max_results: 1,
        include_domains: domain ? [domain] : undefined,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;

    const data = (await res.json()) as { results?: TavilyResult[] };
    return data.results?.[0] ?? null;
  } catch {
    return null;
  }
}

export async function findFirstResultUrl(query: string, domain?: string): Promise<string | null> {
  const result = await findFirstResult(query, domain);
  return result?.url ?? null;
}

/**
 * Same as findFirstResultUrl, but for site-restricted address searches
 * where a wrong match is worse than no match — e.g. Redfin doesn't have
 * every Zillow-sourced listing indexed, and without this Tavily happily
 * returns a *different*, nearby property's page instead of an empty result
 * (verified live: searching a real Winston, OR address on redfin.com
 * returned a listing three streets over). Requiring the house number to
 * actually appear in the result's title is a cheap, effective guard against
 * silently sending someone to the wrong house.
 */
export async function findFirstAddressResultUrl(query: string, domain: string, streetAddress: string): Promise<string | null> {
  const result = await findFirstResult(query, domain);
  if (!result?.url) return null;

  const houseNumber = streetAddress.match(/^\d+/)?.[0];
  if (houseNumber && !result.title?.includes(houseNumber)) return null;

  return result.url;
}
