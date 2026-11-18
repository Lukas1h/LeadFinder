import Link from "next/link";
import { Suspense } from "react";
import { VERTICALS } from "@/lib/verticals";
import { verticalCounts } from "./data";

/** Side niches (roofing…), kept apart from the agent funnel: one card per vertical in lib/verticals.ts. */
export default function VerticalsPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-10">
      <h1 className="text-2xl font-semibold">Other verticals</h1>
      <p className="mt-1 mb-6 text-sm text-muted-foreground">Side niches, kept apart from the real estate funnel.</p>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
        <VerticalCards />
      </Suspense>
    </main>
  );
}

async function VerticalCards() {
  const counts = await verticalCounts();
  return (
    <ul className="flex flex-col gap-3">
      {Object.values(VERTICALS).map((v) => {
        const c = counts[v.key] ?? { links: 0, opened: 0, saved: 0 };
        return (
          <li key={v.key}>
            <Link href={`/verticals/${v.key}`} className="block rounded-lg border p-4 transition-colors hover:bg-accent/50">
              <p className="font-medium">{v.label}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {c.links} link{c.links === 1 ? "" : "s"} · {c.opened} opened · {c.saved} saved contact
              </p>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
