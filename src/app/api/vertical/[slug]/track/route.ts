import { NextRequest, NextResponse, after } from "next/server";
import { and, count, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { VERTICAL_EVENTS, verticalEvents, verticalLinks, verticalSessions, type VerticalEvent } from "@/db/schema";
import { notifyVerticalAction } from "@/lib/push";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECTION_RE = /^[a-z_]{1,32}$/;
/** Per visit — far more than anyone taps; it only stops a runaway script filling the table. */
const MAX_EVENTS_PER_SESSION = 300;

interface TrackBody {
  session?: unknown;
  screen?: unknown;
  activeSeconds?: unknown;
  maxScroll?: unknown;
  sections?: unknown;
  events?: unknown;
}

const clampInt = (v: unknown, max: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(max, Math.round(v))) : 0);

/**
 * An other-verticals page's tracker (src/components/VerticalTracker.tsx), a
 * copy of the agent page's, reports here: the visit's running totals — visible time, deepest scroll, seconds
 * per section — which overwrite the last report, plus any taps since then.
 * Sent with sendBeacon as text/plain, so the body is parsed by hand.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let body: TrackBody;
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "Bad body" }, { status: 400 });
  }
  const sessionId = typeof body.session === "string" && UUID_RE.test(body.session) ? body.session : null;
  if (!sessionId) return NextResponse.json({ error: "Bad session" }, { status: 400 });

  const [link] = await db
    .select({ id: verticalLinks.id, company: verticalLinks.company, vertical: verticalLinks.vertical })
    .from(verticalLinks)
    .where(eq(verticalLinks.slug, slug));
  if (!link) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const sections: Record<string, number> = {};
  if (body.sections && typeof body.sections === "object") {
    for (const [k, v] of Object.entries(body.sections as Record<string, unknown>).slice(0, 20)) {
      if (SECTION_RE.test(k)) sections[k] = clampInt(v, 6 * 60 * 60);
    }
  }
  const activeSeconds = clampInt(body.activeSeconds, 6 * 60 * 60);
  const maxScroll = clampInt(body.maxScroll, 100);
  const screen = typeof body.screen === "string" ? body.screen.slice(0, 20) : null;

  const h = req.headers;
  const decode = (v: string | null) => {
    if (!v) return null;
    try {
      return decodeURIComponent(v);
    } catch {
      return v;
    }
  };

  // Totals only ever grow, so a late or out-of-order report can't shrink them.
  const upserted = await db
    .insert(verticalSessions)
    .values({
      id: sessionId,
      linkId: link.id,
      activeSeconds,
      maxScrollPct: maxScroll,
      sectionSeconds: sections,
      screen,
      ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip"),
      city: decode(h.get("x-vercel-ip-city")),
      region: h.get("x-vercel-ip-country-region"),
      country: h.get("x-vercel-ip-country"),
      userAgent: h.get("user-agent"),
      referer: h.get("referer"),
    })
    .onConflictDoUpdate({
      target: verticalSessions.id,
      set: {
        lastSeenAt: new Date(),
        activeSeconds: sql`greatest(${verticalSessions.activeSeconds}, ${activeSeconds})`,
        maxScrollPct: sql`greatest(${verticalSessions.maxScrollPct}, ${maxScroll})`,
        sectionSeconds: sql`${verticalSessions.sectionSeconds} || ${JSON.stringify(sections)}::jsonb`,
      },
      // A session id belongs to the link it started on.
      setWhere: eq(verticalSessions.linkId, link.id),
    })
    .returning({ id: verticalSessions.id });
  if (upserted.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const events = (Array.isArray(body.events) ? body.events : [])
    .slice(0, 20)
    .map((e) => e as { event?: unknown; detail?: unknown })
    .filter((e): e is { event: VerticalEvent; detail?: unknown } => VERTICAL_EVENTS.includes(e.event as VerticalEvent))
    .map((e) => ({
      sessionId,
      linkId: link.id,
      event: e.event,
      detail: typeof e.detail === "string" ? e.detail.slice(0, 200) : null,
    }));

  if (events.length > 0) {
    const [{ n }] = await db.select({ n: count() }).from(verticalEvents).where(and(eq(verticalEvents.sessionId, sessionId)));
    if (n < MAX_EVENTS_PER_SESSION) {
      await db.insert(verticalEvents).values(events);
      for (const action of ["save_contact", "text_me"] as const) {
        if (events.some((e) => e.event === action)) {
          after(() => notifyVerticalAction(link.id, link.vertical, link.company, action).catch((err) => console.error("vertical action push failed", err)));
        }
      }
    }
  }

  return new NextResponse(null, { status: 204 });
}
