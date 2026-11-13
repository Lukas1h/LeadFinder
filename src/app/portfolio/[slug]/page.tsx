import { notFound } from "next/navigation";
import { after } from "next/server";
import { headers } from "next/headers";
import type { Metadata, Viewport } from "next";
import { Noto_Serif, Outfit } from "next/font/google";
import { db } from "@/db";
import { agents, bookings, portfolioLinks, type PortfolioContent, type PortfolioListing } from "@/db/schema";
import { eq, inArray, sql } from "drizzle-orm";
import { Suspense } from "react";
import { listingCardPhotoNames } from "@/lib/listingCardPhotos";
import { notifyPortfolioView } from "@/lib/push";
import { PORTFOLIO_ORIGIN } from "@/lib/siteUrls";
import { LUKAS_PHONE as PHONE } from "@/lib/agentVcard";
import { parseUserAgent } from "@/lib/galleryViews";
import { AGENT_PAGE_PHOTOS, AGENT_PAGE_VIDEOS, LUKAS_PHOTO, isPortlandArea, type AgentPagePhoto, type AgentPageVideoKey } from "@/lib/agentPage";
import { BeforeAfterSlider, ListingCard, LoopVideo, MutableVideo } from "./client";
import { PageTracker } from "./tracker";

// Same reasoning as the gallery route: a fresh navigation from outside the
// app, not an in-app tab switch, so there's no "instant" shell to preserve.
export const instant = false;

// Same brand pairing as the main site and the client gallery: Noto Serif for
// headings, Outfit for everything else.
const notoSerif = Noto_Serif({
  subsets: ["latin"],
  weight: ["400", "700"],
  style: ["normal", "italic"],
  variable: "--font-portfolio-serif",
});
const outfit = Outfit({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-portfolio-sans",
});

const SITE = PORTFOLIO_ORIGIN;

/** White browser chrome (Safari's top bar) instead of the admin app's dark theme color. */
export const viewport: Viewport = { themeColor: "#ffffff" };

/**
 * The link preview (iMessage, Facebook…): the page's lead portfolio photo,
 * the same generic image for every link. It used to show the agent's own
 * before/after or a photo of their town; Lukas went back to generic
 * (2026-10-26) so a preview never shows their listing before the page does.
 * An area template can set its own (content.ogImage, e.g. a drone shot of the
 * town). Absolute URL: crawlers don't resolve relative og:image paths.
 */
function previewImage(c: PortfolioContent | undefined): string {
  const src = c?.ogImage || (AGENT_PAGE_PHOTOS.find((p) => p.key === c?.leadPhoto) ?? AGENT_PAGE_PHOTOS[0]).src;
  return src.startsWith("http") ? src : `${SITE}${src}`;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const [link] = await db.select({ content: portfolioLinks.content }).from(portfolioLinks).where(eq(portfolioLinks.slug, slug));
  const c = link?.content;
  const area = c?.area?.trim() || "Eugene";
  const title = `Real estate photo & video in ${area} | Hahn Media`;
  const description = "Cinematic media that sells listings quicker.";
  const images = [previewImage(c)];
  return {
    title,
    description,
    openGraph: { title, description, siteName: "Hahn Media", images },
    twitter: { card: "summary_large_image", title, description, images },
  };
}


const serif = "font-[family-name:var(--font-portfolio-serif)]";

/**
 * A personalized agent page — Lukas's "Hahn Media Agent Page" design — sent
 * in place of the samples email's attachment (mainly for cold outreach).
 * The portfolio photos, videos and pricing are fixed (lib/agentPage.ts); the
 * link's content picks the area, video, lead photo, before/after, a first
 * name for the sign-off, and which of Lukas's own jobs show as listings
 * (src/app/portfolio-links).
 *
 * Public, no login — the slug is the only access control, same spirit as
 * the client gallery's token.
 */
export default async function PortfolioPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ preview?: string }>;
}) {
  const { slug } = await params;
  // ?preview=1 is Lukas checking a link himself (the builder's and list's Open buttons): no view, no push, no tracking.
  // A link-preview fetcher (iMessage drawing the card when the link is texted) isn't the agent opening it either.
  const preview = (await searchParams).preview === "1" || parseUserAgent((await headers()).get("user-agent")).isPreview;
  const [link] = await db.select().from(portfolioLinks).where(eq(portfolioLinks.slug, slug));
  if (!link) notFound();
  const c = link.content;

  if (!preview)
    after(async () => {
      await db
        .update(portfolioLinks)
        .set({
          viewCount: sql`${portfolioLinks.viewCount} + 1`,
          firstViewedAt: sql`coalesce(${portfolioLinks.firstViewedAt}, now())`,
          lastViewedAt: new Date(),
        })
        .where(eq(portfolioLinks.id, link.id));
      const agentName = link.agentId
        ? ((await db.select({ name: agents.name }).from(agents).where(eq(agents.id, link.agentId)))[0]?.name ?? null)
        : null;
      await notifyPortfolioView(link.id, agentName, link.viewCount + 1).catch((err) => console.error("portfolio view push failed", err));
    });

  const area = c.area?.trim() || "Eugene";
  const firstName = c.agentFirstName?.trim() || "";
  const brokerage = c.brokerage?.trim() || "";
  const video = AGENT_PAGE_VIDEOS[(c.video ?? "summit") as AgentPageVideoKey] ?? AGENT_PAGE_VIDEOS.summit;
  const showOffer = c.showOffer ?? true;
  const showTour = c.showTourOfHomes ?? true;
  // Off for every link made before 2026-11-12: those pages stay exactly as they were sent.
  const newStyle = c.newStyle ?? false;

  // The closing full-width photo stays put; the lead photo jumps to the front of the rest.
  const closing = AGENT_PAGE_PHOTOS[AGENT_PAGE_PHOTOS.length - 1];
  const photos = AGENT_PAGE_PHOTOS.slice(0, -1);
  const lead = photos.findIndex((p) => p.key === c.leadPhoto);
  if (lead > 0) photos.unshift(photos.splice(lead, 1)[0]);
  photos.push(closing);

  // Only with an after photo; no before = the after shown dulled as its own "before".
  const afterSrc = c.beforeAfter ? c.afterSrc?.trim() : null;
  const beforeSrc = c.beforeSrc?.trim() || null;
  const ba = afterSrc ? { after: afterSrc, before: beforeSrc ?? afterSrc, dulled: !beforeSrc } : null;
  // A big hero (before/after, else the video), a row of photos under it, then
  // with a before/after the video as a second hero and more photos. Each grid
  // only ever shows full rows — see PhotoGrid.
  const gridTop = ba ? photos.slice(0, 4) : [];
  const gridBottom = ba ? photos.slice(4, 10) : photos.slice(0, 6);
  const featureLast = ba ? null : photos[photos.length - 1];
  const listings = c.listings ?? [];

  const who = firstName ? `this is ${firstName}${brokerage ? ` with ${brokerage}` : ""}. ` : "";
  const bookHref = `sms:${PHONE}?&body=` + encodeURIComponent(`Hi Lukas, ${who}I'd like to book a shoot for a listing in ${area}.`);

  const whySection = (
        <section data-section="why" className="px-4 pt-[clamp(56px,8vw,88px)]">
          <div
            className={`mx-auto grid max-w-[1040px] grid-cols-1 text-center ${
              newStyle ? "gap-px bg-[#181A1C]/10 md:grid-cols-2 lg:grid-cols-4" : "bg-[#F9F4F1] md:grid-cols-3"
            }`}
          >
            {(newStyle ? NEW_TILES : CLASSIC_TILES).map((f, i) => (
              <div
                key={f.title}
                className={`px-[clamp(24px,3vw,36px)] py-[30px] ${
                  newStyle ? "bg-[#F9F4F1]" : i > 0 ? "border-t border-[#181A1C]/10 md:border-t-0 md:border-l" : ""
                }`}
              >
                <h3 className={`${serif} text-[21px] font-bold`}>{f.title}</h3>
                <p className="mt-2 text-base leading-[1.55] text-pretty text-[#181A1C]/78">{f.body}</p>
              </div>
            ))}
          </div>
        </section>

  );
  const pricingSection = (
        <section id="pricing" data-section="pricing" className="px-4 pt-[clamp(44px,6vw,64px)]">
          <div className="mx-auto max-w-[672px]">
            <h2 className={`${serif} text-center text-[clamp(30px,4vw,40px)] font-bold tracking-[-0.02em]`}>Pricing</h2>
            <PhotoPackage />
            <div className="mt-6 border-t border-[#181A1C]/15">
              <PriceRow name="Walkthrough Video" price="$400" />
              <PriceRow name="Photo + Video + Drone" price="$650" />
            </div>
          </div>
        </section>
  );

  return (
    <div
      className={`${notoSerif.variable} ${outfit.variable} min-h-screen scroll-smooth bg-white font-[family-name:var(--font-portfolio-sans)] text-[#181A1C] antialiased`}
    >
      <header className="sticky top-0 z-50 border-b border-[#181A1C]/10 bg-white/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1152px] items-center justify-between gap-4 px-[clamp(16px,3vw,24px)] py-5">
          <a href="#top" className="flex flex-col leading-none text-[#181A1C]">
            <span className={`${serif} text-[clamp(24px,3vw,30px)] font-bold tracking-[-0.025em]`}>Hahn Media</span>
            <span className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.3em] text-[#181A1C]/70">
              Real Estate Photo &amp; Video
            </span>
          </a>
          <a
            href={`/api/portfolio/${slug}/vcard`}
            data-track="save_contact"
            data-track-detail="header"
            className="inline-flex min-h-11 items-center whitespace-nowrap border border-[#181A1C] px-[22px] text-xs font-medium uppercase tracking-[0.3em] text-[#181A1C] hover:bg-[#181A1C] hover:text-white"
          >
            Save contact
          </a>
        </div>
      </header>

      <main id="top">
        {/* Hero */}
        {newStyle ? (
          <section data-section="hero" className="px-4 pt-[clamp(20px,3vw,32px)] pb-[clamp(20px,3vw,28px)] text-center">
            <div className="mx-auto flex max-w-[760px] flex-col items-center">
              <h1 className={`${serif} text-[clamp(34px,5.6vw,58px)] font-bold leading-[1.1] tracking-[-0.02em] text-balance`}>
                Real estate photo &amp; video in <span className="text-[#D67F1F]">{area}</span>
              </h1>
              {showTour && (
                <p className="mt-3 text-[clamp(14px,1.8vw,16px)] font-semibold uppercase tracking-[0.18em] text-[#995000]">Featured in the Eugene Tour of Homes</p>
              )}
            </div>
          </section>
        ) : (
          <>
        <section data-section="hero" className="px-4 pt-[clamp(32px,5vw,56px)] pb-[clamp(28px,4vw,40px)] text-center">
          <div className="mx-auto flex max-w-[760px] flex-col items-center">
            {showTour && (
              <p className="mb-3.5 text-[13px] font-medium uppercase tracking-[0.2em] text-[#995000]">
                Featured in the Eugene Tour of Homes
              </p>
            )}
            <h1 className={`${serif} text-[clamp(34px,5.6vw,58px)] font-bold leading-[1.1] tracking-[-0.02em] text-balance`}>
              Real estate photo &amp; video in <span className="text-[#D67F1F]">{area}</span>
            </h1>
            <p className="mt-4 text-[clamp(17px,2vw,20px)] text-[#181A1C]/75">Cinematic media that sells listings quicker.</p>
            {!newStyle && showOffer && (
              <a
                href={bookHref}
                data-track="book_shoot"
                data-track-detail="$50 off (top)"
                className="mt-5 inline-flex items-baseline gap-2.5 bg-[#F9F4F1] px-5 py-2.5 text-[#181A1C] hover:bg-[#F3EAE3]"
              >
                <span className={`${serif} text-base font-bold text-[#D67F1F]`}>$50 off</span>
                <span className="text-base font-medium">your first shoot</span>
              </a>
            )}
            <p className="mt-4 max-w-[420px] text-[15px] leading-[1.5] text-pretty text-[#181A1C]/72">
              <span className="font-semibold text-[#181A1C]">Every shoot guaranteed.</span> Not happy with the images? I reshoot at no cost.
            </p>
          </div>
        </section>

          </>
        )}

        {/* Portfolio */}
        <section id="portfolio" className="px-4">
          <div className="mx-auto max-w-[1040px]">
            {ba && (
              <>
                <div data-section="before_after" className="relative aspect-[3/2] w-full overflow-hidden bg-[#F9F4F1]">
                  <BeforeAfterSlider before={ba.before} after={ba.after} dulled={Boolean(ba.dulled)} />
                  <span className="pointer-events-none absolute top-2.5 left-2.5 bg-white/92 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] sm:top-4 sm:left-4 sm:px-3 sm:py-1.5 sm:text-xs">
                    Before
                  </span>
                  <span className="pointer-events-none absolute top-2.5 right-2.5 bg-white/92 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] sm:top-4 sm:right-4 sm:px-3 sm:py-1.5 sm:text-xs">
                    After
                  </span>
                  <div
                    className={`${serif} pointer-events-none absolute right-2.5 bottom-2.5 max-w-[calc(100%-20px)] bg-white/94 px-2.5 py-1.5 text-xs font-bold leading-[1.3] sm:right-4 sm:bottom-4 sm:max-w-[calc(100%-32px)] sm:px-[18px] sm:py-3 sm:text-[clamp(15px,1.8vw,19px)]`}
                  >
                    Quick edit of what your listing could look like
                  </div>
                </div>
                {!newStyle && <PhotoGrid photos={gridTop} desktopRows={1} className="mt-2 sm:mt-3" />}
                <div className="h-2 sm:h-3" />
              </>
            )}
            <div data-section="video">
              {newStyle ? <LoopVideo src={video.mp4} poster={video.poster} title={video.title} /> : <MutableVideo id={video.id} title={video.title} />}
            </div>
            {newStyle ? (
              <FullGallery />
            ) : (
              <PhotoGrid photos={gridBottom} desktopRows={2} className="mt-2 sm:mt-3" />
            )}
            {!newStyle && featureLast && (
              // eslint-disable-next-line @next/next/no-img-element -- static sample photo
              <img
                src={featureLast.src}
                alt={featureLast.alt}
                loading="lazy"
                data-section="photos"
                className="mt-2 aspect-[3/2] w-full bg-[#F9F4F1] object-cover sm:mt-3"
              />
            )}
          </div>
        </section>

        {!newStyle && whySection}

        {/* Recent listings */}
        {listings.length > 0 && (
          <section data-section="listings" className={`px-4 ${newStyle ? "pt-[clamp(56px,8vw,88px)]" : "pt-[clamp(64px,9vw,104px)]"}`}>
            <div className="mx-auto max-w-[1040px]">
              <h2 className={`${serif} mb-[clamp(32px,5vw,48px)] text-center text-[clamp(30px,4vw,40px)] font-bold tracking-[-0.02em]`}>
                Recent listings near {area}
              </h2>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] gap-4">
                {/* The cards' photos come from Dropbox, so they stream in after the rest of the page. */}
                <Suspense fallback={listings.map((l) => <ListingCard key={l.bookingId} listing={{ ...l, photos: [] }} prominentStatus={newStyle} />)}>
                  <ListingCards slug={slug} listings={listings} prominentStatus={newStyle} />
                </Suspense>
              </div>
            </div>
          </section>
        )}


        {newStyle && whySection}

        {/* Testimonial */}
        <section data-section="testimonial" className="mt-[clamp(40px,6vw,64px)] bg-[#F9F4F1] px-4 py-[clamp(32px,5vw,52px)]">
          <figure className="mx-auto max-w-[720px] text-center">
            <div className="text-[26px] leading-none tracking-[0.12em] text-[#D67F1F]" role="img" aria-label="5 out of 5 stars">
              ★★★★★
            </div>
            <blockquote className={`${serif} mt-4 text-[clamp(20px,2.5vw,26px)] leading-[1.5] font-normal text-pretty`}>
              <p>
                “I can’t recommend Lukas enough! <strong className="font-bold">The photos for my listing were amazing</strong>, and he went
                above and beyond. <strong className="font-bold">A talented and dependable photographer.</strong>”
              </p>
            </blockquote>
            <figcaption className="mt-5 flex flex-col items-center gap-1">
              <span className="text-[clamp(20px,2.4vw,22px)] font-bold">Serenity Thompson</span>
              <span className="text-sm font-semibold uppercase tracking-[0.18em] text-[#995000]">Oregon Live Homes</span>
              <a
                href="https://maps.app.goo.gl/WMhhHxSnYozHLfBP8"
                target="_blank"
                rel="noopener"
                data-track="reviews"
                className="mt-2.5 border-b border-[#995000]/35 pb-0.5 text-sm text-[#995000] hover:text-[#D67F1F]"
              >
                Read more reviews on Google
              </a>
            </figcaption>
          </figure>
        </section>


        {pricingSection}

        <SaveContact slug={slug} firstName={firstName} showOffer={showOffer} />
      </main>
      {!preview && <PageTracker slug={slug} />}

      <footer className="border-t border-[#181A1C]/10 px-4 py-7">
        <div className="mx-auto flex max-w-[1152px] flex-wrap justify-between gap-x-6 gap-y-2 text-[13px] text-[#181A1C]/62">
          <span>Hahn Media · Lukas Hahn</span>
          <span>{isPortlandArea(c.area) ? "Portland, Oregon" : "Eugene & Roseburg, Oregon"}</span>
        </div>
      </footer>
    </div>
  );
}

/** Each card with its photos (lib/listingCardPhotos.ts), served through the slug-scoped photo route. */
async function ListingCards({ slug, listings, prominentStatus }: { slug: string; listings: PortfolioListing[]; prominentStatus: boolean }) {
  const rows = await db
    .select({ id: bookings.id, link: bookings.dropboxFolderLink, highlights: bookings.highlightPhotos })
    .from(bookings)
    .where(inArray(bookings.id, listings.map((l) => l.bookingId)));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const cards = await Promise.all(
    listings.map(async (l) => {
      const row = byId.get(l.bookingId);
      const names = row?.link ? await listingCardPhotoNames(row.link, row.highlights).catch(() => []) : [];
      return {
        ...l,
        photos: names.map((name) => `/api/portfolio/${slug}/listing-photo?bookingId=${l.bookingId}&name=${encodeURIComponent(name)}`),
      };
    })
  );
  return cards.map((l) => <ListingCard key={l.bookingId} listing={l} prominentStatus={prominentStatus} />);
}

/**
 * Two columns by two rows below lg, three columns by `desktopRows` from lg up
 * — photos past what fills those rows are hidden at that size, so a grid never
 * ends on a half-empty row.
 */
function PhotoGrid({ photos, desktopRows, className }: { photos: AgentPagePhoto[]; desktopRows: number; className?: string }) {
  if (photos.length === 0) return null;
  const small = 4;
  const large = 3 * desktopRows;
  return (
    <div data-section="photos" className={`grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-3 ${className ?? ""}`}>
      {photos.slice(0, Math.max(small, large)).map((p, i) => {
        const visibility = i >= small && i < large ? "hidden lg:block" : i < small && i >= large ? "lg:hidden" : "";
        return (
          // eslint-disable-next-line @next/next/no-img-element -- static sample photo
          <img
            key={p.key}
            src={p.src}
            alt={p.alt}
            loading="lazy"
            className={`aspect-[3/2] w-full bg-[#F9F4F1] object-cover ${visibility}`}
          />
        );
      })}
    </div>
  );
}

function PriceRow({ name, price }: { name: string; price: string }) {
  return (
    <div className="flex items-baseline justify-between gap-6 border-b border-[#181A1C]/15 px-1 py-6">
      <p className="text-lg">{name}</p>
      <p className="font-[family-name:var(--font-portfolio-serif)] whitespace-nowrap text-[26px] font-bold">{price}</p>
    </div>
  );
}

/** The original page's three tiles. */
const CLASSIC_TILES = [
  {
    title: "Quick turnaround",
    body: (
      <>
        Shot within a day or two of booking. Photos delivered in <b>24 hours</b>.
      </>
    ),
  },
  {
    title: "Edited by hand, not AI",
    body: (
      <>
        Every photo is edited in house by a <b>real person</b>.
      </>
    ),
  },
  {
    title: "Licensed and insured",
    body: (
      <>
        <b>FAA Part 107</b> certified drone pilot, fully <b>insured</b>. Your listing and your brokerage are covered.
      </>
    ),
  },
];

/** The new style's tiles: what an agent gets, not what Lukas does. */
const NEW_TILES = [
  {
    title: "Get your photos scheduled for tomorrow",
    body: (
      <>
        Usually free <b>same or next day</b>, so a booked-up photographer never holds your listing back.
      </>
    ),
  },
  {
    title: "In and out in as little as 45 minutes",
    body: (
      <>
        Barely an interruption for your sellers. <b>Next morning turnaround.</b>
      </>
    ),
  },
  {
    title: "Real edits, no AI",
    body: (
      <>
        Every photo edited by hand by a <b>real person</b>.
      </>
    ),
  },
  {
    title: "Licensed and insured",
    body: (
      <>
        <b>FAA Part 107</b> certified drone pilot, fully <b>insured</b>. Your listing and your brokerage are covered.
      </>
    ),
  },
];

/**
 * Pricing lead: the photo package as the headline offer. Pricing is the most
 * read part of the page, so the two biggest selling points (hand editing and
 * next-morning delivery) sit right under the name; add-ons are price + name.
 */
function PhotoPackage() {
  const perks = ["Edited by hand, not AI", "Next morning turnaround"];
  const addOns = [
    { price: "+$100", name: "Aerial drone photography" },
    { price: "+$50", name: "Floor plans" },
    { price: "+$50", name: "Virtual staging" },
    { price: "+$50", name: "Virtual twilight" },
  ];
  return (
    <div className="relative mt-[clamp(32px,4vw,44px)] border-2 border-[#D67F1F] px-[clamp(20px,3vw,32px)] pt-8 pb-[clamp(20px,3vw,28px)]">
      <span className="absolute -top-3.5 left-[clamp(20px,3vw,32px)] bg-[#D67F1F] px-3 py-1 text-xs font-bold uppercase tracking-[0.16em] text-white">
        Most booked
      </span>
      <div className="flex items-start justify-between gap-6">
        <div>
          <p className="text-[clamp(20px,2.4vw,24px)] font-semibold leading-tight">Interior &amp; Exterior Photography</p>
          <ul className="mt-2.5 list-disc space-y-1 pl-5 text-[clamp(16px,1.9vw,18px)] font-semibold leading-snug text-[#995000] marker:text-[#D67F1F]">
            {perks.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
        <p className="font-[family-name:var(--font-portfolio-serif)] whitespace-nowrap text-[clamp(34px,4.4vw,42px)] font-bold leading-none text-[#D67F1F]">$300</p>
      </div>
      <p className="mt-6 text-xs font-semibold uppercase tracking-[0.16em] text-[#181A1C]/62">Add-ons</p>
      <div className="mt-2.5 grid grid-cols-2 gap-2.5">
        {addOns.map((a) => (
          <div key={a.name} className="bg-[#F9F4F1] px-3.5 py-3">
            <p className="font-[family-name:var(--font-portfolio-serif)] text-[20px] font-bold leading-none text-[#D67F1F]">{a.price}</p>
            <p className="mt-1.5 text-[15px] font-semibold leading-snug">{a.name}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * New-style pages: the portfolio photos under the full-width video — a grid
 * of eight (two columns on a phone, four on desktop, so rows are always full),
 * the lead photo (pf-01) full width, a second grid of eight, and one
 * full-width photo to close. Never a big photo straight under the video and
 * never two big ones stacked, so the list's last two photos are left out. Uses
 * AGENT_PAGE_PHOTOS in its own order; the per-link lead photo doesn't apply.
 */
function FullGallery() {
  const p = AGENT_PAGE_PHOTOS;
  const wide = (photo: AgentPagePhoto) => (
    // eslint-disable-next-line @next/next/no-img-element -- static portfolio photo
    <img key={photo.key} src={photo.src} alt={photo.alt} loading="lazy" className="mt-2 aspect-[3/2] w-full bg-[#F9F4F1] object-cover sm:mt-3" />
  );
  const grid = (photos: AgentPagePhoto[]) => (
    <div className="mt-2 grid grid-cols-2 gap-2 sm:mt-3 sm:gap-3 lg:grid-cols-4">
      {photos.map((photo) => (
        // eslint-disable-next-line @next/next/no-img-element -- static portfolio photo
        <img key={photo.key} src={photo.src} alt={photo.alt} loading="lazy" className="aspect-[3/2] w-full bg-[#F9F4F1] object-cover" />
      ))}
    </div>
  );
  return (
    <div data-section="photos">
      {grid(p.slice(1, 9))}
      {wide(p[0])}
      {grid(p.slice(10, 18))}
      {wide(p[9])}
    </div>
  );
}

/**
 * The page's last section: one job, getting the agent to save Lukas's
 * contact. The personal thank-you, the reason to save tied to a moment
 * they'll have ("for when your next listing comes up"), the button, and a
 * preview of the contact card so the outcome is tangible.
 */
function SaveContact({ slug, firstName, showOffer }: { slug: string; firstName: string | null; showOffer: boolean }) {
  return (
    <section id="save" data-section="book" className="px-4 pt-[clamp(64px,9vw,104px)] pb-[clamp(80px,11vw,128px)]">
      <div className="mx-auto flex max-w-[560px] flex-col items-center text-center">
        <h2 className="font-[family-name:var(--font-portfolio-serif)] text-[clamp(28px,4vw,38px)] font-bold leading-[1.15] tracking-[-0.02em] text-balance">
          {firstName ? `Thanks for taking a look, ${firstName}!` : "Thanks for taking a look!"}
        </h2>
        <p className="mt-3 text-[17px] leading-[1.55] text-pretty text-[#181A1C]/78">Save my contact for when your next listing comes up.</p>
        <a
          href={`/api/portfolio/${slug}/vcard`}
          data-track="save_contact"
          data-track-detail="bottom"
          className="mt-7 inline-flex min-h-14 w-full max-w-[380px] items-center justify-center border border-[#181A1C] bg-[#181A1C] px-8 text-[14px] font-medium uppercase tracking-[0.3em] text-white hover:bg-white hover:text-[#181A1C]"
        >
          Save my contact
        </a>
        <div className="mt-4 flex w-full max-w-[380px] items-center gap-4 border border-[#181A1C]/12 bg-white px-5 py-4 text-left shadow-[0_6px_24px_rgba(0,0,0,0.08)]">
          {LUKAS_PHOTO ? (
            // eslint-disable-next-line @next/next/no-img-element -- static headshot
            <img src={LUKAS_PHOTO} alt="Lukas Hahn" className="size-14 shrink-0 rounded-full object-cover" />
          ) : (
            <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-[#D67F1F] text-xl font-semibold text-white">LH</span>
          )}
          <div className="min-w-0">
            <p className="text-lg font-semibold leading-tight">Lukas Hahn</p>
            <p className="mt-0.5 text-sm text-[#181A1C]/70">Hahn Media · Real estate photo &amp; video</p>
            <p className="mt-0.5 text-sm text-[#181A1C]/70">{formatPhone(PHONE)}</p>
          </div>
        </div>
        {showOffer && <p className="mt-4 text-sm font-semibold text-[#995000]">Your first shoot is $50 off.</p>}
      </div>
    </section>
  );
}

/** "+15414303372" → "(541) 430-3372". */
function formatPhone(e164: string): string {
  const d = e164.replace(/\D/g, "").slice(-10);
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}
