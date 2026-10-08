import type { Agent, Listing } from "@/db/schema";
import { formatDate, formatDateOnly, daysSince, formatPrice } from "@/lib/format";

/**
 * The wording of the badges on a lead card, as plain strings.
 *
 * These live here rather than in src/app/badges.tsx because that file is a
 * "use client" module — importing a value from it on the server hands back a
 * client reference, not the function. The badges themselves still render the
 * React components from badges.tsx; only the label/detail text comes from here,
 * so the iPhone app's GET /leads and the web card can't disagree about what a
 * price cut or a photo score is called.
 *
 * Any change to the wording below belongs in both places at once: keep
 * badges.tsx rendering these rather than re-deriving the strings.
 */

// Compact money for badge text, where there's room for at most one decimal.
// The unary + drops a trailing ".0" so a clean $10,000 reads "$10K" rather
// than "$10.0K".
function shortMoney(n: number): string {
  if (n >= 1_000_000) return `$${+(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `$${+(n / 1000).toFixed(1)}K`;
  return `$${n}`;
}

export interface BadgeText {
  kind: "new" | "comingSoon" | "priceCut" | "fewPhotos" | "photoScore" | "builder" | "declined" | "officeClient";
  label: string;
  /** Tooltip text, where the badge has one. */
  detail?: string;
}

/** "Price cut −$50K", plus the tooltip PriceCutBadge wraps around it. Null if there's no cut. */
export function priceCutBadge(lead: Pick<Listing, "priceCutAt" | "priceCutAmount" | "priceCutCount" | "originalPrice" | "price" | "listedAt">): BadgeText | null {
  if (!lead.priceCutAt) return null;

  const { priceCutAt, priceCutAmount, priceCutCount, originalPrice, price, listedAt } = lead;

  // Each part is optional: a cut we've only just detected may not have a
  // count or a prior price yet, and an agent can cut before the listing has
  // been on the market long enough for us to know its listed date.
  const details: string[] = [];
  if (priceCutCount != null && priceCutCount > 0) {
    details.push(`${priceCutCount} price cut${priceCutCount === 1 ? "" : "s"}`);
  }
  if (originalPrice != null && price != null && originalPrice > price) {
    details.push(`${formatPrice(originalPrice)} → ${formatPrice(price)}`);
  }
  if (listedAt) {
    details.push(`on market ${daysSince(listedAt)} days`);
  }
  details.push(`cut ${formatDateOnly(priceCutAt)}`);

  return {
    kind: "priceCut",
    label: `Price cut${priceCutAmount != null ? ` −${shortMoney(priceCutAmount)}` : ""}`,
    detail: details.join(" · "),
  };
}

export function photoScoreTier(score: number): { label: string; style: string } {
  if (score <= 3) return { label: "Poor photos", style: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-400 dark:border-red-900" };
  if (score <= 5) return { label: "Amateur photos", style: "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-900" };
  if (score <= 7) return { label: "Good photos", style: "bg-muted text-muted-foreground" };
  return { label: "Pro photos", style: "bg-muted text-muted-foreground/60" };
}

export function fewPhotosBadge(count: number): BadgeText {
  return { kind: "fewPhotos", label: `Only ${count} photo${count === 1 ? "" : "s"}` };
}

export function builderBadge(): BadgeText {
  return { kind: "builder", label: "Builder" };
}

/** Null unless this agent is actually declined — the card only shows it then. */
export function agentDeclinedBadge(
  agent: Pick<Agent, "name">,
  duplicateAddress?: string | null
): BadgeText | null {
  return {
    kind: "declined",
    label: "Agent declined",
    detail: `${agent.name ?? "This agent"} has marked their status as declined${
      duplicateAddress ? ` · previously on ${duplicateAddress}` : ""
    }`,
  };
}

export function comingSoonBadge(): BadgeText {
  return { kind: "comingSoon", label: "Coming soon" };
}

export function newBadge(): BadgeText {
  return { kind: "new", label: "New" };
}

/** "Already contacted" — used by listing cards that aren't lead cards. */
export function duplicateAgentBadge(
  agent: Pick<Agent, "name" | "lastContactedAt">,
  duplicateAddress: string | null | undefined
): BadgeText {
  return {
    kind: "declined",
    label: "Already contacted",
    // Without a listing pointer the contact was a cold email or a logged
    // call, not a property conversation — naming "another listing" there
    // would invent one.
    detail: `Already contacted ${agent.name ?? "this agent"} on ${formatDate(agent.lastContactedAt)}${
      duplicateAddress ? ` about ${duplicateAddress}` : ""
    }`,
  };
}

/** "Shot for Sarah at Oregon Life Homes" — a client in this lead's office (see lib/clientOffices.ts). */
export function officeClientBadge(client: { name: string | null; brokerage: string; address: string | null }): BadgeText {
  const who = client.name?.trim().split(/\s+/)[0] ?? "a client";
  return {
    kind: "officeClient",
    label: `Shot for ${who} at ${client.brokerage}`,
    detail: client.address ? `${client.name ?? "Client"} · ${client.address}` : undefined,
  };
}
