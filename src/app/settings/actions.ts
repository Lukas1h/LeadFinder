"use server";

import { db } from "@/db";
import { searchSources } from "@/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

export interface SourceInput {
  name: string;
  bbox: string;
  priceMin: number | null;
  priceMax: number | null;
  homeTypes: string | null;
}

function validateBbox(bbox: string): string | null {
  const parts = bbox.split(",").map((p) => p.trim());
  if (parts.length !== 4 || parts.some((p) => p === "" || Number.isNaN(Number(p)))) {
    return "Bbox must be four comma-separated numbers: west,south,east,north";
  }
  return null;
}

export async function createSource(input: SourceInput) {
  const error = validateBbox(input.bbox);
  if (error) return { error };

  await db.insert(searchSources).values({
    name: input.name,
    bbox: input.bbox,
    priceMin: input.priceMin,
    priceMax: input.priceMax,
    homeTypes: input.homeTypes,
  });

  revalidatePath("/settings");
  return { error: null };
}

export async function updateSource(id: string, input: SourceInput) {
  const error = validateBbox(input.bbox);
  if (error) return { error };

  await db
    .update(searchSources)
    .set({
      name: input.name,
      bbox: input.bbox,
      priceMin: input.priceMin,
      priceMax: input.priceMax,
      homeTypes: input.homeTypes,
    })
    .where(eq(searchSources.id, id));

  revalidatePath("/settings");
  return { error: null };
}

export async function deleteSource(id: string) {
  await db.delete(searchSources).where(eq(searchSources.id, id));
  revalidatePath("/settings");
}

export async function toggleSource(id: string, enabled: boolean) {
  await db.update(searchSources).set({ enabled }).where(eq(searchSources.id, id));
  revalidatePath("/settings");
}
