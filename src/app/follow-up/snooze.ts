/**
 * How long a snooze on the Follow up page can last, in days. The first is the
 * default: "not right now" usually means next week, not next month.
 *
 * A plain module so the server action, the iPhone route and the client menu
 * all read the same list.
 */
export const FOLLOW_UP_SNOOZE_DAYS = [7, 14, 28] as const;

export function snoozeLabel(days: number): string {
  return days % 7 === 0 ? `${days / 7} week${days === 7 ? "" : "s"}` : `${days} days`;
}
