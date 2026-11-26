import type { MarketDef } from "@/lib/markets";
import { MAIN_SITE_URL } from "@/lib/siteUrls";

export const LUKAS_PHONE = "+15414303372";

/**
 * Lukas's own contact card, as the agent page's "Save contact" hands it out.
 * `market` picks the market line and address: a shooter-market agent gets a
 * card that says so (the market row's `vcard`, lib/markets.ts), everyone else
 * (null) gets the Eugene & Roseburg one. A market with no vcard yet falls back
 * to that same card rather than half a note.
 */
export function lukasVcard(market: MarketDef | null): string {
  const card = market?.vcard ?? null;
  return [
    "BEGIN:VCARD",
    "VERSION:3.0",
    // "Photographer" is part of the name itself, so it shows on the card and
    // searching contacts for "photographer" finds him.
    "N:Hahn Photographer;Lukas;;;",
    "FN:Lukas Hahn Photographer",
    "ORG:Hahn Media",
    "TITLE:Real Estate Photo & Video",
    `TEL;TYPE=CELL:${LUKAS_PHONE}`,
    "EMAIL;TYPE=WORK:lukas@lukashahn.media",
    `URL:${MAIN_SITE_URL}`,
    card ? `ADR;TYPE=WORK:;;;${card.city};${market?.state ?? "OR"};;USA` : "ADR;TYPE=WORK:;;;Eugene;OR;;USA",
    card
      ? `NOTE:Real estate photography\\, walkthrough video & drone. ${card.note}`
      : "NOTE:Real estate photography\\, walkthrough video & drone. Eugene & Roseburg.",
    "END:VCARD",
  ].join("\r\n");
}
