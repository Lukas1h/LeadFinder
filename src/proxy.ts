import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { bookings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { authGateEnabled, isValidSession, safeNextPath, SESSION_COOKIE } from "@/lib/adminSession";

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
//
// /login sets it too: the sign-in card is chrome-less, so it neither needs nor
// gets the nav it would be asking the app to show before anyone has signed in.
const GALLERY_VIEW_HEADER = "x-gallery-view";

function markGalleryView(headers: Headers): Headers {
  const clone = new Headers(headers);
  clone.set(GALLERY_VIEW_HEADER, "1");
  return clone;
}

// Admin-host paths that stay reachable with no session. Each already carries
// its own protection, or isn't admin data at all:
//
//   /login                  the sign-in page and its Server Action POST
//   /gallery/…              client galleries opened on an admin domain
//   /api/gallery/…          client downloads, gated by gallery token
//   /api/unsubscribe        signed token in the URL, from an email footer
//   /api/webhooks/…         Svix-signed (AgentMail)
//   /api/cron/…             CRON_SECRET
//   /api/import-listing     IMPORT_SHARE_SECRET; called by an iOS Shortcut,
//                           which sends no cookies
//   /api/mcp                MCP_SHARE_SECRET; the claude.ai connector
//   /api/compose/…          COMPOSE_BATCH_SECRET
//   /api/app/…              MOBILE_API_SECRET — the iPhone app's own bearer
//                           token, checked in the handler (see lib/appApiAuth)
//   vcard / calendar         handed to iOS's Contacts and Calendar sheets,
//                           which fetch without the web app's cookie. The ids
//                           are unguessable UUIDs, as they already were.
//
// Listed exhaustively rather than by "does it look public", because the
// failure mode of forgetting one is an app serving real agents' phone numbers
// to anyone again.
const PUBLIC_PATHS = new Set([
  "/login",
  "/api/unsubscribe",
  "/api/import-listing",
  "/api/mcp",
  "/api/compose/cold-outreach",
]);

const PUBLIC_PREFIXES = ["/gallery/", "/api/gallery/", "/api/webhooks/", "/api/cron/", "/api/app/", "/.well-known/"];

const HANDOFF_FILE_RE = /^\/api\/(agents|bookings)\/[^/]+\/(vcard|calendar)$/;

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  if (PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return true;
  if (HANDOFF_FILE_RE.test(pathname)) return true;
  // Everything else under /api/ is admin data.
  if (pathname.startsWith("/api/")) return false;
  // A last segment with an extension is a file in public/ (sw.js, the icons,
  // splash/*), not a page.
  return pathname.slice(pathname.lastIndexOf("/") + 1).includes(".");
}

/**
 * The password gate, for the admin domains only — the gallery host has its own
 * rules and never reaches here. Returns a response to send as-is, or null to
 * carry on with the request.
 */
function adminGate(req: NextRequest): Response | null {
  if (!authGateEnabled()) return null;

  const { pathname, search } = req.nextUrl;

  if (pathname === "/login") {
    // Already signed in — the login page has nothing left to offer.
    if (isValidSession(req.cookies.get(SESSION_COOKIE)?.value)) {
      return NextResponse.redirect(new URL(safeNextPath(req.nextUrl.searchParams.get("next")), req.url));
    }
    return NextResponse.next({ request: { headers: markGalleryView(req.headers) } });
  }

  if (isPublicPath(pathname)) return null;
  if (isValidSession(req.cookies.get(SESSION_COOKIE)?.value)) return null;

  // Server Actions are POSTs to the page that uses them, so a non-GET method
  // here is an action rather than a page a human followed a link to — and
  // fetch() can't be answered with a login page, it needs to be told it was
  // refused.
  if (pathname.startsWith("/api/") || (req.method !== "GET" && req.method !== "HEAD")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(`${pathname}${search}`)}`, req.url));
}

export async function proxy(req: NextRequest) {
  const host = req.headers.get("host") ?? "";
  const isGalleryHost = host === GALLERY_HOST || host.startsWith(`${GALLERY_HOST}:`);
  const { pathname } = req.nextUrl;

  if (!isGalleryHost) {
    // Ahead of the /gallery/ handling below: the admin domains serve the whole
    // app to anyone who asks, so this is where every non-public request has to
    // be checked. /gallery/ is exempt (isPublicPath) and still gets exactly
    // the chrome-less treatment it had before.
    const denied = adminGate(req);
    if (denied) return denied;

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
