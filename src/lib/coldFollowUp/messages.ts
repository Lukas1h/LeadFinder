import { db } from "@/db";
import { messagePresets, messagePresetVariants } from "@/db/schema";
import { renderMessageBody } from "@/lib/messageTemplate";
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
 * so a tab's cards all send the same thing (pitchFeedKey).
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

export type ColdPitch = "samples" | "video" | "turnaround" | "soft";

/** The cold Follow up tab a pitch's cards live on: one tab per second text. */
export function pitchFeedKey(p: ColdPitch): ColdFeedKey {
  return `cold_${p}`;
}

/** The SMS preset behind each pitch. */
export const COLD_PITCH_PRESETS: Record<ColdPitch, string> = {
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
 * - samples: his first text went out before the samples ask did, so "can I
 *   send a few?" is still news (pool.ts: samplesAskEligible).
 * - video: they already have a photographer and their listings are high end,
 *   so video is the thing that photographer might not do.
 * - turnaround: they have a photographer, but ordinary listings — speed and
 *   a backup are the sell.
 * - soft: no score on file, so nothing is known and nothing is assumed.
 */
export function pickPitch(c: { samplesAskEligible: boolean }, seg: AgentSegment | undefined): ColdPitch {
  if (c.samplesAskEligible) return "samples";
  if (seg?.segment === "has_photographer" && seg.highEnd) return "video";
  if (seg?.segment === "has_photographer") return "turnaround";
  return "soft";
}

/**
 * Preset name → the body of its first enabled SMS variant (by variant label),
 * for every cold text at once. Names with no preset get their FALLBACK, so a
 * caller can always read a body out of the map.
 */
export async function loadColdTemplates(): Promise<Map<string, string>> {
  const names = [...Object.values(COLD_TEXT1_PRESETS), ...Object.values(COLD_PITCH_PRESETS)];
  const templates = new Map<string, string>(Object.entries(COLD_FALLBACKS));
  if (names.length === 0) return templates;

  const rows = await db
    .select({ name: messagePresets.name, body: messagePresetVariants.body })
    .from(messagePresetVariants)
    .innerJoin(messagePresets, eq(messagePresets.id, messagePresetVariants.presetId))
    .where(
      and(
        inArray(messagePresets.name, names),
        eq(messagePresets.channel, "sms"),
        // Archived presets are "deleted" on the Messaging page (schema.ts): not in use.
        isNull(messagePresets.archivedAt),
        eq(messagePresetVariants.enabled, true)
      )
    )
    .orderBy(messagePresets.name, messagePresetVariants.label);

  // Ordered by name then label, so the first row of each name is its first variant.
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.name)) continue;
    seen.add(row.name);
    templates.set(row.name, row.body);
  }
  return templates;
}

/** A candidate's two texts, rendered for their agent and listing. */
export function renderColdTexts(
  c: ColdCandidate,
  seg: AgentSegment | undefined,
  templates: Map<string, string>
): { text1: string; text2: string; pitch: ColdPitch } {
  const pitch = pickPitch(c, seg);
  const text1Name = COLD_TEXT1_PRESETS[c.trigger];
  const text2Name = COLD_PITCH_PRESETS[pitch];
  const body = (name: string) => templates.get(name) ?? COLD_FALLBACKS[name] ?? "";
  return {
    text1: renderMessageBody(body(text1Name), c.agent.name, c.listing.address, c.listing.city),
    text2: renderMessageBody(body(text2Name), c.agent.name, c.listing.address, c.listing.city),
    pitch,
  };
}
