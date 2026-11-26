import { db } from "@/db";
import { messagePresets, messagePresetVariants } from "@/db/schema";
import { marketMessageContext } from "@/lib/areaPhrase";
import { renderMessageBody } from "@/lib/messageTemplate";
import type { MarketIndex } from "@/lib/markets";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { AgentSegment } from "./segment";
import type { ColdFeedKey, ColdTrigger } from "./pool";
import type { ColdCandidate } from "./triggers";

/**
 * The two texts every cold follow-up sends, and the templates behind them.
 *
 * Text 1 is the excuse: it says why he's writing *now* (their new listing, a
 * shoot near them, a job in their area). Text 2 is the pitch, and which one
 * depends on what they already have: nothing on file means the samples ask is
 * the easy yes, an agent whose listings are already shot professionally gets
 * the video question instead (a cold pitch for photos has to beat the person
 * already shooting for them, segment.ts), and the rest split between
 * turnaround and a soft "back on your radar".
 *
 * The pitch is also the tab: each cold Follow up feed key is one second text,
 * so a tab's cards all send the same thing (pitchFeedKey). A shoot-based
 * excuse skips the segment rules entirely (2026-11-15): a shoot he marked
 * Showcase gets the share ask, any other shoot the soft nudge.
 *
 * Both are editable on the Messaging page as ordinary SMS presets; the
 * FALLBACKS here are only the seed wording for a preset that doesn't exist
 * yet, so the tab reads sensibly before Lukas writes his own.
 */

/** The SMS preset each cold trigger's first text comes from. */
export const COLD_TEXT1_PRESETS: Record<ColdTrigger, string> = {
  new_listing: "Cold follow-up: new listing",
  near_shoot: "Cold follow-up: shot one near you",
  in_area: "Cold follow-up: in the area",
};

export type ColdPitch = "showcase" | "samples" | "video" | "turnaround" | "soft";

/** The cold Follow up tab a pitch's cards live on: one tab per second text. */
export function pitchFeedKey(p: ColdPitch): ColdFeedKey {
  return `cold_${p}`;
}

/** The SMS preset behind each pitch. */
export const COLD_PITCH_PRESETS: Record<ColdPitch, string> = {
  showcase: "Cold pitch: showcase",
  samples: "Cold pitch: samples",
  video: "Cold pitch: video (high end)",
  turnaround: "Cold pitch: turnaround",
  soft: "Cold pitch: soft",
};

/** Wording used when the preset above hasn't been created on the Messaging page yet. */
export const COLD_FALLBACKS: Record<string, string> = {
  "Cold follow-up: new listing":
    "Hi {{firstName}}, it's Lukas again, the real estate photographer. Saw your new listing on {{street}}, congrats!",
  "Cold follow-up: shot one near you":
    "Hi {{firstName}}, it's Lukas again. I just shot a listing near your {{street}} property.",
  "Cold follow-up: in the area":
    "Hi {{firstName}}, it's Lukas again. I was in the {{city}} area and shot a listing the other day.",
  "Cold pitch: showcase": "I was wondering if I could share a few pics from it and what I charged?",
  "Cold pitch: samples": "Would it be okay if I sent over a few samples of my work?",
  "Cold pitch: video (high end)":
    "Quick question, does your photographer do video too? I do walkthrough videos and could send you one I just made.",
  "Cold pitch: turnaround":
    "Quick question, how fast does your photographer get photos back to you? I deliver by the next morning and could send you a few from my last shoot.",
  "Cold pitch: soft":
    "No pressure at all, just wanted to put myself back on your radar. Could I send you a few pics from a recent shoot?",
};

/**
 * Which pitch this agent gets.
 *
 * A shoot is the excuse (near_shoot, in_area): a Showcase shoot is the pitch
 * itself; any other shoot sends an agent with a photographer to turnaround
 * (video if high end), and everyone else to soft. The samples date doesn't
 * apply to shoot excuses.
 *
 * - showcase: the shoot he is pointing at is marked Showcase, so it is one he
 *   is happy to show — ask to share a few pics from it and what he charged.
 *   A yes leads to a portfolio page built around that shoot.
 * - turnaround / video: the shoot isn't Showcase and they have a photographer.
 * - soft: the shoot isn't Showcase and there's no photographer on record, so
 *   the ask stays vague.
 *
 * A new listing has no shoot, so the usual segment rules decide:
 *
 * - samples: his first text went out before the samples ask did, so "can I
 *   send a few?" is still news (pool.ts: samplesAskEligible).
 * - video: they already have a photographer and their listings are high end,
 *   so video is the thing that photographer might not do.
 * - turnaround: they have a photographer, but ordinary listings — speed and
 *   a backup are the sell.
 * - soft: no score on file, so nothing is known and nothing is assumed.
 */
export function pickPitch(
  c: { trigger: ColdTrigger; shoot?: { showcase: boolean } | null; samplesAskEligible: boolean },
  seg: AgentSegment | undefined
): ColdPitch {
  if (c.trigger === "near_shoot" || c.trigger === "in_area") {
    if (c.shoot?.showcase) return "showcase";
    // A shoot that isn't Showcase is only the excuse. Agents who already have
    // a photographer get the switch pitch (turnaround, or video if high end)
    // whatever their first-text date; everyone else the soft one (Lukas,
    // 2026-11-15: he wants to send turnaround more).
    if (seg?.segment === "has_photographer") return seg.highEnd ? "video" : "turnaround";
    return "soft";
  }
  if (c.samplesAskEligible) return "samples";
  if (seg?.segment === "has_photographer" && seg.highEnd) return "video";
  if (seg?.segment === "has_photographer") return "turnaround";
  return "soft";
}

/** The preset + variant behind one cold text, for recording the send. */
export interface ColdPresetRef {
  presetId: string;
  variantId: string;
  body: string;
}

/**
 * Preset name → its first enabled SMS variant (by variant label) among the
 * presets that are in use (enabled, not archived). Only names that actually
 * exist on the Messaging page come back, which is how a caller tells "Lukas's
 * wording" from "the code fallback" — a send can only be recorded against a
 * real variant.
 */
export async function loadColdPresetIds(): Promise<Map<string, ColdPresetRef>> {
  const names = [...Object.values(COLD_TEXT1_PRESETS), ...Object.values(COLD_PITCH_PRESETS)];

  const rows = await db
    .select({
      name: messagePresets.name,
      presetId: messagePresets.id,
      variantId: messagePresetVariants.id,
      body: messagePresetVariants.body,
    })
    .from(messagePresetVariants)
    .innerJoin(messagePresets, eq(messagePresets.id, messagePresetVariants.presetId))
    .where(
      and(
        inArray(messagePresets.name, names),
        eq(messagePresets.channel, "sms"),
        eq(messagePresets.enabled, true),
        // Archived presets are "deleted" on the Messaging page (schema.ts): not in use.
        isNull(messagePresets.archivedAt),
        eq(messagePresetVariants.enabled, true)
      )
    )
    .orderBy(messagePresets.name, messagePresetVariants.label);

  // Ordered by name then label, so the first row of each name is its first variant.
  const first = new Map<string, ColdPresetRef>();
  for (const row of rows) {
    if (first.has(row.name)) continue;
    first.set(row.name, { presetId: row.presetId, variantId: row.variantId, body: row.body });
  }
  return first;
}

/**
 * Preset name → the body of its first enabled variant, for every cold text at
 * once. Names with no preset get their FALLBACK, so a caller can always read a
 * body out of the map.
 */
export async function loadColdTemplates(): Promise<Map<string, string>> {
  const templates = new Map<string, string>(Object.entries(COLD_FALLBACKS));
  for (const [name, preset] of await loadColdPresetIds()) templates.set(name, preset.body);
  return templates;
}

/** A candidate's two texts, rendered for their agent and listing. */
export function renderColdTexts(
  c: ColdCandidate,
  seg: AgentSegment | undefined,
  templates: Map<string, string>,
  /** The markets, on the server: {{area}} and the prices come from the listing's market. */
  mk?: MarketIndex | null
): { text1: string; text2: string; pitch: ColdPitch } {
  const pitch = pickPitch(c, seg);
  const text1Name = COLD_TEXT1_PRESETS[c.trigger];
  const text2Name = COLD_PITCH_PRESETS[pitch];
  const body = (name: string) => templates.get(name) ?? COLD_FALLBACKS[name] ?? "";
  // Without mk (a preview) it's the home wording and the default prices, as
  // renderMessageBody does on the client.
  const market = mk
    ? marketMessageContext(mk, { city: c.listing.city, state: c.listing.state }, c.market)
    : null;
  return {
    text1: renderMessageBody(body(text1Name), c.agent.name, c.listing.address, c.listing.city, null, market),
    text2: renderMessageBody(body(text2Name), c.agent.name, c.listing.address, c.listing.city, null, market),
    pitch,
  };
}
