import type { AgentRelationshipStatus } from "@/db/schema";

// Its own module rather than living in AgentCard.tsx (where it originated)
// — AgentCard renders AgentDetailDialog as its click trigger, so importing
// this constant from AgentCard created a circular import the moment
// AgentDetailDialog needed it too, which broke at runtime ("Cannot access
// 'RELATIONSHIP_LABELS' before initialization").
export const RELATIONSHIP_LABELS: Record<AgentRelationshipStatus, string> = {
  cold: "Cold",
  warm: "Warm",
  interested: "Interested",
  worked_once: "Worked once",
  regular: "Regular",
  declined: "Declined",
};

export const RELATIONSHIP_OPTIONS = Object.entries(RELATIONSHIP_LABELS) as [AgentRelationshipStatus, string][];
