"use client";

import { Fragment, useMemo, useState } from "react";
import {
  Search,
  Inbox,
  MessageSquareReply,
  Bookmark,
  Clock,
  FileText,
  Send,
  ChevronRight,
} from "lucide-react";
import type { Agent, Listing } from "@/db/schema";
import { LeadCard } from "../LeadCard";
import { PipelineActions } from "../PipelineActions";
import {
  StatusBadge,
  DuplicateAgentBadge,
  PhotoScoreBadge,
  ComingSoonBadge,
  FewPhotosBadge,
  DaysSinceContactBadge,
} from "../badges";
import { findDuplicateAgentContact, FEW_PHOTOS_THRESHOLD } from "@/lib/pipeline";
import { daysSince } from "@/lib/format";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

function byOldest(a: Listing, b: Listing, field: "statusChangedAt" | "contactedAt") {
  const aTime = a[field]?.getTime() ?? 0;
  const bTime = b[field]?.getTime() ?? 0;
  return aTime - bTime;
}

function matchesSearch(lead: Listing, query: string): boolean {
  if (!query) return true;
  if (lead.address?.toLowerCase().includes(query)) return true;
  if (lead.city?.toLowerCase().includes(query)) return true;
  if (lead.state?.toLowerCase().includes(query)) return true;
  if (lead.agentName?.toLowerCase().includes(query)) return true;
  return false;
}

export function PipelineList({
  listings,
  agentByPhone,
  addressById,
  followUpAfterDays,
}: {
  listings: Listing[];
  agentByPhone: Record<string, Agent>;
  addressById: Record<string, string | null>;
  followUpAfterDays: number;
}) {
  const [search, setSearch] = useState("");

  const agentMap = useMemo(() => new Map(Object.entries(agentByPhone)), [agentByPhone]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return listings.filter((l) => matchesSearch(l, query));
  }, [listings, search]);

  const { replied, saved, followUpDue, quoted, waiting, closed } = useMemo(() => {
    const replied = filtered.filter((l) => l.status === "replied").sort((a, b) => byOldest(a, b, "statusChangedAt"));
    const saved = filtered.filter((l) => l.status === "saved").sort((a, b) => byOldest(a, b, "statusChangedAt"));
    const followUpDue = filtered
      .filter(
        (l) => l.status === "contacted" && l.contactedAt != null && daysSince(l.contactedAt) >= followUpAfterDays
      )
      .sort((a, b) => byOldest(a, b, "contactedAt"));
    const quoted = filtered.filter((l) => l.status === "quoted").sort((a, b) => byOldest(a, b, "statusChangedAt"));
    const waiting = filtered
      .filter(
        (l) => l.status === "contacted" && (l.contactedAt == null || daysSince(l.contactedAt) < followUpAfterDays)
      )
      .sort((a, b) => byOldest(a, b, "contactedAt"));
    const closed = filtered
      .filter((l) => l.status === "booked" || l.status === "declined")
      .sort((a, b) => -byOldest(a, b, "statusChangedAt"));
    return { replied, saved, followUpDue, quoted, waiting, closed };
  }, [filtered, followUpAfterDays]);

  const needsAttentionEmpty = replied.length === 0 && saved.length === 0 && followUpDue.length === 0;
  const waitingEmpty = quoted.length === 0 && waiting.length === 0;
  const nothingFound = filtered.length === 0 && listings.length > 0;

  function card(lead: Listing, options?: { showDaysSinceContact?: boolean }) {
    const duplicateAgent = findDuplicateAgentContact(lead.agentPhone, lead.id, agentMap);
    return (
      <LeadCard
        key={lead.id}
        lead={lead}
        badges={
          <Fragment key={lead.id}>
            <StatusBadge status={lead.status} />
            {options?.showDaysSinceContact && lead.contactedAt && (
              <DaysSinceContactBadge contactedAt={lead.contactedAt} />
            )}
            {lead.isComingSoon && <ComingSoonBadge />}
            {lead.photoCount != null && lead.photoCount < FEW_PHOTOS_THRESHOLD && (
              <FewPhotosBadge count={lead.photoCount} />
            )}
            {lead.score != null && <PhotoScoreBadge score={lead.score} reasoning={lead.scoreReasoning} />}
            {duplicateAgent && (
              <DuplicateAgentBadge
                duplicateAgent={duplicateAgent}
                duplicateAddress={addressById[duplicateAgent.lastContactedListingId!]}
              />
            )}
          </Fragment>
        }
        actions={
          <PipelineActions
            key={lead.id}
            listingId={lead.id}
            status={lead.status}
            agentName={lead.agentName}
            agentPhone={lead.agentPhone}
          />
        }
      />
    );
  }

  if (listings.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 text-center py-16 text-muted-foreground">
        <Inbox className="size-8" />
        <p>Nothing here yet — save or message a lead from the Leads page to get started.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by address, city, or agent…"
          className="pl-9"
        />
      </div>

      {nothingFound ? (
        <p className="text-muted-foreground/70 text-sm">No leads match &ldquo;{search}&rdquo;.</p>
      ) : (
        <div className="flex flex-col gap-6">
          {!needsAttentionEmpty && (
            <>
              {replied.length > 0 && (
                <div>
                  <h2 className="flex items-center gap-1.5 text-xs font-medium text-purple-700 dark:text-purple-400 mb-2">
                    <MessageSquareReply className="size-3.5" />
                    Replied — respond
                  </h2>
                  <div className="flex flex-col gap-4">{replied.map((lead) => card(lead))}</div>
                </div>
              )}
              {saved.length > 0 && (
                <div>
                  <h2 className="flex items-center gap-1.5 text-xs font-medium text-blue-700 dark:text-blue-400 mb-2">
                    <Bookmark className="size-3.5" />
                    Saved — ready to message
                  </h2>
                  <div className="flex flex-col gap-4">{saved.map((lead) => card(lead))}</div>
                </div>
              )}
              {followUpDue.length > 0 && (
                <div>
                  <h2 className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400 mb-2">
                    <Clock className="size-3.5" />
                    Needs follow-up
                  </h2>
                  <div className="flex flex-col gap-4">
                    {followUpDue.map((lead) => card(lead, { showDaysSinceContact: true }))}
                  </div>
                </div>
              )}
            </>
          )}

          {!waitingEmpty && (
            <>
              {!needsAttentionEmpty && <Separator />}
              {quoted.length > 0 && (
                <div>
                  <h2 className="flex items-center gap-1.5 text-xs font-medium text-indigo-700 dark:text-indigo-400 mb-2">
                    <FileText className="size-3.5" />
                    Quoted — awaiting decision
                  </h2>
                  <div className="flex flex-col gap-4">{quoted.map((lead) => card(lead))}</div>
                </div>
              )}
              {waiting.length > 0 && (
                <div>
                  <h2 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-2">
                    <Send className="size-3.5" />
                    Contacted — awaiting reply
                  </h2>
                  <div className="flex flex-col gap-4">{waiting.map((lead) => card(lead))}</div>
                </div>
              )}
            </>
          )}

          {closed.length > 0 && (
            <>
              {(!needsAttentionEmpty || !waitingEmpty) && <Separator />}
              <details className="group/details">
                <summary className="flex items-center gap-1 text-xs font-medium text-muted-foreground mb-2 cursor-pointer select-none list-none">
                  <ChevronRight className="size-3.5 transition-transform group-open/details:rotate-90" />
                  Closed ({closed.length})
                </summary>
                <div className="flex flex-col gap-4 mt-3">{closed.map((lead) => card(lead))}</div>
              </details>
            </>
          )}
        </div>
      )}
    </div>
  );
}
