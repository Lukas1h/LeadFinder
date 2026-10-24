import { notFound } from "next/navigation";
import { after } from "next/server";
import { headers } from "next/headers";
import type { Metadata } from "next";
import { Noto_Serif, Outfit } from "next/font/google";
import { db } from "@/db";
import { agents, portfolioLinks } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { notifyPortfolioView } from "@/lib/push";
import { parseUserAgent } from "@/lib/galleryViews";
import { AGENT_PAGE_PHOTOS, AGENT_PAGE_VIDEOS, type AgentPagePhoto, type AgentPageVideoKey } from "@/lib/agentPage";
import { ListingCard, MutableVideo } from "./client";
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

const SITE = "https://gallery.lukashahn.art";

/**
 * The link preview (iMessage, Facebook…): the page's hero — the before/after's
 * after photo when it has one, else the lead portfolio photo. Absolute URLs:
 * crawlers don't resolve relative og:image paths.
 */
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const [link] = await db.select({ content: portfolioLinks.content }).from(portfolioLinks).where(eq(portfolioLinks.slug, slug));
  const c = link?.content;
  const area = c?.area?.trim() || "Eugene";
  const title = `Real estate photo & video in ${area} | Hahn Media`;
  const description = "Cinematic media that sells listings quicker.";
  const hero = (c?.beforeAfter && c.afterSrc?.trim()) || (AGENT_PAGE_PHOTOS.find((p) => p.key === c?.leadPhoto) ?? AGENT_PAGE_PHOTOS[0]).src;
  const images = [hero.startsWith("http") ? hero : `${SITE}${hero}`];
  return {
    title,
    description,
    openGraph: { title, description, siteName: "Hahn Media", images },
    twitter: { card: "summary_large_image", title, description, images },
  };
}

const PHONE = "+15414303372";
const VCARD = [
  "BEGIN:VCARD",
  "VERSION:3.0",
  "N:Hahn;Lukas;;;",
  "FN:Lukas Hahn",
  "ORG:Hahn Media",
  "TITLE:Real Estate Photo & Video",
  `TEL;TYPE=CELL:${PHONE}`,
  "EMAIL;TYPE=WORK:lukas@lukashahn.art",
  "URL:https://lukashahn.art/real-estate",
  "ADR;TYPE=WORK:;;;Eugene;OR;;USA",
  "NOTE:Real estate photography\\, walkthrough video & drone. Eugene & Roseburg.",
  "END:VCARD",
].join("\r\n");
const VCARD_HREF = "data:text/vcard;charset=utf-8," + encodeURIComponent(VCARD);
const VCARD_NAME = "Lukas Hahn - Hahn Media.vcf";

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
  const listings = (c.listings ?? []).map((l) => ({
    ...l,
    photos: l.photos.map((name) => `/api/portfolio/${slug}/listing-photo?bookingId=${l.bookingId}&name=${encodeURIComponent(name)}`),
  }));

  const who = firstName ? `this is ${firstName}${brokerage ? ` with ${brokerage}` : ""}. ` : "";
  const bookHref = `sms:${PHONE}?&body=` + encodeURIComponent(`Hi Lukas, ${who}I'd like to book a shoot for a listing in ${area}.`);

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
            href={VCARD_HREF}
            download={VCARD_NAME}
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
            {showOffer && (
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
          </div>
        </section>

        {/* Portfolio */}
        <section id="portfolio" className="px-4">
          <div className="mx-auto max-w-[1040px]">
            {ba && (
              <>
                <div data-section="before_after" className="relative aspect-[3/2] w-full overflow-hidden bg-[#F9F4F1]">
                  {/* eslint-disable-next-line @next/next/no-img-element -- before/after overlay */}
                  <img src={ba.after} alt="After editing" className="absolute inset-0 h-full w-full object-cover" />
                  {/* eslint-disable-next-line @next/next/no-img-element -- before/after overlay */}
                  <img
                    src={ba.before}
                    alt="Before editing"
                    className="absolute inset-0 h-full w-full object-cover [clip-path:polygon(0_0,58%_0,42%_100%,0_100%)]"
                    style={
                      ba.dulled
                        ? {
                            filter: "brightness(0.72) saturate(0.55) contrast(0.88) sepia(0.12)",
                          }
                        : undefined
                    }
                  />
                  <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full">
                    <line x1="58" y1="0" x2="42" y2="100" stroke="#ffffff" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                  </svg>
                  <span className="absolute top-2.5 left-2.5 bg-white/92 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] sm:top-4 sm:left-4 sm:px-3 sm:py-1.5 sm:text-xs">
                    Before
                  </span>
                  <span className="absolute top-2.5 right-2.5 bg-white/92 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] sm:top-4 sm:right-4 sm:px-3 sm:py-1.5 sm:text-xs">
                    After
                  </span>
                  <div
                    className={`${serif} absolute right-2.5 bottom-2.5 max-w-[calc(100%-20px)] bg-white/94 px-2.5 py-1.5 text-xs font-bold leading-[1.3] sm:right-4 sm:bottom-4 sm:max-w-[calc(100%-32px)] sm:px-[18px] sm:py-3 sm:text-[clamp(15px,1.8vw,19px)]`}
                  >
                    Preview of what your listing could look like
                  </div>
                </div>
                <PhotoGrid photos={gridTop} desktopRows={1} className="mt-2 sm:mt-3" />
                <div className="h-2 sm:h-3" />
              </>
            )}
            <div data-section="video">
              <MutableVideo id={video.id} title={video.title} />
            </div>
            <PhotoGrid photos={gridBottom} desktopRows={2} className="mt-2 sm:mt-3" />
            {featureLast && (
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

        {/* Why Hahn Media */}
        <section data-section="why" className="px-4 pt-[clamp(56px,8vw,88px)]">
          <div className="mx-auto grid max-w-[1040px] grid-cols-1 bg-[#F9F4F1] md:grid-cols-3 text-center">
            {[
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
            ].map((f, i) => (
              <div
                key={f.title}
                className={`px-[clamp(24px,3vw,36px)] py-[30px] ${i > 0 ? "border-t border-[#181A1C]/10 md:border-t-0 md:border-l" : ""}`}
              >
                <h3 className={`${serif} text-[21px] font-bold`}>{f.title}</h3>
                <p className="mt-2 text-base leading-[1.55] text-pretty text-[#181A1C]/78">{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Recent listings */}
        {listings.length > 0 && (
          <section data-section="listings" className="px-4 pt-[clamp(64px,9vw,104px)]">
            <div className="mx-auto max-w-[1040px]">
              <h2 className={`${serif} mb-[clamp(32px,5vw,48px)] text-center text-[clamp(30px,4vw,40px)] font-bold tracking-[-0.02em]`}>
                Recent listings near {area}
              </h2>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] gap-4">
                {listings.map((l) => (
                  <ListingCard key={l.bookingId} listing={l} />
                ))}
              </div>
            </div>
          </section>
        )}

        {/* Testimonial */}
        <section data-section="testimonial" className="mt-[clamp(64px,9vw,104px)] bg-[#F9F4F1] px-4 py-[clamp(56px,8vw,88px)]">
          <figure className="mx-auto max-w-[720px] text-center">
            <div className={`${serif} text-[64px] font-bold leading-[0.6] text-[#D67F1F]`}>“</div>
            <blockquote className={`${serif} mt-4 text-[clamp(19px,2.3vw,23px)] leading-[1.6] font-normal text-pretty`}>
              <p>
                I can’t recommend Lukas enough! <strong className="font-bold">The photos for my listing were amazing</strong>, and he went
                above and beyond by helping my client remove some remaining belongings from the property.
              </p>
              <p className="mt-[18px]">
                It’s rare to find someone who provides such great work while also genuinely caring about the people they’re working with.{" "}
                <strong className="font-bold">
                  I would highly recommend him to anyone looking for a talented and dependable photographer.
                </strong>
              </p>
            </blockquote>
            <figcaption className="mt-7 flex flex-col items-center gap-1">
              <span className="text-base font-semibold">Serenity Thompson</span>
              <span className="text-xs uppercase tracking-[0.2em] text-[#995000]">Oregon Live Homes</span>
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

        {/* Pricing */}
        <section id="pricing" data-section="pricing" className="px-4 pt-[clamp(64px,9vw,104px)]">
          <div className="mx-auto max-w-[672px]">
            <h2 className={`${serif} text-center text-[clamp(30px,4vw,40px)] font-bold tracking-[-0.02em]`}>Pricing</h2>
            <div className="mt-[clamp(28px,4vw,40px)] border-t border-[#181A1C]/15">
              <PriceRow
                name="Interior & Exterior Photography"
                addOns={["+$100 Aerial Drone Photography", "+$50 Floor Plans"]}
                price="$300"
              />
              <PriceRow name="Walkthrough Video" addOns={["+$100 Agent On-Camera Video"]} price="$400" />
              <div className="flex items-start justify-between gap-6 bg-[#F9F4F1] px-5 py-7">
                <div>
                  <p className="text-lg font-semibold">The Full Package</p>
                  <p className="mt-2 text-[15px] leading-normal text-[#181A1C]/75">
                    Photography &amp; walkthrough video, including drone and social media edit.
                  </p>
                </div>
                <div className="text-right">
                  <p className={`${serif} whitespace-nowrap text-[30px] font-bold text-[#D67F1F]`}>$700</p>
                  <p className="mt-1 whitespace-nowrap text-xs font-semibold uppercase tracking-[0.14em] text-[#995000]">Save $200</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Book */}
        <section id="book" data-section="book" className="px-4 pt-[clamp(72px,10vw,120px)] pb-[clamp(80px,11vw,128px)]">
          <div className="mx-auto max-w-[880px]">
            <h2
              className={`${serif} mb-[clamp(32px,5vw,48px)] text-center text-[clamp(30px,4.4vw,44px)] font-bold leading-[1.15] tracking-[-0.02em] text-balance text-[#D67F1F]`}
            >
              Let’s work on your next listing.
            </h2>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))] gap-4">
              <div className="flex flex-col items-start bg-[#F9F4F1] p-[clamp(28px,4vw,40px)]">
                <h3 className={`${serif} text-[26px] font-bold`}>No listing right now?</h3>
                <p className="mt-2.5 mb-6 text-base leading-[1.55] text-pretty text-[#181A1C]/78">
                  Save my contact so I’m one tap away when your next one comes up.
                </p>
                <a
                  href={VCARD_HREF}
                  download={VCARD_NAME}
                  data-track="save_contact"
                  data-track-detail="bottom"
                  className="mt-auto inline-flex min-h-14 items-center border border-[#181A1C] bg-[#181A1C] px-8 text-[13px] font-medium uppercase tracking-[0.3em] text-white hover:bg-white hover:text-[#181A1C]"
                >
                  Save my contact
                </a>
              </div>
              <div className="flex flex-col items-start border border-[#181A1C]/15 p-[clamp(28px,4vw,40px)]">
                <h3 className={`${serif} text-[26px] font-bold`}>Have a listing?</h3>
                <p className="mt-2.5 mb-6 text-base leading-[1.55] text-pretty text-[#181A1C]/78">Your first shoot is $50 off.</p>
                <a
                  href={bookHref}
                  data-track="book_shoot"
                  data-track-detail="Book a shoot (bottom)"
                  className="mt-auto inline-flex min-h-14 items-center border border-[#181A1C] px-8 text-[13px] font-medium uppercase tracking-[0.3em] text-[#181A1C] hover:bg-[#181A1C] hover:text-white"
                >
                  Book a shoot
                </a>
              </div>
            </div>
            <p className="mx-auto mt-8 max-w-[480px] text-center text-[15px] leading-[1.55] text-pretty text-[#181A1C]/72">
              Every shoot guaranteed. If you are not happy with the images, I reshoot at no cost.
            </p>
            {firstName && (
              <p className={`${serif} mt-12 text-center text-xl italic leading-normal`}>
                Thanks for taking a look, {firstName}. Talk soon!
                <br />
                <span className="font-[family-name:var(--font-portfolio-sans)] text-[15px] not-italic text-[#181A1C]/70">— Lukas</span>
              </p>
            )}
          </div>
        </section>
      </main>
      {!preview && <PageTracker slug={slug} />}

      <footer className="border-t border-[#181A1C]/10 px-4 py-7">
        <div className="mx-auto flex max-w-[1152px] flex-wrap justify-between gap-x-6 gap-y-2 text-[13px] text-[#181A1C]/62">
          <span>Hahn Media · Lukas Hahn</span>
          <span>Eugene &amp; Roseburg, Oregon</span>
        </div>
      </footer>
    </div>
  );
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

function PriceRow({ name, addOns, price }: { name: string; addOns: string[]; price: string }) {
  return (
    <div className="flex items-start justify-between gap-6 border-b border-[#181A1C]/15 px-1 py-7">
      <div>
        <p className="text-lg">{name}</p>
        {addOns.map((a, i) => (
          <p key={a} className={`${i === 0 ? "mt-2" : "mt-1.5"} text-xs uppercase tracking-[0.15em] text-[#181A1C]/62`}>
            {a}
          </p>
        ))}
      </div>
      <p className="font-[family-name:var(--font-portfolio-serif)] whitespace-nowrap text-[26px] font-bold">{price}</p>
    </div>
  );
}
