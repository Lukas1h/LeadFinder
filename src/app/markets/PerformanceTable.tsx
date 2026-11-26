"use client";

import type { MarketPerformance } from "./data";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { UNASSIGNED } from "@/lib/markets";
import { cn } from "@/lib/utils";
import { StatusBadge, dollars } from "./parts";

function pct(rate: number | null): string {
  return rate == null ? "–" : `${Math.round(rate * 100)}%`;
}

export function PerformanceTable({
  rows,
  killMinSends,
  killReplyRate,
}: {
  rows: MarketPerformance[];
  killMinSends: number;
  killReplyRate: number;
}) {
  const killBadge = (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="destructive" className="cursor-default">
          Low replies
        </Badge>
      </TooltipTrigger>
      <TooltipContent>
        {killMinSends}+ cold texts sent and under {Math.round(killReplyRate * 100)}% replied
      </TooltipContent>
    </Tooltip>
  );

  const status = (r: MarketPerformance) => (r.key === UNASSIGNED ? null : <StatusBadge status={r.status} />);

  return (
    <>
      {/* Desktop table */}
      <Card className="hidden md:flex p-0 gap-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="text-left font-medium px-4 py-2">Market</th>
              <th className="text-right font-medium px-2 py-2">Days</th>
              <th className="text-right font-medium px-2 py-2">Found</th>
              <th className="text-right font-medium px-2 py-2">Open</th>
              <th className="text-right font-medium px-2 py-2">Sent → replied → int.</th>
              <th className="text-right font-medium px-2 py-2">Reply</th>
              <th className="text-right font-medium px-2 py-2">Jobs</th>
              <th className="text-right font-medium px-2 py-2">Revenue</th>
              <th className="text-right font-medium px-2 py-2">Shooter</th>
              <th className="text-right font-medium px-4 py-2">Margin</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className={cn("border-b last:border-0", r.killFlag && "bg-destructive/5")}>
                <td className="px-4 py-2">
                  <div className="flex items-center gap-2 whitespace-nowrap">
                    <span className="font-medium">{r.label}</span>
                    {status(r)}
                    {r.killFlag && killBadge}
                  </div>
                </td>
                <td className="text-right px-2 py-2 text-muted-foreground">{r.daysLive ?? "–"}</td>
                <td className="text-right px-2 py-2">{r.listingsFound}</td>
                <td className="text-right px-2 py-2 text-muted-foreground">{r.openListings}</td>
                <td className="text-right px-2 py-2 whitespace-nowrap">
                  {r.coldSent} <span className="text-muted-foreground">→</span> {r.coldReplied}{" "}
                  <span className="text-muted-foreground">→</span> {r.coldInterested}
                </td>
                <td className={cn("text-right px-2 py-2", r.killFlag && "text-destructive font-medium")}>
                  {pct(r.replyRate)}
                </td>
                <td className="text-right px-2 py-2">{r.bookings}</td>
                <td className="text-right px-2 py-2">{dollars(r.revenue)}</td>
                <td className="text-right px-2 py-2 text-muted-foreground">{dollars(r.shooterCost)}</td>
                <td className={cn("text-right px-4 py-2 font-medium", r.margin < 0 && "text-destructive")}>
                  {dollars(r.margin)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* Mobile cards */}
      <div className="flex flex-col gap-2 md:hidden">
        {rows.map((r) => (
          <Card key={r.key} className={cn("p-3 gap-2", r.killFlag && "border-destructive/40")}>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-sm">{r.label}</span>
              {status(r)}
              {r.killFlag && killBadge}
              {r.daysLive != null && <span className="ml-auto text-xs text-muted-foreground">{r.daysLive}d live</span>}
            </div>
            <div className="grid grid-cols-3 gap-x-3 gap-y-1 text-xs">
              <Cell label="Found / open">
                {r.listingsFound} / {r.openListings}
              </Cell>
              <Cell label="Sent → rep → int">
                {r.coldSent} → {r.coldReplied} → {r.coldInterested}
              </Cell>
              <Cell label="Reply rate" className={r.killFlag ? "text-destructive" : undefined}>
                {pct(r.replyRate)}
              </Cell>
              <Cell label="Jobs · revenue">
                {r.bookings} · {dollars(r.revenue)}
              </Cell>
              <Cell label="Shooter">{dollars(r.shooterCost)}</Cell>
              <Cell label="Margin" className={r.margin < 0 ? "text-destructive" : undefined}>
                {dollars(r.margin)}
              </Cell>
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}

function Cell({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground truncate">{label}</div>
      <div className={cn("font-medium tabular-nums", className)}>{children}</div>
    </div>
  );
}
