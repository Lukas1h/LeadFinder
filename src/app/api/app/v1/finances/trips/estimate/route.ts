import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/appApiAuth";
import { routeForStops } from "@/lib/finance/writes";
import { badRequest, readJson, stringArray, withErrors } from "../../../helpers";

/**
 * `{ stops: ["111 Hunter Ct, Klamath Falls, OR", "Grants Pass, OR"] }` →
 * `{ miles, driveMinutes, approximate }`: round trip from home through the
 * stops. `approximate` lists stops routed to their town because the street
 * wasn't on the map. Takes a few seconds (the geocoder allows one lookup a
 * second). Saves nothing.
 */
export const POST = withErrors(async (req: Request) => {
  const denied = requireAppAuth(req);
  if (denied) return denied;
  const result = await routeForStops(stringArray((await readJson(req)).stops, "stops"));
  if ("error" in result) return badRequest(result.error);
  return NextResponse.json(result);
});
