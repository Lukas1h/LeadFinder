"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { NAV_LINKS, mobileTabFor } from "./nav-links";

export function MobileHeader() {
  const pathname = usePathname();
  const title = NAV_LINKS.find((link) => link.href === pathname)?.label ?? "LeadFinder";
  // Each tab's header links to its paired page (Leads → Pipeline, …), and the
  // paired page's header links back.
  const pair = mobileTabFor(pathname);

  return (
    // Fixed dark background (not the theme-dependent bg-background token,
    // which is light) rather than a semantic color — this bar extends up
    // through the status bar/notch via the safe-area padding below, and
    // status bar glyphs render white under the black-translucent style
    // set in layout.tsx, so it needs to stay dark regardless of the
    // page's own light theme underneath it.
    <header
      className="sticky top-0 z-10 bg-black text-white border-b border-white/10 md:hidden"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div className="relative flex h-14 items-center justify-center px-4">
        {pair?.onCompanion && (
          <Link
            href={pair.tab.href}
            className="absolute left-2 flex items-center gap-0.5 rounded-md px-2 py-1.5 text-sm text-white/80 active:bg-white/10"
          >
            <ChevronLeft className="size-4" />
            {pair.tab.label}
          </Link>
        )}
        <span className="text-lg font-semibold">{title}</span>
        {pair && !pair.onCompanion && (
          <Link
            href={pair.companion.href}
            className="absolute right-2 flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-white/80 active:bg-white/10"
          >
            <pair.companion.icon className="size-4" />
            {pair.companion.label}
          </Link>
        )}
      </div>
    </header>
  );
}
