# Proof Sheet

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
   - `SEARCH_BBOX` — already set to the Oregon-wide box you gave me
     (`west,south,east,north`); narrow it if you want a smaller area
   - `SEARCH_PRICE_MIN` — already set to `300000`
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

## Mock mode — don't burn your free-tier credits

Zillapi's free tier is 100 credits total, no top-ups, and every listing
returned costs a credit. To avoid spending credits on repeated local
testing:

1. Set `USE_MOCK_ZILLAPI=false` and call the sync route **once** for real.
2. Open the response (or check your Zillapi dashboard/logs) and compare the
   actual field names to the ones assumed in [`src/lib/zillapi.ts`](src/lib/zillapi.ts)
   (`normalizeListing`). Zillapi's docs don't fully specify the response
   shape for `/v1/listings`, so this file guesses at common field names
   (`address` vs `streetAddress`, `datePostedString` vs `listedDate`, etc.)
   and falls back gracefully if a field is missing — but it's worth a real
   look before relying on it.
3. Update [`data/mock-listings.json`](data/mock-listings.json) with a
   couple of real (or corrected) example listings if the shape differed
   from the placeholder data that's there now.
4. Set `USE_MOCK_ZILLAPI=true` (already the default in
   `.env.local.example`) and leave it that way for all further local dev —
   the sync route will read from the JSON fixture instead of calling the
   live API.

Only flip it back to `false` when you want to test against the real API
again (e.g. before a production deploy, or when re-checking the field
mapping).

## Credit-cost notes (for future you)

- 1 credit per listing returned, minimum 1 per call. Failed calls are free.
- `days_on_zillow=1` is what makes this cheap — it returns only listings
  posted in roughly the last day, not the whole active inventory in the
  bbox. Don't remove it or replace it with a full-inventory pull + diff.
- `max_items` is capped at 50 in the sync route (`MAX_ITEMS` in
  [`src/app/api/cron/sync-listings/route.ts`](src/app/api/cron/sync-listings/route.ts))
  as a safety net, but daily usage should normally be far under that — it's
  bounded by how many homes actually list per day in the bbox.
- Free tier: 100 credits, no card, no top-ups. Paid: $5/mo for 1,000
  credits, or $54/yr for 12,000. At roughly 1 credit/listing/day this
  should last a long time on a single bbox.
- Zillapi doesn't document a for-sale-by-owner exclusion filter, so FSBO
  listings are not filtered out — you'll see them in the leads list.

## Schema

Single `listings` table, deduped by `zpid` (unique constraint; the sync
route upserts with `ON CONFLICT DO NOTHING`). Columns `score`,
`score_reasoning`, `status`, and `notes` are present but unused — reserved
for Phase 2 (AI photo scoring, outreach, pipeline tracking) so that work
won't need a migration.

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
