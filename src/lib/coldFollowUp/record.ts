import { db } from "@/db";
import { getMarkets } from "@/lib/marketsData";
import { messageSends } from "@/db/schema";
import { ENABLED_COLD_TRIGGERS } from "./pool";
import { getColdFollowUpCandidates } from "./triggers";
import { loadAgentSegments } from "./segment";
import {
  COLD_PITCH_PRESETS,
  loadColdPresetIds,
  loadColdTemplates,
  pitchFeedKey,
  renderColdTexts,
} from "./messages";

/**
 * The send behind a cold card's Text tap (2026-11-15).
 *
 * Cold follow-ups used to be interactions only, on purpose: they stay out of
 * the texting quota and the send stats (see the note in docs/AGENT-GUIDE.md).
 * But an interaction carries no preset, so nothing in Messages knew what the
 * text was and a reply got no quick actions — and the shoot it was about had
 * nowhere to live. So the tap now records one `message_sends` row too, and the
 * card's excuse and pitch become the send body, exactly as they were copied.
 *
 * The card is recomputed here rather than passed in, so the row can only hold
 * what this agent's card actually said: the trigger (and so text 1) and the
 * pitch (text 2, and the tab it came from) are worked out again from the same
 * inputs the page used. A tap on a tab whose pitch doesn't match, or an agent
 * who no longer has a card (another tab's tap already sent it, or a pass
 * landed), records nothing — the interaction still says he texted.
 *
 * Returns null when there is nothing to attribute the send to: no card, a
 * mismatched tab, or a pitch preset Lukas hasn't created yet (the fallback
 * wording has no variant to credit).
 */
export async function recordColdFollowUpSend(agentId: string, feedKey: string): Promise<string | null> {
  const candidates = await getColdFollowUpCandidates(Date.now(), ENABLED_COLD_TRIGGERS);
  const candidate = candidates.find((c) => c.agent.id === agentId);
  if (!candidate) return null;

  const [segments, templates, presets, mk] = await Promise.all([
    loadAgentSegments([agentId]),
    loadColdTemplates(),
    loadColdPresetIds(),
    getMarkets(),
  ]);
  const { text1, text2, pitch } = renderColdTexts(candidate, segments.get(agentId), templates, mk);
  // The tab it was tapped on is the pitch it claims to send: no card, no send.
  if (pitchFeedKey(pitch) !== feedKey) return null;

  const preset = presets.get(COLD_PITCH_PRESETS[pitch]);
  if (!preset) return null;

  const [send] = await db
    .insert(messageSends)
    .values({
      agentId,
      listingId: candidate.listing.id,
      presetId: preset.presetId,
      variantId: preset.variantId,
      type: "follow_up",
      channel: "sms",
      // Both texts, the way one tap sends them, so the timeline shows what
      // actually went out and the reply's context is all here.
      body: `${text1}\n\n${text2}`,
      recipientName: candidate.agent.name ?? null,
      // Only a Showcase shoot earns the share ask, so only it is remembered:
      // the portfolio page built for a yes leads with this shoot.
      featuredBookingId: candidate.shoot?.showcase ? candidate.shoot.bookingId : null,
    })
    .returning({ id: messageSends.id });
  return send?.id ?? null;
}
