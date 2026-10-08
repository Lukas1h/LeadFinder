import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/appApiAuth";
import { markListingsPassed, updateListingStatus } from "@/app/actions";
import { oneOf, readJson, stringArray, withErrors } from "../../helpers";

/** The Leads card's Save and Pass, batched so one agent's whole card goes at once. */
export const POST = withErrors(async (req: Request) => {
  const denied = requireAppAuth(req);
  if (denied) return denied;

  const body = await readJson(req);
  const listingIds = stringArray(body.listingIds, "listingIds");
  const status = oneOf(body.status, ["passed", "saved"] as const, "status");

  // Same rule as LeadActions: passing a whole agent's cards is one action, and
  // a single listing is a plain status change.
  if (status === "passed" && listingIds.length > 1) {
    await markListingsPassed(listingIds);
  } else {
    for (const id of listingIds) await updateListingStatus(id, status);
  }

  return NextResponse.json({ ok: true });
});
