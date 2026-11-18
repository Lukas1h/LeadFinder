"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { verticalLinks } from "@/db/schema";
import { getVertical } from "@/lib/verticals";
import { uniqueVerticalSlug, verticalUrl } from "@/lib/verticalLink";

// Other verticals' pages (roofing companies…): made, edited and deleted from
// /verticals/<vertical>. Nothing here touches the agent tables.

export type VerticalLinkInput = { company: string; contactName?: string; phone?: string; area?: string; notes?: string };

const opt = (v: string | undefined) => v?.trim() || null;

function clean(input: VerticalLinkInput) {
  const company = input.company?.trim();
  if (!company) throw new Error("Company name is required");
  return {
    company: company.slice(0, 200),
    contactName: opt(input.contactName)?.slice(0, 100) ?? null,
    phone: opt(input.phone)?.slice(0, 40) ?? null,
    area: opt(input.area)?.slice(0, 100) ?? null,
    notes: opt(input.notes)?.slice(0, 2000) ?? null,
  };
}

function revalidate(vertical: string) {
  revalidatePath("/verticals");
  revalidatePath(`/verticals/${vertical}`);
}

export async function createVerticalLinkAction(vertical: string, input: VerticalLinkInput): Promise<{ id: string; slug: string; url: string }> {
  const v = getVertical(vertical);
  if (!v) throw new Error(`Unknown vertical: ${vertical}`);
  const slug = await uniqueVerticalSlug();
  const [row] = await db
    .insert(verticalLinks)
    .values({ vertical: v.key, slug, ...clean(input) })
    .returning({ id: verticalLinks.id });
  revalidate(v.key);
  return { id: row.id, slug, url: verticalUrl(v, slug) };
}

export async function updateVerticalLinkAction(id: string, input: VerticalLinkInput): Promise<void> {
  const [row] = await db.update(verticalLinks).set(clean(input)).where(eq(verticalLinks.id, id)).returning({ vertical: verticalLinks.vertical });
  if (row) revalidate(row.vertical);
}

export async function deleteVerticalLinkAction(id: string): Promise<void> {
  const [row] = await db.delete(verticalLinks).where(eq(verticalLinks.id, id)).returning({ vertical: verticalLinks.vertical });
  if (row) revalidate(row.vertical);
}
