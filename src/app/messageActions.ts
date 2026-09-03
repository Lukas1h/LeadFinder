"use server";

import { db } from "@/db";
import {
  listings,
  messagePresets,
  messagePresetVariants,
  messageSends,
  type PresetType,
} from "@/db/schema";
import { and, count, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { renderMessageBody, DEFAULT_INITIAL_BODY, DEFAULT_FOLLOWUP_BODY } from "@/lib/messageTemplate";
import { touchAgentContact } from "@/app/actions";

/**
 * Idempotent — inserts the two starter presets ("Initial Outreach",
 * "Follow-up", each with one variant carrying the app's original hardcoded
 * copy) the first time this is called with an empty message_presets table.
 * Called from getMessageOptions and the /presets page so the send flow
 * always has at least one usable preset per type.
 */
export async function ensureDefaultPresets() {
  const [existing] = await db.select({ id: messagePresets.id }).from(messagePresets).limit(1);
  if (existing) return;

  const [initial] = await db
    .insert(messagePresets)
    .values({ name: "Initial Outreach", type: "initial_outreach" })
    .returning({ id: messagePresets.id });
  await db.insert(messagePresetVariants).values({
    presetId: initial.id,
    label: "A",
    body: DEFAULT_INITIAL_BODY,
  });

  const [followUp] = await db
    .insert(messagePresets)
    .values({ name: "Follow-up", type: "follow_up" })
    .returning({ id: messagePresets.id });
  await db.insert(messagePresetVariants).values({
    presetId: followUp.id,
    label: "A",
    body: DEFAULT_FOLLOWUP_BODY,
  });
}

export interface MessageOption {
  presetId: string;
  presetName: string;
  variantId: string;
  label: string;
  text: string;
}

export interface MessageOptions {
  options: MessageOption[];
  pickedVariantId: string | null;
}

/**
 * Loads every enabled variant of every enabled preset for `type`, rendered
 * against the listing's agent/address, plus which one the auto-rotation
 * picked (fewest sends so far, random tiebreak) — the least-used variant
 * gets picked next so send volume stays balanced across variants.
 */
export async function getMessageOptions(listingId: string, type: PresetType): Promise<MessageOptions> {
  await ensureDefaultPresets();

  const [listing] = await db
    .select({ agentName: listings.agentName, address: listings.address })
    .from(listings)
    .where(eq(listings.id, listingId));
  if (!listing) return { options: [], pickedVariantId: null };

  const rows = await db
    .select({
      presetId: messagePresets.id,
      presetName: messagePresets.name,
      variantId: messagePresetVariants.id,
      label: messagePresetVariants.label,
      body: messagePresetVariants.body,
    })
    .from(messagePresetVariants)
    .innerJoin(messagePresets, eq(messagePresetVariants.presetId, messagePresets.id))
    .where(
      and(
        eq(messagePresets.type, type),
        eq(messagePresets.enabled, true),
        eq(messagePresetVariants.enabled, true)
      )
    );

  if (rows.length === 0) return { options: [], pickedVariantId: null };

  const sendCounts = await db
    .select({ variantId: messageSends.variantId, count: count() })
    .from(messageSends)
    .groupBy(messageSends.variantId);
  const countByVariant = new Map(sendCounts.map((r) => [r.variantId, r.count]));

  const options: MessageOption[] = rows.map((r) => ({
    presetId: r.presetId,
    presetName: r.presetName,
    variantId: r.variantId,
    label: r.label,
    text: renderMessageBody(r.body, listing.agentName, listing.address),
  }));

  const minCount = Math.min(...rows.map((r) => countByVariant.get(r.variantId) ?? 0));
  const leastUsed = rows.filter((r) => (countByVariant.get(r.variantId) ?? 0) === minCount);
  const pickedVariantId = leastUsed[Math.floor(Math.random() * leastUsed.length)].variantId;

  return { options, pickedVariantId };
}

/**
 * Logs a send against the chosen preset variant, then applies the same
 * listing mutation the old hardcoded flow did: initial outreach moves the
 * lead to "contacted"; a follow-up just resets the follow-up clock.
 */
export async function sendMessage(
  listingId: string,
  type: PresetType,
  presetId: string,
  variantId: string
) {
  const now = new Date();

  await db.insert(messageSends).values({ listingId, presetId, variantId, type, sentAt: now });

  const [lead] = await db
    .update(listings)
    .set({
      contactedAt: now,
      statusChangedAt: now,
      ...(type === "initial_outreach" ? { status: "contacted" as const } : {}),
    })
    .where(eq(listings.id, listingId))
    .returning({ agentPhone: listings.agentPhone, agentName: listings.agentName });

  if (lead) {
    await touchAgentContact(listingId, lead.agentPhone, lead.agentName);
  }

  revalidatePath("/");
  revalidatePath("/pipeline");
  revalidatePath("/presets");
}
