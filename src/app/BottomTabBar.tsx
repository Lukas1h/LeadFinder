"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { NAV_LINKS } from "./nav-links";

export function BottomTabBar() {
  const pathname = usePathname();

  return (
    // sticky, not fixed — a fixed bottom bar rides the viewport's raw
    // coordinate space, which mobile Safari resizes whenever its address
    // bar shows/hides (e.g. on the scroll-to-top a route change triggers),
    // so it visibly jumps while a route's skeleton is up and its content
    // is a different height than the page that follows. Sticky is
    // positioned within normal layout flow instead, so it doesn't move
    // just because the address bar animates — same reasoning as
    // MobileHeader's sticky top bar.
    <nav
      className="sticky bottom-0 z-10 border-t bg-background/95 backdrop-blur-sm md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="flex h-14 items-stretch">
        {NAV_LINKS.map((link) => {
          const isActive = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium",
                isActive ? "text-primary" : "text-muted-foreground"
              )}
            >
              <link.icon className="size-5" />
              {link.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
