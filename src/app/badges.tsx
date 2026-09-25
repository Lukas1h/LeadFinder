import { Sparkles, Clock, Camera, TriangleAlert, Bell } from "lucide-react";
import type { Agent, AgentRelationshipStatus, LeadStatus } from "@/db/schema";
import { formatDate, formatDateOnly, daysSince } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { isWarmAgentStatus } from "@/lib/pipeline";
import { cn } from "@/lib/utils";
import { RELATIONSHIP_LABELS } from "./agents/relationshipLabels";

export function NewBadge() {
  return (
    <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-400 dark:border-emerald-900">
      <Sparkles />
      New
    </Badge>
  );
}

const STATUS_STYLES: Record<LeadStatus, string> = {
  new: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-400 dark:border-emerald-900",
  saved: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-400 dark:border-blue-900",
  contacted: "bg-muted text-muted-foreground",
  replied: "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950 dark:text-purple-400 dark:border-purple-900",
  quoted: "bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950 dark:text-indigo-400 dark:border-indigo-900",
  booked: "bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-400 dark:border-green-900",
  // Both dead ends read muted, but they stay visually distinct: "declined" is
  // an answer from the agent and worth spotting, "passed" is Lukas's own
  // housekeeping and should recede.
  passed: "bg-muted text-muted-foreground/70",
  declined: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-900",
};

export const STATUS_LABELS: Record<LeadStatus, string> = {
  new: "New",
  saved: "Saved",
  contacted: "Contacted",
  replied: "Replied",
  quoted: "Quoted",
  booked: "Booked",
  passed: "Passed",
  declined: "Declined",
};

export function StatusBadge({ status }: { status: LeadStatus }) {
  return <Badge className={STATUS_STYLES[status]}>{STATUS_LABELS[status]}</Badge>;
}

export function PhotoScoreBadge({ score, reasoning }: { score: number; reasoning: string | null }) {
  const tier =
    score <= 3
      ? { label: "Poor photos", style: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-400 dark:border-red-900" }
      : score <= 5
        ? { label: "Amateur photos", style: "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-900" }
        : score <= 7
          ? { label: "Good photos", style: "bg-muted text-muted-foreground" }
          : { label: "Pro photos", style: "bg-muted text-muted-foreground/60" };

  const badge = (
    <Badge className={tier.style}>
      <Camera />
      {tier.label} ({score}/10)
    </Badge>
  );

  if (!reasoning) return badge;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{badge}</TooltipTrigger>
      <TooltipContent>{reasoning}</TooltipContent>
    </Tooltip>
  );
}

export function ComingSoonBadge() {
  return (
    <Badge className="bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950 dark:text-violet-400 dark:border-violet-900">
      <Clock />
      Coming soon
    </Badge>
  );
}

export function DaysSinceContactBadge({ contactedAt }: { contactedAt: Date }) {
  const days = daysSince(contactedAt);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge className="bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-900">
          <Clock />
          {days}d since contact
        </Badge>
      </TooltipTrigger>
      <TooltipContent>Texted {formatDate(contactedAt)}</TooltipContent>
    </Tooltip>
  );
}

export function FollowUpBadge({ followUpAt, followUpNote }: { followUpAt: Date; followUpNote: string | null }) {
  const badge = (
    <Badge className="bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-900">
      <Bell />
      Follow up {formatDateOnly(followUpAt)}
    </Badge>
  );

  if (!followUpNote) return badge;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{badge}</TooltipTrigger>
      <TooltipContent>{followUpNote}</TooltipContent>
    </Tooltip>
  );
}

export function FewPhotosBadge({ count }: { count: number }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge className="bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-400 dark:border-red-900">
          <Camera />
          Only {count} photo{count === 1 ? "" : "s"}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>
        Fewer than 5 photos on the listing — the agent likely hasn&rsquo;t hired a photographer yet
      </TooltipContent>
    </Tooltip>
  );
}

export function DuplicateAgentBadge({
  duplicateAgent,
  duplicateAddress,
}: {
  duplicateAgent: Agent;
  duplicateAddress: string | null | undefined;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge className="bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-900">
          <TriangleAlert />
          Already contacted
        </Badge>
      </TooltipTrigger>
      <TooltipContent>
        {/* Without a listing pointer the contact was a cold email or a logged
            call, not a property conversation — naming "another listing" there
            would invent one. */}
        Already contacted {duplicateAgent.name ?? "this agent"} on{" "}
        {formatDate(duplicateAgent.lastContactedAt)}
        {duplicateAddress ? ` about ${duplicateAddress}` : ""}
      </TooltipContent>
    </Tooltip>
  );
}

export function AgentDeclinedBadge({
  agent,
  duplicateAddress,
}: {
  agent: Agent;
  duplicateAddress?: string | null | undefined;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge className="bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-900">
          <TriangleAlert />
          Agent declined
        </Badge>
      </TooltipTrigger>
      <TooltipContent>
        {agent.name ?? "This agent"} has marked their status as declined
        {duplicateAddress ? ` · previously on ${duplicateAddress}` : ""}
      </TooltipContent>
    </Tooltip>
  );
}

const RELATIONSHIP_BADGE_ROSE =
  "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950 dark:text-rose-400 dark:border-rose-900";

// The one place an agent's relationship status turns into a badge. Every surface
// that shows one renders this, so they can't drift apart on wording or colour
// again — the agent row inside a listing/booking detail and the agent detail
// dialog had each grown their own hand-rolled version of this same label.
//
// One hue per status, so the six read apart at a glance instead of all being
// "a badge with a word in it". The four established relationships climb a
// warmth ramp — rose for warm, amber as they get interested, violet once
// there's history, emerald for a regular — while the two ends stay out of the
// ramp: slate for cold, which is the neutral baseline and the overwhelming
// majority of agents, and red for declined, the one genuinely negative state.
// Every one follows the bg-{hue}-50 / text-{hue}-700 / border-{hue}-200 plus
// dark:-950 / -400 / -900 shape the rest of this file uses.
const RELATIONSHIP_BADGE_STYLES: Record<AgentRelationshipStatus, string> = {
  cold: "bg-slate-50 text-slate-700 border-slate-200 dark:bg-slate-950 dark:text-slate-400 dark:border-slate-900",
  warm: RELATIONSHIP_BADGE_ROSE,
  interested: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-900",
  worked_once: "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950 dark:text-violet-400 dark:border-violet-900",
  regular: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-400 dark:border-emerald-900",
  declined: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-400 dark:border-red-900",
};

function relationshipHint(status: AgentRelationshipStatus, agentName: string | null | undefined): string {
  const who = agentName ?? "this agent";
  if (isWarmAgentStatus(status)) {
    return `You already have a relationship with ${who} — ${RELATIONSHIP_LABELS[status].toLowerCase()} status`;
  }
  if (status === "declined") return `${who} has marked their status as declined`;
  return `${who} hasn't been contacted yet — cold status`;
}

export function RelationshipBadge({
  status,
  agentName,
  className,
}: {
  status: AgentRelationshipStatus;
  agentName?: string | null;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge className={cn(RELATIONSHIP_BADGE_STYLES[status], className)}>
          {RELATIONSHIP_LABELS[status]}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>{relationshipHint(status, agentName)}</TooltipContent>
    </Tooltip>
  );
}

// The warm-agent mark: shown on a listing card whenever the attached agent has
// a relationship status that isn't cold or declined (see WARM_AGENT_STATUSES in
// lib/pipeline.ts). Routed through RelationshipBadge so the listing cards can't
// drift from the agent row or the agent dialog. Renders the same
// RELATIONSHIP_LABELS wording as the Agents tab so the two never disagree about
// what each status means.
export function WarmAgentBadge({ agent }: { agent: Agent }) {
  return <RelationshipBadge status={agent.relationshipStatus} agentName={agent.name} />;
}
