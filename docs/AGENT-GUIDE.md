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
5. **A texted-before agent's leads only ever go in "Texted before".** A cold
   agent he has texted (and who never answered) gets the `texted` section for
   every later listing, whatever the photos, price or anything else, and no
   other Leads section, grouping or template targeting may pull them out
   (texted within the last week: `unlikely` instead). Every other section's
   templates open with "Hey, I'm Lukas", which they've already had. Any new
   section or grouping on the Leads page has to leave `texted` (and
   `unlikely`) groups alone. "Near your shoots" got this wrong once
   (2026-11-10). The rule lives in `leadSection()` (`src/lib/leadSections.ts`).

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
| Activity | `GET activity` (read-only; `?days=` default 14, `?agent=` name filter): one timeline across interactions, message sends/responds, gallery views, portfolio sessions/events and booking milestones, plus attention items — invoices waiting for payment with each job's last gallery view, jobs shot but not invoiced, and open reminders. No pipeline, follow-up feeds or reply triage. For the assistant's periodic check-ins. |
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

Unlikely (`isLeadUnlikely` in `src/lib/leadSections.ts`): under the price
floor, no agent, a builder, Redfin (books its own media; not even synced), a
declined agent, and Berkshire Hathaway HomeServices NW Real Estate listings in
the Portland market (`hasAssignedMediaInMarket`: that office assigns its agents
a photographer, learned from Tim Sellers 2026-11-12; its Eugene/Florence
listings and the Netarts office are unaffected).

Map positions: `listings` and `bookings` both have `lat`, `lng`,
`geocoded_at`, `geocode_source` (`census`, `osm`, or `osm_street` = matched
only the street, not the house, so not used for distance; `geocoded_at` set
with `lat` null = looked up, no match). Filled by `src/lib/geocode.ts` when a
listing syncs in (`insertAndEnrichListings`) and when a booking is created or
edited; a booking linked to a listing gets the listing's address.
`scripts/geocode-backfill.mts` fills anything missing (dry run by default,
`--write` to save). `src/lib/nearShoots.ts` matches listings to his shoots
from the last 30 days: within 1 mile in town, 3 miles where the shoot has
fewer than 5 listings within a mile (`scripts/analyze-shoot-proximity.mts`
is the analysis behind those numbers). The Leads page's **Near your shoots**
section (right below Agents you know) holds never-texted cold leads near a
recent shoot, never Texted before, Unlikely or declined agents (hard rule 5); the iPhone API sends it as its
own `near` section. A template can target it: `lead_section` may include
`near` ("Near your shoots" in the template form), and for a stranger's lead
near a recent shoot that template is recommended over any other
(`pickRecommendedPreset`). The "Near your shoots" template started as a copy
of Backup Option without its score/price limits, for Lukas to rewrite.

**Markets** (`src/lib/markets.ts`, since 2026-11-12). Every listing is in one
of three markets, computed from its city/state (never stored):
`local` (within 45 min of Winston: Roseburg, Sutherlin, Glide, Myrtle Creek…),
`portland` (Multnomah, Washington, Clackamas, Yamhill and Columbia counties
plus Clark County WA; shot by a subcontracted photographer based in Oregon
City, Lukas edits), and `regional` (everything else he drives to himself,
Eugene to Salem, Medford, Ashland, the coast, Bend, plus any city missing from
the drive table). Salem and the rest of Marion County are regional. The Leads
page has a tab per market (`/?market=local|regional|portland`, Local by
default); `getLeadsBoard({ market })` filters the board and always returns
`marketCounts` for all three. The Portland tab is sorted purely by miles from
Oregon City (`milesFromOregonCity`: geocode, else a city table; unknown last),
with no coming-soon or area-code steps; the other tabs keep the drive bands
from Winston. Cards' drive time comes from `listingDriveTime()`: from Winston
for local/regional, "~25 min from Oregon City" for Portland.
Sections, templates and hard rule 5 are the same in every market. The iPhone
API takes `?market=` too (left out = all markets, for older builds) and
returns `markets` (key, label, count). Portland jobs pay Lukas less, so
Portland outreach is on top of the home markets, never instead of them.

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
  A/B variants with `enabled`. A variant's `market` (`local` / `regional` /
  `portland`, null = regular wording) limits it to that market's listings: a
  listing in a market whose template has enabled variants of its own rotates
  through only those (`variantsForMarket`, `src/lib/markets.ts`), everyone else
  gets the regular ones; reply quick actions and email use only regular ones.
  Portland variants (2026-11-12): Backup Option "Portland A–D" and Bad Photos
  "Portland A" ("I do real estate photography", no "some"; Bad Photos ends
  "I'd love to get it shot as soon as possible for you!"). Set on the variant
  form's Market field. Placeholders include `{{firstName}}`,
  `{{area}}`, `{{city}}`, `{{recentWork}}`, `{{portfolioLink}}` (`src/lib/messageTemplate.ts`;
  only in the "Portfolio link" template's second text). `{{area}}` uses the
  listing's city, else the agent's `home_city` in reply quick actions; with
  neither it's "around Oregon" ("{{area}} as well as most of the state"
  becomes "around most of Oregon").
  `same_office` templates (`{{officeClient}}`) are only offered when the
  lead's agent shares an office with a client; one with `office_brokerage`
  (+ optional `office_city`) set is for that office only and replaces the
  general one there (RE/MAX Integrity, Roseburg). Cloud brokerages (eXp,
  Real Broker, Fathom, LPT, Epique) never count as a shared office.
- `agent_status_changes`: every change to an agent's `relationship_status`
  since 2026-11-09 (`from_status`, `to_status`, `changed_at`), written by a
  database trigger (`drizzle/0006_agent_status_changes.sql`, applied with
  `scripts/apply-sql.mts`), so no app code writes it and every path is caught.
  `attribution` is the outreach in the 14 days before: `feed:<FollowUpFeedKey>`,
  `template:<preset name>`, `outreach:<channel>` (an untemplated text/call/email)
  or `manual`; the ids of that send, outbound interaction and latest reply are kept.
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
`gallery_token`, `invoice_number`, `square_invoice_id` / `square_invoice_url`,
`paid_at`, and the hours columns.

Invoices: the first open of `/api/bookings/[id]/invoice` ("Create invoice")
assigns `invoice_number` (`src/lib/invoice.ts`) and makes its Square copy
(`src/lib/squareInvoice.ts`): same number, line items and note, the property
address as its title, delivered `SHARE_MANUALLY` so Square never emails or
texts the client. Its `public_url` is the invoice's and gallery's "Pay
Online". `square_invoice_sync` fingerprints what it was made from; when the
line items, note, address or agent change, the next sync (opening the invoice,
"Copy pay link", or editing the booking) cancels it and makes a new one, so
only the current total can be paid. A number Square already holds gets a
`-2`, `-3`… suffix. No Square copy is made for a completed job's invoice.
Deleting the invoice cancels its Square copy. `paid_at` is set by
`/api/webhooks/square` (`invoice.payment_made`, needs
`SQUARE_WEBHOOK_SIGNATURE_KEY`) or when a sync finds it paid. Each agent is
their own Square customer (`reference_id` `agent:<id>`); with no email on file
Lukas's own stands in, so the receipt comes to him.

Lifecycle and the Booked page buckets (`groupBookings` in
`src/app/booked/data.ts`):

| Bucket | Condition |
|---|---|
| Tentative | upcoming and `date_tentative` (the date is only a placeholder) |
| Upcoming | no `shot_at`, `invoice_sent_at` or `completed_at` |
| Editing | `shot_at` set, not invoiced or completed |
| Invoice sent | `invoice_sent_at` set, not completed |
| Completed | `completed_at` set |

Client gallery: `gallery.lukashahn.media/<gallery_token>` (old links on gallery.lukashahn.art still work), photos served live
from Dropbox. `gallery_views` logs `view`, `download_all`, `download_video`,
`invoice_view`, and `staging_request` (only when `staging_requests_enabled`
is on for that booking).

Share link: `share_token` is a second link to the same gallery for people who
aren't the client (showing a listing off), made on first use by **Copy share
link** in the booking dialog (`getOrAssignShareToken`; phone:
`POST /api/app/v1/bookings/[id]/share-link`, and `shareUrl` on a booking). It
shows no invoice, payment, staging or greeting, puts the first photo as a hero,
and logs `share_view` instead of `view`. `byGalleryToken()` (`src/lib/galleryToken.ts`)
resolves either token.

`hide_pay_online` (booking dialog: **Hide pay online**) leaves the Pay online button off
the gallery and the invoice; "Paid, thank you!" still shows once paid.

Adding `?hideName` (any value) to the client's own gallery link swaps the greeting's
first name for "Hi there!"; everything else stays the same.

Flambient (the Mac photo app) makes galleries with `POST /api/app/v1/bookings/[id]/gallery`
`{ dropboxFolderLink, replace? }` → `{ url }`: sets the folder link and assigns the gallery token,
sends nothing. A different folder already on the booking answers 409 `{ existing }` unless `replace`.
The folder must be in the same Dropbox account as `DROPBOX_REFRESH_TOKEN` (thumbnails load by path).

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
(price cuts and back on market), Photo offer replies
(`feeds/photoOfferReplies.ts`: replied in the last 45 days to a "Bad Photos",
"Coming Soon" or photo-offer AI draft text, then 3+ days of nothing either way,
listing still for sale and not shot by him, agent not cold/declined, send not
marked booked/declined),
Samples, Link not opened (`feeds/unopened.ts`:
Portfolio link sent 3–21 days ago, never opened, no contact since), Opened, no
reply (`feeds/opened.ts`: same window, opened, nothing from them since; offers free
drone shots on a first shoot), Shot one near you (`feeds/nearShoot.ts`: warm and interested
agents with a for-sale listing near a home he shot in the last 30 days, no
contact in 10 days, not offered in 45; he texts a photo from that shoot),
Free drone with booking
(`feeds/droneBooking.ts`: warm/interested agents he has texted, no contact in
3+ weeks, not offered yet, most deals/yr then highest avg price first; text
from the "Free drone with booking" SMS template, whose second message rides
along as the card's `secondText`: copied on the web Text tap, a second Messages
sheet on iOS), Congrats, Twilight gift, Virtual
staging, Graphics, Drone shots (`src/app/follow-up/droneOffers.ts`: free drone
shots near upcoming jobs), and Check-ins. Every tab follows three rules, applied once in `buildFeeds` from
`feeds/history.ts`: (1) **Pass**: the X on a card (web and iPhone, `POST
follow-up/pass` with `agentId`, `feed`, optional `listingId`) writes
`follow_up_passes` and takes the card off that feed only. With a listing it
covers that listing in that feed; without one it covers the agent in that
feed. It replaced the per-agent snooze on feed cards (`follow_up_snoozed_until`
is still honoured until old snoozes run out). (2) **No repeat**: once a text or
call went out from a feed (`agent_interactions.follow_up_feed`), that agent
doesn't come back to it; Congrats, New listings, Check-ins and Graphics can
come back, but only if the agent has replied since the last one. (3) **Texted
before only**: every card is a text, so an agent shows only with text
history (a text interaction either way, or a send from an SMS template).
Drone shots is exempt, since it has an email template.
`feeds/stats.ts` measures each tab
over 30 days: agents reached from it (texts/calls started on its cards,
`agent_interactions.follow_up_feed`), how many replied within a week, how many
were warm when reached, and how many of those turned interested or better
since (from `agent_status_changes`). A tab with nobody due still shows when it
has numbers. On the iPhone, Follow up is a tab (Agents and Portfolio links
hang off its header) and lists the tabs as categories with those numbers; on
the web it's a mobile tab too. `src/lib/funnelSplit.ts` gives Home's funnel
card its Cold row (first outreach texts in 30 days: replied, now interested)
and Follow up row (the same stats across all tabs, each agent once), served
as `funnel` on `GET /api/app/v1/messages`, plus `byMarket` (the same two
rows per market; an agent's market is that of the listing their first cold
text was about, else `agentMarkets()` in `src/lib/agentMarket.ts`: latest
listing, then `home_city`, then a 503/971/360 number = Portland). The daily texting target (`DAILY_TARGET` in
`src/app/follow-up/data.ts`) moves with live reply rates on purpose.

### Funnel and portfolio pages

The funnel: cold text → reply → samples (email template variant C, or a
personal portfolio link) → the agent saves his contact → a booking when their
next listing comes up (usually 1–4 weeks after first contact).

- `portfolio_links`: one personal page per agent (`slug`, `agent_id`,
  `content` JSON with photos, video, houses and an optional before/after),
  sent as `lukashahn.media/portfolio/<word>` (a slug from
  `src/lib/portfolioWords.ts`, two words once they run out). The main site is
  a separate Vercel project (`lukashahnart`) whose `next.config.ts` forwards
  `/portfolio/*`, `/lf/*` (this app's assetPrefix), `/api/portfolio/*`,
  `/api/portfolio-image/*` and `/agent-page/*` to `r.lukashahn.media`, where
  the page is served. Older random slugs still work there: 6 chars as
  `r.lukashahn.media/<slug>`, 4 chars as `r.lukashahn.media/portfolio?i=<slug>`.
  The page never shows who it's for.
- Sending one: the **Portfolio link** quick action (first on every outreach
  text template) opens the builder for that agent; after saving, **Text it to
  …** sends two texts: the template body ("Thanks!") then its second
  message, the link plus a line. Web opens Messages with the first and copies
  the second. On the iPhone every message to an agent gets a **Create
  portfolio** quick action, whether or not its template lists Portfolio link
  (the app adds it; the API still hides the template's own builder action from
  the app). It opens a short summary of the page it would make (area template,
  listings, toggles from `/prefill`): **Send** creates the link and sends both
  texts in turn, then closes back to the message history; **Edit** opens the
  builder on that unsaved page (`.draft` start, Done hands it back) and a link
  already made by a cancelled Send is re-saved before texting
  (`GET`/`POST /api/app/v1/portfolio-links/[id]/text`; create/save return the
  link `id`). Recorded by
  `recordPortfolioLinkText` (replyActions.ts): one send in message history
  with both texts, and the agent's last message marked replied.
- `portfolio_sessions` / `portfolio_events`: visits (active seconds, scroll
  depth) and actions (`save_contact`, `book_shoot`, …). Each action sends him
  a push notification.
- `portfolio_images`: stored before/after photos. `portfolio_town_images`:
  per-town hero images.
- `portfolio_templates`: area defaults for the builder (`name`, `towns` text[]
  lowercased, `content` = listings, showOffer, showTourOfHomes, video,
  leadPhoto, ogImage). Edited on `/portfolio-links/settings`. When a picked
  agent's area matches a town, `getPortfolioPrefill` returns it as `template`
  and its listings replace the nearest jobs. A Portland-market agent's area
  prefills as "the Portland area" (not their suburb), and the "Portland
  metro" template (2026-11-12; towns = every Portland-market city from
  `portlandTowns()`, Vancouver-area WA cities and "the portland area") starts
  from the Mid-Valley one with Tour of Homes off. `content.ogImage` on a link
  overrides the link preview image (default: the lead photo).
- Main website "Recent listings": `app_settings.site_listing_ids` (booking ids,
  in order; null = the three newest finished jobs), picked under **Website
  listings** on `/portfolio-links/settings`. `GET /api/site-listings` (public)
  returns the same cards as an agent page, built live, with photos from
  `/api/site-listings/photo` (only jobs currently shown). The `lukashahnart`
  project's home page fetches it from `r.lukashahn.media` every 5 minutes
  (`app/(real-estate)/RecentListings.tsx`) and hides the section when empty.
- Card photos (agent pages and the website alike): `bookings.highlight_photos`
  (Dropbox file names, in order, max 10), picked with **Highlight photos** in
  the booking dialog (`src/app/booked/HighlightPhotosButton.tsx`, thumbnails
  from admin-only `/api/bookings/[id]/photo`). Null = 10 photos spread evenly
  across the gallery (`src/lib/listingCardPhotos.ts`); picks no longer in the
  folder are skipped.
- Agent page styles: `content.newStyle` (the **New style** checkbox in the
  link builder; off by default, and every link sent before 2026-11-12 stays
  on the original layout). New style: a compact hero (headline, then
  "Featured in the Eugene Tour of Homes" under it; no tagline, guarantee or
  discount) → portfolio, where the video is the self-hosted MP4 on Vercel
  Blob (`AGENT_PAGE_VIDEOS[*].mp4`, a bare `<video>`, no YouTube UI) → recent
  listings (a Sold badge is a bold dark block) → four tiles (scheduled for
  tomorrow; in and out in as little as 45 minutes, next morning turnaround;
  real edits; licensed and insured) → testimonial → pricing → the
  save-contact section. On both styles the footer and the
  vCard (`lukasVcard`) say Portland when `isPortlandArea(content.area)`.
- Agent page pricing (both styles, above the last section): a highlighted
  "Most booked" Interior & Exterior Photography $300 box with "Edited by
  hand, not AI" and "Next morning turnaround" as bullets under the name, and
  add-ons drone +$100, floor plans +$50, virtual staging +$50, virtual
  twilight +$50; then Walkthrough Video $400 and Photo + Video + Drone $650
  (no agent on-camera video, no "save" callout). Listing cards on both
  styles: a Pending badge is the biggest (orange block), Just listed a small
  white tag; the listing agent's name and brokerage are large under the
  address.
- The last section on both styles (`SaveContact`) only asks for the save:
  "Thanks for taking a look, {first name}!" (the only place the greeting
  appears; the hero no longer has it), "Save my contact for when your next
  listing comes up.", the Save my contact button (vCard, tracked as
  `save_contact` / `bottom`), then a preview of the contact card (headshot
  from `LUKAS_PHOTO` once set, else "LH" initials), and the $50-off line
  when `showOffer`. No "Let's work on your next listing" heading or Book a
  shoot card.
- Portfolio photos on every agent page: `public/agent-page/pf-01…pf-20.jpg`
  (new style, `FullGallery`: video → 8-photo grid → pf-01 full width → 8-photo grid → the 10th photo full width (`AGENT_PAGE_PHOTOS` order), the last two unused; the original shows 6),
  Lukas's 2026-11-12 set in the main website's order. Card carousels preload
  every photo after the first loads, so the arrows flip instantly.

### Finances

The app is the books (since 2026-10-16).

- `trips`: `date`, `purpose`, `category` (`shoot | client | outreach |
  supplies | office | other`), `miles`, `stops`. Linked to bookings through
  `trip_bookings`. This table is the mileage log for the standard mileage
  deduction.
- `expenses`: `date`, `amount_cents`, `vendor`, `category` (see
  `EXPENSE_CATEGORIES` in `src/lib/finance/categories.ts`; gas and car upkeep
  are 0% deductible because the mileage rate covers them),
  `refunded_cents` / `refunded_on` (a full or partial refund, set in the expense
  dialog; every total uses `amount_cents - refunded_cents`; API: `refunded`,
  `refundedOn`, `netAmount`),
  `deductible_percent`, optional `booking_id` / `trip_id`. Receipts are in
  `receipts` (bytea).
- Income comes from booking line items, earned once a job is shot, invoiced or completed (`earnedDate` in `ledger.ts`).
  Income is the full invoice even when Square takes a cut: the fee is its own `fees` expense
  (vendor `Square`, `booking_id` set), logged by `recordSquareFee()` in `src/lib/squareInvoice.ts`
  when the payment comes in, or by the nightly market-status cron once Square settles it.
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

-- Warm -> interested by what caused it
select attribution, count(*) from agent_status_changes
where from_status = 'warm' and to_status = 'interested' group by 1 order by 2 desc;

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
