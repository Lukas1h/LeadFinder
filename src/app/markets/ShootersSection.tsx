"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { saveShooter, type ShooterInput } from "./actions";
import type { ShooterRow } from "./data";
import { Field } from "./MarketDialog";
import { rateLine } from "./MarketCards";
import { num } from "./parts";

type MarketOption = { key: string; label: string };

const NONE = "__none";

export function ShootersSection({ shooters, markets }: { shooters: ShooterRow[]; markets: MarketOption[] }) {
  const label = (key: string | null) => (key ? (markets.find((m) => m.key === key)?.label ?? key) : "Unplaced");
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-foreground">Shooters</h2>
        <ShooterDialog markets={markets} />
      </div>
      {shooters.length === 0 ? (
        <p className="text-sm text-muted-foreground">No shooters on file.</p>
      ) : (
        <Card className="p-0 gap-0">
          {shooters.map((s) => (
            <div
              key={s.id}
              className={cn(
                "flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 px-4 py-2.5 border-b last:border-0 text-sm",
                !s.active && "opacity-60"
              )}
            >
              <div className="flex items-center gap-2 flex-wrap sm:w-64 shrink-0">
                <span className="font-medium">{s.name}</span>
                <span className="text-xs text-muted-foreground">
                  {label(s.marketKey)} · {s.role}
                </span>
                {!s.active && <Badge variant="secondary">Inactive</Badge>}
                {s.w9OnFile ? (
                  <Badge variant="outline">W-9</Badge>
                ) : (
                  <Badge variant="outline" className="text-muted-foreground">
                    No W-9
                  </Badge>
                )}
              </div>
              <div className="flex-1 min-w-0 text-xs flex flex-col gap-0.5">
                <span>{rateLine(s.rates)}</span>
                <span className="text-muted-foreground">
                  {s.freeMinutes} free min
                  {s.drivePerHour != null ? ` · $${s.drivePerHour}/h drive` : " · no drive charge"}
                  {s.phone && ` · ${s.phone}`}
                  {s.email && ` · ${s.email}`}
                </span>
              </div>
              <ShooterDialog markets={markets} shooter={s} />
            </div>
          ))}
        </Card>
      )}
    </>
  );
}

const str = (v: number | null | undefined) => (v == null ? "" : String(v));

function ShooterDialog({ markets, shooter }: { markets: MarketOption[]; shooter?: ShooterRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const init = () => ({
    name: shooter?.name ?? "",
    label: shooter?.label ?? "",
    marketKey: shooter?.marketKey ?? NONE,
    role: shooter?.role ?? "main",
    phone: shooter?.phone ?? "",
    email: shooter?.email ?? "",
    homeAddress: "",
    lat: str(shooter?.lat),
    lng: str(shooter?.lng),
    freeMinutes: str(shooter?.freeMinutes ?? 60),
    drivePerHour: str(shooter?.drivePerHour),
    photo: str(shooter?.rates.photo),
    photoDrone: str(shooter?.rates.photoDrone),
    video: str(shooter?.rates.video),
    drone: str(shooter?.rates.drone),
    active: shooter?.active ?? true,
    w9OnFile: shooter?.w9OnFile ?? false,
    notes: shooter?.notes ?? "",
  });
  const [f, setF] = useState(init);
  type F = ReturnType<typeof init>;
  const set = <K extends keyof F>(k: K, v: F[K]) => setF((prev) => ({ ...prev, [k]: v }));

  const onOpenChange = (next: boolean) => {
    if (next) setF(init());
    setOpen(next);
  };

  const submit = () =>
    startTransition(async () => {
      const address = f.homeAddress.trim();
      const input: ShooterInput = {
        id: shooter?.id,
        name: f.name,
        label: f.label,
        marketKey: f.marketKey === NONE ? null : f.marketKey,
        role: f.role,
        phone: f.phone,
        email: f.email,
        notes: f.notes,
        freeMinutes: Math.round(num(f.freeMinutes) ?? 0),
        drivePerHour: f.drivePerHour.trim() === "" ? null : Math.round(num(f.drivePerHour) ?? 0),
        rates: { photo: num(f.photo), photoDrone: num(f.photoDrone), video: num(f.video), drone: num(f.drone) },
        active: f.active,
        w9OnFile: f.w9OnFile,
      };
      if (address) {
        // A typed address wins: clear the coordinates so the action geocodes it.
        input.homeAddress = address;
        input.lat = null;
        input.lng = null;
      } else {
        input.lat = num(f.lat) ?? null;
        input.lng = num(f.lng) ?? null;
      }
      const result = await saveShooter(input);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(shooter ? `Saved ${f.name}` : `Added ${f.name}`);
      setOpen(false);
      router.refresh();
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {shooter ? (
        <Button size="icon-sm" variant="ghost" onClick={() => onOpenChange(true)} aria-label={`Edit ${shooter.name}`}>
          <Pencil />
        </Button>
      ) : (
        <Button size="sm" variant="outline" onClick={() => onOpenChange(true)}>
          <Plus /> Add shooter
        </Button>
      )}
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{shooter ? `Edit ${shooter.name}` : "Add shooter"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 grid-cols-2">
          <Field label="Name">
            <Input value={f.name} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field label="Short name">
            <Input value={f.label} onChange={(e) => set("label", e.target.value)} placeholder="Chris" />
          </Field>
          <Field label="Market">
            <Select value={f.marketKey} onValueChange={(v) => set("marketKey", v)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Not placed</SelectItem>
                {markets.map((m) => (
                  <SelectItem key={m.key} value={m.key}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Role">
            <Select value={f.role} onValueChange={(v) => set("role", v as "main" | "backup")}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="main">Main</SelectItem>
                <SelectItem value="backup">Backup</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Phone">
            <Input type="tel" value={f.phone} onChange={(e) => set("phone", e.target.value)} />
          </Field>
          <Field label="Email">
            <Input type="email" value={f.email} onChange={(e) => set("email", e.target.value)} />
          </Field>
          <div className="col-span-2">
            <Field label="Home address (geocoded; or enter lat/lng below)">
              <Input value={f.homeAddress} onChange={(e) => set("homeAddress", e.target.value)} />
            </Field>
          </div>
          <Field label="Lat">
            <Input inputMode="decimal" value={f.lat} onChange={(e) => set("lat", e.target.value)} />
          </Field>
          <Field label="Lng">
            <Input inputMode="decimal" value={f.lng} onChange={(e) => set("lng", e.target.value)} />
          </Field>
        </div>

        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3">
          <Field label="Photo $">
            <Input inputMode="numeric" value={f.photo} onChange={(e) => set("photo", e.target.value)} />
          </Field>
          <Field label="Photo + drone $">
            <Input inputMode="numeric" value={f.photoDrone} onChange={(e) => set("photoDrone", e.target.value)} />
          </Field>
          <Field label="Video $">
            <Input inputMode="numeric" value={f.video} onChange={(e) => set("video", e.target.value)} />
          </Field>
          <Field label="Drone $">
            <Input inputMode="numeric" value={f.drone} onChange={(e) => set("drone", e.target.value)} />
          </Field>
          <Field label="Free drive min">
            <Input inputMode="numeric" value={f.freeMinutes} onChange={(e) => set("freeMinutes", e.target.value)} />
          </Field>
          <Field label="Drive $/h (blank = none)">
            <Input inputMode="numeric" value={f.drivePerHour} onChange={(e) => set("drivePerHour", e.target.value)} />
          </Field>
        </div>

        <div className="flex flex-wrap gap-6 text-sm">
          <label className="flex items-center gap-2">
            <Switch checked={f.active} onCheckedChange={(v) => set("active", v)} /> Active
          </label>
          <label className="flex items-center gap-2">
            <Switch checked={f.w9OnFile} onCheckedChange={(v) => set("w9OnFile", v)} /> W-9 on file
          </label>
        </div>

        <Field label="Notes">
          <Textarea rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} />
        </Field>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={isPending}>
            {isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
