"use server";

import { db } from "@/db";
import { listings, agents, messageSends, type LeadStatus } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { runSync, type SyncResult } from "@/lib/sync";

export async function touchAgentContact(
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

/**
 * Attributes a "replied"/"declined" status change back to whichever message
 * preset variant was most recently sent to this listing and still pending
 * an outcome — the data point the presets page's A/B stats are built from.
 * A no-op if nothing was ever logged (e.g. a listing marked declined
 * without ever being texted).
 */
async function resolveLatestSend(listingId: string, outcome: "responded" | "declined") {
  const [pending] = await db
    .select({ id: messageSends.id })
    .from(messageSends)
    .where(and(eq(messageSends.listingId, listingId), eq(messageSends.outcome, "pending")))
    .orderBy(desc(messageSends.sentAt))
    .limit(1);

  if (!pending) return;

  await db
    .update(messageSends)
    .set({ outcome, outcomeAt: new Date() })
    .where(eq(messageSends.id, pending.id));
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

  if (status === "replied") {
    await resolveLatestSend(listingId, "responded");
  } else if (status === "declined") {
    await resolveLatestSend(listingId, "declined");
  }

  revalidatePath("/");
  revalidatePath("/pipeline");
  revalidatePath("/presets");
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
