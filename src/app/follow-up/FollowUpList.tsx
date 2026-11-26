"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Copy, HeartHandshake, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { passFollowUpAgent } from "@/app/agents/actions";
import { AgentCard } from "@/app/agents/AgentCard";
import { AgentDetailDialog } from "@/app/agents/AgentDetailDialog";
import { AgentSignalBadges, RelationshipBadge } from "@/app/badges";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ListingRow } from "@/app/ListingRow";
import type { LeadListing } from "@/app/leads-data";
import type { FollowUpStats, FollowUpUpcoming } from "./data";
import type { FeedItem, FollowUpFeed } from "./feeds";

const COMING_UP = "coming_up";
const COLD_EXPLAINER = "Agents who never replied to your first text. One follow-up each.";
const COLD_TAG =
  "rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-none bg-slate-50 text-slate-700 border-slate-200 dark:bg-slate-950 dark:text-slate-400 dark:border-slate-800";

/** Cold feeds: agents who never answered his first text (the logic workers' `cold` flag). */
const isCold = (f: FollowUpFeed) => f.cold === true;

/**
 * The Follow up page: one tab per feed (feeds/index.ts), each showing how
 * many are in it, plus "Coming up" for everyone not due yet. The tab is in
 * the URL (?feed=) so coming back from the photo editor lands on the same one.
 */
export function FollowUpList({
  feeds,
  upcoming,
  stats,
  counts,
  dates,
}: {
  feeds: FollowUpFeed[];
  upcoming: FollowUpUpcoming[];
  stats: FollowUpStats;
  counts: Record<string, number>;
  dates: Record<string, { listedAt: Date | null; foundAt: Date }[]>;
}) {
  const [, startTransition] = useTransition();
  // Hidden right away on pass, rather than waiting for the refresh. Keyed by
  // feed, agent and listing: a pass only takes the card off its own feed.
  const [passed, setPassed] = useState<Set<string>>(new Set());
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const passKey = (feedKey: string, e: FeedItem) => `${feedKey}|${e.agent.id}|${e.listing?.id ?? ""}`;
  const pass = (feedKey: string, e: FeedItem) => {
    setPassed((prev) => new Set(prev).add(passKey(feedKey, e)));
    startTransition(async () => {
      try {
        await passFollowUpAgent(e.agent.id, feedKey, e.listing?.id ?? null);
      } catch {
        setPassed((prev) => {
          const next = new Set(prev);
          next.delete(passKey(feedKey, e));
          return next;
        });
        toast.error("Couldn\u2019t pass. Try again.");
      }
    });
  };

  const copy = (text: string) => {
    navigator.clipboard.writeText(text).then(
      () => toast.success("Copied"),
      () => toast.error("Couldn\u2019t copy")
    );
  };

  const card = (e: FeedItem, feedKey: string, muted = false, cold = false) => (
    <AgentCard
      key={e.agent.id}
      agent={e.agent}
      listingCount={counts[e.agent.id] ?? 0}
      listingDates={dates[e.agent.id] ?? []}
      followUpPass={() => pass(feedKey, e)}
      lastReplyAt={e.lastReplyAt}
      textBody={e.suggestion}
      textSecond={e.secondText}
      followUpFeed={feedKey}
      lead={
        // The reason leads: it's what the text will be about. A plain check-in is the absence of one, so it's muted.
        <p
          className={cn(
            muted || cold ? "text-sm text-muted-foreground" : "text-sm font-medium text-emerald-700 dark:text-emerald-400",
            cold && "flex flex-wrap items-center gap-1.5"
          )}
        >
          {cold && <span className={COLD_TAG}>Cold</span>}
          {e.label}
        </p>
      }
    >
      {/* A text to start from. The Text button opens Messages with it; Copy is for a desktop that can't. */}
      <div className="mx-2 mb-2 rounded-md bg-muted/60 px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">Suggested text</p>
          <button
            type="button"
            onClick={() => copy(e.suggestion)}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <Copy className="size-3" />
            Copy
          </button>
        </div>
        <p className="text-sm text-foreground mt-1">{e.suggestion}</p>
        {e.secondText && <p className="text-xs text-muted-foreground mt-1">Then: &ldquo;{e.secondText}&rdquo;</p>}
      </div>
      {e.listing ? (
        // follow-up/page.tsx attaches the drive lines on the server; feeds/types.ts
        // (Lukas's file) still types a feed's listing as a plain row.
        <ListingRow listing={e.listing as LeadListing} />
      ) : (
        e.address && <p className="text-sm text-foreground px-2">{[e.address, e.city].filter(Boolean).join(", ")}</p>
      )}
      {e.editorHref && (
        <div className="px-2 pb-2">
          <Link
            href={e.editorHref}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700 hover:underline dark:text-emerald-400"
          >
            <Wand2 className="size-4" />
            Open in photo editor
          </Link>
        </div>
      )}
    </AgentCard>
  );

  const shownFeeds = feeds.map((f) => {
    const groups = f.groups
      .map((g) => ({ ...g, items: g.items.filter((e) => !passed.has(passKey(f.key, e))) }))
      .filter((g) => g.items.length > 0 || g.heldBack > 0);
    return { ...f, groups, count: groups.reduce((n, g) => n + g.items.length, 0) };
  });
  // Warm feeds and Coming up first, then the cold ones in their own group after a divider.
  const tabs = [
    ...shownFeeds.filter((f) => !isCold(f)).map((f) => ({ key: f.key as string, title: f.title, count: f.count, cold: false })),
    { key: COMING_UP, title: "Coming up", count: upcoming.length, cold: false },
    ...shownFeeds.filter(isCold).map((f) => ({ key: f.key as string, title: f.title, count: f.count, cold: true })),
  ];
  const asked = params.get("feed");
  const active =
    tabs.find((t) => t.key === asked)?.key ?? shownFeeds.find((f) => f.count > 0)?.key ?? tabs[0].key;
  const select = (key: string) => {
    const next = new URLSearchParams(params);
    next.set("feed", key);
    router.replace(`${pathname}?${next}`, { scroll: false });
  };
  const feed = shownFeeds.find((f) => f.key === active);

  // Everyone who isn't due yet, with the date they will be, so nobody is ever just missing from the page.
  const comingUp = upcoming.length > 0 && (
    <section>
      <p className="text-sm text-muted-foreground">
        Not due yet. Interested agents come back 2 weeks after your last contact, warm agents after 3, clients after
        4, or sooner if they list or sell something.
      </p>
      <ul className="mt-3 divide-y rounded-lg border">
        {upcoming.map((u) => (
          <li key={u.agent.id} className="flex items-center justify-between gap-3 px-3 py-2">
            <div className="flex items-center gap-2 min-w-0 flex-wrap">
              <AgentDetailDialog
                agent={u.agent}
                trigger={
                  <button type="button" className="text-sm font-medium text-foreground hover:underline text-left">
                    {u.agent.name ?? "Unknown name"}
                  </button>
                }
              />
              <RelationshipBadge status={u.agent.relationshipStatus} agentName={u.agent.name} className="shrink-0" />
              <AgentSignalBadges agent={u.agent} />
              <span className="text-xs text-muted-foreground">{u.note}</span>
            </div>
            <span className="text-sm text-muted-foreground shrink-0">
              {u.dueAt ? formatDate(u.dueAt) : "When they list or sell"}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Today" {...stats.today} />
        <Stat label="This week" {...stats.week} />
      </div>

      <div className="-mx-6 overflow-x-auto px-6 border-b">
        <div role="tablist" className="flex gap-1 w-max">
          {tabs.map((t, i) => [
            t.cold && !tabs[i - 1]?.cold && (
              <div key="cold-divider" className="flex items-center gap-1.5 pl-2 pr-1" aria-hidden>
                <span className="h-5 w-px bg-border" />
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Cold
                </span>
              </div>
            ),
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={t.key === active}
              onClick={() => select(t.key)}
              className={cn(
                "flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium -mb-px transition-colors",
                t.key === active
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {t.title}
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-xs tabular-nums",
                  t.key === active ? "bg-foreground text-background" : "bg-muted text-muted-foreground"
                )}
              >
                {t.count}
              </span>
            </button>,
          ])}
        </div>
      </div>

      {active === COMING_UP ? (
        comingUp || <p className="text-sm text-muted-foreground">Everyone you know is due now.</p>
      ) : feed && (feed.count + feed.groups.reduce((n, g) => n + g.heldBack, 0) > 0 || feed.stats) ? (
        <section>
          {isCold(feed) && (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-950">
              <span className={COLD_TAG}>Cold</span>
              <p className="text-sm text-slate-700 dark:text-slate-300">{COLD_EXPLAINER}</p>
            </div>
          )}
          <p className="text-sm text-muted-foreground">{feed.blurb}</p>
          {feed.stats && (
            <p className="text-xs text-muted-foreground mt-1">
              Last {feed.stats.days} days: {feed.stats.replied} of {feed.stats.reached} reached from here replied
              {feed.stats.reached > 0 && ` (${Math.round((feed.stats.replied / feed.stats.reached) * 100)}%)`}
              {feed.stats.warm > 0 &&
                ` · ${feed.stats.converted} of ${feed.stats.warm} warm turned interested (${Math.round(
                  (feed.stats.converted / feed.stats.warm) * 100
                )}%)`}
            </p>
          )}
          {feed.groups.length === 0 && <p className="text-sm text-muted-foreground mt-5">Nobody here right now.</p>}
          {feed.groups.map((g) => (
            <div key={g.title} className="mt-5">
              {feed.groups.length > 1 && <h3 className="text-sm font-medium text-foreground">{g.title}</h3>}
              {g.items.length > 0 && <div className="flex flex-col gap-4 mt-2">{g.items.map((e) => card(e, feed.key, feed.muted, isCold(feed)))}</div>}
              {g.heldBack > 0 && (
                <p className="text-sm text-muted-foreground mt-2">
                  {g.items.length > 0 ? `${g.heldBack} more` : g.heldBack} heard from you too recently to ask.
                </p>
              )}
            </div>
          ))}
        </section>
      ) : (
        <div className="flex flex-col items-center justify-center gap-2 text-center py-16 text-muted-foreground">
          <HeartHandshake className="size-8" />
          <p>Nobody here right now.</p>
        </div>
      )}
    </div>
  );
}

/** Follow-ups done (back in touch after a gap) against the pace, and how many have answered since. */
function Stat({ label, done, target, replied }: { label: string; done: number; target: number; replied: number }) {
  const pct = Math.min(100, Math.round((done / Math.max(1, target)) * 100));
  return (
    <div className="rounded-xl border p-4">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
        {done}
        <span className="text-base font-normal text-muted-foreground"> / {target}</span>
      </p>
      <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={cn("h-full rounded-full", done >= target ? "bg-emerald-500" : "bg-foreground")}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {replied} {replied === 1 ? "reply" : "replies"}
      </p>
    </div>
  );
}
