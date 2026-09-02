"use server";

import { db } from "@/db";
import { listings, agents, type LeadStatus } from "@/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { runSync, type SyncResult } from "@/lib/sync";

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

/**
 * Manual "Refresh" button on the Leads page — same Zillapi/OpenAI cost as
 * a cron run (1 credit per listing *returned*, even ones we already have
 * and skip inserting), just triggered on demand instead of waiting for
 * tomorrow's scheduled sync. The client shows its own confirmation before
 * calling this.
 */
export async function triggerManualSync(): Promise<SyncResult> {
  const result = await runSync();
  revalidatePath("/");
  revalidatePath("/pipeline");
  return result;
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
