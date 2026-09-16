import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { bookings } from "@/db/schema";
import { eq } from "drizzle-orm";

// gallery.lukashahn.art is a client-facing-only subdomain — kept
// completely separate from the admin app's own domains so a client who
// strips a gallery link down to its root never lands on Lukas's internal
// tool. A bare /<token> path (no /gallery/ prefix) is rewritten internally
// to the real /gallery/[token] page; the bare root, and any unrecognized
// token, redirect to the real business site instead.
//
// The token check happens here rather than relying on the page's own
// notFound() -> redirect(): Next.js's own docs are explicit that redirect()
// called during a streamed render only emits a client-side signal — real,
// pre-render HTTP redirects belong in Proxy. That's confirmed by testing:
// a redirect() thrown from not-found.tsx never actually navigated a real
// browser away from an invalid token's URL. A direct DB check here (the
// neon-http driver is fetch-based, genuinely Edge-compatible) gives an
// actual 307 before any page even starts rendering. This only runs for
// gallery.lukashahn.art requests — the admin app's own domains return
// immediately above and never pay this extra round trip.
const GALLERY_HOST = "gallery.lukashahn.art";
const MAIN_SITE_URL = "https://lukashahn.art/real-estate";

export async function proxy(req: NextRequest) {
  const host = req.headers.get("host") ?? "";
  if (host !== GALLERY_HOST && !host.startsWith(`${GALLERY_HOST}:`)) {
    return NextResponse.next();
  }

  const { pathname } = req.nextUrl;
  if (pathname === "/") {
    return NextResponse.redirect(MAIN_SITE_URL);
  }
  if (pathname.startsWith("/api/") || pathname.startsWith("/gallery/")) {
    return NextResponse.next();
  }

  const token = pathname.slice(1);
  try {
    const [match] = await db.select({ id: bookings.id }).from(bookings).where(eq(bookings.galleryToken, token));
    if (!match) return NextResponse.redirect(MAIN_SITE_URL);
  } catch (err) {
    // A lookup failure shouldn't strand a real client on a dead page —
    // fall through to the rewrite and let the page's own lookup (and its
    // best-effort not-found redirect) be the backstop.
    console.error("proxy: gallery token lookup failed", err);
  }

  return NextResponse.rewrite(new URL(`/gallery${pathname}`, req.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|manifest\\.webmanifest|icon\\.svg).*)"],
};
