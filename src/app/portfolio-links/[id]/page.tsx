import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, Eye, MessageCircle, Pencil, Plus, Star, UserPlus, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { PortfolioEvent } from "@/db/schema";
import { getPortfolioActivity, type PortfolioVisit } from "../actions";
import { formatDuration } from "../duration";
import { CopyLinkButton } from "../CopyLinkButton";
import { portfolioPreviewUrl } from "@/lib/siteUrls";

// Page order, so the bars read top to bottom like the page itself.
const SECTIONS: { key: string; label: string }[] = [
  { key: "hero", label: "Headline" },
  { key: "before_after", label: "Before / after" },
  { key: "photos", label: "Photos" },
  { key: "video", label: "Video" },
  { key: "why", label: "Why Hahn Media" },
  { key: "listings", label: "Recent listings" },
  { key: "testimonial", label: "Review" },
  { key: "pricing", label: "Pricing" },
  { key: "book", label: "Book / save contact" },
];

const EVENT_LABELS: Record<PortfolioEvent, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  save_contact: { label: "Saved your contact", icon: UserPlus },
  book_shoot: { label: "Tapped Book a shoot", icon: MessageCircle },
  sound_on: { label: "Turned the video's sound on", icon: Volume2 },
  sound_off: { label: "Turned the sound off", icon: VolumeX },
  listing_prev: { label: "Previous photo", icon: ChevronLeft },
  listing_next: { label: "Next photo", icon: ChevronRight },
  reviews: { label: "Opened your Google reviews", icon: Star },
};

const when = (d: Date) => d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" });
const clock = (d: Date) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit", timeZone: "America/Los_Angeles" });

/** One agent page's activity: every visit, how long, how far, what they looked at and tapped. */
export default function PortfolioActivityPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <Suspense fallback={<Skeleton className="h-60 w-full" />}>
        <Activity params={params} />
      </Suspense>
    </main>
  );
}

async function Activity({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const activity = /^[0-9a-f-]{36}$/i.test(id) ? await getPortfolioActivity(id) : null;
  if (!activity) notFound();
  const { visits } = activity;

  const totalSeconds = visits.reduce((n, v) => n + v.activeSeconds, 0);
  const devices = new Set(visits.map((v) => `${v.ip}|${v.device}|${v.browser}`)).size;
  const allEvents = visits.flatMap((v) => v.events);
  const saves = allEvents.filter((e) => e.event === "save_contact").length;
  const books = allEvents.filter((e) => e.event === "book_shoot").length;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/portfolio-links" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Portfolio links
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">{activity.agentName ?? "No agent attached"}</h1>
            <p className="text-sm text-muted-foreground">
              {activity.area ? `${activity.area} · ` : ""}made {when(activity.createdAt)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" asChild>
              <a href={portfolioPreviewUrl(activity.url)} target="_blank" rel="noopener noreferrer">
                <Eye />
                Preview
              </a>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/portfolio-links/${activity.id}/edit`}>
                <Pencil />
                Edit
              </Link>
            </Button>
            <CopyLinkButton url={activity.url} />
            {activity.agentId && (
              <Button variant="outline" size="sm" asChild>
                <Link href={`/portfolio-links/new?agent=${activity.agentId}`}>
                  <Plus />
                  New link for them
                </Link>
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Visits" value={`${visits.length}`} sub={`${devices} device${devices === 1 ? "" : "s"}`} />
        <Stat label="Time on page" value={formatDuration(totalSeconds)} sub="tab visible" />
        <Stat label="Saved contact" value={`${saves}`} />
        <Stat label="Tapped Book" value={`${books}`} />
      </div>

      {visits.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No visits yet.
          {activity.viewCount > 0 && " (The page was loaded before visit tracking existed, or only by a link preview.)"}
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {visits.map((v) => (
            <Visit key={v.id} visit={v} />
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold">{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function Visit({ visit: v }: { visit: PortfolioVisit }) {
  const seen = SECTIONS.filter((s) => (v.sectionSeconds[s.key] ?? 0) > 0);
  const most = Math.max(1, ...seen.map((s) => v.sectionSeconds[s.key]));
  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="font-medium">{when(v.startedAt)}</p>
        <p className="text-sm text-muted-foreground">
          {formatDuration(v.activeSeconds)} on the page · scrolled {v.maxScrollPct}%
        </p>
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">
        {[v.device, v.browser, v.location, v.screen].filter(Boolean).join(" · ")}
      </p>

      {seen.length > 0 && (
        <div className="flex flex-col gap-1">
          {seen.map((s) => {
            const secs = v.sectionSeconds[s.key];
            return (
              <div key={s.key} className="grid grid-cols-[8.5rem_1fr_3.5rem] items-center gap-2 text-xs">
                <span className="truncate text-muted-foreground">{s.label}</span>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary/70" style={{ width: `${(secs / most) * 100}%` }} />
                </div>
                <span className="text-right tabular-nums">{formatDuration(secs)}</span>
              </div>
            );
          })}
        </div>
      )}

      {v.events.length > 0 && (
        <ul className="flex flex-col gap-1 border-t pt-2">
          {v.events.map((e) => {
            const { label, icon: Icon } = EVENT_LABELS[e.event] ?? { label: e.event, icon: ChevronRight };
            const strong = e.event === "save_contact" || e.event === "book_shoot";
            return (
              <li key={e.id} className="flex items-center gap-2 text-sm">
                <span className="w-20 shrink-0 text-xs tabular-nums text-muted-foreground">{clock(e.at)}</span>
                <Icon className={`size-4 shrink-0 ${strong ? "text-primary" : "text-muted-foreground"}`} />
                <span className={strong ? "font-medium" : ""}>
                  {label}
                  {e.detail && <span className="text-muted-foreground"> · {e.detail}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
