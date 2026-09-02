"use client";

import { useState } from "react";

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
      <div className="w-full aspect-[3/2] bg-gray-100 rounded-md flex items-center justify-center text-gray-400 text-sm">
        No photo
      </div>
    );
  }

  const arrowVisibility = alwaysShowControls ? "opacity-100" : "opacity-0 group-hover:opacity-100";

  return (
    <div className="relative w-full aspect-[3/2] rounded-md overflow-hidden bg-gray-100 group">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={photos[index]}
        alt={alt}
        className="w-full h-full object-cover"
      />
      {photos.length > 1 && (
        <>
          <button
            type="button"
            aria-label="Previous photo"
            onClick={() => setIndex((i) => (i - 1 + photos.length) % photos.length)}
            className={`absolute left-1 top-1/2 -translate-y-1/2 bg-black/50 text-white rounded-full w-7 h-7 flex items-center justify-center transition-opacity ${arrowVisibility}`}
          >
            ‹
          </button>
          <button
            type="button"
            aria-label="Next photo"
            onClick={() => setIndex((i) => (i + 1) % photos.length)}
            className={`absolute right-1 top-1/2 -translate-y-1/2 bg-black/50 text-white rounded-full w-7 h-7 flex items-center justify-center transition-opacity ${arrowVisibility}`}
          >
            ›
          </button>
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
