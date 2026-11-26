"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronRight, Plus } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MARKET_STATUSES, MARKET_STATUS_LABELS, type MarketDef, type MarketStatus } from "@/lib/markets";
import { resolvePortfolioPrices } from "@/lib/portfolioPrices";
import { addMarketTown, setMarketStatus } from "./actions";
import type { ShooterRow } from "./data";
import { MarketDialog, PRICE_FIELDS, PRICE_HINT } from "./MarketDialog";
import { StatusBadge, dollars } from "./parts";
import { cn } from "@/lib/utils";

export function MarketCards({ markets, shooters }: { markets: MarketDef[]; shooters: ShooterRow[] }) {
  return (
    <>
      <div className="grid gap-4 md:grid-cols-2">
        {markets.map((m) => (
          <MarketCard key={m.key} market={m} shooters={shooters.filter((s) => s.marketKey === m.key)} />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{PRICE_HINT}</p>
    </>
  );
}

function MarketCard({ market: m, shooters }: { market: MarketDef; shooters: ShooterRow[] }) {
  const isShooter = m.kind === "shooter";
  const prices = resolvePortfolioPrices(m.prices);
  const towns = Object.keys(m.cities).sort();

  return (
    <Card className={cn("p-4 gap-3", m.status === "killed" && "opacity-70")}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium">{m.label}</span>
            <StatusBadge status={m.status} />
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            <code>{m.key}</code> · {m.kind}
            {isShooter && (
              <>
                {" "}
                · {m.state}
                {m.base && ` · ${m.base.name}`}
                {m.pointArea && ` · ${m.pointArea.radiusMiles} mi`}
              </>
            )}{" "}
            · {m.jobsPerWeek} jobs/wk
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isShooter && <StatusSelect market={m} />}
          <MarketDialog mode="edit" market={m} />
        </div>
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {PRICE_FIELDS.map((p) => (
          <span key={p.key} className={m.prices[p.key] != null ? "font-medium" : "text-muted-foreground"}>
            {p.label} {dollars(prices[p.key])}
          </span>
        ))}
      </div>

      {isShooter && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
          <Row k="{{area}}" v={m.areaPhrase} />
          <Row k="Portfolio" v={m.portfolioArea} />
          <Row k="Footer" v={m.pageLocation} />
          <Row k="vCard" v={m.vcard ? [m.vcard.city, m.vcard.note].filter(Boolean).join(" · ") : null} />
          <Row k="Area codes" v={m.areaCodes.join(", ")} />
        </dl>
      )}

      {m.notes && <p className="text-xs text-muted-foreground whitespace-pre-wrap">{m.notes}</p>}

      {isShooter && (
        <div className="flex flex-col gap-1 text-xs">
          {shooters.length === 0 ? (
            <span className="text-muted-foreground">No shooters placed yet.</span>
          ) : (
            shooters.map((s) => (
              <div key={s.id} className={cn("flex flex-wrap gap-x-2", !s.active && "text-muted-foreground line-through")}>
                <span className="font-medium">{s.label || s.name}</span>
                <span className="text-muted-foreground">{s.role}</span>
                <span>{rateLine(s.rates)}</span>
              </div>
            ))
          )}
        </div>
      )}

      {isShooter && <Towns marketKey={m.key} towns={towns} />}
    </Card>
  );
}

export function rateLine(r: ShooterRow["rates"]): string {
  const parts = [
    r.photo != null && `photo ${dollars(r.photo)}`,
    r.photoDrone != null && `+drone ${dollars(r.photoDrone)}`,
    r.video != null && `video ${dollars(r.video)}`,
    r.drone != null && `drone ${dollars(r.drone)}`,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "no rates";
}

function Row({ k, v }: { k: string; v: string | null | undefined }) {
  return (
    <>
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="truncate">{v || <span className="text-muted-foreground">–</span>}</dd>
    </>
  );
}

function StatusSelect({ market }: { market: MarketDef }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirmKill, setConfirmKill] = useState(false);

  const apply = (status: MarketStatus) =>
    startTransition(async () => {
      const result = await setMarketStatus(market.key, status);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`${market.label}: ${MARKET_STATUS_LABELS[status]}`);
      router.refresh();
    });

  return (
    <>
      <Select
        value={market.status}
        disabled={isPending}
        onValueChange={(v) => {
          const status = v as MarketStatus;
          if (status === market.status) return;
          if (status === "killed") setConfirmKill(true);
          else apply(status);
        }}
      >
        <SelectTrigger size="sm" className="w-[6.5rem]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {MARKET_STATUSES.map((s) => (
            <SelectItem key={s} value={s}>
              {MARKET_STATUS_LABELS[s]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <AlertDialog open={confirmKill} onOpenChange={setConfirmKill}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Kill {market.label}?</AlertDialogTitle>
            <AlertDialogDescription>
              It loses its tab and quota. Listings still land in it and its history stays here; you can revive it
              later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => apply("killed")}>
              Kill market
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function Towns({ marketKey, towns }: { marketKey: string; towns: string[] }) {
  const router = useRouter();
  const [town, setTown] = useState("");
  const [isPending, startTransition] = useTransition();

  const add = () =>
    startTransition(async () => {
      const name = town.trim();
      const result = await addMarketTown(marketKey, name);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`Added ${name}`);
      setTown("");
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-2">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (town.trim()) add();
        }}
      >
        <Input
          value={town}
          onChange={(e) => setTown(e.target.value)}
          placeholder="Add town"
          className="h-8 text-sm"
          disabled={isPending}
        />
        <Button type="submit" size="sm" variant="outline" disabled={isPending || !town.trim()}>
          <Plus /> Add
        </Button>
      </form>
      <details className="group text-xs">
        <summary className="cursor-pointer list-none flex items-center gap-1 text-muted-foreground hover:text-foreground">
          <ChevronRight className="size-3 transition-transform group-open:rotate-90" />
          {towns.length} {towns.length === 1 ? "town" : "towns"}
        </summary>
        <p className="mt-1.5 capitalize leading-relaxed">{towns.join(", ") || "None yet"}</p>
      </details>
    </div>
  );
}
