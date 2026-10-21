"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Copy, HeartHandshake, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { dismissFollowUpAgent } from "@/app/agents/actions";
import { AgentCard } from "@/app/agents/AgentCard";
import { AgentDetailDialog } from "@/app/agents/AgentDetailDialog";
import { RelationshipBadge } from "@/app/badges";
import { formatDate } from "@/lib/format";
import { ListingRow } from "@/app/ListingRow";
import type { FollowUpItem, FollowUpUpcoming } from "./data";
import type { FeedItem, FollowUpFeed } from "./feeds";

/** What a card needs: a follow-up, or a feed item (which has no reason). */
type CardItem = Pick<FollowUpItem, "agent" | "lastReplyAt" | "label" | "suggestion"> &
  Partial<Pick<FollowUpItem, "reason" | "listing" | "address" | "city">> &
  Partial<Pick<FeedItem, "editorHref">>;

export function FollowUpList({
  today,
  later,
  doneToday,
  dailyTarget,
  upcoming,
  feeds,
  counts,
  dates,
}: {
  today: FollowUpItem[];
  later: FollowUpItem[];
  doneToday: number;
  dailyTarget: number;
  upcoming: FollowUpUpcoming[];
  feeds: FollowUpFeed[];
  counts: Record<string, number>;
  dates: Record<string, { listedAt: Date | null; foundAt: Date }[]>;
}) {
  const [, startTransition] = useTransition();
  // Hidden right away on snooze, rather than waiting for the refresh.
  const [snoozed, setSnoozed] = useState<Set<string>>(new Set());

  const dismiss = (id: string, days: number) => {
    setSnoozed((prev) => new Set(prev).add(id));
    startTransition(() => dismissFollowUpAgent(id, days));
  };

  const copy = (text: string) => {
    navigator.clipboard.writeText(text).then(
      () => toast.success("Copied"),
      () => toast.error("Couldn\u2019t copy")
    );
  };

  const now = today.filter((e) => !snoozed.has(e.agent.id));
  const next = later.filter((e) => !snoozed.has(e.agent.id));

  const card = (e: CardItem) => (
    <AgentCard
      key={e.agent.id}
      agent={e.agent}
      listingCount={counts[e.agent.id] ?? 0}
      listingDates={dates[e.agent.id] ?? []}
      followUpDismiss={dismiss}
      lastReplyAt={e.lastReplyAt}
      textBody={e.suggestion}
      lead={
        // The reason leads: it's what the text will be about. A plain "quiet" is the absence of one, so it's muted.
        <p
          className={
            e.reason === "quiet"
              ? "text-sm text-muted-foreground"
              : "text-sm font-medium text-emerald-700 dark:text-emerald-400"
          }
        >
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
      </div>
      {e.listing ? (
        <ListingRow listing={e.listing} />
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

  // The feeds (feeds/index.ts): offers that make an easy excuse to get back in touch, under the main list.
  const shownFeeds = feeds
    .map((f) => ({
      ...f,
      groups: f.groups
        .map((g) => ({ ...g, items: g.items.filter((e) => !snoozed.has(e.agent.id)) }))
        .filter((g) => g.items.length > 0 || g.heldBack > 0),
    }))
    .filter((f) => f.groups.length > 0);
  const feedSections = shownFeeds.length > 0 && (
    <div className="flex flex-col gap-6 border-t pt-8">
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-foreground">Feeds</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Extra reasons to get in touch, each built around one offer. Work them when the list above is done.
        </p>
      </div>
      {shownFeeds.map((f) => (
        <details key={f.key} open className="group rounded-xl border p-4">
          <summary className="cursor-pointer select-none text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            {f.title} ({f.groups.reduce((n, g) => n + g.items.length, 0)})
          </summary>
          <p className="text-sm text-muted-foreground mt-1">{f.blurb}</p>
          {f.groups.map((g) => (
            <div key={g.title} className="mt-4">
              <h3 className="text-sm font-medium text-foreground">{g.title}</h3>
              {g.items.length > 0 && <div className="flex flex-col gap-4 mt-2">{g.items.map(card)}</div>}
              {g.heldBack > 0 && (
                <p className="text-sm text-muted-foreground mt-2">
                  {g.items.length > 0 ? `${g.heldBack} more` : g.heldBack} heard from you too recently to ask.
                </p>
              )}
            </div>
          ))}
        </details>
      ))}
    </div>
  );

  // Everyone who isn't due yet, with the date they will be, so nobody is ever just missing from the page.
  const comingUp = upcoming.length > 0 && (
    <details>
      <summary className="text-sm font-semibold text-muted-foreground uppercase tracking-wide cursor-pointer select-none">
        Coming up ({upcoming.length})
      </summary>
      <p className="text-sm text-muted-foreground mt-1">
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
              <span className="text-xs text-muted-foreground">{u.note}</span>
            </div>
            <span className="text-sm text-muted-foreground shrink-0">
              {u.dueAt ? formatDate(u.dueAt) : "When they list or sell"}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );

  if (now.length === 0 && next.length === 0) {
    return (
      <div className="flex flex-col gap-8">
        <div className="flex flex-col items-center justify-center gap-2 text-center py-16 text-muted-foreground">
          <HeartHandshake className="size-8" />
          <p>Everyone you know has heard from you recently.</p>
        </div>
        {comingUp}
        {feedSections}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Today ({Math.min(doneToday, dailyTarget)} of {dailyTarget} done)
        </h2>
        {now.length > 0 ? (
          <>
            <p className="text-sm text-muted-foreground mt-1">
              The top of the list, {dailyTarget} a day. Text one or snooze it and the next moves up.
            </p>
            <div className="flex flex-col gap-4 mt-3">{now.map(card)}</div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground mt-1">
            {doneToday >= dailyTarget ? "That\u2019s today\u2019s five. The rest will keep." : "Nobody else is due."}
          </p>
        )}
      </section>
      {next.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Later ({next.length})
          </h2>
          <div className="flex flex-col gap-4">{next.map(card)}</div>
        </section>
      )}
      {comingUp}
      {feedSections}
    </div>
  );
}
