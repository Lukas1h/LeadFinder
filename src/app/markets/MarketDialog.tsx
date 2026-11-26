"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { MarketDef } from "@/lib/markets";
import { DEFAULT_PORTFOLIO_PRICES, PORTFOLIO_PRICE_ITEMS, type PortfolioPrices } from "@/lib/portfolioPrices";
import { saveMarket, type MarketInput } from "./actions";
import { num } from "./parts";

export const PRICE_FIELDS: { key: keyof PortfolioPrices; label: string }[] = [
  ...PORTFOLIO_PRICE_ITEMS.map(({ key, label }) => ({ key, label })),
  { key: "socialEdit", label: "Social edit (sheet)" },
  { key: "fullPackage", label: "Full package (sheet)" },
];

export const PRICE_HINT =
  "After changing a market's prices, ask Claude to regenerate the pricing sheets (scripts/market-pricing-sheets.mts).";

function slug(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const str = (v: number | null | undefined) => (v == null ? "" : String(v));

export function MarketDialog({ mode, market }: { mode: "create" | "edit"; market?: MarketDef }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const isShooter = mode === "create" || market?.kind === "shooter";

  const init = () => ({
    label: market?.label ?? "",
    key: market?.key ?? "",
    keyTouched: mode === "edit",
    state: market?.state ?? "OR",
    baseName: market?.base?.name ?? "",
    baseLat: str(market?.base?.lat),
    baseLng: str(market?.base?.lng),
    radius: str(market?.pointArea?.radiusMiles ?? 30),
    jobsPerWeek: str(market?.jobsPerWeek ?? 1),
    prices: Object.fromEntries(PRICE_FIELDS.map((p) => [p.key, str(market?.prices[p.key])])) as Record<
      keyof PortfolioPrices,
      string
    >,
    areaPhrase: market?.areaPhrase ?? "",
    portfolioArea: market?.portfolioArea ?? "",
    pageLocation: market?.pageLocation ?? "",
    vcardCity: market?.vcard?.city ?? "",
    vcardNote: market?.vcard?.note ?? "",
    areaCodes: market?.areaCodes.join(", ") ?? "",
    notes: market?.notes ?? "",
  });
  const [f, setF] = useState(init);
  const set = <K extends keyof ReturnType<typeof init>>(k: K, v: ReturnType<typeof init>[K]) =>
    setF((prev) => ({ ...prev, [k]: v }));

  const onOpenChange = (next: boolean) => {
    if (next) setF(init());
    setOpen(next);
  };

  const submit = () =>
    startTransition(async () => {
      const prices: Partial<PortfolioPrices> = {};
      for (const p of PRICE_FIELDS) {
        const v = num(f.prices[p.key]);
        if (v !== undefined) prices[p.key] = v;
      }
      const input: MarketInput = {
        key: f.key,
        label: f.label,
        jobsPerWeek: num(f.jobsPerWeek) ?? 0,
        prices,
        notes: f.notes,
      };
      if (mode === "create") input.kind = "shooter";
      if (isShooter) {
        const lat = num(f.baseLat);
        const lng = num(f.baseLng);
        // A renamed base with untouched coordinates is re-geocoded by the action.
        const renamed = market?.base && f.baseName.trim() !== market.base.name;
        const keepCoords = lat !== undefined && lng !== undefined && !(renamed && lat === market?.base?.lat);
        input.state = f.state;
        input.base = { name: f.baseName, ...(keepCoords ? { lat, lng } : {}) };
        input.pointArea = { ...(market?.pointArea ?? {}), radiusMiles: num(f.radius) ?? 0 };
      }
      if (mode === "edit") {
        input.areaPhrase = f.areaPhrase;
        input.portfolioArea = f.portfolioArea;
        input.pageLocation = f.pageLocation;
        input.vcardCity = f.vcardCity;
        input.vcardNote = f.vcardNote;
        input.areaCodes = f.areaCodes
          .split(/[\s,]+/)
          .map((s) => s.trim())
          .filter(Boolean);
      }
      const result = await saveMarket(input);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(mode === "create" ? `Added ${f.label}` : `Saved ${f.label}`);
      setOpen(false);
      router.refresh();
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {mode === "create" ? (
        <Button size="sm" onClick={() => onOpenChange(true)}>
          <Plus /> New market
        </Button>
      ) : (
        <Button size="sm" variant="outline" onClick={() => onOpenChange(true)}>
          <Pencil /> Edit
        </Button>
      )}
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "New market" : `Edit ${market?.label}`}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Label">
            <Input
              value={f.label}
              onChange={(e) =>
                setF((prev) => ({ ...prev, label: e.target.value, key: prev.keyTouched ? prev.key : slug(e.target.value) }))
              }
              placeholder="Bend"
            />
          </Field>
          <Field label="Key">
            <Input
              value={f.key}
              disabled={mode === "edit"}
              onChange={(e) => setF((prev) => ({ ...prev, key: e.target.value, keyTouched: true }))}
              placeholder="bend"
            />
          </Field>
          {isShooter && (
            <>
              <Field label="State">
                <Input
                  value={f.state}
                  maxLength={2}
                  onChange={(e) => set("state", e.target.value.toUpperCase())}
                  placeholder="OR"
                />
              </Field>
              <Field label="Base town">
                <Input value={f.baseName} onChange={(e) => set("baseName", e.target.value)} placeholder="Bend" />
              </Field>
              <Field label="Base lat (optional)">
                <Input inputMode="decimal" value={f.baseLat} onChange={(e) => set("baseLat", e.target.value)} />
              </Field>
              <Field label="Base lng (optional)">
                <Input inputMode="decimal" value={f.baseLng} onChange={(e) => set("baseLng", e.target.value)} />
              </Field>
              <Field label="Radius (miles)">
                <Input inputMode="decimal" value={f.radius} onChange={(e) => set("radius", e.target.value)} />
              </Field>
            </>
          )}
          <Field label="Jobs / week">
            <Input inputMode="decimal" value={f.jobsPerWeek} onChange={(e) => set("jobsPerWeek", e.target.value)} />
          </Field>
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">Prices</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {PRICE_FIELDS.map((p) => (
              <Field key={p.key} label={p.label}>
                <Input
                  inputMode="numeric"
                  value={f.prices[p.key]}
                  placeholder={String(DEFAULT_PORTFOLIO_PRICES[p.key])}
                  onChange={(e) => set("prices", { ...f.prices, [p.key]: e.target.value })}
                />
              </Field>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Blank = default. {PRICE_HINT}</p>
        </div>

        {mode === "edit" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="{{area}} phrase">
              <Input value={f.areaPhrase} onChange={(e) => set("areaPhrase", e.target.value)} placeholder="in the Bend area" />
            </Field>
            <Field label="Portfolio area">
              <Input value={f.portfolioArea} onChange={(e) => set("portfolioArea", e.target.value)} />
            </Field>
            <Field label="Page footer location">
              <Input value={f.pageLocation} onChange={(e) => set("pageLocation", e.target.value)} />
            </Field>
            <Field label="Area codes">
              <Input value={f.areaCodes} onChange={(e) => set("areaCodes", e.target.value)} placeholder="541, 458" />
            </Field>
            <Field label="vCard city">
              <Input value={f.vcardCity} onChange={(e) => set("vcardCity", e.target.value)} />
            </Field>
            <Field label="vCard note">
              <Input value={f.vcardNote} onChange={(e) => set("vcardNote", e.target.value)} />
            </Field>
          </div>
        )}

        <Field label="Notes">
          <Textarea rows={3} value={f.notes} onChange={(e) => set("notes", e.target.value)} />
        </Field>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={isPending}>
            {isPending ? "Saving…" : mode === "create" ? "Add market" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 min-w-0">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
