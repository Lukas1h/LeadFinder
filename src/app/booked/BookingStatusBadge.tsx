import { CheckCircle2, Clock, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";

type BookingStatus = "in_progress" | "completed" | "invoice_sent";

/** In progress → Invoice sent (waiting for payment) → Completed (paid). Completed wins over an earlier invoice-sent. */
export function getBookingStatus(booking: { completedAt: Date | null; invoiceSentAt: Date | null }): BookingStatus {
  if (booking.completedAt) return "completed";
  if (booking.invoiceSentAt) return "invoice_sent";
  return "in_progress";
}

const STATUS_BADGES: Record<BookingStatus, { label: string; icon: typeof Clock; style: string }> = {
  in_progress: {
    label: "In progress",
    icon: Clock,
    style: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-400 dark:border-blue-900",
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

export function BookingStatusBadge({ booking }: { booking: { completedAt: Date | null; invoiceSentAt: Date | null } }) {
  const { label, icon: Icon, style } = STATUS_BADGES[getBookingStatus(booking)];
  return (
    <Badge className={style}>
      <Icon />
      {label}
    </Badge>
  );
}
