import type { DayBucket } from "@/lib/messageStats";
import { formatRate } from "@/lib/format";

/** Below this many expected replies a bar is mostly luck, so it's faded. */
const MIN_EXPECTED_REPLIES = 5;

/**
 * Reply rate by the weekday a text went out. Plain divs rather than a chart
 * library — it's one row of bars. Bars too thin to trust are faded, since a few
 * dozen texts a day can make any weekday look best; hovering one shows the counts
 * behind it.
 *
 * Texts only. The card used to switch to emails on a toggle, but cold email is
 * a one-off campaign that's already been sent — showing a 0.3% reply rate for it
 * next to live texting only made the texting look worse.
 */
export function ReplyByDayChart({ days }: { days: DayBucket[] }) {
  const sent = days.reduce((n, d) => n + d.sent, 0);
  const replied = days.reduce((n, d) => n + d.replied, 0);
  const minSent = replied > 0 ? (MIN_EXPECTED_REPLIES * sent) / replied : Infinity;

  const rate = (d: DayBucket) => (d.sent > 0 ? d.replied / d.sent : 0);
  const max = Math.max(...days.map(rate), 0);
  const solid = days.filter((d) => d.sent >= minSent);
  const best = solid.length > 0 ? solid.reduce((a, b) => (rate(b) > rate(a) ? b : a)) : null;

  return (
    <div className="flex flex-col gap-2 border-t pt-3">
      <h3 className="text-xs text-muted-foreground">Reply rate by day sent</h3>
      <div className="flex gap-2">
        {days.map((d) => (
          <div
            key={d.label}
            className="flex flex-1 min-w-0 flex-col items-center gap-0.5"
            title={`${d.replied} of ${d.sent.toLocaleString("en-US")} replied`}
          >
            <span className="text-[10px] tabular-nums text-muted-foreground">{formatRate(d.replied, d.sent)}</span>
            <div className="flex h-10 w-full max-w-8 items-end">
              <div
                className={`w-full min-h-0.5 rounded-t-sm ${d === best ? "bg-primary" : "bg-primary/45"} ${d.sent < minSent ? "opacity-35" : ""}`}
                style={{ height: `${max > 0 ? (rate(d) / max) * 100 : 0}%` }}
              />
            </div>
            <span className="text-[10px] text-foreground">{d.label}</span>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">Faded days have too few sends to tell yet.</p>
    </div>
  );
}
