import Link from "next/link";
import { Suspense } from "react";
import { Activity, Eye, Pencil, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format";
import { listPortfolioLinks } from "./actions";
import { formatDuration } from "./duration";
import { CopyLinkButton } from "./CopyLinkButton";
import { portfolioPreviewUrl } from "@/lib/siteUrls";

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
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href="/portfolio-links/settings">
              <Settings />
              Settings
            </Link>
          </Button>
          <Button asChild>
            <Link href="/portfolio-links/new">New link</Link>
          </Button>
        </div>
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
            <Link href={`/portfolio-links/${l.id}`} className="font-medium hover:underline">
              {l.agentName ?? "No agent attached"}
            </Link>
            <span className="text-sm text-muted-foreground">
              {l.visits} visit{l.visits === 1 ? "" : "s"}
              {l.visits > 0 && ` · ${formatDuration(l.activeSeconds)}`}
              {l.lastViewedAt ? ` · last ${formatDate(l.lastViewedAt)}` : ""}
            </span>
          </div>
          {(l.contactSaves > 0 || l.bookTaps > 0) && (
            <p className="mt-1 text-sm font-medium text-primary">
              {[l.contactSaves > 0 && "Saved your contact", l.bookTaps > 0 && "Tapped Book a shoot"].filter(Boolean).join(" · ")}
            </p>
          )}
          <p className="mt-1 truncate font-mono text-xs text-muted-foreground">{l.url}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {/* ?preview=1: Lukas opening his own link isn't a visit. */}
            <Button variant="outline" size="sm" asChild>
              <a href={portfolioPreviewUrl(l.url)} target="_blank" rel="noopener noreferrer">
                <Eye />
                Preview
              </a>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/portfolio-links/${l.id}/edit`}>
                <Pencil />
                Edit
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/portfolio-links/${l.id}`}>
                <Activity />
                Activity
              </Link>
            </Button>
            <CopyLinkButton url={l.url} />
          </div>
        </li>
      ))}
    </ul>
  );
}
