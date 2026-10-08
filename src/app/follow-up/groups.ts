import type { Agent } from "@/db/schema";

/**
 * The Follow up page's quiet buckets.
 *
 * In a plain module rather than inside FollowUpList.tsx so the iPhone app's
 * GET /follow-up groups the same agents under the same labels the web shows —
 * the list component is "use client", and a value imported from it on the
 * server would be a client reference, not the array.
 */
export const FOLLOW_UP_GROUPS: { label: string; match: (a: Agent) => boolean }[] = [
  { label: "Past clients", match: (a: Agent) => a.relationshipStatus === "regular" || a.relationshipStatus === "worked_once" },
  { label: "Interested, gone quiet", match: (a: Agent) => a.relationshipStatus === "interested" },
  { label: "Warm", match: (a: Agent) => a.relationshipStatus === "warm" },
];
