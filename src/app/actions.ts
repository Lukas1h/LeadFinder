"use server";

import { db } from "@/db";
import { listings, agents, messageSends, type LeadStatus } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
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
 * Attributes a pipeline status change back to whichever message preset
 * variant was most recently sent to this listing — the data point the
 * presets page's stats are built from. respondedAt is only ever set once
 * (the first reply); result is always overwritable, so a later "declined"
 * after an earlier "replied" correctly updates the same row instead of
 * being silently dropped. A no-op if nothing was ever logged (e.g. a
 * listing marked declined without ever being texted).
 */
async function resolveSendOutcome(listingId: string, status: LeadStatus) {
  if (status !== "replied" && status !== "quoted" && status !== "booked" && status !== "declined") return;

  const [latest] = await db
    .select({ id: messageSends.id, respondedAt: messageSends.respondedAt })
    .from(messageSends)
    .where(eq(messageSends.listingId, listingId))
    .orderBy(desc(messageSends.sentAt))
    .limit(1);

  if (!latest) return;

  const patch: { respondedAt?: Date; result?: "quoted" | "booked" | "declined" } = {};
  if (status === "replied") {
    if (!latest.respondedAt) patch.respondedAt = new Date();
  } else {
    patch.result = status;
  }

  if (Object.keys(patch).length > 0) {
    await db.update(messageSends).set(patch).where(eq(messageSends.id, latest.id));
  }
}

export async function updateListingStatus(
  listingId: string,
  status: LeadStatus,
  bookingValue?: number | null
) {
  const now = new Date();
  const [lead] = await db
    .update(listings)
    .set({
      status,
      statusChangedAt: now,
      ...(status === "contacted" ? { contactedAt: now } : {}),
      ...(status === "booked" && bookingValue != null ? { bookingValue } : {}),
    })
    .where(eq(listings.id, listingId))
    .returning({ agentPhone: listings.agentPhone, agentName: listings.agentName });

  if (status === "contacted" && lead) {
    await touchAgentContact(listingId, lead.agentPhone, lead.agentName);
  }

  await resolveSendOutcome(listingId, status);

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
