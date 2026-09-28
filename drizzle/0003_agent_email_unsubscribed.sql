-- Records that an agent asked to stop being emailed, via the List-Unsubscribe
-- link (RFC 8058) in a cold email. Null means not unsubscribed.
--
-- Nullable with no backfill: this is new behaviour, and nobody has opted out
-- through a link that didn't exist yet. Separate from declinedAt on purpose —
-- "stop emailing me" isn't the same statement as "not interested in this
-- listing", and the app keeps those apart for the same reason.
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "email_unsubscribed_at" timestamptz;
