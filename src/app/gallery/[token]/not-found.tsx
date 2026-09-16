import { redirect } from "next/navigation";

// An invalid/unknown gallery token sends the visitor to the real business
// site instead of a branded-but-broken "not found" page — there's no
// legitimate reason for a client to land on a dead link, and this also
// covers gallery.lukashahn.art's own bare root via middleware.ts (which
// redirects there directly, without a lookup, for the same reason).
export default function GalleryNotFound() {
  redirect("https://lukashahn.art/real-estate");
}
