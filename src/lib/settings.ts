import { db } from "@/db";
import { appSettings } from "@/db/schema";

export const DEFAULT_FOLLOW_UP_AFTER_DAYS = 3;
export const DEFAULT_HOME_CITY = "Winston";
export const DEFAULT_HOME_STATE = "OR";

export async function getFollowUpAfterDays(): Promise<number> {
  const [row] = await db.select({ days: appSettings.followUpAfterDays }).from(appSettings).limit(1);
  return row?.days ?? DEFAULT_FOLLOW_UP_AFTER_DAYS;
}

export interface HomeLocation {
  city: string;
  state: string;
}

/** Where drive-time estimates on the Booked page start from — see src/lib/driveTime.ts. */
export async function getHomeLocation(): Promise<HomeLocation> {
  const [row] = await db.select({ city: appSettings.homeCity, state: appSettings.homeState }).from(appSettings).limit(1);
  return { city: row?.city ?? DEFAULT_HOME_CITY, state: row?.state ?? DEFAULT_HOME_STATE };
}
