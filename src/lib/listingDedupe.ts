// Zillow sometimes carries one house under two zpids (a second MLS record, or
// a relist), and the listings table only deduped on zpid — so the same house
// showed up twice, often once as "passed" and once as a fresh lead, with the
// agent's contact history split between them. This catches the second zpid
// by street address + zip before it becomes a row.

import { and, arrayOverlaps, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { listings, type NewListing } from "@/db/schema";

const DIRECTIONS = new Set(["n", "s", "e", "w", "ne", "nw", "se", "sw", "north", "south", "east", "west"]);

/**
 * "6955 Fir Grove Ln N" and "6955 Fir Grove Ln" (97303) are one house; so are
 * "360 Cindy Ln NW" and "360 Cindy Ln". Lowercased, punctuation dropped, and a
 * trailing direction removed — Zillow adds or drops that suffix between
 * records. City is deliberately not part of the key (the same Fir Grove house
 * came in as both Keizer and Salem); zip is.
 */
export function listingAddressKey(address: string | null | undefined, zipcode: string | null | undefined): string | null {
  if (!address || !zipcode) return null;
  const words = address.toLowerCase().replace(/[^a-z0-9# ]/g, " ").split(/\s+/).filter(Boolean);
  while (words.length > 2 && DIRECTIONS.has(words[words.length - 1])) words.pop();
  return `${words.join(" ")}|${zipcode.trim().slice(0, 5)}`;
}

/** A second zpid more than this long after we first saw the house is a real relist. */
const RELIST_AFTER_DAYS = 14;

/**
 * Drops candidates that are already in the table under another zpid —
 * matched by an earlier merge (altZpids) or by address — and records the new
 * zpid on the existing row so it's recognized directly next time. A genuine
 * relist of a house we passed on puts the existing row back in the leads
 * queue, the same way a price cut does, instead of creating a twin.
 */
export async function dropDuplicateListings(candidates: NewListing[]): Promise<NewListing[]> {
  if (candidates.length === 0) return candidates;
  const zips = [...new Set(candidates.map((c) => c.zipcode).filter((z): z is string => !!z))];
  const zpids = candidates.map((c) => c.zpid);

  const existing = await db
    .select({
      id: listings.id,
      zpid: listings.zpid,
      altZpids: listings.altZpids,
      address: listings.address,
      zipcode: listings.zipcode,
      status: listings.status,
      foundAt: listings.foundAt,
    })
    .from(listings)
    .where(
      or(
        zips.length > 0 ? inArray(listings.zipcode, zips) : sql`false`,
        arrayOverlaps(listings.altZpids, zpids)
      )
    );

  const byKey = new Map<string, (typeof existing)[number]>();
  const byZpid = new Map<string, (typeof existing)[number]>();
  for (const row of existing) {
    byZpid.set(row.zpid, row);
    for (const alt of row.altZpids ?? []) byZpid.set(alt, row);
    const key = listingAddressKey(row.address, row.zipcode);
    if (key && !byKey.has(key)) byKey.set(key, row);
  }

  const kept: NewListing[] = [];
  const seenKeys = new Set<string>();
  for (const candidate of candidates) {
    // Same zpid as an existing row is left to the insert's own conflict handling.
    if (byZpid.get(candidate.zpid)?.zpid === candidate.zpid) {
      kept.push(candidate);
      continue;
    }
    const key = listingAddressKey(candidate.address, candidate.zipcode);
    const match = byZpid.get(candidate.zpid) ?? (key ? byKey.get(key) : undefined);
    if (!match) {
      if (key && seenKeys.has(key)) continue; // twin within this same batch
      if (key) seenKeys.add(key);
      kept.push(candidate);
      continue;
    }

    const relisted =
      match.status === "passed" &&
      candidate.listedAt != null &&
      new Date(candidate.listedAt).getTime() - match.foundAt.getTime() > RELIST_AFTER_DAYS * 24 * 60 * 60 * 1000;
    await db
      .update(listings)
      .set({
        altZpids: sql`array_append(coalesce(${listings.altZpids}, '{}'), ${candidate.zpid})`,
        ...(relisted ? { status: "new" as const, resurfacedAt: new Date(), statusChangedAt: new Date() } : {}),
      })
      .where(and(eq(listings.id, match.id), sql`not (coalesce(${listings.altZpids}, '{}') @> array[${candidate.zpid}]::text[])`));
  }
  return kept;
}
