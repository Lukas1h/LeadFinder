"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Ellipsis } from "lucide-react";
import { cn } from "@/lib/utils";
import { NAV_LINKS, MORE_LINKS } from "./nav-links";

const TABS = [
  ...NAV_LINKS.filter((link) => "mobileTab" in link && link.mobileTab),
  { href: "/more", label: "More", icon: Ellipsis },
];

export function BottomTabBar() {
  const pathname = usePathname();
  // The More tab stays lit on any page it lists, so you can tell where you are.
  const inMore = pathname === "/more" || MORE_LINKS.some((link) => pathname.startsWith(link.href));

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-10 border-t bg-background/95 backdrop-blur-sm md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="flex h-14 items-stretch">
        {TABS.map((link) => {
          const isActive =
            link.href === "/more" ? inMore : link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
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
