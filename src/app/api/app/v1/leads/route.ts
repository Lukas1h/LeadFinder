import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/appApiAuth";
import { getLeadsBoard } from "@/app/leads-data";
import { LEAD_SECTION_LABELS, LEAD_SECTION_ORDER } from "@/lib/leadSections";
import { leadGroupJson } from "../serialize";

/**
 * The Leads board, in the page's display order. Sections and groups that are
 * empty are left out entirely, so the app can render straight down the list
 * without re-checking for emptiness.
 */
export async function GET(req: Request) {
  const denied = requireAppAuth(req);
  if (denied) return denied;

  const board = await getLeadsBoard();

  const known = board.known.map((g) => leadGroupJson(g, board.addressById));
  const sections = LEAD_SECTION_ORDER.map((key) => ({
    key,
    label: LEAD_SECTION_LABELS[key],
    // Unlikely is the one the web page renders collapsed — it's the do-nothing
    // pile, and opening the app shouldn't dump hundreds of cards into it.
    collapsed: key === "unlikely",
    groups: board.sections[key].map((g) => leadGroupJson(g, board.addressById)),
  }));

  return NextResponse.json({
    counts: {
      agents: board.agentCount,
      listings: board.openLeadCount,
      queued: board.queuedCount,
    },
    sections: [
      ...(known.length > 0 ? [{ key: "known" as const, label: "Agents you know", collapsed: false, groups: known }] : []),
      ...sections.filter((s) => s.groups.length > 0),
    ],
  });
}
