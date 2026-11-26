import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/appApiAuth";
import { listEditors } from "@/lib/shooters";

/** Photo editors named on past bookings, most used first, for the booking form's picker (a bare array of names). */
export async function GET(req: Request) {
  const denied = requireAppAuth(req);
  if (denied) return denied;
  return NextResponse.json(await listEditors());
}
