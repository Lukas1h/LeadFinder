import { MAIN_SITE_URL } from "@/lib/siteUrls";

export const LUKAS_PHONE = "+15414303372";

/**
 * Lukas's own contact card, as the agent page's "Save contact" hands it out.
 * `portland` picks the market line and address: a Portland-area agent gets a
 * card that says so, everyone else gets the Eugene & Roseburg one.
 */
export function lukasVcard(portland: boolean): string {
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
    portland ? "ADR;TYPE=WORK:;;;Portland;OR;;USA" : "ADR;TYPE=WORK:;;;Eugene;OR;;USA",
    portland
      ? "NOTE:Real estate photography\\, walkthrough video & drone. Portland area."
      : "NOTE:Real estate photography\\, walkthrough video & drone. Eugene & Roseburg.",
    "END:VCARD",
  ].join("\r\n");
}
