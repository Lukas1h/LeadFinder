import { Badge } from "@/components/ui/badge";
import { MARKET_STATUS_LABELS, type MarketStatus } from "@/lib/markets";
import { cn } from "@/lib/utils";

const STATUS_CLASSES: Record<MarketStatus, string> = {
  testing: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  active: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  paused: "bg-muted text-muted-foreground",
  killed: "bg-zinc-500/15 text-zinc-500 line-through dark:text-zinc-400",
};

export function StatusBadge({ status, className }: { status: MarketStatus; className?: string }) {
  return (
    <Badge variant="secondary" className={cn(STATUS_CLASSES[status], className)}>
      {MARKET_STATUS_LABELS[status]}
    </Badge>
  );
}

export function dollars(n: number): string {
  return `${n < 0 ? "-" : ""}$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;
}

/** "" → undefined, else a number (NaN → undefined). */
export function num(value: string): number | undefined {
  if (value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}
