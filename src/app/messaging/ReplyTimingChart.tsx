"use client";

import { useState } from "react";
import type { MessageChannel } from "@/db/schema";
import type { ReplyTiming, TimingBucket } from "@/lib/messageStats";
import { formatRate } from "@/lib/format";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

/** Below this many expected replies a bar is mostly luck, so it's faded. */
const MIN_EXPECTED_REPLIES = 5;

/**
 * Reply rate by the day and time a message went out, texts or emails. Plain
 * divs rather than a chart library — it's two rows of bars. Each bar shows how
 * many sends it rests on, and bars too thin to trust are faded, since a few
 * dozen texts a day can make any weekday look best.
 */
export function ReplyTimingChart({ timing }: { timing: Record<MessageChannel, ReplyTiming> }) {
  const [channel, setChannel] = useState<MessageChannel>("sms");
  const { byDay, byTime } = timing[channel];
  const sent = byDay.reduce((n, b) => n + b.sent, 0);
  const replied = byDay.reduce((n, b) => n + b.replied, 0);
  const minSent = replied > 0 ? (MIN_EXPECTED_REPLIES * sent) / replied : Infinity;

  return (
    <div className="flex flex-col gap-3 border-t pt-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs text-muted-foreground">Reply rate by when it was sent</h3>
        <Tabs value={channel} onValueChange={(v) => setChannel(v as MessageChannel)}>
          <TabsList>
            <TabsTrigger value="sms">Texts</TabsTrigger>
            <TabsTrigger value="email">Emails</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
        <Bars title="Day" buckets={byDay} minSent={minSent} />
        <Bars title="Time (Pacific)" buckets={byTime} minSent={minSent} />
      </div>
      <p className="text-[11px] text-muted-foreground">
        Number under each bar is sends. Faded bars have too few to tell yet.
      </p>
    </div>
  );
}

function Bars({ title, buckets: all, minSent }: { title: string; buckets: TimingBucket[]; minSent: number }) {
  // Nobody texts at 3 AM — empty blocks are dropped rather than drawn as zero.
  const buckets = all.filter((b) => b.sent > 0);
  const rate = (b: TimingBucket) => (b.sent > 0 ? b.replied / b.sent : 0);
  const max = Math.max(...buckets.map(rate), 0);
  const solid = buckets.filter((b) => b.sent >= minSent);
  const best = solid.length > 0 ? solid.reduce((a, b) => (rate(b) > rate(a) ? b : a)) : null;

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-foreground">{title}</span>
      <div className="flex gap-1.5">
        {buckets.map((b) => {
          const faded = b.sent < minSent;
          return (
            <div
              key={b.label}
              className="flex flex-1 min-w-0 flex-col items-center gap-1"
              title={`${b.replied} of ${b.sent} replied`}
            >
              <span className="text-[10px] tabular-nums text-muted-foreground">{formatRate(b.replied, b.sent)}</span>
              <div className="flex h-20 w-full items-end">
                <div
                  className={`w-full min-h-0.5 rounded-t-sm ${b === best ? "bg-primary" : "bg-primary/45"} ${faded ? "opacity-35" : ""}`}
                  style={{ height: `${max > 0 ? (rate(b) / max) * 100 : 0}%` }}
                />
              </div>
              <span className="text-[10px] text-foreground">{b.label}</span>
              <span className="text-[10px] tabular-nums text-muted-foreground">{b.sent.toLocaleString("en-US")}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
