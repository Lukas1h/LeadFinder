import { db } from "@/db";
import { agents } from "@/db/schema";
import { requireAppAuth } from "@/lib/appApiAuth";
import { brokerageByAgent } from "@/lib/agentBrokerage";
import { callerLabel, callerNumber } from "../serialize";
import { bodyEtag, etagged } from "../helpers";

/**
 * The whole caller-ID table in one payload: [[number, label], …] plus a version
 * to cache against.
 *
 * iOS requires the entries sorted ascending by number — the OS matches calls
 * against this list itself, so the app never gets to search it — and one entry
 * per number, first wins, because a duplicate number would otherwise show two
 * labels for the same person. Agents with no usable 10-digit phone are left
 * out; that's the bulk of a cold-email import and none of it can be matched.
 *
 * Same ETag/304 handling as /agents: this only changes when an agent does.
 */
export async function GET(req: Request) {
  const denied = requireAppAuth(req);
  if (denied) return denied;

  const [rows, brokerage] = await Promise.all([db.select().from(agents), brokerageByAgent()]);

  const byNumber = new Map<number, string>();
  for (const a of rows) {
    const number = callerNumber(a.phone);
    if (number == null || byNumber.has(number)) continue;
    byNumber.set(number, callerLabel(a, brokerage.get(a.id)));
  }

  const entries = [...byNumber.entries()].sort((a, b) => a[0] - b[0]);
  // Hash of just the entries, so the app can skip re-parsing them on its own
  // cache without comparing the whole wrapper object.
  const version = bodyEtag(JSON.stringify(entries));

  return etagged(JSON.stringify({ version, entries }), req.headers.get("if-none-match"));
}
