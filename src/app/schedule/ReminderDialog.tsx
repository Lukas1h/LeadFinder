"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { createReminder, updateReminder, deleteReminder, type ReminderInput } from "./actions";
import { searchAgentsByName, type AgentMatchSummary } from "@/app/agents/matchActions";
import { todayScheduleDate, type ScheduleAgent, type ScheduleItem } from "@/lib/schedule";
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
} from "@/components/ui/dialog";

const LENGTH_OPTIONS = [
  { value: "", label: "No set length" },
  { value: "15", label: "15 min" },
  { value: "30", label: "30 min" },
  { value: "45", label: "45 min" },
  { value: "60", label: "1 hr" },
  { value: "90", label: "1 hr 30 min" },
  { value: "120", label: "2 hr" },
  { value: "180", label: "3 hr" },
];

/**
 * Create-or-edit dialog for a single reminder. Fully controlled via
 * `open`/`onOpenChange`; ScheduleList keeps one instance and gives it a new
 * `key` every time it opens, so the fields below start fresh from
 * `reminder` (or blank) instead of carrying over the last draft.
 */
export function ReminderDialog({
  open,
  onOpenChange,
  reminder,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reminder?: ScheduleItem;
}) {
  const router = useRouter();
  const editingId = reminder?.kind === "reminder" ? reminder.reminderId : null;
  const isEditing = editingId != null;

  const [title, setTitle] = useState(reminder?.title ?? "");
  // Read when the dialog mounts (each open), not at module scope.
  const [date, setDate] = useState(() => reminder?.date ?? todayScheduleDate());
  const [time, setTime] = useState(reminder?.time ?? "");
  const [length, setLength] = useState(reminder?.durationMinutes != null ? String(reminder.durationMinutes) : "");
  const [notes, setNotes] = useState(reminder?.notes ?? "");
  const [agent, setAgent] = useState<ScheduleAgent | null>(
    reminder?.agent && reminder.agent.id != null ? reminder.agent : null
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [nameQuery, setNameQuery] = useState("");
  const [nameSuggestions, setNameSuggestions] = useState<AgentMatchSummary[]>([]);
  const [showNameSuggestions, setShowNameSuggestions] = useState(false);
  const suggestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Same debounced-search pattern as BookingForm's contact name: type a name,
  // get matching agents, pick one to link the reminder to.
  const handleNameChange = (value: string) => {
    setNameQuery(value);
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

  const handleSelectSuggestion = (match: AgentMatchSummary) => {
    setShowNameSuggestions(false);
    setAgent({ id: match.id, name: match.name, phone: match.phone });
  };

  // Delay so a suggestion's onMouseDown still fires before this hides it.
  const handleNameBlur = () => setTimeout(() => setShowNameSuggestions(false), 150);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const input: ReminderInput = {
      title,
      date,
      time: time || null,
      // A length only means something alongside a start time.
      durationMinutes: time && length ? Number(length) : null,
      notes: notes.trim() || null,
      agentId: agent?.id ?? null,
    };

    const result = isEditing ? await updateReminder(editingId, input) : await createReminder(input);

    setIsSubmitting(false);

    if (result.error) {
      setError(result.error);
      return;
    }

    toast.success(isEditing ? "Reminder updated" : "Reminder added");
    onOpenChange(false);
    router.refresh();
  };

  const handleDelete = async () => {
    if (!editingId) return;
    setIsDeleting(true);
    await deleteReminder(editingId);
    setIsDeleting(false);
    toast.success("Reminder deleted");
    onOpenChange(false);
    router.refresh();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setError(null);
      }}
    >
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{isEditing ? "Edit reminder" : "Add reminder"}</DialogTitle>
            <DialogDescription>Something to do on a given day — like a call someone asked for.</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="reminder-title">Title</Label>
              <Input
                id="reminder-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Call Sarah about 12 Oak St"
                required
                autoFocus
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="reminder-date">Date</Label>
              <Input
                id="reminder-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="reminder-time">Time</Label>
                  <Input id="reminder-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="reminder-length">Length</Label>
                  <select
                    id="reminder-length"
                    value={length}
                    onChange={(e) => setLength(e.target.value)}
                    disabled={!time}
                    className="h-9 rounded-md border border-input bg-transparent px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {LENGTH_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">Leave the time empty for an all-day reminder</p>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Contact (optional)</Label>
              {agent ? (
                <div className="flex items-center justify-between gap-2 rounded-md border border-input px-3 py-2">
                  <div className="flex items-baseline gap-2 min-w-0">
                    <span className="text-sm text-foreground">{agent.name}</span>
                    <span className="text-xs text-muted-foreground">{formatPhone(agent.phone)}</span>
                  </div>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setAgent(null)}>
                    Remove
                  </Button>
                </div>
              ) : (
                <div className="relative">
                  <Input
                    value={nameQuery}
                    onChange={(e) => handleNameChange(e.target.value)}
                    onFocus={() => nameSuggestions.length > 0 && setShowNameSuggestions(true)}
                    onBlur={handleNameBlur}
                    placeholder="Start typing a name…"
                    autoComplete="off"
                  />
                  {showNameSuggestions && (
                    <div className="absolute top-full left-0 right-0 mt-1 z-10 rounded-lg border border-border bg-popover shadow-md max-h-56 overflow-y-auto">
                      {nameSuggestions.map((match) => (
                        <button
                          key={match.id}
                          type="button"
                          onMouseDown={() => handleSelectSuggestion(match)}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-muted flex flex-col gap-0.5"
                        >
                          <span className="text-foreground">{match.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {formatPhone(match.phone) ?? match.email ?? "No contact info saved"}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="reminder-notes">Notes</Label>
              <Textarea id="reminder-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          <DialogFooter>
            {isEditing && (
              <Button
                type="button"
                variant="ghost"
                className="text-destructive hover:text-destructive mr-auto"
                onClick={handleDelete}
                disabled={isDeleting}
              >
                <Trash2 />
                {isDeleting ? "Deleting…" : "Delete"}
              </Button>
            )}
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : isEditing ? "Save" : "Add reminder"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
