import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Noto_Serif, Outfit } from "next/font/google";
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

// Same brand type pairing as the invoice route (src/app/api/bookings/[id]/invoice/route.ts)
// — Noto Serif for the "Hahn Media" wordmark, Outfit for everything else —
// loaded here instead, since this is a real page (not a raw HTML string
// response) and next/font self-hosts + caches properly.
const notoSerif = Noto_Serif({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-gallery-serif" });
const outfit = Outfit({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-gallery-sans" });

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

/** Wraps every branch below (found/not-ready/empty/full) so the fonts and header always match. */
function GalleryShell({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${notoSerif.variable} ${outfit.variable} min-h-screen bg-white`}>
      <main className="max-w-5xl mx-auto px-6 py-12 flex flex-col items-center gap-2 font-[family-name:var(--font-gallery-sans)] text-[#181A1C]">
        <div className="font-[family-name:var(--font-gallery-serif)] font-bold text-4xl sm:text-5xl tracking-tight">Hahn Media</div>
        <div className="text-xs uppercase tracking-[0.3em] text-[#181A1C]/70">Real Estate Photo &amp; Video</div>
        <div className="w-full h-px bg-[#181A1C]/10 my-6" />
        {children}
      </main>
    </div>
  );
}

export default async function GalleryPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const booking = await getGalleryBooking(token);
  if (!booking) notFound();

  const location = formatLocation(booking);

  if (!booking.dropboxFolderLink) {
    return (
      <GalleryShell>
        <h1 className="text-xl font-semibold text-center">{location}</h1>
        <p className="mt-2 text-[#181A1C]/60 text-center">Photos aren&rsquo;t ready yet — check back soon.</p>
      </GalleryShell>
    );
  }

  const photos = await listGalleryPhotos(booking.dropboxFolderLink);
  const downloadAllUrl = dropboxZipDownloadUrl(booking.dropboxFolderLink);

  return (
    <GalleryShell>
      <h1 className="text-xl font-semibold text-center">{location}</h1>
      <p className="text-sm text-[#181A1C]/60">
        {photos.length} photo{photos.length === 1 ? "" : "s"}
      </p>
      {photos.length > 0 && (
        <a
          href={downloadAllUrl}
          className="mt-3 mb-8 inline-flex items-center gap-2 rounded-lg bg-[#181A1C] text-white px-5 py-2.5 text-sm font-semibold hover:opacity-90 transition-opacity"
        >
          <Download className="size-4" />
          Download all (.zip)
        </a>
      )}

      {photos.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 text-center py-16 text-[#181A1C]/50">
          <ImageOff className="size-8" />
          <p>No photos yet — check back soon.</p>
        </div>
      ) : (
        <div className="w-full grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {photos.map((photo) => {
            const thumbUrl = `/api/gallery/${token}/thumbnail?name=${encodeURIComponent(photo.name)}&size=w640h480`;
            const fullUrl = `/api/gallery/${token}/thumbnail?name=${encodeURIComponent(photo.name)}&size=w2048h1536`;
            return (
              <a
                key={photo.name}
                href={fullUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block aspect-square overflow-hidden rounded-lg border border-[#181A1C]/10 bg-[#F9F4F1]"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- proxied Dropbox photo, not a static/optimizable local asset */}
                <img src={thumbUrl} alt={photo.name} loading="lazy" className="w-full h-full object-cover" />
              </a>
            );
          })}
        </div>
      )}

      <footer className="w-full mt-12 pt-6 border-t border-[#181A1C]/10 text-center text-xs text-[#181A1C]/50">
        Lukas Hahn · (541) 430-3372 · lukas@lukashahn.art
      </footer>
    </GalleryShell>
  );
}
