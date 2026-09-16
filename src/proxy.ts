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

// Marks a request as "serving the gallery experience" so layout.tsx (a
// Server Component) can decide server-side whether to wrap it in the
// admin app's nav chrome — NOT decided client-side by matching
// usePathname() against "/gallery/", which silently never matches here:
// a rewrite is invisible to the browser's URL bar, so usePathname() on
// gallery.lukashahn.art/<token> reports the bare /<token> path, never the
// rewritten /gallery/<token> destination. That gap shipped the admin
// sidebar/nav bar straight to a real client's phone before it was caught.
const GALLERY_VIEW_HEADER = "x-gallery-view";

function markGalleryView(headers: Headers): Headers {
  const clone = new Headers(headers);
  clone.set(GALLERY_VIEW_HEADER, "1");
  return clone;
}

export async function proxy(req: NextRequest) {
  const host = req.headers.get("host") ?? "";
  const isGalleryHost = host === GALLERY_HOST || host.startsWith(`${GALLERY_HOST}:`);
  const { pathname } = req.nextUrl;

  if (!isGalleryHost) {
    // Direct /gallery/[token] access on any other domain (the admin app's
    // own aliases, or someone who bookmarked an old link) still needs to be
    // chrome-less — same header, same single source of truth in layout.tsx.
    if (pathname.startsWith("/gallery/")) {
      return NextResponse.next({ request: { headers: markGalleryView(req.headers) } });
    }
    return NextResponse.next();
  }

  if (pathname === "/") {
    return NextResponse.redirect(MAIN_SITE_URL);
  }
  if (pathname.startsWith("/api/")) {
    return NextResponse.next();
  }
  if (pathname.startsWith("/gallery/")) {
    return NextResponse.next({ request: { headers: markGalleryView(req.headers) } });
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

  return NextResponse.rewrite(new URL(`/gallery${pathname}`, req.url), {
    request: { headers: markGalleryView(req.headers) },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|manifest\\.webmanifest|icon\\.svg).*)"],
};
