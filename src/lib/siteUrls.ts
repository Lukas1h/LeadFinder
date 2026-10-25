// Lukas's public addresses, in one place. The business is Hahn Media at
// lukashahn.media now; the older lukashahn.art hosts still serve every link
// already sent (proxy.ts), but anything new is made on these.

/** The main website, where a stripped-down or dead client link lands. */
export const MAIN_SITE_URL = "https://lukashahn.media";
/** Client galleries: <origin>/<token>. */
export const GALLERY_ORIGIN = "https://gallery.lukashahn.media";
/** Personalized agent pages: <origin>/<slug>. */
export const PORTFOLIO_ORIGIN = "https://r.lukashahn.media";

/**
 * Hosts that serve only the client-facing pages (galleries, agent pages),
 * never the admin app. gallery.lukashahn.art is the old one, kept for links
 * already out there.
 */
export const CLIENT_HOSTS = ["gallery.lukashahn.media", "r.lukashahn.media", "gallery.lukashahn.art"];
