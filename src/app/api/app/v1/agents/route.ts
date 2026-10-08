import { db } from "@/db";
import { agents } from "@/db/schema";
import { requireAppAuth } from "@/lib/appApiAuth";
import { brokerageByAgent } from "@/lib/agentBrokerage";
import { callerLabel, callerNumber } from "../serialize";
import { etagged } from "../helpers";

/**
 * The Agents list, with the one extra thing the app needs that the web doesn't:
 * callerNumber and callerLabel, so an incoming call can be matched to a person
 * before the app has fetched anyone.
 *
 * ETag'd because it's the biggest steady-state payload the app pulls (thousands
 * of cold agents) and it barely changes between foregrounds.
 */
export async function GET(req: Request) {
  const denied = requireAppAuth(req);
  if (denied) return denied;

  const [rows, brokerage] = await Promise.all([db.select().from(agents), brokerageByAgent()]);

  // Unnamed agents last: a null name is a row from an email import we never
  // resolved, and it's no use as a caller ID entry.
  const sorted = [...rows].sort((a, b) => {
    if (!a.name !== !b.name) return a.name ? -1 : 1;
    return (a.name ?? "").localeCompare(b.name ?? "") || a.id.localeCompare(b.id);
  });

  const body = JSON.stringify({
    agents: sorted.map((a) => ({
      id: a.id,
      name: a.name,
      phone: a.phone,
      email: a.email,
      relationshipStatus: a.relationshipStatus,
      lastContactedAt: a.lastContactedAt,
      brokerage: a.id ? (brokerage.get(a.id) ?? null) : null,
      callerNumber: callerNumber(a.phone),
      callerLabel: callerLabel(a, brokerage.get(a.id)),
    })),
  });

  return etagged(body, req.headers.get("if-none-match"));
}
