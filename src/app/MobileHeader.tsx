"use client";

import { usePathname } from "next/navigation";
import { NAV_LINKS } from "./nav-links";

export function MobileHeader() {
  const pathname = usePathname();
  const title = NAV_LINKS.find((link) => link.href === pathname)?.label ?? "LeadFinder";

  return (
    // Fixed dark background (not the theme-dependent bg-background token,
    // which is light) rather than a semantic color — this bar extends up
    // through the status bar/notch via the safe-area padding below, and
    // status bar glyphs render white under the black-translucent style
    // set in layout.tsx, so it needs to stay dark regardless of the
    // page's own light theme underneath it.
    <header
      className="sticky top-0 z-10 bg-[#111116] text-white border-b border-white/10 md:hidden"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div className="flex h-14 items-center justify-center px-4">
        <span className="text-lg font-semibold">{title}</span>
      </div>
    </header>
  );
}
