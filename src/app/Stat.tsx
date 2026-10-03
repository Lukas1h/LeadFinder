import type { ReactNode } from "react";

/** One cell of a stats card (Booked's BookingStats, Messaging's stats). */
export function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-lg font-semibold text-foreground flex flex-col">{children}</span>
    </div>
  );
}

export function Sub({ children }: { children: ReactNode }) {
  return <span className="text-xs font-normal text-muted-foreground">{children}</span>;
}
