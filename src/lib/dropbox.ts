import { Dropbox } from "dropbox";

let client: Dropbox | undefined;

/**
 * One shared client for the whole process, same caching shape as
 * mailer.ts's transporter — the SDK refreshes its own short-lived access
 * token from DROPBOX_REFRESH_TOKEN automatically on every call
 * (checkAndRefreshAccessToken), so there's no manual OAuth dance here, just
 * the one-time app setup that produced the refresh token itself.
 */
function getClient(): Dropbox {
  if (!client) {
    const refreshToken = process.env.DROPBOX_REFRESH_TOKEN;
    const clientId = process.env.DROPBOX_APP_KEY;
    const clientSecret = process.env.DROPBOX_APP_SECRET;
    if (!refreshToken || !clientId || !clientSecret) {
      throw new Error("DROPBOX_REFRESH_TOKEN / DROPBOX_APP_KEY / DROPBOX_APP_SECRET are not set");
    }
    client = new Dropbox({ refreshToken, clientId, clientSecret });
  }
  return client;
}

/**
 * Retries a Dropbox call that failed for a reason worth retrying: rate
 * limiting (429, honoring its Retry-After), Dropbox's own 5xx hiccups, and
 * network errors. A gallery fires dozens of thumbnail calls at once and an
 * upload fires hundreds of link/append calls, so a 429 is routine, not an
 * outage — before this, one surfaced as a broken photo or a failed upload.
 * 4xx errors (bad path, conflict, missing scope) fail straight away.
 */
export async function withDropboxRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const status = (err as { status?: number } | null)?.status;
      const retryable = status === undefined || status === 429 || status >= 500;
      if (!retryable || attempt >= attempts) throw err;
      const retryAfter = Number(
        (err as { headers?: { get?: (k: string) => string | null } }).headers?.get?.("retry-after") ??
          (err as { error?: { error?: { retry_after?: number } } }).error?.error?.retry_after
      );
      const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 300 * 2 ** (attempt - 1);
      await new Promise((r) => setTimeout(r, Math.min(wait, 8000) + Math.random() * 200));
    }
  }
}

const IMAGE_EXTENSION_RE = /\.(jpe?g|png|heic|heif|webp|gif|tiff?)$/i;
const VIDEO_EXTENSION_RE = /\.(mp4|mov|m4v|webm)$/i;

export interface GalleryPhoto {
  name: string;
  pathLower: string;
}

export interface GalleryMedia {
  photos: GalleryPhoto[];
  videos: GalleryPhoto[];
}

// The thumbnail route (src/app/api/gallery/[token]/thumbnail/route.ts) has
// to re-verify a requested filename against this listing on every single
// photo it serves, so one gallery page view means many calls here in quick
// succession — this short cache collapses those back down to one real
// Dropbox list_folder call per folder per minute instead of one per photo.
interface ListCacheEntry {
  media: GalleryMedia;
  expiresAt: number;
}
const listCache = new Map<string, ListCacheEntry>();
const LIST_CACHE_TTL_MS = 60_000;

/**
 * Lists every photo and video in the given Dropbox shared-folder link, sorted by
 * filename — naming uploads with a numeric prefix (01-, 02-, ...) is what
 * controls display order, since Dropbox itself has no separate "custom
 * sort" of its own. Only non-recursive listing is supported against a
 * shared link (a Dropbox API limitation, not this code's choice), which is
 * fine here: a client gallery is a flat folder of photos, not nested
 * subfolders.
 */
export async function listGalleryMedia(sharedLink: string): Promise<GalleryMedia> {
  const cached = listCache.get(sharedLink);
  if (cached && cached.expiresAt > Date.now()) return cached.media;

  const dbx = getClient();
  const photos: GalleryPhoto[] = [];
  const videos: GalleryPhoto[] = [];

  let res = await withDropboxRetry(() => dbx.filesListFolder({ path: "", shared_link: { url: sharedLink } }));
  for (;;) {
    for (const entry of res.result.entries) {
      if (entry[".tag"] !== "file" || !entry.path_lower) continue;
      if (IMAGE_EXTENSION_RE.test(entry.name)) photos.push({ name: entry.name, pathLower: entry.path_lower });
      else if (VIDEO_EXTENSION_RE.test(entry.name)) videos.push({ name: entry.name, pathLower: entry.path_lower });
    }
    if (!res.result.has_more) break;
    const cursor = res.result.cursor;
    res = await withDropboxRetry(() => dbx.filesListFolderContinue({ cursor }));
  }

  const byName = (a: GalleryPhoto, b: GalleryPhoto) => a.name.localeCompare(b.name, undefined, { numeric: true });
  const media = { photos: photos.sort(byName), videos: videos.sort(byName) };
  // A long-lived instance would otherwise keep every gallery ever opened.
  if (listCache.size > 200) {
    for (const [key, entry] of listCache) if (entry.expiresAt <= Date.now()) listCache.delete(key);
  }
  listCache.set(sharedLink, { media, expiresAt: Date.now() + LIST_CACHE_TTL_MS });
  return media;
}

/**
 * A direct, four-hour link to one file's bytes on dl.dropboxusercontent.com —
 * how gallery videos play and download. It supports range requests (so a
 * video can stream and seek) and, like the zip, isn't a Dropbox-app universal
 * link, so tapping it never opens the app.
 */
export async function getTemporaryLink(pathLower: string): Promise<string> {
  const res = await withDropboxRetry(() => getClient().filesGetTemporaryLink({ path: pathLower }));
  return res.result.link;
}

// w480h320/w960h640 are Dropbox's two 3:2 sizes — real estate photos are
// natively shot 3:2, and requesting one of these directly (instead of a
// 4:3 size CSS-cropped down to 3:2 client-side) gets an actual 3:2 crop
// from Dropbox at full quality for that box, not a wasted/soft one.
export type GalleryThumbnailSize = "w256h256" | "w480h320" | "w640h480" | "w960h640" | "w1024h768" | "w2048h1536";

/**
 * Fetches a rendered JPEG thumbnail for one photo at the given size, via
 * the account's own direct path rather than the shared-link + relative-path
 * form — the folder belongs to this same Dropbox account (the one
 * DROPBOX_REFRESH_TOKEN authenticates as), so a plain path works and skips
 * an extra relative-path calculation.
 */
export async function getGalleryThumbnail(pathLower: string, size: GalleryThumbnailSize): Promise<Buffer> {
  const dbx = getClient();
  const res = await withDropboxRetry(() =>
    dbx.filesGetThumbnailV2({
      resource: { ".tag": "path", path: pathLower },
      format: { ".tag": "jpeg" },
      size: { ".tag": size },
      mode: { ".tag": "bestfit" },
    })
  );
  // The SDK's return type is a fileBinary/fileBlob union, and which branch
  // actually comes back depends on which fetch/Response implementation is
  // in play at runtime — confirmed by testing: a plain tsx script gets
  // fileBinary, but the same call inside a Next.js route handler gets
  // fileBlob instead. Handle both rather than assuming either.
  if (res.result.fileBinary) return Buffer.from(res.result.fileBinary);
  if (res.result.fileBlob) return Buffer.from(await res.result.fileBlob.arrayBuffer());
  throw new Error("Dropbox thumbnail response had neither fileBinary nor fileBlob");
}

/**
 * Where "Download all" sends a client. Dropbox zips a shared folder itself
 * when the link is hit with dl=1, so there's no server-side zip to build or
 * bandwidth to pay for — but www.dropbox.com/scl/… is one of the Dropbox
 * app's iOS universal-link paths, so tapping it on a phone with the app
 * installed opens the app (or its sign-in screen) instead of downloading.
 *
 * That dl=1 link only ever 302s to the actual zip on
 * *.dl.dropboxusercontent.com, which the app doesn't claim. So this follows
 * the first hop server-side and hands back the direct zip URL; the gallery
 * links to our own route (src/app/api/gallery/[token]/download), which
 * redirects there. Falls back to the dl=1 link if Dropbox answers
 * differently.
 */
export async function resolveZipDownloadUrl(sharedLink: string): Promise<string> {
  const url = new URL(sharedLink);
  url.searchParams.set("dl", "1");
  try {
    const res = await fetch(url, { redirect: "manual", cache: "no-store" });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      const target = new URL(location, url);
      if (target.hostname.endsWith(".dropboxusercontent.com")) return target.toString();
    }
  } catch (err) {
    console.error("resolveZipDownloadUrl: Dropbox lookup failed", err);
  }
  return url.toString();
}

/**
 * The Dropbox error's own tag ("path", "shared_link_already_exists", …), for
 * handling the few that aren't failures.
 *
 * The SDK hands back the parsed response body, and how deep the tagged union
 * sits in it depends on the endpoint: sometimes the body *is* the union
 * (`{ ".tag": "path" }`), sometimes it's wrapped once more
 * (`{ error: { ".tag": "path", path: … } }`, which is what the files
 * endpoints send for a 409). Check both, or an "already exists" reads as a
 * failure and every second call breaks.
 */
function dropboxErrorTag(err: unknown): string | null {
  const body = (err as { error?: unknown } | null)?.error;
  const tag =
    (body as { ".tag"?: unknown } | undefined)?.[".tag"] ??
    (body as { error?: { ".tag"?: unknown } } | undefined)?.error?.[".tag"];
  return typeof tag === "string" ? tag : null;
}

/** DROPBOX_UPLOAD_ROOT, as a path: leading slash, no trailing slash. */
function uploadRootPath(): string {
  const raw = (process.env.DROPBOX_UPLOAD_ROOT ?? "").trim() || "/Media Uploads";
  return `/${raw.replace(/^\/+/, "")}`.replace(/\/+$/, "");
}

/** Creates the folder (and any missing parent), or returns the one that's already there. */
async function ensureFolder(path: string): Promise<string> {
  const dbx = getClient();
  try {
    const res = await withDropboxRetry(() => dbx.filesCreateFolderV2({ path, autorename: false }));
    return res.result.metadata.path_display ?? res.result.metadata.path_lower ?? path;
  } catch (err) {
    // A "path" error is the boring case — it's already there. Ask what it is
    // rather than trusting the tag: a *file* with the folder's name means the
    // upload can't go anywhere, and "Response failed with a 409" tells nobody
    // that. If the lookup itself fails (missing parent, bad name), the
    // original error is the one worth reporting.
    if (dropboxErrorTag(err) !== "path") throw err;
    let existing: Awaited<ReturnType<typeof dbx.filesGetMetadata>>;
    try {
      existing = await withDropboxRetry(() => dbx.filesGetMetadata({ path }));
    } catch {
      throw err;
    }
    if (existing.result[".tag"] !== "folder") {
      throw new Error(`Dropbox: "${path}" already exists as a file, so the upload folder can't be made`);
    }
    return existing.result.path_display ?? existing.result.path_lower ?? path;
  }
}

/**
 * Makes a new `<DROPBOX_UPLOAD_ROOT>/<folderName>` for one job and returns its
 * path. `autorename`, so a reshoot at an address that already has a folder
 * gets "<address> (1)" instead of mixing its files into the old shoot's — the
 * path is stored on the booking, so the name only has to be unique once.
 */
export async function createUploadFolder(folderName: string): Promise<string> {
  const dbx = getClient();
  await ensureFolder(uploadRootPath());
  const res = await withDropboxRetry(() =>
    dbx.filesCreateFolderV2({ path: `${uploadRootPath()}/${folderName}`, autorename: true })
  );
  return res.result.metadata.path_display ?? res.result.metadata.path_lower!;
}

/** Re-makes a stored upload folder if someone deleted or moved it in Dropbox. */
export async function ensureUploadFolder(path: string): Promise<string> {
  await ensureFolder(uploadRootPath());
  return ensureFolder(path);
}

/**
 * The folder behind one of the old "anyone can edit" upload links, for jobs
 * whose shooter was sent one before the upload page existed — so their new
 * page uploads into the same folder.
 */
export async function folderPathFromSharedLink(url: string): Promise<string | null> {
  try {
    const res = await withDropboxRetry(() => getClient().sharingGetSharedLinkMetadata({ url }));
    return res.result[".tag"] === "folder" ? (res.result.path_lower ?? null) : null;
  } catch (err) {
    console.error("folderPathFromSharedLink failed", err);
    return null;
  }
}

/**
 * A plain view-only link to a folder (or the one it already has). The upload
 * page is what shooters get; this is only for reading the folder elsewhere
 * (Flambient's import, via bookings.dropbox_upload_link).
 */
export async function createViewLink(path: string): Promise<string> {
  const dbx = getClient();
  try {
    const res = await withDropboxRetry(() => dbx.sharingCreateSharedLinkWithSettings({ path }));
    return res.result.url;
  } catch (err) {
    if (dropboxErrorTag(err) !== "shared_link_already_exists") throw err;
    const listed = await withDropboxRetry(() => dbx.sharingListSharedLinks({ path, direct_only: true }));
    const existing = listed.result.links[0];
    if (!existing) throw err;
    return existing.url;
  }
}

/** The Dropbox web page for a folder in this account. */
export function dropboxWebUrl(path: string): string {
  return `https://www.dropbox.com/home${path.split("/").map(encodeURIComponent).join("/")}`;
}

export interface FolderFile {
  /** Relative to the folder, as it was uploaded ("Video/clip 1.mp4"). */
  path: string;
  size: number;
}

/** Every file under a folder (subfolders too), so the upload page can skip what's already there. */
export async function listFolderFiles(folderPath: string): Promise<FolderFile[]> {
  const dbx = getClient();
  const prefix = folderPath.toLowerCase().replace(/\/+$/, "") + "/";
  const files: FolderFile[] = [];
  let res = await withDropboxRetry(() => dbx.filesListFolder({ path: folderPath, recursive: true, limit: 2000 }));
  for (;;) {
    for (const entry of res.result.entries) {
      if (entry[".tag"] !== "file") continue;
      const display = entry.path_display ?? entry.path_lower ?? "";
      const rel = display.toLowerCase().startsWith(prefix) ? display.slice(prefix.length) : entry.name;
      files.push({ path: rel, size: entry.size });
    }
    if (!res.result.has_more) break;
    const cursor = res.result.cursor;
    res = await withDropboxRetry(() => dbx.filesListFolderContinue({ cursor }));
  }
  return files;
}

/**
 * A one-file upload URL the browser POSTs the bytes to directly
 * (content.dropboxapi.com/apitul/…, CORS open, no token needed, ≤150 MB,
 * good for four hours). This is what keeps the upload page as fast as
 * Dropbox's own: photos never pass through this app. `add` + autorename:
 * re-sending identical bytes is a no-op, a different file with the same
 * name becomes "name (1)" — nothing is ever overwritten.
 */
export async function temporaryUploadLink(path: string): Promise<string> {
  const res = await withDropboxRetry(() =>
    getClient().filesGetTemporaryUploadLink({
      commit_info: { path, mode: { ".tag": "add" }, autorename: true, mute: true },
      duration: 14400,
    })
  );
  return res.result.link;
}

/** Biggest file a temporary upload link takes; larger ones go through an upload session. */
export const TEMP_LINK_MAX_BYTES = 150 * 1024 * 1024;
/** Concurrent upload sessions take appends in multiples of 4 MiB (except the last). */
export const SESSION_CHUNK_BYTES = 4 * 1024 * 1024;

// Upload sessions (files over 150 MB: drone and video clips) need the
// account's token, so they run here; the browser sends 4 MiB chunks, several
// at once, to /api/upload/[token]/large. Raw fetch rather than the SDK, to
// pass the chunk bytes straight through.
async function contentCall(endpoint: string, arg: unknown, body?: ArrayBuffer): Promise<Response> {
  const dbx = getClient();
  return withDropboxRetry(async () => {
    const auth = (dbx as unknown as { auth: { checkAndRefreshAccessToken(): Promise<void>; getAccessToken(): string } }).auth;
    await auth.checkAndRefreshAccessToken();
    const res = await fetch(`https://content.dropboxapi.com/2/files/${endpoint}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth.getAccessToken()}`,
        "Content-Type": "application/octet-stream",
        "Dropbox-API-Arg": JSON.stringify(arg).replace(/[\u007f-\uffff]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0")),
      },
      body: body ?? new ArrayBuffer(0),
      cache: "no-store",
    });
    if (res.status === 429 || res.status >= 500) {
      throw Object.assign(new Error(`Dropbox ${endpoint} ${res.status}: ${await res.text()}`), { status: res.status, headers: res.headers });
    }
    return res;
  });
}

async function dropboxJson<T>(res: Response, endpoint: string): Promise<T> {
  const text = await res.text();
  if (!res.ok) throw Object.assign(new Error(`Dropbox ${endpoint} ${res.status}: ${text}`), { status: res.status, body: text });
  return JSON.parse(text) as T;
}

export async function uploadSessionStart(): Promise<string> {
  const res = await contentCall("upload_session/start", { close: false, session_type: "concurrent" });
  return (await dropboxJson<{ session_id: string }>(res, "upload_session/start")).session_id;
}

/**
 * One chunk. A retry of a chunk Dropbox already took answers
 * incorrect_offset — that's success, not a failure.
 */
export async function uploadSessionAppend(sessionId: string, offset: number, close: boolean, body: ArrayBuffer): Promise<void> {
  const res = await contentCall("upload_session/append_v2", { cursor: { session_id: sessionId, offset }, close }, body);
  if (res.ok) return;
  const text = await res.text();
  if (res.status === 409 && text.includes("incorrect_offset")) return;
  throw Object.assign(new Error(`Dropbox append ${res.status}: ${text}`), { status: res.status });
}

/** Commits the session as a file; returns where it landed (autorename may add " (1)"). */
export async function uploadSessionFinish(sessionId: string, size: number, path: string): Promise<{ path: string; size: number }> {
  const res = await contentCall("upload_session/finish", {
    cursor: { session_id: sessionId, offset: size },
    commit: { path, mode: "add", autorename: true, mute: true },
  });
  const meta = await dropboxJson<{ path_display: string; size: number }>(res, "upload_session/finish");
  return { path: meta.path_display, size: meta.size };
}
