import Link from "next/link";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format";
import { listPortfolioLinks } from "./actions";

/**
 * Personalized portfolio links: who they were made for (Lukas's own
 * tracking — never shown on the page itself) and how many times they've
 * been opened, which is the point of sending one instead of a samples
 * attachment (lib/push.ts notifies on every view).
 */
export default function PortfolioLinksPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-10">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Portfolio links</h1>
        <Button asChild>
          <Link href="/portfolio-links/new">New link</Link>
        </Button>
      </div>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
        <LinkList />
      </Suspense>
    </main>
  );
}

async function LinkList() {
  const links = await listPortfolioLinks();
  if (links.length === 0) {
    return <p className="text-sm text-muted-foreground">None yet — &quot;New link&quot; builds one.</p>;
  }
  return (
    <ul className="flex flex-col gap-3">
      {links.map((l) => (
        <li key={l.id} className="rounded-lg border p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="font-medium">{l.agentName ?? "No agent attached"}</span>
            <span className="text-sm text-muted-foreground">
              {l.viewCount} view{l.viewCount === 1 ? "" : "s"}
              {l.lastViewedAt ? ` · last ${formatDate(l.lastViewedAt)}` : ""}
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between gap-3">
            <a href={l.url} target="_blank" rel="noopener noreferrer" className="text-sm text-muted-foreground underline">
              {l.url}
            </a>
            <span className="text-xs text-muted-foreground">{formatDate(l.createdAt)}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}
