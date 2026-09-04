import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  numeric,
  timestamp,
  boolean,
} from "drizzle-orm/pg-core";

export const LEAD_STATUSES = [
  "new",
  "saved",
  "contacted",
  "replied",
  "quoted",
  "booked",
  "declined",
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const leadStatusEnum = pgEnum("lead_status", LEAD_STATUSES);

export const listings = pgTable("listings", {
  id: uuid("id").primaryKey().defaultRandom(),
  zpid: text("zpid").notNull().unique(),
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
  brokerName: text("broker_name"),

  // From Zillapi's GET /v1/properties/{zpid} full details — 1 credit per
  // call (verified via the x-credits-charged response header, even on a
  // repeat call for the same zpid minutes later — the docs' "0 credits on
  // a cache hit" claim didn't hold up). NOT the dedicated /agent
  // sub-resource, which also costs 1 credit and, verified against real
  // listings, never actually returns a phone number despite its docs
  // claiming it does. Fetched once per newly-inserted lead.
  agentName: text("agent_name"),
  agentPhone: text("agent_phone"),

  // Lead pipeline: new -> saved -> contacted -> replied -> quoted -> booked,
  // with declined reachable from anywhere (quoted is optional — replied can
  // go straight to booked for an instant close). contactedAt drives
  // follow-up flagging (see FOLLOW_UP_AFTER_DAYS in src/app/pipeline/page.tsx).
  // statusChangedAt updates on every transition (contactedAt only on ones
  // into "contacted") — used to sort the pipeline page by how long a
  // listing has sat in its current state.
  status: leadStatusEnum("status").notNull().default("new"),
  contactedAt: timestamp("contacted_at", { withTimezone: true }),
  statusChangedAt: timestamp("status_changed_at", { withTimezone: true }),

  // Job $ value, entered (optionally) when marking a listing "booked" — the
  // seed data for revenue-per-preset/variant math on the presets page.
  bookingValue: integer("booking_value"),

  // AI photo-quality score (1-10, higher = more clearly professional
  // photography) from gpt-4o-mini vision, scored once per newly-inserted
  // lead in the sync route. See src/lib/photoScore.ts for the rubric. A
  // LOW score is the valuable lead here — it means the listing likely
  // doesn't have a pro photographer yet.
  score: integer("score"),
  scoreReasoning: text("score_reasoning"),

  // Free-text, edited from the listing detail modal.
  notes: text("notes"),

  // Which source found this listing — a search source's name (e.g.
  // "Eugene") or "Zillow email alert". Set once at insert time, shown in
  // the listing detail modal.
  sourceLabel: text("source_label"),
});

export type Listing = typeof listings.$inferSelect;
export type NewListing = typeof listings.$inferInsert;

// Standalone agent profiles, keyed by phone (the one reliably-unique agent
// identifier available) — both for warning when about to message an agent
// already contacted about a different listing, and as the Agents tab's
// core entity so a relationship can be tracked across multiple
// listings/interactions over time, independent of any one listing.
// Backfilled from every unique phone number seen in listings (see
// ensureAgentsBackfilled in src/app/agents/actions.ts); also
// created/updated lazily whenever a listing's status changes to
// "contacted" or "declined".
export const AGENT_RELATIONSHIP_STATUSES = [
  "cold",
  "warm",
  "interested",
  "worked_once",
  "regular",
] as const;
export type AgentRelationshipStatus = (typeof AGENT_RELATIONSHIP_STATUSES)[number];
export const agentRelationshipStatusEnum = pgEnum(
  "agent_relationship_status",
  AGENT_RELATIONSHIP_STATUSES
);

export const agents = pgTable("agents", {
  id: uuid("id").primaryKey().defaultRandom(),
  phone: text("phone").notNull().unique(),
  name: text("name"),
  lastContactedAt: timestamp("last_contacted_at", { withTimezone: true }),
  lastContactedListingId: uuid("last_contacted_listing_id").references(() => listings.id),

  // Manually set/edited by Lukas on the Agents tab — not auto-calculated.
  relationshipStatus: agentRelationshipStatusEnum("relationship_status").notNull().default("cold"),

  // Set when an agent responded and declined/wasn't interested (see
  // touchAgentDeclined in src/app/actions.ts). Drives the Agents tab's
  // separate "declined" section and its 30-day resurface logic — null
  // means the agent isn't currently in that bucket.
  declinedAt: timestamp("declined_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Agent = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;

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
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SearchSource = typeof searchSources.$inferSelect;
export type NewSearchSource = typeof searchSources.$inferInsert;

// Which send-moment a preset applies to — mirrors the initial-outreach vs.
// follow-up split that already exists in the LeadActions/PipelineActions UI.
export const PRESET_TYPES = ["initial_outreach", "follow_up"] as const;
export type PresetType = (typeof PRESET_TYPES)[number];
export const presetTypeEnum = pgEnum("preset_type", PRESET_TYPES);

export const MESSAGE_RESULTS = ["pending", "quoted", "booked", "declined"] as const;
export type MessageResult = (typeof MESSAGE_RESULTS)[number];
export const messageResultEnum = pgEnum("message_result", MESSAGE_RESULTS);

export const messagePresets = pgTable("message_presets", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  type: presetTypeEnum("type").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),

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
});

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
  body: text("body").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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
  listingId: uuid("listing_id")
    .notNull()
    .references(() => listings.id, { onDelete: "cascade" }),
  presetId: uuid("preset_id")
    .notNull()
    .references(() => messagePresets.id),
  variantId: uuid("variant_id")
    .notNull()
    .references(() => messagePresetVariants.id),
  type: presetTypeEnum("type").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  respondedAt: timestamp("responded_at", { withTimezone: true }),
  result: messageResultEnum("result").notNull().default("pending"),
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
