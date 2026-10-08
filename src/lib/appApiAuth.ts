import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

/**
 * Bearer-token auth for the iPhone app's JSON API (/api/app/v1/*).
 *
 * Separate from the admin app's cookie gate (lib/adminSession.ts) on purpose:
 * a native app has no browser cookie jar to lean on, and the token is pasted
 * into the app once instead of typed into a form on every device. MOBILE_API_SECRET
 * is the same secret the never-merged Expo branch left behind, reused rather
 * than adding a second one to keep track of.
 *
 * Handlers start with:
 *   const denied = requireAppAuth(req); if (denied) return denied;
 * so a new route is authenticated by default.
 */
export function requireAppAuth(req: Request): Response | null {
  const secret = process.env.MOBILE_API_SECRET;
  // Fail closed: no secret configured means no way to authenticate anyone.
  if (!secret) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const header = req.headers.get("authorization");
  // Both sides hashed first so a wrong-length header still compares two
  // equal-length digests, rather than making timingSafeEqual throw (which
  // would answer 500 instead of 401).
  const digest = (value: string) => createHash("sha256").update(value).digest();
  if (!timingSafeEqual(digest(header ?? ""), digest(`Bearer ${secret}`))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}
