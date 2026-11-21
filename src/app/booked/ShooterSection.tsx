"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Users, Check, RotateCcw, Pencil, Plus, X, Copy, MessageSquare, ExternalLink } from "lucide-react";
import { saveBookingShooter, markShooterPaid, getShooters, getBookingUploadLink, getBookingUploadStatus } from "./shooterActions";
import type { BookingUploadStatus } from "@/lib/mediaUploads";
import { stageIndex } from "@/lib/bookingStages";
import { formatPhone, formatPrice } from "@/lib/format";
import { smsUrl } from "@/lib/sms";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { BookingWithDetails } from "./BookedList";

/** "2026-11-20" → "Nov 20" without a timezone shift. */
function shortDay(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function fmtBytes(n: number) {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

/** Short time: "3:42 PM" today, else "Nov 20, 3:42 PM". */
function shortTime(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (d.toDateString() === new Date().toDateString()) return `today ${time}`;
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${time}`;
}

/** How far the shooter got with the upload page: opened, uploading, stalled, done. */
function UploadStatusLine({ bookingId }: { bookingId: string }) {
  const [data, setData] = useState<{ url: string | null; dropboxUrl: string | null; status: BookingUploadStatus } | null>(null);
  const uploading = data?.status.state === "uploading";

  useEffect(() => {
    let alive = true;
    const load = () =>
      getBookingUploadStatus(bookingId)
        .then((d) => alive && setData(d))
        .catch(() => {});
    load();
    const t = uploading ? setInterval(load, 15_000) : null;
    return () => {
      alive = false;
      if (t) clearInterval(t);
    };
  }, [bookingId, uploading]);

  if (!data) return null;
  const { status: s, url, dropboxUrl } = data;
  let line: React.ReactNode = null;
  if (s.state === "never_opened") {
    if (url) line = <span>Upload link not opened yet</span>;
  } else if (s.state === "opened") {
    line = <span>Opened upload link {shortTime(s.lastViewAt)}</span>;
  } else if (s.state === "uploading") {
    line = (
      <span className="flex items-center gap-1.5 text-sky-700 dark:text-sky-400">
        <span className="size-1.5 rounded-full bg-sky-500 animate-pulse" />
        Uploading — {s.filesDone}/{s.filesTotal} files
      </span>
    );
  } else if (s.state === "stalled") {
    line = (
      <span className="text-amber-700 dark:text-amber-400">
        Upload stopped at {s.filesDone}/{s.filesTotal} files
        {s.lastActivityAt ? ` (last activity ${shortTime(s.lastActivityAt)})` : ""}
      </span>
    );
  } else if (s.state === "finished") {
    line = (
      <span>
        <span className="text-emerald-700 dark:text-emerald-400">
          Uploaded {s.filesDone} files · {fmtBytes(s.bytesDone)}
        </span>
        {s.filesFailed > 0 && <span className="text-red-600 dark:text-red-400"> · {s.filesFailed} failed</span>}
        {s.finishedAt && <span> · {shortTime(s.finishedAt)}</span>}
      </span>
    );
  }
  if (!line && !dropboxUrl) return null;
  return (
    <div className="mt-1.5 flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
      {line}
      {dropboxUrl && (
        <a
          href={dropboxUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
        >
          <ExternalLink className="size-3" />
          Open in Dropbox
        </a>
      )}
    </div>
  );
}

/**
 * Who shoots this job when it isn't Lukas (a subcontracted photographer),
 * what they're paid, whether that pay has been logged as an expense, and — for
 * handing over the raw files — the job's Dropbox upload link: copy it, or text
 * it to them.
 */
export function ShooterSection({ booking }: { booking: BookingWithDetails }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const shooter = booking.shooter;
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(shooter?.name ?? "");
  const [phone, setPhone] = useState(shooter?.phone ?? "");
  const [pay, setPay] = useState(shooter?.pay != null ? String(shooter.pay) : "");
  const [suggestions, setSuggestions] = useState<{ id: string; name: string }[]>([]);
  const [uploadLink, setUploadLink] = useState(booking.dropboxUploadLink);
  const [copied, setCopied] = useState(false);

  const shot = stageIndex(booking.stage) >= stageIndex("editing");
  const paid = shooter?.expenseId != null;
  const listId = `shooters-${booking.id}`;

  const startEdit = () => {
    setName(shooter?.name ?? "");
    setPhone(shooter?.phone ?? "");
    setPay(shooter?.pay != null ? String(shooter.pay) : "");
    setEditing(true);
    getShooters().then(setSuggestions).catch(() => {});
  };

  const act = (fn: () => Promise<{ error?: string }>, done: string, after?: () => void) => {
    startTransition(async () => {
      const res = await fn();
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success(done);
      after?.();
      router.refresh();
    });
  };

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) return toast.error("Enter a name");
    const n = pay.trim() === "" ? null : Math.round(Number(pay));
    if (n != null && (!Number.isFinite(n) || n < 0)) return toast.error("Pay must be a dollar amount");
    act(
      () => saveBookingShooter(booking.id, { name: trimmed, pay: n, phone: phone.trim() || null }),
      "Shooter saved",
      () => setEditing(false)
    );
  };

  if (editing) {
    return (
      <div className="border-t pt-3">
        <p className="text-xs text-muted-foreground mb-1.5">Shooter</p>
        <form
          className="flex items-center gap-2 flex-wrap"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <Input
            list={listId}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name"
            className="h-8 w-36"
            autoFocus
          />
          <datalist id={listId}>
            {suggestions.map((s) => (
              <option key={s.id} value={s.name} />
            ))}
          </datalist>
          <Input
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Phone"
            className="h-8 w-32"
          />
          <div className="relative">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={pay}
              onChange={(e) => setPay(e.target.value)}
              placeholder="Pay"
              className="h-8 w-24 pl-5"
            />
          </div>
          <Button type="submit" size="sm" disabled={isPending}>
            <Check />
            Save
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={isPending} onClick={() => setEditing(false)}>
            Cancel
          </Button>
          {shooter && !paid && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              disabled={isPending}
              onClick={() => act(() => saveBookingShooter(booking.id, null), "Shooter removed", () => setEditing(false))}
            >
              <X />
              Remove
            </Button>
          )}
        </form>
      </div>
    );
  }

  if (!shooter) {
    return (
      <div className="border-t pt-2">
        <button
          type="button"
          onClick={startEdit}
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
        >
          <Plus className="size-3.5" />
          Add shooter
        </button>
      </div>
    );
  }

  const payLabel = shooter.pay != null ? formatPrice(shooter.pay) : null;

  const copyUploadLink = () => {
    startTransition(async () => {
      let url = uploadLink;
      if (!url) {
        const res = await getBookingUploadLink(booking.id);
        if (res.error || !res.url) {
          toast.error(res.error ?? "Couldn't make the upload link");
          return;
        }
        url = res.url;
        setUploadLink(url);
        router.refresh();
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  // The same "Copy upload link" work, but opens Messages with the link already
  // written to the shooter — the text itself is built server-side.
  const textUploadLink = () => {
    startTransition(async () => {
      const res = await getBookingUploadLink(booking.id);
      if (res.error || !res.url) {
        toast.error(res.error ?? "Couldn't make the upload link");
        return;
      }
      if (!res.text || !shooter.phone) {
        toast.error(`Add a phone number for ${shooter.name}`);
        return;
      }
      setUploadLink(res.url);
      window.location.href = smsUrl(shooter.phone, res.text);
    });
  };

  return (
    <div className="border-t pt-3">
      <p className="text-xs text-muted-foreground mb-1.5">Shooter</p>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-sm flex items-center gap-1.5 flex-wrap">
          <Users className="size-3.5 text-muted-foreground" />
          <span className="text-foreground">{shooter.name}</span>
          {shooter.phone && <span className="text-muted-foreground">· {formatPhone(shooter.phone)}</span>}
          {payLabel && <span className="text-muted-foreground">· {payLabel}</span>}
          {paid ? (
            <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-1.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
              Paid{shooter.paidAt ? ` ${shortDay(shooter.paidAt)}` : ""}
            </span>
          ) : shot ? (
            payLabel && (
              <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                Owed {payLabel}
              </span>
            )
          ) : (
            <span className="text-xs text-muted-foreground">not shot yet</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <Button variant="outline" size="sm" disabled={isPending} onClick={copyUploadLink}>
            {copied ? <Check className="text-green-600" /> : <Copy />}
            {copied ? "Copied!" : "Copy upload link"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={isPending || !shooter.phone}
            title={shooter.phone ? undefined : "Add a phone number for this shooter first"}
            onClick={textUploadLink}
          >
            <MessageSquare />
            Text upload link
          </Button>
          {shot && !paid && shooter.pay != null && (
            <Button
              size="sm"
              disabled={isPending}
              onClick={() => act(() => markShooterPaid(booking.id, true), `Logged ${payLabel} to ${shooter.name}`)}
            >
              <Check />
              Paid {shooter.name}
            </Button>
          )}
          {paid && (
            <Button
              variant="ghost"
              size="sm"
              disabled={isPending}
              onClick={() => act(() => markShooterPaid(booking.id, false), "Marked unpaid")}
            >
              <RotateCcw />
              Mark unpaid
            </Button>
          )}
          {!paid && (
            <Button variant="ghost" size="sm" disabled={isPending} onClick={startEdit}>
              <Pencil />
              Edit
            </Button>
          )}
        </div>
      </div>
      <UploadStatusLine bookingId={booking.id} />
    </div>
  );
}
