"use client";

import type { ReactNode } from "react";
import { DropdownMenu } from "radix-ui";
import { Phone, MessageCircle, Mail, StickyNote, BellOff } from "lucide-react";
import type { Agent } from "@/db/schema";
import { resolveAvgDaysBetweenListings } from "./stats";
import { AgentDetailDialog } from "./AgentDetailDialog";
import { ComposeEmailDialog } from "@/app/messaging/ComposeEmailDialog";
import { startPendingInteraction } from "./interactionActions";
import { RelationshipBadge } from "@/app/badges";
import { scoreAgent } from "@/lib/agentBadge";
import { formatDate } from "@/lib/format";
import { telUrl, smsUrl } from "@/lib/sms";
import { FOLLOW_UP_SNOOZE_DAYS, snoozeLabel } from "@/app/follow-up/snooze";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export function AgentCard({
  agent,
  listingCount,
  listingDates,
  followUpDismiss,
  lastReplyAt,
  lead,
  textBody,
  children,
}: {
  agent: Agent;
  listingCount: number;
  // Just the dates the "~Nd between listings" stat needs. The dialog fetches
  // the agent's full listings itself when it opens.
  listingDates: { listedAt: Date | null; foundAt: Date }[];
  // When set, shows a "Not now" snooze button (the Follow up page's dismiss:
  // hides this agent from that list for the one, two or four weeks picked).
  followUpDismiss?: (agentId: string, days: number) => void;
  /** Their latest reply, shown on the Follow up page. */
  lastReplyAt?: Date | null;
  /** A line above the name, e.g. why they're on the Follow up page. */
  lead?: ReactNode;
  /** What the Text button opens Messages with. Empty when not given. */
  textBody?: string;
  /** Full-width extra row under the card, e.g. the listing they just put up. */
  children?: ReactNode;
}) {
  // Relationship status is shown as a read-only badge, not edited here: the
  // agent's name is right next to it and opens the detail dialog, which is
  // where the status dropdown lives. Two ways to set the same value on one card
  // meant the card's version could quietly disagree with the dialog's, and the
  // badge is what this row actually needs to say — who this person is.
  const callHref = telUrl(agent.phone);
  const avgDaysBetweenListings = resolveAvgDaysBetweenListings(agent, listingDates);
  const score = scoreAgent(agent);

  // Call and Text hand off to the dialer or Messages, so the app can't observe
  // whether they picked up or whether anything was sent. Park the attempt as
  // unresolved and let the app-wide prompt settle it on the way back, the same as the
  // Contact dialog's buttons do. Email needs none of this — it opens Compose
  // in place, and the send only gets written once it's actually sent.
  const logHandoff = (channel: "call" | "text") => {
    startPendingInteraction({ agentId: agent.id, channel }).catch(() => {});
  };

  return (
    <Card className="flex-row items-start justify-between gap-4 p-4 flex-wrap">
      <div className="min-w-0">
        {lead && <div className="mb-1">{lead}</div>}
        <div className="flex items-center gap-2 flex-wrap">
          <AgentDetailDialog
            agent={agent}
            trigger={
              <button type="button" className="font-semibold text-foreground hover:underline text-left">
                {agent.name ?? "Unknown name"}
              </button>
            }
          />
          <RelationshipBadge status={agent.relationshipStatus} agentName={agent.name} className="shrink-0" />
          {score.tier !== "unknown" && (
            <span
              className="shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
              title={[
                score.volumePerYear != null ? `~${score.volumePerYear}/yr` : null,
                score.avgPrice != null ? `~$${Math.round(score.avgPrice / 1000)}K avg` : null,
                score.driveMinutes != null ? `~${score.driveMinutes} min away` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            >
              {score.label}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-baseline gap-x-2">
          {agent.phone && <p className="text-xs text-muted-foreground font-mono mt-0.5">{agent.phone}</p>}
          {agent.email && <p className="text-xs text-muted-foreground font-mono mt-0.5">{agent.email}</p>}
        </div>
        <div className="text-sm text-muted-foreground mt-1.5 flex flex-wrap gap-x-3">
          <span>
            {listingCount} listing{listingCount === 1 ? "" : "s"}
          </span>
          {agent.lastContactedAt && <span>Last contacted {formatDate(agent.lastContactedAt)}</span>}
          {lastReplyAt && <span>Last replied {formatDate(lastReplyAt)}</span>}
          {avgDaysBetweenListings != null && <span>~{avgDaysBetweenListings}d between listings</span>}
        </div>


        {agent.notes && (
          <p className="flex items-start gap-1.5 text-sm text-muted-foreground mt-2 max-w-md">
            <StickyNote className="size-3.5 shrink-0 mt-0.5" />
            <span className="line-clamp-2">{agent.notes}</span>
          </p>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {followUpDismiss && (
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <Button
                variant="outline"
                size="icon"
                title="Not now: hide from Follow up for a while"
                aria-label={`Snooze ${agent.name ?? agent.phone} on Follow up`}
              >
                <BellOff />
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                sideOffset={4}
                className="z-50 min-w-40 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
              >
                <DropdownMenu.Label className="px-2 py-1.5 text-xs text-muted-foreground">
                  Hide for (a new listing still brings them back)
                </DropdownMenu.Label>
                {FOLLOW_UP_SNOOZE_DAYS.map((days) => (
                  <DropdownMenu.Item
                    key={days}
                    onSelect={() => followUpDismiss(agent.id, days)}
                    className="cursor-default rounded-sm px-2 py-1.5 text-sm outline-none select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                  >
                    {snoozeLabel(days)}
                  </DropdownMenu.Item>
                ))}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        )}
        {callHref && (
          <Button variant="outline" size="icon" asChild>
            <a
              href={callHref}
              onClick={() => logHandoff("call")}
              aria-label={`Call ${agent.name ?? agent.phone}`}
            >
              <Phone />
            </a>
          </Button>
        )}
        {agent.phone && (
          <Button variant="outline" size="icon" asChild>
            <a
              href={smsUrl(agent.phone, "")}
              onClick={(e) => {
                // Filled in on the click, not in the markup: the link's shape
                // depends on the device, which the server can't see.
                if (textBody) e.currentTarget.href = smsUrl(agent.phone!, textBody);
                logHandoff("text");
              }}
              aria-label={`Text ${agent.name ?? agent.phone}`}
            >
              <MessageCircle />
            </a>
          </Button>
        )}
        {agent.email && (
          <ComposeEmailDialog
            recipient={agent}
            trigger={
              <Button variant="outline" size="icon" aria-label={`Email ${agent.name ?? agent.email}`}>
                <Mail />
              </Button>
            }
          />
        )}
      </div>

      {children && <div className="basis-full min-w-0 -mx-2 -mb-2">{children}</div>}
    </Card>
  );
}
