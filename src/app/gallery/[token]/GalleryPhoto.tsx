"use client";

import { useState } from "react";
import { Check } from "lucide-react";

/**
 * One gallery tile — shows a spinner over the cream placeholder until the
 * proxied thumbnail actually loads, then fades it in. While picking photos
 * for virtual staging (onToggle set), a tap selects instead of opening.
 */
export function GalleryPhoto({
  thumbUrl,
  fullUrl,
  name,
  selected,
  onToggle,
}: {
  thumbUrl: string;
  fullUrl: string;
  name: string;
  selected?: boolean;
  onToggle?: () => void;
}) {
  const [loaded, setLoaded] = useState(false);

  return (
    <a
      href={fullUrl}
      target="_blank"
      rel="noopener noreferrer"
      onClick={
        onToggle
          ? (e) => {
              e.preventDefault();
              onToggle();
            }
          : undefined
      }
      className={`relative block aspect-[3/2] overflow-hidden rounded-lg border bg-[#F9F4F1] ${
        selected ? "border-[#D67F1F] ring-2 ring-[#D67F1F]" : "border-[#181A1C]/10"
      }`}
    >
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="size-5 rounded-full border-2 border-[#181A1C]/15 border-t-[#181A1C]/50 animate-spin" />
        </div>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element -- proxied Dropbox photo, not a static/optimizable local asset */}
      <img
        src={thumbUrl}
        alt={name}
        loading="lazy"
        onLoad={() => setLoaded(true)}
        className={`w-full h-full object-cover transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}
      />
      {onToggle && (
        <span
          className={`absolute top-2 right-2 flex size-6 items-center justify-center rounded-full border-2 ${
            selected ? "border-[#D67F1F] bg-[#D67F1F] text-white" : "border-white bg-black/30"
          }`}
        >
          {selected && <Check className="size-4" />}
        </span>
      )}
    </a>
  );
}
