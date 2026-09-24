export function formatPrice(price: number | null) {
  if (price == null) return "—";
  return price.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export function formatDate(date: Date | null) {
  if (!date) return "—";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * For a date that came from a plain <input type="date"> (followUpAt) —
 * those parse as UTC midnight with no time component, so formatting in the
 * local timezone can shift the displayed day back by one (UTC midnight
 * Sept 1 reads as Aug 31 evening in any zone behind UTC). Reading the date
 * back out in UTC keeps it matching what was typed in.
 */
export function formatDateOnly(date: Date | null) {
  if (!date) return "—";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/**
 * The day of a real date+time value, without the time — for compact rows that
 * only have space for a date.
 *
 * Distinct from formatDateOnly above, which reads in UTC because its input is
 * a UTC-midnight date-only value. Applying that to a genuine timestamp shifts
 * the day for anything stored at or after 5pm Pacific: bookings.jobDate rows
 * sitting at UTC midnight rendered a day later in the list than on the card,
 * so the same booking showed two different dates depending on where you
 * looked at it.
 */
export function formatDay(date: Date | null) {
  if (!date) return "—";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * For a real date+time value (bookings.jobDate, from an
 * <input type="datetime-local">) — unlike the date-only picker above,
 * datetime-local values parse as local wall-clock time already, so normal
 * local-timezone formatting round-trips correctly with no UTC workaround.
 */
export function formatDateTime(date: Date | null) {
  if (!date) return "—";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function daysSince(date: Date): number {
  return Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
}

/** Wraps the Date.now() comparison in a helper so callers can use it inside
 * useMemo/render without tripping the "impure function during render" lint
 * — same reason daysSince above works there today. */
export function isDue(date: Date): boolean {
  return date.getTime() <= Date.now();
}

/** "5415551234" / "+15415551234" -> "(541) 555-1234". Falls back to the raw string for anything else. */
export function formatPhone(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "").replace(/^1(\d{10})$/, "$1");
  if (digits.length !== 10) return phone;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}
