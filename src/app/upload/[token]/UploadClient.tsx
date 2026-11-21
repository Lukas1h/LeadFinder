"use client";

import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { CheckCircle2, File as FileIcon, Film, Image as ImageIcon, UploadCloud, X, WifiOff, AlertCircle } from "lucide-react";
import { UploadEngine, filesFromDrop, filesFromInput, type UploadItem, type UploadStatus } from "./uploadEngine";

const MAX_ROWS = 200;
const PHOTO_EXT = /\.(jpe?g|png|heic|heif|tiff?|dng|cr2|cr3|nef|arw|raf|orf|rw2|webp|gif|bmp)$/i;
const VIDEO_EXT = /\.(mp4|mov|m4v|avi|mkv|mts|m2ts|insv|lrv|webm|3gp)$/i;

function fmtBytes(n: number) {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

function fmtEta(s: number | null) {
  if (s == null || !Number.isFinite(s)) return "…";
  if (s < 60) return `${Math.max(1, Math.round(s))} sec`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

function useFolderPickerSupported() {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    const ua = navigator.userAgent;
    const iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const touchOnly = window.matchMedia?.("(pointer: coarse)").matches && !window.matchMedia?.("(pointer: fine)").matches;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- feature detection needs the browser
    setOk("webkitdirectory" in document.createElement("input") && !iOS && !touchOnly);
  }, []);
  return ok;
}

const rank: Record<UploadStatus, number> = { failed: 0, uploading: 1, queued: 2, done: 3, skipped: 3 };

export function UploadClient({
  token,
  address,
  jobDate,
  shooterFirstName,
}: {
  token: string;
  address: string | null;
  jobDate: string | null;
  shooterFirstName: string | null;
}) {
  const [engine] = useState(() => new UploadEngine(token));
  useEffect(() => () => engine.destroy(), [engine]);
  const snap = useSyncExternalStore(engine.subscribe, engine.getSnapshot, engine.getSnapshot);

  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const folderOk = useFolderPickerSupported();
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

  // Accept drops anywhere on the page.
  useEffect(() => {
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files");
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current++;
      setDragging(true);
    };
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    };
    const drop = async (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      if (e.dataTransfer) engine.addFiles(await filesFromDrop(e.dataTransfer));
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, [engine]);

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    engine.addFiles(filesFromInput(e.target.files));
    e.target.value = "";
  };

  const { items } = snap;
  const sorted = useMemo(() => {
    const active = items.filter((i) => i.status === "failed" || i.status === "uploading");
    active.sort((a, b) => rank[a.status] - rank[b.status]);
    const rest = items.filter((i) => i.status !== "failed" && i.status !== "uploading");
    rest.sort((a, b) => rank[a.status] - rank[b.status]);
    return active.concat(rest);
  }, [items]);
  const shown = sorted.slice(0, MAX_ROWS);

  const sendFiles = snap.totalFiles - snap.skippedFiles;
  const pct = snap.totalBytes > 0 ? Math.min(100, Math.floor((snap.loadedBytes / snap.totalBytes) * 100)) : snap.state === "done" ? 100 : 0;

  return (
    <main className="max-w-3xl mx-auto px-6 py-12 flex flex-col items-center gap-2 font-[family-name:var(--font-gallery-sans)] text-[#181A1C]">
      <div className="font-[family-name:var(--font-gallery-serif)] font-bold text-4xl sm:text-5xl tracking-tight">Hahn Media</div>
      <div className="text-xs uppercase tracking-[0.3em] text-[#181A1C]/70">Real Estate Photo &amp; Video</div>
      <div className="w-full h-px bg-[#181A1C]/10 my-6" />
      <p className="italic text-sm text-[#181A1C]/70 text-center max-w-md mb-6">
        Hi {shooterFirstName ?? "there"}! Drop the raw photos and video from the shoot here — they go straight to Lukas.
      </p>

      <h1 className="text-xl font-semibold text-center">{address ?? "Upload"}</h1>
      {jobDate && <p className="text-sm text-[#181A1C]/60">{jobDate}</p>}

      <div
        className={`w-full mt-6 rounded-xl border-2 border-dashed px-6 py-10 flex flex-col items-center gap-3 text-center transition-colors ${
          dragging ? "border-[#181A1C]/60 bg-[#F9F4F1]" : "border-[#181A1C]/20 bg-[#F9F4F1]/40"
        }`}
      >
        <UploadCloud className="size-10 text-[#181A1C]/60" />
        <p className="font-semibold">{dragging ? "Drop to upload" : "Drag photos & video here"}</p>
        <div className="flex flex-wrap items-center justify-center gap-3 mt-1">
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className="inline-flex items-center gap-2 rounded-lg bg-[#181A1C] text-white px-5 py-2.5 text-sm font-semibold hover:opacity-90 transition-opacity"
          >
            Choose files
          </button>
          {folderOk && (
            <button
              type="button"
              onClick={() => folderInput.current?.click()}
              className="inline-flex items-center gap-2 rounded-lg border border-[#181A1C]/15 bg-white px-5 py-2.5 text-sm font-semibold hover:bg-[#F9F4F1] transition-colors"
            >
              Choose folder
            </button>
          )}
        </div>
        <input ref={fileInput} type="file" multiple hidden onChange={onPick} />
        <input ref={folderInput} type="file" multiple hidden onChange={onPick} {...{ webkitdirectory: "" }} />
        {snap.state === "loading" && <p className="text-xs text-[#181A1C]/50">Checking what&rsquo;s already uploaded…</p>}
      </div>

      {snap.totalFiles > 0 && (
        <div className="w-full mt-6 rounded-xl border border-[#181A1C]/10 p-5 flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-3xl font-semibold tabular-nums">{pct}%</span>
            {snap.state === "uploading" && snap.speed > 0 && (
              <span className="text-sm text-[#181A1C]/60 tabular-nums">
                {fmtBytes(snap.speed)}/s · about {fmtEta(snap.eta)} left
              </span>
            )}
          </div>
          <div className="h-2 rounded-full bg-[#F9F4F1] overflow-hidden">
            <div className="h-full rounded-full bg-[#181A1C] transition-[width] duration-300 ease-out" style={{ width: `${pct}%` }} />
          </div>
          {sendFiles > 0 && (
            <p className="text-sm text-[#181A1C]/70 tabular-nums">
              {snap.doneFiles} of {sendFiles} files · {fmtBytes(snap.loadedBytes)} of {fmtBytes(snap.totalBytes)}
            </p>
          )}
          {snap.skippedFiles > 0 && <p className="text-xs text-[#181A1C]/50">{snap.skippedFiles} already uploaded, skipped</p>}
          {snap.state === "uploading" && <p className="text-xs text-[#181A1C]/50">Keep this page open until it says done.</p>}
          {snap.state === "offline" && (
            <p className="text-sm text-amber-700 flex items-center gap-2">
              <WifiOff className="size-4 shrink-0" />
              You&rsquo;re offline — uploads will resume automatically when you&rsquo;re back online.
            </p>
          )}
          {snap.state === "done" && (
            <p className="text-sm font-semibold text-green-700 flex items-center gap-2">
              <CheckCircle2 className="size-4 shrink-0" />
              {sendFiles > 0 ? "All done — Lukas has been notified. Thanks!" : "These files are already uploaded — nothing more to send."}
            </p>
          )}
          {snap.state === "error" && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-red-700 flex items-center gap-2">
                <AlertCircle className="size-4 shrink-0" />
                {snap.failedFiles} file{snap.failedFiles === 1 ? "" : "s"} didn&rsquo;t upload
              </p>
              <button
                type="button"
                onClick={() => engine.retryFailed()}
                className="inline-flex items-center gap-2 rounded-lg bg-[#181A1C] text-white px-5 py-2.5 text-sm font-semibold hover:opacity-90 transition-opacity"
              >
                Retry failed
              </button>
            </div>
          )}
          {snap.listError && (
            <p className="text-[11px] text-[#181A1C]/40">Couldn&rsquo;t check what&rsquo;s already uploaded — everything will be sent.</p>
          )}
        </div>
      )}

      {shown.length > 0 && (
        <ul className="w-full mt-4 divide-y divide-[#181A1C]/5 rounded-xl border border-[#181A1C]/10">
          {shown.map((item) => (
            <Row
              key={item.id}
              item={item}
              pct={item.size > 0 ? Math.floor((item.loaded / item.size) * 100) : 0}
              onRetry={engine.retryFailed.bind(engine)}
              onRemove={engine.remove.bind(engine)}
            />
          ))}
          {sorted.length > MAX_ROWS && (
            <li className="px-4 py-2.5 text-xs text-[#181A1C]/50 text-center">+ {sorted.length - MAX_ROWS} more</li>
          )}
        </ul>
      )}

      <footer className="w-full mt-12 pt-6 border-t border-[#181A1C]/10 text-center text-xs text-[#181A1C]/50">
        Lukas Hahn · (541) 430-3372 · lukas@lukashahn.media
      </footer>
    </main>
  );
}

const Row = memo(
  function Row({
    item,
    pct,
    onRetry,
    onRemove,
  }: {
    item: UploadItem;
    pct: number;
    onRetry: (id: number) => void;
    onRemove: (id: number) => void;
  }) {
    const Icon = PHOTO_EXT.test(item.path) ? ImageIcon : VIDEO_EXT.test(item.path) ? Film : FileIcon;
    const removable = item.status === "queued" || item.status === "failed";
    return (
      <li className="flex items-center gap-3 px-4 py-2.5">
        <Icon className="size-4 shrink-0 text-[#181A1C]/50" />
        <div className="min-w-0 flex-1">
          <p className="text-sm truncate">{item.path}</p>
          <p className="text-xs text-[#181A1C]/50">{fmtBytes(item.size)}</p>
        </div>
        <div className="shrink-0 flex items-center gap-2 text-xs max-w-[45%]">
          {item.status === "queued" && <span className="text-[#181A1C]/50">Waiting</span>}
          {item.status === "uploading" && (
            <>
              <div className="w-16 h-1.5 rounded-full bg-[#F9F4F1] overflow-hidden">
                <div className="h-full bg-[#181A1C] transition-[width] duration-300" style={{ width: `${pct}%` }} />
              </div>
              <span className="tabular-nums text-[#181A1C]/70 w-8 text-right">{pct}%</span>
            </>
          )}
          {item.status === "done" && <CheckCircle2 className="size-4 text-green-600" />}
          {item.status === "skipped" && <span className="text-[#181A1C]/50">Already uploaded</span>}
          {item.status === "failed" && (
            <>
              <span className="text-red-700 truncate">{item.error ?? "Failed"}</span>
              <button type="button" onClick={() => onRetry(item.id)} className="font-semibold underline underline-offset-2 shrink-0">
                Retry
              </button>
            </>
          )}
          {removable && (
            <button
              type="button"
              onClick={() => onRemove(item.id)}
              aria-label="Remove"
              className="shrink-0 rounded p-0.5 text-[#181A1C]/40 hover:text-[#181A1C] hover:bg-[#F9F4F1]"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </li>
    );
  },
  (a, b) => a.item.id === b.item.id && a.item.status === b.item.status && a.pct === b.pct && a.item.error === b.item.error
);
