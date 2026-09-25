"use client";

import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ImageOff } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PhotoCarousel({
  photos,
  alt,
  alwaysShowControls = false,
  onTap,
  sizeClassName = "aspect-[3/2]",
}: {
  photos: string[];
  alt: string;
  /** Hover-only arrows don't work on mobile touch — set true for a modal/full-size context. */
  alwaysShowControls?: boolean;
  /** Fired on a plain tap/click of the photo (not on a swipe or arrows). */
  onTap?: () => void;
  /** Custom sizing for the image frame (defaults to the modal's 3:2 square). */
  sizeClassName?: string;
}) {
  const [index, setIndex] = useState(0);
  const touchStartX = useRef<number | null>(null);
  const swipeAt = useRef<number | null>(null);

  if (photos.length === 0) {
    return (
      <div
        className={`w-full bg-muted rounded-md flex flex-col items-center justify-center gap-1 text-muted-foreground text-sm ${sizeClassName}`}
      >
        <ImageOff className="size-5" />
        No photo
      </div>
    );
  }

  const arrowVisibility = alwaysShowControls ? "opacity-100" : "opacity-0 group-hover:opacity-100";

  const step = (delta: number) => setIndex((i) => (i + delta + photos.length) % photos.length);

  // A horizontal swipe is a navigation gesture, so it must not also fire the
  // photo's tap-to-open effect. preventDefault on touchend suppresses the
  // browser's synthetic click on mobile; the swipeAt timestamp catches any
  // desktop/edge-case click that still lands right after.
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current == null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(dx) > 40) {
      step(dx < 0 ? 1 : -1);
      swipeAt.current = Date.now();
      e.preventDefault();
    }
  };

  const handleTap = () => {
    if (swipeAt.current != null && Date.now() - swipeAt.current < 500) return;
    onTap?.();
  };

  return (
    <div
      className={`relative w-full rounded-md overflow-hidden bg-muted group select-none ${sizeClassName}`}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onClick={handleTap}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={photos[index]} alt={alt} className="w-full h-full object-cover" draggable={false} />
      {photos.length > 1 && (
        <>
          <Button
            type="button"
            variant="secondary"
            size="icon-sm"
            aria-label="Previous photo"
            onClick={(e) => {
              e.stopPropagation();
              step(-1);
            }}
            className={`absolute left-1.5 top-1/2 -translate-y-1/2 rounded-full bg-black/50 text-white hover:bg-black/70 hover:text-white transition-opacity ${arrowVisibility}`}
          >
            <ChevronLeft />
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="icon-sm"
            aria-label="Next photo"
            onClick={(e) => {
              e.stopPropagation();
              step(1);
            }}
            className={`absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full bg-black/50 text-white hover:bg-black/70 hover:text-white transition-opacity ${arrowVisibility}`}
          >
            <ChevronRight />
          </Button>
          <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 flex gap-1 pointer-events-none">
            {photos.map((_, i) => (
              <span
                key={i}
                className={`w-1.5 h-1.5 rounded-full ${i === index ? "bg-white" : "bg-white/50"}`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
