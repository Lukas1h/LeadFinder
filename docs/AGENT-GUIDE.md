# LeadFinder agent guide

Read this before working with LeadFinder, whether you are coding in this repo
or acting as Lukas's assistant (logging texts, booking jobs, pulling stats).
It explains what the app holds and how to read and change that data **without
the MCP server**: SQL against the database, the app's JSON API, or the code's
own functions.

> **Keep this file current.** Any change that adds or changes a feature,
> table, column, status, API route or business rule must update the matching
> section here in the same commit. If you find it out of date, fix it.

## Who and what

Lukas Hahn runs **Hahn Media**: real estate photo, video and drone work out of
Roseburg, Oregon (Eugene, Medford, Grants Pass, Klamath and the coast too). He
finds work by texting and emailing listing agents. LeadFinder is his CRM and
back office: new listings (leads), agents, every message and reply, bookings,
client galleries, invoices and payments, the schedule, follow-ups, portfolio
pages, and his books (trips, expenses, receipts, taxes).

- Web app: Next.js 16 on Vercel, production at `https://realestate.lukashahn.art`
  (login-gated). Client galleries are public at `gallery.lukashahn.art/<token>`,
  agent portfolio pages at `r.lukashahn.media/<slug>`.
- iPhone/Mac app: SwiftUI in `ios/`, talks to `/api/app/v1/*`.
- Database: Neon Postgres, schema in `src/db/schema.ts` (Drizzle). The schema
  file's comments are the best documentation of each column.

## Hard rules

1. **Never contact a real agent** (text, email, call, or anything that
   triggers one) unless Lukas explicitly asked for that specific send in this
   conversation, and he has confirmed the recipients and text. Queueing a
   message (`queued_messages`, status `queued`) is fine: it only goes out when
   he presses Send. Check contact history first so nobody gets a repeat or a
   cold pitch when he already works with them.
2. **Read before you write.** Do multi-row fixes in a transaction. Never drop
   or bulk-delete data unless he asked.
3. **Times are Pacific.** Timestamps are stored UTC (`timestamptz`). Convert
   with `at time zone 'America/Los_Angeles'` before grouping by day.
   Date-only columns (`trips.date`, `reminders.date`) are already Pacific dates.
4. Shipping code: see `CLAUDE.md` (work on `main`, build-check, push, verify
   the Vercel deploy).

## Talking to the database

Credentials are in `.env.local` (`DATABASE_URL`). If it's missing, run
`vercel env pull .env.local`. `psql` isn't installed; use Node from the repo
root so `node_modules` resolves:

```js
// q.tmp.cjs: run with `node q.tmp.cjs`, then delete it
require("./node_modules/dotenv").config({ path: ".env.local", quiet: true });
const { neon } = require("./node_modules/@neondatabase/serverless");
const q = neon(process.env.DATABASE_URL);
(async () => {
  console.log(await q`select id, name, phone, relationship_status from agents where name ilike ${"%wergeland%"}`);
})();
```

- Values go in `${...}` (parameterized). Don't interpolate SQL fragments
  such as `interval '7 days'` that way: write them literally in the query.
- To reuse the app's own logic (stats, schedule, attribution), import it
  with tsx from an `.mts` file:

```ts
// s.tmp.mts: run with `npx tsx s.tmp.mts`
import { config } from "dotenv"; config({ path: ".env.local", quiet: true });
const { loadScheduleItems } = await import("./src/lib/scheduleItems");
console.log(await loadScheduleItems("2026-10-26"));
process.exit(0);
```

Prefer the app's functions for writes that have side effects (for example,
logging an inbound reply also marks the send as replied and bumps the agent's
status). A raw `insert` skips those rules.

## Talking to the app's API

`/api/app/v1/*` is the JSON API the iPhone app uses. Auth is a bearer token,
`MOBILE_API_SECRET` from `.env.local`:

```bash
TOKEN=$(grep ^MOBILE_API_SECRET .env.local | cut -d= -f2- | tr -d '"')
curl -s -H "Authorization: Bearer $TOKEN" https://realestate.lukashahn.art/api/app/v1/schedule
```

Each route lives at `src/app/api/app/v1/<path>/route.ts`. Read the route
before calling it. The main ones:

| Area | Routes |
|---|---|
| Leads & listings | `GET leads`, `GET listings/[id]`, `listings/status`, `listings/[id]/texts`, `listings/[id]/message-options`, `listings/[id]/ai-draft` |
| Agents | `GET agents`, `GET agents/[id]`, `agents/[id]/interactions`, `agents/[id]/texts`, `agents/[id]/snooze`, `caller-id` |
| Messages | `GET messages`, `messages/[id]`, `messages/[id]/reply`, `messages/[id]/samples`, `messages/[id]/quick-actions/[presetId]`, `presets`, `presets/[id]/variants` |
| Bookings | `GET bookings` (buckets), `bookings/[id]`, `bookings/[id]/shot`, `bookings/[id]/complete`, `bookings/[id]/reopen`, `bookings/[id]/invoice`, `bookings/[id]/invoice-sent`, `bookings/[id]/airspace`, `bookings/gallery-visits` |
| Schedule | `GET schedule`, `reminders`, `reminders/[id]`, `reminders/[id]/done`, `schedule/follow-ups/[listingId]/dismiss` and `/restore` |
| Follow Up | `GET follow-up` (feeds, stats, day/week counter) |
| Finances | `GET finances`, `finances/trips`, `finances/expenses`, `finances/jobs`, `finances/taxes`, `finances/settings`, `finances/receipts/read` |
| Portfolio pages | `portfolio-links`, `portfolio-links/[id]`, `/prefill`, `/catalog`, `/listing-photos`, `/before-after`, `/images`, `/overview` |
| Photo editor | `photo-editor/listings`, `photo-editor/edit` |

Anything that sends a message (`messages/[id]/reply`, `samples`,
`quick-actions`) falls under hard rule 1.

## Data model by area

### Leads (listings)

`listings` holds every property found by the daily sync (Zillapi, email
alerts, Compass, imports). Key columns: `address`, `city`, `price`, `photos`
(URL array), `agent_id` / `agent_name` / `agent_phone`, `status`,
`lead_section`, `score` + `score_reasoning` (Gemini photo-quality score, 1–10;
low is a better lead), `photos_vacant`, `photos_have_drone`, `is_coming_soon`,
`price_cut_*`, `back_on_market_at`, `market_status` (active / pending / sold,
checked nightly), `follow_up_at` / `follow_up_note`.

`status` is one of `new, saved, contacted, replied, quoted, booked, passed,
declined, outreach`. The Leads page shows only `new` listings that **don't
already have a booking** (`src/app/leads-data.ts`). The Pipeline shows
contacted onward.

Priorities: weak photos first, no video second. Don't chase luxury with price
floors.

### Agents

`agents`: `name`, `phone`, `email`, `brokerage`, `home_city`,
`relationship_status`, `notes`, `last_contacted_at`, plus homes.com stats
(`homes_listings_per_year`, `homes_avg_sale_price`).

`relationship_status` is one of `cold → warm → interested → worked_once →
regular`, or `declined`. It is bumped automatically by replies and bookings.

Matching people: match on phone or email first. Names repeat (there are 60+
Lisas), and one person can have a phone-only and an email-only record.

### Messages and contact history

- `message_presets` / `message_preset_variants`: text and email templates,
  A/B variants with `enabled`. Placeholders include `{{firstName}}`,
  `{{area}}`, `{{city}}`, `{{recentWork}}` (`src/lib/messageTemplate.ts`).
- `message_sends`: one row per templated send (`sent_at`, `responded_at`,
  `result`: `pending | quoted | booked | declined`). This is the per-variant
  stats source.
- `agent_interactions`: the full contact timeline. `channel` is `call | text
  | email | in_person | other`, `direction` is `outbound | inbound`, and
  `outcome` is `answered | no_answer | voicemail | sent | not_sent`.
  `pending_since` set means he opened Messages but hasn't confirmed the send.
  `follow_up_feed` records which Follow Up tab a text came from.
- `queued_messages`: drafts waiting for Lukas to press Send (`status`:
  `queued | sent | skipped`).

Email is plain text by choice: no HTML, no tracking pixels.

### Bookings (jobs)

`bookings`: `listing_id` (when linked, the listing's address wins over the
booking's own), `contact_agent_id`, `job_date`, `date_tentative`,
`lockbox_code`, `notes`, line items in `booking_line_items` (`description`,
`amount` in dollars; the total is their sum), `dropbox_folder_link`,
`gallery_token`, `invoice_number`, `payment_link_url`, `paid_at`, and the
hours columns.

Lifecycle and the Booked page buckets (`groupBookings` in
`src/app/booked/data.ts`):

| Bucket | Condition |
|---|---|
| Tentative | upcoming and `date_tentative` (the date is only a placeholder) |
| Upcoming | no `shot_at`, `invoice_sent_at` or `completed_at` |
| Editing | `shot_at` set, not invoiced or completed |
| Invoice sent | `invoice_sent_at` set, not completed |
| Completed | `completed_at` set |

Client gallery: `gallery.lukashahn.art/<gallery_token>`, photos served live
from Dropbox. `gallery_views` logs `view`, `download_all`, `download_video`,
`invoice_view`, and `staging_request` (only when `staging_requests_enabled`
is on for that booking).

Booking credit: `attributeBookingToSend()` in `src/lib/agentIdentity.ts`
links a booking to the outreach send that won it.

### Schedule

`loadScheduleItems(today)` in `src/lib/scheduleItems.ts` feeds the web
Schedule page, the iPhone app and the MCP tool. It shows:

- reminders (`reminders`: `title`, `date`, `time`, `agent_id`, `booking_id`,
  `completed_at`): open ones on any date, done ones from today on;
- bookings from today on that are **not tentative, not shot and not
  completed**;
- listings with a `follow_up_at`.

### Follow Up feeds

`src/app/follow-up/feeds/` holds one module per tab: New listings, Relaunch
(price cuts and back on market), Samples, Congrats, Twilight gift, Virtual
staging, Graphics, Drone shots (`src/app/follow-up/droneOffers.ts`: free drone
shots near upcoming jobs), and Check-ins. `feeds/stats.ts` measures the 30-day
reply rate per tab. The daily texting target (`DAILY_TARGET` in
`src/app/follow-up/data.ts`) moves with live reply rates on purpose.

### Funnel and portfolio pages

The funnel: cold text → reply → samples (email template variant C, or a
personal portfolio link) → the agent saves his contact → a booking when their
next listing comes up (usually 1–4 weeks after first contact).

- `portfolio_links`: one personal page per agent (`slug`, `agent_id`,
  `content` JSON with photos, video, houses and an optional before/after),
  served at `r.lukashahn.media/portfolio?i=<4-char slug>` (links before
  2026-10-26: bare `r.lukashahn.media/<6-char slug>`, still served). The
  page never shows who it's for.
- `portfolio_sessions` / `portfolio_events`: visits (active seconds, scroll
  depth) and actions (`save_contact`, `book_shoot`, …). Each action sends him
  a push notification.
- `portfolio_images`: stored before/after photos. `portfolio_town_images`:
  per-town hero images.

### Finances

The app is the books (since 2026-10-16).

- `trips`: `date`, `purpose`, `category` (`shoot | client | outreach |
  supplies | office | other`), `miles`, `stops`. Linked to bookings through
  `trip_bookings`. This table is the mileage log for the standard mileage
  deduction.
- `expenses`: `date`, `amount_cents`, `vendor`, `category` (see
  `EXPENSE_CATEGORIES` in `src/lib/finance/categories.ts`; gas and car upkeep
  are 0% deductible because the mileage rate covers them),
  `deductible_percent`, optional `booking_id` / `trip_id`. Receipts are in
  `receipts` (bytea).
- Income comes from booking line items, earned once a job is shot, invoiced or completed (`earnedDate` in `ledger.ts`).
  The logic is in `src/lib/finance/` (`ledger.ts`, `reports.ts`, `tax.ts`).

## Example queries

```sql
-- This week's outreach (Mon–Sun, Pacific)
select count(*) filter (where direction='outbound' and channel='text') texts,
       count(distinct agent_id) filter (where direction='inbound') agents_replied
from agent_interactions
where (occurred_at at time zone 'America/Los_Angeles')::date >= date_trunc('week', now() at time zone 'America/Los_Angeles');

-- An agent's full history
select channel, direction, outcome, occurred_at, note from agent_interactions
where agent_id = '<uuid>' order by occurred_at;

-- Open jobs with their totals
select b.id, coalesce(l.address, b.address) address, b.job_date, b.date_tentative, b.shot_at,
       (select sum(amount) from booking_line_items li where li.booking_id=b.id) total
from bookings b left join listings l on l.id=b.listing_id
where b.completed_at is null order by b.job_date nulls last;

-- Gallery activity for a job
select event, detail, at, city, user_agent from gallery_views where booking_id='<uuid>' order by at;

-- Business miles by month
select to_char(date::date,'YYYY-MM') m, sum(miles) from trips group by 1 order by 1;

-- Portfolio page engagement
select l.slug, a.name, l.view_count,
  (select string_agg(event, ',') from portfolio_events e where e.link_id=l.id) actions
from portfolio_links l left join agents a on a.id=l.agent_id order by l.created_at desc;
```

## Where things live

| Thing | Code |
|---|---|
| Schema and enums | `src/db/schema.ts` (`npm run db:push` applies changes) |
| Leads board | `src/app/leads-data.ts`, `src/lib/leadSections.ts`, `src/lib/pipeline.ts` |
| Sync and photo scoring | `src/lib/sync.ts`, `src/lib/photoScore.ts` |
| Market status, booking↔listing matching | `src/lib/marketStatus.ts`, `src/lib/bookingListingMatch.ts` |
| Messaging and stats | `src/app/messaging/`, `src/lib/messageTemplate.ts`, `src/lib/messageStats.ts` |
| Bookings, galleries, invoices | `src/app/booked/`, `src/app/gallery/[token]/`, `src/app/api/bookings/[id]/invoice/` |
| Schedule | `src/lib/scheduleItems.ts`, `src/app/schedule/` |
| Follow Up | `src/app/follow-up/` |
| Portfolio pages | `src/app/portfolio/[slug]/`, `src/app/portfolio-links/`, `src/lib/portfolioLink.ts` |
| Finances | `src/lib/finance/`, `src/app/finances/` |
| Photo editor (Gemini; two presets: Bright interior, Sunset exterior) | `src/lib/photoPresets.ts`, `src/lib/photoEdit.ts`, `src/app/photo-editor/` |
| Push to Lukas's devices | `src/lib/push.ts`, `scripts/notify-me.mjs` |
| MCP tools (same rules, for reference) | `src/mcp/tools/` |
| Crons | `vercel.json`, `src/app/api/cron/` |
