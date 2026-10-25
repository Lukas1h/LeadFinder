import { MAIN_SITE_URL } from "@/lib/siteUrls";

export const LUKAS_PHONE = "+15414303372";

/** Lukas's own contact card, as the agent page's "Save contact" hands it out. */
export const LUKAS_VCARD = [
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
  "ADR;TYPE=WORK:;;;Eugene;OR;;USA",
  "NOTE:Real estate photography\\, walkthrough video & drone. Eugene & Roseburg.",
  "END:VCARD",
].join("\r\n");
