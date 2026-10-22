import { notFound } from "next/navigation";
import { after } from "next/server";
import type { Metadata } from "next";
import { Noto_Serif, Outfit } from "next/font/google";
import { db } from "@/db";
import { agents, portfolioLinks } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { notifyPortfolioView } from "@/lib/push";

// Same reasoning as the gallery route: a fresh navigation from outside the
// app, not an in-app tab switch, so there's no "instant" shell to preserve.
export const instant = false;

// Same brand pairing as the main site and the client gallery: Noto Serif for
// the "Hahn Media" wordmark, Outfit for everything else.
const notoSerif = Noto_Serif({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-portfolio-serif" });
const outfit = Outfit({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-portfolio-sans" });

export const metadata: Metadata = {
  title: "Hahn Media | Real Estate Photography & Video",
  description: "Real estate photography, drone and video in Oregon.",
};

/**
 * A personalized portfolio page, sent in place of the samples email's
 * attachment (mainly for cold outreach) — built in the same voice and
 * design as lukashahn.art/real-estate, but with no sign anywhere that it
 * was made for any one agent. Content is hand-picked per link
 * (src/app/portfolio-links); the page itself just renders it and records
 * the view.
 *
 * Public, no login — the slug is the only access control, same spirit as
 * the client gallery's token.
 */
export default async function PortfolioPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [link] = await db.select().from(portfolioLinks).where(eq(portfolioLinks.slug, slug));
  if (!link) notFound();
  const { content } = link;

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
      ? (await db.select({ name: agents.name }).from(agents).where(eq(agents.id, link.agentId)))[0]?.name ?? null
      : null;
    await notifyPortfolioView(agentName, link.viewCount + 1).catch((err) => console.error("portfolio view push failed", err));
  });

  const photoUrl = (bookingId: string, name: string, size: string) =>
    `/api/portfolio/${slug}/photo?bookingId=${bookingId}&name=${encodeURIComponent(name)}&size=${size}`;

  return (
    <div className={`${notoSerif.variable} ${outfit.variable} min-h-screen bg-[#F9F4F1] antialiased`}>
      <header className="sticky inset-x-0 top-0 z-50 border-b border-[#181A1C]/10 bg-white/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-5 sm:px-6">
          <div className="flex flex-col leading-none">
            <span className="font-[family-name:var(--font-portfolio-serif)] text-2xl font-bold tracking-tight text-[#181A1C] sm:text-3xl">
              Hahn Media
            </span>
            <span className="mt-0.5 font-[family-name:var(--font-portfolio-sans)] text-[9px] font-medium uppercase tracking-[0.3em] text-[#181A1C]/70 sm:text-[10px]">
              Real Estate Photo &amp; Video
            </span>
          </div>
        </div>
      </header>

      <main className="font-[family-name:var(--font-portfolio-sans)]">
        {/* Hero */}
        <section className="w-full px-4 pt-14 pb-8 text-center">
          <h1 className="mb-3 text-xs font-medium uppercase tracking-[0.4em] text-[#995000]">
            Real Estate Photography &amp; Video{content.area ? ` in ${content.area}` : ""}, Oregon
          </h1>
          <p className="mx-auto max-w-2xl font-[family-name:var(--font-portfolio-serif)] text-3xl font-bold leading-tight tracking-tight text-[#D67F1F] md:text-4xl">
            Cinematic media that sells listings quicker.
          </p>
          <div className="mx-auto mt-4 h-[2px] w-11 bg-[#995000]" />
        </section>

        {/* Photo portfolio */}
        {content.photos.length > 0 && (
          <section className="mx-auto max-w-5xl px-4 py-10">
            <h2 className="mb-4 text-center text-xs font-medium uppercase tracking-[0.3em] text-[#181A1C]/70">
              Photo Portfolio
            </h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
              {content.photos.map((p, i) => (
                <div
                  key={`${p.bookingId}-${p.name}`}
                  className="relative aspect-[3/2] overflow-hidden rounded-lg border border-[#181A1C]/10 bg-[#F9F4F1]"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- proxied Dropbox photo */}
                  <img
                    src={photoUrl(p.bookingId, p.name, "w640h480")}
                    alt="Real estate photography by Hahn Media, Oregon"
                    loading={i < 4 ? undefined : "lazy"}
                    className="h-full w-full object-cover"
                  />
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Video */}
        {content.video && (
          <section className="px-4 pb-4">
            <h2 className="mb-4 text-center text-xs font-medium uppercase tracking-[0.3em] text-[#181A1C]/70">
              {content.video.title}
            </h2>
            <div className="relative mx-auto aspect-video max-w-3xl overflow-hidden border border-[#181A1C]/10 shadow-xl shadow-black/10">
              <iframe
                src={`https://www.youtube-nocookie.com/embed/${content.video.youtubeId}?rel=0&modestbranding=1`}
                title={content.video.title}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="absolute inset-0 h-full w-full"
              />
            </div>
          </section>
        )}

        {/* Houses */}
        {content.houses.length > 0 && (
          <section className="mx-auto max-w-5xl px-4 py-10">
            <h2 className="mb-6 text-center text-xs font-medium uppercase tracking-[0.3em] text-[#181A1C]/70">
              Recent Work
            </h2>
            <div className="flex flex-col gap-8">
              {content.houses.map((house) => (
                <div key={house.bookingId}>
                  <p className="mb-2 text-sm font-medium text-[#181A1C]">
                    {house.address}
                    {house.city ? <span className="text-[#181A1C]/60"> · {house.city}</span> : null}
                  </p>
                  <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] snap-x snap-mandatory">
                    {house.photos.map((name) => (
                      <div
                        key={name}
                        className="relative aspect-[3/2] w-64 shrink-0 snap-start overflow-hidden rounded-lg border border-[#181A1C]/10 bg-[#F9F4F1] sm:w-80"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element -- proxied Dropbox photo */}
                        <img
                          src={photoUrl(house.bookingId, name, "w960h640")}
                          alt={`${house.address ?? "Listing"} — real estate photography by Hahn Media, Oregon`}
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* What sets it apart */}
        <section className="mx-auto max-w-4xl px-4 py-10 text-center">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              "24-Hour Turnaround",
              "Free Reshoots",
              "Flexible Last-Minute Scheduling",
              "Edited In-House by a Human, Not AI",
            ].map((line) => (
              <div key={line} className="rounded-lg border border-[#181A1C]/10 bg-white px-3 py-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#D67F1F]">{line}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Pricing */}
        <section className="mx-auto max-w-4xl px-4 py-10">
          <h2 className="mb-6 text-center text-xs font-medium uppercase tracking-[0.3em] text-[#181A1C]/70">Pricing</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              { name: "Interior / Exterior Photography", note: "+$100 Aerial Drone Footage", price: "$300" },
              { name: "Walkthrough Video", note: "+$100 Social Media Edit", price: "$400" },
              { name: "Photography & Walkthrough Video", note: "Including Drone & Social", price: "$700" },
            ].map((tier) => (
              <div key={tier.name} className="rounded-lg border border-[#181A1C]/10 bg-white p-6 text-center">
                <p className="text-sm font-medium text-[#181A1C]">{tier.name}</p>
                <p className="mt-1 text-xs text-[#181A1C]/60">{tier.note}</p>
                <p className="mt-3 font-[family-name:var(--font-portfolio-serif)] text-2xl font-bold text-[#D67F1F]">{tier.price}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Contact */}
        <section className="border-t border-[#181A1C]/10 px-4 py-10 text-center">
          <p className="text-sm text-[#181A1C]/70">Reach out to book your shoot.</p>
          <p className="mt-2 text-sm font-medium text-[#181A1C]">
            <a href="mailto:lukas@lukashahn.art" className="hover:text-[#D67F1F]">
              lukas@lukashahn.art
            </a>{" "}
            · <a href="tel:+15414303372" className="hover:text-[#D67F1F]">(541) 430-3372</a>
          </p>
        </section>
      </main>
    </div>
  );
}
