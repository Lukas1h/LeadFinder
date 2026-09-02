"use server";

import { db } from "@/db";
import { listings, agents, type LeadStatus } from "@/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

async function touchAgentContact(
  listingId: string,
  agentPhone: string | null,
  agentName: string | null
) {
  if (!agentPhone) return;
  await db
    .insert(agents)
    .values({
      phone: agentPhone,
      name: agentName,
      lastContactedAt: new Date(),
      lastContactedListingId: listingId,
    })
    .onConflictDoUpdate({
      target: agents.phone,
      set: {
        name: agentName,
        lastContactedAt: new Date(),
        lastContactedListingId: listingId,
      },
    });
}

export async function updateListingStatus(listingId: string, status: LeadStatus) {
  const now = new Date();
  const [lead] = await db
    .update(listings)
    .set({
      status,
      statusChangedAt: now,
      ...(status === "contacted" ? { contactedAt: now } : {}),
    })
    .where(eq(listings.id, listingId))
    .returning({ agentPhone: listings.agentPhone, agentName: listings.agentName });

  if (status === "contacted" && lead) {
    await touchAgentContact(listingId, lead.agentPhone, lead.agentName);
  }

  revalidatePath("/");
  revalidatePath("/pipeline");
}

/** Re-texting an already-"contacted" lead: resets the follow-up clock without changing status. */
export async function recordFollowUp(listingId: string) {
  const now = new Date();
  const [lead] = await db
    .update(listings)
    .set({ contactedAt: now, statusChangedAt: now })
    .where(eq(listings.id, listingId))
    .returning({ agentPhone: listings.agentPhone, agentName: listings.agentName });

  if (lead) {
    await touchAgentContact(listingId, lead.agentPhone, lead.agentName);
  }

  revalidatePath("/");
  revalidatePath("/pipeline");
}
