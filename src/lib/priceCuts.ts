import { db } from "@/db";
import { agents, listings } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { isWeakPhotoListing } from "@/lib/pipeline";
import { notifyPriceCutRelaunch, type PriceCutNotice } from "@/lib/push";

export interface EmailPriceCut {
  zpid: string;
  newPrice: number;
  amount: number | null;
  cutAt: Date;
}

// Every Zillow alert format that reports a cut prints the listing's price line
// as "$525,000 | Price cut: $25.1K (9/28)" (the HTML part has no "|") — seen 2026-09-27 in the
// "Price Cut: <addr>. Your '<search>' Search." alert, the "A $10K price cut
// in <city>" recommendation, and digest listings. The listing's own links
// (with its zpid) follow the price line within the same block.
const PRICE_CUT_LINE_RE = /\$([\d,]+)\s*\|?\s*Price cut:\s*\$([\d.,]+)\s*([KM])?\s*\((\d{1,2})\/(\d{1,2})\)/gi;
const ZPID_AFTER_RE = /(\d+)_zpid/;
// Single-listing alerts also state the exact amount ("Listing price reduced
// by $25,100" / "The price of this home has been reduced by $10,000.") where
// the price line rounds it to "$25.1K".
const EXACT_AMOUNT_RE = /reduced by \$([\d,]+)/i;
// Same marker as the webhook's RECOMMENDATIONS_SECTION_RE: everything after it
// is Zillow's carousel of other listings, whose cuts aren't this alert's news.
const RECOMMENDATIONS_SECTION_RE = /our recommendations for you|based on your recent activity|improve your recommendations/i;

function beforeRecommendations(s: string): string {
  const cut = s.search(RECOMMENDATIONS_SECTION_RE);
  return cut === -1 ? s : s.slice(0, cut);
}

function parseShortMoney(num: string, unit: string | undefined): number {
  const n = Number(num.replace(/,/g, ""));
  if (unit?.toUpperCase() === "M") return Math.round(n * 1_000_000);
  if (unit?.toUpperCase() === "K") return Math.round(n * 1_000);
  return Math.round(n);
}

// The email only gives month/day. Assume this year, unless that lands more
// than a couple of days in the future (a December cut read in January).
function cutDate(month: number, day: number, now = new Date()): Date {
  let d = new Date(Date.UTC(now.getUTCFullYear(), month - 1, day, 12));
  if (d.getTime() - now.getTime() > 2 * 24 * 60 * 60 * 1000) {
    d = new Date(Date.UTC(now.getUTCFullYear() - 1, month - 1, day, 12));
  }
  return d;
}

function parseFrom(text: string): EmailPriceCut[] {
  const matches = [...text.matchAll(PRICE_CUT_LINE_RE)];
  const cuts: EmailPriceCut[] = [];
  matches.forEach((m, i) => {
    const start = m.index! + m[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index! : text.length;
    const zpid = text.slice(start, end).match(ZPID_AFTER_RE)?.[1];
    if (!zpid || cuts.some((c) => c.zpid === zpid)) return;
    cuts.push({
      zpid,
      newPrice: Number(m[1].replace(/,/g, "")),
      amount: parseShortMoney(m[2], m[3]),
      cutAt: cutDate(Number(m[4]), Number(m[5])),
    });
  });

  const exact = text.match(EXACT_AMOUNT_RE);
  if (exact && cuts.length === 1) cuts[0].amount = Number(exact[1].replace(/,/g, ""));
  return cuts;
}

/**
 * Price cuts announced in a Zillow alert email, keyed to the listing's zpid.
 * Reads the plain-text part first (its blocks are clean); falls back to the
 * HTML with tags stripped but zpid-bearing links kept in place. The HTML
 * fallback only trusts a single cut: checked against all 170 inbox emails
 * (2026-09-27), it matched the text part on every single-listing price-cut
 * alert but paired prices with the wrong zpids in multi-listing digests.
 */
export function parseEmailPriceCuts(text: string, html: string): EmailPriceCut[] {
  const fromText = parseFrom(beforeRecommendations(text));
  if (fromText.length > 0) return fromText;
  const flattened = beforeRecommendations(html)
    .replace(/<[^>]*?(\d+_zpid)[^>]*>/g, " $1 ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ");
  const fromHtml = parseFrom(flattened);
  return fromHtml.length === 1 ? fromHtml : [];
}

// Digest emails re-show a listing's latest cut even when it's weeks old
// (one September digest carried a June cut). Those are recorded, but only a
// cut this recent is news worth resurfacing a listing and sending a push for.
const RESURFACE_MAX_CUT_AGE_DAYS = 3;

function sameDay(a: Date, b: Date): boolean {
  return a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);
}

/**
 * Records price cuts on listings already in the DB — the case the webhook
 * used to drop entirely, since it only fetched/inserted unknown zpids. No
 * Zillapi call: the email carries the new price, amount and date.
 *
 * A cut on a weak-photo listing (see isWeakPhotoListing) that's still "new"
 * or was "passed" on is put back at the top of the leads queue
 * (resurfacedAt) with a push notification — the relaunch-with-new-photos
 * pitch. Listings further along (contacted, quoted, booked, declined) just
 * get the cut recorded; so does anything whose agent is marked declined.
 */
export async function applyPriceCutsToExisting(cuts: EmailPriceCut[]): Promise<number> {
  if (cuts.length === 0) return 0;

  const rows = await db
    .select({
      id: listings.id,
      zpid: listings.zpid,
      status: listings.status,
      score: listings.score,
      photoCount: listings.photoCount,
      priceCutAt: listings.priceCutAt,
      priceCutCount: listings.priceCutCount,
      agentId: listings.agentId,
      address: listings.address,
      city: listings.city,
    })
    .from(listings)
    .where(inArray(listings.zpid, cuts.map((c) => c.zpid)));
  if (rows.length === 0) return 0;

  const agentIds = rows.map((r) => r.agentId).filter((id): id is string => id != null);
  const declinedAgents =
    agentIds.length > 0
      ? await db
          .select({ id: agents.id })
          .from(agents)
          .where(and(inArray(agents.id, agentIds), eq(agents.relationshipStatus, "declined")))
      : [];
  const declined = new Set(declinedAgents.map((a) => a.id));
  const cutByZpid = new Map(cuts.map((c) => [c.zpid, c]));

  const now = new Date();
  const notices: PriceCutNotice[] = [];
  let applied = 0;

  for (const row of rows) {
    const cut = cutByZpid.get(row.zpid)!;
    // The same cut can arrive twice (a search alert plus a recommendation
    // email), and a digest can re-show an older cut than the one on file —
    // only a newer cut counts.
    if (row.priceCutAt && (sameDay(row.priceCutAt, cut.cutAt) || cut.cutAt < row.priceCutAt)) continue;

    const recent = now.getTime() - cut.cutAt.getTime() <= RESURFACE_MAX_CUT_AGE_DAYS * 24 * 60 * 60 * 1000;
    const resurface =
      recent &&
      isWeakPhotoListing(row) &&
      (row.status === "new" || row.status === "passed") &&
      !(row.agentId && declined.has(row.agentId));

    await db
      .update(listings)
      .set({
        price: cut.newPrice,
        priceCutAt: cut.cutAt,
        priceCutAmount: cut.amount,
        priceCutCount: (row.priceCutCount ?? 0) + 1,
        ...(resurface ? { status: "new" as const, resurfacedAt: now } : {}),
        ...(resurface && row.status !== "new" ? { statusChangedAt: now } : {}),
      })
      .where(eq(listings.id, row.id));
    applied++;

    if (resurface) {
      notices.push({ address: row.address ?? "", city: row.city ?? "", amount: cut.amount });
    }
  }

  await notifyPriceCutRelaunch(notices);
  if (applied > 0) revalidatePath("/", "layout");
  return applied;
}
