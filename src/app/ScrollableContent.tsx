"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

// Scrolling happens here instead of on the document. Keeps the native
// scrollbar indicator confined to the area between the header and tab bar
// (mobile only, via md:contents — desktop keeps scrolling the document like
// before) instead of it running the full screen height on top of them.
// Next's own scroll-to-top-on-navigate targets the window, which no longer
// scrolls, so it's reproduced here against this container instead.
export function ScrollableContent({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    ref.current?.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div ref={ref} className="flex-1 overflow-y-auto overscroll-contain md:contents">
      {children}
    </div>
  );
}
