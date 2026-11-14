import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/appApiAuth";
import { listShooters } from "@/lib/shooters";

/** Every shooter on file, for the booking form's picker (a bare array). */
export async function GET(req: Request) {
  const denied = requireAppAuth(req);
  if (denied) return denied;
  return NextResponse.json(await listShooters());
}
