"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Pencil, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PortfolioListing } from "@/db/schema";
import { AGENT_PAGE_VIDEOS } from "@/lib/agentPage";
import { deletePortfolioTemplate, savePortfolioTemplate, type PortfolioTemplateSummary } from "../actions";
import { ImageUpload, JobSearch } from "../new/PortfolioLinkBuilder";

/** Area templates: the builder's starting listings, toggles and preview image for the cities they cover. */
export function TemplatesEditor({ templates }: { templates: PortfolioTemplateSummary[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<PortfolioTemplateSummary | "new" | null>(null);

  if (editing) {
    return (
      <TemplateForm
        key={editing === "new" ? "new" : editing.id}
        template={editing === "new" ? null : editing}
        onDone={() => {
          setEditing(null);
          router.refresh();
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {templates.map((t) => (
        <div key={t.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
          <div className="min-w-0">
            <p className="font-medium">{t.name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {t.towns.map((town) => town.replace(/\b\w/g, (ch) => ch.toUpperCase())).join(", ")} · {t.content.listings?.length ?? 0} listings
              {t.content.showOffer === false ? " · no $50 offer" : ""}
              {t.content.showTourOfHomes === false ? " · no Tour of Homes" : ""}
              {t.content.ogImage ? " · own preview image" : ""}
            </p>
          </div>
          <div className="flex shrink-0 gap-1">
            <Button variant="ghost" size="sm" onClick={() => setEditing(t)}>
              <Pencil />
              Edit
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                if (!confirm(`Delete the "${t.name}" template?`)) return;
                await deletePortfolioTemplate(t.id);
                router.refresh();
              }}
            >
              <Trash2 />
            </Button>
          </div>
        </div>
      ))}
      <Button variant="outline" className="self-start" onClick={() => setEditing("new")}>
        New template
      </Button>
    </div>
  );
}

function TemplateForm({ template, onDone }: { template: PortfolioTemplateSummary | null; onDone: () => void }) {
  const c = template?.content;
  const [name, setName] = useState(template?.name ?? "");
  const [towns, setTowns] = useState(
    (template?.towns ?? []).map((t) => t.replace(/\b\w/g, (ch) => ch.toUpperCase())).join(", ")
  );
  const [listings, setListings] = useState<PortfolioListing[]>(c?.listings ?? []);
  const [showTourOfHomes, setShowTourOfHomes] = useState(c?.showTourOfHomes ?? true);
  const [showOffer, setShowOffer] = useState(c?.showOffer ?? true);
  const [video, setVideo] = useState(c?.video ?? "summit");
  const [ogImage, setOgImage] = useState<string | null>(c?.ogImage ?? null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await savePortfolioTemplate({
        id: template?.id ?? null,
        name,
        towns: towns.split(","),
        content: { listings, showTourOfHomes, showOffer, video, leadPhoto: c?.leadPhoto ?? null, ogImage },
      });
      toast.success("Template saved");
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-5 rounded-lg border p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tpl-name">Name</Label>
          <Input id="tpl-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Douglas County" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tpl-towns">Cities</Label>
          <Input id="tpl-towns" value={towns} onChange={(e) => setTowns(e.target.value)} placeholder="Roseburg, Sutherlin, Winston" />
          <p className="text-xs text-muted-foreground">Comma-separated; matched on the agent&apos;s area.</p>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label>Default listings</Label>
        <p className="text-xs text-muted-foreground">None = the builder picks your nearest finished jobs as usual.</p>
        {listings.map((l) => (
          <div key={l.bookingId} className="flex items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-sm">
            <span className="truncate">
              {l.address || "No address"} <span className="text-muted-foreground">{l.city}</span>
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label="Remove listing"
              onClick={() => setListings((prev) => prev.filter((x) => x.bookingId !== l.bookingId))}
            >
              <X />
            </Button>
          </div>
        ))}
        <JobSearch exclude={listings.map((l) => l.bookingId)} onPick={(job) => setListings((prev) => [...prev, job])} />
      </div>

      <div className="flex flex-col gap-2">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={showTourOfHomes} onChange={(e) => setShowTourOfHomes(e.target.checked)} />
          Show &quot;Featured in the Eugene Tour of Homes&quot;
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={showOffer} onChange={(e) => setShowOffer(e.target.checked)} />
          Show the $50-off first shoot offer
        </label>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="tpl-video">Video</Label>
        <select
          id="tpl-video"
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
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Link preview image</Label>
        <p className="text-xs text-muted-foreground">Crops to 1200×630. None = the lead portfolio photo.</p>
        <div className="max-w-xs">
          <ImageUpload label="Preview" value={ogImage} onChange={setOgImage} />
        </div>
      </div>

      <div className="flex gap-2">
        <Button onClick={save} disabled={saving}>
          {saving && <Loader2 className="size-4 animate-spin" />}
          Save template
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
