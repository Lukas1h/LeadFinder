import { Sparkles, Clock, Camera, TriangleAlert } from "lucide-react";
import type { Agent, LeadStatus } from "@/db/schema";
import { formatDate, daysSince } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

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
  declined: "bg-muted text-muted-foreground/70",
};

const STATUS_LABELS: Record<LeadStatus, string> = {
  new: "New",
  saved: "Saved",
  contacted: "Contacted",
  replied: "Replied",
  quoted: "Quoted",
  booked: "Booked",
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
        Already contacted {duplicateAgent.name ?? "this agent"} on{" "}
        {formatDate(duplicateAgent.lastContactedAt)} about {duplicateAddress ?? "another listing"}
      </TooltipContent>
    </Tooltip>
  );
}
