# LeadFinder

Daily job that pulls newly-listed properties in a configured area from
Zillapi, saves ones we haven't seen before, and shows them on a dashboard —
leads for a real estate photographer. Single-user personal tool.

## Setup

1. Install deps: `npm install`
2. Create a Postgres database via the Neon integration in the Vercel
   dashboard (Storage tab → Marketplace Database Providers → Neon), or a
   free Neon project directly at neon.tech. Either way you end up with a
   `DATABASE_URL`.
3. Copy `.env.local.example` to `.env.local` and fill in:
   - `DATABASE_URL` — from step 2
   - `ZILLAPI_KEY` — from your Zillapi dashboard
   - `CRON_SECRET` — any string for local dev
   - `SEARCH_BBOX` — already set to the Eugene/Springfield metro box
     (`west,south,east,north`); the wider I-5 corridor box tried earlier
     returned 50+ new listings/day and blew through credits fast, so think
     twice before widening this (see credit-cost notes below)
   - `SEARCH_PRICE_MIN` — already set to `440000`
   - `SEARCH_HOME_TYPES` — already set to `house,condo,townhouse` (drops
     vacant land, multi-family, manufactured homes, and apartments —
     narrows results to what's actually worth shooting)
   - `USE_MOCK_ZILLAPI` — leave as `true` until you've made your first real
     call (see below)
4. Push the schema to your database: `npm run db:push`
5. `npm run dev`, then open `http://localhost:3000`

## Triggering the sync manually

Cron only fires on Vercel in production, so test locally by hitting the
route directly with the `CRON_SECRET` as a bearer token:

```bash
curl -X GET http://localhost:3000/api/cron/sync-listings \
  -H "Authorization: Bearer dev-secret"
```

(swap `dev-secret` for whatever you put in `CRON_SECRET`). It returns
`{ "fetched": N, "inserted": M }`.

On Vercel, the platform sets `CRON_SECRET`'s matching header automatically
for the scheduled invocation — you don't need to do anything for
production. To test the deployed route by hand, pass the same
`CRON_SECRET` value you set in the Vercel env vars.

## Mock mode — don't burn Zillapi credits

Every listing *returned* by Zillapi costs a credit, charged server-side
regardless of what your code does with the response — so a diagnostic call
against a wide bbox can cost as much as a real sync. Use mock mode for all
local dev and testing:

- `USE_MOCK_ZILLAPI=true` (the default in `.env.local.example` and already
  set in `.env.local`) makes `fetchNewListings` read from
  [`data/mock-listings.json`](data/mock-listings.json) instead of calling
  the live API. Run `npm run dev` and hit the sync route locally as much as
  you want — zero credits.
- Only flip it to `false` when you deliberately want to test against the
  real API (e.g. re-verifying the response shape, or a one-off manual
  sync). Know roughly what it'll cost first — see below — and prefer a
  narrow bbox or low `max_items` for a diagnostic call rather than reusing
  the full production query.
- `src/lib/zillapi.ts` and `data/mock-listings.json` reflect the **real**
  response shape (verified 2026-09-01, not just the docs) — nested
  `listingPrice.amount` / `listingAddress.{street,city,state,zipCode}`,
  the array at `data.data` (not `results`/`listings` like the docs imply),
  `listingPhotos[].url` for photos, `broker.name` for the brokerage, and
  `listingType.isFSBO` for the FSBO filter. If Zillapi changes its response
  shape later, re-verify with one deliberate real call and update both
  files together.

## Credit-cost notes (for future you)

- 1 credit per listing *returned*, minimum 1 per call. Failed calls are
  free. This is charged by Zillapi's API regardless of how your code
  parses (or fails to parse) the response — a bug that silently drops
  every result still spends the credits.
- `days_on_zillow=1` is what makes this cheap in theory — it returns only
  listings posted in roughly the last day, not the whole active inventory
  in the bbox. Don't remove it or replace it with a full-inventory pull +
  diff.
- **Bbox size matters a lot.** Two earlier, wider boxes (statewide, then
  the I-5 corridor) both hit the 50-item `max_items` safety cap daily —
  confirmed by real calls, not a guess. That's why the bbox is now scoped
  to just Eugene/Springfield with a `$440k` price floor and a
  `house,condo,townhouse` type filter — narrower criteria means fewer
  results, fewer credits, and no silent truncation from the cap. If you
  widen the bbox or drop a filter later, expect the daily count (and cost)
  to jump back up — check with a deliberate low-`max_items` test call
  first rather than assuming.
- **The agent/phone lookup roughly doubles the daily spend.** It's 1 more
  credit per *newly-inserted* lead (not re-charged for leads you already
  have) via `GET /v1/properties/{zpid}` (see Schema below — not the
  dedicated `/agent` sub-resource, which is also 1 credit but never
  actually returns a phone number). With the narrowed Eugene bbox this
  should be a small number/day, but it's still double whatever the
  listings pull costs.
- `max_items` is capped at 50 in the sync route (`MAX_ITEMS` in
  [`src/app/api/cron/sync-listings/route.ts`](src/app/api/cron/sync-listings/route.ts)).
  Raise it only alongside a credit budget that can absorb the extra cost.
- Free tier: 100 credits, no card, no top-ups — a single wide-bbox test
  call can burn through most or all of it, which is exactly what happened
  during initial setup here. Paid: $5/mo for 1,000 credits, or $54/yr for
  12,000.
- **Zillapi has no dedicated balance-check endpoint**, but every response
  carries `x-credits-charged` and `x-credits-remaining` headers — that's
  the real way to check your balance (`curl -sD - ... | grep x-credits`).
  Don't trust the docs' claims about what's cached/free without checking
  this header — it's how we found `/v1/properties/{zpid}` charges 1 credit
  every time, not "0 on a cache hit" as documented.

## Schema

Single `listings` table, deduped by `zpid` (unique constraint; the sync
route upserts with `ON CONFLICT DO NOTHING`). Photos (`photos`, a text
array of image URLs) and an initial `broker_name` come from the same
`/v1/listings` call, no extra credits.

`agent_name` and `agent_phone` are populated from `GET /v1/properties/{zpid}`
— the **full property details endpoint**, not the dedicated
`/v1/properties/{zpid}/agent` sub-resource
([`fetchAgentInfo`](src/lib/zillapi.ts)). Called once per
**newly-inserted** lead only, never re-fetched for leads already in the
DB, so it adds 1 credit per new lead per day on top of the listings pull.

This took two rounds to get right:
- The dedicated `/agent` sub-resource's docs claim it returns phone/email/
  license number, but 5 real RMLS (Oregon) listings never had them —
  only `agentName`/`brokerName` ever came back.
- The full `/v1/properties/{zpid}` details endpoint, tested against 2 real
  listings (including one cross-checked against the actual "Listed by:"
  text on the Zillow page itself), reliably returns a real phone number
  under `data.agent.phoneNumber` — same 1-credit cost, actually useful
  data. That's what's wired up now. `data.agent.email` was `null` on both,
  so there's no `agent_email` column — revisit if you ever see one
  populated.

The dashboard shows an agent name + phone "Text {number}" link
(`sms:+1XXXXXXXXXX`, US-only) next to the brokerage name when a phone is
present.

Columns `score` and `score_reasoning` are present but unused — reserved
for Phase 2 (AI photo scoring) so that work won't need a migration.

## Two pages

- **`/` — Leads.** Only `status = "new"` listings, one per card (photo
  left, details right). Three actions per lead, no dropdown:
  **Text {agent}** (primary — opens `sms:` with a prewritten outreach
  message pre-filled and moves the listing to `contacted`), **Save**
  (→ `saved`), **Not interested** (→ `declined`). Whichever you click, the
  card disappears from this view since it's no longer `new`.
- **`/pipeline` — everything else.** Grouped into three tiers, in the
  order you actually need to work through them:
  1. **Needs your attention** — `replied` (respond — someone's waiting on
     you), then `saved` (ready to message), then `contacted` leads that
     have gone `FOLLOW_UP_AFTER_DAYS` (3, in
     [`src/lib/pipeline.ts`](src/lib/pipeline.ts)) without a reply. Each
     subgroup is sorted oldest-first — the longest-overdue item leads.
  2. **Waiting on a reply** — `contacted` leads still inside the
     follow-up window. Nothing to do yet.
  3. **Closed** (`booked`/`declined`) — collapsed by default (`<details>`,
     no JS needed) so history isn't lost but doesn't clutter the view. Has
     a "Reopen" action back to `new` in case a status change was a
     mistake.

  Status-appropriate actions per lead (`saved` → Text/Not interested;
  `contacted` → Mark replied/Follow up (re-texts with a different message,
  resets the follow-up clock)/Not interested; `replied` → Mark
  booked/Not interested) all funnel through the same two server actions in
  [`src/app/actions.ts`](src/app/actions.ts): `updateListingStatus` (any
  transition) and `recordFollowUp` (re-contacting without changing
  status).

`status` is a Postgres enum (`lead_status`):
`new → saved → contacted → replied → booked`, with `declined` reachable
from any state. `contacted_at` (set whenever a listing moves *into*
`contacted`, including on a follow-up re-text) drives the follow-up flag;
`status_changed_at` (set on every transition) drives the sort order within
each Needs-Attention subgroup and the Closed list.

A separate `agents` table, keyed by phone number (the only reliably-unique
agent identifier available — see the Schema section above), is
created/updated lazily whenever a listing is marked `contacted` (initial
or follow-up). Both pages cross-reference it to warn (an amber badge) when
you're about to — or already have — messaged an agent about a different
listing than the one you contacted them about; matching is phone-based,
not name-based, since the same person's name can vary slightly across
listings.

## Deploying

- Push this repo to GitHub and import it into Vercel.
- Add the Neon integration (or point `DATABASE_URL` at your existing Neon
  project) and set the other env vars from `.env.local.example` in the
  Vercel project settings — set `USE_MOCK_ZILLAPI=false` (or leave it
  unset) in production.
- `vercel.json` already declares the daily cron (`0 13 * * *` — 13:00 UTC;
  Hobby only guarantees it fires sometime within that hour). Editing the
  schedule requires a redeploy.
- Turn on Vercel's built-in Deployment Protection (Project Settings →
  Deployment Protection) so the dashboard isn't fully open to the public —
  there's no app-level auth here since it's single-user.
- Heads up: Vercel's Hobby plan is meant for personal, non-commercial
  projects. This is a personal tool you use for your own freelance
  business — a gray area rather than a clear violation, but worth knowing
  if you ever want to be fully clean on that front (Vercel Pro removes the
  ambiguity).
