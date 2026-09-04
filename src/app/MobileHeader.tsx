"use client";

import { usePathname } from "next/navigation";
import { NAV_LINKS } from "./nav-links";

export function MobileHeader() {
  const pathname = usePathname();
  const title = NAV_LINKS.find((link) => link.href === pathname)?.label ?? "LeadFinder";

  return (
    <header
      className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur-sm md:hidden"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div className="flex h-14 items-center justify-center px-4">
        <span className="text-lg font-semibold">{title}</span>
      </div>
    </header>
  );
}
