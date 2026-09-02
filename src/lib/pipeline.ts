import type { Agent } from "@/db/schema";

export const FOLLOW_UP_AFTER_DAYS = 3;

export function findDuplicateAgentContact(
  agentPhone: string | null,
  currentListingId: string,
  agentByPhone: Map<string, Agent>
): Agent | null {
  if (!agentPhone) return null;
  const agent = agentByPhone.get(agentPhone);
  if (!agent || !agent.lastContactedListingId) return null;
  if (agent.lastContactedListingId === currentListingId) return null;
  return agent;
}
