-- The Dropbox folder a subcontracted photographer uploads the shoot's raw
-- files into. Nullable, so every existing booking is unaffected; made on the
-- first shooter assignment (or first "Copy upload link") by
-- src/lib/mediaUploads.ts, and never re-made, so a link already texted keeps
-- working. Separate from dropbox_folder_link, which is the delivered gallery
-- the client sees.
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "dropbox_upload_link" text;
