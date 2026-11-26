import type { MarketIndex, MarketPlace, ShooterDrive } from "@/lib/markets";

/**
 * The drive text a listing's card and detail modal show, worked out once on
 * the server.
 *
 * Both come from the markets table (lib/markets.ts MarketIndex), which client
 * components can't build, so every server entry point that hands a listing to
 * LeadCard / ListingRow / ListingModal / ScheduleList attaches these two plain
 * fields first (withDriveLines / addDriveLines below). Keeping them in one
 * helper means every screen shows the same line as the Leads page.
 */
export interface DriveLines {
  /** The card's line ("~20 min", "~20 min Chris · ~30 min Elijah"); null when unknown. */
  driveTime: string | null;
  /** Each shooter's drive on a shooter-market listing, owner first; null elsewhere. */
  shooterDrives: ShooterDrive[] | null;
}

/** A listing (or booking) plus the drive lines its card renders. */
export type WithDriveLines<T> = T & DriveLines;

/** One row plus its drive lines. */
export function withDriveLines<T extends MarketPlace>(row: T, mk: MarketIndex): WithDriveLines<T> {
  return { ...row, driveTime: mk.listingDriveTime(row), shooterDrives: mk.shooterDrives(row) };
}

/** The same, for a whole list of rows. */
export function addDriveLines<T extends MarketPlace>(rows: T[], mk: MarketIndex): WithDriveLines<T>[] {
  return rows.map((row) => withDriveLines(row, mk));
}
