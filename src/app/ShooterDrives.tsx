import type { ShooterDrive } from "@/lib/markets";

/** Inline list of each shooter's drive to a listing, best shooter first. */
export function ShooterDrives({ drives }: { drives: ShooterDrive[] }) {
  if (drives.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-1" title="Drive from each shooter (one way)">
      {drives.map((d, i) => (
        <span key={d.name} className="inline-flex items-baseline gap-1 whitespace-nowrap">
          {i > 0 && <span aria-hidden>·</span>}
          <span className={i === 0 ? "text-foreground font-medium" : undefined}>
            {d.duration} {d.label}
          </span>
          {d.role === "backup" && <span className="text-xs text-muted-foreground/80">backup</span>}
          {d.driveCost > 0 && (
            <span className="text-xs text-amber-600 dark:text-amber-400">+${d.driveCost}</span>
          )}
        </span>
      ))}
    </span>
  );
}
