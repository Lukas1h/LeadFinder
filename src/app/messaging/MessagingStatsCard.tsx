import { Mail, MessageCircle } from "lucide-react";
import type { MessagingStats, SendCounts } from "@/lib/messageStats";
import { formatPrice } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Stat, Sub } from "../Stat";

const count = (n: number) => n.toLocaleString("en-US");

/** Reply rate — one decimal under 10%, since cold email lives below 1%. */
function replyRate(c: SendCounts): string {
  if (c.sent === 0) return "—";
  const pct = (c.replied / c.sent) * 100;
  return `${pct < 10 ? pct.toFixed(1) : Math.round(pct)}%`;
}

/** Same layout as Booked's BookingStats, then a per-template breakdown. */
export function MessagingStatsCard({ stats }: { stats: MessagingStats }) {
  const { sms, email, revenue, templates } = stats;
  if (sms.sent + email.sent === 0) return null;
  const booked = sms.booked + email.booked;

  return (
    <Card className="p-4 gap-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Stat label="Last 7 days">
          {count(sms.sentRecent + email.sentRecent)} sent
          <Sub>
            {count(sms.sentRecent)} texts · {count(email.sentRecent)} emails
          </Sub>
        </Stat>
        <Stat label="Text replies">
          {replyRate(sms)}
          <Sub>
            {count(sms.replied)} of {count(sms.sent)} texts
          </Sub>
        </Stat>
        <Stat label="Email replies">
          {replyRate(email)}
          <Sub>
            {count(email.replied)} of {count(email.sent)} emails
          </Sub>
        </Stat>
        <Stat label="Booked">
          {count(booked)}
          <Sub>{formatPrice(revenue)} revenue</Sub>
        </Stat>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-x-4 gap-y-1.5 border-t pt-3 text-sm items-center">
        <span className="text-xs text-muted-foreground">Template</span>
        <span className="text-xs text-muted-foreground text-right">Sent</span>
        <span className="text-xs text-muted-foreground text-right">Replies</span>
        <span className="text-xs text-muted-foreground text-right">Booked</span>
        {templates.map((t) => (
          <TemplateRow key={`${t.presetId}-${t.channel}`} template={t} />
        ))}
      </div>
    </Card>
  );
}

function TemplateRow({ template: t }: { template: MessagingStats["templates"][number] }) {
  const Icon = t.channel === "email" ? Mail : MessageCircle;
  return (
    <>
      <span className={`flex items-center gap-1.5 min-w-0 ${t.archived ? "text-muted-foreground" : "text-foreground"}`}>
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">{t.name}</span>
        {t.type === "follow_up" && <span className="shrink-0 text-xs text-muted-foreground">follow-up</span>}
        {t.archived && <span className="shrink-0 text-xs text-muted-foreground">archived</span>}
      </span>
      <span className="text-right tabular-nums">{count(t.sent)}</span>
      <span className="text-right tabular-nums">
        {count(t.replied)} <span className="text-muted-foreground">· {replyRate(t)}</span>
      </span>
      <span className="text-right tabular-nums">{t.booked > 0 ? count(t.booked) : "—"}</span>
    </>
  );
}
