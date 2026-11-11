import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/appApiAuth";
import { getLeadsBoard } from "@/app/leads-data";
import { LEAD_SECTION_LABELS, LEAD_SECTION_ORDER } from "@/lib/leadSections";
import { leadGroupJson } from "../serialize";
import { milesLabel } from "@/lib/nearShoots";
import { shortDate } from "@/app/follow-up/feeds/shared";

/**
 * The Leads board, in the page's display order. Sections and groups that are
 * empty are left out entirely, so the app can render straight down the list
 * without re-checking for emptiness.
 */
export async function GET(req: Request) {
  const denied = requireAppAuth(req);
  if (denied) return denied;

  const board = await getLeadsBoard({ cardPhotosOnly: true });

  const known = board.known.map((g) => leadGroupJson(g, board.addressById));
  // "Near your shoots" (leads-data.ts LeadsBoard.near): cold leads near a
  // recent shoot, pulled out of their sections into their own, right below
  // Agents you know, most recently shot first, each with the shoot as a badge.
  const nearGroups = LEAD_SECTION_ORDER.flatMap((key) => board.sections[key])
    .filter((g) => board.near.has(g.key))
    .sort((a, b) => {
      const x = board.near.get(a.key)!.near;
      const y = board.near.get(b.key)!.near;
      return y.shoot.shotAt.getTime() - x.shoot.shotAt.getTime() || x.miles - y.miles;
    })
    .map((g) => {
      const { near } = board.near.get(g.key)!;
      const json = leadGroupJson(g, board.addressById);
      const label = `Shot ${near.shoot.address} nearby · ${milesLabel(near.miles)} · ${shortDate(near.shoot.shotAt)}`;
      return { ...json, badges: [...json.badges, { kind: "nearShoot", label }] };
    });
  const sections = LEAD_SECTION_ORDER.map((key) => ({
    key,
    label: LEAD_SECTION_LABELS[key],
    // Unlikely is the one the web page renders collapsed — it's the do-nothing
    // pile, and opening the app shouldn't dump hundreds of cards into it.
    collapsed: key === "unlikely",
    groups: board.sections[key].filter((g) => !board.near.has(g.key)).map((g) => leadGroupJson(g, board.addressById)),
  }));

  return NextResponse.json({
    counts: {
      agents: board.agentCount,
      listings: board.openLeadCount,
      queued: board.queuedCount,
    },
    sections: [
      ...(known.length > 0 ? [{ key: "known" as const, label: "Agents you know", collapsed: false, groups: known }] : []),
      ...(nearGroups.length > 0 ? [{ key: "near" as const, label: "Near your shoots", collapsed: false, groups: nearGroups }] : []),
      ...sections.filter((s) => s.groups.length > 0),
    ],
  });
}
