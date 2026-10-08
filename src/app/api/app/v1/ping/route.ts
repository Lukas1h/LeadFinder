import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/appApiAuth";

/**
 * The cheapest possible call — the app hits it on launch to tell "your token
 * is wrong" apart from "the server is down".
 */
export function GET(req: Request) {
  const denied = requireAppAuth(req);
  if (denied) return denied;

  return NextResponse.json({ ok: true, serverTime: new Date().toISOString() });
}
