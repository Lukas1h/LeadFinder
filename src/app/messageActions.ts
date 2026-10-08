"use server";

import { clientOffices, officeClientFor } from "@/lib/clientOffices";
import { db } from "@/db";
import {
  listings,
  agents,
  messagePresets,
  messagePresetVariants,
  messageSends,
  bookingLineItems,
  type PresetType,
  type LeadStatus,
  type Listing,
  type PresetAttachment,
  type Agent,
} from "@/db/schema";
import { and, count, eq, sum } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import {
  renderMessageBody,
  DEFAULT_INITIAL_BODY,
  DEFAULT_FOLLOWUP_BODY,
  BLANK_SMS_BODY,
  AI_DRAFT_VARIANT_SENTINEL,
} from "@/lib/messageTemplate";
import { draftMessage } from "@/lib/draftMessage";
import { isKnownAgent, listingAgeDays, listingMatchFacts, pickRecommendedPreset, type PresetCriteria } from "@/lib/presetCriteria";
import { startPendingInteraction } from "@/app/agents/interactionActions";
import { touchAgentContact } from "@/app/actions";

const AI_DRAFT_PRESET_NAME = "AI Draft";
const BLANK_SMS_PRESET_NAME = "Blank";

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

/**
 * Idempotent — inserts a "Blank" SMS preset for `type` (protected: true, so
 * the delete button in Messaging refuses to touch it — same reasoning as
 * ensureBlankEmailPreset in composeEmailActions.ts) the first time it's
 * needed, for texting something custom instead of picking a template. This
 * is the option getMessageOptions defaults the Send message dialog to.
 */
export async function ensureBlankSmsPreset(type: PresetType) {
  const [existing] = await db
    .select({ id: messagePresets.id })
    .from(messagePresets)
    .where(and(eq(messagePresets.type, type), eq(messagePresets.channel, "sms"), eq(messagePresets.protected, true)))
    .limit(1);
  if (existing) return;

  const [preset] = await db
    .insert(messagePresets)
    .values({ name: BLANK_SMS_PRESET_NAME, type, protected: true })
    .returning({ id: messagePresets.id });
  await db.insert(messagePresetVariants).values({
    presetId: preset.id,
    label: "A",
    body: BLANK_SMS_BODY,
  });
}

/**
 * Idempotent — inserts the "AI Draft" system preset for each type the
 * first time it's needed. Unlike ensureDefaultPresets, these start with
 * zero variants: a variant only gets created (see sendMessage) at the
 * moment an AI draft is actually sent, since each one is a one-off drafted
 * for that specific listing rather than reusable template text.
 */
export async function ensureAiDraftPresets(type: PresetType) {
  const [existing] = await db
    .select({ id: messagePresets.id })
    .from(messagePresets)
    .where(and(eq(messagePresets.type, type), eq(messagePresets.channel, "sms"), eq(messagePresets.aiGenerated, true)));
  if (existing) return;

  await db.insert(messagePresets).values({ name: AI_DRAFT_PRESET_NAME, type, channel: "sms", aiGenerated: true });
}

export interface PresetOption {
  presetId: string;
  presetName: string;
  variantId: string;
  variantLabel: string;
  text: string;
  /** Only set for email options — see getComposeEmailOptions in composeEmailActions.ts. */
  subject?: string;
  attachments?: PresetAttachment[];
  /** Only set for email options, which span both types in one list — see getComposeEmailOptions. */
  type?: PresetType;
  recommended: boolean;
  /** The "Blank"/"type your own" preset — see ensureBlankSmsPreset. Send dialogs default to this over `recommended`. */
  blank?: boolean;
  /** Texts only: copied to the clipboard on Send, to paste as a second text (see messagePresets.secondMessage). */
  secondMessage?: string | null;
}

export interface MessageOptions {
  presets: PresetOption[];
}

/**
 * Loads every enabled preset for `type`, each paired with whichever of its
 * enabled variants is next in rotation (fewest sends so far, tie broken by
 * label so the rotation is a deterministic A/B/A/B… sequence rather than a
 * random pick) — the sender only chooses a preset, never a variant, so
 * split-test stats stay honest. Exactly one preset (the most specific one
 * whose photo-score/price/listing-age criteria the listing satisfies) is
 * flagged `recommended` for the dialog to default to.
 */
export async function getMessageOptions(listingId: string, type: PresetType): Promise<MessageOptions> {
  await ensureDefaultPresets();
  await ensureBlankSmsPreset(type);
  await ensureAiDraftPresets(type);

  // Full row (not a curated field list) — buildAiDraftOption below feeds
  // the AI draft literally everything we have on the listing.
  const [listing] = await db.select().from(listings).where(eq(listings.id, listingId));
  if (!listing) return { presets: [] };


  // aiGenerated presets are excluded here — they have no reusable variants
  // to rotate through (see ensureAiDraftPresets); the AI option is drafted
  // fresh below instead.
  const rows = await db
    .select({
      presetId: messagePresets.id,
      presetName: messagePresets.name,
      protected: messagePresets.protected,
      leadSection: messagePresets.leadSection,
      minScore: messagePresets.minScore,
      maxScore: messagePresets.maxScore,
      minPrice: messagePresets.minPrice,
      maxPrice: messagePresets.maxPrice,
      maxListingAgeDays: messagePresets.maxListingAgeDays,
      minPhotoCount: messagePresets.minPhotoCount,
      maxPhotoCount: messagePresets.maxPhotoCount,
      comingSoon: messagePresets.comingSoon,
      sitting: messagePresets.sitting,
      secondMessage: messagePresets.secondMessage,
      sameOffice: messagePresets.sameOffice,
      variantId: messagePresetVariants.id,
      label: messagePresetVariants.label,
      body: messagePresetVariants.body,
    })
    .from(messagePresetVariants)
    .innerJoin(messagePresets, eq(messagePresetVariants.presetId, messagePresets.id))
    .where(
      and(
        eq(messagePresets.type, type),
        eq(messagePresets.channel, "sms"),
        eq(messagePresets.enabled, true),
        eq(messagePresets.aiGenerated, false),
        eq(messagePresetVariants.enabled, true)
      )
    )
    .orderBy(messagePresets.createdAt);

  const sendCounts = await db
    .select({ variantId: messageSends.variantId, count: count() })
    .from(messageSends)
    .groupBy(messageSends.variantId);
  const countByVariant = new Map(sendCounts.map((r) => [r.variantId, r.count]));

  const rowsByPreset = new Map<string, typeof rows>();
  for (const row of rows) {
    const group = rowsByPreset.get(row.presetId);
    if (group) group.push(row);
    else rowsByPreset.set(row.presetId, [row]);
  }

  // Same rules as the Leads page's "Same office" group: a real agent, not the
  // client or someone who declined, near where the client works.
  const [offices, [listingAgent]] = await Promise.all([
    clientOffices(),
    listing.agentId
      ? db.select({ id: agents.id, status: agents.relationshipStatus }).from(agents).where(eq(agents.id, listing.agentId))
      : Promise.resolve([]),
  ]);
  const office = listingAgent ? officeClientFor(offices, listing.brokerName, [listing.city]) : null;
  const officeClient = office && office.agentId !== listingAgent?.id && listingAgent?.status !== "declined" ? office : null;

  const aiPreset = await getAiPreset(type);
  const recommendedPresetId = pickRecommendedPreset(
    Array.from(rowsByPreset.values()).map((group) => ({ ...group[0], id: group[0].presetId })),
    aiPreset,
    listingMatchFacts(listing),
    await isKnownAgent(listing.agentId),
    officeClient != null
  );

  // An office template is a false statement for anyone else, so it's only offered when it fits.
  const offered = Array.from(rowsByPreset.values()).filter((group) => !group[0].sameOffice || officeClient);
  const presets: PresetOption[] = offered.map((group) => {
    const minCount = Math.min(...group.map((r) => countByVariant.get(r.variantId) ?? 0));
    const leastUsed = group
      .filter((r) => (countByVariant.get(r.variantId) ?? 0) === minCount)
      .sort((a, b) => a.label.localeCompare(b.label));
    const picked = leastUsed[0];

    return {
      presetId: picked.presetId,
      presetName: picked.presetName,
      variantId: picked.variantId,
      variantLabel: picked.label,
      text: renderMessageBody(picked.body, listing.agentName, listing.address, listing.city, officeClient?.name ?? null),
      recommended: picked.presetId === recommendedPresetId,
      blank: picked.protected,
      secondMessage: picked.secondMessage,
    };
  });

  // A placeholder only — no Gemini call here. The AI draft is never the
  // default (see draftAiPresetOption's comment), so eagerly drafting one
  // on every dialog open regardless of whether it gets used would just be
  // a wasted call most of the time. Appended, not unshifted, so it can't
  // accidentally become the presets[0] fallback if nothing else is
  // recommended either.
  // A placeholder only — no Gemini call here; drafting stays on demand so an
  // unused recommendation costs nothing. Appended, not unshifted, so it can't
  // become the presets[0] fallback if nothing else is recommended either.
  if (aiPreset) {
    presets.push({
      presetId: aiPreset.id,
      presetName: aiPreset.name,
      variantId: AI_DRAFT_VARIANT_SENTINEL,
      variantLabel: "AI",
      text: "",
      recommended: recommendedPresetId === aiPreset.id,
      secondMessage: aiPreset.secondMessage,
    });
  }

  return { presets };
}

async function getAiPreset(
  type: PresetType
): Promise<(PresetCriteria & { id: string; name: string; secondMessage: string | null }) | null> {
  const [preset] = await db
    .select({
      id: messagePresets.id,
      name: messagePresets.name,
      secondMessage: messagePresets.secondMessage,
      minScore: messagePresets.minScore,
      maxScore: messagePresets.maxScore,
      minPrice: messagePresets.minPrice,
      maxPrice: messagePresets.maxPrice,
      maxListingAgeDays: messagePresets.maxListingAgeDays,
      minPhotoCount: messagePresets.minPhotoCount,
      maxPhotoCount: messagePresets.maxPhotoCount,
      leadSection: messagePresets.leadSection,
      comingSoon: messagePresets.comingSoon,
      sitting: messagePresets.sitting,
    })
    .from(messagePresets)
    .where(
      and(
        eq(messagePresets.type, type),
        eq(messagePresets.channel, "sms"),
        eq(messagePresets.aiGenerated, true),
        eq(messagePresets.enabled, true)
      )
    );
  return preset ?? null;
}

/**
 * Actually drafts the AI option — called on demand when the user selects
 * "AI Draft" from the dropdown (see the placeholder appended in
 * getMessageOptions above), never eagerly. Confirmed with Lukas: the AI
 * draft should never be auto-selected/default, only used when explicitly
 * chosen — drafting it upfront on every dialog open (the old behavior)
 * would burn a real Gemini call most of the time for nothing.
 */
export async function draftAiPresetOption(
  listingId: string,
  type: PresetType,
  instruction?: string
): Promise<PresetOption | null> {
  const [listing] = await db.select().from(listings).where(eq(listings.id, listingId));
  if (!listing) return null;
  const ageDays = listingAgeDays(listing.listedAt, listing.foundAt);
  return buildAiDraftOption(listingId, type, listing, ageDays, instruction);
}

/**
 * Drafts and returns the AI option, or null if there's no enabled AI-draft
 * preset for this type or the draft call fails — either way the dialog
 * just falls back to the regular presets. `instruction` is Lukas's own
 * steering for this specific redraft ("shorter," "mention the drone shot")
 * — see the "Regenerate" control in SendMessageDialog.
 */
async function buildAiDraftOption(
  listingId: string,
  type: PresetType,
  listing: Listing,
  ageDays: number,
  instruction?: string
): Promise<PresetOption | null> {
  const [preset] = await db
    .select({ id: messagePresets.id, name: messagePresets.name, secondMessage: messagePresets.secondMessage })
    .from(messagePresets)
    .where(
      and(
        eq(messagePresets.type, type),
        eq(messagePresets.channel, "sms"),
        eq(messagePresets.aiGenerated, true),
        eq(messagePresets.enabled, true)
      )
    );
  if (!preset) return null;

  let agent: Agent | null = null;
  let agentListingCount = 0;
  if (listing.agentId) {
    const [agentRow] = await db
      .select()
      .from(agents)
      .where(eq(agents.id, listing.agentId));
    agent = agentRow ?? null;

    const [{ count: listingCount }] = await db
      .select({ count: count() })
      .from(listings)
      .where(eq(listings.agentId, listing.agentId));
    agentListingCount = listingCount;
  }

  // Price now lives as line items on the listing's linked booking, not a
  // flat column here — sum them for the prompt if one exists.
  let bookingValue: number | null = null;
  if (listing.bookingId) {
    const [row] = await db
      .select({ total: sum(bookingLineItems.amount) })
      .from(bookingLineItems)
      .where(eq(bookingLineItems.bookingId, listing.bookingId));
    bookingValue = row?.total != null ? Number(row.total) : null;
  }

  // Everything we have on the listing, not a curated subset — including
  // the actual photos (draftMessage judges them itself, vision-based,
  // rather than being handed the pre-computed photoScore).
  const text = await draftMessage({
    type,
    address: listing.address,
    city: listing.city,
    state: listing.state,
    zipcode: listing.zipcode,
    price: listing.price,
    bedrooms: listing.bedrooms,
    bathrooms: listing.bathrooms,
    livingArea: listing.livingArea,
    homeType: listing.homeType,
    isComingSoon: listing.isComingSoon,
    listingUrl: listing.listingUrl,
    brokerName: listing.brokerName,
    status: listing.status,
    notes: listing.notes,
    bookingValue,
    photoCount: listing.photoCount,
    photos: listing.photos,
    ageDays,
    agentName: listing.agentName,
    agentRelationshipStatus: agent?.relationshipStatus ?? null,
    agentListingCount,
    agentLastContactedAt: agent?.lastContactedAt ?? null,
    agentNotes: agent?.notes ?? null,
    listing,
    agent,
    instruction,
  });
  if (!text) return null;

  return {
    presetId: preset.id,
    presetName: preset.name,
    variantId: AI_DRAFT_VARIANT_SENTINEL,
    variantLabel: "AI",
    text,
    // Never — see draftAiPresetOption's comment above.
    recommended: false,
    secondMessage: preset.secondMessage,
  };
}

/**
 * Logs a send against the chosen preset variant, then applies the same
 * listing mutation the old hardcoded flow did: initial outreach moves the
 * lead to "contacted"; a follow-up just resets the follow-up clock.
 *
 * `finalText` is the exact text actually sent (after any edits made in the
 * dialog). It's only used when `variantId` is the AI-draft sentinel — that
 * variant doesn't exist yet, since each AI draft is one-off, so it's
 * materialized as a real messagePresetVariants row here, at the moment of
 * sending, rather than speculatively for every dialog open.
 */
export async function sendMessage(
  listingId: string,
  type: PresetType,
  presetId: string,
  variantId: string,
  finalText: string
) {
  const now = new Date();

  let resolvedVariantId = variantId;
  if (variantId === AI_DRAFT_VARIANT_SENTINEL) {
    const [variant] = await db
      .insert(messagePresetVariants)
      .values({ presetId, label: `AI · ${now.toLocaleDateString()}`, body: finalText })
      .returning({ id: messagePresetVariants.id });
    resolvedVariantId = variant.id;
  }

  // Captured before the optimistic mark below overwrites it, so a later "no, I
  // didn't send it" can put the listing back where it actually came from. An
  // initial_outreach goes out from the leads page ("new") or from the
  // pipeline's saved row ("saved"), and both are reachable from the same
  // button — reading the status back off the row at revert time can't tell
  // them apart, by then it's been overwritten to "contacted" either way.
  let statusBefore: LeadStatus | null = null;
  if (type === "initial_outreach") {
    const [prior] = await db
      .select({ status: listings.status })
      .from(listings)
      .where(eq(listings.id, listingId));
    statusBefore = prior?.status ?? null;
  }

  // A text about the agent rather than the property (Backup Option) still
  // takes the listing off Leads, but as "outreach", which stays out of the
  // Pipeline — see messagePresets.pitchesListing.
  const [preset] = await db
    .select({ pitchesListing: messagePresets.pitchesListing })
    .from(messagePresets)
    .where(eq(messagePresets.id, presetId));
  const sentStatus = preset?.pitchesListing === false ? ("outreach" as const) : ("contacted" as const);

  const [lead] = await db
    .update(listings)
    .set({
      contactedAt: now,
      statusChangedAt: now,
      ...(type === "initial_outreach" ? { status: sentStatus } : {}),
    })
    .where(eq(listings.id, listingId))
    .returning({ agentPhone: listings.agentPhone, agentName: listings.agentName });

  const agentId = lead ? await touchAgentContact(listingId, lead.agentPhone, lead.agentName) : null;

  const [send] = await db
    .insert(messageSends)
    .values({
      listingId,
      agentId,
      presetId,
      variantId: resolvedVariantId,
      type,
      channel: "sms",
      sentAt: now,
    })
    .returning({ id: messageSends.id });

  // This only ever means "the Messages composer was opened" — the app hands off
  // via an sms: link and never learns whether the text was actually sent. The
  // send is still recorded up front so nothing is lost, and a pending
  // interaction is confirmed on the way back in; its Undo removes the send
  // again (see resolvePendingInteraction) so unsent drafts stop counting toward
  // a variant's stats.
  let pendingInteractionId: string | null = null;
  if (agentId) {
    pendingInteractionId = await startPendingInteraction({
      agentId,
      listingId,
      channel: "text",
      messageSendId: send?.id ?? null,
      listingStatusBefore: statusBefore,
    });
  }

  revalidatePath("/");
  revalidatePath("/pipeline");
  revalidatePath("/messaging");

  return { pendingInteractionId };
}
