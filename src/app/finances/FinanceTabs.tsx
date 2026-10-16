"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/finances", label: "Overview" },
  { href: "/finances/jobs", label: "Jobs" },
  { href: "/finances/expenses", label: "Expenses" },
  { href: "/finances/mileage", label: "Mileage" },
  { href: "/finances/taxes", label: "Taxes" },
] as const;

export function FinanceTabs() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto border-b mb-6 -mx-1 px-1">
      {TABS.map((tab) => {
        const active = tab.href === "/finances" ? pathname === "/finances" : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`px-3 py-2 text-sm whitespace-nowrap border-b-2 -mb-px transition-colors ${
              active ? "border-foreground text-foreground font-medium" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
