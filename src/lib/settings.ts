import { db } from "@/db";
import { appSettings } from "@/db/schema";

export const DEFAULT_FOLLOW_UP_AFTER_DAYS = 3;

export async function getFollowUpAfterDays(): Promise<number> {
  const [row] = await db.select({ days: appSettings.followUpAfterDays }).from(appSettings).limit(1);
  return row?.days ?? DEFAULT_FOLLOW_UP_AFTER_DAYS;
}
