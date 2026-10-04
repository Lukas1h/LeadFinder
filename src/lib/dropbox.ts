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

  let res = await dbx.filesListFolder({ path: "", shared_link: { url: sharedLink } });
  for (;;) {
    for (const entry of res.result.entries) {
      if (entry[".tag"] !== "file" || !entry.path_lower) continue;
      if (IMAGE_EXTENSION_RE.test(entry.name)) photos.push({ name: entry.name, pathLower: entry.path_lower });
      else if (VIDEO_EXTENSION_RE.test(entry.name)) videos.push({ name: entry.name, pathLower: entry.path_lower });
    }
    if (!res.result.has_more) break;
    res = await dbx.filesListFolderContinue({ cursor: res.result.cursor });
  }

  const byName = (a: GalleryPhoto, b: GalleryPhoto) => a.name.localeCompare(b.name, undefined, { numeric: true });
  const media = { photos: photos.sort(byName), videos: videos.sort(byName) };
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
  const res = await getClient().filesGetTemporaryLink({ path: pathLower });
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
  const res = await dbx.filesGetThumbnailV2({
    resource: { ".tag": "path", path: pathLower },
    format: { ".tag": "jpeg" },
    size: { ".tag": size },
    mode: { ".tag": "bestfit" },
  });
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
