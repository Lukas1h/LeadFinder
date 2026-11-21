/**
 * The shooter upload page's engine (no React in here; useUploader wraps it).
 *
 * Speed: files ≤150 MB (every photo) go from the browser straight to
 * Dropbox through temporary upload links — four at a time, links fetched
 * ahead in batches — so they never pass through this app. Bigger files
 * (video, drone clips) go as a Dropbox upload session, 4 MiB chunks, three
 * at a time, through /api/upload/[token]/large.
 *
 * Reliability: every request retries with backoff; a dropped connection
 * pauses everything until the browser is back online (without using up
 * retries); a transfer that stops making progress for a minute is aborted
 * and retried; files already in the folder (same path and size) are skipped,
 * so reopening the link after a closed tab picks up where it left off. The
 * screen is kept awake while uploading, and leaving the page asks first.
 */

export type UploadStatus = "queued" | "uploading" | "done" | "skipped" | "failed";

export interface UploadItem {
  id: number;
  file: File;
  /** Relative path inside the job's folder ("Video/DJI_0001.MP4"). */
  path: string;
  size: number;
  status: UploadStatus;
  loaded: number;
  error?: string;
}

export interface UploadSnapshot {
  items: UploadItem[];
  /** Files picked (skipped included). */
  totalFiles: number;
  doneFiles: number;
  skippedFiles: number;
  failedFiles: number;
  /** Bytes of the files being sent (skipped excluded) and how much is up. */
  totalBytes: number;
  loadedBytes: number;
  /** Bytes per second over the last few seconds. */
  speed: number;
  /** Seconds left at that speed, or null. */
  eta: number | null;
  state: "loading" | "idle" | "uploading" | "offline" | "done" | "error";
  /** The folder listing failed: uploads still work, already-uploaded files just aren't skipped. */
  listError: boolean;
}

export interface PickedFile {
  file: File;
  path: string;
}

const DIRECT_MAX = 150 * 1024 * 1024;
const CHUNK = 4 * 1024 * 1024;
const FILE_WORKERS = 4;
const MAX_LARGE_AT_ONCE = 2;
const CHUNKS_PER_FILE = 3;
const MAX_ATTEMPTS = 8;
const STALL_MS = 60_000;
const LINK_BATCH = 12;
const LINK_TTL_MS = 3.5 * 60 * 60 * 1000;
const PROGRESS_FLUSH_MS = 4000;

const JUNK = /^(\.ds_store|thumbs\.db|desktop\.ini|\._.*|\.spotlight-v100|\.trashes)$/i;

class RetryableError extends Error {}
class RestartFileError extends Error {}
class OfflineError extends Error {}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class UploadEngine {
  private items: UploadItem[] = [];
  private nextId = 1;
  private existing = new Map<string, number>();
  private listing: "loading" | "ok" | "error" = "loading";
  private listeners = new Set<() => void>();
  private snapshot: UploadSnapshot;
  private links = new Map<number, { url: string; at: number }>();
  private linkFetch: Promise<void> | null = null;
  private activeWorkers = 0;
  private activeLarge = 0;
  private batchId: string | null = null;
  private batchStart: Promise<void> | null = null;
  private pendingStart = { files: 0, bytes: 0, skipped: 0 };
  private needsFinish = false;
  private report = { doneFiles: 0, doneBytes: 0, recovered: 0, failed: [] as { path: string; error: string }[] };
  private everFailed = new Set<number>();
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private samples: { t: number; bytes: number }[] = [];
  private wakeLock: { release(): Promise<void> } | null = null;
  private online = typeof navigator === "undefined" ? true : navigator.onLine;
  private onlineWaiters: (() => void)[] = [];
  private notifyQueued = false;

  constructor(private token: string) {
    this.snapshot = this.compute();
    if (typeof window !== "undefined") {
      window.addEventListener("online", this.handleOnline);
      window.addEventListener("offline", this.handleOffline);
      window.addEventListener("beforeunload", this.handleBeforeUnload);
      document.addEventListener("visibilitychange", this.handleVisibility);
      this.loadExisting();
    }
  }

  destroy() {
    window.removeEventListener("online", this.handleOnline);
    window.removeEventListener("offline", this.handleOffline);
    window.removeEventListener("beforeunload", this.handleBeforeUnload);
    document.removeEventListener("visibilitychange", this.handleVisibility);
    if (this.flushTimer) clearInterval(this.flushTimer);
  }

  // ---------- React glue ----------

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = () => this.snapshot;

  /** Coalesces the many progress events into one render per frame. */
  private emit() {
    if (this.notifyQueued) return;
    this.notifyQueued = true;
    const run = () => {
      this.notifyQueued = false;
      this.snapshot = this.compute();
      this.listeners.forEach((l) => l());
    };
    if (typeof requestAnimationFrame !== "undefined" && document.visibilityState === "visible") requestAnimationFrame(run);
    else setTimeout(run, 250);
  }

  private compute(): UploadSnapshot {
    let doneFiles = 0, skippedFiles = 0, failedFiles = 0, totalBytes = 0, loadedBytes = 0, active = 0;
    for (const it of this.items) {
      if (it.status === "skipped") {
        skippedFiles++;
        continue;
      }
      totalBytes += it.size;
      loadedBytes += it.status === "done" ? it.size : it.loaded;
      if (it.status === "done") doneFiles++;
      else if (it.status === "failed") failedFiles++;
      else active++;
    }
    const now = Date.now();
    this.samples.push({ t: now, bytes: loadedBytes });
    while (this.samples.length > 2 && now - this.samples[0].t > 8000) this.samples.shift();
    const first = this.samples[0];
    const speed = now - first.t > 500 ? Math.max(0, ((loadedBytes - first.bytes) * 1000) / (now - first.t)) : 0;
    const eta = active > 0 && speed > 0 ? (totalBytes - loadedBytes) / speed : null;
    const state: UploadSnapshot["state"] =
      this.listing === "loading"
        ? "loading"
        : active > 0
          ? this.online
            ? "uploading"
            : "offline"
          : failedFiles > 0
            ? "error"
            : this.items.length > 0
              ? "done"
              : "idle";
    return {
      // Copies: the engine mutates its items, and the rows' memo compares old vs new.
      items: this.items.map((i) => ({ ...i })),
      totalFiles: this.items.length,
      doneFiles,
      skippedFiles,
      failedFiles,
      totalBytes,
      loadedBytes,
      speed,
      eta,
      state,
      listError: this.listing === "error",
    };
  }

  // ---------- adding files ----------

  private async loadExisting() {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(`/api/upload/${this.token}`, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { files: { path: string; size: number }[] };
        for (const f of data.files) this.existing.set(f.path.toLowerCase(), f.size);
        this.listing = "ok";
        break;
      } catch {
        await sleep(1000 * (attempt + 1));
      }
    }
    if (this.listing !== "ok") this.listing = "error";
    // Files picked while the listing loaded: skip the ones that turned out to
    // be there. Their start call waited for this, so the counts are right.
    for (const it of this.items) {
      if (it.status === "queued" && this.isAlreadyUploaded(it.path, it.size)) {
        it.status = "skipped";
        this.pendingStart.files--;
        this.pendingStart.bytes -= it.size;
        this.pendingStart.skipped++;
      }
    }
    if (this.items.length > 0) this.startBatch();
    this.emit();
    this.kick();
  }

  /** Only a path-and-size match counts: a different file with the same name is uploaded as "name (1)". */
  private isAlreadyUploaded(path: string, size: number) {
    return this.existing.get(path.toLowerCase()) === size;
  }

  /** The files dropped or picked. Junk (.DS_Store…) and exact repeats are left out. */
  addFiles(picked: PickedFile[]) {
    const inQueue = new Set(this.items.filter((i) => i.status !== "failed").map((i) => `${i.path.toLowerCase()}|${i.size}`));
    let added = 0;
    for (const { file, path } of picked) {
      const clean = path.replace(/^\/+/, "") || file.name;
      const name = clean.split("/").pop() ?? clean;
      if (JUNK.test(name)) continue;
      const key = `${clean.toLowerCase()}|${file.size}`;
      if (inQueue.has(key)) continue;
      inQueue.add(key);
      const skipped = this.listing === "ok" && this.isAlreadyUploaded(clean, file.size);
      this.items.push({ id: this.nextId++, file, path: clean, size: file.size, status: skipped ? "skipped" : "queued", loaded: 0 });
      if (skipped) this.pendingStart.skipped++;
      else {
        this.pendingStart.files++;
        this.pendingStart.bytes += file.size;
      }
      added++;
    }
    if (added === 0) return;
    this.needsFinish = true;
    if (this.listing !== "loading") this.startBatch();
    this.emit();
    this.kick();
  }

  /** Puts failed files back in the queue. */
  retryFailed(id?: number) {
    let any = false;
    for (const it of this.items) {
      if (it.status === "failed" && (id === undefined || it.id === id)) {
        it.status = "queued";
        it.loaded = 0;
        it.error = undefined;
        any = true;
      }
    }
    if (!any) return;
    this.needsFinish = true;
    this.startBatch(true); // reopens the finished batch, so its finish push is sent again
    this.emit();
    this.kick();
  }

  /** Drops a file that hasn't started yet. */
  remove(id: number) {
    const i = this.items.findIndex((it) => it.id === id && (it.status === "queued" || it.status === "failed"));
    if (i < 0) return;
    const [it] = this.items.splice(i, 1);
    if (it.status === "queued") {
      this.pendingStart.files = Math.max(0, this.pendingStart.files - 1);
      this.pendingStart.bytes = Math.max(0, this.pendingStart.bytes - it.size);
    }
    this.emit();
    this.maybeFinish();
  }

  // ---------- batch tracking ----------

  /** Tells the server about newly added files (its first call is the "started uploading" push). */
  private startBatch(force = false) {
    const run = async () => {
      // One start call at a time; files added meanwhile go in the next one.
      while (force || this.pendingStart.files > 0 || this.pendingStart.skipped > 0 || !this.batchId) {
        force = false;
        const counts = { ...this.pendingStart };
        this.pendingStart = { files: 0, bytes: 0, skipped: 0 };
        const res = await this.withRetry(() =>
          this.post(`/api/upload/${this.token}`, { action: "start", batchId: this.batchId, ...counts })
        ).catch(() => null);
        if (res?.batchId) this.batchId = res.batchId as string;
        else return; // tracking is best-effort; uploads carry on
        if (this.pendingStart.files === 0 && this.pendingStart.skipped === 0) break;
      }
    };
    this.batchStart = (this.batchStart ?? Promise.resolve()).then(run);
    if (!this.flushTimer) this.flushTimer = setInterval(() => this.flush(), PROGRESS_FLUSH_MS);
  }

  private async flush(keepalive = false) {
    await this.batchStart;
    if (!this.batchId) return;
    const r = this.report;
    if (r.doneFiles === 0 && r.failed.length === 0 && r.recovered === 0) return;
    this.report = { doneFiles: 0, doneBytes: 0, recovered: 0, failed: [] };
    try {
      await this.post(`/api/upload/${this.token}`, { action: "progress", batchId: this.batchId, ...r }, keepalive);
    } catch {
      // Put it back for the next flush.
      this.report.doneFiles += r.doneFiles;
      this.report.doneBytes += r.doneBytes;
      this.report.recovered += r.recovered;
      this.report.failed.push(...r.failed);
    }
  }

  private maybeFinish() {
    if (!this.needsFinish) return;
    if (this.items.some((i) => i.status === "queued" || i.status === "uploading")) return;
    this.needsFinish = false;
    this.releaseWakeLock();
    void (async () => {
      await this.flush();
      if (this.batchId) await this.withRetry(() => this.post(`/api/upload/${this.token}`, { action: "finish", batchId: this.batchId })).catch(() => {});
    })();
  }

  // ---------- scheduling ----------

  private kick() {
    if (this.listing === "loading") return; // wait to know what to skip
    if (this.items.some((i) => i.status === "queued")) this.acquireWakeLock();
    while (this.activeWorkers < FILE_WORKERS) {
      const next = this.items.find(
        (i) => i.status === "queued" && (i.size <= DIRECT_MAX || this.activeLarge < MAX_LARGE_AT_ONCE)
      );
      if (!next) break;
      next.status = "uploading";
      next.loaded = 0;
      this.activeWorkers++;
      const large = next.size > DIRECT_MAX;
      if (large) this.activeLarge++;
      void this.runItem(next).finally(() => {
        this.activeWorkers--;
        if (large) this.activeLarge--;
        this.emit();
        this.kick();
        this.maybeFinish();
      });
    }
    this.emit();
  }

  private async runItem(item: UploadItem) {
    try {
      if (item.size > DIRECT_MAX) await this.uploadLarge(item);
      else await this.uploadDirect(item);
      item.status = "done";
      item.loaded = item.size;
      this.report.doneFiles++;
      this.report.doneBytes += item.size;
      if (this.everFailed.delete(item.id)) this.report.recovered++;
    } catch (err) {
      item.status = "failed";
      item.loaded = 0;
      item.error = err instanceof Error ? err.message : "Upload failed";
      if (!this.everFailed.has(item.id)) {
        this.everFailed.add(item.id);
        this.report.failed.push({ path: item.path, error: item.error });
      }
    }
  }

  // ---------- small files: straight to Dropbox ----------

  private async uploadDirect(item: UploadItem) {
    await this.withRetry(async () => {
      const url = await this.linkFor(item);
      try {
        await this.xhr("POST", url, item.file, (loaded) => {
          item.loaded = loaded;
          this.emit();
        });
      } catch (err) {
        this.links.delete(item.id); // a fresh link for the retry
        item.loaded = 0;
        throw err;
      }
      this.links.delete(item.id);
    });
  }

  /** A link for this file, fetching links for the next few queued files in the same request. */
  private async linkFor(item: UploadItem): Promise<string> {
    for (let i = 0; i < 3; i++) {
      const have = this.links.get(item.id);
      if (have && Date.now() - have.at < LINK_TTL_MS) return have.url;
      if (!this.linkFetch) {
        const want = [item, ...this.items.filter((i) => i !== item && i.status === "queued" && i.size <= DIRECT_MAX && !this.links.has(i.id))].slice(0, LINK_BATCH);
        this.linkFetch = this.post(`/api/upload/${this.token}`, { action: "links", files: want.map((w) => ({ path: w.path, size: w.size })) })
          .then((res) => {
            const links = (res.links ?? []) as (string | null)[];
            want.forEach((w, idx) => {
              if (links[idx]) this.links.set(w.id, { url: links[idx]!, at: Date.now() });
            });
          })
          .finally(() => {
            this.linkFetch = null;
          });
      }
      await this.linkFetch;
    }
    const have = this.links.get(item.id);
    if (have) return have.url;
    throw new RetryableError("Couldn't get an upload link");
  }

  // ---------- big files: chunked upload session ----------

  private async uploadLarge(item: UploadItem) {
    for (let restart = 0; ; restart++) {
      try {
        await this.uploadLargeOnce(item);
        return;
      } catch (err) {
        if (err instanceof RestartFileError && restart < 2) continue;
        throw err instanceof RestartFileError ? new Error("Dropbox lost part of this file") : err;
      }
    }
  }

  private async uploadLargeOnce(item: UploadItem) {
    const base = `/api/upload/${this.token}/large`;
    const sessionId = String((await this.withRetry(() => this.post(`${base}?op=start`, {}))).sessionId ?? "");
    if (!sessionId) throw new Error("Dropbox didn't start the upload");
    const count = Math.ceil(item.size / CHUNK);
    const chunkLoaded = new Array<number>(count).fill(0);
    const update = () => {
      item.loaded = chunkLoaded.reduce((a, b) => a + b, 0);
      this.emit();
    };

    const send = (index: number) =>
      this.withRetry(async () => {
        const start = index * CHUNK;
        const blob = item.file.slice(start, Math.min(start + CHUNK, item.size));
        const close = index === count - 1 ? "1" : "0";
        try {
          await this.xhr("PUT", `${base}?session=${encodeURIComponent(sessionId)}&offset=${start}&close=${close}`, blob, (loaded) => {
            chunkLoaded[index] = loaded;
            update();
          });
          chunkLoaded[index] = blob.size;
          update();
        } catch (err) {
          chunkLoaded[index] = 0;
          update();
          throw err;
        }
      });

    // Every chunk but the last, a few at a time; then the closing one.
    let next = 0;
    let failed = false;
    const worker = async () => {
      try {
        while (!failed && next < count - 1) await send(next++);
      } catch (err) {
        failed = true; // stop the other workers feeding a session that's being abandoned
        throw err;
      }
    };
    await Promise.all(Array.from({ length: Math.min(CHUNKS_PER_FILE, Math.max(1, count - 1)) }, worker));
    await send(count - 1);
    await this.withRetry(() => this.post(`${base}?op=finish`, { sessionId, path: item.path, size: item.size }));
  }

  // ---------- transport ----------

  /**
   * One upload with progress. Rejects with RetryableError for anything worth
   * trying again (network, timeout, 429/5xx, no progress for a minute),
   * RestartFileError when the server says the session is gone.
   */
  private xhr(method: string, url: string, body: Blob, onProgress: (loaded: number) => void): Promise<void> {
    if (!this.online) return Promise.reject(new OfflineError("offline"));
    return new Promise((resolve, reject) => {
      const req = new XMLHttpRequest();
      let last = Date.now();
      const watchdog = setInterval(() => {
        if (Date.now() - last > STALL_MS) req.abort();
      }, 5000);
      const done = () => clearInterval(watchdog);
      req.open(method, url);
      req.setRequestHeader("Content-Type", "application/octet-stream");
      req.upload.onprogress = (e) => {
        last = Date.now();
        onProgress(e.loaded);
      };
      req.onload = () => {
        done();
        if (req.status >= 200 && req.status < 300) return resolve();
        let restart = false;
        try {
          restart = JSON.parse(req.responseText)?.restart === true;
        } catch {}
        if (restart) return reject(new RestartFileError("restart"));
        if (req.status === 429 || req.status >= 500 || req.status === 0) return reject(new RetryableError(`Server said ${req.status}`));
        // A 4xx from a temporary link (e.g. it expired) is fixed by a new link too.
        reject(new RetryableError(`Upload refused (${req.status})`));
      };
      req.onerror = () => {
        done();
        reject(this.online ? new RetryableError("Network error") : new OfflineError("offline"));
      };
      req.onabort = () => {
        done();
        reject(new RetryableError("Upload stalled"));
      };
      req.ontimeout = req.onabort;
      req.send(body);
    });
  }

  private async post(url: string, body: unknown, keepalive = false): Promise<Record<string, unknown>> {
    if (!this.online) throw new OfflineError("offline");
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
        keepalive,
      });
    } catch {
      throw this.online ? new RetryableError("Network error") : new OfflineError("offline");
    }
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.ok) return data;
    if (data.restart === true) throw new RestartFileError("restart");
    if (res.status === 404) throw new Error("This upload link isn't valid anymore");
    throw new RetryableError((data.error as string) ?? `Server said ${res.status}`);
  }

  /**
   * Runs fn until it works: backoff up to 30 s, MAX_ATTEMPTS tries, and time
   * spent offline doesn't count as a try. RestartFileError and plain Errors
   * pass straight through.
   */
  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; ) {
      try {
        return await fn();
      } catch (err) {
        if (err instanceof OfflineError) {
          await this.waitOnline();
          continue;
        }
        if (!(err instanceof RetryableError) || attempt >= MAX_ATTEMPTS) throw err;
        await sleep(Math.min(30_000, 1000 * 2 ** (attempt - 1)) + Math.random() * 500);
        attempt++;
      }
    }
  }

  private waitOnline(): Promise<void> {
    if (this.online) return sleep(1000);
    return new Promise<void>((r) => {
      this.onlineWaiters.push(r);
    });
  }

  private handleOnline = () => {
    this.online = true;
    this.onlineWaiters.splice(0).forEach((r) => r());
    this.emit();
  };

  private handleOffline = () => {
    this.online = false;
    this.emit();
  };

  private handleBeforeUnload = (e: BeforeUnloadEvent) => {
    if (this.items.some((i) => i.status === "queued" || i.status === "uploading")) {
      e.preventDefault();
      e.returnValue = "";
    }
    void this.flush(true);
  };

  /** Wake locks drop when the page is hidden; take it back on return. */
  private handleVisibility = () => {
    if (document.visibilityState === "visible" && this.items.some((i) => i.status === "uploading" || i.status === "queued")) {
      this.wakeLock = null;
      this.acquireWakeLock();
    }
    if (document.visibilityState === "hidden") void this.flush(true);
  };

  private acquireWakeLock() {
    if (this.wakeLock) return;
    const wl = (navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<{ release(): Promise<void> }> } }).wakeLock;
    wl?.request("screen")
      .then((lock) => {
        this.wakeLock = lock;
      })
      .catch(() => {});
  }

  private releaseWakeLock() {
    this.wakeLock?.release().catch(() => {});
    this.wakeLock = null;
  }
}

// ---------- reading drops ----------

interface FsEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?(ok: (f: File) => void, err: (e: unknown) => void): void;
  createReader?(): { readEntries(ok: (e: FsEntry[]) => void, err: (e: unknown) => void): void };
}

/** Files from a drop, folders included (kept as subfolders: "Video/clip.mp4"). */
export async function filesFromDrop(dt: DataTransfer): Promise<PickedFile[]> {
  const entries: FsEntry[] = [];
  for (const item of Array.from(dt.items)) {
    if (item.kind !== "file") continue;
    const entry = (item as DataTransferItem & { webkitGetAsEntry?(): FsEntry | null }).webkitGetAsEntry?.();
    if (entry) entries.push(entry);
  }
  // No entry API: plain files only.
  if (entries.length === 0) return Array.from(dt.files).map((file) => ({ file, path: file.name }));

  const out: PickedFile[] = [];
  const walk = async (entry: FsEntry, prefix: string): Promise<void> => {
    if (entry.isFile && entry.file) {
      const file = await new Promise<File>((ok, err) => entry.file!(ok, err));
      out.push({ file, path: prefix + file.name });
    } else if (entry.isDirectory && entry.createReader) {
      const reader = entry.createReader();
      // readEntries hands back at most ~100 at a time; keep asking until it's empty.
      for (;;) {
        const batch = await new Promise<FsEntry[]>((ok, err) => reader.readEntries(ok, err));
        if (batch.length === 0) break;
        for (const child of batch) await walk(child, `${prefix}${entry.name}/`);
      }
    }
  };
  for (const entry of entries) await walk(entry, "");
  return out;
}

/** Files from an <input type=file>, with a picked folder's subfolders kept. */
export function filesFromInput(list: FileList | null): PickedFile[] {
  return Array.from(list ?? []).map((file) => ({
    file,
    path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
  }));
}
