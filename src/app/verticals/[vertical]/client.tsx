"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { portfolioPreviewUrl } from "@/lib/siteUrls";
import { formatDuration } from "@/app/portfolio-links/duration";
import { CopyLinkButton } from "@/app/portfolio-links/CopyLinkButton";
import {
  createVerticalLinkAction,
  deleteVerticalLinkAction,
  updateVerticalLinkAction,
  type VerticalLinkInput,
} from "../actions";
import type { VerticalLinkRow } from "../data";

type FormValues = { company: string; contactName: string; phone: string; area: string; notes: string };
const EMPTY: FormValues = { company: "", contactName: "", phone: "", area: "", notes: "" };

function toInput(f: FormValues): VerticalLinkInput {
  const opt = (s: string) => s.trim() || undefined;
  return { company: f.company.trim(), contactName: opt(f.contactName), phone: opt(f.phone), area: opt(f.area), notes: opt(f.notes) };
}

/** "Create portfolio": the form, then the new link with Copy / Open preview. */
export function CreateLinkButton({ vertical }: { vertical: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [created, setCreated] = useState<{ url: string } | null>(null);
  return (
    <>
      <Button
        onClick={() => {
          setCreated(null);
          setOpen(true);
        }}
      >
        <Plus />
        Create portfolio
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          {created ? (
            <>
              <DialogHeader>
                <DialogTitle>Page ready</DialogTitle>
                <DialogDescription>Copy the link and text it. Open preview doesn&apos;t count as a visit.</DialogDescription>
              </DialogHeader>
              <p className="break-all rounded-md border bg-muted/40 px-3 py-2 font-mono text-xs">{created.url}</p>
              <DialogFooter className="gap-2">
                <PreviewButton url={created.url} />
                <CopyLinkButton url={created.url} />
              </DialogFooter>
            </>
          ) : (
            <LinkForm
              title="Create portfolio"
              submitLabel="Create"
              initial={EMPTY}
              onSubmit={async (input) => {
                const res = await createVerticalLinkAction(vertical, input);
                setCreated({ url: res.url });
                router.refresh();
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function LinkForm({
  title,
  submitLabel,
  initial,
  onSubmit,
}: {
  title: string;
  submitLabel: string;
  initial: FormValues;
  onSubmit: (input: VerticalLinkInput) => Promise<void>;
}) {
  const [f, setF] = useState<FormValues>(initial);
  const [pending, startTransition] = useTransition();
  const set = (k: keyof FormValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!f.company.trim()) return;
        startTransition(async () => {
          try {
            await onSubmit(toInput(f));
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Couldn't save");
          }
        });
      }}
    >
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>The company name is only for you; the page never shows it.</DialogDescription>
      </DialogHeader>
      <Field label="Company" id="vl-company">
        <Input id="vl-company" value={f.company} onChange={set("company")} required autoFocus />
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Contact first name" id="vl-name">
          <Input id="vl-name" value={f.contactName} onChange={set("contactName")} />
        </Field>
        <Field label="Phone" id="vl-phone">
          <Input id="vl-phone" type="tel" value={f.phone} onChange={set("phone")} />
        </Field>
      </div>
      <Field label="Area / town" id="vl-area">
        <Input id="vl-area" value={f.area} onChange={set("area")} placeholder="Shown in the headline, e.g. Salem" />
      </Field>
      <Field label="Notes" id="vl-notes">
        <Textarea id="vl-notes" value={f.notes} onChange={set("notes")} rows={3} />
      </Field>
      <DialogFooter>
        <Button type="submit" disabled={pending || !f.company.trim()}>
          {pending ? "Saving…" : submitLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

function PreviewButton({ url }: { url: string }) {
  return (
    <Button variant="outline" size="sm" asChild>
      <a href={portfolioPreviewUrl(url)} target="_blank" rel="noopener noreferrer">
        <Eye />
        Open
      </a>
    </Button>
  );
}

export function LinkList({ links }: { links: VerticalLinkRow[] }) {
  if (links.length === 0) {
    return <p className="text-sm text-muted-foreground">None yet — &quot;Create portfolio&quot; makes one.</p>;
  }
  const sorted = [...links].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return (
    <ul className="flex flex-col gap-3">
      {sorted.map((l) => (
        <LinkItem key={l.id} link={l} />
      ))}
    </ul>
  );
}

function LinkItem({ link: l }: { link: VerticalLinkRow }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [deleting, startDelete] = useTransition();
  const details = [l.contactName, l.phone, l.area].filter(Boolean).join(" · ");
  const opened = l.visits > 0 || l.viewCount > 0;
  return (
    <li className="rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <p className="font-medium">{l.company}</p>
          {details && <p className="text-xs text-muted-foreground">{details}</p>}
        </div>
        <span className="text-sm text-muted-foreground">
          {opened
            ? [
                `Opened · ${l.visits} visit${l.visits === 1 ? "" : "s"}`,
                formatDuration(l.activeSeconds),
                `${l.maxScrollPct}% scrolled`,
                l.lastSeenAt && `last ${relativeTime(l.lastSeenAt)}`,
              ]
                .filter(Boolean)
                .join(" · ")
            : "Not opened"}
        </span>
      </div>
      {(l.savedContact || l.textedMe) && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {l.savedContact && <Badge>Saved contact</Badge>}
          {l.textedMe && <Badge>Texted you</Badge>}
        </div>
      )}
      {l.notes && <p className="mt-2 text-sm whitespace-pre-wrap text-muted-foreground">{l.notes}</p>}
      <p className="mt-1 truncate font-mono text-xs text-muted-foreground">{l.url}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <CopyLinkButton url={l.url} />
        <PreviewButton url={l.url} />
        <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
          <Pencil />
          Edit
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={deleting}
          onClick={() => {
            if (!confirm(`Delete the page for ${l.company}? Its visit history goes with it.`)) return;
            startDelete(async () => {
              try {
                await deleteVerticalLinkAction(l.id);
                toast.success("Deleted");
                router.refresh();
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Couldn't delete");
              }
            });
          }}
        >
          <Trash2 />
          Delete
        </Button>
      </div>
      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent>
          {editing && (
            <LinkForm
              title="Edit portfolio"
              submitLabel="Save"
              initial={{
                company: l.company,
                contactName: l.contactName ?? "",
                phone: l.phone ?? "",
                area: l.area ?? "",
                notes: l.notes ?? "",
              }}
              onSubmit={async (input) => {
                await updateVerticalLinkAction(l.id, input);
                setEditing(false);
                toast.success("Saved");
                router.refresh();
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </li>
  );
}

/** "just now", "5m ago", "3h ago", "2d ago". */
function relativeTime(d: Date | string): string {
  const s = Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
