"use server";

import { db } from "@/db";
import { listings, agents, type LeadStatus } from "@/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

export async function updateListingStatus(listingId: string, status: LeadStatus) {
  const [lead] = await db
    .update(listings)
    .set({
      status,
      ...(status === "contacted" ? { contactedAt: new Date() } : {}),
    })
    .where(eq(listings.id, listingId))
    .returning({ agentPhone: listings.agentPhone, agentName: listings.agentName });

  if (status === "contacted" && lead?.agentPhone) {
    await db
      .insert(agents)
      .values({
        phone: lead.agentPhone,
        name: lead.agentName,
        lastContactedAt: new Date(),
        lastContactedListingId: listingId,
      })
      .onConflictDoUpdate({
        target: agents.phone,
        set: {
          name: lead.agentName,
          lastContactedAt: new Date(),
          lastContactedListingId: listingId,
        },
      });
  }

  revalidatePath("/");
}
