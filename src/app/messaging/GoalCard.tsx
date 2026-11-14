import Link from "next/link";
import type { GoalProgress, MarketQuota } from "@/lib/goal";
import { formatPrice } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Stat, Sub } from "../Stat";

const count = (n: number) => n.toLocaleString("en-US");

/** One market's texting quota: today vs today's target, the week vs the weekly target. */
function QuotaRow({ quota, accent }: { quota: MarketQuota; accent: "home" | "portland" }) {
  const { today, week } = quota;
  const pct = today.textsTarget > 0 ? Math.min(100, (today.texts / today.textsTarget) * 100) : 100;
  const todayMet = today.texts >= today.textsTarget;
  const bar = todayMet ? "bg-emerald-600" : accent === "home" ? "bg-foreground/70" : "bg-sky-600";
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-sm font-medium text-foreground flex items-center gap-1.5">
          <span
            className={`inline-block size-1.5 rounded-full ${accent === "home" ? "bg-emerald-600" : "bg-sky-600"}`}
          />
          {quota.label}
          {accent === "portland" && <span className="text-xs font-normal text-muted-foreground">on top of home</span>}
        </span>
        <span className="text-xs text-muted-foreground text-right tabular-nums">
          Today {count(today.texts)} of {count(today.textsTarget)} · Week{" "}
          <span className={week.textsToGo === 0 ? "text-emerald-600 font-medium" : "text-foreground font-medium"}>
            {week.textsToGo === 0 ? "On pace" : `${count(week.textsToGo)} more`}
          </span>{" "}
          ({count(week.texts)} of {count(quota.textsPerWeek)})
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full ${bar}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-xs text-muted-foreground">{quota.note}</p>
    </div>
  );
}
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
            <span className="text-muted-foreground font-normal">Local + Regional · </span>
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

      {goal.quotas && (
        <div className="flex flex-col gap-3">
          <QuotaRow quota={goal.quotas.home} accent="home" />
          <QuotaRow quota={goal.quotas.portland} accent="portland" />
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Stat label="Home replies this week">
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
