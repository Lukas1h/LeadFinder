import Link from "next/link";
import type { GoalProgress } from "@/lib/goal";
import { formatPrice } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Stat, Sub } from "../Stat";

const count = (n: number) => n.toLocaleString("en-US");
/**
 * The monthly goal worked backwards into a weekly pace of texts, replies and
 * new clients (lib/goal.ts). Every number is live: it moves as texts go out,
 * replies come in, agents turn interested and jobs get booked.
 */
export function GoalCard({ goal }: { goal: GoalProgress }) {
  const { thisWeek, plan } = goal;
  const met = goal.gap === 0;

  return (
    <Card className="p-4 gap-4">
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-4">
          <span className="text-sm font-medium text-foreground">
            {formatPrice(goal.booked)} of {formatPrice(goal.goal)} booked for {goal.month}
          </span>
          <span className="text-xs text-muted-foreground text-right">
            {met
              ? "Goal met"
              : `${formatPrice(goal.gap)} to go, about ${goal.jobsNeeded} job${goal.jobsNeeded === 1 ? "" : "s"} at ${formatPrice(goal.avgJob)}`}
          </span>
        </div>
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-emerald-600"
            style={{ width: `${Math.min(100, (goal.booked / goal.goal) * 100)}%` }}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Stat label="Text this week">
          {thisWeek.textsToGo === 0 ? "On pace" : `${count(thisWeek.textsToGo)} more`}
          <Sub>
            {count(thisWeek.texts)} of {count(plan.textsPerWeek)} sent
          </Sub>
        </Stat>
        <Stat label="Replies this week">
          {thisWeek.repliesToGo === 0 ? "On pace" : `${count(thisWeek.repliesToGo)} more`}
          <Sub>
            {count(thisWeek.replies)} of {count(plan.repliesPerWeek)}
          </Sub>
        </Stat>
        <Stat label="Follow-ups due">
          <Link href="/follow-up" className="hover:underline">
            {count(thisWeek.followUpsDue)}
          </Link>
          <Sub>{count(thisWeek.followUps)} sent this week</Sub>
        </Stat>
        <Stat label="New clients">
          {count(plan.newClientsThisMonth)} this month
          <Sub>about {Math.ceil(plan.newClientsPerMonth)} a month needed</Sub>
        </Stat>
      </div>

      <p className="text-xs text-muted-foreground border-t pt-3">{goal.note}</p>
    </Card>
  );
}
