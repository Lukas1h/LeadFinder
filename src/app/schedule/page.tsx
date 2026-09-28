import { Suspense } from "react";
import { connection } from "next/server";
import { db } from "@/db";
import { agents, bookings, listings, reminders } from "@/db/schema";
import { and, gte, inArray, isNotNull, isNull, or } from "drizzle-orm";
import {
  compareScheduleItems,
  hoursAgo,
  toScheduleDateTime,
  todayScheduleDate,
  type ScheduleAgent,
  type ScheduleItem,
} from "@/lib/schedule";
import { ScheduleList } from "./ScheduleList";
import { ScheduleSkeleton } from "./loading";

export default function SchedulePage() {
  return (
    <main className="max-w-3xl mx-auto w-full px-6 py-10">
      <Suspense fallback={<ScheduleSkeleton />}>
        <ScheduleContent />
      </Suspense>
    </main>
  );
}

async function ScheduleContent() {
  // Deliberately NOT "use cache" — see the comment in src/app/pipeline/page.tsx.
  // "Today" is read from the clock, which Cache Components won't allow in a
  // prerender — connection() defers this component to request time.
  await connection();
  const today = todayScheduleDate();
  // Bookings are real instants; anything from the start of today (UTC-safe
  // lower bound: a day back) is filtered precisely by Pacific date below.
  const bookingCutoff = hoursAgo(36);

  const [reminderRows, bookingRows, followUpRows] = await Promise.all([
    // Open reminders on any date (past ones show as overdue), plus done ones
    // from today on so checking one off doesn't make it vanish mid-day.
    db
      .select()
      .from(reminders)
      .where(or(isNull(reminders.completedAt), gte(reminders.date, today))),
    db
      .select()
      .from(bookings)
      .where(and(isNotNull(bookings.jobDate), gte(bookings.jobDate, bookingCutoff))),
    // Full rows: tapping a follow-up opens the listing's ListingModal.
    db.select().from(listings).where(isNotNull(listings.followUpAt)),
  ]);

  const bookingListingIds = bookingRows.map((b) => b.listingId).filter((id): id is string => id != null);
  const agentIds = [
    ...reminderRows.map((r) => r.agentId),
    ...bookingRows.map((b) => b.contactAgentId),
    ...followUpRows.map((l) => l.agentId),
  ].filter((id): id is string => id != null);

  const [agentRows, bookingListings] = await Promise.all([
    agentIds.length > 0
      ? db
          .select({ id: agents.id, name: agents.name, phone: agents.phone })
          .from(agents)
          .where(inArray(agents.id, [...new Set(agentIds)]))
      : Promise.resolve([]),
    bookingListingIds.length > 0
      ? db
          .select({ id: listings.id, address: listings.address, city: listings.city })
          .from(listings)
          .where(inArray(listings.id, bookingListingIds))
      : Promise.resolve([]),
  ]);
  const agentById = new Map<string, ScheduleAgent>(agentRows.map((a) => [a.id, a]));
  const listingById = new Map(bookingListings.map((l) => [l.id, l]));

  const items: ScheduleItem[] = [];

  for (const r of reminderRows) {
    items.push({
      key: `reminder:${r.id}`,
      kind: "reminder",
      date: r.date,
      time: r.time,
      durationMinutes: r.durationMinutes,
      title: r.title,
      subtitle: null,
      notes: r.notes,
      agent: r.agentId ? (agentById.get(r.agentId) ?? null) : null,
      href: null,
      done: r.completedAt != null,
      reminderId: r.id,
      listingId: null,
      listing: null,
    });
  }

  for (const b of bookingRows) {
    const { date, time } = toScheduleDateTime(b.jobDate!);
    if (date < today) continue;
    const linked = b.listingId ? listingById.get(b.listingId) : undefined;
    const address = linked?.address ?? b.address;
    items.push({
      key: `booking:${b.id}`,
      kind: "booking",
      date,
      time,
      durationMinutes: b.shootingHours ? Math.round(b.shootingHours * 60) : null,
      title: address ? `Shoot · ${address}` : "Shoot",
      subtitle: linked?.city ?? b.city,
      notes: b.notes,
      agent: b.contactAgentId ? (agentById.get(b.contactAgentId) ?? null) : null,
      href: "/booked",
      done: b.completedAt != null,
      reminderId: null,
      listingId: null,
      listing: null,
    });
  }

  for (const l of followUpRows) {
    const linkedAgent = l.agentId ? agentById.get(l.agentId) : undefined;
    items.push({
      key: `followUp:${l.id}`,
      kind: "followUp",
      // followUpAt comes from a plain date input, stored as UTC midnight —
      // its UTC date is the day that was picked (see formatDateOnly).
      date: l.followUpAt!.toISOString().slice(0, 10),
      time: null,
      durationMinutes: null,
      title: l.address ? `Follow up · ${l.address}` : "Follow up",
      subtitle: l.city,
      notes: l.followUpNote,
      agent:
        linkedAgent ??
        (l.agentName || l.agentPhone ? { id: null, name: l.agentName, phone: l.agentPhone } : null),
      href: "/pipeline",
      done: false,
      reminderId: null,
      listingId: l.id,
      listing: l,
    });
  }

  items.sort(compareScheduleItems);

  return <ScheduleList items={items} today={today} />;
}
