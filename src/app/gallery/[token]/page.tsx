import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { after } from "next/server";
import type { Metadata } from "next";
import { Noto_Serif, Outfit } from "next/font/google";
import { CheckCircle2, CreditCard, Download, ImageOff, Receipt } from "lucide-react";
import { db } from "@/db";
import { bookings, bookingLineItems, listings, agents } from "@/db/schema";
import { eq, sum } from "drizzle-orm";
import { listGalleryMedia } from "@/lib/dropbox";
import { firstName } from "@/lib/sms";
import { recordGalleryEvent } from "@/lib/galleryViews";
import { GalleryPhoto } from "./GalleryPhoto";

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
 * reads only address, the Dropbox link, the contact's first name (for the
 * greeting note), and the invoice number (itself already a plain, ungated
 * link elsewhere — see the invoice route) — never line items, lockbox
 * code, or other notes. Those stay in the app, not on a link that gets
 * texted to a client.
 */
async function getGalleryBooking(token: string) {
  const [booking] = await db
    .select({
      id: bookings.id,
      address: bookings.address,
      city: bookings.city,
      state: bookings.state,
      listingId: bookings.listingId,
      contactAgentId: bookings.contactAgentId,
      dropboxFolderLink: bookings.dropboxFolderLink,
      invoiceNumber: bookings.invoiceNumber,
      paymentLinkUrl: bookings.paymentLinkUrl,
      paymentLinkAmount: bookings.paymentLinkAmount,
      paidAt: bookings.paidAt,
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

  const [contact] = booking.contactAgentId
    ? await db.select({ name: agents.name }).from(agents).where(eq(agents.id, booking.contactAgentId))
    : [];

  // A link made for an older total stays hidden until a new one is made, so a
  // client is never asked to pay the wrong amount.
  const [{ total }] = await db
    .select({ total: sum(bookingLineItems.amount).mapWith(Number) })
    .from(bookingLineItems)
    .where(eq(bookingLineItems.bookingId, booking.id));
  const paymentLinkUrl =
    booking.paymentLinkUrl && booking.paymentLinkAmount === (total ?? 0) ? booking.paymentLinkUrl : null;

  return {
    id: booking.id,
    paymentLinkUrl,
    paidAt: booking.paidAt,
    dropboxFolderLink: booking.dropboxFolderLink,
    invoiceNumber: booking.invoiceNumber,
    contactName: contact?.name ?? null,
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

/** Wraps every branch below (found/not-ready/empty/full) so the fonts, header, and greeting always match. */
function GalleryShell({ greeting, children }: { greeting: string; children: React.ReactNode }) {
  return (
    <div className={`${notoSerif.variable} ${outfit.variable} min-h-screen bg-white`}>
      <main className="max-w-5xl mx-auto px-6 py-12 flex flex-col items-center gap-2 font-[family-name:var(--font-gallery-sans)] text-[#181A1C]">
        <div className="font-[family-name:var(--font-gallery-serif)] font-bold text-4xl sm:text-5xl tracking-tight">Hahn Media</div>
        <div className="text-xs uppercase tracking-[0.3em] text-[#181A1C]/70">Real Estate Photo &amp; Video</div>
        <div className="w-full h-px bg-[#181A1C]/10 my-6" />
        <p className="italic text-sm text-[#181A1C]/70 text-center max-w-md mb-6">{greeting}</p>
        {children}
      </main>
    </div>
  );
}

/**
 * One video: the native player (streams and seeks from Dropbox via the video
 * route's direct link) plus its own download, so nobody needs the whole zip
 * for one clip. The poster is Dropbox's thumbnail of the video; "#t=0.1"
 * makes iOS paint the first frame if that thumbnail isn't available.
 */
function GalleryVideo({ token, name }: { token: string; name: string }) {
  const src = `/api/gallery/${token}/video?name=${encodeURIComponent(name)}`;
  const poster = `/api/gallery/${token}/thumbnail?name=${encodeURIComponent(name)}&size=w2048h1536`;
  return (
    <div className="flex flex-col gap-2">
      <video
        controls
        playsInline
        preload="metadata"
        poster={poster}
        src={`${src}#t=0.1`}
        className="w-full aspect-video rounded-lg border border-[#181A1C]/10 bg-black"
      />
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-[#181A1C]/70 truncate">{name.replace(/\.[^.]+$/, "")}</span>
        <a
          href={`${src}&download=1`}
          className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-[#181A1C]/15 px-4 py-2 text-sm font-semibold hover:bg-[#F9F4F1] transition-colors"
        >
          <Download className="size-4" />
          Download video
        </a>
      </div>
    </div>
  );
}

function InvoiceLink({ bookingId }: { bookingId: string }) {
  return (
    <a
      href={`/api/bookings/${bookingId}/invoice`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-2 rounded-lg border border-[#181A1C]/15 px-5 py-2.5 text-sm font-semibold hover:bg-[#F9F4F1] transition-colors"
    >
      <Receipt className="size-4" />
      View invoice
    </a>
  );
}

/**
 * "Pay online" for an open Stripe payment link, or a thank-you once paid.
 * ?paid=1 is where Stripe sends the client back after paying, which can beat
 * the webhook that sets paidAt.
 */
function PayOnline({ url, paid }: { url: string | null; paid: boolean }) {
  if (paid) {
    return (
      <span className="inline-flex items-center gap-2 px-2 py-2.5 text-sm font-semibold text-green-700">
        <CheckCircle2 className="size-4" />
        Paid, thank you!
      </span>
    );
  }
  if (!url) return null;
  return (
    <a
      href={url}
      className="inline-flex items-center gap-2 rounded-lg bg-[#181A1C] text-white px-5 py-2.5 text-sm font-semibold hover:opacity-90 transition-opacity"
    >
      <CreditCard className="size-4" />
      Pay online
    </a>
  );
}

export default async function GalleryPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ paid?: string }>;
}) {
  const { token } = await params;
  const { paid: justPaid } = await searchParams;
  const booking = await getGalleryBooking(token);
  if (!booking) notFound();

  // Shown in the booking's detail dialog — who opened it, when, on what.
  const requestHeaders = new Headers(await headers());
  after(() => recordGalleryEvent(booking.id, "view", requestHeaders));

  const location = formatLocation(booking);
  const payOnline = <PayOnline url={booking.paymentLinkUrl} paid={Boolean(booking.paidAt) || justPaid === "1"} />;
  const greeting = `Hi ${firstName(booking.contactName) ?? "there"}! Please let me know if there are any edits you'd like made or any angles missing and I'll get it taken care of quickly.`;

  if (!booking.dropboxFolderLink) {
    return (
      <GalleryShell greeting={greeting}>
        <h1 className="text-xl font-semibold text-center">{location}</h1>
        <p className="mt-2 text-[#181A1C]/60 text-center">Photos aren&rsquo;t ready yet — check back soon.</p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
          {payOnline}
          {booking.invoiceNumber && <InvoiceLink bookingId={booking.id} />}
        </div>
      </GalleryShell>
    );
  }

  const { photos, videos } = await listGalleryMedia(booking.dropboxFolderLink);
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const counts = [
    photos.length > 0 || videos.length === 0 ? plural(photos.length, "photo") : null,
    videos.length > 0 ? plural(videos.length, "video") : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const isEmpty = photos.length === 0 && videos.length === 0;

  return (
    <GalleryShell greeting={greeting}>
      <h1 className="text-xl font-semibold text-center">{location}</h1>
      <p className="text-sm text-[#181A1C]/60">{counts}</p>
      <div className="flex flex-wrap items-center justify-center gap-3 mt-3 mb-8">
        {!isEmpty && (
          <a
            // Our route, not a dropbox.com link — see resolveZipDownloadUrl.
            href={`/api/gallery/${token}/download`}
            className="inline-flex items-center gap-2 rounded-lg bg-[#181A1C] text-white px-5 py-2.5 text-sm font-semibold hover:opacity-90 transition-opacity"
          >
            <Download className="size-4" />
            Download all (.zip)
          </a>
        )}
        {payOnline}
        {booking.invoiceNumber && <InvoiceLink bookingId={booking.id} />}
      </div>

      {videos.length > 0 && (
        <div className="w-full flex flex-col gap-6 mb-8">
          {videos.map((video) => (
            <GalleryVideo key={video.name} token={token} name={video.name} />
          ))}
        </div>
      )}

      {isEmpty ? (
        <div className="flex flex-col items-center justify-center gap-3 text-center py-16 text-[#181A1C]/50">
          <ImageOff className="size-8" />
          <p>No photos yet — check back soon.</p>
        </div>
      ) : photos.length > 0 ? (
        <div className="w-full grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {photos.map((photo) => {
            const thumbUrl = `/api/gallery/${token}/thumbnail?name=${encodeURIComponent(photo.name)}&size=w960h640`;
            const fullUrl = `/api/gallery/${token}/thumbnail?name=${encodeURIComponent(photo.name)}&size=w2048h1536`;
            return <GalleryPhoto key={photo.name} thumbUrl={thumbUrl} fullUrl={fullUrl} name={photo.name} />;
          })}
        </div>
      ) : null}

      <footer className="w-full mt-12 pt-6 border-t border-[#181A1C]/10 text-center text-xs text-[#181A1C]/50">
        Lukas Hahn · (541) 430-3372 · lukas@lukashahn.art
      </footer>
    </GalleryShell>
  );
}
