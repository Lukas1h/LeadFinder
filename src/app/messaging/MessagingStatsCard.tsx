import { Mail, MessageCircle } from "lucide-react";
import type { MessageChannel } from "@/db/schema";
import type { MessagingStats, SendCounts, TemplateSendStats } from "@/lib/messageStats";
import { formatPrice, formatRate } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Stat, Sub } from "../Stat";
import { ReplyByDayChart } from "./ReplyByDayChart";

const count = (n: number) => n.toLocaleString("en-US");
const replyRate = (c: SendCounts) => formatRate(c.replied, c.sent);

/** How many templates each channel's table shows. */
const TOP_TEMPLATES = 3;


/**
 * The top live cold-outreach templates per channel, by replies (then
 * bookings). Archived templates, follow-ups and anything without a reply are
 * left out; the totals above still count every send.
 */
function topTemplates(templates: TemplateSendStats[], channel: MessageChannel): TemplateSendStats[] {
  return templates
    .filter((t) => t.channel === channel && t.replied > 0 && !t.archived && t.type !== "follow_up")
    .sort((a, b) => b.replied - a.replied || b.booked - a.booked)
    .slice(0, TOP_TEMPLATES);
}

/** Same layout as Booked's BookingStats, then the top templates and reply rate by day. */
export function MessagingStatsCard({ stats }: { stats: MessagingStats }) {
  const { sms, email, revenue, templates, byDay } = stats;
  if (sms.sent + email.sent === 0) return null;
  const booked = sms.booked + email.booked;
  // Texts first, then emails.
  const shown = [...topTemplates(templates, "sms"), ...topTemplates(templates, "email")];

  return (
    <Card className="p-4 gap-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Stat label="Last 30 days">
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

      {shown.length > 0 && (
        <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-x-4 gap-y-1.5 border-t pt-3 text-sm items-center">
          <span className="text-xs text-muted-foreground">Template</span>
          <span className="text-xs text-muted-foreground text-right">Sent</span>
          <span className="text-xs text-muted-foreground text-right">Replies</span>
          <span className="text-xs text-muted-foreground text-right">Booked</span>
          {shown.map((t) => (
            <TemplateRow key={`${t.presetId}-${t.channel}`} template={t} />
          ))}
        </div>
      )}

      <ReplyByDayChart byDay={byDay} />
    </Card>
  );
}

function TemplateRow({ template: t }: { template: TemplateSendStats }) {
  return (
    <>
      <span className="flex items-center gap-1.5 min-w-0 text-foreground">
        {t.channel === "email" ? (
          <Mail className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <MessageCircle className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="truncate">{t.name}</span>
      </span>
      <span className="text-right tabular-nums">{count(t.sent)}</span>
      <span className="text-right tabular-nums">
        {count(t.replied)} <span className="text-muted-foreground">· {formatRate(t.replied, t.sent)}</span>
      </span>
      <span className="text-right tabular-nums">{t.booked > 0 ? count(t.booked) : "—"}</span>
    </>
  );
}
