/**
 * Prices on an agent page (/portfolio/[slug]). An area template can override
 * any of them in its content.prices (dollars); a missing key = the default here.
 */
export interface PortfolioPrices {
  photo: number;
  drone: number;
  floorPlans: number;
  staging: number;
  twilight: number;
  video: number;
  bundle: number;
  /** Pricing sheet only (lib/pricingSheet.ts): the social media edit add-on and "The Full Package". */
  socialEdit: number;
  fullPackage: number;
}

export const DEFAULT_PORTFOLIO_PRICES: PortfolioPrices = {
  photo: 300,
  drone: 100,
  floorPlans: 50,
  staging: 50,
  twilight: 50,
  video: 400,
  bundle: 650,
  socialEdit: 100,
  fullPackage: 700,
};

/** Editor labels, in display order (the agent page's price list; the sheet-only keys aren't on it). */
export const PORTFOLIO_PRICE_ITEMS: { key: keyof PortfolioPrices; label: string; addOn?: boolean }[] = [
  { key: "photo", label: "Photos" },
  { key: "drone", label: "Drone", addOn: true },
  { key: "floorPlans", label: "Floor plans", addOn: true },
  { key: "staging", label: "Staging", addOn: true },
  { key: "twilight", label: "Twilight", addOn: true },
  { key: "video", label: "Video" },
  { key: "bundle", label: "Photo+Video+Drone" },
];

/** Keeps only valid, non-negative whole-dollar overrides. */
export function cleanPortfolioPrices(p: Partial<PortfolioPrices> | null | undefined): Partial<PortfolioPrices> {
  const out: Partial<PortfolioPrices> = {};
  for (const key of Object.keys(DEFAULT_PORTFOLIO_PRICES) as (keyof PortfolioPrices)[]) {
    const v = p?.[key];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) out[key] = Math.round(v);
  }
  return out;
}

export function resolvePortfolioPrices(p: Partial<PortfolioPrices> | null | undefined): PortfolioPrices {
  return { ...DEFAULT_PORTFOLIO_PRICES, ...cleanPortfolioPrices(p) };
}

/** "$300", or "+$100" for an add-on. */
export function formatPrice(n: number, addOn = false): string {
  return `${addOn ? "+" : ""}$${n.toLocaleString("en-US")}`;
}
