"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Bell, CalendarDays, CheckCircle2, Clock, Pencil, RotateCcw } from "lucide-react";
import { setReminderDone } from "./actions";
import { AgentRow } from "@/app/AgentRow";
import { BookingRow } from "@/app/booked/BookingRow";
import { formatDuration, formatScheduleDay, formatScheduleTime, todayScheduleDate, type ScheduleItem } from "@/lib/schedule";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

/**
 * Read-only view of one reminder, mirroring BookingDetailDialog: the header
 * says what and when, an action row carries the state changes, and the body is
 * just the detail. Editing is a separate dialog rather than an inline mode, so
 * this one can never be left half-edited — a real risk when the same component
 * both shows a reminder and writes to it.
 *
 * Anything the reminder is attached to renders as the same row the rest of the
 * app uses (AgentRow / BookingRow), so a tap from here lands in the agent's or
 * the job's own detail dialog instead of dead-ending on this page.
 */
export function ReminderDetailDialog({
  item,
  open,
  onOpenChange,
  onEdit,
}: {
  item: ScheduleItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const today = todayScheduleDate();

  const handleToggleDone = (done: boolean) => {
    if (!item.reminderId) return;
    startTransition(async () => {
      await setReminderDone(item.reminderId!, done);
      toast.success(done ? "Marked done" : "Reopened");
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bell className="size-4 text-muted-foreground shrink-0" />
            {item.title}
          </DialogTitle>
          <DialogDescription className="flex flex-col gap-0.5">
            <span className="flex items-center gap-1.5">
              <CalendarDays className="size-3.5" />
              {formatScheduleDay(item.date, today)}
            </span>
            <span className="flex items-center gap-1.5">
              <Clock className="size-3.5" />
              {formatScheduleTime(item.time, item.durationMinutes)}
              {item.durationMinutes ? ` · ${formatDuration(item.durationMinutes)}` : ""}
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-2">
          {item.done ? (
            <Button variant="outline" size="sm" onClick={() => handleToggleDone(false)} disabled={isPending}>
              <RotateCcw />
              Reopen
            </Button>
          ) : (
            <Button size="sm" onClick={() => handleToggleDone(true)} disabled={isPending}>
              <CheckCircle2 />
              Mark done
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={onEdit} disabled={isPending}>
            <Pencil />
            Edit
          </Button>
        </div>

        {item.done && (
          <p className="text-xs text-muted-foreground">This reminder is checked off.</p>
        )}

        {item.notes && (
          <div className="border-t pt-3">
            <p className="text-xs text-muted-foreground mb-1.5">Notes</p>
            <p className="text-sm text-foreground/90 whitespace-pre-line">{item.notes}</p>
          </div>
        )}

        {item.agent && (
          <div className="border-t pt-3">
            <p className="text-xs text-muted-foreground mb-1">Contact</p>
            <AgentRow
              name={item.agent.name}
              phone={item.agent.phone}
              agentId={item.agent.id}
              subtitle="Open contact"
            />
          </div>
        )}

        {item.bookingId && (
          <div className="border-t pt-3">
            <p className="text-xs text-muted-foreground mb-1">Booking</p>
            <BookingRow bookingId={item.bookingId} />
          </div>
        )}

        {!item.notes && !item.agent && !item.bookingId && (
          <p className="border-t pt-3 text-sm text-muted-foreground">
            Nothing else on this reminder yet.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
