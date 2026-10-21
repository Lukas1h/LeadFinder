"use server";

import { desc, eq, ilike, isNotNull, or, and } from "drizzle-orm";
import { db } from "@/db";
import { listings } from "@/db/schema";

export interface EditorListing {
  id: string;
  address: string | null;
  city: string | null;
  agentName: string | null;
  score: number | null;
  photos: string[];
}

export type EditorSearchResult = Omit<EditorListing, "photos"> & { thumb: string | null };

/** The listings whose street, city or agent matches, newest first, for the editor's search box. */
export async function searchEditorListings(query: string): Promise<EditorSearchResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const rows = await db
    .select({
      id: listings.id,
      address: listings.address,
      city: listings.city,
      agentName: listings.agentName,
      score: listings.score,
      photos: listings.photos,
    })
    .from(listings)
    .where(and(isNotNull(listings.photos), or(ilike(listings.address, `%${q}%`), ilike(listings.city, `%${q}%`), ilike(listings.agentName, `%${q}%`))))
    .orderBy(desc(listings.foundAt))
    .limit(8);
  return rows.map(({ photos, ...r }) => ({ ...r, thumb: photos?.[0] ?? null }));
}

export async function getEditorListing(id: string): Promise<EditorListing | null> {
  const [row] = await db
    .select({
      id: listings.id,
      address: listings.address,
      city: listings.city,
      agentName: listings.agentName,
      score: listings.score,
      photos: listings.photos,
    })
    .from(listings)
    .where(eq(listings.id, id));
  return row ? { ...row, photos: row.photos ?? [] } : null;
}
