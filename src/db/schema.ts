import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  numeric,
  real,
  timestamp,
  date,
  boolean,
  jsonb,
  primaryKey,
  customType,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// "passed" and "declined" are both dead ends, but they mean opposite things and
// conflating them cost real signal: until 2026-09-22 a single "declined" status
// covered both "Lukas isn't shooting this property" (lead triage, which is the
// overwhelming majority — 468 of the first 501 listings) and "the agent turned
// Lukas down". Because touchAgentDeclined stamped agents.declinedAt off that one
// status, triaging a listing silently marked its agent as a rejection, which is
// how genuinely warm contacts ended up flagged as having said no. Keep them
// distinct: "passed" is Lukas's own call about a property and says nothing about
// the agent; "declined" is the agent's answer and is the only real rejection
// signal in the system.
export const LEAD_STATUSES = [
  "new",
  "saved",
  "contacted",
  "replied",
  "quoted",
  "booked",
  "passed",
  "declined",
  // Texted the agent about themselves, not this property (a "backup
  // photographer" text from a template with pitchesListing off). The listing
  // was only the reason to reach out: it leaves Leads so it isn't texted
  // about twice, but stays out of the Pipeline, and replies move the agent,
  // not the listing.
  "outreach",
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const leadStatusEnum = pgEnum("lead_status", LEAD_STATUSES);

export const listings = pgTable("listings", {
  id: uuid("id").primaryKey().defaultRandom(),
  zpid: text("zpid").notNull().unique(),
  // Other zpids Zillow has used for this same house — from merged duplicate
  // rows and from src/lib/listingDedupe.ts, which recognizes a second zpid by
  // address and folds it in here instead of inserting a twin row.
  altZpids: text("alt_zpids").array(),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  zipcode: text("zipcode"),
  price: integer("price"),
  bedrooms: numeric("bedrooms"),
  bathrooms: numeric("bathrooms"),
  livingArea: integer("living_area"),
  homeType: text("home_type"),
  listingUrl: text("listing_url"),
  listedAt: timestamp("listed_at", { withTimezone: true }),
  foundAt: timestamp("found_at", { withTimezone: true }).notNull().defaultNow(),
  photos: text("photos").array(),
  photoCount: integer("photo_count"),
  isComingSoon: boolean("is_coming_soon").notNull().default(false),
  // Zillow search results' has3DModel — an agent with a 3D tour already paid
  // for a media package. Null for rows from before this was captured and for
  // email/manual imports (the /properties detail shape doesn't carry it).
  // Zillow's matching hasVideo flag isn't stored: it came back false on all
  // 20 $2.5M+ Portland listings checked 2026-09-27, so it can't be trusted.
  has3dTour: boolean("has_3d_tour"),
  // Price-cut history for the current time on market — from Zillow price-cut
  // alert emails (free, and the only source for listings already in the DB)
  // and from the /properties priceHistory fetched for new email listings.
  // A cut on a weak-photo listing is the "relaunch with new photos" pitch, so
  // src/lib/priceCuts.ts can put a passed listing back in the leads queue
  // (resurfacedAt) when one arrives. originalPrice is the price at the
  // latest "Listed for sale" event; priceCutCount counts cuts since then
  // (a lower bound when only emails have been seen).
  priceCutAt: timestamp("price_cut_at", { withTimezone: true }),
  priceCutAmount: integer("price_cut_amount"),
  priceCutCount: integer("price_cut_count"),
  originalPrice: integer("original_price"),
  resurfacedAt: timestamp("resurfaced_at", { withTimezone: true }),
  brokerName: text("broker_name"),

  // From Zillapi's GET /v1/properties/{zpid} full details — 1 credit per
  // call (verified via the x-credits-charged response header, even on a
  // repeat call for the same zpid minutes later — the docs' "0 credits on
  // a cache hit" claim didn't hold up). NOT the dedicated /agent
  // sub-resource, which also costs 1 credit and, verified against real
  // listings, never actually returns a phone number despite its docs
  // claiming it does. Fetched once per newly-inserted lead. This is a snapshot
  // of what the source returned, NOT the link to the agent record — agentId
  // below is that.
  agentName: text("agent_name"),
  agentPhone: text("agent_phone"),

  // The authoritative listing -> agent link. Everything used to join these two
  // tables by matching agentPhone against agents.phone, which is a string join
  // on a mutable, optional field: a realtor who changes numbers silently
  // detaches from their own history, 1,111 agents on file have no phone at all
  // (they arrived email-first from a cold-email import) and so could never be
  // reached from a listing, and exact-string matching drifted enough to need
  // digits-only fallbacks in two places. It also made the duplicate-agent bug
  // possible: a listing could not see an email-only contact, so a second row
  // got created for someone already mid-conversation.
  //
  // message_sends.agentId exists for the same reason (see its comment) — this
  // applies that fix to listings. agentName/agentPhone stay for display and as
  // a record of what the source actually returned.
  agentId: uuid("agent_id").references((): AnyPgColumn => agents.id, { onDelete: "set null" }),

  // Lead pipeline: new -> saved -> contacted -> replied -> quoted -> booked,
  // with declined reachable from anywhere (quoted is optional — replied can
  // go straight to booked for an instant close). contactedAt drives
  // follow-up flagging (see getFollowUpAfterDays in src/lib/settings.ts).
  // statusChangedAt updates on every transition (contactedAt only on ones
  // into "contacted") — used to sort the pipeline page by how long a
  // listing has sat in its current state.
  status: leadStatusEnum("status").notNull().default("new"),
  contactedAt: timestamp("contacted_at", { withTimezone: true }),
  statusChangedAt: timestamp("status_changed_at", { withTimezone: true }),

  // Points at this listing's current/most-recent bookings row (see below) —
  // a listing can be booked more than once over time (reshoots), so this is
  // a pointer to the latest one, not the source of history. bookings.listingId
  // is the reverse FK that gives the full history. Set together with
  // status="booked" whenever a booking is created for this listing.
  bookingId: uuid("booking_id").references((): AnyPgColumn => bookings.id),

  // Manual "come back to this on a specific date" reminder — distinct from
  // the automatic contactedAt-driven follow-up flagging in
  // src/lib/settings.ts, which only fires after Lukas has messaged someone
  // and gone quiet. This is for cases like "the agent said check back
  // Thursday once the house doesn't sell." Surfaced as its own Pipeline
  // section once followUpAt has arrived; followUpNote is optional context
  // shown alongside it.
  followUpAt: timestamp("follow_up_at", { withTimezone: true }),
  followUpNote: text("follow_up_note"),

  // AI photo-quality score (1-10, higher = more clearly professional
  // photography) from Gemini 3.5 Flash-Lite vision, scored once per
  // newly-inserted lead in the sync route. See src/lib/photoScore.ts for
  // the rubric. A
  // LOW score is the valuable lead here — it means the listing likely
  // doesn't have a pro photographer yet.
  // Which Leads-page section this listing sorts into (see lib/leadSections.ts
  // for the rules). Stored rather than derived on every read so preset
  // targeting can filter on it the way it filters score and price, and so the
  // message dialog can recommend a template without recomputing the rules.
  // Recomputed by refreshLeadSections whenever the inputs that decide it
  // change — the price, the photo score, the agent.
  leadSection: text("lead_section"),

  score: integer("score"),
  scoreReasoning: text("score_reasoning"),
  // Asked in the same photo-scoring call (lib/photoScore.ts), so free: is the
  // home empty (the Virtual staging feed), and is there an aerial in the
  // sampled photos (the Drone shots feed). Null for listings scored before
  // 2026-10-22, which aren't re-scored for this.
  photosVacant: boolean("photos_vacant"),
  photosHaveDrone: boolean("photos_have_drone"),

  // Free-text, edited from the listing detail modal.
  notes: text("notes"),

  // Which source found this listing — a search source's name (e.g.
  // "Eugene") or "Zillow email alert". Set once at insert time, shown in
  // the listing detail modal.
  sourceLabel: text("source_label"),

  // Resolved once via Tavily (see findListingSourceUrl in src/app/actions.ts)
  // and cached here so the "Realtor.com"/"Redfin" buttons on the listing
  // detail modal don't re-spend a credit (and re-pay the lookup latency) on
  // every click — a listing's address never changes, so the result is good
  // forever once found. Null means "not looked up yet, try Tavily"; a
  // failed/no-match lookup is deliberately left null too rather than cached,
  // so a later retry (e.g. once Redfin indexes the listing) can still
  // succeed instead of being stuck on a stale miss.
  realtorUrl: text("realtor_url"),
  redfinUrl: text("redfin_url"),

  // What the MLS says about the listing now ("Pending", "Sold"…), read off
  // its Compass page by the nightly market check (lib/marketStatus.ts) for
  // listings whose agent Lukas knows. Separate from `status` above, which is
  // where the listing sits in his own pipeline. marketStatusAt is when that
  // status took effect (the contract or closing date), not when it was
  // noticed, and going under contract or closing is what puts the agent on
  // the Follow up page as someone to congratulate.
  // When the nightly check saw it go from under contract / pending back to
  // for sale: the deal fell through (lib/marketStatus.ts). The relaunch moment.
  backOnMarketAt: timestamp("back_on_market_at", { withTimezone: true }),
  marketStatus: text("market_status"),
  marketStatusAt: timestamp("market_status_at", { withTimezone: true }),
  // When the check first saw the listing under contract or sold. Follow up
  // compares his last contact against this rather than marketStatusAt: a text
  // sent after the contract date but before anyone here knew about it wasn't
  // a congratulation.
  marketNoticedAt: timestamp("market_noticed_at", { withTimezone: true }),
  marketCheckedAt: timestamp("market_checked_at", { withTimezone: true }),
});

export type Listing = typeof listings.$inferSelect;
export type NewListing = typeof listings.$inferInsert;

// Standalone agent profiles — both for warning when about to message an agent
// already contacted about a different listing, and as the Agents tab's core
// entity so a relationship can be tracked across multiple
// listings/interactions over time, independent of any one listing.
// Backfilled from every unique phone number seen in listings (see
// ensureAgentsBackfilled in src/app/agents/actions.ts); also created/updated
// lazily whenever a listing's status changes to "contacted" or "declined".
//
// Phone was long treated as the identity here, which it isn't: it's unique
// where present but it's nullable (1,111 of these rows came from a cold-email
// import and have only an email) and it changes. Identity is the id, which
// listings.agentId and message_sends.agentId both point at. Phone and email
// stay UNIQUE as contact details, not as the join key.
export const AGENT_RELATIONSHIP_STATUSES = [
  "cold",
  "warm",
  "interested",
  "worked_once",
  "regular",
  "declined",
] as const;
export type AgentRelationshipStatus = (typeof AGENT_RELATIONSHIP_STATUSES)[number];
export const agentRelationshipStatusEnum = pgEnum(
  "agent_relationship_status",
  AGENT_RELATIONSHIP_STATUSES
);

export const agents = pgTable("agents", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Nullable as of the cold-email feature — an agent found on an external
  // realtor list and emailed cold has no phone at all. At least one of
  // phone/email is enforced at the application layer (importAgent,
  // sendComposeEmail), not by a DB constraint.
  phone: text("phone").unique(),
  email: text("email").unique(),
  name: text("name"),
  lastContactedAt: timestamp("last_contacted_at", { withTimezone: true }),
  lastContactedListingId: uuid("last_contacted_listing_id").references((): AnyPgColumn => listings.id),

  // Manually set/edited by Lukas on the Agents tab — not auto-calculated.
  relationshipStatus: agentRelationshipStatusEnum("relationship_status").notNull().default("cold"),

  // Set when an agent responded and declined/wasn't interested (see
  // touchAgentDeclined in src/app/actions.ts). Drives the Agents tab's
  // separate "declined" section and its 30-day resurface logic — null
  // means the agent isn't currently in that bucket.
  declinedAt: timestamp("declined_at", { withTimezone: true }),

  // Set when the agent used the List-Unsubscribe link in a cold email. Kept
  // deliberately separate from relationshipStatus: declining a listing is a
  // fact about one property, whereas this is "stop emailing me", and folding
  // the two together would let a single no-suppress a contact Lukas still
  // wants to text. Enforced in sendEmail itself rather than at each send site,
  // so no future caller can forget to check it.
  emailUnsubscribedAt: timestamp("email_unsubscribed_at", { withTimezone: true }),

  // Set when Lukas dismisses an agent from the Agents tab's "Follow up"
  // section — resurfacing them there only after ~28 days, independent of
  // the real contact facts. Null means never dismissed / always eligible
  // based on the rest of the criteria.
  followUpDismissedAt: timestamp("follow_up_dismissed_at", { withTimezone: true }),
  // How long that snooze lasts: he picks one, two or four weeks. Null on a
  // snooze from before 2026-10-11, which was always four weeks.
  followUpSnoozedUntil: timestamp("follow_up_snoozed_until", { withTimezone: true }),

  // Free-text, edited from the agent detail dialog — same pattern as
  // listings.notes above.
  notes: text("notes"),

  // Resolved once via Tavily (see findAgentProfileUrl in
  // src/app/agents/actions.ts) and cached here so "Find agent profile"
  // doesn't re-spend a credit/re-pay the lookup latency on every click — an
  // agent's name doesn't change, so the result is good forever once found.
  // Same "leave a miss uncached, only cache a real hit" reasoning as
  // listings.realtorUrl above.
  realtorProfileUrl: text("realtor_profile_url"),

  // Business-volume stats from outside our own data (public realtor
  // history, MLS sites) — entered by hand from the agent edit form, by an
  // MCP call, or backfilled by a separate lookup process. Whole-dollar
  // average, same convention as listings.price.
  avgListingsPerYear: integer("avg_listings_per_year"),
  avgListingPrice: integer("avg_listing_price"),

  // An override for the days-between-listings figure, which is otherwise
  // derived on the fly from our own tracked listings (see
  // averageDaysBetweenListings in src/app/agents/stats.ts) and is null below
  // three of them. Our tracked listings are only the ones a search happened to
  // catch, so for an agent we've seen once or twice the computed number is
  // either missing or misleading while their real cadence is a lookup away on
  // their public profile. A value here is a deliberate statement and wins over
  // the computed one; leave it null to keep using observed data.
  avgDaysBetweenListings: integer("avg_days_between_listings"),

  // Filled by the homes.com profile capture (lib/homesProfile.ts, POST
  // /api/agent-profile-capture): Lukas's Tampermonkey userscript posts the
  // page whenever he visits an agent's homes.com profile (Akamai blocks
  // server-side fetches of the page, so this rides along with his own
  // browsing instead). When present, homesListingsPerYear/homesAvgSalePrice
  // feed avgListingsPerYear/avgListingPrice the same way a hand-entered
  // value would (see resolveAgentVolume in lib/agentBadge.ts) rather than
  // overwrite them, so a deliberate manual entry still wins.
  homesUrl: text("homes_url"),
  homesLicenseId: text("homes_license_id"),
  homesListingsPerYear: integer("homes_listings_per_year"),
  homesAvgSalePrice: integer("homes_avg_sale_price"),
  homesCapturedAt: timestamp("homes_captured_at", { withTimezone: true }),
  // The daily refresh (lib/homesRefresh.ts) stamps every attempt, found or
  // not, so an agent homes.com doesn't list is retried monthly rather than
  // paid for every day. The note says how the last attempt went: "captured",
  // "not found", "ambiguous", or the error. A blocked or failed fetch leaves
  // both alone so it's retried the next day.
  homesCheckedAt: timestamp("homes_checked_at", { withTimezone: true }),
  homesCheckNote: text("homes_check_note"),

  // Where they mostly list: the most common city among their tracked
  // listings, refreshed daily for agents he knows (refreshAgentHomeCities in
  // lib/agentBadge.ts). The location third of the volume/price/location
  // priority, since an agent row has no address of its own.
  homeCity: text("home_city"),

  // The agent's office, typed in by hand. Listings carry their own broker
  // name and that's used when this is empty, but a client met off-Zillow has
  // no listing on file, and their office is what makes "I shot for someone at
  // your brokerage" work (see lib/clientOffices.ts).
  brokerage: text("brokerage"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Agent = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;

// An actual job on the calendar — distinct from a listing (which is just
// property info) because a booking carries logistics a property doesn't
// have: when Lukas needs to be there, who the on-site contact is, what
// services were sold, the lockbox code. listingId is nullable because a
// realtor sometimes books him directly with only partial info (city, date,
// agent, notes) and no tracked Zillow listing at all — address/city/state
// below are only used in that case; when listingId is set, those come from
// the listing instead. A listing can be booked more than once over time
// (reshoots), so this is the many side of a one-to-many with listings — see
// listings.bookingId for the "current" pointer.
export const bookings = pgTable("bookings", {
  id: uuid("id").primaryKey().defaultRandom(),
  listingId: uuid("listing_id").references((): AnyPgColumn => listings.id, { onDelete: "set null" }),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  contactAgentId: uuid("contact_agent_id").references(() => agents.id, { onDelete: "set null" }),

  // The outreach this job traces back to, so a preset variant can be credited
  // with the work it actually won.
  //
  // Revenue attribution previously ran listing -> booking, which only works for
  // a job booked against a tracked property. Every booking so far has been
  // booked directly with an agent and carries no listing, so none of them could
  // be credited to anything — the messaging page's per-variant revenue was
  // structurally always zero. Nullable because plenty of work arrives with no
  // outreach behind it (a referral, a repeat client).
  messageSendId: uuid("message_send_id").references((): AnyPgColumn => messageSends.id, { onDelete: "set null" }),

  jobDate: timestamp("job_date", { withTimezone: true }),
  // The agent has said yes to the job but not to a day: jobDate is a
  // placeholder, or empty. These get their own section on the Booked page so
  // they don't read as scheduled and don't get forgotten. Used to live only as
  // "TENTATIVE" typed into the notes.
  dateTentative: boolean("date_tentative").notNull().default(false),
  lockboxCode: text("lockbox_code"),
  // Internal notes — shown in the app and calendar, never on the invoice.
  notes: text("notes"),
  // Client-facing note printed on the invoice (e.g. "Thanks Kristi!",
  // "25% first-time discount"). Kept separate so internal context can't leak.
  invoiceNote: text("invoice_note"),
  // The final state — the job is done AND paid. Null = still open (either
  // upcoming or waiting for payment, see invoiceSentAt). Set via a "Mark
  // completed" action.
  completedAt: timestamp("completed_at", { withTimezone: true }),
  // Shot, but the photos aren't edited and delivered yet. Set via "Mark shot";
  // the booking sits in "Editing" until the invoice goes out.
  shotAt: timestamp("shot_at", { withTimezone: true }),
  // Set via a "Mark invoice sent" action once the invoice has actually gone
  // out to the client — the booking then sits in "Waiting for payment" until
  // completedAt is set. Distinct from invoicedAt below, which only records
  // that the invoice was generated/viewed in the app, not that it was sent.
  invoiceSentAt: timestamp("invoice_sent_at", { withTimezone: true }),

  // Recorded when a booking is marked completed (see CompleteBookingDialog),
  // so each job's real time is on file for later pricing decisions. All null
  // until then; hours are decimals. Drive time and costs aren't here: they
  // come from the job's trips and expenses (see src/lib/finance), which
  // replaced a typed-in drive_hours and a lump "additional_costs" on
  // 2026-10-16.
  editingHours: real("editing_hours"),
  shootingHours: real("shooting_hours"),
  logisticsHours: real("logistics_hours"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),

  // Assigned once, the first time "Create invoice" is clicked (see
  // getOrAssignInvoiceNumber in src/app/api/bookings/[id]/invoice/route.ts)
  // — null until then. Never reassigned after that, so re-opening/
  // re-printing the same booking's invoice always shows the same number
  // instead of incrementing on every view. Numbering picks up after 105 —
  // everything at or below that was sent by hand, outside the app, and
  // isn't tracked here (106 itself is meant to be recreated as this app's
  // first tracked invoice, not skipped).
  invoiceNumber: integer("invoice_number").unique(),
  invoicedAt: timestamp("invoiced_at", { withTimezone: true }),

  // The Dropbox folder Lukas already drops a shoot's delivered photos into
  // (a normal Dropbox shared-folder link) — set from the booking's detail
  // view. See src/lib/dropbox.ts for how this becomes a live photo grid
  // instead of a bare "here's a Dropbox link" message.
  dropboxFolderLink: text("dropbox_folder_link"),

  // Assigned once, the first time "Get client gallery link" is clicked (see
  // getOrAssignGalleryToken in src/app/booked/actions.ts) — same
  // assign-lazily-never-reassign shape as invoiceNumber above, so
  // re-generating the link never breaks one already sent to a client. An
  // unguessable random string rather than this row's own id, so the
  // client-facing /gallery/[token] URL can't also be used to look up the
  // rest of the booking (line items, lockbox code, notes).
  galleryToken: text("gallery_token").unique(),
  // A second link to the same gallery for people who aren't the client
  // (showing a listing off): no invoice, no payment, no greeting, the first
  // photo as a hero. Its own token so its visits log separately (share_view)
  // and it can't be used to reach the invoice. Assigned on first use.
  shareToken: text("share_token").unique(),
  // Shows "Request virtual staging" on the client gallery — off unless
  // Lukas turns it on for this booking (BookingDetailDialog).
  stagingRequestsEnabled: boolean("staging_requests_enabled").notNull().default(false),

  // The Square copy of this booking's invoice (lib/squareInvoice.ts): same
  // number, line items and note, made when the invoice is created and shown
  // to the client as "Pay Online". squareInvoiceSync fingerprints what it was
  // made from, so a change to the line items or note replaces it before
  // anyone can pay a stale amount.
  squareInvoiceId: text("square_invoice_id"),
  squareInvoiceUrl: text("square_invoice_url"),
  squareInvoiceSync: text("square_invoice_sync"),
  // When the client paid it, from Square (webhook, or the invoice's status
  // when its page is opened). Doesn't complete the booking: that still
  // records the job's hours by hand.
  paidAt: timestamp("paid_at", { withTimezone: true }),

  // Where the home he shot stands on the market — the same nightly check and
  // the same four fields as on listings (see there). Kept on the booking too
  // because a job often has only an address and no tracked listing, and a home
  // going under contract days after his photos went up is the one a client
  // most wants to hear from him about.
  marketStatus: text("market_status"),
  marketStatusAt: timestamp("market_status_at", { withTimezone: true }),
  marketNoticedAt: timestamp("market_noticed_at", { withTimezone: true }),
  marketCheckedAt: timestamp("market_checked_at", { withTimezone: true }),

  // Whether the drone can fly at the address without ATC authorization:
  // Class B/C/D or a Class E surface area needs LAANC or DroneZone first
  // (see src/lib/airspace.ts). Checked after a booking is saved and whenever
  // its address changes. Checked-at set with no result = the check failed.
  airspace: jsonb("airspace").$type<AirspaceCheck>(),
  airspaceCheckedAt: timestamp("airspace_checked_at", { withTimezone: true }),
});

export type Booking = typeof bookings.$inferSelect;
export type NewBooking = typeof bookings.$inferInsert;

/** A booking's drone airspace check — see checkAirspace in src/lib/airspace.ts. */
export interface AirspaceCheck {
  status: "uncontrolled" | "controlled";
  /** The surface airspace the spot is in, highest class first: "Klamath Falls Class D", class "D". Empty when uncontrolled. */
  airspaces: { name: string; class: string }[];
  /** The facility map's ceiling in feet AGL, the most LAANC can approve here. 0 = only through DroneZone. Null outside the grid. */
  ceilingFt: number | null;
  /** Whether the airport takes LAANC requests. Null outside the grid. */
  laanc: boolean | null;
  airport: { name: string; id: string } | null;
  lat: number;
  lng: number;
  /** The street wasn't on the map, so this is the town's center, not the house. */
  approximate: boolean;
  /** The address that was checked, so a later save can tell whether it changed. */
  place: string;
  summary: string;
}

// Every time a client's gallery link is opened or something is downloaded
// from it — shown in the booking's detail dialog. Location comes from
// Vercel's IP geolocation headers, so it's city-level and approximate.
export const GALLERY_EVENTS = ["view", "download_all", "download_video", "invoice_view", "staging_request", "share_view"] as const;
// staging_request: detail is the picked filenames (+ the client note).
export type GalleryEvent = (typeof GALLERY_EVENTS)[number];

export const galleryViews = pgTable("gallery_views", {
  id: uuid("id").primaryKey().defaultRandom(),
  bookingId: uuid("booking_id")
    .notNull()
    .references(() => bookings.id, { onDelete: "cascade" }),
  event: text("event").$type<GalleryEvent>().notNull().default("view"),
  // The video's filename, for download_video.
  detail: text("detail"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  ip: text("ip"),
  city: text("city"),
  region: text("region"),
  country: text("country"),
  userAgent: text("user_agent"),
  referer: text("referer"),
});

export type GalleryView = typeof galleryViews.$inferSelect;

/** One of Lukas's own jobs shown as a "Recent listings" card — prefilled from the booking, then hand-edited. */
export interface PortfolioListing {
  bookingId: string;
  /** "Sold", "Pending", "Just listed" — the badge on the photo. */
  status: string;
  price: string;
  beds: string;
  baths: string;
  sqft: string;
  type: string;
  address: string;
  city: string;
  /** The listing agent and brokerage line under the card. */
  agent: string;
  brokerage: string;
  // Its photos aren't stored: lib/listingCardPhotos.ts picks them from the gallery on each view.
}

/**
 * The settings of one agent page (src/app/portfolio/[slug]) — the portfolio
 * photos, videos and pricing are fixed (lib/agentPage.ts). Every field is
 * optional so older rows still render.
 */
export interface PortfolioContent {
  /** "Eugene", "Roseburg" — the hero's "Real estate photo & video in {area}" and the listings heading. */
  area?: string | null;
  /** Agent's first name for the "Thanks for taking a look, ___" sign-off; blank hides it. */
  agentFirstName?: string | null;
  /** Only used in the prefilled "Book a shoot" text ("this is Sarah with ___"). */
  brokerage?: string | null;
  /** A key of AGENT_PAGE_VIDEOS. */
  video?: string | null;
  /** A key of AGENT_PAGE_PHOTOS, moved to the front of the grid. */
  leadPhoto?: string | null;
  showTourOfHomes?: boolean;
  showOffer?: boolean;
  /** Before/after split at the top (video becomes the second hero). With no beforeSrc, the after photo is shown dulled as a fake "before". */
  beforeAfter?: boolean;
  /** /api/portfolio-image/<id> (an upload) or any image URL. */
  beforeSrc?: string | null;
  afterSrc?: string | null;
  listings?: PortfolioListing[];
  /** The link preview image (og:image), from an area template; none = the lead portfolio photo. */
  ogImage?: string | null;
}

/** What an area template presets in the builder; every field optional = leave the builder's default. */
export type PortfolioTemplateContent = Pick<PortfolioContent, "listings" | "showTourOfHomes" | "showOffer" | "video" | "leadPhoto" | "ogImage">;

// A personalized agent page (/portfolio/[slug], served bare on
// r.lukashahn.media — see proxy.ts) sent in place of the samples email's
// attachment, mainly for cold outreach. agentId is for Lukas's own tracking
// (which push notification to send, and whose name to show him); the page
// only shows the first name he typed into the content, if any.
export const portfolioLinks = pgTable("portfolio_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Short and unrelated to any token format elsewhere (bookings.galleryToken
  // is 32 chars) so the two can be told apart by length alone where that
  // matters (proxy.ts tries this table only when a bare path is too short
  // to be a gallery token).
  slug: text("slug").notNull().unique(),
  agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
  content: jsonb("content").$type<PortfolioContent>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  viewCount: integer("view_count").notNull().default(0),
  firstViewedAt: timestamp("first_viewed_at", { withTimezone: true }),
  lastViewedAt: timestamp("last_viewed_at", { withTimezone: true }),
});

// Sent as Postgres hex text ("\\x89504e..."): the neon-http driver posts
// parameters as JSON, where a raw Buffer wouldn't survive.
const bytea = customType<{ data: Buffer; driverData: string }>({
  dataType: () => "bytea",
  toDriver: (value) => `\\x${value.toString("hex")}`,
  fromDriver: (value: unknown) =>
    typeof value === "string"
      ? Buffer.from(value.startsWith("\\x") ? value.slice(2) : value, "hex")
      : Buffer.from(value as Uint8Array),
});

// Before/after photos uploaded in the agent page builder, served publicly by
// id at /api/portfolio-image/[id]. Shrunk in the browser before upload. In
// the database like receipts, since there's no blob store in this app.
export const portfolioImages = pgTable("portfolio_images", {
  id: uuid("id").primaryKey().defaultRandom(),
  mimeType: text("mime_type").notNull(),
  data: bytea("data").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// One visit to an agent page: a page load, keyed by an id the browser makes
// up, so its running totals (time, scroll, sections) can be re-sent and
// overwritten as the visit goes on. Location from Vercel's IP headers,
// city-level, same as galleryViews.
export const portfolioSessions = pgTable("portfolio_sessions", {
  id: uuid("id").primaryKey(),
  linkId: uuid("link_id")
    .notNull()
    .references(() => portfolioLinks.id, { onDelete: "cascade" }),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  // Seconds the tab was actually visible, not wall time since opening.
  activeSeconds: integer("active_seconds").notNull().default(0),
  maxScrollPct: integer("max_scroll_pct").notNull().default(0),
  // Seconds each section (hero, video, pricing, …) spent in the middle of the screen.
  sectionSeconds: jsonb("section_seconds").$type<Record<string, number>>().notNull().default({}),
  // "390x844" — tells a phone from a laptop when the user agent doesn't.
  screen: text("screen"),
  ip: text("ip"),
  city: text("city"),
  region: text("region"),
  country: text("country"),
  userAgent: text("user_agent"),
  referer: text("referer"),
});

export type PortfolioSession = typeof portfolioSessions.$inferSelect;

// Every tap on an agent page: Save contact, Book a shoot, Sound on, a listing
// carousel arrow… event is the PORTFOLIO_EVENTS key, detail says which one
// (where on the page, which listing).
export const PORTFOLIO_EVENTS = ["save_contact", "book_shoot", "sound_on", "sound_off", "listing_prev", "listing_next", "reviews"] as const;
export type PortfolioEvent = (typeof PORTFOLIO_EVENTS)[number];

export const portfolioEvents = pgTable("portfolio_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id")
    .notNull()
    .references(() => portfolioSessions.id, { onDelete: "cascade" }),
  linkId: uuid("link_id")
    .notNull()
    .references(() => portfolioLinks.id, { onDelete: "cascade" }),
  event: text("event").$type<PortfolioEvent>().notNull(),
  detail: text("detail"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});

// A photo of a town (a drone shot of Roseburg…) used as an agent page's link
// preview when the page has no before/after of its own: matched on the page's
// area, case-insensitively. Set on /portfolio-links/settings.
export const portfolioTownImages = pgTable("portfolio_town_images", {
  // Lowercased and trimmed, the way it's matched.
  town: text("town").primaryKey(),
  // As typed, for showing.
  label: text("label").notNull(),
  // /api/portfolio-image/<id>, like a before/after.
  imageSrc: text("image_src").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Area defaults for the portfolio link builder: when the picked agent's area
// is one of `towns` (lowercased, trimmed), the builder starts from this
// template's listings, toggles and preview image instead of its own defaults.
// Set on /portfolio-links/settings.
export const portfolioTemplates = pgTable("portfolio_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  towns: text("towns").array().notNull().default(sql`'{}'::text[]`),
  content: jsonb("content").$type<PortfolioTemplateContent>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PortfolioTemplate = typeof portfolioTemplates.$inferSelect;

export type PortfolioLink = typeof portfolioLinks.$inferSelect;
export type NewPortfolioLink = typeof portfolioLinks.$inferInsert;

// Price/services as line items rather than a flat number, so this can
// eventually generate real invoices — a line item like "Twilight shoot —
// $100" answers both "what did I charge" and "what did I do" at once. A
// booking's total is sum(amount), computed on read, never stored.
export const bookingLineItems = pgTable("booking_line_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  bookingId: uuid("booking_id")
    .notNull()
    .references(() => bookings.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  amount: integer("amount").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type BookingLineItem = typeof bookingLineItems.$inferSelect;
export type NewBookingLineItem = typeof bookingLineItems.$inferInsert;

// Things for Lukas to do on a given day — "they said call Tuesday" — shown
// on the Schedule page alongside bookings (jobDate) and listing follow-ups
// (listings.followUpAt). date/time are plain wall-clock Pacific values
// ("2026-09-30", "14:30"), not timestamps: a reminder is "Tuesday", not an
// instant, so storing it as a calendar day keeps it from sliding a day when
// rendered on a UTC server. time null = an all-day item.
export const reminders = pgTable("reminders", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  date: date("date", { mode: "string" }).notNull(),
  time: text("time"),
  durationMinutes: integer("duration_minutes"),
  notes: text("notes"),
  agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
  // Optional job this reminder is about — "call the photographer about the
  // 3pm shoot" is really about a booking. Set null rather than cascading so
  // deleting a booking can't silently delete the reminder, and so a reminder
  // can be about a booking that no longer exists without the text in it
  // (title/notes) going away.
  bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "set null" }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Reminder = typeof reminders.$inferSelect;
export type NewReminder = typeof reminders.$inferInsert;

// One row per search area — each is fetched independently on every
// sync/refresh (its own Zillapi call, its own bbox/filters). Lets Lukas
// search e.g. Eugene and Roseburg at once instead of being locked to one
// area via env vars. Disabled sources are skipped by the sync but kept
// around instead of deleted.
export const searchSources = pgTable("search_sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  // "west,south,east,north" decimal lon/lat — same format as the old
  // SEARCH_BBOX env var, and what fetchNewListings sends straight to
  // Zillapi's bbox query param.
  bbox: text("bbox").notNull(),
  priceMin: integer("price_min"),
  priceMax: integer("price_max"),
  // Comma-separated Zillapi home_types values (house,condo,townhouse,
  // multi_family,manufactured,lot,apartment), null = no filter.
  homeTypes: text("home_types"),
  // Only Zillow "Coming soon" listings — not a Zillapi filter, so a source
  // with this (or keywords) is fetched through a built zillow.com search URL
  // instead; see fetchNewListings. Lets a far/busy market like Portland be
  // searched just for the listings that haven't been photographed yet.
  comingSoonOnly: boolean("coming_soon_only").notNull().default(false),
  // Zillow's listing-description keyword filter. Semicolon-separated phrases,
  // each its own search (e.g. "photos coming; more photos"); within a phrase
  // every word must appear, anywhere in the description.
  keywords: text("keywords"),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SearchSource = typeof searchSources.$inferSelect;
export type NewSearchSource = typeof searchSources.$inferInsert;

// Single-row table of user-editable app settings — always read/written
// against the fixed "singleton" id instead of tracking a row id elsewhere.
// See src/lib/settings.ts.
export const appSettings = pgTable("app_settings", {
  id: text("id").primaryKey().default("singleton"),
  followUpAfterDays: integer("follow_up_after_days").notNull().default(3),

  // Where drive-time estimates on the Booked page start from (see
  // src/lib/driveTime.ts) — a free, no-API haversine-distance guess against
  // a hardcoded table of Oregon city coordinates, not real routing.
  homeCity: text("home_city").notNull().default("Winston"),
  homeState: text("home_state").notNull().default("OR"),

  // Finances (see src/lib/finance). The car's average fuel economy, for a
  // trip's gas cost, and what the other jobs pay a month, which sets the tax
  // bracket the business's profit lands in.
  vehicleMpg: real("vehicle_mpg").notNull().default(20),
  otherWagesMonthly: integer("other_wages_monthly").notNull().default(0),
});

export type AppSettings = typeof appSettings.$inferSelect;

// Sending accounts for outbound email. The app sends from exactly one of these
// at a time (isDefault), but old ones stay configured rather than being
// deleted: switching is a single click, and a provider that starts getting our
// cold email flagged isn't a fire drill. Add Gmail, flip the switch, and iCloud
// is still there for the days a separate domain is the better sender.
//
// Until the first row exists, lib/emailAccounts.ts falls back to the old
// ICLOUD_EMAIL/ICLOUD_APP_PASSWORD env vars, so this table can be empty in an
// environment that still sends fine.
export const emailAccounts = pgTable("email_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  // What the settings list shows — "Gmail", "iCloud", not the bare address.
  label: text("label").notNull(),
  // The From address. Both providers require From == the authenticated
  // account (Apple rejects it outright; Gmail rejects unverified aliases), so
  // this is the login and the visible sender.
  email: text("email").notNull(),
  // The person's name to put in front of the address in the From header —
  // "Lukas Hahn <lukas@lukashahn.media>". Without it a recipient's mail app
  // shows the bare address, which reads as no-reply to an agent deciding
  // whether to engage. Null = bare address.
  fromName: text("from_name"),
  smtpHost: text("smtp_host").notNull(),
  smtpPort: integer("smtp_port").notNull().default(587),
  // Implicit TLS on the connection (port 465) rather than STARTTLS (587).
  smtpSecure: boolean("smtp_secure").notNull().default(false),
  // AES-256-GCM ciphertext, never plaintext — the app password is a live
  // credential for a real mailbox. See src/lib/secretBox.ts.
  passwordEnc: text("password_enc").notNull(),
  // Optional. SMTP only transmits, it never touches the mailbox, so without an
  // IMAP append a message sent from here never appears in the provider's own
  // Sent folder. Null = skip the Sent copy (mail still sends).
  imapHost: text("imap_host"),
  imapPort: integer("imap_port"),
  // Overridable only because a few providers authenticate IMAP as a different
  // address than SMTP; null means "same as email".
  imapUser: text("imap_user"),
  isDefault: boolean("is_default").notNull().default(false),
  // Last result of the settings page's "Send test" — a wrong app password is
  // only discoverable by trying it, and the failure text is the whole answer.
  lastTestedAt: timestamp("last_tested_at", { withTimezone: true }),
  lastTestError: text("last_test_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type EmailAccount = typeof emailAccounts.$inferSelect;
export type NewEmailAccount = typeof emailAccounts.$inferInsert;

// Which send-moment a preset applies to — mirrors the initial-outreach vs.
// follow-up split that already exists in the LeadActions/PipelineActions UI.
export const PRESET_TYPES = ["initial_outreach", "follow_up"] as const;
export type PresetType = (typeof PRESET_TYPES)[number];
export const presetTypeEnum = pgEnum("preset_type", PRESET_TYPES);

// SMS (texted, tied to a listing) vs email (sent via SMTP, often to a
// realtor with no listing at all — see the cold-email Compose flow). Lives
// on the preset rather than the variant since a preset is one coherent
// channel — mixing sms/email variants within one preset would break the
// existing "one preset = one thing being A/B tested" shape.
export const MESSAGE_CHANNELS = ["sms", "email"] as const;
export type MessageChannel = (typeof MESSAGE_CHANNELS)[number];
export const messageChannelEnum = pgEnum("message_channel", MESSAGE_CHANNELS);

export const MESSAGE_RESULTS = ["pending", "quoted", "booked", "declined"] as const;
export type MessageResult = (typeof MESSAGE_RESULTS)[number];
export const messageResultEnum = pgEnum("message_result", MESSAGE_RESULTS);

export const messagePresets = pgTable("message_presets", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  type: presetTypeEnum("type").notNull(),
  channel: messageChannelEnum("channel").notNull().default("sms"),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),

  // Set when a preset with send history is "deleted" from the Messaging
  // page. It's hidden there instead of removed, because its message_sends
  // rows are often the only record that those agents were contacted —
  // deleting them would let the app treat those agents as never contacted.
  archivedAt: timestamp("archived_at", { withTimezone: true }),

  // Targeting criteria for auto-recommending this preset in the Send
  // message dialog — all nullable, null meaning "no constraint on this
  // dimension". A listing must satisfy every criterion a preset actually
  // sets to be eligible; among eligible presets the one with the most
  // criteria set (most specific) is recommended. See scorePresetMatch in
  // src/app/messageActions.ts.
  minScore: integer("min_score"),
  maxScore: integer("max_score"),
  minPrice: integer("min_price"),
  maxPrice: integer("max_price"),
  maxListingAgeDays: integer("max_listing_age_days"),
  minPhotoCount: integer("min_photo_count"),
  maxPhotoCount: integer("max_photo_count"),
  // Restrict to one Leads-page section (photo / video / backup / unlikely).
  // The only criterion that can talk about intent rather than measurements,
  // and the reason the AI-draft preset can be recommended for exactly the
  // listings whose photos are weak.
  leadSection: text("lead_section"),
  // true = only coming soon listings, false = only ones already on the
  // market, null = either. Lets a "Coming Soon" template outrank a general
  // photo-section one for the listings it was written for.
  comingSoon: boolean("coming_soon"),
  // true = only listings that are "sitting" (a price cut in the last 30 days,
  // or 30+ days on the market), false = only fresh ones, null = either. The
  // AI draft takes the sitting ones, since it can mention the cut or the time
  // on market and a fixed template can't.
  sitting: boolean("sitting"),
  // A template written around a client in the agent's office ("I recently did
  // some work for {{officeClient}}"). Only offered, and always recommended,
  // for a lead whose agent is in the same office as a client (see
  // lib/clientOffices.ts); never for anyone else, since the line would be false.
  sameOffice: boolean("same_office").notNull().default(false),

  // Marks the one system preset per type whose "variants" aren't
  // hand-written — each is drafted live per listing by draftMessage() (see
  // src/lib/draftMessage.ts), using that listing's photo score, details,
  // and the agent's profile/relationship status, then only persisted (as a
  // real messagePresetVariants row) at the moment it's actually sent. Not
  // user-creatable; ignored by the criteria-matching recommendation logic
  // since it's always the recommended default when enabled. See
  // ensureAiDraftPresets in src/app/messageActions.ts.
  aiGenerated: boolean("ai_generated").notNull().default(false),

  // Files sent with every message from this preset: a pricing sheet or
  // portfolio samples on an email, a vCard or photos on a text. A text's only
  // go out from the iPhone app, since the web can do no more than open an
  // sms: link, which can't carry a file. The
  // bytes live right here (base64, see encodeAttachment in
  // src/lib/attachments.ts), not in external storage — every send (bulk or
  // single) reads this same row, so nothing ever re-fetches the file over
  // the network. That used to go through Vercel Blob keyed by URL, which
  // meant nodemailer's per-recipient href fetch re-downloaded the same file
  // from Blob on every single send; storing the bytes inline removes that
  // entirely. Uploaded/removed from the preset's own management UI rather
  // than re-attached per send, since the whole point of the Compose flow is
  // ~2 seconds per realtor.
  attachments: jsonb("attachments").$type<PresetAttachment[]>().notNull().default([]),

  // Marks a preset the delete button refuses to touch regardless of send
  // history — used for the seeded "Blank" email preset (see
  // ensureBlankEmailPreset in composeEmailActions.ts), which should always
  // be available as a scaffold even with zero sends. Unlike aiGenerated,
  // the variant body/subject stays fully user-editable.
  protected: boolean("protected").notNull().default(false),

  // Whether a send from this preset pursues the listing itself (Coming Soon,
  // Bad Photos, video: the listing goes to the Pipeline as "contacted") or
  // just uses it as the reason to text the agent about Lukas (Backup Option:
  // the listing goes to "outreach" and stays out of the Pipeline).
  pitchesListing: boolean("pitches_listing").notNull().default(true),

  // SMS only. A short second text sent right after this one, by hand: tapping
  // Send copies it to the clipboard on the way into Messages, so it's one
  // paste. "Mind if I send over a few samples…" on the outreach templates.
  secondMessage: text("second_message"),
  // SMS only. The email the message detail's "Send samples" button sends when
  // someone replies to a text from this preset (see
  // src/app/messaging/replyActions.ts).
  //
  // Superseded on 2026-10-10 by quickActionPresetIds below, which was filled
  // from it. No longer read; kept so a schema push doesn't drop the column.
  followUpEmailPresetId: uuid("follow_up_email_preset_id").references((): AnyPgColumn => messagePresets.id, {
    onDelete: "set null",
  }),

  // The templates offered as one-tap buttons on a message sent from this one,
  // in the order shown: "Send samples" (an email), "Photo samples" and "Send
  // contact" (texts with attachments). An email one is sent by the server; a
  // text one opens Messages on the phone, attachments and all. Ids of other
  // presets, kept as a list rather than a join table because the order matters
  // and there are only ever a handful. See lib/quickActions.ts.
  quickActionPresetIds: jsonb("quick_action_preset_ids").$type<string[]>().notNull().default([]),
  // A template that exists only to be one of those buttons (the vCard, the
  // photo samples): left out of the send dialogs, where it would never be the
  // right first thing to say.
  quickActionOnly: boolean("quick_action_only").notNull().default(false),
});

export interface PresetAttachment {
  id: string;
  filename: string;
  content: string; // base64-encoded file bytes
  /** Set on upload since 2026-10-10; older ones are worked out from the filename. */
  contentType?: string;
}

/**
 * What an email variant does with the photos attached to its template:
 * "inline" shows them in the body where it says {{photos}}, "omit" leaves them
 * off (the plain version of the same email). `dropAttachments` are other files
 * on the template to leave off, by filename. A variant with none of this
 * attaches everything, photos included, like any email.
 */
export interface VariantInlinePhotos {
  place: "inline" | "omit";
  dropAttachments?: string[];
}

export type MessagePreset = typeof messagePresets.$inferSelect;
export type NewMessagePreset = typeof messagePresets.$inferInsert;

// A/B variants of a preset. body supports {{firstName}} / {{street}}
// placeholders — see renderMessageBody in src/lib/messageTemplate.ts.
export const messagePresetVariants = pgTable("message_preset_variants", {
  id: uuid("id").primaryKey().defaultRandom(),
  presetId: uuid("preset_id")
    .notNull()
    .references(() => messagePresets.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  // Only used (and required, enforced in createVariant/updateVariant) when
  // the parent preset's channel is "email" — sms has no subject line.
  subject: text("subject"),
  body: text("body").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // Email only, and the one case where an email isn't plain text: see
  // VariantInlinePhotos and lib/emailPhotos.ts. Null for every other variant.
  inlinePhotos: jsonb("inline_photos").$type<VariantInlinePhotos>(),
});

export type MessagePresetVariant = typeof messagePresetVariants.$inferSelect;
export type NewMessagePresetVariant = typeof messagePresetVariants.$inferInsert;

// One row per actual text sent — the append-only log the A/B stats are
// built from. respondedAt and result are independent: respondedAt is a
// fact set once, the first time the agent replies; result reflects the
// send's current outcome and is always overwritable (so "replied, then
// declined" — or "replied, then booked" — is captured correctly instead of
// getting stuck on whichever transition happened first). See
// resolveSendOutcome in src/app/actions.ts.
export const messageSends = pgTable("message_sends", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Nullable as of the cold-email feature — a cold-emailed realtor found on
  // an external list has no listing at all. Which agent got the message is
  // tracked via agentId below instead (previously only derivable by joining
  // through listingId -> listings.agentPhone, which breaks once listingId
  // can be null).
  listingId: uuid("listing_id").references(() => listings.id, { onDelete: "cascade" }),
  agentId: uuid("agent_id").references((): AnyPgColumn => agents.id, { onDelete: "set null" }),
  presetId: uuid("preset_id")
    .notNull()
    .references(() => messagePresets.id),
  variantId: uuid("variant_id")
    .notNull()
    .references(() => messagePresetVariants.id),
  type: presetTypeEnum("type").notNull(),
  // Denormalized from the preset, same pattern `type` already uses.
  channel: messageChannelEnum("channel").notNull().default("sms"),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  respondedAt: timestamp("responded_at", { withTimezone: true }),
  result: messageResultEnum("result").notNull().default("pending"),
  // What actually went out, edits included, and the name it greeted. The
  // linked agent can be someone else on the same number (a team line), so
  // re-rendering the template with agents.name could show the wrong person.
  // Null on rows from before 2026-10-19, which fall back to re-rendering.
  body: text("body"),
  recipientName: text("recipient_name"),
});

export type MessageSend = typeof messageSends.$inferSelect;
export type NewMessageSend = typeof messageSends.$inferInsert;

// One row per subscribed device (the iOS PWA install, a desktop browser,
// etc) — endpoint is the browser-assigned push URL and is unique per
// device/install, so re-subscribing (e.g. after reinstalling the PWA)
// just upserts. See src/lib/push.ts for how these get used.
export const pushSubscriptions = pgTable("push_subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;
export type NewPushSubscription = typeof pushSubscriptions.$inferInsert;

// Every touch with an agent that isn't a templated send: calls either way,
// texts and emails that happened outside the app, someone getting back to you.
//
// Deliberately separate from messageSends rather than folded into it.
// messageSends requires presetId/variantId because its whole job is per-variant
// A/B attribution; a "they called me" has no preset, so putting it there would
// mean nullable attribution columns (weakening the stats) or inventing preset
// rows. The two are merged at read time into one timeline instead — see
// getAgentTimeline.
export const INTERACTION_CHANNELS = ["call", "text", "email", "in_person", "other"] as const;
export type InteractionChannel = (typeof INTERACTION_CHANNELS)[number];
export const interactionChannelEnum = pgEnum("interaction_channel", INTERACTION_CHANNELS);

export const INTERACTION_DIRECTIONS = ["outbound", "inbound"] as const;
export type InteractionDirection = (typeof INTERACTION_DIRECTIONS)[number];
export const interactionDirectionEnum = pgEnum("interaction_direction", INTERACTION_DIRECTIONS);

// Stored as channel x direction x outcome rather than a flat list of a dozen
// values ("called them, no answer"), so a question like "how many calls did I
// make this month" is a filter instead of string-matching enum names. The UI
// still offers the flat phrasing.
export const INTERACTION_OUTCOMES = ["answered", "no_answer", "voicemail", "sent", "not_sent"] as const;
export type InteractionOutcome = (typeof INTERACTION_OUTCOMES)[number];
export const interactionOutcomeEnum = pgEnum("interaction_outcome", INTERACTION_OUTCOMES);

export const agentInteractions = pgTable("agent_interactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentId: uuid("agent_id")
    .notNull()
    .references(() => agents.id, { onDelete: "cascade" }),
  // Which property the touch was about, when it was about one at all — a call
  // out of the blue isn't tied to a listing.
  listingId: uuid("listing_id").references((): AnyPgColumn => listings.id, { onDelete: "set null" }),

  channel: interactionChannelEnum("channel").notNull(),
  direction: interactionDirectionEnum("direction").notNull(),
  // Null means unknown or not applicable — an email doesn't have an outcome the
  // way a call does.
  outcome: interactionOutcomeEnum("outcome"),
  // Which Follow up feed the text or call was started from ("relaunch",
  // "twilight_gift", …; FollowUpFeedKey), so each feed's reply rate can be
  // measured and the ones that don't work cut. Null when it wasn't one.
  followUpFeed: text("follow_up_feed"),
  note: text("note"),

  // When it actually happened, which is not necessarily when it was recorded:
  // the Add-interaction form can backdate a call from yesterday.
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),

  // Set when the app started this interaction but can't know how it went. The
  // Call button hands off to the phone dialer and the text button to Messages,
  // so at tap time there's no way to tell whether they picked up or whether the
  // text was ever actually sent. Rather than assert an outcome that might be
  // false, the row is parked here and the app asks on the way back in. Cleared
  // once answered or skipped.
  pendingSince: timestamp("pending_since", { withTimezone: true }),

  // The optimistic send this interaction is asking about, so resolving a text
  // as "didn't send" can remove a send that never happened instead of leaving
  // it inflating the variant's numbers.
  messageSendId: uuid("message_send_id").references(() => messageSends.id, { onDelete: "set null" }),

  // The listing status at the moment this interaction was started, captured
  // before the app optimistically advanced it. A "no, I didn't send it" answer
  // has to put the listing back exactly where it came from: an
  // initial_outreach can be sent from "new" (the leads page) or "saved" (the
  // pipeline's saved row), and restoring a hardcoded "new" dropped a triaged
  // lead back onto the leads queue as if it had never been touched.
  listingStatusBefore: text("listing_status_before"),

  // "app" = recorded automatically from an action in the app, "manual" = typed
  // in afterwards, "backfill" = reconstructed in bulk from older evidence
  // (inbox replies, an agent's notes) by scripts/backfill-interactions.mjs.
  // Worth distinguishing: one is observed, the others are remembered or
  // inferred, and a backfilled row is the weakest of the three.
  source: text("source").notNull().default("manual"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AgentInteraction = typeof agentInteractions.$inferSelect;
export type NewAgentInteraction = typeof agentInteractions.$inferInsert;

// Messages written ahead of time and sent later — a batch of listing texts
// to work through, or an email that shouldn't go out the instant someone
// replies. Channel-agnostic: each row is a text or an email. Nothing here
// sends on its own; every row goes out from the Queue page's Send button,
// which hands off to the same send actions the rest of the app uses (so the
// send lands in message_sends and contact history exactly like any other).
// Queued rows show in the agent's contact history as scheduled, but don't
// count as contact for the Already-contacted badge until actually sent.
export const QUEUED_MESSAGE_STATUSES = ["queued", "sent", "skipped"] as const;
export type QueuedMessageStatus = (typeof QUEUED_MESSAGE_STATUSES)[number];
export const queuedMessageStatusEnum = pgEnum("queued_message_status", QUEUED_MESSAGE_STATUSES);

export const queuedMessages = pgTable("queued_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentId: uuid("agent_id")
    .notNull()
    .references(() => agents.id, { onDelete: "cascade" }),
  listingId: uuid("listing_id").references((): AnyPgColumn => listings.id, { onDelete: "cascade" }),
  channel: messageChannelEnum("channel").notNull(),
  type: presetTypeEnum("type").notNull().default("initial_outreach"),
  // Attribution for the send this becomes. A null variantId means an AI
  // draft, materialized into a variant at send time like any other.
  presetId: uuid("preset_id").references(() => messagePresets.id, { onDelete: "set null" }),
  variantId: uuid("variant_id").references(() => messagePresetVariants.id, { onDelete: "set null" }),
  subject: text("subject"),
  body: text("body").notNull(),
  // AI-drafted rows are queued before their draft exists: "pending" until
  // the draft is written into body/subject (src/lib/queueMessages.ts), or
  // "failed" if drafting errored. Neither can be sent. Null = ready.
  draftStatus: text("draft_status"),
  // Optional steering for the AI draft ("mention the price cut").
  draftInstruction: text("draft_instruction"),
  // Overrides the agent's phone/email on file, when set.
  recipient: text("recipient"),
  // Earliest it should go out. Sends are further held to 8 AM–9 PM Pacific
  // (see src/lib/queue.ts).
  sendAfter: timestamp("send_after", { withTimezone: true }).notNull().defaultNow(),
  // A chained step: waits for this other queued message to be sent, then
  // becomes due delayMinutes after that actual send.
  afterQueuedId: uuid("after_queued_id").references((): AnyPgColumn => queuedMessages.id, { onDelete: "set null" }),
  delayMinutes: integer("delay_minutes"),
  status: queuedMessageStatusEnum("status").notNull().default("queued"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  // The pending "did it send?" interaction a text handoff created — so
  // answering "didn't send" puts this row back in the queue.
  interactionId: uuid("interaction_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type QueuedMessage = typeof queuedMessages.$inferSelect;

// ---------------------------------------------------------------------------
// Finances: what the business spends and drives. Revenue stays on bookings
// (line items); these are the other side of the ledger. The math that joins
// them lives in src/lib/finance.

// One drive, not one booking: a day trip to Klamath Falls for two jobs is one
// trip, and so is a drive to drop flash drives off for an agent, which has no
// booking at all. Each row is a line of the IRS mileage log: date, where,
// why, how far.
export const trips = pgTable("trips", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Wall-clock Pacific date ("2026-10-15"), like reminders.date.
  date: date("date", { mode: "string" }).notNull(),
  // The business purpose, as the mileage log reads it.
  purpose: text("purpose").notNull(),
  // TRIP_CATEGORIES in src/lib/finance/categories.ts.
  category: text("category").notNull().default("shoot"),
  // The stops, one per line, not counting home at either end.
  stops: text("stops"),
  miles: real("miles").notNull(),
  driveMinutes: integer("drive_minutes"),
  // The miles came from a route estimate rather than the odometer or Lukas.
  milesEstimated: boolean("miles_estimated").notNull().default(false),
  agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Trip = typeof trips.$inferSelect;
export type NewTrip = typeof trips.$inferInsert;

// The jobs a trip was for. A trip's miles, gas and drive time are split
// across them by revenue (see allocateTrip).
export const tripBookings = pgTable(
  "trip_bookings",
  {
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.tripId, t.bookingId] })]
);

export const expenses = pgTable("expenses", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Wall-clock Pacific date of the charge.
  date: date("date", { mode: "string" }).notNull(),
  // Cents: receipts aren't whole dollars the way line items are.
  amountCents: integer("amount_cents").notNull(),
  vendor: text("vendor"),
  description: text("description").notNull(),
  // EXPENSE_CATEGORIES in src/lib/finance/categories.ts.
  category: text("category").notNull(),
  // How much of it is a tax deduction: 100, 50 (a client meal) or 0 (gas and
  // car washes, which the standard mileage rate already covers; personal
  // spending; a meal alone on a day trip).
  deductiblePercent: integer("deductible_percent").notNull().default(100),
  // Gas only. pricePerGallon prices every trip until the next fill-up.
  gallons: real("gallons"),
  pricePerGallon: real("price_per_gallon"),
  // Paid on a personal card for the business.
  paidPersonally: boolean("paid_personally").notNull().default(false),
  // A yearly charge (Upbeat, ZillAPI) is spread over this many months in the
  // monthly view, starting the month it was paid. Taxes count it when paid.
  spreadMonths: integer("spread_months").notNull().default(1),
  bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "set null" }),
  tripId: uuid("trip_id").references(() => trips.id, { onDelete: "set null" }),
  // The paper trail's number, continuing the finances repo's 101, 102, ...
  receiptNumber: integer("receipt_number").unique(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Expense = typeof expenses.$inferSelect;
export type NewExpense = typeof expenses.$inferInsert;

// The receipt itself, kept out of the expenses row so listing expenses never
// drags the bytes along. Photos are shrunk before they get here. In the
// database rather than a public bucket because receipts show card digits.
export const receipts = pgTable("receipts", {
  id: uuid("id").primaryKey().defaultRandom(),
  expenseId: uuid("expense_id")
    .notNull()
    .unique()
    .references(() => expenses.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull(),
  data: bytea("data").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
