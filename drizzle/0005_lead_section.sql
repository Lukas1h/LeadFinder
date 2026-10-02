-- Which Leads-page section a listing sorts into, stored so preset targeting
-- can filter on it alongside score/price/age. Nullable, and backfilled by
-- refreshLeadSections rather than in SQL: the rules live in
-- src/lib/leadSections.ts and the agent side of the decision needs a join
-- that a migration shouldn't be guessing at.
--
-- Same column on message_presets, as a targeting criterion: null means no
-- section constraint, matching every other criterion field.
ALTER TABLE "listings" ADD COLUMN IF NOT EXISTS "lead_section" text;
ALTER TABLE "message_presets" ADD COLUMN IF NOT EXISTS "lead_section" text;
