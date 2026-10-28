// Lukas's public addresses, in one place. The business is Hahn Media at
// lukashahn.media now; the older lukashahn.art hosts still serve every link
// already sent (proxy.ts), but anything new is made on these.

/** The main website, where a stripped-down or dead client link lands. */
export const MAIN_SITE_URL = "https://lukashahn.media";
/** Client galleries: <origin>/<token>. */
export const GALLERY_ORIGIN = "https://gallery.lukashahn.media";
/**
 * Agent pages as sent: lukashahn.media/portfolio/<word>. The main site is a
 * separate Vercel project (lukashahnart) whose next.config forwards
 * /portfolio/*, /lf/* (this app's assets, see assetPrefix in next.config.ts),
 * /api/portfolio/*, /api/portfolio-image/* and /agent-page/* to
 * PORTFOLIO_ORIGIN, so the link carries the business's own domain.
 */
export const AGENT_PAGE_ORIGIN = "https://lukashahn.media";
/** Where agent pages are actually served (and older links point): <origin>/<slug>. */
export const PORTFOLIO_ORIGIN = "https://r.lukashahn.media";

/**
 * Hosts that serve only the client-facing pages (galleries, agent pages),
 * never the admin app. gallery.lukashahn.art is the old one, kept for links
 * already out there.
 */
export const CLIENT_HOSTS = ["gallery.lukashahn.media", "r.lukashahn.media", "gallery.lukashahn.art"];

/** The link as it opens for Lukas himself: ?preview=1 means not a visit (no tracking, no push). */
export function portfolioPreviewUrl(url: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}preview=1`;
}
