import { eq, or } from "drizzle-orm";
import { bookings } from "@/db/schema";

/** A booking found by either of its gallery links: the client's (galleryToken) or the share one (shareToken). */
export function byGalleryToken(token: string) {
  return or(eq(bookings.galleryToken, token), eq(bookings.shareToken, token));
}
