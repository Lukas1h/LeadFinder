---
name: new-market
description: Open (or kill) a subcontracting market/region — "open a new region", "add Boise", "start testing Spokane", "kill the Coast". Covers pricing, the market row and its shooters, Zillapi start-up ingest, Zillow saved-search email alerts set up in the Paseo browser (sized under Zillow's 10-item digest cap), the pricing sheet, and the check a few days later. Use whenever Lukas asks to create, set up, split, pause or kill a market or its search alerts.
---

# Opening a new market

A market is a row in the `markets` table (see docs/AGENT-GUIDE.md → Markets). Everything
else — Leads tab, quota, funnel row, {{area}} wording, prices, portfolio pages, iPhone tab —
follows from it. No code change, no deploy, no app update. Work through these steps in
order and tell Lukas what you did at each one. Never contact a real estate agent or a
shooter while doing this (CLAUDE.md).

## 1. Agree the basics with Lukas (ask, one message)

- Area: base town + state, and which counties/towns it covers.
- Shooter(s): name, home address, role (main/backup), what Lukas pays them per job
  (photo, photo+drone, video, drone), free drive minutes and any drive charge.
- Prices agents pay. Suggest a number: shooter photo rate + Lukas's editing margin,
  compared with Portland ($324 photos / $424 video, shooter $175 / $225) and the
  default ($300 / $400). Bigger metros can carry more.
- Jobs per week target (default 1 while testing).

## 2. Create the market and shooters (Markets page or the actions directly)

`/markets` → New market (label, key, state, base town, radius; the base is geocoded,
wording defaults to "in the <base> area"). Set prices there. Then Add shooter for each,
placed in the market, with home address and rates. Status starts as **Testing**.
Scripted equivalent: `saveMarket` / `saveShooter` in `src/app/markets/actions.ts`.
Check the towns: `marketFor` places a listing by its town (`cities`) or, for towns not
in the Winston drive table, by geocode inside the radius. Add towns with "Add town" if
the radius alone misses some.

## 3. Pricing sheet

If the prices differ from the default: `npx tsx scripts/market-pricing-sheets.mts` (dry
run), check the PDF with `--pdf-dir /tmp/sheets`, then `--write`. It tags the sheet with
the market on every template that carries the regular sheet.

## 4. Start-up ingest: Zillapi for the first 1–2 days

Zillow email alerts take a few days to start flowing, so fill the tab with Zillapi:
insert a `search_sources` row (`name`, `bbox` "west,south,east,north" around the area,
`price_min` matching the alert floor, `home_types` "house,condo,townhouse", `market` =
the market key, `coming_soon_only` true, `full_until` = now + 2 days). Until
`full_until` the nightly sync pulls every listing; after it, only coming-soon ones, by
itself. **Zillapi costs 1 credit per listing returned** — tell Lukas the rough count
first (Zillow's site: the area's for-sale count at that price floor) and get a yes.

## 5. Zillow saved-search email alerts (Paseo browser)

The alerts go to the leadfinder-zillow AgentMail inbox, which the webhook ingests.
Lukas's Zillow account is signed in to the Paseo browser; saved searches are at
https://www.zillow.com/myzillow/SavedSearches.

**The cap that matters:** each saved search sends one daily digest showing at most
**10 items**, and price cuts and open houses on old listings count against those 10.
Before 2026-11-25 the big Oregon counties lost 70–80% of their new listings this way.
So for every area create:

1. **"<County> - Just listed [band]"** searches with the **Days on Zillow = 1 day**
   filter (`filterState.doz = {value: "1"}`), so only brand-new listings match. Size
   each to **≤ ~5 new listings a day** (≈35 a week): measure with the "listed in the
   last 7 days" count for the county at the price floor, and split by price band
   (e.g. 375–450k / 450–600k / 600–800k / 800k+) until each band is ≤ ~35 a week.
2. One **"<County> - New"** search without the day filter, for price cuts (the
   price-cut feed reads them) — it will overflow in big counties; that's fine.
3. Optional **"<County> - Land"** (lots, $100k+).

Filters to copy from an existing "- New" search (open its link on the saved-searches
page and read `searchQueryState`): the county `regionSelection`, the price floor, and
the home-type exclusions (no apartments, manufactured, lots, multi-family; no auctions,
foreclosures, FSBO; active + coming soon). Fast way, as done on 2026-11-25: build the
`searchQueryState` JSON, open `https://www.zillow.com/homes/for_sale/?searchQueryState=…`,
click "Save search", rename it in the dialog (set the input's value with the native
setter + an `input` event), Update. Each one: frequency **Instant**, email on. Check the
list afterwards for names Zillow defaulted to "For Sale in …" and rename them.

Measuring volume from the signed-in page (no credits): `PUT
https://www.zillow.com/async-create-search-page-state` with `{searchQueryState,
wants: {cat1: ["listResults"]}}` returns `cat1.searchList.totalResultCount`.

Compass (free listing details for alert listings) covers Oregon and SW Washington
(RMLS); elsewhere it may miss, and alert listings fall back to Zillapi (1 credit each).

## 6. Check after 3–4 days

`npx tsx scripts/zillow-alert-health.mts` lists each saved search's digests from the
`alert_emails` table: new listings per day and how often its digest was truncated.
Any "Just listed" search truncated on more than a day or two → split its band. Also
check the market's Leads tab is filling and its cards show the shooter drive times.

## Killing or pausing a market

`/markets` → status Killed (or Paused). Its tab and quota disappear and its
`search_sources` stop syncing. Delete its Zillow saved searches in the Paseo browser
(they'd keep spending Compass/Zillapi lookups), after confirming with Lukas.
