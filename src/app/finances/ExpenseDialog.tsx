"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileText, ScanText, Trash2 } from "lucide-react";
import { deleteExpense, getLinkOptions, readReceipt, saveExpense, type LinkOptions } from "./actions";
import { EXPENSE_CATEGORIES, expenseCategory } from "@/lib/finance/categories";
import { pacificDate } from "@/lib/finance/math";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface ExpenseDraft {
  id?: string;
  date: string;
  amount: string;
  vendor: string;
  description: string;
  category: string;
  deductiblePercent: number;
  gallons: string;
  pricePerGallon: string;
  paidPersonally: boolean;
  yearly: boolean;
  bookingId: string | null;
  tripId: string | null;
  notes: string;
  hasReceipt: boolean;
  receiptNumber: number | null;
}

export function blankExpense(overrides: Partial<ExpenseDraft> = {}): ExpenseDraft {
  return {
    date: pacificDate(new Date()),
    amount: "",
    vendor: "",
    description: "",
    category: "other",
    deductiblePercent: 100,
    gallons: "",
    pricePerGallon: "",
    paidPersonally: false,
    yearly: false,
    bookingId: null,
    tripId: null,
    notes: "",
    hasReceipt: false,
    receiptNumber: null,
    ...overrides,
  };
}

const NONE = "none";

/**
 * Shrinks a photo before upload (receipts are read, not printed: 1800px is
 * plenty, and it keeps a phone photo well under the request limit). Anything
 * the browser can't draw, like a PDF, goes up as it is.
 */
async function shrinkImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}

/**
 * Adds or edits an expense. Attach a receipt and "Read receipt" fills the
 * form from it; nothing is saved until Save. The category sets the usual
 * deduction (see src/lib/finance/categories.ts), which can be changed.
 */
export function ExpenseDialog({
  draft,
  open,
  onOpenChange,
}: {
  draft: ExpenseDraft;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [expense, setExpense] = useState(draft);
  const [file, setFile] = useState<File | null>(null);
  const [options, setOptions] = useState<LinkOptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "read" | "delete" | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Reset to the draft each time it opens (not on every new draft object the parent renders).
  useEffect(() => {
    if (!open) return;
    setExpense(draft);
    setFile(null);
    setError(null);
    getLinkOptions().then(setOptions);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const set = (patch: Partial<ExpenseDraft>) => setExpense((x) => ({ ...x, ...patch }));
  const category = expenseCategory(expense.category);

  const handleFile = async (picked: File | undefined) => {
    if (!picked) return;
    const shrunk = await shrinkImage(picked);
    setFile(shrunk);
    if (!expense.id) await handleRead(shrunk);
  };

  const handleRead = async (receipt: File | null = file) => {
    if (!receipt) return;
    setBusy("read");
    setError(null);
    const form = new FormData();
    form.set("receipt", receipt);
    const result = await readReceipt(form);
    setBusy(null);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setExpense((x) => {
      const cat = result.category ?? x.category;
      return {
        ...x,
        date: result.date ?? x.date,
        amount: result.amount != null ? result.amount.toFixed(2) : x.amount,
        vendor: result.vendor ?? x.vendor,
        description: result.description ?? x.description,
        category: cat,
        deductiblePercent: result.category ? expenseCategory(cat).deductible : x.deductiblePercent,
        gallons: result.gallons != null ? String(result.gallons) : x.gallons,
        pricePerGallon: result.pricePerGallon != null ? String(result.pricePerGallon) : x.pricePerGallon,
      };
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy("save");
    const form = new FormData();
    if (expense.id) form.set("id", expense.id);
    if (file) form.set("receipt", file);
    const num = (v: string) => (v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);
    form.set(
      "input",
      JSON.stringify({
        date: expense.date,
        amount: Number(expense.amount),
        vendor: expense.vendor,
        description: expense.description,
        category: expense.category,
        deductiblePercent: expense.deductiblePercent,
        gallons: num(expense.gallons),
        pricePerGallon: num(expense.pricePerGallon),
        paidPersonally: expense.paidPersonally,
        spreadMonths: expense.yearly ? 12 : 1,
        bookingId: expense.bookingId,
        tripId: expense.tripId,
        notes: expense.notes,
      })
    );
    const result = await saveExpense(form);
    setBusy(null);
    if (result.error) {
      setError(result.error);
      return;
    }
    toast.success(expense.id ? "Expense updated" : "Expense added");
    onOpenChange(false);
    router.refresh();
  };

  const handleDelete = async () => {
    if (!expense.id) return;
    setBusy("delete");
    await deleteExpense(expense.id);
    setBusy(null);
    toast.success("Expense deleted");
    onOpenChange(false);
    router.refresh();
  };

  const nearbyTrips = (options?.trips ?? []).filter(
    (t) => t.id === expense.tripId || Math.abs(new Date(t.date).getTime() - new Date(expense.date).getTime()) <= 4 * 86400000
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
        <form onSubmit={handleSave}>
          <DialogHeader>
            <DialogTitle>{expense.id ? "Edit expense" : "Add an expense"}</DialogTitle>
            <DialogDescription>
              {expense.receiptNumber ? `Receipt #${expense.receiptNumber}. ` : ""}
              Attach the receipt and it fills itself in.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileInput}
                type="file"
                accept="image/*,application/pdf"
                className="hidden"
                onChange={(e) => handleFile(e.target.files?.[0])}
              />
              <Button type="button" variant="outline" size="sm" onClick={() => fileInput.current?.click()} disabled={busy != null}>
                <FileText />
                {file ? "Change receipt" : expense.hasReceipt ? "Replace receipt" : "Attach receipt"}
              </Button>
              {file && (
                <Button type="button" variant="outline" size="sm" onClick={() => handleRead()} disabled={busy != null}>
                  <ScanText />
                  {busy === "read" ? "Reading…" : "Read receipt"}
                </Button>
              )}
              {expense.id && expense.hasReceipt && !file && (
                <a
                  href={`/api/finances/receipts/${expense.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-muted-foreground underline underline-offset-2"
                >
                  View receipt
                </a>
              )}
              {file && <span className="text-xs text-muted-foreground truncate max-w-40">{file.name}</span>}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="expense-date">Date</Label>
                <Input id="expense-date" type="date" value={expense.date} onChange={(e) => set({ date: e.target.value })} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="expense-amount">Amount</Label>
                <Input
                  id="expense-amount"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={expense.amount}
                  onChange={(e) => set({ amount: e.target.value })}
                  placeholder="$"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="expense-description">What it was</Label>
              <Input
                id="expense-description"
                value={expense.description}
                onChange={(e) => set({ description: e.target.value })}
                placeholder="Drone motor arm"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="expense-vendor">Where</Label>
              <Input
                id="expense-vendor"
                value={expense.vendor}
                onChange={(e) => set({ vendor: e.target.value })}
                placeholder="Amazon"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="expense-category">Category</Label>
                <Select
                  value={expense.category}
                  onValueChange={(v) => set({ category: v, deductiblePercent: expenseCategory(v).deductible })}
                >
                  <SelectTrigger id="expense-category" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EXPENSE_CATEGORIES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="expense-deductible">Tax deductible</Label>
                <Select value={String(expense.deductiblePercent)} onValueChange={(v) => set({ deductiblePercent: Number(v) })}>
                  <SelectTrigger id="expense-deductible" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="100">100%</SelectItem>
                    <SelectItem value="50">50%</SelectItem>
                    <SelectItem value="0">Not deductible</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {category.hint && <p className="text-xs text-muted-foreground -mt-2">{category.hint}</p>}

            {expense.category === "gas" && (
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="expense-gallons">Gallons</Label>
                  <Input
                    id="expense-gallons"
                    type="number"
                    min="0"
                    step="any"
                    inputMode="decimal"
                    value={expense.gallons}
                    onChange={(e) => set({ gallons: e.target.value })}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="expense-ppg">Price per gallon</Label>
                  <Input
                    id="expense-ppg"
                    type="number"
                    min="0"
                    step="any"
                    inputMode="decimal"
                    value={expense.pricePerGallon}
                    onChange={(e) => set({ pricePerGallon: e.target.value })}
                    placeholder="$"
                  />
                </div>
              </div>
            )}

            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={expense.yearly} onCheckedChange={(c) => set({ yearly: c === true })} />
                Yearly charge (spread over 12 months)
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={expense.paidPersonally} onCheckedChange={(c) => set({ paidPersonally: c === true })} />
                Paid on a personal card
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="expense-booking">For a job</Label>
                <Select value={expense.bookingId ?? NONE} onValueChange={(v) => set({ bookingId: v === NONE ? null : v })}>
                  <SelectTrigger id="expense-booking" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>None</SelectItem>
                    {(options?.bookings ?? []).map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.date ? `${b.date.slice(5)} · ` : ""}
                        {b.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="expense-trip">On a trip</Label>
                <Select value={expense.tripId ?? NONE} onValueChange={(v) => set({ tripId: v === NONE ? null : v })}>
                  <SelectTrigger id="expense-trip" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>None</SelectItem>
                    {nearbyTrips.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.date.slice(5)} · {t.purpose}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="expense-notes">Notes</Label>
              <Textarea id="expense-notes" rows={2} value={expense.notes} onChange={(e) => set({ notes: e.target.value })} />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          <DialogFooter className="gap-2">
            {expense.id && (
              <Button type="button" variant="outline" onClick={handleDelete} disabled={busy != null} className="mr-auto">
                <Trash2 />
                Delete
              </Button>
            )}
            <Button type="submit" disabled={busy != null}>
              {busy === "save" ? "Saving…" : "Save expense"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
