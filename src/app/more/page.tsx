import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { MORE_LINKS } from "../nav-links";

// Mobile overflow menu — the pages that don't fit in the bottom tab bar.
export default function MorePage() {
  return (
    <main className="max-w-3xl mx-auto w-full px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground mb-6 hidden md:block">More</h1>
      <nav className="flex flex-col divide-y rounded-xl border bg-card">
        {MORE_LINKS.map((link) => (
          <Link key={link.href} href={link.href} className="flex items-center gap-3 px-4 py-3.5 active:bg-muted">
            <link.icon className="size-5 text-muted-foreground" />
            <span className="flex-1 font-medium">{link.label}</span>
            <ChevronRight className="size-4 text-muted-foreground" />
          </Link>
        ))}
      </nav>
    </main>
  );
}
