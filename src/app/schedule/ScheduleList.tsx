"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Bell, Camera, Phone, Plus } from "lucide-react";
import { setReminderDone } from "./actions";
import { ReminderDialog } from "./ReminderDialog";
import { formatScheduleDay, formatScheduleTime, type ScheduleItem } from "@/lib/schedule";
import { formatPhone } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";

const MUTED_HEADING = "text-xs font-medium text-muted-foreground mb-2";
const TODAY_HEADING = "text-xs font-medium text-foreground font-semibold mb-2";
const OVERDUE_HEADING = "flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400 mb-2";

// date === null is the "Overdue" bucket; every other group is one calendar day.
interface DayGroup {
  key: string;
  date: string | null;
  items: ScheduleItem[];
}

export function ScheduleList({ items, today }: { items: ScheduleItem[]; today: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // One dialog for the whole page: `editing` set means edit mode, unset means
  // create. `version` bumps on every open and keys the dialog, so its form
  // state starts fresh each time.
  const [dialog, setDialog] = useState<{ open: boolean; editing?: ScheduleItem; version: number }>({
    open: false,
    version: 0,
  });
  const openDialog = (editing?: ScheduleItem) =>
    setDialog((prev) => ({ open: true, editing, version: prev.version + 1 }));

  const todayCount = useMemo(() => items.filter((item) => item.date === today && !item.done).length, [items, today]);

  const groups = useMemo(() => {
    const overdue = items.filter((item) => item.date < today);
    const upcoming = new Map<string, ScheduleItem[]>();
    for (const item of items) {
      if (item.date < today) continue;
      upcoming.set(item.date, [...(upcoming.get(item.date) ?? []), item]);
    }
    return [
      ...(overdue.length > 0 ? [{ key: "overdue", date: null, items: overdue }] : []),
      // items arrive date-sorted, so Map insertion order is already day order.
      ...Array.from(upcoming, ([date, dateItems]) => ({ key: date, date, items: dateItems })),
    ] satisfies DayGroup[];
  }, [items, today]);

  const handleOpen = (item: ScheduleItem) => {
    if (item.kind === "reminder") {
      openDialog(item);
      return;
    }
    if (item.href) router.push(item.href);
  };

  const handleToggleDone = (item: ScheduleItem, done: boolean) => {
    startTransition(async () => {
      await setReminderDone(item.reminderId!, done);
      router.refresh();
    });
  };

  const card = (item: ScheduleItem) => {
    const overdue = item.date < today;
    return (
      <Card
        key={item.key}
        className="flex-row items-start gap-3 p-3 cursor-pointer hover:border-foreground/20 transition-colors"
        onClick={() => handleOpen(item)}
      >
        {item.kind === "reminder" ? (
          <Checkbox
            checked={item.done}
            disabled={isPending}
            onClick={(e) => e.stopPropagation()}
            onCheckedChange={(v) => handleToggleDone(item, v === true)}
          />
        ) : item.kind === "booking" ? (
          <Camera className="size-4 text-muted-foreground mt-0.5 shrink-0" />
        ) : (
          <Bell className="size-4 text-muted-foreground mt-0.5 shrink-0" />
        )}

        <div className="flex-1 min-w-0">
          <div className="text-xs text-muted-foreground">
            {overdue ? `${formatScheduleDay(item.date, today)} · ` : ""}
            {formatScheduleTime(item.time, item.durationMinutes)}
          </div>
          <div
            className={
              item.done
                ? "text-sm font-medium line-through text-muted-foreground"
                : "text-sm font-medium text-foreground"
            }
          >
            {item.title}
          </div>
          {item.subtitle && <div className="text-xs text-muted-foreground">{item.subtitle}</div>}
          {item.notes && <div className="text-xs text-muted-foreground whitespace-pre-line line-clamp-2">{item.notes}</div>}
          {item.agent && (
            <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
              <span>{item.agent.name}</span>
              {item.agent.phone && (
                <a
                  href={`tel:${item.agent.phone}`}
                  onClick={(e) => e.stopPropagation()}
                  className="text-xs text-primary flex items-center gap-1"
                >
                  <Phone className="size-3" />
                  {formatPhone(item.agent.phone)}
                </a>
              )}
            </div>
          )}
        </div>

        {item.kind !== "reminder" && (
          <span className="text-[11px] text-muted-foreground uppercase tracking-wide shrink-0">
            {item.kind === "booking" ? "Booking" : "Follow-up"}
          </span>
        )}
      </Card>
    );
  };

  return (
    <>
      <header className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Schedule</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {todayCount === 0 ? "Nothing today" : `${todayCount} thing${todayCount === 1 ? "" : "s"} today`}
          </p>
        </div>
        <Button onClick={() => openDialog()}>
          <Plus />
          Add reminder
        </Button>
      </header>

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing scheduled. Add a reminder when someone asks you to call them back.
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map((group) => (
            <div key={group.key}>
              <h2
                className={
                  group.date === null ? OVERDUE_HEADING : group.date === today ? TODAY_HEADING : MUTED_HEADING
                }
              >
                {group.date === null && <AlertCircle className="size-3.5" />}
                {group.date === null ? "Overdue" : formatScheduleDay(group.date, today)}
              </h2>
              <div className="flex flex-col gap-2">{group.items.map((item) => card(item))}</div>
            </div>
          ))}
        </div>
      )}

      <ReminderDialog
        key={dialog.version}
        open={dialog.open}
        onOpenChange={(open) => setDialog((prev) => ({ ...prev, open }))}
        reminder={dialog.editing}
      />
    </>
  );
}
