/**
 * Where a subcontracted photographer's raw files go.
 *
 * A shooter only shoots; Lukas edits. A booking with a shooter gets an upload
 * page, <GALLERY_ORIGIN>/upload/<uploadToken> (src/app/upload/[token]), that
 * sends the files straight into the job's own Dropbox folder,
 * `<DROPBOX_UPLOAD_ROOT>/<address>` (default `/Media Uploads`), so editing
 * starts from Dropbox exactly as before. No Dropbox account or sign-in for the
 * shooter — the "anyone can edit" folder links this replaced make people sign
 * in to Dropbox before they can add anything.
 *
 * The token is assigned the moment a shooter is put on the job (no Dropbox
 * call, so it can't fail); the folder is made right after, in the background,
 * and again on demand by the page if that didn't happen. Uploads are tracked
 * in upload_batches / upload_events and push Lukas when a shooter starts and
 * when they finish.
 */

import { randomBytes } from "crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { bookings, listings, shooters, uploadBatches, uploadEvents, type UploadEvent } from "@/db/schema";
import {
  createUploadFolder,
  ensureUploadFolder,
  folderPathFromSharedLink,
  createViewLink,
} from "./dropbox";
import { firstName } from "./sms";
import { GALLERY_ORIGIN } from "./siteUrls";
import { broadcastPush } from "./push";

export function uploadPageUrl(token: string): string {
  return `${GALLERY_ORIGIN}/upload/${token}`;
}

/**
 * The folder's name: the shoot's address. City stands in when there's no
 * street address, and a dated "Booking …" when there's neither. Dropbox
 * forbids "/" and a trailing dot or space; a reshoot at the same address gets
 * Dropbox's " (1)" (createUploadFolder autorenames).
 */
export function uploadFolderName(address: string | null, city: string | null, jobDate: Date | null): string {
  const base = (address ?? "").trim() || (city ?? "").trim() || `Booking${jobDate ? ` ${shootDay(jobDate)}` : ""}`;
  return base.replace(/[\\/]/g, "-").replace(/\s+/g, " ").replace(/[. ]+$/, "").slice(0, 200) || "Booking";
}

/** "Nov 18" — how a text should say the day. */
function shootDay(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Los_Angeles" });
}

/** The text Lukas sends a shooter with the upload page link. */
export function shooterUploadText({
  shooterName,
  address,
  jobDate,
  url,
}: {
  shooterName: string;
  address: string | null;
  jobDate: Date | null;
  url: string;
}): string {
  const who = firstName(shooterName) ?? shooterName;
  const where = address ? ` for ${address}` : "";
  const when = jobDate ? ` (${shootDay(jobDate)})` : "";
  return `Hey ${who}, here's where to upload the raw photos and video${where}${when}: ${url}\n\nNo login needed, just drop the files in. Thanks!`;
}

async function loadUploadRow(where: ReturnType<typeof eq>) {
  const [row] = await db
    .select({
      id: bookings.id,
      uploadToken: bookings.uploadToken,
      dropboxUploadPath: bookings.dropboxUploadPath,
      dropboxUploadLink: bookings.dropboxUploadLink,
      address: bookings.address,
      city: bookings.city,
      listingAddress: listings.address,
      listingCity: listings.city,
      jobDate: bookings.jobDate,
      shooterId: bookings.shooterId,
      shooterName: shooters.name,
      shooterPhone: shooters.phone,
    })
    .from(bookings)
    .leftJoin(listings, eq(listings.id, bookings.listingId))
    .leftJoin(shooters, eq(shooters.id, bookings.shooterId))
    .where(where);
  return row ?? null;
}
export type UploadBookingRow = NonNullable<Awaited<ReturnType<typeof loadUploadRow>>>;

export function uploadRowAddress(row: UploadBookingRow): string | null {
  return row.listingAddress ?? row.address ?? row.listingCity ?? row.city;
}

/** The booking behind an upload page link, or null. */
export function bookingByUploadToken(token: string) {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return Promise.resolve(null);
  return loadUploadRow(eq(bookings.uploadToken, token));
}

/** Assigns the job's upload token if it has none. DB only, so it can't fail on Dropbox. */
export async function ensureUploadToken(bookingId: string): Promise<string | null> {
  const token = randomBytes(18).toString("base64url");
  const [set] = await db
    .update(bookings)
    .set({ uploadToken: token })
    .where(and(eq(bookings.id, bookingId), isNull(bookings.uploadToken)))
    .returning({ token: bookings.uploadToken });
  if (set?.token) return set.token;
  const [row] = await db.select({ token: bookings.uploadToken }).from(bookings).where(eq(bookings.id, bookingId));
  return row?.token ?? null;
}

/**
 * The job's Dropbox folder, made on first use and stored. Older jobs that only
 * have an editor link get that link's folder, so new uploads land beside the
 * old ones. Also re-makes the folder if it was deleted. Gives new folders a
 * plain view link in dropbox_upload_link (Flambient imports from it).
 */
export async function ensureBookingUploadFolder(row: UploadBookingRow): Promise<string> {
  if (row.dropboxUploadPath) return ensureUploadFolder(row.dropboxUploadPath);

  let path = row.dropboxUploadLink ? await folderPathFromSharedLink(row.dropboxUploadLink) : null;
  if (!path) {
    path = await createUploadFolder(uploadFolderName(row.listingAddress ?? row.address, row.listingCity ?? row.city, row.jobDate));
  }
  // Guarded on null so two first uploads at once can't store two folders: the loser uses the winner's.
  const [won] = await db
    .update(bookings)
    .set({ dropboxUploadPath: path })
    .where(and(eq(bookings.id, row.id), isNull(bookings.dropboxUploadPath)))
    .returning({ path: bookings.dropboxUploadPath });
  if (!won) {
    const [current] = await db.select({ path: bookings.dropboxUploadPath }).from(bookings).where(eq(bookings.id, row.id));
    return current?.path ?? path;
  }
  if (!row.dropboxUploadLink) {
    const link = await createViewLink(path).catch((err) => {
      console.error("ensureBookingUploadFolder: view link not made", err);
      return null;
    });
    if (link) await db.update(bookings).set({ dropboxUploadLink: link }).where(eq(bookings.id, row.id));
  }
  return path;
}

export interface BookingUploadLink {
  url?: string;
  /** The text to send the shooter — only when the booking's shooter has a phone. */
  text?: string;
  error?: string;
}

/**
 * The job's upload page link (assigning its token on first use) and the text
 * to send the shooter. Never re-made, so a link already texted keeps working.
 * The Dropbox folder is made in the background; the page makes it too.
 */
export async function getOrCreateBookingUploadLink(bookingId: string): Promise<BookingUploadLink> {
  const token = await ensureUploadToken(bookingId);
  const row = await loadUploadRow(eq(bookings.id, bookingId));
  if (!row || !token) return { error: "No booking with that id" };
  if (!row.uploadToken) revalidatePath("/booked");

  const url = uploadPageUrl(token);
  return {
    url,
    text:
      row.shooterName && row.shooterPhone
        ? shooterUploadText({ shooterName: row.shooterName, address: uploadRowAddress(row), jobDate: row.jobDate, url })
        : undefined,
  };
}

/** Makes the folder ahead of time (after a shooter is assigned) so the first upload doesn't wait on it. Never throws. */
export async function prepareBookingUploadFolder(bookingId: string): Promise<void> {
  try {
    const row = await loadUploadRow(eq(bookings.id, bookingId));
    if (row && !row.dropboxUploadPath) await ensureBookingUploadFolder(row);
  } catch (err) {
    console.error("prepareBookingUploadFolder failed", err);
  }
}

// ---------- tracking ----------

const decodeHeader = (v: string | null) => {
  if (!v) return null;
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
};

function requestInfo(headers: Headers) {
  return {
    ip: headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip"),
    city: decodeHeader(headers.get("x-vercel-ip-city")),
    userAgent: headers.get("user-agent"),
  };
}

/** Never throws — logging must not break an upload. */
export async function recordUploadEvent(
  bookingId: string,
  event: UploadEvent,
  headers: Headers,
  detail?: string | null,
  batchId?: string | null
): Promise<void> {
  try {
    const info = requestInfo(headers);
    await db.insert(uploadEvents).values({ bookingId, event, detail: detail ?? null, batchId: batchId ?? null, ...info });
  } catch (err) {
    console.error("recordUploadEvent failed", err);
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** A finished batch reopened within this long counts as the same upload (no second "started" push). */
const REOPEN_WINDOW_MS = 15 * 60 * 1000;

/**
 * Starts tracking an upload, or adds files to one already going. The first
 * start pushes "<shooter> started uploading". Files the page skipped (already
 * in Dropbox) are counted but not sent.
 */
export async function startUploadBatch(
  row: UploadBookingRow,
  input: { batchId?: string | null; files: number; bytes: number; skipped: number },
  headers: Headers
): Promise<string> {
  const files = clampInt(input.files);
  const bytes = clampInt(input.bytes);
  const skipped = clampInt(input.skipped);

  // Same page, more files: grow the batch. Also reopen one that finished a
  // moment ago, so "I forgot the drone clips" isn't a second start.
  if (input.batchId) {
    const [batch] = await db
      .select()
      .from(uploadBatches)
      .where(and(eq(uploadBatches.id, input.batchId), eq(uploadBatches.bookingId, row.id)));
    if (batch && (!batch.finishedAt || Date.now() - batch.finishedAt.getTime() < REOPEN_WINDOW_MS)) {
      await db
        .update(uploadBatches)
        .set({
          filesTotal: sql`${uploadBatches.filesTotal} + ${files}`,
          bytesTotal: sql`${uploadBatches.bytesTotal} + ${bytes}`,
          filesSkipped: sql`${uploadBatches.filesSkipped} + ${skipped}`,
          finishedAt: null,
          lastActivityAt: new Date(),
        })
        .where(eq(uploadBatches.id, batch.id));
      return batch.id;
    }
  }

  const info = requestInfo(headers);
  const [batch] = await db
    .insert(uploadBatches)
    .values({
      bookingId: row.id,
      shooterId: row.shooterId,
      filesTotal: files,
      bytesTotal: bytes,
      filesSkipped: skipped,
      city: info.city,
      userAgent: info.userAgent,
    })
    .returning({ id: uploadBatches.id });

  await recordUploadEvent(row.id, "start", headers, `${plural(files, "file")}, ${formatBytes(bytes)}`, batch.id);
  if (files > 0) {
    await broadcastPush({
      title: `${row.shooterName ?? "Shooter"} started uploading`,
      body: `${plural(files, "file")} (${formatBytes(bytes)}) · ${uploadRowAddress(row) ?? "a job"}`,
      url: "/booked",
    }).catch((err) => console.error("upload start push failed", err));
  }
  revalidatePath("/booked");
  return batch.id;
}

/** Files that finished or failed since the last report. Bumps last_activity_at (the stall check). */
export async function recordUploadProgress(
  row: UploadBookingRow,
  batchId: string,
  input: { doneFiles: number; doneBytes: number; recovered: number; failed: { path: string; error: string }[] },
  headers: Headers
): Promise<void> {
  const failed = input.failed.slice(0, 50);
  await db
    .update(uploadBatches)
    .set({
      filesDone: sql`${uploadBatches.filesDone} + ${clampInt(input.doneFiles)}`,
      bytesDone: sql`${uploadBatches.bytesDone} + ${clampInt(input.doneBytes)}`,
      // recovered: earlier failures that went through on a retry.
      filesFailed: sql`greatest(${uploadBatches.filesFailed} + ${failed.length} - ${clampInt(input.recovered)}, 0)`,
      lastActivityAt: new Date(),
    })
    .where(and(eq(uploadBatches.id, batchId), eq(uploadBatches.bookingId, row.id)));
  for (const f of failed) {
    await recordUploadEvent(row.id, "file_failed", headers, `${f.path.slice(0, 300)} — ${f.error.slice(0, 300)}`, batchId);
  }
}

/**
 * The page's queue is empty: stamps finished_at and pushes "<shooter>
 * finished uploading" once (a repeat call finds it already finished).
 */
export async function finishUploadBatch(row: UploadBookingRow, batchId: string, headers: Headers): Promise<void> {
  const [batch] = await db
    .update(uploadBatches)
    .set({ finishedAt: new Date(), lastActivityAt: new Date() })
    .where(and(eq(uploadBatches.id, batchId), eq(uploadBatches.bookingId, row.id), isNull(uploadBatches.finishedAt)))
    .returning();
  if (!batch) return;

  const summary = `${plural(batch.filesDone, "file")} (${formatBytes(batch.bytesDone)})`;
  const failed = batch.filesFailed > 0 ? `, ${batch.filesFailed} failed` : "";
  await recordUploadEvent(row.id, "finish", headers, `${summary}${failed}`, batch.id);
  revalidatePath("/booked");
  // Everything picked was already in Dropbox: nothing new to tell Lukas.
  if (batch.filesTotal === 0 && batch.filesFailed === 0) return;
  await broadcastPush({
    title: batch.filesFailed > 0 ? `${row.shooterName ?? "Shooter"}'s upload finished with errors` : `${row.shooterName ?? "Shooter"} finished uploading`,
    body: `${summary}${failed} · ${uploadRowAddress(row) ?? "a job"}`,
    url: "/booked",
  }).catch((err) => console.error("upload finish push failed", err));
  revalidatePath("/booked");
}

function clampInt(n: unknown): number {
  const v = Math.round(Number(n));
  return Number.isFinite(v) && v > 0 ? Math.min(v, Number.MAX_SAFE_INTEGER) : 0;
}

// ---------- the booking dialog's view ----------

/** No progress for this long while not finished = the upload stopped (closed tab, lost signal). */
export const UPLOAD_STALL_MS = 10 * 60 * 1000;

export interface BookingUploadStatus {
  state: "never_opened" | "opened" | "uploading" | "stalled" | "finished";
  /** Latest batch, if any. */
  filesDone: number;
  filesTotal: number;
  filesFailed: number;
  bytesDone: number;
  startedAt: string | null;
  finishedAt: string | null;
  lastActivityAt: string | null;
  lastViewAt: string | null;
  views: number;
  /** Every finished/ongoing batch summed. */
  allFiles: number;
  allBytes: number;
}

/** What the booking dialog shows under the shooter: opened? uploading? done? */
export async function loadUploadStatus(bookingId: string): Promise<BookingUploadStatus> {
  const [batches, views] = await Promise.all([
    db.select().from(uploadBatches).where(eq(uploadBatches.bookingId, bookingId)).orderBy(desc(uploadBatches.startedAt)),
    db
      .select({ n: sql<number>`count(*)::int`, last: sql<Date | null>`max(${uploadEvents.at})` })
      .from(uploadEvents)
      .where(and(eq(uploadEvents.bookingId, bookingId), eq(uploadEvents.event, "view"))),
  ]);
  const latest = batches[0];
  const lastView = views[0]?.last ? new Date(views[0].last).toISOString() : null;
  const base = {
    filesDone: latest?.filesDone ?? 0,
    filesTotal: latest?.filesTotal ?? 0,
    filesFailed: latest?.filesFailed ?? 0,
    bytesDone: latest?.bytesDone ?? 0,
    startedAt: latest?.startedAt.toISOString() ?? null,
    finishedAt: latest?.finishedAt?.toISOString() ?? null,
    lastActivityAt: latest?.lastActivityAt.toISOString() ?? null,
    lastViewAt: lastView,
    views: views[0]?.n ?? 0,
    allFiles: batches.reduce((s, b) => s + b.filesDone, 0),
    allBytes: batches.reduce((s, b) => s + b.bytesDone, 0),
  };
  if (!latest) return { state: lastView ? "opened" : "never_opened", ...base };
  if (latest.finishedAt) return { state: "finished", ...base };
  const stalled = Date.now() - latest.lastActivityAt.getTime() > UPLOAD_STALL_MS;
  return { state: stalled ? "stalled" : "uploading", ...base };
}

// ---------- paths ----------

/**
 * A browser-supplied relative path ("Video/DJI_0001.MP4"), made safe to put
 * under the job's folder: no "..", no empty or dot segments, none of the
 * characters Dropbox rejects, no trailing dots/spaces. Null when nothing's left.
 */
export function safeRelativePath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const parts = raw
    .replace(/\\/g, "/")
    .split("/")
    .map((seg) =>
      seg
        .replace(/[\u0000-\u001f<>:"|?*]/g, "_")
        .replace(/[. ]+$/, "")
        .trim()
        .slice(0, 200)
    )
    .filter((seg) => seg && seg !== "." && seg !== "..");
  if (parts.length === 0 || parts.length > 8) return null;
  return parts.join("/");
}

/** The job's folder path — stored, or made now. */
export async function uploadFolderFor(row: UploadBookingRow): Promise<string> {
  return row.dropboxUploadPath ?? ensureBookingUploadFolder(row);
}
