-- Records the listing status an interaction overwrote, so resolving a text as
-- "didn't send it" can restore the exact prior state instead of assuming "new".
--
-- An initial_outreach can be sent from the leads page (status "new") or from the
-- pipeline's "saved" row, and the revert needs to tell those apart. Nullable
-- with no backfill: every row already resolved, and any interaction still
-- pending when this lands falls back to "new", which is what the previous
-- hardcoded revert did anyway.
ALTER TABLE "agent_interactions" ADD COLUMN IF NOT EXISTS "listing_status_before" text;
