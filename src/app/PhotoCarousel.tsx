"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, ImageOff } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PhotoCarousel({
  photos,
  alt,
  alwaysShowControls = false,
}: {
  photos: string[];
  alt: string;
  /** Hover-only arrows don't work on mobile touch — set true for a modal/full-size context. */
  alwaysShowControls?: boolean;
}) {
  const [index, setIndex] = useState(0);

  if (photos.length === 0) {
    return (
      <div className="w-full aspect-[3/2] bg-muted rounded-md flex flex-col items-center justify-center gap-1 text-muted-foreground text-sm">
        <ImageOff className="size-5" />
        No photo
      </div>
    );
  }

  const arrowVisibility = alwaysShowControls ? "opacity-100" : "opacity-0 group-hover:opacity-100";

  return (
    <div className="relative w-full aspect-[3/2] rounded-md overflow-hidden bg-muted group">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={photos[index]} alt={alt} className="w-full h-full object-cover" />
      {photos.length > 1 && (
        <>
          <Button
            type="button"
            variant="secondary"
            size="icon-sm"
            aria-label="Previous photo"
            onClick={() => setIndex((i) => (i - 1 + photos.length) % photos.length)}
            className={`absolute left-1.5 top-1/2 -translate-y-1/2 rounded-full bg-black/50 text-white hover:bg-black/70 hover:text-white transition-opacity ${arrowVisibility}`}
          >
            <ChevronLeft />
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="icon-sm"
            aria-label="Next photo"
            onClick={() => setIndex((i) => (i + 1) % photos.length)}
            className={`absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full bg-black/50 text-white hover:bg-black/70 hover:text-white transition-opacity ${arrowVisibility}`}
          >
            <ChevronRight />
          </Button>
          <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 flex gap-1">
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
