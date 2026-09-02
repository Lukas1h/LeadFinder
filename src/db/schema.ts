import {
  pgTable,
  uuid,
  text,
  integer,
  numeric,
  timestamp,
} from "drizzle-orm/pg-core";

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

  // Phase 2 fields — unused for now, kept nullable so no future migration is needed.
  score: text("score"),
  scoreReasoning: text("score_reasoning"),
  status: text("status").default("new"),
  notes: text("notes"),
});

export type Listing = typeof listings.$inferSelect;
export type NewListing = typeof listings.$inferInsert;
