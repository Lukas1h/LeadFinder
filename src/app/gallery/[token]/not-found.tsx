import { redirect } from "next/navigation";
import { MAIN_SITE_URL } from "@/lib/siteUrls";

// An invalid/unknown gallery token sends the visitor to the real business
// site instead of a branded-but-broken "not found" page — there's no
// legitimate reason for a client to land on a dead link, and this also
// covers the gallery host's own bare root via proxy.ts (which
// redirects there directly, without a lookup, for the same reason).
export default function GalleryNotFound() {
  redirect(MAIN_SITE_URL);
}
