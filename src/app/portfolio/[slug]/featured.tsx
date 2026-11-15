"use client";

import { useState } from "react";
import type { FeaturedShoot } from "@/lib/portfolioFeatured";

const serif = "font-[family-name:var(--font-portfolio-serif)]";
const arrowButton =
  "absolute top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 shadow-[0_2px_8px_rgba(0,0,0,0.18)] hover:bg-white";

/**
 * The shoot a cold text offered to share ("I just shot a listing down the road
 * from yours"): it opens the page — address, a photo carousel, and what it cost.
 * Photos stack in place like ListingCard's so the arrows flip instantly.
 */
export function FeaturedShootSection({ shoot }: { shoot: FeaturedShoot }) {
  const photos = shoot.photoUrls;
  const n = photos.length;
  const [idx, setIdx] = useState(0);
  const [warm, setWarm] = useState(false);
  const step = (dir: number) => setIdx((i) => (i + dir + n) % n);
  const charged = [shoot.packageLabel, shoot.price != null ? `$${shoot.price.toLocaleString("en-US")}` : null].filter(Boolean).join(" · ");

  return (
    <section data-section="featured" className="px-4 pt-[clamp(20px,3vw,32px)]">
      <div className="mx-auto max-w-[1040px]">
        <div className="mb-[clamp(16px,2.5vw,24px)] text-center">
          <p className="text-[13px] font-medium uppercase tracking-[0.2em] text-[#995000]">Just shot</p>
          <h1 className={`${serif} mt-2 text-[clamp(30px,5vw,50px)] font-bold leading-[1.1] tracking-[-0.02em] text-balance`}>
            {shoot.address}
          </h1>
          {shoot.city && <p className="mt-1.5 text-[clamp(16px,2vw,19px)] text-[#181A1C]/72">{shoot.city}</p>}
        </div>

        {n > 0 && (
          <div className="relative aspect-[3/2] w-full overflow-hidden bg-[#F9F4F1]">
            {photos.map((src, i) =>
              i === 0 || warm ? (
                // eslint-disable-next-line @next/next/no-img-element -- proxied gallery photo
                <img
                  key={src}
                  src={src}
                  alt={i === idx ? shoot.address : ""}
                  loading="eager"
                  onLoad={i === 0 ? () => setWarm(true) : undefined}
                  className={`absolute inset-0 h-full w-full object-cover ${i === idx ? "" : "invisible"}`}
                />
              ) : null
            )}
            {n > 1 && (
              <>
                <span className="absolute top-3 right-3 bg-[#181A1C]/70 px-[9px] py-[5px] text-xs font-medium text-white">
                  {idx + 1} / {n}
                </span>
                <button
                  type="button"
                  onClick={() => step(-1)}
                  data-track="featured_prev"
                  data-track-detail={shoot.address}
                  aria-label="Previous photo"
                  className={`${arrowButton} left-2.5`}
                >
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#181A1C" strokeWidth="1.8">
                    <path d="M15 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => step(1)}
                  data-track="featured_next"
                  data-track-detail={shoot.address}
                  aria-label="Next photo"
                  className={`${arrowButton} right-2.5`}
                >
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#181A1C" strokeWidth="1.8">
                    <path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                {n <= 20 && (
                  <div className="absolute inset-x-0 bottom-3 flex justify-center gap-1.5">
                    {photos.map((p, i) => (
                      <span key={`${i}`} className={`h-[7px] w-[7px] rounded-[4px] ${i === idx ? "bg-white" : "bg-white/50"}`} />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {charged && (
          <p className="mt-4 text-center text-[clamp(16px,2vw,19px)]">
            <span className="text-[#181A1C]/72">What I charged: </span>
            <span className={`${serif} font-bold text-[#D67F1F]`}>{charged}</span>
          </p>
        )}
      </div>

      <div className="mx-auto mt-[clamp(48px,7vw,80px)] flex max-w-[1040px] items-center gap-4">
        <span className="h-px flex-1 bg-[#181A1C]/15" />
        <h2 className={`${serif} text-[clamp(24px,3.4vw,32px)] font-bold tracking-[-0.02em]`}>More of my work</h2>
        <span className="h-px flex-1 bg-[#181A1C]/15" />
      </div>
    </section>
  );
}
