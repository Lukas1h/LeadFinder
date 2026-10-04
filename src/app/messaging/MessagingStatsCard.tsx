import { Fragment } from "react";
import { Mail, MessageCircle } from "lucide-react";
import type { MessageChannel } from "@/db/schema";
import type { MessagingStats, SendCounts, TemplateSendStats } from "@/lib/messageStats";
import { formatPrice, formatRate } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Stat, Sub } from "../Stat";
import { ReplyTimingChart } from "./ReplyTimingChart";

const count = (n: number) => n.toLocaleString("en-US");
const replyRate = (c: SendCounts) => formatRate(c.replied, c.sent);

/** How many templates each channel's table shows. */
const TOP_TEMPLATES = 3;

const CHANNEL_GROUPS: { channel: MessageChannel; label: string; Icon: typeof Mail }[] = [
  { channel: "sms", label: "Texts", Icon: MessageCircle },
  { channel: "email", label: "Emails", Icon: Mail },
];

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

/** Same layout as Booked's BookingStats, then the top templates and reply timing. */
export function MessagingStatsCard({ stats }: { stats: MessagingStats }) {
  const { sms, email, revenue, templates, timing } = stats;
  if (sms.sent + email.sent === 0) return null;
  const booked = sms.booked + email.booked;
  const groups = CHANNEL_GROUPS.map((g) => ({ ...g, rows: topTemplates(templates, g.channel) })).filter(
    (g) => g.rows.length > 0
  );

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

      {groups.length > 0 && (
        <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-x-4 gap-y-1.5 border-t pt-3 text-sm items-center">
          {groups.map(({ channel, label, Icon, rows }, i) => (
            <Fragment key={channel}>
              {/* Each group repeats the column headers; one grid keeps the columns aligned across both. */}
              <span className={`flex items-center gap-1.5 text-xs font-medium text-muted-foreground ${i > 0 ? "pt-2" : ""}`}>
                <Icon className="size-3.5" />
                {label}
              </span>
              {["Sent", "Replies", "Booked"].map((h) => (
                <span key={h} className={`text-xs text-muted-foreground text-right ${i > 0 ? "pt-2" : ""}`}>
                  {h}
                </span>
              ))}
              {rows.map((t) => (
                <TemplateRow key={t.presetId} template={t} />
              ))}
            </Fragment>
          ))}
        </div>
      )}

      <ReplyTimingChart timing={timing} />
    </Card>
  );
}

function TemplateRow({ template: t }: { template: TemplateSendStats }) {
  return (
    <>
      <span className="truncate text-foreground">{t.name}</span>
      <span className="text-right tabular-nums">{count(t.sent)}</span>
      <span className="text-right tabular-nums">
        {count(t.replied)} <span className="text-muted-foreground">· {formatRate(t.replied, t.sent)}</span>
      </span>
      <span className="text-right tabular-nums">{t.booked > 0 ? count(t.booked) : "—"}</span>
    </>
  );
}
