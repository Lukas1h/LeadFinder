import { notFound } from "next/navigation";
import { after } from "next/server";
import { headers } from "next/headers";
import type { Metadata } from "next";
import { Noto_Serif, Outfit } from "next/font/google";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { verticalLinks } from "@/db/schema";
import { PORTFOLIO_ORIGIN } from "@/lib/siteUrls";
import { LUKAS_PHONE as PHONE } from "@/lib/agentVcard";
import { LUKAS_PHOTO } from "@/lib/agentPage";
import { parseUserAgent } from "@/lib/galleryViews";
import { notifyVerticalView } from "@/lib/push";
import { verticalHeadline, type VerticalConfig, type VerticalPhoto } from "@/lib/verticals";
import { VerticalTracker } from "@/components/VerticalTracker";
import { LoopVideo } from "@/app/portfolio/[slug]/client";

// Same brand pairing as the agent page: Noto Serif headings, Outfit for the rest.
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

const serif = "font-[family-name:var(--font-portfolio-serif)]";

/** Link preview: the config's title and tagline over its first photo (absolute — crawlers don't resolve relative paths). */
export function verticalMetadata(v: VerticalConfig): Metadata {
  const title = v.ogTitle;
  const description = v.tagline;
  const src = v.photos[0]?.src;
  const images = src ? [src.startsWith("http") ? src : `${PORTFOLIO_ORIGIN}${src}`] : [];
  return {
    title,
    description,
    openGraph: { title, description, siteName: "Hahn Media", images },
    twitter: { card: "summary_large_image", title, description, images },
  };
}

/**
 * One company's page for a side vertical (lib/verticals.ts holds all its
 * copy; the link only adds a first name and area). Modelled on the agent
 * page's new style. Never shows the company name — that's Lukas's own
 * tracking. Public, the slug is the only access control.
 */
export async function VerticalPage({ vertical: v, slug, previewParam }: { vertical: VerticalConfig; slug: string; previewParam: boolean }) {
  // ?preview=1 (Lukas checking it) or a link-preview fetcher: no view, no push, no tracking.
  const preview = previewParam || parseUserAgent((await headers()).get("user-agent")).isPreview;
  const [link] = await db.select().from(verticalLinks).where(eq(verticalLinks.slug, slug));
  if (!link || link.vertical !== v.key) notFound();

  if (!preview)
    after(async () => {
      await db
        .update(verticalLinks)
        .set({
          viewCount: sql`${verticalLinks.viewCount} + 1`,
          firstViewedAt: sql`coalesce(${verticalLinks.firstViewedAt}, now())`,
          lastViewedAt: new Date(),
        })
        .where(eq(verticalLinks.id, link.id));
      await notifyVerticalView(link.id, v.key, link.company, link.viewCount + 1).catch((err) =>
        console.error("vertical view push failed", err)
      );
    });

  const firstName = link.contactName?.trim() || "";
  const vcardHref = `/api/vertical/${slug}/vcard`;
  const textHref = `sms:${PHONE}?&body=` + encodeURIComponent(v.smsBody);
  const area = link.area?.trim();
  const headline = verticalHeadline(v, area);
  // Colour the area in the headline, like the agent page does.
  const areaText = area ? ` in ${area}` : "";
  const headlineLead = areaText && headline.endsWith(areaText) ? headline.slice(0, -area!.length) : headline;

  return (
    <div
      className={`${notoSerif.variable} ${outfit.variable} min-h-screen scroll-smooth bg-white font-[family-name:var(--font-portfolio-sans)] text-[#181A1C] antialiased`}
    >
      <header className="sticky top-0 z-50 border-b border-[#181A1C]/10 bg-white/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1152px] items-center justify-between gap-4 px-[clamp(16px,3vw,24px)] py-5">
          <a href="#top" className="flex flex-col leading-none text-[#181A1C]">
            <span className={`${serif} text-[clamp(24px,3vw,30px)] font-bold tracking-[-0.025em]`}>Hahn Media</span>
            <span className="mt-0.5 text-[10px] font-medium uppercase whitespace-nowrap tracking-[0.18em] sm:tracking-[0.3em] text-[#181A1C]/70">{v.subtitle}</span>
          </a>
          <a
            href={vcardHref}
            data-track="save_contact"
            data-track-detail="header"
            className="inline-flex min-h-11 items-center whitespace-nowrap border border-[#181A1C] px-[22px] text-xs font-medium uppercase tracking-[0.3em] text-[#181A1C] hover:bg-[#181A1C] hover:text-white"
          >
            Save contact
          </a>
        </div>
      </header>

      <main id="top">
        <section data-section="hero" className="px-4 pt-[clamp(28px,4vw,48px)] pb-[clamp(24px,3.5vw,36px)] text-center">
          <div className="mx-auto flex max-w-[760px] flex-col items-center">
            <h1 className={`${serif} text-[clamp(32px,5.4vw,56px)] font-bold leading-[1.1] tracking-[-0.02em] text-balance`}>
              {area && headlineLead !== headline ? (
                <>
                  {headlineLead}
                  <span className="text-[#D67F1F]">{area}</span>
                </>
              ) : (
                headline
              )}
            </h1>
            <p className="mt-4 max-w-[560px] text-[clamp(17px,2vw,20px)] leading-[1.45] text-pretty text-[#181A1C]/75">{v.tagline}</p>
            {v.offer && (
              <a
                href={textHref}
                data-track="text_me"
                data-track-detail="offer (top)"
                className="mt-5 inline-flex items-baseline gap-2.5 bg-[#F9F4F1] px-5 py-2.5 text-[#181A1C] hover:bg-[#F3EAE3]"
              >
                <span className={`${serif} text-base font-bold text-[#D67F1F]`}>{v.offer}</span>
              </a>
            )}
          </div>
        </section>

        <section id="portfolio" className="px-4">
          <div className="mx-auto max-w-[1040px]">
            {v.video ? (
              <div data-section="video">
                <LoopVideo src={v.video.mp4} poster={v.video.poster} title={v.video.title} />
              </div>
            ) : (
              <Gallery photos={v.photos} />
            )}
          </div>
        </section>

        <section data-section="why" className="px-4 pt-[clamp(56px,8vw,88px)]">
          <div className="mx-auto grid max-w-[1040px] grid-cols-1 gap-px bg-[#181A1C]/10 text-center md:grid-cols-2 lg:grid-cols-4">
            {v.tiles.map((t) => (
              <div key={t.title} className="bg-[#F9F4F1] px-[clamp(24px,3vw,36px)] py-[30px]">
                <h3 className={`${serif} text-[21px] font-bold`}>{t.title}</h3>
                <p className="mt-2 text-base leading-[1.55] text-pretty text-[#181A1C]/78">{t.body}</p>
              </div>
            ))}
          </div>
        </section>

        <Pricing v={v} />

        <section id="save" data-section="book" className="px-4 pt-[clamp(64px,9vw,104px)] pb-[clamp(80px,11vw,128px)]">
          <div className="mx-auto flex max-w-[560px] flex-col items-center text-center">
            <h2 className={`${serif} text-[clamp(28px,4vw,38px)] font-bold leading-[1.15] tracking-[-0.02em] text-balance`}>
              {firstName ? `Thanks for taking a look, ${firstName}!` : "Thanks for taking a look!"}
            </h2>
            <p className="mt-3 text-[17px] leading-[1.55] text-pretty text-[#181A1C]/78">{v.saveReason}</p>
            <a
              href={vcardHref}
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
                <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-[#D67F1F] text-xl font-semibold text-white">
                  LH
                </span>
              )}
              <div className="min-w-0">
                <p className="text-lg font-semibold leading-tight">Lukas Hahn</p>
                <p className="mt-0.5 text-sm text-[#181A1C]/70">Hahn Media · Photo, video &amp; aerial</p>
                <p className="mt-0.5 text-sm text-[#181A1C]/70">{formatPhone(PHONE)}</p>
              </div>
            </div>
            <a
              href={textHref}
              data-track="text_me"
              data-track-detail="bottom"
              className="mt-5 inline-flex min-h-12 w-full max-w-[380px] items-center justify-center border border-[#181A1C] px-8 text-[13px] font-medium uppercase tracking-[0.3em] text-[#181A1C] hover:bg-[#181A1C] hover:text-white"
            >
              Text me
            </a>
            {v.offer && <p className="mt-4 text-sm font-semibold text-[#995000]">{v.offer}.</p>}
          </div>
        </section>
      </main>
      {!preview && <VerticalTracker slug={slug} />}

      <footer className="border-t border-[#181A1C]/10 px-4 py-7">
        <div className="mx-auto flex max-w-[1152px] flex-wrap justify-between gap-x-6 gap-y-2 text-[13px] text-[#181A1C]/62">
          <span>Hahn Media · Lukas Hahn</span>
          <span>Based in Eugene, Oregon</span>
        </div>
      </footer>
    </div>
  );
}

/**
 * First photo full width, then the rest in a grid — 2 columns on a phone, 3
 * from lg — trimmed so each size only shows full rows.
 */
function Gallery({ photos }: { photos: VerticalPhoto[] }) {
  if (photos.length === 0) return null;
  const [first, ...rest] = photos;
  const small = rest.length - (rest.length % 2);
  const large = rest.length - (rest.length % 3);
  return (
    <div data-section="photos">
      {/* eslint-disable-next-line @next/next/no-img-element -- static portfolio photo */}
      <img src={first.src} alt={first.alt} className="aspect-[3/2] w-full bg-[#F9F4F1] object-cover" />
      {rest.length > 1 && (
        <div className="mt-2 grid grid-cols-2 gap-2 sm:mt-3 sm:gap-3 lg:grid-cols-3">
          {rest.slice(0, Math.max(small, large)).map((p, i) => {
            const visibility = i >= small && i < large ? "hidden lg:block" : i < small && i >= large ? "lg:hidden" : "";
            return (
              // eslint-disable-next-line @next/next/no-img-element -- static portfolio photo
              <img key={p.src} src={p.src} alt={p.alt} loading="lazy" className={`aspect-[3/2] w-full bg-[#F9F4F1] object-cover ${visibility}`} />
            );
          })}
        </div>
      )}
    </div>
  );
}

/** First package highlighted (orange border + badge, like the agent page's "Most booked"), the rest as plain boxes. */
function Pricing({ v }: { v: VerticalConfig }) {
  if (v.packages.length === 0) return null;
  const [top, ...others] = v.packages;
  return (
    <section id="pricing" data-section="pricing" className="px-4 pt-[clamp(44px,6vw,64px)]">
      <div className="mx-auto max-w-[672px]">
        <h2 className={`${serif} text-center text-[clamp(30px,4vw,40px)] font-bold tracking-[-0.02em]`}>Pricing</h2>
        <div className="relative mt-[clamp(32px,4vw,44px)] border-2 border-[#D67F1F] px-[clamp(20px,3vw,32px)] pt-8 pb-[clamp(20px,3vw,28px)]">
          {top.badge && (
            <span className="absolute -top-3.5 left-[clamp(20px,3vw,32px)] bg-[#D67F1F] px-3 py-1 text-xs font-bold uppercase tracking-[0.16em] text-white">
              {top.badge}
            </span>
          )}
          <PackageBody pkg={top} highlighted />
        </div>
        {others.map((p) => (
          <div key={p.name} className="mt-4 border border-[#181A1C]/15 px-[clamp(20px,3vw,32px)] py-[clamp(20px,3vw,28px)]">
            <PackageBody pkg={p} />
          </div>
        ))}
        {v.offer && <p className="mt-5 text-center text-[15px] font-semibold text-[#995000]">{v.offer}.</p>}
      </div>
    </section>
  );
}

function PackageBody({ pkg, highlighted = false }: { pkg: VerticalConfig["packages"][number]; highlighted?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-5">
      <div className="min-w-0">
        <p className="text-[clamp(20px,2.4vw,24px)] font-semibold leading-tight">{pkg.name}</p>
        <ul
          className={`mt-2.5 list-disc space-y-1 pl-5 text-[clamp(15px,1.8vw,17px)] leading-snug marker:text-[#D67F1F] ${
            highlighted ? "font-semibold text-[#995000]" : "text-[#181A1C]/78"
          }`}
        >
          {pkg.perks.map((perk) => (
            <li key={perk}>{perk}</li>
          ))}
        </ul>
      </div>
      <p
        className={`${serif} whitespace-nowrap font-bold leading-none ${
          highlighted ? "text-[clamp(32px,4.2vw,40px)] text-[#D67F1F]" : "text-[clamp(26px,3.4vw,32px)]"
        }`}
      >
        {pkg.price}
        {pkg.unit && <span className="text-[0.5em] font-normal text-[#181A1C]/62">{pkg.unit}</span>}
      </p>
    </div>
  );
}

/** "+15414303372" → "(541) 430-3372". */
function formatPhone(e164: string): string {
  const d = e164.replace(/\D/g, "").slice(-10);
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}
