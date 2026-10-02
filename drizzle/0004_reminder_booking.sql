-- Lets a reminder be about a specific booking, so the Schedule page can show
-- the same BookingRow the rest of the app uses and clicking through lands on
-- that job's detail dialog.
--
-- Nullable, so every existing reminder is unaffected, and ON DELETE SET NULL
-- so deleting a booking leaves the reminder standing rather than taking it
-- (and its title/notes) with it.
ALTER TABLE "reminders" ADD COLUMN IF NOT EXISTS "booking_id" uuid REFERENCES "bookings"("id") ON DELETE SET NULL;
