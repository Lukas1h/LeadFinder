import type { Agent, LeadStatus } from "@/db/schema";
import { formatDate } from "@/lib/format";

export function NewBadge() {
  return (
    <span className="text-xs font-medium bg-emerald-100 text-emerald-700 rounded-full px-2 py-0.5">
      New
    </span>
  );
}

const STATUS_STYLES: Record<LeadStatus, string> = {
  new: "bg-emerald-100 text-emerald-700",
  saved: "bg-blue-100 text-blue-700",
  contacted: "bg-gray-100 text-gray-600",
  replied: "bg-purple-100 text-purple-700",
  booked: "bg-green-100 text-green-700",
  declined: "bg-gray-100 text-gray-500",
};

const STATUS_LABELS: Record<LeadStatus, string> = {
  new: "New",
  saved: "Saved",
  contacted: "Contacted",
  replied: "Replied",
  booked: "Booked",
  declined: "Declined",
};

export function StatusBadge({ status }: { status: LeadStatus }) {
  return (
    <span className={`text-xs font-medium rounded-full px-2 py-0.5 ${STATUS_STYLES[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

export function PhotoScoreBadge({ score, reasoning }: { score: number; reasoning: string | null }) {
  const tier =
    score <= 3
      ? { label: "Poor photos", style: "bg-red-100 text-red-700" }
      : score <= 5
        ? { label: "Amateur photos", style: "bg-amber-100 text-amber-800" }
        : score <= 7
          ? { label: "Good photos", style: "bg-gray-100 text-gray-600" }
          : { label: "Pro photos", style: "bg-gray-100 text-gray-400" };

  return (
    <span
      title={reasoning ?? undefined}
      className={`text-xs font-medium rounded-full px-2 py-0.5 ${tier.style}`}
    >
      📷 {tier.label} ({score}/10)
    </span>
  );
}

export function ComingSoonBadge() {
  return (
    <span className="text-xs font-medium bg-violet-100 text-violet-700 rounded-full px-2 py-0.5">
      🔜 Coming soon
    </span>
  );
}

export function FewPhotosBadge({ count }: { count: number }) {
  return (
    <span
      title="Fewer than 5 photos on the listing — the agent likely hasn't hired a photographer yet"
      className="text-xs font-medium bg-red-100 text-red-700 rounded-full px-2 py-0.5"
    >
      📷 Only {count} photo{count === 1 ? "" : "s"}
    </span>
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
    <span
      title={`Already contacted ${duplicateAgent.name ?? "this agent"} on ${formatDate(
        duplicateAgent.lastContactedAt
      )} about ${duplicateAddress ?? "another listing"}`}
      className="text-xs font-medium bg-amber-100 text-amber-800 rounded-full px-2 py-0.5"
    >
      ⚠ Already contacted
    </span>
  );
}
