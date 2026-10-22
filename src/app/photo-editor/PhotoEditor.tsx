"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Crop, Download, ImagePlus, Loader2, PenLine, RotateCcw, Ruler, Search, Sparkles, X } from "lucide-react";
import { PHOTO_PRESETS } from "@/lib/photoPresets";
import { NO_GEOMETRY, isIdentity, type Geometry } from "@/lib/photoGeometry";
import { makeZip } from "@/lib/zip";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AnnotateDialog } from "./AnnotateDialog";
import { BeforeAfter } from "./BeforeAfter";
import { CropDialog } from "./CropDialog";
import { TransformDialog } from "./TransformDialog";
import { loadSource, prepare, type Prepared, type SourceImage, type Stroke } from "./prepare";
import { getEditorListing, searchEditorListings, type EditorListing, type EditorSearchResult } from "./actions";

/** At once: each edit takes 10-25 s, and more in parallel only meets Gemini's rate limit sooner. */
const CONCURRENCY = 3;
/** Uploads are shrunk to this before sending: a phone's 4000px original would pass Vercel's 4.5 MB request limit. */
const UPLOAD_MAX_PX = 2048;
/** The preset menu's "no preset" choice: the notes are the whole prompt. */
const NOTES_ONLY = "notes";
const DEFAULT_PRESET = "bright-interior";

interface Photo {
  key: string;
  /** What the browser shows: the listing's own URL, or the upload as a data URL. */
  preview: string;
  source: { url: string } | { data: string; mimeType: string };
  name: string;
}

interface Edit {
  status: "working" | "done" | "error";
  image?: string;
  error?: string;
  label: string;
}

/** A photo in the tray, with everything set for it alone. */
interface Item {
  photo: Photo;
  presetId: string;
  notes: string;
  geometry: Geometry;
  strokes: Stroke[];
  /** The straightened/cropped photo and its marked copy, rendered when either is set; null sends the original. */
  prepared: Prepared | null;
  edit?: Edit;
}

type Tool = { key: string; kind: "annotate" | "transform" | "crop"; source: SourceImage };

const newItem = (photo: Photo, presetId: string = DEFAULT_PRESET): Item => ({
  photo,
  presetId,
  notes: "",
  geometry: NO_GEOMETRY,
  strokes: [],
  prepared: null,
});

const presetLabel = (id: string) => (id === NOTES_ONLY ? "Notes only" : (PHOTO_PRESETS.find((p) => p.id === id)?.label ?? id));
const b64 = (dataUrl: string) => dataUrl.slice(dataUrl.indexOf(",") + 1);

export function PhotoEditor({
  initialListing,
  initialPreset,
}: {
  initialListing: EditorListing | null;
  /** The preset photos added to the tray start on (?preset=, e.g. sunset-exterior from a twilight gift card). */
  initialPreset?: string | null;
}) {
  const startPreset =
    initialPreset && PHOTO_PRESETS.some((p) => p.id === initialPreset) ? initialPreset : DEFAULT_PRESET;
  const addItem = (photo: Photo) => newItem(photo, startPreset);
  const router = useRouter();
  const [listing, setListing] = useState<EditorListing | null>(initialListing);
  const [photos, setPhotos] = useState<Photo[]>(() => (initialListing ? listingPhotos(initialListing) : []));
  const [items, setItems] = useState<Item[]>([]);
  const [tool, setTool] = useState<Tool | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const queue = useRef<{ key: string; body: Record<string, unknown>; label: string }[]>([]);
  const running = useRef(0);

  const update = (key: string, patch: Partial<Item>) =>
    setItems((prev) => prev.map((it) => (it.photo.key === key ? { ...it, ...patch } : it)));

  const loadListing = async (id: string) => {
    const found = await getEditorListing(id);
    if (!found) return toast.error("Couldn't load that listing");
    setListing(found);
    setPhotos(listingPhotos(found));
    setItems([]);
    router.replace(`/photo-editor?listing=${id}`, { scroll: false });
  };

  const addUploads = async (files: FileList | null) => {
    if (!files?.length) return;
    const added: Photo[] = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) continue;
      try {
        const dataUrl = await shrinkImage(file);
        added.push({
          key: `upload-${crypto.randomUUID()}`,
          preview: dataUrl,
          source: { data: b64(dataUrl), mimeType: "image/jpeg" },
          name: file.name.replace(/\.[^.]+$/, ""),
        });
      } catch {
        toast.error(`Couldn't read ${file.name}`);
      }
    }
    setPhotos((prev) => [...prev, ...added]);
    setItems((prev) => [...prev, ...added.map(addItem)]);
  };

  const inTray = new Set(items.map((it) => it.photo.key));
  const toggle = (photo: Photo) =>
    setItems((prev) =>
      prev.some((it) => it.photo.key === photo.key) ? prev.filter((it) => it.photo.key !== photo.key) : [...prev, addItem(photo)]
    );

  const openTool = async (item: Item, kind: Tool["kind"]) => {
    setOpening(`${item.photo.key}:${kind}`);
    try {
      setTool({ key: item.photo.key, kind, source: await loadSource(item.photo.key, item.photo.source) });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't load that photo");
    } finally {
      setOpening(null);
    }
  };

  /** New straightening or marks: re-render what will be sent, or go back to the original when there's nothing left. */
  const applyTool = (item: Item, source: SourceImage, geometry: Geometry, strokes: Stroke[]) => {
    const prepared = isIdentity(geometry) && strokes.length === 0 ? null : prepare(source, geometry, strokes);
    if (prepared === null && !(isIdentity(geometry) && strokes.length === 0)) {
      return toast.error("Those lines can't all be squared up");
    }
    update(item.photo.key, { geometry, strokes, prepared });
    setTool(null);
  };

  const pump = () => {
    while (running.current < CONCURRENCY && queue.current.length > 0) {
      const job = queue.current.shift()!;
      running.current++;
      fetch("/api/photo-editor/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(job.body),
      })
        .then(async (res) => {
          const body = (await res.json().catch(() => ({}))) as { image?: string; error?: string };
          if (!res.ok || !body.image) throw new Error(body.error ?? `Edit failed (${res.status})`);
          update(job.key, { edit: { status: "done", image: body.image, label: job.label } });
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : "Edit failed";
          update(job.key, { edit: { status: "error", error: message, label: job.label } });
        })
        .finally(() => {
          running.current--;
          pump();
        });
    }
  };

  /** Each photo goes with its own preset, notes, marks and straightening, as they are right now. */
  const run = (targets: Item[]) => {
    const jobs: typeof queue.current = [];
    for (const it of targets) {
      const notes = it.notes.trim();
      const notesOnly = it.presetId === NOTES_ONLY;
      if (notesOnly && !notes && it.strokes.length === 0) {
        toast.error(`${it.photo.name}: write a note or pick a preset`);
        continue;
      }
      const source = it.prepared ? { data: b64(it.prepared.clean), mimeType: "image/jpeg" } : it.photo.source;
      jobs.push({
        key: it.photo.key,
        label: presetLabel(it.presetId) + (notes ? " + notes" : "") + (it.strokes.length ? " + removal" : ""),
        body: {
          ...source,
          ...(notesOnly
            ? { prompt: notes || "Keep the photo exactly as it is apart from the removal below." }
            : { presetId: it.presetId, notes: notes || undefined }),
          marked: it.prepared?.marked ? b64(it.prepared.marked) : undefined,
          geometryFixed: !isIdentity(it.geometry) || undefined,
        },
      });
    }
    if (jobs.length === 0) return;
    const working = new Set(jobs.map((j) => j.key));
    setItems((prev) =>
      prev.map((it) =>
        working.has(it.photo.key)
          ? { ...it, edit: { status: "working", label: jobs.find((j) => j.key === it.photo.key)!.label } }
          : it
      )
    );
    queue.current.push(...jobs);
    pump();
  };

  const done = items.filter((it) => it.edit?.status === "done");
  const working = items.filter((it) => it.edit?.status === "working").length;
  const baseName = slug(listing ? [listing.address, listing.city].filter(Boolean).join(" ") : "photos");
  /** The edit comes back as whatever the model sent (PNG by default) — name the download after it, not the source. */
  const fileName = (it: Item) => {
    const ext = it.edit?.image?.startsWith("data:image/png") ? "png" : "jpg";
    return `${baseName}-${String(items.indexOf(it) + 1).padStart(2, "0")}.${ext}`;
  };

  const downloadAll = async () => {
    const files = await Promise.all(
      done.map(async (it) => ({
        name: fileName(it),
        bytes: new Uint8Array(await (await fetch(it.edit!.image!)).arrayBuffer()),
      }))
    );
    saveBlob(makeZip(files), `${baseName}-edited.zip`);
  };

  const toolItem = tool && items.find((it) => it.photo.key === tool.key);
  const closeTool = (open: boolean) => !open && setTool(null);

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3 rounded-lg border p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <ListingSearch onPick={loadListing} />
          <span className="text-center text-xs text-muted-foreground">or</span>
          <Button variant="outline" asChild>
            <label className="cursor-pointer">
              <ImagePlus />
              Upload photos
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  addUploads(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
          </Button>
        </div>
        {listing && (
          <div className="text-sm">
            <span className="font-medium">{listing.address ?? "Listing"}</span>
            {listing.city && <span className="text-muted-foreground">, {listing.city}</span>}
            {listing.agentName && <span className="text-muted-foreground"> · {listing.agentName}</span>}
            {listing.score != null && <span className="text-muted-foreground"> · photo score {listing.score}/10</span>}
          </div>
        )}
      </section>

      {photos.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-medium">
              Photos <span className="text-muted-foreground">· tap to add to the edit, {items.length} of {photos.length} added</span>
            </h2>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setItems((prev) => [...prev, ...photos.filter((p) => !inTray.has(p.key)).map(addItem)])}
              >
                Add all
              </Button>
              <Button variant="ghost" size="sm" disabled={working > 0} onClick={() => setItems([])}>
                Clear
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6 lg:grid-cols-8">
            {photos.map((photo) => {
              const on = inTray.has(photo.key);
              return (
                <button
                  key={photo.key}
                  type="button"
                  onClick={() => toggle(photo)}
                  className={cn(
                    "relative aspect-[4/3] overflow-hidden rounded-md border-2",
                    on ? "border-primary" : "border-transparent opacity-70 hover:opacity-100"
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photo.preview} alt={photo.name} className="h-full w-full object-cover" loading="lazy" />
                  {on && (
                    <span className="absolute top-1 right-1 rounded-full bg-primary p-0.5 text-primary-foreground">
                      <Check className="size-3" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {items.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-medium">
              To edit{" "}
              <span className="text-muted-foreground">
                · {items.length} photo{items.length === 1 ? "" : "s"}
                {done.length > 0 && `, ${done.length} done`}
                {working > 0 && `, ${working} working`}
              </span>
            </h2>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => run(items.filter((it) => it.edit?.status !== "working"))}>
                <Sparkles />
                Edit all
              </Button>
              <Button size="sm" variant="outline" disabled={done.length === 0} onClick={downloadAll}>
                <Download />
                Download all ({done.length})
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Each photo has its own preset and notes. <PenLine className="inline size-3" /> marks things to remove,{" "}
            <Ruler className="inline size-3" /> straightens with guide lines, <Crop className="inline size-3" /> crops and
            rotates. Check every edit before using it: the model redraws the photo and can still change details.
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            {items.map((it) => (
              <ItemCard
                key={it.photo.key}
                item={it}
                opening={opening}
                fileName={fileName(it)}
                onChange={(patch) => update(it.photo.key, patch)}
                onTool={(kind) => openTool(it, kind)}
                onRun={() => run([it])}
                onRemove={() => setItems((prev) => prev.filter((x) => x.photo.key !== it.photo.key))}
              />
            ))}
          </div>
        </section>
      )}

      {tool && toolItem && tool.kind === "transform" && (
        <TransformDialog
          open
          onOpenChange={closeTool}
          source={tool.source}
          guides={toolItem.geometry.guides}
          // New guides change the frame, so the old crop no longer means anything.
          onApply={(guides) => applyTool(toolItem, tool.source, { ...toolItem.geometry, guides, crop: null }, toolItem.strokes)}
        />
      )}
      {tool && toolItem && tool.kind === "crop" && (
        <CropDialog
          open
          onOpenChange={closeTool}
          source={tool.source}
          geometry={toolItem.geometry}
          onApply={(change) => applyTool(toolItem, tool.source, { ...toolItem.geometry, ...change }, toolItem.strokes)}
        />
      )}
      {tool && toolItem && tool.kind === "annotate" && (
        <AnnotateDialog
          open
          onOpenChange={closeTool}
          source={tool.source}
          geometry={toolItem.geometry}
          strokes={toolItem.strokes}
          onApply={(strokes) => applyTool(toolItem, tool.source, toolItem.geometry, strokes)}
        />
      )}
    </div>
  );
}

/** One photo in the tray: the picture (or its before/after), then one compact row of its settings and tools. */
function ItemCard({
  item,
  opening,
  fileName,
  onChange,
  onTool,
  onRun,
  onRemove,
}: {
  item: Item;
  opening: string | null;
  fileName: string;
  onChange: (patch: Partial<Item>) => void;
  onTool: (kind: Tool["kind"]) => void;
  onRun: () => void;
  onRemove: () => void;
}) {
  const { photo, edit, prepared, geometry, strokes } = item;
  const busy = edit?.status === "working";
  const before = prepared?.clean ?? photo.preview;
  const shown = prepared?.marked ?? before;
  const straightened = geometry.guides.length > 0;
  const cropped = geometry.rotation !== 0 || geometry.crop !== null;

  const tool = (kind: Tool["kind"], label: string, icon: React.ReactNode, active: boolean) => (
    <Button
      variant={active ? "secondary" : "ghost"}
      size="icon"
      title={label}
      disabled={busy || opening != null}
      onClick={() => onTool(kind)}
      className={cn(active && "text-red-600 dark:text-red-400")}
    >
      {opening === `${photo.key}:${kind}` ? <Loader2 className="animate-spin" /> : icon}
      <span className="sr-only">{label}</span>
    </Button>
  );

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-2">
      {edit?.status === "done" && edit.image ? (
        <BeforeAfter before={before} after={edit.image} alt={photo.name} />
      ) : (
        <div className="relative aspect-[4/3] overflow-hidden rounded-md bg-black">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={shown} alt={photo.name} className={cn("h-full w-full object-contain", busy && "opacity-40")} />
          {busy && (
            <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-white">
              <Loader2 className="size-4 animate-spin" /> Editing…
            </div>
          )}
          {(straightened || cropped || strokes.length > 0) && (
            <div className="absolute top-2 left-2 flex gap-1">
              {straightened && <Tag>Straightened</Tag>}
              {cropped && <Tag>{geometry.rotation ? `Rotated ${geometry.rotation.toFixed(1)}°` : "Cropped"}</Tag>}
              {strokes.length > 0 && <Tag>Removing {strokes.length} mark{strokes.length === 1 ? "" : "s"}</Tag>}
            </div>
          )}
        </div>
      )}
      <div className="flex items-center gap-1">
        <Select value={item.presetId} onValueChange={(presetId) => onChange({ presetId })}>
          <SelectTrigger size="sm" className="w-[8.5rem] shrink-0 text-xs" title="Preset">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PHOTO_PRESETS.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.label}
              </SelectItem>
            ))}
            <SelectItem value={NOTES_ONLY}>Notes only</SelectItem>
          </SelectContent>
        </Select>
        <Input
          value={item.notes}
          onChange={(e) => onChange({ notes: e.target.value })}
          onKeyDown={(e) => e.key === "Enter" && !busy && onRun()}
          placeholder={item.presetId === NOTES_ONLY ? "What to do to this photo" : "Notes for this photo"}
          maxLength={500}
          className="h-7 min-w-0 flex-1 text-xs"
        />
        {tool("annotate", "Mark things to remove", <PenLine />, strokes.length > 0)}
        {tool("transform", "Straighten with guides", <Ruler />, straightened)}
        {tool("crop", "Crop and rotate", <Crop />, cropped)}
        <Button variant="ghost" size="icon" title={edit ? "Redo" : "Edit"} disabled={busy} onClick={onRun}>
          {busy ? <Loader2 className="animate-spin" /> : edit ? <RotateCcw /> : <Sparkles />}
          <span className="sr-only">{edit ? "Redo" : "Edit"}</span>
        </Button>
        {edit?.image && (
          <Button variant="ghost" size="icon" title="Download" asChild>
            <a href={edit.image} download={fileName}>
              <Download />
              <span className="sr-only">Download</span>
            </a>
          </Button>
        )}
        <Button variant="ghost" size="icon" title="Remove from the edit" disabled={busy} onClick={onRemove}>
          <X />
          <span className="sr-only">Remove</span>
        </Button>
      </div>
      {edit?.status === "error" && <p className="px-1 text-xs text-destructive">{edit.error}</p>}
      {edit?.status === "done" && <p className="px-1 text-xs text-muted-foreground">{edit.label}</p>}
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return <span className="rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">{children}</span>;
}

function ListingSearch({ onPick }: { onPick: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<EditorSearchResult[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (query.trim().length < 2) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      searchEditorListings(query)
        .then((rows) => !cancelled && setResults(rows))
        .catch(() => {});
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  return (
    <div className="relative flex-1">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Find a listing by address, city, or agent"
        className="pl-8"
      />
      {open && query.trim().length >= 2 && results.length > 0 && (
        <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border bg-popover shadow-md">
          {results.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-accent"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setOpen(false);
                  setQuery([r.address, r.city].filter(Boolean).join(", "));
                  onPick(r.id);
                }}
              >
                {r.thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.thumb} alt="" className="size-10 shrink-0 rounded object-cover" />
                ) : (
                  <span className="size-10 shrink-0 rounded bg-muted" />
                )}
                <span className="min-w-0">
                  <span className="block truncate font-medium">{r.address ?? "No address"}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {[r.city, r.agentName, r.score != null ? `score ${r.score}/10` : null].filter(Boolean).join(" · ")}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function listingPhotos(listing: EditorListing): Photo[] {
  return listing.photos.map((url, i) => ({
    key: `${listing.id}-${i}`,
    preview: url,
    source: { url },
    name: `Photo ${i + 1}`,
  }));
}

function shrinkImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, UPLOAD_MAX_PX / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("no canvas"));
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(objectUrl);
      resolve(canvas.toDataURL("image/jpeg", 0.9));
    };
    img.onerror = () => reject(new Error("unreadable"));
    img.src = objectUrl;
  });
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "photos";
}

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
