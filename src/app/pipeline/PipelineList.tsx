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
  Bell,
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
  FollowUpBadge,
} from "../badges";
import { findDuplicateAgentContact, FEW_PHOTOS_THRESHOLD } from "@/lib/pipeline";
import { daysSince, isDue } from "@/lib/format";
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

  const { manualFollowUp, replied, saved, followUpDue, quoted, waiting, closed } = useMemo(() => {
    // Distinct from the automatic contactedAt-driven followUpDue below —
    // this is a manually-set reminder, can apply to a listing in any
    // (non-terminal) status, and takes priority: pulled out of whichever
    // bucket it'd otherwise land in so it isn't shown twice.
    const manualFollowUp = filtered
      .filter((l) => l.status !== "booked" && l.status !== "declined" && l.followUpAt != null && isDue(l.followUpAt))
      .sort((a, b) => a.followUpAt!.getTime() - b.followUpAt!.getTime());
    const manualFollowUpIds = new Set(manualFollowUp.map((l) => l.id));
    const rest = filtered.filter((l) => !manualFollowUpIds.has(l.id));

    const replied = rest.filter((l) => l.status === "replied").sort((a, b) => byOldest(a, b, "statusChangedAt"));
    const saved = rest.filter((l) => l.status === "saved").sort((a, b) => byOldest(a, b, "statusChangedAt"));
    const followUpDue = rest
      .filter(
        (l) => l.status === "contacted" && l.contactedAt != null && daysSince(l.contactedAt) >= followUpAfterDays
      )
      .sort((a, b) => byOldest(a, b, "contactedAt"));
    const quoted = rest.filter((l) => l.status === "quoted").sort((a, b) => byOldest(a, b, "statusChangedAt"));
    const waiting = rest
      .filter(
        (l) => l.status === "contacted" && (l.contactedAt == null || daysSince(l.contactedAt) < followUpAfterDays)
      )
      .sort((a, b) => byOldest(a, b, "contactedAt"));
    const closed = rest
      .filter((l) => l.status === "booked" || l.status === "declined")
      .sort((a, b) => -byOldest(a, b, "statusChangedAt"));
    return { manualFollowUp, replied, saved, followUpDue, quoted, waiting, closed };
  }, [filtered, followUpAfterDays]);

  const needsAttentionEmpty =
    manualFollowUp.length === 0 && replied.length === 0 && saved.length === 0 && followUpDue.length === 0;
  const waitingEmpty = quoted.length === 0 && waiting.length === 0;
  const nothingFound = filtered.length === 0 && listings.length > 0;

  function card(
    lead: Listing,
    options?: { showDaysSinceContact?: boolean; showStatusBadge?: boolean; showFollowUp?: boolean }
  ) {
    const duplicateAgent = findDuplicateAgentContact(lead.agentPhone, lead.id, agentMap);
    return (
      <LeadCard
        key={lead.id}
        lead={lead}
        badges={
          <Fragment key={lead.id}>
            {/* Every other section is single-status, so the header already
                says it — showing it again on each card is redundant.
                Closed mixes booked + declined, and the manual follow-up
                section spans any status, so both still need the badge to
                tell listings apart. */}
            {options?.showStatusBadge && <StatusBadge status={lead.status} />}
            {options?.showFollowUp && lead.followUpAt && (
              <FollowUpBadge followUpAt={lead.followUpAt} followUpNote={lead.followUpNote} />
            )}
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
              {manualFollowUp.length > 0 && (
                <div>
                  <h2 className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400 mb-2">
                    <Bell className="size-3.5" />
                    Follow-up due
                  </h2>
                  <div className="flex flex-col gap-4">
                    {manualFollowUp.map((lead) =>
                      card(lead, { showStatusBadge: true, showFollowUp: true })
                    )}
                  </div>
                </div>
              )}
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
                <div className="flex flex-col gap-4 mt-3">
                  {closed.map((lead) => card(lead, { showStatusBadge: true }))}
                </div>
              </details>
            </>
          )}
        </div>
      )}
    </div>
  );
}
