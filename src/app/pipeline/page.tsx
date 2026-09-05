import { Fragment, Suspense } from "react";
import { Inbox, MessageSquareReply, Bookmark, Clock, ChevronRight, FileText } from "lucide-react";
import { db } from "@/db";
import { listings, agents, type Listing } from "@/db/schema";
import { ne, inArray } from "drizzle-orm";
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
import { findDuplicateAgentContact, FOLLOW_UP_AFTER_DAYS, FEW_PHOTOS_THRESHOLD } from "@/lib/pipeline";
import { daysSince } from "@/lib/format";
import { Separator } from "@/components/ui/separator";
import { PipelineSkeleton } from "./loading";

function byOldest(a: Listing, b: Listing, field: "statusChangedAt" | "contactedAt") {
  const aTime = a[field]?.getTime() ?? 0;
  const bTime = b[field]?.getTime() ?? 0;
  return aTime - bTime;
}

export default function PipelinePage() {
  return (
    <main className="max-w-3xl mx-auto w-full px-6 py-10">
      <Suspense fallback={<PipelineSkeleton />}>
        <PipelineContent />
      </Suspense>
    </main>
  );
}

async function PipelineContent() {
  // Independent of each other, so run them concurrently instead of paying
  // for two sequential round trips to Neon.
  const [all, allAgents] = await Promise.all([
    db.select().from(listings).where(ne(listings.status, "new")),
    db.select().from(agents),
  ]);
  const agentByPhone = new Map(allAgents.map((a) => [a.phone, a]));
  const referencedIds = allAgents
    .map((a) => a.lastContactedListingId)
    .filter((id): id is string => id != null);
  const referencedListings =
    referencedIds.length > 0
      ? await db
          .select({ id: listings.id, address: listings.address })
          .from(listings)
          .where(inArray(listings.id, referencedIds))
      : [];
  const addressById = new Map(referencedListings.map((l) => [l.id, l.address]));

  const replied = all.filter((l) => l.status === "replied").sort((a, b) => byOldest(a, b, "statusChangedAt"));
  const saved = all.filter((l) => l.status === "saved").sort((a, b) => byOldest(a, b, "statusChangedAt"));
  const followUpDue = all
    .filter(
      (l) => l.status === "contacted" && l.contactedAt != null && daysSince(l.contactedAt) >= FOLLOW_UP_AFTER_DAYS
    )
    .sort((a, b) => byOldest(a, b, "contactedAt"));
  const quoted = all.filter((l) => l.status === "quoted").sort((a, b) => byOldest(a, b, "statusChangedAt"));
  const waiting = all
    .filter(
      (l) => l.status === "contacted" && (l.contactedAt == null || daysSince(l.contactedAt) < FOLLOW_UP_AFTER_DAYS)
    )
    .sort((a, b) => byOldest(a, b, "contactedAt"));
  const closed = all
    .filter((l) => l.status === "booked" || l.status === "declined")
    .sort((a, b) => -byOldest(a, b, "statusChangedAt"));

  const needsAttentionCount = replied.length + saved.length + followUpDue.length;

  function card(lead: Listing, options?: { showDaysSinceContact?: boolean }) {
    const duplicateAgent = findDuplicateAgentContact(lead.agentPhone, lead.id, agentByPhone);
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
            {lead.score != null && (
              <PhotoScoreBadge score={lead.score} reasoning={lead.scoreReasoning} />
            )}
            {duplicateAgent && (
              <DuplicateAgentBadge
                duplicateAgent={duplicateAgent}
                duplicateAddress={addressById.get(duplicateAgent.lastContactedListingId!)}
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

  return (
    <>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Pipeline</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {all.length} lead{all.length === 1 ? "" : "s"} in progress
        </p>
      </header>

      {all.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 text-center py-16 text-muted-foreground">
          <Inbox className="size-8" />
          <p>Nothing here yet — save or message a lead from the Leads page to get started.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          <section>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              Needs your attention
            </h2>
            {needsAttentionCount === 0 ? (
              <p className="text-muted-foreground/70 text-sm">Nothing needs attention right now.</p>
            ) : (
              <div className="flex flex-col gap-6">
                {replied.length > 0 && (
                  <div>
                    <h3 className="flex items-center gap-1.5 text-xs font-medium text-purple-700 dark:text-purple-400 mb-2">
                      <MessageSquareReply className="size-3.5" />
                      Replied — respond
                    </h3>
                    <div className="flex flex-col gap-4">{replied.map((lead) => card(lead))}</div>
                  </div>
                )}
                {saved.length > 0 && (
                  <div>
                    <h3 className="flex items-center gap-1.5 text-xs font-medium text-blue-700 dark:text-blue-400 mb-2">
                      <Bookmark className="size-3.5" />
                      Saved — ready to message
                    </h3>
                    <div className="flex flex-col gap-4">{saved.map((lead) => card(lead))}</div>
                  </div>
                )}
                {followUpDue.length > 0 && (
                  <div>
                    <h3 className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400 mb-2">
                      <Clock className="size-3.5" />
                      Needs follow-up
                    </h3>
                    <div className="flex flex-col gap-4">
                      {followUpDue.map((lead) => card(lead, { showDaysSinceContact: true }))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>

          {(quoted.length > 0 || waiting.length > 0) && (
            <section>
              <Separator className="mb-8" />
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                Waiting on a reply
              </h2>
              <div className="flex flex-col gap-6">
                {quoted.length > 0 && (
                  <div>
                    <h3 className="flex items-center gap-1.5 text-xs font-medium text-indigo-700 dark:text-indigo-400 mb-2">
                      <FileText className="size-3.5" />
                      Quoted — awaiting decision
                    </h3>
                    <div className="flex flex-col gap-4">{quoted.map((lead) => card(lead))}</div>
                  </div>
                )}
                {waiting.length > 0 && (
                  <div className="flex flex-col gap-4">{waiting.map((lead) => card(lead))}</div>
                )}
              </div>
            </section>
          )}

          {closed.length > 0 && (
            <section>
              <Separator className="mb-8" />
              <details className="group/details">
                <summary className="flex items-center gap-1 text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 cursor-pointer select-none list-none">
                  <ChevronRight className="size-4 transition-transform group-open/details:rotate-90" />
                  Closed ({closed.length})
                </summary>
                <div className="flex flex-col gap-4 mt-3">{closed.map((lead) => card(lead))}</div>
              </details>
            </section>
          )}
        </div>
      )}
    </>
  );
}
