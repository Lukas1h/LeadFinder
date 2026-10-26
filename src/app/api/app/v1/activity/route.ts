import { NextResponse } from "next/server";
import { desc, eq, gte, inArray, isNull, max, or } from "drizzle-orm";
import { db } from "@/db";
import {
  agentInteractions,
  agents,
  bookings,
  galleryViews,
  listings,
  messagePresets,
  messageSends,
  portfolioEvents,
  portfolioLinks,
  portfolioSessions,
  reminders,
} from "@/db/schema";
import { requireAppAuth } from "@/lib/appApiAuth";
import { groupBookings, loadBookingsWithDetails } from "@/app/booked/data";
import { parseUserAgent } from "@/lib/galleryViews";

/**
 * One glance at everything that has actually happened lately, for the
 * assistant's periodic check-ins — no pipeline, follow-up feeds or reply
 * triage here, by design. The activity other pages already track, in one
 * place:
 *
 * - contact history: agent_interactions (calls, texts, emails, in person)
 * - message history: message_sends (sent, and separately, responded)
 * - client-gallery history: gallery_views (opens, downloads, invoice views,
 *   staging requests; link-preview fetchers filtered out, as on the
 *   gallery-visits route)
 * - portfolio-page history: portfolio_sessions (a visit, with time on page
 *   and scroll) and portfolio_events (save_contact, book_shoot, …)
 * - booking milestones: shot, invoice sent, paid, completed
 *
 * Plus an `attention` section for the two things that stall without a
 * nudge and that the activity alone doesn't surface: invoices out but not
 * paid (with each job's last gallery view, so "has she even looked?" is
 * answered in the same call) and jobs shot but not invoiced yet. Open
 * reminders are included for the same reason.
 *
 * Read-only. Nothing here sends, schedules or otherwise contacts anyone.
 *
 * Each section is capped at 50 items (the timeline is those sections
 * combined, newest 200), matching the other app-API routes' caps — this
 * is a glance feed, not a full export.
 *
 * Query params:
 * - `days` (default 14, clamped 1–90): how far back the activity window goes.
 *   Attention items are not windowed: an unpaid invoice from a month ago
 *   is still unpaid.
 * - `agent` (optional): a name fragment, matched case-insensitively, to
 *   narrow every section to one agent — e.g. `?agent=Melissa` when checking
 *   on one client's payment and gallery views.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DAYS = 14;
const MAX_DAYS = 90;
const SECTION_LIMIT = 50;
const TIMELINE_LIMIT = 200;

type ActivityItem = {
  kind: string;
  at: Date | null;
  agentId: string | null;
  agentName: string | null;
  bookingId: string | null;
  listingId: string | null;
  title: string;
  detail: string | null;
};

function item(
  kind: string,
  at: Date | null,
  agentId: string | null,
  agentName: string | null,
  bookingId: string | null,
  listingId: string | null,
  title: string,
  detail: string | null = null,
): ActivityItem {
  return { kind, at, agentId, agentName, bookingId, listingId, title, detail };
}

function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / DAY_MS));
}

function location(city: string | null, region: string | null, country: string | null): string | null {
  return [city, region, country && country !== "US" ? country : null].filter(Boolean).join(", ") || null;
}

export async function GET(req: Request) {
  const denied = requireAppAuth(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const parsedDays = Number(url.searchParams.get("days"));
  const days = Number.isFinite(parsedDays) ? Math.min(MAX_DAYS, Math.max(1, Math.floor(parsedDays))) : DEFAULT_DAYS;
  const agentFilter = url.searchParams.get("agent")?.trim() || null;
  const since = new Date(Date.now() - days * DAY_MS);
  const now = new Date();

  // An agent filter narrows by the agent row's name wherever a section has
  // one. Gallery views and bookings only know a contact agent, so they
  // filter through the booking's contact; portfolio activity through the
  // link's agent.
  const agentNameMatches = (name: string | null) =>
    !agentFilter || (name ?? "").toLowerCase().includes(agentFilter.toLowerCase());

  const [
    interactionRows,
    sendRows,
    galleryRows,
    sessionRows,
    eventRows,
    bookingDetails,
    reminderRows,
    lastGalleryRows,
  ] = await Promise.all([
    db
      .select({
        id: agentInteractions.id,
        agentId: agentInteractions.agentId,
        agentName: agents.name,
        listingId: agentInteractions.listingId,
        address: listings.address,
        channel: agentInteractions.channel,
        direction: agentInteractions.direction,
        outcome: agentInteractions.outcome,
        note: agentInteractions.note,
        occurredAt: agentInteractions.occurredAt,
      })
      .from(agentInteractions)
      .leftJoin(agents, eq(agents.id, agentInteractions.agentId))
      .leftJoin(listings, eq(listings.id, agentInteractions.listingId))
      .where(gte(agentInteractions.occurredAt, since))
      .orderBy(desc(agentInteractions.occurredAt))
      .limit(SECTION_LIMIT * 2),
    db
      .select({
        id: messageSends.id,
        agentId: messageSends.agentId,
        agentName: agents.name,
        listingId: messageSends.listingId,
        address: listings.address,
        presetName: messagePresets.name,
        channel: messageSends.channel,
        sentAt: messageSends.sentAt,
        respondedAt: messageSends.respondedAt,
        result: messageSends.result,
      })
      .from(messageSends)
      .leftJoin(agents, eq(agents.id, messageSends.agentId))
      .leftJoin(listings, eq(listings.id, messageSends.listingId))
      .leftJoin(messagePresets, eq(messagePresets.id, messageSends.presetId))
      .where(or(gte(messageSends.sentAt, since), gte(messageSends.respondedAt, since)))
      .orderBy(desc(messageSends.sentAt))
      .limit(SECTION_LIMIT * 2),
    db
      .select({
        id: galleryViews.id,
        bookingId: galleryViews.bookingId,
        event: galleryViews.event,
        detail: galleryViews.detail,
        at: galleryViews.at,
        city: galleryViews.city,
        region: galleryViews.region,
        country: galleryViews.country,
        userAgent: galleryViews.userAgent,
        address: bookings.address,
        bookingCity: bookings.city,
        contactAgentId: bookings.contactAgentId,
        contactName: agents.name,
        listingAddress: listings.address,
      })
      .from(galleryViews)
      .innerJoin(bookings, eq(bookings.id, galleryViews.bookingId))
      .leftJoin(agents, eq(agents.id, bookings.contactAgentId))
      .leftJoin(listings, eq(listings.id, bookings.listingId))
      .where(gte(galleryViews.at, since))
      .orderBy(desc(galleryViews.at))
      .limit(SECTION_LIMIT * 3),
    db
      .select({
        id: portfolioSessions.id,
        linkId: portfolioSessions.linkId,
        agentId: portfolioLinks.agentId,
        agentName: agents.name,
        startedAt: portfolioSessions.startedAt,
        lastSeenAt: portfolioSessions.lastSeenAt,
        activeSeconds: portfolioSessions.activeSeconds,
        maxScrollPct: portfolioSessions.maxScrollPct,
        city: portfolioSessions.city,
        region: portfolioSessions.region,
        country: portfolioSessions.country,
      })
      .from(portfolioSessions)
      .innerJoin(portfolioLinks, eq(portfolioLinks.id, portfolioSessions.linkId))
      .leftJoin(agents, eq(agents.id, portfolioLinks.agentId))
      .where(gte(portfolioSessions.lastSeenAt, since))
      .orderBy(desc(portfolioSessions.lastSeenAt))
      .limit(SECTION_LIMIT),
    db
      .select({
        id: portfolioEvents.id,
        linkId: portfolioEvents.linkId,
        agentId: portfolioLinks.agentId,
        agentName: agents.name,
        event: portfolioEvents.event,
        detail: portfolioEvents.detail,
        at: portfolioEvents.at,
      })
      .from(portfolioEvents)
      .innerJoin(portfolioLinks, eq(portfolioLinks.id, portfolioEvents.linkId))
      .leftJoin(agents, eq(agents.id, portfolioLinks.agentId))
      .where(gte(portfolioEvents.at, since))
      .orderBy(desc(portfolioEvents.at))
      .limit(SECTION_LIMIT),
    loadBookingsWithDetails(),
    db
      .select({
        id: reminders.id,
        title: reminders.title,
        date: reminders.date,
        time: reminders.time,
        agentId: reminders.agentId,
        agentName: agents.name,
        bookingId: reminders.bookingId,
      })
      .from(reminders)
      .leftJoin(agents, eq(agents.id, reminders.agentId))
      .where(isNull(reminders.completedAt))
      .orderBy(reminders.date),
    // Last gallery activity per booking, for the waiting-for-payment section.
    db
      .select({
        bookingId: galleryViews.bookingId,
        lastViewAt: max(galleryViews.at),
      })
      .from(galleryViews)
      .groupBy(galleryViews.bookingId),
  ]);

  const gallery = galleryRows
    .map((r) => ({ r, ua: parseUserAgent(r.userAgent) }))
    .filter(({ ua }) => !ua.isPreview)
    .filter(({ r }) => agentNameMatches(r.contactName))
    .slice(0, SECTION_LIMIT)
    .map(({ r, ua }) => ({
      id: r.id,
      bookingId: r.bookingId,
      address: r.listingAddress ?? r.address ?? r.bookingCity,
      contactAgentId: r.contactAgentId,
      contactName: r.contactName,
      event: r.event,
      detail: r.detail,
      at: r.at,
      location: location(r.city, r.region, r.country),
      device: ua.device,
      browser: ua.browser,
    }));

  const interactions = interactionRows.filter((r) => agentNameMatches(r.agentName)).slice(0, SECTION_LIMIT);
  const sends = sendRows.filter((r) => agentNameMatches(r.agentName)).slice(0, SECTION_LIMIT);
  const sessions = sessionRows.filter((r) => agentNameMatches(r.agentName)).slice(0, SECTION_LIMIT);
  const portfolioEventsList = eventRows.filter((r) => agentNameMatches(r.agentName)).slice(0, SECTION_LIMIT);

  const { waiting, editing } = groupBookings(bookingDetails);
  const lastGalleryByBooking = new Map(lastGalleryRows.map((r) => [r.bookingId, r]));
  // The most recent gallery event per waiting booking, so "invoice_view"
  // vs a plain view is visible, not just the timestamp.
  const waitingIds = waiting.map((b) => b.id);
  const latestGalleryEvents =
    waitingIds.length > 0
      ? await db
          .select({ bookingId: galleryViews.bookingId, event: galleryViews.event, at: galleryViews.at })
          .from(galleryViews)
          .where(inArray(galleryViews.bookingId, waitingIds))
          .orderBy(desc(galleryViews.at))
      : [];
  const latestGalleryEventByBooking = new Map<string, string>();
  for (const r of latestGalleryEvents) {
    if (!latestGalleryEventByBooking.has(r.bookingId)) latestGalleryEventByBooking.set(r.bookingId, r.event);
  }
  const waitingForPayment = waiting
    .filter((b) => agentNameMatches(b.contactName))
    .map((b) => {
      const lastGallery = lastGalleryByBooking.get(b.id);
      const total = b.lineItems.reduce((sum, li) => sum + li.amount, 0);
      return {
        bookingId: b.id,
        address: b.address,
        city: b.city,
        contactAgentId: b.contactAgentId,
        contactName: b.contactName,
        total,
        invoiceSentAt: b.invoiceSentAt,
        daysWaiting: b.invoiceSentAt ? daysBetween(b.invoiceSentAt, now) : null,
        paidAt: b.paidAt,
        lastGalleryViewAt: lastGallery?.lastViewAt ?? null,
        lastGalleryEvent: latestGalleryEventByBooking.get(b.id) ?? null,
        daysSinceLastGalleryView:
          lastGallery?.lastViewAt != null ? daysBetween(lastGallery.lastViewAt, now) : null,
      };
    })
    .sort((a, b) => (b.daysWaiting ?? 0) - (a.daysWaiting ?? 0));
  const editingList = editing
    .filter((b) => agentNameMatches(b.contactName))
    .map((b) => ({
      bookingId: b.id,
      address: b.address,
      city: b.city,
      contactAgentId: b.contactAgentId,
      contactName: b.contactName,
      total: b.lineItems.reduce((sum, li) => sum + li.amount, 0),
      shotAt: b.shotAt,
      daysSinceShot: b.shotAt ? daysBetween(b.shotAt, now) : null,
    }))
    .sort((a, b) => (b.daysSinceShot ?? 0) - (a.daysSinceShot ?? 0));
  const openReminders = reminderRows
    .filter((r) => agentNameMatches(r.agentName))
    .map((r) => ({ ...r, overdue: r.date < now.toISOString().slice(0, 10) }));

  // One timeline, newest first, across every history source.
  const timeline: ActivityItem[] = [
    ...interactions.map((r) =>
      item(
        "interaction",
        r.occurredAt,
        r.agentId,
        r.agentName,
        null,
        r.listingId,
        `${r.direction === "inbound" ? "Inbound" : "Outbound"} ${r.channel}${r.outcome ? ` · ${r.outcome}` : ""} · ${r.agentName ?? "unknown agent"}`,
        r.address ?? r.note,
      ),
    ),
    ...sends.flatMap((r) => {
      const out = [
        item(
          "message_sent",
          r.sentAt,
          r.agentId,
          r.agentName,
          null,
          r.listingId,
          `${r.channel === "email" ? "Email" : "Text"} sent · ${r.agentName ?? "unknown agent"}${r.presetName ? ` · ${r.presetName}` : ""}`,
          r.address,
        ),
      ];
      if (r.respondedAt && r.respondedAt >= since) {
        out.push(
          item(
            "message_responded",
            r.respondedAt,
            r.agentId,
            r.agentName,
            null,
            r.listingId,
            `Reply · ${r.agentName ?? "unknown agent"}${r.result !== "pending" ? ` · ${r.result}` : ""}`,
            r.address,
          ),
        );
      }
      return out;
    }),
    ...gallery.map((r) =>
      item(
        "gallery",
        r.at,
        r.contactAgentId,
        r.contactName,
        r.bookingId,
        null,
        `Gallery ${r.event.replaceAll("_", " ")} · ${r.address ?? "unknown job"}`,
        [r.contactName, r.location, `${r.device} · ${r.browser}`, r.detail].filter(Boolean).join(" · ") || null,
      ),
    ),
    ...sessions.map((r) =>
      item(
        "portfolio_session",
        r.lastSeenAt,
        r.agentId,
        r.agentName,
        null,
        null,
        `Portfolio page viewed · ${r.agentName ?? "unknown agent"}`,
        [
          r.activeSeconds ? `${r.activeSeconds}s active` : null,
          r.maxScrollPct ? `${r.maxScrollPct}% scrolled` : null,
          location(r.city, r.region, r.country),
        ]
          .filter(Boolean)
          .join(" · ") || null,
      ),
    ),
    ...portfolioEventsList.map((r) =>
      item(
        "portfolio_event",
        r.at,
        r.agentId,
        r.agentName,
        null,
        null,
        `Portfolio ${r.event.replaceAll("_", " ")} · ${r.agentName ?? "unknown agent"}`,
        r.detail,
      ),
    ),
    ...bookingDetails.flatMap((b) => {
      if (!agentNameMatches(b.contactName)) return [];
      const address = b.address ?? b.city ?? "unknown job";
      const events: ActivityItem[] = [];
      if (b.shotAt && b.shotAt >= since)
        events.push(item("booking_shot", b.shotAt, b.contactAgentId, b.contactName, b.id, b.listingId, `Shot · ${address}`));
      if (b.invoiceSentAt && b.invoiceSentAt >= since)
        events.push(
          item("booking_invoiced", b.invoiceSentAt, b.contactAgentId, b.contactName, b.id, b.listingId, `Invoice sent · ${address}`),
        );
      if (b.paidAt && b.paidAt >= since)
        events.push(item("booking_paid", b.paidAt, b.contactAgentId, b.contactName, b.id, b.listingId, `Paid · ${address}`));
      if (b.completedAt && b.completedAt >= since)
        events.push(
          item("booking_completed", b.completedAt, b.contactAgentId, b.contactName, b.id, b.listingId, `Completed · ${address}`),
        );
      return events;
    }),
  ]
    .filter((e) => e.at != null && e.at >= since)
    .sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0))
    .slice(0, TIMELINE_LIMIT);

  const counts = new Map<string, number>();
  for (const e of timeline) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);

  return NextResponse.json({
    generatedAt: now.toISOString(),
    windowDays: days,
    since: since.toISOString(),
    agentFilter,
    counts: Object.fromEntries(counts),
    timeline,
    sections: {
      interactions: interactions.map((r) => ({
        id: r.id,
        agentId: r.agentId,
        agentName: r.agentName,
        listingId: r.listingId,
        address: r.address,
        channel: r.channel,
        direction: r.direction,
        outcome: r.outcome,
        note: r.note,
        occurredAt: r.occurredAt,
      })),
      messageSends: sends.map((r) => ({
        id: r.id,
        agentId: r.agentId,
        agentName: r.agentName,
        listingId: r.listingId,
        address: r.address,
        presetName: r.presetName,
        channel: r.channel,
        sentAt: r.sentAt,
        respondedAt: r.respondedAt,
        result: r.result,
      })),
      galleryViews: gallery,
      portfolioSessions: sessions,
      portfolioEvents: portfolioEventsList,
    },
    attention: {
      waitingForPayment,
      editing: editingList,
      openReminders,
    },
  });
}
