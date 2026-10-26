CREATE TYPE "public"."queued_message_status" AS ENUM('queued', 'sent', 'skipped');--> statement-breakpoint
ALTER TYPE "public"."lead_status" ADD VALUE 'outreach';--> statement-breakpoint
CREATE TABLE "email_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text NOT NULL,
	"email" text NOT NULL,
	"from_name" text,
	"smtp_host" text NOT NULL,
	"smtp_port" integer DEFAULT 587 NOT NULL,
	"smtp_secure" boolean DEFAULT false NOT NULL,
	"password_enc" text NOT NULL,
	"imap_host" text,
	"imap_port" integer,
	"imap_user" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"last_tested_at" timestamp with time zone,
	"last_test_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"amount_cents" integer NOT NULL,
	"vendor" text,
	"description" text NOT NULL,
	"category" text NOT NULL,
	"deductible_percent" integer DEFAULT 100 NOT NULL,
	"gallons" real,
	"price_per_gallon" real,
	"paid_personally" boolean DEFAULT false NOT NULL,
	"spread_months" integer DEFAULT 1 NOT NULL,
	"booking_id" uuid,
	"trip_id" uuid,
	"receipt_number" integer,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expenses_receipt_number_unique" UNIQUE("receipt_number")
);
--> statement-breakpoint
CREATE TABLE "gallery_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"event" text DEFAULT 'view' NOT NULL,
	"detail" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" text,
	"city" text,
	"region" text,
	"country" text,
	"user_agent" text,
	"referer" text
);
--> statement-breakpoint
CREATE TABLE "portfolio_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"link_id" uuid NOT NULL,
	"event" text NOT NULL,
	"detail" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portfolio_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mime_type" text NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portfolio_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"agent_id" uuid,
	"content" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"view_count" integer DEFAULT 0 NOT NULL,
	"first_viewed_at" timestamp with time zone,
	"last_viewed_at" timestamp with time zone,
	CONSTRAINT "portfolio_links_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "portfolio_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"link_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"active_seconds" integer DEFAULT 0 NOT NULL,
	"max_scroll_pct" integer DEFAULT 0 NOT NULL,
	"section_seconds" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"screen" text,
	"ip" text,
	"city" text,
	"region" text,
	"country" text,
	"user_agent" text,
	"referer" text
);
--> statement-breakpoint
CREATE TABLE "portfolio_town_images" (
	"town" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"image_src" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "queued_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"listing_id" uuid,
	"channel" "message_channel" NOT NULL,
	"type" "preset_type" DEFAULT 'initial_outreach' NOT NULL,
	"preset_id" uuid,
	"variant_id" uuid,
	"subject" text,
	"body" text NOT NULL,
	"draft_status" text,
	"draft_instruction" text,
	"recipient" text,
	"send_after" timestamp with time zone DEFAULT now() NOT NULL,
	"after_queued_id" uuid,
	"delay_minutes" integer,
	"status" "queued_message_status" DEFAULT 'queued' NOT NULL,
	"sent_at" timestamp with time zone,
	"interaction_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expense_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receipts_expense_id_unique" UNIQUE("expense_id")
);
--> statement-breakpoint
CREATE TABLE "reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"date" date NOT NULL,
	"time" text,
	"duration_minutes" integer,
	"notes" text,
	"agent_id" uuid,
	"booking_id" uuid,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trip_bookings" (
	"trip_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	CONSTRAINT "trip_bookings_trip_id_booking_id_pk" PRIMARY KEY("trip_id","booking_id")
);
--> statement-breakpoint
CREATE TABLE "trips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"purpose" text NOT NULL,
	"category" text DEFAULT 'shoot' NOT NULL,
	"stops" text,
	"miles" real NOT NULL,
	"drive_minutes" integer,
	"miles_estimated" boolean DEFAULT false NOT NULL,
	"agent_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_interactions" ADD COLUMN "follow_up_feed" text;--> statement-breakpoint
ALTER TABLE "agent_interactions" ADD COLUMN "listing_status_before" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "email_unsubscribed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "follow_up_snoozed_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "homes_url" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "homes_license_id" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "homes_listings_per_year" integer;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "homes_avg_sale_price" integer;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "homes_captured_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "homes_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "homes_check_note" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "home_city" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "brokerage" text;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "vehicle_mpg" real DEFAULT 20 NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "other_wages_monthly" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "date_tentative" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "invoice_note" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "shot_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "invoice_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "editing_hours" real;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "shooting_hours" real;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "logistics_hours" real;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "staging_requests_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "square_invoice_id" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "square_invoice_url" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "stripe_payment_link_id" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "payment_link_url" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "payment_link_amount" integer;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "paid_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "stripe_checkout_session_id" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "market_status" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "market_status_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "market_noticed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "market_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "airspace" jsonb;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "airspace_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "alt_zpids" text[];--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "has_3d_tour" boolean;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "price_cut_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "price_cut_amount" integer;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "price_cut_count" integer;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "original_price" integer;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "resurfaced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "lead_section" text;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "photos_vacant" boolean;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "photos_have_drone" boolean;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "back_on_market_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "market_status" text;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "market_status_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "market_noticed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "market_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "message_preset_variants" ADD COLUMN "inline_photos" jsonb;--> statement-breakpoint
ALTER TABLE "message_presets" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "message_presets" ADD COLUMN "lead_section" text;--> statement-breakpoint
ALTER TABLE "message_presets" ADD COLUMN "coming_soon" boolean;--> statement-breakpoint
ALTER TABLE "message_presets" ADD COLUMN "sitting" boolean;--> statement-breakpoint
ALTER TABLE "message_presets" ADD COLUMN "same_office" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "message_presets" ADD COLUMN "pitches_listing" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "message_presets" ADD COLUMN "second_message" text;--> statement-breakpoint
ALTER TABLE "message_presets" ADD COLUMN "follow_up_email_preset_id" uuid;--> statement-breakpoint
ALTER TABLE "message_presets" ADD COLUMN "quick_action_preset_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "message_presets" ADD COLUMN "quick_action_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "message_sends" ADD COLUMN "body" text;--> statement-breakpoint
ALTER TABLE "message_sends" ADD COLUMN "recipient_name" text;--> statement-breakpoint
ALTER TABLE "search_sources" ADD COLUMN "coming_soon_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "search_sources" ADD COLUMN "keywords" text;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gallery_views" ADD CONSTRAINT "gallery_views_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_events" ADD CONSTRAINT "portfolio_events_session_id_portfolio_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."portfolio_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_events" ADD CONSTRAINT "portfolio_events_link_id_portfolio_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."portfolio_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_links" ADD CONSTRAINT "portfolio_links_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_sessions" ADD CONSTRAINT "portfolio_sessions_link_id_portfolio_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."portfolio_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queued_messages" ADD CONSTRAINT "queued_messages_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queued_messages" ADD CONSTRAINT "queued_messages_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queued_messages" ADD CONSTRAINT "queued_messages_preset_id_message_presets_id_fk" FOREIGN KEY ("preset_id") REFERENCES "public"."message_presets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queued_messages" ADD CONSTRAINT "queued_messages_variant_id_message_preset_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."message_preset_variants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queued_messages" ADD CONSTRAINT "queued_messages_after_queued_id_queued_messages_id_fk" FOREIGN KEY ("after_queued_id") REFERENCES "public"."queued_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_bookings" ADD CONSTRAINT "trip_bookings_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_bookings" ADD CONSTRAINT "trip_bookings_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_presets" ADD CONSTRAINT "message_presets_follow_up_email_preset_id_message_presets_id_fk" FOREIGN KEY ("follow_up_email_preset_id") REFERENCES "public"."message_presets"("id") ON DELETE set null ON UPDATE no action;