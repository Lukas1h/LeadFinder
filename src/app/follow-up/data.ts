import { db } from "@/db";
import {
  agents,
  agentInteractions,
  bookings,
  listings,
  messagePresets,
  messageSends,
  type Agent,
  type Listing,
} from "@/db/schema";
import { and, eq, gt, inArray, isNotNull, or } from "drizzle-orm";
import { estimateDriveMinutes } from "@/lib/driveTime";
import { LEAD_GOOD_PHOTO_SCORE } from "@/lib/leadSections";
import { marketNews, marketNewsLabel, type MarketNews } from "@/lib/marketStatus";
import { suggestFollowUpText } from "./suggest";

const DAY = 24 * 60 * 60 * 1000;
const TZ = "America/Los_Angeles";

/** How long a new listing counts as "just listed". */
const JUST_LISTED_DAYS = 21;
/** How long after a listing goes under contract or closes it's still worth a congrats. */
const NEWS_DAYS = 21;
/** How long a price cut stays a reason to get in touch. */
const PRICE_CUT_DAYS = 14;
/**
 * Samples went out and nothing came back: worth one "did they come through?"
 * after this long. It was a week, and Lukas found a text the week after the
 * samples too soon to send (2026-10-11), so it matches the two weeks an
 * interested agent gets.
 */
const SAMPLES_WAIT_DAYS = 14;
/** …and past this it's just someone who has gone quiet. */
const SAMPLES_MAX_DAYS = 42;
/** A snooze from before he could pick its length (followUpSnoozedUntil is null) was this long. */
const LEGACY_SNOOZE_DAYS = 28;
/**
 * Nobody comes up within this many days of the last text, call or email
 * either way, whatever the reason: a listing that went live the week he
 * texted them waits until it's no longer the same week's conversation. The
 * reasons all outlast it (two to three weeks), so it delays them, it doesn't
 * lose them. Clients are exempt; a congrats to someone he's working with
 * isn't pestering.
 */
const MIN_GAP_DAYS = 10;
/** Someone with a listing in this many days is actively listing. */
const ACTIVE_LISTER_DAYS = 30;
/** How many follow-ups a day the page asks for. */
const DAILY_TARGET = 5;

/**
 * Days of silence before someone comes back up on the timer alone: one number
 * per kind of relationship, so it can be said in a sentence.
 *
 * Warm was split for a day (three weeks if they'd listed in the last month,
 * eight if not), and Lukas found a warm agent untouched for 17 days who wasn't
 * coming up for another five weeks, with no way to see why (2026-10-11). Fifty
 * of his 92 warm agents were in that slow lane. The split is gone; people who
 * stop answering leave through MAX_UNANSWERED instead.
 *
 * Interested stays at two weeks: one was tried and Lukas found a second text
 * inside the same stretch as the first one weird to send, and it's his name on
 * it. MIN_GAP_DAYS is the floor under everything for that reason.
 *
 * Timing these to each agent's own listing rhythm ("just before their next
 * one") was looked at the same day and isn't possible yet: listings have only
 * been tracked since September, 11 of the 145 agents he knows have three or
 * more on file, and the gaps of those who do are close to random. Reacting to
 * the listing itself (the reasons above the timer) is what the data supports.
 */
const QUIET_DAYS = { client: 28, interested: 14, warm: 21 };

/**
 * Each follow-up that goes unanswered doubles the wait (interested: 2 weeks,
 * then 4, then 8), and after this many the timer stops bringing them back at
 * all. A reason still does: a new listing, a sale, a price cut. Without this
 * nobody ever left the list, and at a few hundred agents it would have asked
 * for a hundred texts a week to people who had stopped answering. Clients are
 * exempt.
 */
const MAX_UNANSWERED = 3;
/** Touches this close together are one follow-up, and this soon after their reply are still the same exchange. */
const SAME_EXCHANGE_DAYS = 2;

/**
 * Why someone is on the list, strongest first. This order is the page's sort:
 * a reason to text beats a timer, and the reasons that are about work he could
 * still win come before the ones that are only a hello.
 */
export const FOLLOW_UP_REASONS = ["weak_photos", "samples", "just_listed", "news", "price_cut", "quiet"] as const;
export type FollowUpReason = (typeof FOLLOW_UP_REASONS)[number];

export interface FollowUpEntry {
  agent: Agent;
  /** Their latest reply: a send marked replied, or an inbound call/text/email. */
  lastReplyAt: Date | null;
}

export interface FollowUpItem extends FollowUpEntry {
  reason: FollowUpReason;
  /** Why they're here, in a line: "Just listed Oct 9 with weak photos", "Pending since Oct 7". The words to use, too: agents use the sale ones precisely. */
  label: string;
  /** The listing the reason is about, when there is one. */
  listing: Listing | null;
  /** For a home he shot that was booked by address alone, which has no listing row. */
  address: string | null;
  city: string | null;
  /** A text to start from, in his voice (suggestFollowUpText). Fills Messages; he edits and sends. */
  suggestion: string;
}

/** Someone who isn't due yet, and when they will be. The page lists them so nobody is ever just missing. */
export interface FollowUpUpcoming {
  agent: Agent;
  /** Null when the timer has stopped bringing them back: only a listing or sale of theirs will. */
  dueAt: Date | null;
  /** Why then: "Last contact Sep 24", "Snoozed", "Just listed Oct 9". */
  note: string;
}

export interface FollowUpBoard {
  /** The next few to do, enough to bring today's total to dailyTarget. Empty once that's met. */
  today: FollowUpItem[];
  /** Everyone else who is due, in the same order. */
  later: FollowUpItem[];
  /** Follow-ups already done today: people he got back in touch with after a gap. A snooze isn't one; the next person moves up. */
  doneToday: number;
  dailyTarget: number;
  /** Everyone else he knows, soonest first, the ones with no date last. */
  upcoming: FollowUpUpcoming[];
}

/** "1811 NE Alameda Ave" → "1811 alameda". Bookings often aren't linked to a listing, so match by address. */
function addressKey(address: string | null): string | null {
  if (!address) return null;
  const words = address.toLowerCase().replace(/[.,#]/g, " ").split(/\s+/).filter(Boolean);
  const number = words.find((w) => /^\d+$/.test(w));
  const street = words.find((w) => !/^\d/.test(w) && !/^(n|s|e|w|ne|nw|se|sw|north|south|east|west)$/.test(w));
  return number && street ? `${number} ${street}` : null;
}

/** "Oct 5", Pacific: this runs on the server, which is on UTC. */
function shortDate(date: Date): string {
  return new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: TZ });
}

/** Midnight today, Pacific. */
function startOfToday(now: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(now));
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0) % 24;
  return now - ((part("hour") * 60 + part("minute")) * 60 + part("second")) * 1000;
}

/** Nearest first, in the Leads page's bands: local, a short drive, a long one, a trip, unknown. */
function driveBand(city: string | null): number {
  const minutes = city ? estimateDriveMinutes(city) : null;
  if (minutes == null) return 4;
  return minutes <= 45 ? 0 : minutes <= 100 ? 1 : minutes <= 165 ? 2 : 3;
}

/**
 * The Follow up page: everyone Lukas knows (clients, interested, warm) who is
 * due to hear from him, one entry each, strongest reason first.
 *
 * The reasons, in order (FOLLOW_UP_REASONS):
 *
 * - weak_photos: they put up a listing whose photos scored as amateur, and he
 *   hasn't been in touch since. The one case where the listing itself is work.
 * - samples: he emailed them samples a week or more ago and neither side has
 *   said anything since. That email is where most conversations stopped.
 * - just_listed: they put up a listing he hasn't acted on. A new listing is the
 *   most natural reason to text someone who already knows him. Warm agents
 *   count too now; it used to be clients and interested only.
 * - news: a listing of theirs, or a home he shot for them, went under contract
 *   or closed (the nightly market check, lib/marketStatus.ts) since he was
 *   last in touch. Congratulating them is the easiest text there is to send.
 * - price_cut: one of their listings with weak photos just dropped its price.
 * - quiet: nothing above, and it has been long enough (QUIET_DAYS, doubling
 *   with each unanswered follow-up).
 *
 * Everyone else he knows is in `upcoming` with the date they'll be due.
 *
 * Acting on someone anywhere clears them: texting them, or passing the listing
 * on Leads. Snoozing hides them for the one, two or four weeks he picks; in
 * that time only something new brings them back (a listing or sale from after
 * the snooze), and when it ends whatever is still current shows again.
 *
 * Nobody shows within MIN_GAP_DAYS of the last contact either way.
 *
 * Within a reason the order is nearest first, then whoever lists most, then
 * clients before interested before warm, then most recent. It used to be
 * longest silence first, which put the people least likely to answer on top.
 */
export async function getFollowUpBoard(): Promise<FollowUpBoard> {
  const empty: FollowUpBoard = { today: [], later: [], doneToday: 0, dailyTarget: DAILY_TARGET, upcoming: [] };
  const candidates = await db
    .select()
    .from(agents)
    .where(inArray(agents.relationshipStatus, ["regular", "worked_once", "interested", "warm"]));
  if (candidates.length === 0) return empty;

  const ids = candidates.map((a) => a.id);
  const now = Date.now();
  const justListedSince = new Date(now - JUST_LISTED_DAYS * DAY);
  const newsSince = new Date(now - NEWS_DAYS * DAY);
  const cutSince = new Date(now - PRICE_CUT_DAYS * DAY);

  const [sends, interactions, eventful, allListings, bookedAddresses, movedJobs, presets] = await Promise.all([
    db
      .select({
        agentId: messageSends.agentId,
        presetId: messageSends.presetId,
        sentAt: messageSends.sentAt,
        respondedAt: messageSends.respondedAt,
      })
      .from(messageSends)
      .where(inArray(messageSends.agentId, ids)),
    db
      .select({
        agentId: agentInteractions.agentId,
        direction: agentInteractions.direction,
        at: agentInteractions.occurredAt,
      })
      .from(agentInteractions)
      .where(inArray(agentInteractions.agentId, ids)),
    // Full rows only for the listings something has just happened to.
    db
      .select()
      .from(listings)
      .where(
        and(
          inArray(listings.agentId, ids),
          or(
            and(inArray(listings.status, ["new", "saved"]), gt(listings.foundAt, justListedSince)),
            gt(listings.marketStatusAt, newsSince),
            gt(listings.priceCutAt, cutSince)
          )
        )
      ),
    // And the bare facts of the rest, for how often and where each agent lists.
    db
      .select({ agentId: listings.agentId, city: listings.city, listedAt: listings.listedAt, foundAt: listings.foundAt })
      .from(listings)
      .where(inArray(listings.agentId, ids)),
    db.select({ address: bookings.address }).from(bookings).where(isNotNull(bookings.address)),
    db
      .select({ booking: bookings, listing: listings })
      .from(bookings)
      .leftJoin(listings, eq(bookings.listingId, listings.id))
      .where(and(inArray(bookings.contactAgentId, ids), gt(bookings.marketStatusAt, newsSince))),
    // Named columns: a preset row carries its attachments' bytes.
    db
      .select({ id: messagePresets.id, channel: messagePresets.channel, quickActions: messagePresets.quickActionPresetIds })
      .from(messagePresets),
  ]);

  // "Samples" are the emails offered as a quick action on a text (see
  // messagePresets.quickActionPresetIds), whatever the template is called.
  const quickActionIds = new Set(presets.flatMap((p) => p.quickActions));
  const samplePresets = new Set(presets.filter((p) => p.channel === "email" && quickActionIds.has(p.id)).map((p) => p.id));

  interface History {
    /** Every time he reached out, oldest first. */
    out: number[];
    lastIn: number;
    samplesAt: number;
  }
  const history = new Map<string, History>(candidates.map((a) => [a.id, { out: [], lastIn: 0, samplesAt: 0 }]));
  for (const s of sends) {
    const h = s.agentId ? history.get(s.agentId) : null;
    if (!h) continue;
    h.out.push(s.sentAt.getTime());
    if (s.respondedAt) h.lastIn = Math.max(h.lastIn, s.respondedAt.getTime());
    if (samplePresets.has(s.presetId)) h.samplesAt = Math.max(h.samplesAt, s.sentAt.getTime());
  }
  for (const i of interactions) {
    const h = i.agentId ? history.get(i.agentId) : null;
    if (!h) continue;
    if (i.direction === "outbound") h.out.push(i.at.getTime());
    else h.lastIn = Math.max(h.lastIn, i.at.getTime());
  }
  for (const a of candidates) {
    const h = history.get(a.id)!;
    if (a.lastContactedAt) h.out.push(a.lastContactedAt.getTime());
    h.out.sort((x, y) => x - y);
  }

  // How often and where each of them lists.
  const activeSince = now - ACTIVE_LISTER_DAYS * DAY;
  const listed = new Map<string, { recent: number; city: string | null; latest: number }>();
  for (const l of allListings) {
    if (!l.agentId) continue;
    const at = (l.listedAt ?? l.foundAt).getTime();
    const entry = listed.get(l.agentId) ?? { recent: 0, city: null, latest: 0 };
    if (at > activeSince) entry.recent++;
    if (l.city && at >= entry.latest) {
      entry.city = l.city;
      entry.latest = at;
    }
    listed.set(l.agentId, entry);
  }

  const booked = new Set(bookedAddresses.map((b) => addressKey(b.address)).filter(Boolean));
  const shotByHim = (l: Listing) => {
    const key = addressKey(l.address);
    return l.bookingId != null || (key != null && booked.has(key));
  };

  // Newest open listing per agent that isn't one of his jobs, and their latest price cut.
  const newestListing = new Map<string, Listing>();
  const latestCut = new Map<string, Listing>();
  for (const l of eventful) {
    if (!l.agentId || shotByHim(l)) continue;
    // By the date it went on the market: an alert can turn up a listing that has been for sale since July.
    if ((l.status === "new" || l.status === "saved") && l.foundAt > justListedSince && (l.listedAt ?? l.foundAt) > justListedSince) {
      const prev = newestListing.get(l.agentId);
      if (!prev || l.foundAt > prev.foundAt) newestListing.set(l.agentId, l);
    }
    // Only where the photos are known to be weak: a cut is when an agent
    // relaunches a listing, and new photos are the obvious thing to relaunch
    // with. On a listing that already looks professional it's no reason to
    // text, and those were ten of the first twenty-four people on this list.
    // A cut on a home that has since gone under contract is news, not a cut.
    const weakPhotos = l.score != null && l.score < LEAD_GOOD_PHOTO_SCORE;
    if (l.priceCutAt && l.priceCutAt > cutSince && weakPhotos && !marketNews(l.marketStatus) && l.status !== "booked") {
      const prev = latestCut.get(l.agentId);
      if (!prev || l.priceCutAt > prev.priceCutAt!) latestCut.set(l.agentId, l);
    }
  }

  // One piece of news per agent: a home he shot before anything else of
  // theirs, then whichever happened most recently.
  interface Sale {
    listing: Listing | null;
    address: string | null;
    city: string | null;
    shot: boolean;
    status: string | null;
    at: Date;
  }
  const latestNews = new Map<string, Sale>();
  const offer = (agentId: string | null, sale: Sale) => {
    if (!agentId || !marketNews(sale.status)) return;
    const prev = latestNews.get(agentId);
    if (!prev || (sale.shot && !prev.shot) || (sale.shot === prev.shot && sale.at > prev.at)) {
      latestNews.set(agentId, sale);
    }
  };
  for (const l of eventful) {
    if (!l.marketStatusAt || l.marketStatusAt <= newsSince) continue;
    offer(l.agentId, {
      listing: l,
      address: l.address,
      city: l.city,
      shot: shotByHim(l),
      status: l.marketStatus,
      at: l.marketStatusAt,
    });
  }
  for (const { booking: b, listing } of movedJobs) {
    if (!b.marketStatusAt) continue;
    offer(b.contactAgentId, {
      listing,
      address: listing?.address ?? b.address,
      city: listing?.city ?? b.city,
      shot: true,
      status: b.marketStatus,
      at: b.marketStatusAt,
    });
  }

  const isClient = (a: Agent) => a.relationshipStatus === "regular" || a.relationshipStatus === "worked_once";
  const rank = (a: Agent) => (isClient(a) ? 0 : a.relationshipStatus === "interested" ? 1 : 2);

  interface Ranked extends FollowUpItem {
    /** News about a home he shot goes first among the news. */
    shot: boolean;
    band: number;
    activity: number;
    /** What the reason is dated by; newest first within everything else. */
    at: number;
  }
  const due: Ranked[] = [];
  const upcoming: FollowUpUpcoming[] = [];
  const today = startOfToday(now);
  let doneToday = 0;

  for (const agent of candidates) {
    const h = history.get(agent.id)!;
    const lastOut = h.out.length ? h.out[h.out.length - 1] : 0;
    const lastTouch = Math.max(lastOut, h.lastIn);
    const snoozedAt = agent.followUpDismissedAt?.getTime() ?? 0;
    const snoozedUntil = agent.followUpSnoozedUntil?.getTime() ?? (snoozedAt ? snoozedAt + LEGACY_SNOOZE_DAYS * DAY : 0);
    const snoozed = now < snoozedUntil;
    const activity = listed.get(agent.id)?.recent ?? 0;

    // Done today: back in touch after a gap. Someone he first texted this
    // morning and is still talking to isn't a follow-up.
    const firstOutToday = h.out.find((t) => t >= today);
    const before = Math.max(h.lastIn < today ? h.lastIn : 0, ...h.out.filter((t) => t < today), 0);
    if (firstOutToday != null && before > 0 && firstOutToday - before >= 5 * DAY) doneToday++;

    /** The floor: no reason brings someone up before this. */
    const heldUntil = !isClient(agent) && lastTouch ? lastTouch + MIN_GAP_DAYS * DAY : 0;

    /** While snoozed, only what has happened since the snooze counts. */
    const shown = (since: number) => !snoozed || since > snoozedAt;
    /** Something that happened at `since` is still a reason if he hasn't reached out after it. */
    const open = (since: number) => shown(since) && lastOut < since;

    const base = { agent, lastReplyAt: h.lastIn ? new Date(h.lastIn) : null, activity };
    const cityOf = (city: string | null | undefined) => city ?? listed.get(agent.id)?.city ?? null;
    const push = (
      item: Omit<Ranked, keyof typeof base | "band" | "shot" | "suggestion"> & { shot?: boolean; kind?: MarketNews }
    ) => {
      const { kind, ...rest } = item;
      if (now < heldUntil) {
        upcoming.push({ agent, dueAt: new Date(heldUntil), note: item.label });
        return;
      }
      due.push({
        ...base,
        shot: false,
        ...rest,
        band: driveBand(cityOf(item.city)),
        suggestion: suggestFollowUpText({
          agent,
          reason: item.reason,
          listing: item.listing,
          address: item.address,
          news: kind ? { kind, shot: item.shot ?? false } : undefined,
          isClient: isClient(agent),
        }),
      });
    };

    const fresh = newestListing.get(agent.id);
    const freshOpen = fresh != null && open(fresh.foundAt.getTime());
    if (fresh && freshOpen && fresh.score != null && fresh.score < LEAD_GOOD_PHOTO_SCORE) {
      push({
        reason: "weak_photos",
        label: `Just listed ${shortDate(fresh.listedAt ?? fresh.foundAt)} with weak photos`,
        listing: fresh,
        address: fresh.address,
        city: fresh.city,
        at: fresh.foundAt.getTime(),
      });
      continue;
    }

    // "No word since" starts a little after the email: the reply that asked
    // for the samples is logged a moment after it goes, and a text he sent
    // alongside it that day is the same exchange, not a follow-up.
    const samplesAge = now - h.samplesAt;
    if (
      h.samplesAt > 0 &&
      samplesAge >= SAMPLES_WAIT_DAYS * DAY &&
      samplesAge <= SAMPLES_MAX_DAYS * DAY &&
      h.lastIn <= h.samplesAt + 10 * 60 * 1000 &&
      lastOut <= h.samplesAt + DAY &&
      shown(h.samplesAt)
    ) {
      push({
        reason: "samples",
        label: `Samples sent ${shortDate(new Date(h.samplesAt))}, no word since`,
        listing: null,
        address: null,
        city: null,
        at: h.samplesAt,
      });
      continue;
    }

    if (fresh && freshOpen) {
      const when = shortDate(fresh.listedAt ?? fresh.foundAt);
      push({
        reason: "just_listed",
        label: fresh.isComingSoon ? `Coming soon, seen ${shortDate(fresh.foundAt)}` : `Just listed ${when}`,
        listing: fresh,
        address: fresh.address,
        city: fresh.city,
        at: fresh.foundAt.getTime(),
      });
      continue;
    }

    // Against the date it happened, not the date the check noticed: if he has
    // been in touch since it went under contract, the moment has passed,
    // whether or not that text mentioned it.
    const sale = latestNews.get(agent.id);
    if (sale && open(sale.at.getTime())) {
      push({
        reason: "news",
        label: marketNewsLabel(marketNews(sale.status)!, sale.at) + (sale.shot ? ", you shot it" : ""),
        listing: sale.listing,
        address: sale.address,
        city: sale.city,
        shot: sale.shot,
        kind: marketNews(sale.status)!,
        at: sale.at.getTime(),
      });
      continue;
    }

    const cut = latestCut.get(agent.id);
    if (cut && open(cut.priceCutAt!.getTime())) {
      push({
        reason: "price_cut",
        label: `Price cut ${shortDate(cut.priceCutAt!)}, weak photos`,
        listing: cut,
        address: cut.address,
        city: cut.city,
        at: cut.priceCutAt!.getTime(),
      });
      continue;
    }

    // The timer. A snooze always hides this; a reason above still shows if it's newer than the snooze.
    let wait = isClient(agent)
      ? QUIET_DAYS.client
      : agent.relationshipStatus === "interested"
        ? QUIET_DAYS.interested
        : QUIET_DAYS.warm;
    let stopped = false;
    if (!isClient(agent)) {
      // Follow-ups since they last said anything: his touches after that exchange, a burst counting once.
      const anchor = (h.lastIn || h.out[0] || 0) + SAME_EXCHANGE_DAYS * DAY;
      let unanswered = 0;
      let counted = 0;
      for (const t of h.out) {
        if (t <= anchor || t - counted <= SAME_EXCHANGE_DAYS * DAY) continue;
        unanswered++;
        counted = t;
      }
      stopped = unanswered >= MAX_UNANSWERED;
      wait *= 2 ** unanswered;
    }
    if (stopped) {
      upcoming.push({ agent, dueAt: null, note: `No answer to ${MAX_UNANSWERED} follow-ups` });
      continue;
    }
    const timerDue = lastTouch ? lastTouch + wait * DAY : now;
    if (snoozed || now < timerDue) {
      // Samples still waiting on an answer come up for that first, on the day the samples reason starts.
      const samplesDue = h.samplesAt + SAMPLES_WAIT_DAYS * DAY;
      const awaitingSamples =
        !snoozed &&
        h.samplesAt > 0 &&
        now < samplesDue &&
        samplesDue < timerDue &&
        h.lastIn <= h.samplesAt + 10 * 60 * 1000 &&
        lastOut <= h.samplesAt + DAY;
      upcoming.push({
        agent,
        dueAt: new Date(awaitingSamples ? samplesDue : Math.max(timerDue, snoozed ? snoozedUntil : 0)),
        note: snoozed
          ? "Snoozed"
          : awaitingSamples
            ? `Samples sent ${shortDate(new Date(h.samplesAt))}`
            : `Last contact ${shortDate(new Date(lastTouch))}`,
      });
      continue;
    }
    push({
      reason: "quiet",
      label: lastTouch ? `Quiet since ${shortDate(new Date(lastTouch))}` : "No contact logged yet",
      listing: null,
      address: null,
      city: null,
      at: h.lastIn || lastTouch,
    });
  }

  due.sort(
    (a, b) =>
      FOLLOW_UP_REASONS.indexOf(a.reason) - FOLLOW_UP_REASONS.indexOf(b.reason) ||
      Number(b.shot) - Number(a.shot) ||
      a.band - b.band ||
      b.activity - a.activity ||
      rank(a.agent) - rank(b.agent) ||
      b.at - a.at
  );

  const items: FollowUpItem[] = due.map(({ agent, lastReplyAt, reason, label, listing, address, city, suggestion }) => ({
    agent,
    lastReplyAt,
    reason,
    label,
    listing,
    address,
    city,
    suggestion,
  }));
  const slots = Math.max(0, DAILY_TARGET - doneToday);
  upcoming.sort(
    (a, b) => (a.dueAt?.getTime() ?? Infinity) - (b.dueAt?.getTime() ?? Infinity) || rank(a.agent) - rank(b.agent)
  );
  return { today: items.slice(0, slots), later: items.slice(slots), doneToday, dailyTarget: DAILY_TARGET, upcoming };
}
