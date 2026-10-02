// Send-window rules for the message queue: queued messages only count as due
// between 8 AM and 9 PM Pacific, every day — a text that comes due at 11 PM
// waits until morning rather than landing in someone's phone at night.

const TIME_ZONE = "America/Los_Angeles";
export const SEND_WINDOW_START_HOUR = 8;
export const SEND_WINDOW_END_HOUR = 21;

function pacificHour(date: Date): number {
  const hour = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, hour: "numeric", hourCycle: "h23" }).format(date);
  return Number(hour);
}

export function isInSendWindow(date: Date = new Date()): boolean {
  const hour = pacificHour(date);
  return hour >= SEND_WINDOW_START_HOUR && hour < SEND_WINDOW_END_HOUR;
}

/**
 * The first moment at or after `date` that's inside the send window. Steps
 * forward by the hour to the top of the 8 AM hour, which sidesteps DST math.
 */
export function nextSendTime(date: Date): Date {
  if (isInSendWindow(date)) return date;
  const t = new Date(date);
  t.setUTCMinutes(0, 0, 0);
  for (let i = 0; i < 26; i++) {
    t.setUTCHours(t.getUTCHours() + 1);
    if (isInSendWindow(t)) return t;
  }
  return date;
}
