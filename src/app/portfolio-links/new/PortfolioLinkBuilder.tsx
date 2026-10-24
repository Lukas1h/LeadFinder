"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import Link from "next/link";
import { ImagePlus, Loader2, Plus, Wand2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PortfolioListing } from "@/db/schema";
import { AGENT_PAGE_PHOTOS, AGENT_PAGE_VIDEOS } from "@/lib/agentPage";
import { formatPhone } from "@/lib/format";
import {
  createPortfolioLinkAction,
  getPortfolioPrefill,
  searchAgentsForPortfolio,
  searchJobsForPortfolio,
  uploadPortfolioImage,
  type AgentMatch,
  type PortfolioPrefill,
} from "../actions";

/**
 * Builds one agent page. Picking an agent (or arriving from their profile's
 * "Create portfolio" button, ?agent=<id>) fills in their first name, area,
 * brokerage and Lukas's nearest finished jobs as listings — all editable.
 */
export function PortfolioLinkBuilder({
  initial,
  initialBefore,
  initialAfter,
}: {
  initial: PortfolioPrefill | null;
  /** From the photo editor's "Use on agent page" (?before=&after=). */
  initialBefore: string | null;
  initialAfter: string | null;
}) {
  const router = useRouter();
  const [agent, setAgent] = useState<AgentMatch | null>(initial?.agent ?? null);
  const [loadingAgent, setLoadingAgent] = useState(false);
  const [firstName, setFirstName] = useState(initial?.firstName ?? "");
  const [area, setArea] = useState(initial?.area ?? "");
  const [brokerage, setBrokerage] = useState(initial?.brokerage ?? "");
  const [listings, setListings] = useState<PortfolioListing[]>(initial?.listings ?? []);
  const [editorListingId, setEditorListingId] = useState<string | null>(initial?.editorListingId ?? null);
  const [video, setVideo] = useState("summit");
  const [leadPhoto, setLeadPhoto] = useState(AGENT_PAGE_PHOTOS[0].key);
  const [showTourOfHomes, setShowTourOfHomes] = useState(true);
  const [showOffer, setShowOffer] = useState(true);
  const [beforeSrc, setBeforeSrc] = useState<string | null>(initialBefore);
  const [afterSrc, setAfterSrc] = useState<string | null>(initialAfter);

  const [creating, setCreating] = useState(false);
  const [result, setResult] = useState<{ slug: string; url: string } | null>(null);

  const pickAgent = async (a: AgentMatch | null) => {
    setAgent(a);
    if (!a) return;
    setLoadingAgent(true);
    try {
      const prefill = await getPortfolioPrefill(a.id);
      if (!prefill) return;
      setFirstName(prefill.firstName);
      setArea(prefill.area);
      setBrokerage(prefill.brokerage);
      setListings(prefill.listings);
      setEditorListingId(prefill.editorListingId);
    } catch {
      toast.error("Couldn't load that agent's details");
    } finally {
      setLoadingAgent(false);
    }
  };

  const updateListing = (i: number, patch: Partial<PortfolioListing>) =>
    setListings((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const create = async () => {
    setCreating(true);
    try {
      const { slug, url } = await createPortfolioLinkAction(agent?.id ?? null, {
        area: area.trim() || null,
        agentFirstName: firstName.trim() || null,
        brokerage: brokerage.trim() || null,
        video,
        leadPhoto,
        showTourOfHomes,
        showOffer,
        // Only the after is needed: on its own it's shown against a dulled copy of itself.
        beforeAfter: Boolean(afterSrc),
        beforeSrc: afterSrc ? beforeSrc : null,
        afterSrc,
        listings,
      });
      setResult({ slug, url });
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create the link");
    } finally {
      setCreating(false);
    }
  };

  if (result) {
    return (
      <div className="flex flex-col gap-4 rounded-lg border p-6">
        <p className="font-medium">Link ready{agent?.name ? ` for ${agent.name}` : ""}:</p>
        <div className="flex items-center gap-2">
          <Input readOnly value={result.url} className="font-mono text-sm" />
          <Button
            variant="outline"
            onClick={() => {
              navigator.clipboard.writeText(result.url);
              toast.success("Copied");
            }}
          >
            Copy
          </Button>
          <Button variant="outline" asChild>
            <a href={`${result.url}?preview=1`} target="_blank" rel="noopener noreferrer">
              Open
            </a>
          </Button>
        </div>
        <Button variant="ghost" onClick={() => router.push("/portfolio-links")}>
          Done
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-1.5">
        <Label>Agent</Label>
        <AgentSearch value={agent} onChange={pickAgent} />
        {loadingAgent && <p className="text-xs text-muted-foreground">Filling in from their profile…</p>}
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pl-first-name">First name</Label>
          <Input id="pl-first-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Sarah" />
          <p className="text-xs text-muted-foreground">&quot;Thanks for taking a look, ___&quot; — blank hides it.</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pl-area">Area</Label>
          <Input id="pl-area" value={area} onChange={(e) => setArea(e.target.value)} placeholder="Eugene" />
          <p className="text-xs text-muted-foreground">&quot;Real estate photo &amp; video in ___&quot;</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pl-brokerage">Brokerage</Label>
          <Input id="pl-brokerage" value={brokerage} onChange={(e) => setBrokerage(e.target.value)} />
          <p className="text-xs text-muted-foreground">Only in the prefilled &quot;Book a shoot&quot; text.</p>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <Label>Before / after</Label>
        <p className="text-xs text-muted-foreground">
          Leads the page when there&apos;s an after photo, with the video under it; without one, the video is the hero. No before
          photo = the after shown dulled.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <ImageUpload label="Before" value={beforeSrc} onChange={setBeforeSrc} />
          <ImageUpload label="After" value={afterSrc} onChange={setAfterSrc} />
        </div>
        <Button variant="outline" size="sm" asChild className="self-start">
          <Link href={editorHref(editorListingId, agent?.id ?? null)}>
            <Wand2 />
            {editorListingId ? "Edit a photo from their listing" : "Make one in the photo editor"}
          </Link>
        </Button>
        <p className="text-xs text-muted-foreground">
          In the editor, &quot;Use on agent page&quot; on a finished edit brings it back here as the before/after.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-2">
          <Label>Recent listings</Label>
          <span className="text-xs text-muted-foreground">Your finished jobs; none = the section is hidden</span>
        </div>
        {listings.map((l, i) => (
          <ListingEditor
            key={l.bookingId}
            listing={l}
            onChange={(patch) => updateListing(i, patch)}
            onRemove={() => setListings((prev) => prev.filter((_, j) => j !== i))}
          />
        ))}
        <JobSearch
          exclude={listings.map((l) => l.bookingId)}
          onPick={(job) => setListings((prev) => [...prev, job])}
        />
      </section>

      <section className="flex flex-col gap-1.5">
        <Label htmlFor="pl-video">Video</Label>
        <select
          id="pl-video"
          value={video}
          onChange={(e) => setVideo(e.target.value)}
          className="h-9 max-w-xs rounded-md border bg-transparent px-3 text-sm"
        >
          {Object.entries(AGENT_PAGE_VIDEOS).map(([key, v]) => (
            <option key={key} value={key}>
              {v.title}
            </option>
          ))}
        </select>
      </section>

      <section className="flex flex-col gap-1.5">
        <Label>Lead photo (first in the grid)</Label>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {/* Not the last photo: it always closes the section full-width. */}
          {AGENT_PAGE_PHOTOS.slice(0, -1).map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setLeadPhoto(p.key)}
              className={`overflow-hidden rounded ${leadPhoto === p.key ? "ring-2 ring-primary" : "opacity-70 hover:opacity-100"}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- static sample */}
              <img src={p.src} alt={p.alt} className="aspect-[3/2] w-full object-cover" />
            </button>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={showTourOfHomes} onChange={(e) => setShowTourOfHomes(e.target.checked)} />
          Show &quot;Featured in the Eugene Tour of Homes&quot;
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={showOffer} onChange={(e) => setShowOffer(e.target.checked)} />
          Show the $50-off first shoot offer
        </label>
      </section>

      <Button onClick={create} disabled={creating || loadingAgent} className="self-start">
        {creating && <Loader2 className="size-4 animate-spin" />}
        Create link
      </Button>
    </div>
  );
}

/** The photo editor on the agent's newest listing; ?agent= carries them back if that listing has no agent link. */
function editorHref(listingId: string | null, agentId: string | null): string {
  const params = new URLSearchParams();
  if (listingId) params.set("listing", listingId);
  if (agentId) params.set("agent", agentId);
  const q = params.toString();
  return q ? `/photo-editor?${q}` : "/photo-editor";
}

/** Name autocomplete, same pattern as the booking form's contact field. */
function AgentSearch({ value, onChange }: { value: AgentMatch | null; onChange: (a: AgentMatch | null) => void }) {
  const [query, setQuery] = useState(value?.name ?? "");
  const [suggestions, setSuggestions] = useState<AgentMatch[]>([]);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleChange = (text: string) => {
    setQuery(text);
    if (value) onChange(null);
    if (timer.current) clearTimeout(timer.current);
    if (text.trim().length < 2) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    timer.current = setTimeout(async () => {
      const results = await searchAgentsForPortfolio(text);
      setSuggestions(results);
      setOpen(results.length > 0);
    }, 200);
  };

  return (
    <div className="relative max-w-sm">
      <Input
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => setOpen(suggestions.length > 0 && !value)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Start typing a name"
        autoComplete="off"
      />
      {open && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border bg-popover shadow-md">
          {suggestions.map((a) => (
            <button
              key={a.id}
              type="button"
              onMouseDown={() => {
                setOpen(false);
                setQuery(a.name ?? "");
                onChange(a);
              }}
              className="flex w-full flex-col gap-0.5 px-3 py-2 text-left text-sm hover:bg-muted"
            >
              <span className="text-foreground">{a.name}</span>
              <span className="text-xs text-muted-foreground">{formatPhone(a.phone) ?? a.email ?? "No contact info saved"}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Adds one of Lukas's finished jobs as a listing card. */
function JobSearch({ exclude, onPick }: { exclude: string[]; onPick: (job: PortfolioListing) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PortfolioListing[]>([]);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleChange = (text: string) => {
    setQuery(text);
    if (timer.current) clearTimeout(timer.current);
    if (text.trim().length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }
    timer.current = setTimeout(async () => {
      const rows = await searchJobsForPortfolio(text);
      setResults(rows);
      setOpen(rows.length > 0);
    }, 200);
  };

  const shown = results.filter((r) => !exclude.includes(r.bookingId));

  return (
    <div className="relative max-w-sm">
      <Plus className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => setOpen(shown.length > 0)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Add a job by address or city"
        className="pl-8"
        autoComplete="off"
      />
      {open && shown.length > 0 && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border bg-popover shadow-md">
          {shown.map((job) => (
            <button
              key={job.bookingId}
              type="button"
              onMouseDown={() => {
                setOpen(false);
                setQuery("");
                onPick(job);
              }}
              className="flex w-full flex-col gap-0.5 px-3 py-2 text-left text-sm hover:bg-muted"
            >
              <span className="text-foreground">{job.address || "No address"}</span>
              <span className="text-xs text-muted-foreground">{[job.city, job.price].filter(Boolean).join(" · ")}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const LISTING_FIELDS: { key: keyof Omit<PortfolioListing, "bookingId" | "photos">; label: string; wide?: boolean }[] = [
  { key: "address", label: "Address", wide: true },
  { key: "city", label: "City", wide: true },
  { key: "status", label: "Badge" },
  { key: "price", label: "Price" },
  { key: "beds", label: "Beds" },
  { key: "baths", label: "Baths" },
  { key: "sqft", label: "Sqft" },
  { key: "type", label: "Type" },
  { key: "agent", label: "Listing agent", wide: true },
  { key: "brokerage", label: "Brokerage", wide: true },
];

function ListingEditor({
  listing,
  onChange,
  onRemove,
}: {
  listing: PortfolioListing;
  onChange: (patch: Partial<PortfolioListing>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="relative rounded-lg border p-3 pr-10">
      <Button type="button" variant="ghost" size="icon" onClick={onRemove} aria-label="Remove listing" className="absolute top-1.5 right-1.5">
        <X />
      </Button>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {LISTING_FIELDS.map((f) => (
          <label key={f.key} className={`flex flex-col gap-1 ${f.wide ? "col-span-2" : ""}`}>
            <span className="text-xs text-muted-foreground">{f.label}</span>
            <Input value={listing[f.key]} onChange={(e) => onChange({ [f.key]: e.target.value })} className="h-8 text-sm" />
          </label>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Photos: the first few from this job&apos;s gallery.</p>
    </div>
  );
}

const MAX_UPLOAD_EDGE = 2400;

/** Shrinks a photo in the browser (phone photos are 5-15 MB) before it's uploaded. */
async function shrink(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_UPLOAD_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't read that image"))), "image/jpeg", 0.86)
  );
}

function ImageUpload({ label, value, onChange }: { label: string; value: string | null; onChange: (url: string | null) => void }) {
  const [uploading, setUploading] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", new File([await shrink(file)], "photo.jpg", { type: "image/jpeg" }));
      const { url } = await uploadPortfolioImage(form);
      onChange(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <div className="relative aspect-[3/2] overflow-hidden rounded-lg border bg-muted/40">
      {value ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- uploaded photo */}
          <img src={value} alt={label} className="h-full w-full object-cover" />
          <span className="absolute top-2 left-2 rounded bg-background/90 px-1.5 py-0.5 text-xs font-medium">{label}</span>
          <Button
            type="button"
            variant="secondary"
            size="icon"
            onClick={() => onChange(null)}
            aria-label={`Remove ${label.toLowerCase()} photo`}
            className="absolute top-2 right-2 size-7"
          >
            <X />
          </Button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={uploading}
          className="flex h-full w-full flex-col items-center justify-center gap-1 text-sm text-muted-foreground hover:bg-muted"
        >
          {uploading ? <Loader2 className="size-5 animate-spin" /> : <ImagePlus className="size-5" />}
          {uploading ? "Uploading…" : `${label} photo`}
        </button>
      )}
      <input ref={input} type="file" accept="image/*" className="hidden" onChange={(e) => handleFile(e.target.files?.[0])} />
    </div>
  );
}
