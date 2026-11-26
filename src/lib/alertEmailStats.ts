/**
 * Health stats for a Zillow saved-search alert email, for the `alertEmails`
 * table (see its comment in src/db/schema.ts). Zillow's daily digest caps
 * itself at 10 items — new listings, price cuts and open houses pooled
 * together — and hides the rest behind "View all updates", so a search whose
 * digests keep saying "14 items" while showing 10 cards is silently losing
 * new listings and wants splitting.
 *
 * Pure (no DB, no network) so the webhook can log a row for any email it
 * sees, including the ones it deliberately ignores.
 */

export interface AlertEmailStats {
  /** The saved search's name as the email states it; null when it doesn't. */
  searchName: string | null;
  /** New listings in the digest's summary line; null when there is no summary line. */
  newListings: number | null;
  /** Every item the summary line counts (new listings + price cuts + open houses); null when absent. */
  itemsTotal: number | null;
  /** Listing cards actually in the email, before Zillow's recommendation carousel. */
  cardsShown: number;
  /** The email announced more items than it showed — the rest are behind "View all updates". */
  truncated: boolean;
}

// The HTML entity instead of a real space is how Zillow's plain-text part
// separates some summary words ("2 &nbsp;Open&nbsp;houses").
const NBSP_RE = /&nbsp;|&#160;|\u00a0/gi;

const SEARCH_NAME_QUOTED_RE = /your search ['‘’]([^'‘’\n]+)['‘’]/i;
const SEARCH_NAME_POSSESSIVE_RE = /your ['‘’]([^'‘’\n]+)['‘’] search/i;
const TODAYS_UPDATES_RE = /today'?s updates on your saved search/i;

// "3 New listings | 2 Price cuts | 5 Open houses", "1  New listing",
// "N Price cut" — any combination, singular or plural.
const SUMMARY_ITEM_RE = /(\d[\d,]*)\s+(new listings?|price cuts?|open houses?)\b/gi;

const RECOMMENDATIONS_SECTION_RE = /our recommendations for you|based on your recent activity|improve your recommendations/i;
const CARD_MARKER_RE = /view this listing/gi;
const RULE_RE = /^[=\-_*]{6,}$/;
const URL_RE = /^https?:\/\//i;
const ZILLOW_LINE_RE = /zillow/i;

function normalise(body: string): string {
  return body.replace(NBSP_RE, " ");
}

function lines(body: string): string[] {
  return body.split(/\r?\n/).map((line) => line.trim());
}

/**
 * The digest's own summary line. Requiring the line to be nothing but the
 * counts (and their "|" separators) keeps card lines out — a card's "$433,000"
 * or "Open house: Sun. 2pm-4pm" never satisfies it — so the search can run
 * over the whole body without first finding the section's boundaries.
 */
function parseSummaryLine(bodyLines: string[]): { newListings: number; itemsTotal: number } | null {
  for (const line of bodyLines) {
    if (!/^\d/.test(line)) continue;
    const items = [...line.matchAll(SUMMARY_ITEM_RE)];
    if (items.length === 0) continue;
    const leftover = line.replace(SUMMARY_ITEM_RE, "").replace(/\|/g, "").trim();
    if (leftover !== "") continue;

    let newListings = 0;
    let itemsTotal = 0;
    for (const item of items) {
      const count = Number(item[1].replace(/,/g, ""));
      if (!Number.isFinite(count)) continue;
      itemsTotal += count;
      if (item[2].toLowerCase().startsWith("new listing")) newListings += count;
    }
    return { newListings, itemsTotal };
  }
  return null;
}

/**
 * "Today's updates on your saved search" is followed by a blank line and then
 * the search name with a trailing " -" ("Benton County - New -"). Only that
 * trailing marker is stripped, since the name itself contains " - ".
 */
function searchNameFromTodaysUpdates(bodyLines: string[]): string | null {
  const start = bodyLines.findIndex((line) => TODAYS_UPDATES_RE.test(line));
  if (start === -1) return null;
  for (let i = start + 1; i < bodyLines.length; i++) {
    const line = bodyLines[i];
    if (!line) continue;
    const name = line.replace(/\s+-\s*$/, "").trim();
    if (name && !RULE_RE.test(name) && !URL_RE.test(name)) return name;
    return null;
  }
  return null;
}

/** A long line with sentence punctuation is prose (a subject/preheader), not a search name. */
function looksLikeSentence(line: string): boolean {
  const words = line.split(/\s+/).filter(Boolean).length;
  const endsLikeSentence = /[.!?]$/.test(line);
  return line.length > 60 ? endsLikeSentence || words >= 8 : endsLikeSentence && words >= 8;
}

/**
 * The fallback: instant alerts put the search name on the line after the
 * subject ("New: 0 Cody Ln home for you" / "Coos County - Land"). The text
 * part echoes the subject first, so that line is skipped, then rules, Zillow
 * branding, links and prose are passed over.
 */
function searchNameFromFirstLine(subject: string, bodyLines: string[]): string | null {
  const subjectLine = subject.trim().replace(/^fwd:\s*/i, "");
  let i = 0;
  while (i < bodyLines.length && !bodyLines[i]) i++;
  if (i < bodyLines.length && bodyLines[i] === subjectLine) i++;

  for (; i < bodyLines.length; i++) {
    const line = bodyLines[i];
    if (!line) continue;
    if (line === subjectLine) continue;
    if (RULE_RE.test(line)) continue;
    if (URL_RE.test(line)) continue;
    if (ZILLOW_LINE_RE.test(line)) continue;
    if (looksLikeSentence(line)) continue;
    return line;
  }
  return null;
}

/** Listing cards in the email, excluding the recommendation carousel. */
function countCards(body: string): number {
  const cut = body.search(RECOMMENDATIONS_SECTION_RE);
  const cardsSection = cut === -1 ? body : body.slice(0, cut);
  return [...cardsSection.matchAll(CARD_MARKER_RE)].length;
}

export function parseAlertEmailStats(subject: string, text: string): AlertEmailStats {
  const body = normalise(text ?? "");
  const bodyLines = lines(body);

  const searchName =
    (subject ?? "").match(SEARCH_NAME_QUOTED_RE)?.[1]?.trim() ||
    body.match(SEARCH_NAME_QUOTED_RE)?.[1]?.trim() ||
    (subject ?? "").match(SEARCH_NAME_POSSESSIVE_RE)?.[1]?.trim() ||
    body.match(SEARCH_NAME_POSSESSIVE_RE)?.[1]?.trim() ||
    searchNameFromTodaysUpdates(bodyLines) ||
    searchNameFromFirstLine(subject ?? "", bodyLines) ||
    null;

  const summary = parseSummaryLine(bodyLines);
  const itemsTotal = summary ? summary.itemsTotal : null;
  const cardsShown = countCards(body);

  return {
    searchName: searchName && searchName.length > 0 ? searchName : null,
    newListings: summary ? summary.newListings : null,
    itemsTotal,
    cardsShown,
    truncated: itemsTotal != null && itemsTotal > cardsShown,
  };
}

/**
 * Zillow's X-CID header (instantsearchdigest / instantsavedsearch / …) when
 * it's available — the webhook payload's message may omit headers, in which
 * case the shape has to speak: only a digest carries a counted summary line.
 */
export function alertKindFromStats(stats: AlertEmailStats): string {
  return stats.itemsTotal != null ? "instantsearchdigest" : "instantsavedsearch";
}
