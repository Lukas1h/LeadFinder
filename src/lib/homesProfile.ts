// Parses a saved homes.com agent-profile page into the fields worth keeping.
// homes.com server-renders everything (no client-side API call to replicate —
// confirmed from a HAR capture 2026-10-21) but Akamai 403s any fetch from our
// own servers, headless or not. So there's no fetching this ourselves: a
// Tampermonkey userscript (scripts/userscripts/homes-agent-capture.user.js)
// posts the page's HTML here whenever Lukas visits one while browsing, via
// POST /api/agent-profile-capture.

export interface HomesProfile {
  name: string | null;
  phone: string | null;
  brokerage: string | null;
  licenseId: string | null;
  url: string;
  /** This year's deals (buyer + seller), the closest thing homes.com shows to "listings per year". */
  dealsThisYear: number | null;
  /** From the FAQ sentence ("closed N sales totaling $X … average sale price of $Y"): career-to-date, not annual. */
  avgSalePrice: number | null;
  activeListings: number;
}

const num = (s: string | undefined | null): number | null => {
  if (!s) return null;
  const n = Number(s.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : null;
};

/** "$377.2K" / "$2.3M" → 377200 / 2300000. */
function parseMoney(s: string): number | null {
  const m = s.match(/\$?([\d.]+)\s*(K|M)?/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * (m[2]?.toUpperCase() === "M" ? 1_000_000 : m[2]?.toUpperCase() === "K" ? 1_000 : 1));
}

export function parseHomesProfile(html: string, url: string): HomesProfile | null {
  const text = html; // the regexes below search the raw markup, not stripped text

  const name = text.match(/"name":"([^"]{2,80})"[^}]*"@id":"https:\/\/www\.homes\.com\/real-estate-agents\//)?.[1]
    ?? text.match(/<title>([^|<]+)\s*\|/)?.[1]?.trim()
    ?? null;
  const phoneDigits = text.match(/"telephone":"\+1-(\d{3})-(\d{3})-(\d{4})"/);
  const phone = phoneDigits ? `${phoneDigits[1]}${phoneDigits[2]}${phoneDigits[3]}` : null;
  const brokerage = text.match(/"worksFor":\{"@type":"Organization","name":"([^"]+)"/)?.[1] ?? null;
  const licenseId = text.match(/"credentialCategory":"license","identifier":"(\d+)"/)?.[1] ?? null;

  if (!name && !phone) return null; // not a profile page, or a shape we don't recognize

  // "Total Deals" appears twice under the 1-year tab (Seller Deals, Buyer Deals); sum both.
  const dealCounts = [...text.matchAll(/Total\s*Deals[^\d]{0,200}?([\d,]+)/gi)].map((m) => num(m[1]) ?? 0);
  const dealsThisYear = dealCounts.length ? dealCounts.reduce((a, b) => a + b, 0) : null;

  const faq = text.match(/closed\s+([\d,]+)\s+sales?\s+totaling\s+\$?([\d.]+[KM]?)[^.]*average sale price of\s+\$?([\d.]+[KM]?)/i);
  const avgSalePrice = faq ? parseMoney(faq[3]) : null;

  const activeListings = (text.match(/"availability":"https:\/\/schema\.org\/InStock"/g) ?? []).length;

  return {
    name,
    phone,
    brokerage,
    licenseId,
    url,
    dealsThisYear: dealsThisYear && dealsThisYear > 0 ? dealsThisYear : null,
    avgSalePrice,
    activeListings,
  };
}
