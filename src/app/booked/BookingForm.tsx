"use client";

import { useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2, CheckCircle2 } from "lucide-react";
import { createBooking, updateBooking, deleteBooking } from "./actions";
import { searchAgentsByName, type AgentMatchSummary } from "@/app/agents/matchActions";
import type { BookingWithDetails } from "./BookedList";
import { formatPhone } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface LineItemRow {
  description: string;
  amount: string;
}

const EMPTY_LINE_ITEM: LineItemRow = { description: "", amount: "" };

// datetime-local's value is local wall-clock time with no timezone, so
// this must read local (not UTC) components — new Date(thatString) then
// parses back as local time too, matching what was picked with no shift.
function toDateTimeInputValue(date: Date | null): string {
  if (!date) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toLineItemRows(lineItems: { description: string; amount: number }[]): LineItemRow[] {
  if (lineItems.length === 0) return [EMPTY_LINE_ITEM];
  return lineItems.map((li) => ({ description: li.description, amount: String(li.amount) }));
}

/**
 * Create-or-edit booking dialog. Two ways in:
 *  - Create: pass `listingId` (+ optional trigger) from the Pipeline "Mark
 *    booked" action or a listing's "New booking" (reshoot) button; pass
 *    neither listingId nor booking for the standalone /booked page's "New
 *    booking" (isManual — plain address/city/state inputs instead of a
 *    listing reference).
 *  - Edit: pass `booking` (an existing BookingWithDetails) — prefills every
 *    field and shows read-only links to the listing/agent it references,
 *    same idea as ListingModal's agent block. Used by BookingCard when the
 *    card itself is clicked.
 * When there's no `trigger`, the dialog is fully controlled via
 * `open`/`onOpenChange` instead — used by ListingModal (booking) and
 * BookingCard (editing) to open this without a dedicated trigger element.
 */
export function BookingForm({
  listingId,
  agentName,
  agentPhone,
  booking,
  trigger,
  open,
  onOpenChange,
}: {
  listingId?: string;
  agentName?: string | null;
  agentPhone?: string | null;
  booking?: BookingWithDetails;
  trigger?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const router = useRouter();
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = open ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEditing = !!booking;
  const effectiveListingId = booking ? booking.listingId : listingId;
  const isManual = !effectiveListingId;

  const [address, setAddress] = useState(booking?.address ?? "");
  const [city, setCity] = useState(booking?.city ?? "");
  const [state, setState] = useState(booking?.state ?? "");
  const [contactName, setContactName] = useState(booking?.contactName ?? agentName ?? "");
  const [contactPhone, setContactPhone] = useState(booking?.contactPhone ?? agentPhone ?? "");
  const [jobDate, setJobDate] = useState(toDateTimeInputValue(booking?.jobDate ?? null));
  const [lockboxCode, setLockboxCode] = useState(booking?.lockboxCode ?? "");
  const [notes, setNotes] = useState(booking?.notes ?? "");
  const [lineItems, setLineItems] = useState<LineItemRow[]>(toLineItemRows(booking?.lineItems ?? []));

  const [nameSuggestions, setNameSuggestions] = useState<AgentMatchSummary[]>([]);
  const [showNameSuggestions, setShowNameSuggestions] = useState(false);
  const suggestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Same debounced-search pattern as Compose's Name field (see
  // ComposeEmailPanel.tsx) — type a name, get matching agents, pick one to
  // autofill phone. Typing a name with no match just becomes a new agent
  // on save (findOrCreateAgentByPhone in actions.ts), same as before.
  const handleContactNameChange = (value: string) => {
    setContactName(value);
    if (suggestTimer.current) clearTimeout(suggestTimer.current);
    if (value.trim().length < 2) {
      setNameSuggestions([]);
      setShowNameSuggestions(false);
      return;
    }
    suggestTimer.current = setTimeout(async () => {
      const results = await searchAgentsByName(value);
      setNameSuggestions(results);
      setShowNameSuggestions(results.length > 0);
    }, 200);
  };

  const handleSelectSuggestion = (agent: AgentMatchSummary) => {
    setShowNameSuggestions(false);
    setContactName(agent.name ?? "");
    setContactPhone(agent.phone ?? "");
  };

  // Delay so a suggestion's onMouseDown still fires before this hides it
  // (same trick as Compose's Name field).
  const handleContactNameBlur = () => setTimeout(() => setShowNameSuggestions(false), 150);

  const updateLineItem = (index: number, patch: Partial<LineItemRow>) => {
    setLineItems((prev) => prev.map((li, i) => (i === index ? { ...li, ...patch } : li)));
  };
  const addLineItem = () => setLineItems((prev) => [...prev, { ...EMPTY_LINE_ITEM }]);
  const removeLineItem = (index: number) => setLineItems((prev) => prev.filter((_, i) => i !== index));

  const reset = () => {
    setAddress(booking?.address ?? "");
    setCity(booking?.city ?? "");
    setState(booking?.state ?? "");
    setContactName(booking?.contactName ?? agentName ?? "");
    setContactPhone(booking?.contactPhone ?? agentPhone ?? "");
    setJobDate(toDateTimeInputValue(booking?.jobDate ?? null));
    setLockboxCode(booking?.lockboxCode ?? "");
    setNotes(booking?.notes ?? "");
    setLineItems(toLineItemRows(booking?.lineItems ?? []));
    setError(null);
    setNameSuggestions([]);
    setShowNameSuggestions(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const sharedInput = {
      address,
      city,
      state,
      contactName,
      contactPhone,
      jobDate: jobDate ? new Date(jobDate) : null,
      lockboxCode,
      notes,
      lineItems: lineItems.map((li) => ({
        description: li.description,
        amount: li.amount.trim() ? Number(li.amount) : 0,
      })),
    };

    const result = booking
      ? await updateBooking(booking.id, sharedInput)
      : await createBooking({ listingId: listingId ?? null, ...sharedInput });

    setIsSubmitting(false);

    if (result.error) {
      setError(result.error);
      return;
    }

    toast.success(isEditing ? "Booking updated" : "Booking saved");
    if (!isEditing) reset();
    setOpen(false);
    router.refresh();
  };

  const handleDelete = async () => {
    if (!booking) return;
    setIsDeleting(true);
    await deleteBooking(booking.id);
    setIsDeleting(false);
    toast.success("Booking deleted");
    setOpen(false);
    router.refresh();
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{isEditing ? "Edit booking" : isManual ? "New booking" : "Mark booked"}</DialogTitle>
            <DialogDescription>
              {isEditing
                ? "Job details, contact, and price."
                : isManual
                  ? "For a job booked directly — even with just a city and a date."
                  : "Job details, contact, and price — shows up on the Booked page."}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-4">
            {isManual && (
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5 col-span-2">
                  <Label htmlFor="booking-address">Address (optional)</Label>
                  <Input id="booking-address" value={address} onChange={(e) => setAddress(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="booking-city">City</Label>
                  <Input id="booking-city" value={city} onChange={(e) => setCity(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="booking-state">State</Label>
                  <Input id="booking-state" value={state} onChange={(e) => setState(e.target.value)} />
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5 relative">
                <Label htmlFor="booking-contact-name">Contact</Label>
                <Input
                  id="booking-contact-name"
                  value={contactName}
                  onChange={(e) => handleContactNameChange(e.target.value)}
                  onFocus={() => nameSuggestions.length > 0 && setShowNameSuggestions(true)}
                  onBlur={handleContactNameBlur}
                  placeholder="Start typing a name…"
                  autoComplete="off"
                />
                {showNameSuggestions && (
                  <div className="absolute top-full left-0 right-0 mt-1 z-10 rounded-lg border border-border bg-popover shadow-md max-h-56 overflow-y-auto">
                    {nameSuggestions.map((agent) => (
                      <button
                        key={agent.id}
                        type="button"
                        onMouseDown={() => handleSelectSuggestion(agent)}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-muted flex flex-col gap-0.5"
                      >
                        <span className="text-foreground">{agent.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {formatPhone(agent.phone) ?? agent.email ?? "No contact info saved"}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="booking-contact-phone">Contact phone</Label>
                <Input
                  id="booking-contact-phone"
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="booking-job-date">Job date &amp; time</Label>
              <Input
                id="booking-job-date"
                type="datetime-local"
                value={jobDate}
                onChange={(e) => setJobDate(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="booking-lockbox">Lockbox code</Label>
              <Input
                id="booking-lockbox"
                value={lockboxCode}
                onChange={(e) => setLockboxCode(e.target.value)}
                placeholder="Optional"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label>Line items</Label>
              {lineItems.map((li, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    value={li.description}
                    onChange={(e) => updateLineItem(i, { description: e.target.value })}
                    placeholder="e.g. Interior + exterior photos"
                    className="flex-1"
                  />
                  <Input
                    type="number"
                    min="0"
                    value={li.amount}
                    onChange={(e) => updateLineItem(i, { amount: e.target.value })}
                    placeholder="$"
                    className="w-24"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeLineItem(i)}
                    disabled={lineItems.length === 1}
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={addLineItem} className="self-start">
                <Plus />
                Add line item
              </Button>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="booking-notes">Notes</Label>
              <Textarea id="booking-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          <DialogFooter>
            {isEditing && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button type="button" variant="ghost" className="text-destructive hover:text-destructive mr-auto">
                    <Trash2 />
                    Delete
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Cancel and delete this booking?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This removes it and its line items for good. If it&rsquo;s the linked listing&rsquo;s
                      current booking, that listing goes back to Booked → Saved.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={isDeleting}>Keep booking</AlertDialogCancel>
                    <AlertDialogAction onClick={handleDelete} disabled={isDeleting}>
                      {isDeleting ? "Deleting…" : "Delete"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
            <Button type="submit" disabled={isSubmitting}>
              <CheckCircle2 />
              {isSubmitting ? "Saving…" : isEditing ? "Save changes" : "Confirm booking"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
