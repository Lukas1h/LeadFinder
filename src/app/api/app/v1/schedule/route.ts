import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/appApiAuth";
import { loadScheduleItems } from "@/lib/scheduleItems";
import { todayScheduleDate } from "@/lib/schedule";
import { listingJson } from "../serialize";

/**
 * Today's schedule. Items come straight from loadScheduleItems — the same
 * function the Schedule page and the get_schedule MCP tool use — so the app
 * can't drift from either on what counts as an item or how they're ordered.
 * Only the embedded listing is reshaped, and only to one photo.
 */
export async function GET(req: Request) {
  const denied = requireAppAuth(req);
  if (denied) return denied;

  const today = todayScheduleDate();
  const items = await loadScheduleItems(today);

  return NextResponse.json({
    today,
    items: items.map((item) => ({
      ...item,
      listing: item.listing ? listingJson(item.listing, "first") : null,
    })),
  });
}
