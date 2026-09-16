"use client";

import { useState } from "react";

/** One gallery tile — shows a spinner over the cream placeholder until the proxied thumbnail actually loads, then fades it in. */
export function GalleryPhoto({ thumbUrl, fullUrl, name }: { thumbUrl: string; fullUrl: string; name: string }) {
  const [loaded, setLoaded] = useState(false);

  return (
    <a
      href={fullUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="relative block aspect-[3/2] overflow-hidden rounded-lg border border-[#181A1C]/10 bg-[#F9F4F1]"
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
    </a>
  );
}
