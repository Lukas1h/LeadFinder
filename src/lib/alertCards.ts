/**
 * The listing cards in a Zillow alert email's plain-text part. Every card
 * already says what the unlikely rules need (price and brokerage) and what
 * Compass needs to find the listing (street and city), so a listing can be
 * judged and looked up without paying Zillapi for it first.
 *
 * Each card is a block between dashed rules, the same in every alert format
 * seen so far (single "just listed", "<N> Results for" digests, price cuts,
 * open-house roundups, and the recommendation carousel):
 *
 *   $433,000                                  (or "$574,900 | Price cut: …")
 *   3 bd | 1 ba | 1,056 sqft
 *   3452 SE 35th Ct, Lincoln City, OR
 *   Taylor & Taylor Realty Company
 *   View this listing - https://click.mail.zillow.com/…3452…_zpid…
 */

export interface AlertCard {
  zpid: string;
  price: number | null;
  /** Street line only: "3452 SE 35th Ct". */
  address: string | null;
  city: string | null;
  state: string | null;
  bedrooms: string | null;
  bathrooms: string | null;
  livingArea: number | null;
  brokerName: string | null;
}

const RULE_RE = /^\s*(?:-{6,}|={6,})\s*$/m;
const ZPID_RE = /(\d+)_zpid/;
const PRICE_RE = /^\s*\$([\d,]+)(?!\s*[KM]\b)/m;
const FACTS_RE = /^\s*([\d.]+)\s*bds?\s*\|\s*([\d.]+)\s*ba\s*\|\s*([\d,]+)\s*sqft/im;
// "3452 SE 35th Ct, Lincoln City, OR" (the zip is sometimes there too).
const ADDRESS_RE = /^\s*(.+?),\s*([A-Za-z .'-]+?),\s*([A-Z]{2})(?:\s+\d{5})?\s*$/m;
const NOT_A_BROKER_RE = /^(view|explore|see|https?:|for sale|active|new|price cut|\$)/i;
// "Open house:" and its "Sun. 2pm-4pm" or "10/24 12pm-2pm" line can sit between the address and the brokerage.
const OPEN_HOUSE_RE = /^(open house|(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?\s+\d|\d{1,2}\/\d{1,2}\s+\d)/i;

/** Every card with a zpid, keyed by zpid (the first card wins if one repeats). */
export function parseAlertCards(text: string): Map<string, AlertCard> {
  const cards = new Map<string, AlertCard>();
  for (const block of text.split(RULE_RE)) {
    const zpid = block.match(ZPID_RE)?.[1];
    if (!zpid || cards.has(zpid)) continue;

    const address = block.match(ADDRESS_RE);
    const facts = block.match(FACTS_RE);
    const price = block.match(PRICE_RE);

    // The brokerage is the first plain line after the address.
    let brokerName: string | null = null;
    if (address) {
      const after = block.slice(block.indexOf(address[0]) + address[0].length).split("\n");
      const line = after.map((l) => l.trim()).find((l) => l.length > 0 && !OPEN_HOUSE_RE.test(l));
      if (line && !NOT_A_BROKER_RE.test(line) && line.length < 120) brokerName = line;
    }

    cards.set(zpid, {
      zpid,
      price: price ? Number(price[1].replace(/,/g, "")) : null,
      address: address ? address[1].trim() : null,
      city: address ? address[2].trim() : null,
      state: address ? address[3] : null,
      bedrooms: facts ? facts[1] : null,
      bathrooms: facts ? facts[2] : null,
      livingArea: facts ? Number(facts[3].replace(/,/g, "")) : null,
      brokerName,
    });
  }
  return cards;
}
