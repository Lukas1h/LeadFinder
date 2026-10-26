"use client";

import { useRef, useState } from "react";
import type { PortfolioListing } from "@/db/schema";

/**
 * Autoplaying, looping, muted YouTube embed with no controls (pointer events
 * off, so it reads as footage rather than a player) and one "Sound on" button,
 * driven over the IFrame API's postMessage commands (needs enablejsapi=1).
 */
export function MutableVideo({ id, title }: { id: string; title: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [muted, setMuted] = useState(true);

  const cmd = (func: string, args: unknown[] = []) =>
    frame.current?.contentWindow?.postMessage(JSON.stringify({ event: "command", func, args }), "*");

  const toggle = () => {
    if (muted) {
      cmd("unMute");
      cmd("setVolume", [100]);
    } else {
      cmd("mute");
    }
    setMuted(!muted);
  };

  const src = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&mute=1&loop=1&playlist=${id}&controls=0&modestbranding=1&rel=0&iv_load_policy=3&disablekb=1&playsinline=1&enablejsapi=1`;

  return (
    <div className="relative aspect-video w-full overflow-hidden bg-[#F9F4F1]">
      <iframe
        ref={frame}
        src={src}
        title={title}
        allow="autoplay; encrypted-media; picture-in-picture"
        className="pointer-events-none absolute inset-0 h-full w-full border-0"
      />
      <button
        type="button"
        onClick={toggle}
        data-track={muted ? "sound_on" : "sound_off"}
        data-track-detail={title}
        aria-label={muted ? "Unmute video" : "Mute video"}
        className="absolute right-4 bottom-4 flex h-11 cursor-pointer items-center gap-2 rounded-[22px] border border-[#F9F4F1]/70 bg-black/35 px-4 text-xs font-medium uppercase tracking-[0.16em] text-[#F9F4F1] backdrop-blur-[4px] hover:border-[#F9F4F1] hover:bg-black/55"
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#F9F4F1" strokeWidth="1.5">
          <path d="M4 9v6h4l5 5V4L8 9H4z" strokeLinejoin="round" />
          {muted ? (
            <path d="M16 9l5 6M21 9l-5 6" strokeLinecap="round" />
          ) : (
            <path d="M16 8a5 5 0 010 8M19 5a9 9 0 010 14" strokeLinecap="round" />
          )}
        </svg>
        {muted ? "Sound on" : "Sound off"}
      </button>
    </div>
  );
}

const arrowButton =
  "absolute top-1/2 flex h-11 w-11 -translate-y-1/2 cursor-pointer items-center justify-center rounded-[22px] border-0 bg-white/90 shadow-[0_1px_4px_rgba(0,0,0,0.2)] hover:bg-white";

/** A listing card; `photos` are ready-to-load URLs, empty while they stream in. */
export function ListingCard({ listing: l }: { listing: PortfolioListing & { photos: string[] } }) {
  const [idx, setIdx] = useState(0);
  const n = l.photos.length;
  const step = (dir: number) => setIdx((i) => (i + dir + n) % n);
  const facts = [
    l.beds && { value: l.beds, unit: "bd" },
    l.baths && { value: l.baths, unit: "ba" },
    l.sqft && { value: l.sqft, unit: "sqft" },
  ].filter((f): f is { value: string; unit: string } => Boolean(f));

  return (
    <article className="flex flex-col overflow-hidden border border-[#181A1C]/12 bg-white shadow-[0_2px_10px_rgba(0,0,0,0.05)]">
      <div className="relative aspect-[3/2] bg-[#F9F4F1]">
        {n > 0 && (
          // eslint-disable-next-line @next/next/no-img-element -- proxied gallery photo
          <img src={l.photos[idx]} alt={l.address} loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
        )}
        {l.status && (
          <span className="absolute top-3 left-3 bg-white px-2.5 py-[5px] text-[11px] font-semibold uppercase tracking-[0.14em] text-[#181A1C]">
            {l.status}
          </span>
        )}
        {n > 1 && (
          <>
            <span className="absolute top-3 right-3 bg-[#181A1C]/70 px-[9px] py-[5px] text-xs font-medium text-white">
              {idx + 1} / {n}
            </span>
            <button
              type="button"
              onClick={() => step(-1)}
              data-track="listing_prev"
              data-track-detail={l.address}
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
              data-track="listing_next"
              data-track-detail={l.address}
              aria-label="Next photo"
              className={`${arrowButton} right-2.5`}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#181A1C" strokeWidth="1.8">
                <path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <div className="absolute inset-x-0 bottom-3 flex justify-center gap-1.5">
              {l.photos.map((p, i) => (
                <span key={`${i}`} className={`h-[7px] w-[7px] rounded-[4px] ${i === idx ? "bg-white" : "bg-white/50"}`} />
              ))}
            </div>
          </>
        )}
      </div>
      <div className="flex flex-col gap-1.5 px-5 pt-[18px] pb-5">
        {l.price && <div className="font-[family-name:var(--font-portfolio-serif)] text-[26px] font-bold text-[#181A1C]">{l.price}</div>}
        {(facts.length > 0 || l.type) && (
          <div className="flex flex-wrap gap-x-3.5 gap-y-1 text-[15px] text-[#181A1C]">
            {facts.map((f) => (
              <span key={f.unit}>
                <b className="font-semibold">{f.value}</b> {f.unit}
              </span>
            ))}
            {l.type && <span className="text-[#181A1C]/70">{l.type}</span>}
          </div>
        )}
        <div className="text-[15px] leading-[1.4] text-[#181A1C]">{[l.address, l.city].filter(Boolean).join(", ")}</div>
        {(l.agent || l.brokerage) && (
          <div className="mt-2 border-t border-[#181A1C]/10 pt-3 text-xs uppercase tracking-[0.08em] text-[#181A1C]/68">
            {[l.agent, l.brokerage].filter(Boolean).join(" · ")}
          </div>
        )}
      </div>
    </article>
  );
}

/**
 * The before/after: the before on the left of a slanted line, the after on
 * the right. Starts a quarter in so the after shows most, and drags (mouse
 * or finger) anywhere on the photo. touch-action pan-y keeps a vertical
 * swipe scrolling the page on phones; only a sideways drag moves the line.
 */
export function BeforeAfterSlider({ before, after, dulled }: { before: string; after: string; dulled: boolean }) {
  const [pos, setPos] = useState(25);
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  // Half the slant: the line runs from pos+SLANT at the top to pos-SLANT at the bottom.
  const SLANT = 8;
  const move = (clientX: number) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    setPos(Math.min(100 + SLANT, Math.max(-SLANT, ((clientX - rect.left) / rect.width) * 100)));
  };
  const top = pos + SLANT;
  const bottom = pos - SLANT;

  return (
    <div
      ref={ref}
      className="absolute inset-0 cursor-ew-resize select-none [touch-action:pan-y]"
      onPointerDown={(e) => {
        dragging.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        move(e.clientX);
      }}
      onPointerMove={(e) => dragging.current && move(e.clientX)}
      onPointerUp={() => (dragging.current = false)}
      onPointerCancel={() => (dragging.current = false)}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- before/after overlay */}
      <img src={after} alt="After editing" draggable={false} className="pointer-events-none absolute inset-0 h-full w-full object-cover" />
      {/* eslint-disable-next-line @next/next/no-img-element -- before/after overlay */}
      <img
        src={before}
        alt="Before editing"
        draggable={false}
        className="pointer-events-none absolute inset-0 h-full w-full object-cover"
        style={{
          clipPath: `polygon(0 0, ${top}% 0, ${bottom}% 100%, 0 100%)`,
          filter: dulled ? "brightness(0.72) saturate(0.55) contrast(0.88) sepia(0.12)" : undefined,
        }}
      />
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full">
        <line x1={top} y1="0" x2={bottom} y2="100" stroke="#ffffff" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      <span
        className="pointer-events-none absolute top-1/2 flex size-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-sm font-bold text-[#181A1C] shadow-md"
        style={{ left: `${pos}%` }}
        aria-hidden
      >
        ‹ ›
      </span>
    </div>
  );
}
