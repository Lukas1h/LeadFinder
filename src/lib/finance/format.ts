/** Dollars with cents, for costs that aren't whole: "$85.12". */
export function formatMoney(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/** Whole dollars, for summaries: "$1,240". Negative shows as "−$40". */
export function formatDollars(n: number): string {
  const s = Math.abs(n).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  return n < -0.5 ? `−${s}` : s;
}

/** "2026-10" → "Oct 2026". */
export function monthLabel(month: string, withYear = true): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("en-US", {
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  });
}

/** "2026-10-15" → "Oct 15". */
export function dayLabel(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function formatHours(h: number): string {
  return `${Math.round(h * 10) / 10} h`;
}
