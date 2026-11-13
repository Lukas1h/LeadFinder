import { CalendarClock, CalendarCheck, Camera, CheckCircle2, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { STAGE_LABELS, type BookingStage } from "@/lib/bookingStages";

/** One look per stage: tentative → scheduled → editing → invoice sent → completed (paid). */
export const STAGE_STYLES: Record<BookingStage, { icon: typeof CalendarClock; style: string }> = {
  tentative: {
    icon: CalendarClock,
    style:
      "bg-transparent text-blue-700 border-dashed border-blue-300 dark:text-blue-400 dark:border-blue-800",
  },
  scheduled: {
    icon: CalendarCheck,
    style: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-400 dark:border-blue-900",
  },
  editing: {
    icon: Camera,
    style: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-900",
  },
  invoice_sent: {
    icon: Send,
    style: "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950 dark:text-violet-400 dark:border-violet-900",
  },
  completed: {
    icon: CheckCircle2,
    style: "bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-400 dark:border-green-900",
  },
};

export function BookingStatusBadge({ stage }: { stage: BookingStage }) {
  const { icon: Icon, style } = STAGE_STYLES[stage];
  return (
    <Badge className={style}>
      <Icon />
      {STAGE_LABELS[stage]}
    </Badge>
  );
}
