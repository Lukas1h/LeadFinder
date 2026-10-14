import { Camera, CheckCircle2, Clock, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";

type BookingStatus = "in_progress" | "editing" | "completed" | "invoice_sent";
type StatusFields = { completedAt: Date | null; invoiceSentAt: Date | null; shotAt: Date | null };

/** Upcoming → Editing (shot) → Invoice sent (waiting for payment) → Completed (paid). The latest step wins. */
export function getBookingStatus(booking: StatusFields): BookingStatus {
  if (booking.completedAt) return "completed";
  if (booking.invoiceSentAt) return "invoice_sent";
  if (booking.shotAt) return "editing";
  return "in_progress";
}

const STATUS_BADGES: Record<BookingStatus, { label: string; icon: typeof Clock; style: string }> = {
  in_progress: {
    label: "Upcoming",
    icon: Clock,
    style: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-400 dark:border-blue-900",
  },
  editing: {
    label: "Editing",
    icon: Camera,
    style: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-900",
  },
  completed: {
    label: "Completed",
    icon: CheckCircle2,
    style: "bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-400 dark:border-green-900",
  },
  invoice_sent: {
    label: "Invoice sent",
    icon: Send,
    style: "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950 dark:text-violet-400 dark:border-violet-900",
  },
};

export function BookingStatusBadge({ booking }: { booking: StatusFields }) {
  const { label, icon: Icon, style } = STATUS_BADGES[getBookingStatus(booking)];
  return (
    <Badge className={style}>
      <Icon />
      {label}
    </Badge>
  );
}
