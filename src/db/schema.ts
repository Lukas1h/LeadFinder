import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  numeric,
  timestamp,
} from "drizzle-orm/pg-core";

export const LEAD_STATUSES = [
  "new",
  "saved",
  "contacted",
  "replied",
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

  // Lead pipeline: new -> saved -> contacted -> replied -> booked, with
  // declined reachable from anywhere. contactedAt drives follow-up
  // flagging (see FOLLOW_UP_AFTER_DAYS in src/app/pipeline/page.tsx).
  // statusChangedAt updates on every transition (contactedAt only on ones
  // into "contacted") — used to sort the pipeline page by how long a
  // listing has sat in its current state.
  status: leadStatusEnum("status").notNull().default("new"),
  contactedAt: timestamp("contacted_at", { withTimezone: true }),
  statusChangedAt: timestamp("status_changed_at", { withTimezone: true }),

  // AI photo-quality score (1-10, higher = more clearly professional
  // photography) from gpt-4o-mini vision, scored once per newly-inserted
  // lead in the sync route. See src/lib/photoScore.ts for the rubric. A
  // LOW score is the valuable lead here — it means the listing likely
  // doesn't have a pro photographer yet.
  score: integer("score"),
  scoreReasoning: text("score_reasoning"),

  // Phase 2 field — unused for now, kept nullable so no future migration is needed.
  notes: text("notes"),
});

export type Listing = typeof listings.$inferSelect;
export type NewListing = typeof listings.$inferInsert;

// Keyed by phone (the one reliably-unique agent identifier available) so
// we can warn when about to message an agent already contacted about a
// different listing. Rows are created/updated lazily — only when a
// listing's status is set to "contacted", not during sync.
export const agents = pgTable("agents", {
  id: uuid("id").primaryKey().defaultRandom(),
  phone: text("phone").notNull().unique(),
  name: text("name"),
  lastContactedAt: timestamp("last_contacted_at", { withTimezone: true }),
  lastContactedListingId: uuid("last_contacted_listing_id").references(() => listings.id),
});

export type Agent = typeof agents.$inferSelect;
