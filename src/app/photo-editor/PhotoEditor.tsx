"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Download, ImagePlus, Loader2, RotateCcw, Search, Sparkles, X } from "lucide-react";
import { PHOTO_PRESETS } from "@/lib/photoPresets";
import { makeZip } from "@/lib/zip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BeforeAfter } from "./BeforeAfter";
import { getEditorListing, searchEditorListings, type EditorListing, type EditorSearchResult } from "./actions";

/** At once: each edit takes 10-25 s, and more in parallel only meets Gemini's rate limit sooner. */
const CONCURRENCY = 3;
/** Uploads are shrunk to this before sending: a phone's 4000px original would pass Vercel's 4.5 MB request limit. */
const UPLOAD_MAX_PX = 2048;
const CUSTOM = "custom";

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

export function PhotoEditor({ initialListing }: { initialListing: EditorListing | null }) {
  const router = useRouter();
  const [listing, setListing] = useState<EditorListing | null>(initialListing);
  const [photos, setPhotos] = useState<Photo[]>(() => (initialListing ? listingPhotos(initialListing) : []));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [presetId, setPresetId] = useState(PHOTO_PRESETS[0].id);
  const [customPrompt, setCustomPrompt] = useState("");
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const queue = useRef<{ photo: Photo; presetId: string; prompt: string; label: string }[]>([]);
  const running = useRef(0);

  const loadListing = async (id: string) => {
    const found = await getEditorListing(id);
    if (!found) return toast.error("Couldn't load that listing");
    setListing(found);
    setPhotos(listingPhotos(found));
    setSelected(new Set());
    setEdits({});
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
          source: { data: dataUrl.split(",")[1], mimeType: "image/jpeg" },
          name: file.name.replace(/\.[^.]+$/, ""),
        });
      } catch {
        toast.error(`Couldn't read ${file.name}`);
      }
    }
    setPhotos((prev) => [...prev, ...added]);
    setSelected((prev) => new Set([...prev, ...added.map((p) => p.key)]));
  };

  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const pump = () => {
    while (running.current < CONCURRENCY && queue.current.length > 0) {
      const job = queue.current.shift()!;
      running.current++;
      fetch("/api/photo-editor/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...job.photo.source, presetId: job.presetId, prompt: job.prompt || undefined }),
      })
        .then(async (res) => {
          const body = (await res.json().catch(() => ({}))) as { image?: string; error?: string };
          if (!res.ok || !body.image) throw new Error(body.error ?? `Edit failed (${res.status})`);
          setEdits((prev) => ({ ...prev, [job.photo.key]: { status: "done", image: body.image, label: job.label } }));
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : "Edit failed";
          setEdits((prev) => ({ ...prev, [job.photo.key]: { status: "error", error: message, label: job.label } }));
        })
        .finally(() => {
          running.current--;
          pump();
        });
    }
  };

  const run = (targets: Photo[]) => {
    const prompt = presetId === CUSTOM ? customPrompt.trim() : "";
    if (presetId === CUSTOM && !prompt) return toast.error("Write a prompt first");
    const label = presetId === CUSTOM ? "Custom" : PHOTO_PRESETS.find((p) => p.id === presetId)!.label;
    setEdits((prev) => {
      const next = { ...prev };
      for (const photo of targets) next[photo.key] = { status: "working", label };
      return next;
    });
    queue.current.push(...targets.map((photo) => ({ photo, presetId, prompt, label })));
    pump();
  };

  const selectedPhotos = photos.filter((p) => selected.has(p.key));
  const editedPhotos = photos.filter((p) => edits[p.key]);
  const done = editedPhotos.filter((p) => edits[p.key].status === "done");
  const working = editedPhotos.filter((p) => edits[p.key].status === "working").length;
  const baseName = slug(listing ? [listing.address, listing.city].filter(Boolean).join(" ") : "photos");
  /** The edit comes back as whatever the model sent (PNG by default) — name the download after it, not the source. */
  const fileName = (p: Photo) => {
    const ext = edits[p.key]?.image?.startsWith("data:image/png") ? "png" : "jpg";
    return `${baseName}-${String(photos.indexOf(p) + 1).padStart(2, "0")}.${ext}`;
  };

  const downloadAll = async () => {
    const files = await Promise.all(
      done.map(async (p) => ({
        name: fileName(p),
        bytes: new Uint8Array(await (await fetch(edits[p.key].image!)).arrayBuffer()),
      }))
    );
    saveBlob(makeZip(files), `${baseName}-edited.zip`);
  };

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
              Photos <span className="text-muted-foreground">· {selected.size} of {photos.length} selected</span>
            </h2>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setSelected(new Set(photos.map((p) => p.key)))}>
                Select all
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                Clear
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {photos.map((photo) => {
              const on = selected.has(photo.key);
              return (
                <button
                  key={photo.key}
                  type="button"
                  onClick={() => toggle(photo.key)}
                  className={`relative aspect-[4/3] overflow-hidden rounded-md border-2 ${on ? "border-primary" : "border-transparent opacity-70 hover:opacity-100"}`}
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

          <div className="flex flex-col gap-2 rounded-lg border p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Select value={presetId} onValueChange={setPresetId}>
                <SelectTrigger className="sm:w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PHOTO_PRESETS.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.label}
                    </SelectItem>
                  ))}
                  <SelectItem value={CUSTOM}>Custom prompt</SelectItem>
                </SelectContent>
              </Select>
              <Button disabled={selectedPhotos.length === 0} onClick={() => run(selectedPhotos)}>
                <Sparkles />
                Edit {selectedPhotos.length} photo{selectedPhotos.length === 1 ? "" : "s"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {presetId === CUSTOM
                ? "Describe the edit. Every edit also gets the standard retouching rules: ultra-bright, straightened, de-glared, blinds untouched, nothing invented."
                : PHOTO_PRESETS.find((p) => p.id === presetId)?.description}
            </p>
            {presetId === CUSTOM && (
              <Textarea
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                placeholder="e.g. Brighten the room, replace the grey sky with blue, straighten the verticals"
                rows={3}
              />
            )}
          </div>
        </section>
      )}

      {editedPhotos.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-medium">
              Edits{" "}
              <span className="text-muted-foreground">
                · {done.length} done{working > 0 && `, ${working} working`}
              </span>
            </h2>
            <Button size="sm" disabled={done.length === 0} onClick={downloadAll}>
              <Download />
              Download all ({done.length})
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Check each one before using it: the model redraws the photo and can still change details.
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            {editedPhotos.map((photo) => {
              const edit = edits[photo.key];
              return (
                <div key={photo.key} className="flex flex-col gap-2 rounded-lg border p-2">
                  {edit.status === "done" && edit.image ? (
                    <BeforeAfter before={photo.preview} after={edit.image} alt={photo.name} />
                  ) : (
                    <div className="relative aspect-[4/3] overflow-hidden rounded-md bg-muted">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={photo.preview} alt={photo.name} className="h-full w-full object-contain opacity-40" />
                      <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm">
                        {edit.status === "working" ? (
                          <span className="flex items-center gap-2">
                            <Loader2 className="size-4 animate-spin" /> Editing…
                          </span>
                        ) : (
                          <span className="text-destructive">{edit.error}</span>
                        )}
                      </div>
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">{edit.label}</span>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" disabled={edit.status === "working"} onClick={() => run([photo])}>
                        <RotateCcw />
                        Redo
                      </Button>
                      {edit.image && (
                        <Button variant="ghost" size="sm" asChild>
                          <a href={edit.image} download={fileName(photo)}>
                            <Download />
                          </a>
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={edit.status === "working"}
                        onClick={() =>
                          setEdits((prev) => {
                            const next = { ...prev };
                            delete next[photo.key];
                            return next;
                          })
                        }
                      >
                        <X />
                        <span className="sr-only">Remove</span>
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
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
