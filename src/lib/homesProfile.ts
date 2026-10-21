// Parses a saved homes.com agent-profile page into the fields worth keeping.
//
// homes.com server-renders everything (there's no client-side API carrying
// these numbers; confirmed from a HAR capture 2026-10-21). The page reaches
// this parser from the daily refresh (lib/homesRefresh.ts, through a web
// unblocker, since Akamai 403s a direct fetch) or from the Tampermonkey
// userscript via POST /api/agent-profile-capture.
//
// The page's shape, read off a real profile (Geoff O'Neill, Medford OR,
// captured 2026-10-21):
//
//   - One <script type="application/ld+json"> holds a ProfilePage whose
//     mainEntity is the agent as a Person node — but with only @type, @id and
//     name. The phone, brokerage and license live in a second copy of the
//     agent's JSON further down the page, so the two are read from different
//     places.
//   - Transaction history sits in three tab panels — #1-year-panel,
//     #2-year-panel and #5-year-panel — each holding a Seller Deals and a
//     Buyer Deals table. All three are in the markup at once, so a page-wide
//     search for "Total Deals" turns up six numbers: the sum of three
//     OVERLAPPING windows, which means nothing. Each tab is read on its own.
//   - The headline ("39 Closed Sales … $372.2K Average Price, Prior 5
//     years") and the FAQ answer describe the FIVE-year window, not the
//     agent's career, so the five-year panel is where the average price
//     comes from.

export interface HomesProfile {
  name: string | null;
  phone: string | null;
  brokerage: string | null;
  licenseId: string | null;
  url: string;
  /** Seller + buyer deals closed in the last 12 months — the page's "1 Year" tab. */
  dealsThisYear: number | null;
  /** Their typical sale price, from the page's five-year totals. */
  avgSalePrice: number | null;
  /** The same average over the last 12 months — the same year as dealsThisYear, but a much thinner sample. */
  avgSalePriceOneYear: number | null;
  /** Seller + buyer deals over five years — the number on the page's headline. */
  dealsFiveYear: number | null;
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

/**
 * The agent's own Person node out of the page's JSON-LD. The @id is what
 * identifies it — a profile page mentions other people (testimonials, agents
 * quoted in a listing description), so the first Person node on the page is
 * not automatically the agent.
 */
function agentName(html: string): string | null {
  const script = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
  if (script) {
    try {
      const nodes: Record<string, unknown>[] = [];
      const walk = (node: unknown): void => {
        if (Array.isArray(node)) {
          node.forEach(walk);
          return;
        }
        if (node && typeof node === "object") {
          nodes.push(node as Record<string, unknown>);
          Object.values(node).forEach(walk);
        }
      };
      walk(JSON.parse(script[1].trim()));
      const person = nodes.find(
        (n) =>
          n["@type"] === "Person" &&
          typeof n["@id"] === "string" &&
          n["@id"].includes("/real-estate-agents/") &&
          typeof n.name === "string"
      );
      if (person) return (person.name as string).trim();
    } catch {
      // Malformed JSON-LD is not fatal — the <title> below still names the agent.
    }
  }
  return html.match(/<title>([^|<]+)\s*\|/)?.[1]?.trim() ?? null;
}

/** The transaction-history tab panel, sliced out of the markup by its id. */
function panelHtml(html: string, panelId: string): string | null {
  const start = html.indexOf(`id="${panelId}"`);
  if (start === -1) return null;
  // Every panel opens with role="tabpanel", so the next one marks the end of
  // this one. (The role attribute comes BEFORE the id in the markup, so
  // searching from past our own id can't match our own panel.)
  const next = html.indexOf('role="tabpanel"', start + panelId.length + 4);
  return next === -1 ? html.slice(start) : html.slice(start, next);
}

interface PanelStats {
  /** Seller + buyer deals in the window. */
  deals: number | null;
  /** Total money those deals moved. */
  totalValue: number | null;
}

function panelStats(panel: string | null): PanelStats {
  if (!panel) return { deals: null, totalValue: null };
  const deals = [...panel.matchAll(/Total\s*Deals[^0-9]{0,200}?([\d,]+)/gi)].map((m) => num(m[1]) ?? 0);
  const values = [...panel.matchAll(/Total\s*Value[^0-9$]{0,200}?\$([\d,]+)/gi)].map((m) => num(m[1]) ?? 0);
  return {
    deals: deals.length ? deals.reduce((a, b) => a + b, 0) : null,
    totalValue: values.length ? values.reduce((a, b) => a + b, 0) : null,
  };
}

/** Average price across a window: total money moved ÷ deals closed. */
function blendedAvg(stats: PanelStats): number | null {
  if (!stats.deals || !stats.totalValue) return null;
  return Math.round(stats.totalValue / stats.deals);
}

export function parseHomesProfile(html: string, url: string): HomesProfile | null {
  const name = agentName(html);
  const phoneDigits =
    html.match(/"telephone"\s*:\s*"\+1-(\d{3})-(\d{3})-(\d{4})"/) ??
    html.match(/"telephone"\s*:\s*"\((\d{3})\) (\d{3})-(\d{4})"/);
  const phone = phoneDigits ? `${phoneDigits[1]}${phoneDigits[2]}${phoneDigits[3]}` : null;
  const brokerage =
    html.match(/"worksFor"\s*:\s*\{\s*"@type"\s*:\s*"Organization"\s*,\s*"name"\s*:\s*"([^"]+)"/)?.[1] ?? null;
  const licenseId =
    html.match(/"credentialCategory"\s*:\s*"license"\s*,\s*"identifier"\s*:\s*"(\d+)"/)?.[1] ?? null;

  if (!name && !phone) return null; // not a profile page, or a shape we don't recognize

  const oneYear = panelStats(panelHtml(html, "1-year-panel"));
  const fiveYear = panelStats(panelHtml(html, "5-year-panel"));

  // The FAQ sentence carries the same average as the five-year panel
  // ("closed 39 sales totaling $14.5M … an average sale price of $372.2K"),
  // so it's only the fallback for a page whose panels don't parse.
  const faq = html.match(
    /closed\s+([\d,]+)\s+sales?\s+totaling\s+\$?([\d.]+[KM]?)[^.]*average sale price of\s+\$?([\d.]+[KM]?)/i
  );

  return {
    name,
    phone,
    brokerage,
    licenseId,
    url,
    dealsThisYear: oneYear.deals && oneYear.deals > 0 ? oneYear.deals : null,
    avgSalePrice: blendedAvg(fiveYear) ?? (faq ? parseMoney(faq[3]) : null),
    avgSalePriceOneYear: blendedAvg(oneYear),
    dealsFiveYear: fiveYear.deals && fiveYear.deals > 0 ? fiveYear.deals : null,
    activeListings: (html.match(/"availability"\s*:\s*"https:\/\/schema\.org\/InStock"/g) ?? []).length,
  };
}
