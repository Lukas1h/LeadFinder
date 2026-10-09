# Compass "Coming Soon" listings in Oregon

`scripts/compass-coming-soon.mjs` prints every Oregon listing Compass shows as Coming Soon:
address, city, price, listing agent (name, phone, email), brokerage, photo count plus first 3
photo URLs, Compass URL and dates. Run with `--json` to get a JSON array instead. Investigated
2026-10-08.

```sh
node scripts/compass-coming-soon.mjs          # readable list, summary on stderr
node scripts/compass-coming-soon.mjs --json   # JSON array on stdout
```

## The two requests

### 1. Search: `POST /homes-for-sale/search/<location>/coming-soon/`

This is the XHR the page at `https://www.compass.com/homes-for-sale/oregon/coming-soon/` makes
(the "Coming Soon" status filter redirects there).

- **The URL path is the filter.** `oregon/coming-soon/` returns Coming Soon only. Plain
  `oregon/` returns everything active (~26,000). The `rawLolSearchQuery` the browser sends in the
  body is **ignored** by the server: changing `saleStatuses`, `num` or `start` in it changes
  nothing. The response echoes the query the path produced:
  `{"listingTypes":[2],"saleStatuses":[12],"num":41,"sortOrder":115,"locationIds":[192341]}`
  (sale status 12 = Coming Soon, 9 = Active; location 192341 = Oregon).
- **Body:** `{"searchResultId":"<any uuid>"}`. Without a `searchResultId` it answers
  `{"message":"Not Found","status":404}` (with HTTP 200).
- **Response:** `lolResults.totalItems` is the total count. `lolResults.data[].listing` has
  `listingIdSHA`, `title` (price), `subtitles[0]` (full address), `badges.cornerBadges` ("Coming
  Soon No Showing", "See It First", "Coldwell Banker Realty Coming Soon"), `media[]` (capped
  at 3 for some listings, so use the detail page for photo counts), `pageLink` and `status` (14
  for all of them). It also has a `comingSoon` facet count.
- **Pagination:** a fixed 41 per page, set by the path: `.../coming-soon/` then
  `.../coming-soon/p-2/`, `p-3/` and so on. A page past the end returns an HTML page instead of
  JSON. The script stops when a page has fewer than 41 results or `totalItems` is reached.
- Other locations should work the same way with Compass's location slug, such as
  `lane-county-or/coming-soon/`. That's untested; Oregon covers the whole state anyway.

### 2. Detail: `GET /listing/<listingIdSHA>/view`

This 301s to `/homedetails/<slug>/<id>_lid/` and works with a plain fetch: no cookie, no WAF.
`window.__INITIAL_DATA__.props.listingRelation.listing` has:

| Field | Use |
|---|---|
| `fullContacts[]` (`contactType: "Listing Agent"`) | `contactName`, `email`, `phone`, `mobile`, `company` (brokerage), `licenseNum` |
| `media[]` | every photo (`originalUrl`, `width`, `height`) |
| `localizedStatus`, `mlsStatus` | "Coming Soon No Showing" / `ComingSoonNoShowing` |
| `databaseSource.sourceDisplayName` | RMLS, Oregon Data Share, … |
| `price.lastKnown`, `location.*` | price, address, city, zip |
| `date` | `updated` is always present; `listed` is **absent on Coming Soon listings** |
| `dealInfo.courtesyOf` | "Listing Courtesy of <brokerage>" |

The JSON-LD `offeredBy` Person (name, telephone, email) is the fallback if `__INITIAL_DATA__` is
missing. It wasn't needed for any of the 51.

**Listed date:** none of the Coming Soon listings has one. `date.listed` is missing and the key
facts show "Days on Market: -". The script prints `listedDate` when present and otherwise
"not yet", plus `updatedDate` (when Compass last touched the record).

## Cookies and headers

The search endpoint is behind an **AWS WAF JavaScript challenge** (CloudFront). Without a
token, any request (page or XHR) gets `HTTP 202`, an empty body and
`x-amzn-waf-action: challenge`. It needs two cookies:

- `aws-waf-token`: issued after a real browser runs the WAF challenge script on any Compass
  search page. Its cookie expiry is about 4 days. The script launches headless Chrome via
  `puppeteer` (already a devDependency), loads the Oregon Coming Soon page once, reads the
  cookie, and caches it in `$TMPDIR/compass-waf-token.json`. If search starts getting challenged
  again, it fetches a fresh one. You can also skip the browser by copying the cookie from your
  own browser's devtools into `COMPASS_WAF_TOKEN=...`.
- `fingerprint`: any UUID. Without it Compass's app answers
  `403 {"message":"Empty fingerprint"}`.

**Not needed:** the `x-recaptcha-token` header the page sends, login, or any account. Only a
normal browser `user-agent` and `content-type: application/json` are required.

Detail pages and `POST /api/v3/omnisuggest/autocomplete` need none of this.

**Headless Chrome on Lukas's Linux box:** puppeteer's bundled Chrome is missing system libraries
(`libnss3`, `libnspr4`, `libatk-bridge2.0`, `libcups2`, `libxkbcommon0`, `libpango-1.0`,
`libcairo2`, `libxdamage1`, …). Either `sudo apt install` them, or (as done in this
investigation, without root) `apt-get download` the `.deb`s, `dpkg-deb -x` them into
`/tmp/chromelibs/root`, and run with
`LD_LIBRARY_PATH=/tmp/chromelibs/root/usr/lib/x86_64-linux-gnu`. Chrome is only needed about
once every 4 days, when the token expires.

## Rate limits

None seen. A full run is 2 search requests plus 51 detail requests at 1 request/second, and
two full runs back to back finished without a single 429 or 5xx. Response times were 0.3–1.5 s.
The script still spaces every request ≥ 1 s apart and backs off exponentially (or by
`Retry-After`) on 429/5xx, up to 5 retries. I did not probe for the actual limit.

## What it returned (2026-10-08)

- **51 Oregon Coming Soon listings.** `totalItems` was 51 and matched the page's `comingSoon`
  facet count. The page header says "88 homes" (`allHomesCount`), but the extra ones aren't in
  the list. They're presumably Private Exclusives, which only show a count.
- **51 / 51 have the listing agent's name, phone and email.**
- **50 / 51 have photos.** 30 have only 1–3 photos, 6 have 4–19, 14 have 20+, and 1 has none.
- Status: 49 are **"Coming Soon No Showing" from RMLS**, and 2 are **"Coming Soon" + "See It
  First"** (Coldwell Banker Realty, Oregon Data Share; Bend $620k and Prineville $1.5M, 3 photos
  each).
- Cities: Portland metro dominates (Portland 15, Beaverton 3, Tigard 2, …), then Eugene 7 and
  Springfield 2, plus Coos Bay, Cottage Grove, Bend, Prineville, The Dalles 2, McMinnville and
  others. None in Douglas County or the Rogue Valley. Prices run from $139,900 to $2,275,000.

### Caveat for lead gen

Most of these are **not** Compass-only. "Coming Soon No Showing" is an RMLS status: the listing
is already in the MLS feed, so Zillow and others can show it too. Only the 2 "See It First"
listings are Compass's own pre-MLS marketing. This is different from **Private Exclusives**,
which still show only counts and stay a dead end (see the 2026-09-27 note). What makes this feed
useful is the 30 listings sitting on 1–3 placeholder or phone photos, each with an agent email
attached.
