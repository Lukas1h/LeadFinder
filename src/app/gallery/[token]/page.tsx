import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Download, ImageOff } from "lucide-react";
import { db } from "@/db";
import { bookings, listings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { listGalleryPhotos, dropboxZipDownloadUrl } from "@/lib/dropbox";

// The root layout's MobileHeader/BottomTabBar read usePathname(), which
// can't be prerendered into an instant static shell for a dynamic [token]
// segment with no known params ahead of time — this is the app's first
// dynamic page route, so the first to hit that. Allowing this segment to
// block is correct here anyway: a client opening their gallery link is a
// fresh navigation from outside the app, not an in-app tab switch, so
// there's no "instant" navigation to preserve.
export const instant = false;

/**
 * Public, no-login client-facing gallery — the URL itself (an unguessable
 * galleryToken, not this booking's own id) is the only access control, same
 * spirit as the invoice/vcard routes' plain-link simplicity. Deliberately
 * reads only address + the Dropbox link, never the booking's line items,
 * lockbox code, or notes — those stay in the app, not on a link that gets
 * texted to a client.
 */
async function getGalleryBooking(token: string) {
  const [booking] = await db
    .select({
      address: bookings.address,
      city: bookings.city,
      state: bookings.state,
      listingId: bookings.listingId,
      dropboxFolderLink: bookings.dropboxFolderLink,
    })
    .from(bookings)
    .where(eq(bookings.galleryToken, token));
  if (!booking) return null;

  // Same "prefer the linked listing's own fields" resolution as
  // BookingWithDetails elsewhere — a listing-linked booking's own
  // address/city/state columns are null, the listing is the source of truth.
  const [linkedListing] = booking.listingId
    ? await db
        .select({ address: listings.address, city: listings.city, state: listings.state })
        .from(listings)
        .where(eq(listings.id, booking.listingId))
    : [];

  return {
    dropboxFolderLink: booking.dropboxFolderLink,
    address: linkedListing?.address ?? booking.address,
    city: linkedListing?.city ?? booking.city,
    state: linkedListing?.state ?? booking.state,
  };
}

function formatLocation(booking: { address: string | null; city: string | null; state: string | null }): string {
  return [booking.address, booking.city, booking.state].filter(Boolean).join(", ") || "Photo gallery";
}

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const booking = await getGalleryBooking(token);
  return { title: booking ? formatLocation(booking) : "Photo Gallery" };
}

export default async function GalleryPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const booking = await getGalleryBooking(token);
  if (!booking) notFound();

  const location = formatLocation(booking);

  if (!booking.dropboxFolderLink) {
    return (
      <main className="max-w-2xl mx-auto px-6 py-20 text-center">
        <h1 className="text-xl font-semibold text-foreground">{location}</h1>
        <p className="mt-3 text-muted-foreground">Photos aren&rsquo;t ready yet — check back soon.</p>
      </main>
    );
  }

  const photos = await listGalleryPhotos(booking.dropboxFolderLink);
  const downloadAllUrl = dropboxZipDownloadUrl(booking.dropboxFolderLink);

  return (
    <main className="max-w-5xl mx-auto px-6 py-10 flex flex-col gap-8">
      <header className="flex flex-col items-center text-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{location}</h1>
        <p className="text-sm text-muted-foreground">
          {photos.length} photo{photos.length === 1 ? "" : "s"}
        </p>
        {photos.length > 0 && (
          <a
            href={downloadAllUrl}
            className="mt-3 inline-flex items-center gap-2 rounded-md bg-foreground text-background px-4 py-2.5 text-sm font-medium hover:opacity-90 transition-opacity"
          >
            <Download className="size-4" />
            Download all (.zip)
          </a>
        )}
      </header>

      {photos.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 text-center py-16 text-muted-foreground">
          <ImageOff className="size-8" />
          <p>No photos yet — check back soon.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {photos.map((photo) => {
            const thumbUrl = `/api/gallery/${token}/thumbnail?name=${encodeURIComponent(photo.name)}&size=w640h480`;
            const fullUrl = `/api/gallery/${token}/thumbnail?name=${encodeURIComponent(photo.name)}&size=w2048h1536`;
            return (
              <a
                key={photo.name}
                href={fullUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block aspect-square overflow-hidden rounded-lg border border-border bg-muted"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- proxied Dropbox photo, not a static/optimizable local asset */}
                <img src={thumbUrl} alt={photo.name} loading="lazy" className="w-full h-full object-cover" />
              </a>
            );
          })}
        </div>
      )}
    </main>
  );
}
