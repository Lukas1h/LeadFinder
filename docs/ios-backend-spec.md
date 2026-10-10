# Spec: login for the web app + JSON API for the iPhone app

Phases 0 and 1 of `docs/ios-app-plan.md`. Both are server-side only, in this Next.js repo; nothing here needs a Mac. When this is done:

- the admin web app requires a password; and
- `/api/app/v1/*` serves everything the SwiftUI app needs, behind a bearer token.

## Ground rules for the implementing agent

- **Next.js 16 is not the Next.js you know.** Read `AGENTS.md`. Then read these docs in `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/`:
  - `proxy.md`: Proxy, formerly Middleware. It runs on the **Node.js runtime**, so `node:crypto` is fine.
  - `route.md`: Route Handlers.

  The app uses Cache Components (`cacheComponents: true`). Never add `"use cache"`.
- **Don't commit, push or deploy. Don't touch Vercel env vars, and don't run `npm run db:push`.** No schema change is needed. If you think one is, stop and say why. Claude reviews, commits and ships.
- **This app reaches real people.** Nothing in this spec sends an email or text, and nothing may. Don't call any email-sending code, the queue's send paths, or the LeadFinder MCP's send tools.
- **`.env.local` points at the live production database.**
  - Calling the GET endpoints locally is fine.
  - Don't call any write endpoint, with one exception: the reminder test in *Acceptance*. Create one test reminder and delete it again.
- **Uncommitted files belong to Lukas.** Don't edit, format or revert files you didn't need to touch: `package.json`, `package-lock.json`, `tsconfig.json`, `.claude/agents/lead-assistant.md`, and anything untracked.
- **Match the surrounding code.** Comments explain *why*, at the same density as nearby code. Use the existing ui components (`src/components/ui/*`) and the same idioms.
- **Reuse, don't re-implement.** Every endpoint calls the same functions the web pages and server actions use. Where page logic is inline, extract it into a shared module so the page and the API call the same code. This matters: an earlier Expo attempt (branch `mobile-app`, never merged) re-implemented grouping in the client and drifted.
- **Functions from `"use server"` files can be called directly from Route Handlers.** Their `revalidatePath` calls work there too. Don't add `updateTag`; it only works in Server Actions.
- **Values from a `"use client"` module can't be imported on the server** (`BookedList.tsx`, `FollowUpList.tsx`, `badges.tsx`). You get a client reference, not the value. `import type` is fine. Shared pure logic goes in a plain module.

---

## Part A: login gate (Phase 0)

### Why

The custom domain `realestate.lukashahn.art` serves the whole admin app to anyone: `curl https://realestate.lukashahn.art/agents` returns 200 with agent phone numbers. Server actions, which change data, are reachable the same way. The `*.vercel.app` URLs are behind Vercel SSO, but the custom domain isn't.

`gallery.lukashahn.art` serves client galleries. It must keep working exactly as it does now.

### A1. Env vars

| Name | What |
|---|---|
| `ADMIN_PASSWORD` | The password Lukas types once per browser |
| `SESSION_SECRET` | Random string (≥32 chars) used to sign the cookie. Rotating it signs everything out |

- **Local dev** (`NODE_ENV !== "production"`): if either var is unset, the gate is off and everything works as today.
- **Production:** if either var is unset, fail closed. Gated requests are refused, and `/login` says which var is missing.

Claude adds both vars to Vercel at deploy time.

### A2. `src/lib/adminSession.ts` (new, server-only)

```ts
export const SESSION_COOKIE = "lf_session";
export const SESSION_MAX_AGE = 400 * 24 * 60 * 60; // browsers cap cookie lifetime at 400 days
export function authGateEnabled(): boolean;         // see A1
export function authMisconfigured(): string | null; // production + missing var -> its name
export function sessionToken(): string | null;      // base64url HMAC-SHA256(SESSION_SECRET, "lf-admin-v1")
export function isValidSession(cookieValue: string | undefined): boolean; // timingSafeEqual against sessionToken()
export function checkPassword(input: string): boolean; // sha256 both sides, then timingSafeEqual (equal lengths)
```

Use `node:crypto` (`createHmac`, `createHash`, `timingSafeEqual`).

### A3. `src/proxy.ts`

- The gallery-host branch (`isGalleryHost`) stays exactly as it is.
- In the admin-host branch, add the gate **before** the existing `/gallery/` handling.

**Paths that stay public** (no cookie needed). Each one already has its own protection, or is a static file:

| Path | Why it stays open |
|---|---|
| `/login` | The sign-in page and its Server Action POST |
| `/gallery/…` | Client galleries opened on an admin domain (existing chrome-less behavior unchanged) |
| `/api/gallery/…` | Client downloads, gated by gallery token |
| `/api/unsubscribe` | Signed token in the URL |
| `/api/webhooks/…` | Svix-signed (AgentMail) |
| `/api/cron/…` | `CRON_SECRET` |
| `/api/import-listing` | `IMPORT_SHARE_SECRET`. Called by an iOS Shortcut, which sends no cookies |
| `/api/mcp` | `MCP_SHARE_SECRET`. The claude.ai connector |
| `/api/compose/cold-outreach` | `COMPOSE_BATCH_SECRET` |
| `/api/app/…` | `MOBILE_API_SECRET` (Part B) |
| `/api/agents/<id>/vcard`, `/api/bookings/<id>/calendar` | iOS hands these files to its Contacts and Calendar sheets, which may fetch without the web app's cookie. Unguessable UUIDs, as today |
| `/.well-known/…` | MCP and OAuth discovery probes should keep getting a plain 404, not a login page |
| Static files | Any path outside `/api/` whose last segment has a file extension (`/sw.js`, `/icon-192.png`, `/apple-touch-icon.png`, `/splash/*`) |

The matcher already skips `_next/static`, `_next/image`, `favicon.ico`, `manifest.webmanifest` and `icon.svg`.

**Everything else** needs a valid `lf_session` cookie (`isValidSession`). When it's missing or invalid:

- `/api/*`, or any method other than GET/HEAD (Server Actions are POSTs): return `401 {"error":"unauthorized"}`.
- Otherwise: `307` to `/login?next=<encodeURIComponent(pathname + search)>`.

**`/login` itself:**

- Pass it through with the existing chrome-less header (`markGalleryView`), so `layout.tsx` doesn't wrap it in the app's nav. Update the comment on `GALLERY_VIEW_HEADER` to say it also covers the login page.
- If the visitor already has a valid cookie, redirect to `next` (when it's safe, see A4) or `/`.

### A4. Login page and actions

**`src/app/login/page.tsx`:** a small centered card with:

- "LeadFinder" as the title.
- A hidden username field: `name="username"`, `autoComplete="username"`, value `lukas`. It lets iOS Keychain offer to save the password.
- A password `Input`: `type="password"`, `autoComplete="current-password"`, autofocus.
- A **Sign in** button.

It also shows:

- "Wrong password" when `?error=1`.
- The `authMisconfigured()` message when that returns a name.

`searchParams` is request-time data, so follow the Cache Components rules (read inside a `<Suspense>` boundary, as other pages here do).

**`src/app/login/actions.ts`** (`"use server"`):

- `signIn(formData)`:
  - On a wrong password: wait about 1 s, then `redirect("/login?error=1&next=…")`.
  - On success: `(await cookies()).set(SESSION_COOKIE, sessionToken(), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: SESSION_MAX_AGE })`, then `redirect(safeNext)`.
  - `safeNext` must start with `/`. It must not start with `//` or `/login`. Otherwise use `/`.
- `signOut()`: deletes the cookie, then `redirect("/login")`.

**Settings page:** add a small **Sign out** button at the bottom that calls `signOut`.

> Note for Lukas: the home-screen web app and Safari keep separate cookies. Sign in once in each. The cookie lasts 400 days.

---

## Part B: JSON API for the iPhone app (Phase 1)

### B1. Auth

`src/lib/appApiAuth.ts`:

- `requireAppAuth(req: Request): Response | null`.
- It accepts only `Authorization: Bearer <MOBILE_API_SECRET>`, compared with `timingSafeEqual`.
- Missing var or bad header: `401 {"error":"unauthorized"}`.

`MOBILE_API_SECRET` already exists on Vercel and in `.env.local`. It was left over from the unmerged Expo branch. Reuse it; don't create a new var.

Every handler starts with `const denied = requireAppAuth(req); if (denied) return denied;`.

### B2. Conventions

- **Routes:** under `src/app/api/app/v1/`.
- **Responses:** JSON via `NextResponse.json`. Dates come out as ISO strings.
- **Route params:** `{ params }: { params: Promise<{ id: string }> }`, as in the existing routes.
- **Ids:** check the UUID format before querying. A malformed or unknown id returns `404 {"error":"not found"}`.
- **Bad bodies:** a bad JSON body or enum returns `400 {"error":"<what's wrong>"}`. Validate enums against the arrays in `src/db/schema.ts` (`PRESET_TYPES`, `INTERACTION_CHANNELS`, `AGENT_RELATIONSHIP_STATUSES`, …).
- **Successful writes:** return `{ "ok": true, … }`.
- **Timeouts:** routes that call Gemini (`ai-draft`, and `message-options` to be safe) export `maxDuration = 60`.
- **No CORS.** The client is a native app.

### B3. Shared code to extract (web pages must render exactly as before)

1. **`src/app/leads-data.ts` → `getLeadsBoard()`.**
   - Move the data half of `LeadsContent` in `src/app/page.tsx` into it. That's the queries through the `known` and `sections` sort, `agentCount`, `contactLine`, and `addressById`.
   - It returns:
     - `known`
     - `sections: Record<LeadSection, LeadGroup[]>`
     - `openLeadCount`, `queuedCount`, `agentCount`
     - `addressById`
   - `LeadGroup` is today's `AgentGroupRow` plus `contactLine: string | null`.
   - `page.tsx` calls it and keeps all its JSX.
2. **`src/app/booked/data.ts`:**
   - `loadBookingsWithDetails()`: the query and mapping now inline in `src/app/booked/page.tsx`. Also add `contactAgentId` to `BookingWithDetails` and fill it here and in `getBookingWithDetails` / `getAgentBookings`.
   - `groupBookings(list)`: the upcoming / waiting / completed filters and sorts from `BookedList.tsx`'s `useMemo`, as a pure function in a plain module.

   `BookedList.tsx` and the page both use these.
3. **`src/app/follow-up/groups.ts`:** move the `GROUPS` array out of `FollowUpList.tsx` (labels plus `match`) into a plain module. Both the list and the API import it.

### B4. Serializers: `src/app/api/app/v1/serialize.ts`

- **`listingJson(l: Listing, photos: "first" | "all")`**
  - Every column except `altZpids`.
  - `bedrooms` and `bathrooms` as `number | null`. They're Postgres `numeric`, so they arrive as strings.
  - `photos` is trimmed to the first one for list endpoints. Detail endpoints send all of them.
- **`leadBadges(lead, agent, declinedAddress)`** returns `{ kind, label, detail? }[]`. The badges and their order are the same ones `card()` renders in `src/app/page.tsx`:

  | kind | label | detail |
  |---|---|---|
  | `new` | New | |
  | `comingSoon` | Coming soon | |
  | `priceCut` | as `PriceCutBadge` | its tooltip text |
  | `fewPhotos` | "Only N photos". Only when `photoCount < FEW_PHOTOS_THRESHOLD` | |
  | `photoScore` | the `PhotoScoreBadge` tier label | `scoreReasoning` |
  | `unscored` | "Photos not scored". Enough photos to judge but no score, because scoring failed (added 2026-10-10) | why it's under Photo anyway |
  | `officeClient` | "Same office as Roger" | which job and brokerage |
  | `builder` | Builder (`isBuilderListing`) | |
  | `declined` | as `AgentDeclinedBadge` | the duplicate address |

  `badges.tsx` is a client module. Either copy the label logic into the helper with a comment pointing back to `badges.tsx`, or move the pure label functions into a plain `src/lib/leadBadges.ts` that both use. The second is preferred if it stays small.
- **`bookingJson(b: BookingWithDetails)`:** the object, plus:
  - `total`: sum of the line items.
  - `listing`: `listingJson(…, "first")`.
  - `mapsQuery`: `"<address>, <city>, <state>"`, skipping empty parts.
  - `galleryUrl`: `https://gallery.lukashahn.art/<galleryToken>`, or null.
- **`callerLabel(agent, brokerage)`**:
  - Format: `"<name ?? "Unknown agent"> · <tag>"`.
  - Tags by relationship status:
    - `regular` and `worked_once` → `Client`
    - `interested` → `Interested`
    - `warm` → `Warm`
    - `declined` → `Declined`
    - `cold` → the brokerage, or `Realtor` if there isn't one
- **`callerNumber(phone)`:** `1` followed by the 10 digits, as a JS number (e.g. `15415551234`). Null unless the phone has exactly 10 digits after stripping a leading 1. This is the E.164 number iOS caller ID wants.

### B5. Endpoints

All paths are relative to `/api/app/v1`.

#### Reads

| Method & path | Calls | Response |
|---|---|---|
| `GET /ping` | | `{ ok: true, serverTime }`. The app uses it to check its token |
| `GET /leads` | `getLeadsBoard()` | See below |
| `GET /follow-up` | `getFollowUpBoard()` + `groups.ts` | `{ news: [{ agent, lastReplyAt, listing, headline }], justListed: [{ agent, lastReplyAt, listing }], groups: [{ label, entries: [{ agent, lastReplyAt }] }] }`. Empty groups are omitted. `news` (added 2026-10-10) is agents with a listing, or a home Lukas shot for them, that just went under contract or sold, found by the nightly market check (`lib/marketStatus.ts`); `headline` is the wording to show, e.g. "Pending since Oct 5". `listing` is null for a job booked by address alone, and the headline then carries the address: "753 SE Haynes Ave · Pending since Oct 7 · you shot it" |
| `GET /schedule` | `loadScheduleItems(todayScheduleDate())` | `{ today, items }`. Each item as-is, but `listing` goes through `listingJson(…,"first")` |
| `GET /bookings` | `loadBookingsWithDetails()` + `groupBookings()` | `{ upcoming, waitingForPayment, completed }`, each `bookingJson[]` |
| `GET /bookings/:id` | `getBookingWithDetails`, `getGalleryActivity` | `{ booking, galleryActivity }` |
| `GET /bookings/:id/invoice` | the `GET` exported by `src/app/api/bookings/[id]/invoice/route.ts` | Its HTML response, unchanged. Comment: like the web's "Create invoice", opening it assigns the invoice number the first time |
| `GET /agents` | `agents` + latest `brokerName` per agent | `{ agents: [{ id, name, phone, email, relationshipStatus, lastContactedAt, brokerage, callerNumber, callerLabel }] }`, sorted by name (nulls last). Sets `ETag` (sha1 of the body). Returns `304` when `If-None-Match` matches |
| `GET /caller-id` | same data | `{ version, entries: [[callerNumber, callerLabel], …] }`, sorted **ascending** by number, one entry per number (first wins). `version` is the sha1 of `entries`. Same ETag/304 handling. iOS requires the ascending order |
| `GET /agents/:id` | `getAgentTimeline`, `getAgentListings`, `getAgentBookings` | `{ agent, brokerage, timeline, listings, bookings }` |
| `GET /listings/:id` | listing row + its agent (`agentId`) | `{ listing: listingJson(…,"all"), agent }` |
| `GET /listings/:id/message-options?type=` | `getMessageOptions(id, type)` | `{ presets }`. Includes the "AI Draft" placeholder (variantId `"draft"`, empty text), as in the web dialog |

**Brokerage per agent:** one query, e.g. `SELECT DISTINCT ON (agent_id) agent_id, broker_name FROM listings WHERE agent_id IS NOT NULL AND broker_name IS NOT NULL ORDER BY agent_id, found_at DESC`. Put it in a shared helper used by `/agents`, `/caller-id` and `/agents/:id`.

**`GET /leads` response:**

```jsonc
{
  "counts": { "agents": 0, "listings": 0, "queued": 0 },  // the same numbers as the web Leads header
  "sections": [                                            // display order; empty sections omitted
    { "key": "known", "label": "Agents you know", "collapsed": false, "groups": [/* LeadGroupJson */] },
    { "key": "photo", "label": "Photo opportunities", "collapsed": false, "groups": [] },
    // … video, backup, texted ("Texted before": a cold agent already texted, more than a week ago),
    // then unlikely (collapsed: true), using LEAD_SECTION_LABELS. Render whatever keys arrive.
  ]
}
// LeadGroupJson
{
  "key": "…", "agent": {/* Agent row */} | null,
  "agentName": "…", "agentPhone": "…", "brokerName": "…",   // from the best listing, as the web card
  "contactLine": "Texted Oct 5" | null,
  "knownGroup": "clients" | "interested" | "warm" | null,
  "section": "photo",
  "best": {/* listingJson, with the card's sampled photos and "driveTime": "~1h 30m drive" | null */},
  "badges": [/* leadBadges(best) */],
  "others": [/* listingJson first */],
  "listingIds": ["…"]                                      // every listing in the group, for Pass
}
```

#### Writes

Every write calls the existing function, which already revalidates the web pages.

| Method & path | Body | Calls |
|---|---|---|
| `POST /listings/status` | `{ listingIds: string[], status: "passed" \| "saved" }` | Same as `LeadActions`: `passed` with more than one id → `markListingsPassed(ids)`. Otherwise `updateListingStatus(id, status)` for each |
| `POST /listings/:id/ai-draft` | `{ type, instruction? }` | `draftAiPresetOption` → `{ option }` |
| `POST /listings/:id/texts` | `{ type, presetId, variantId, text }` | `sendMessage(id, type, presetId, variantId, text)`, then, if it returned a `pendingInteractionId`, `resolvePendingInteraction(that, "sent")`. Returns `{ ok, interactionId }` |
| `POST /agents/:id/texts` | `{}` | `startPendingInteraction({ agentId, channel: "text" })`, then `resolvePendingInteraction(id, "sent")` |
| `POST /agents/:id/interactions` | `{ channel, direction, outcome?, note?, listingId?, occurredAt? }` | `logInteraction` |
| `PATCH /agents/:id` | `{ notes?, relationshipStatus? }` | `updateAgentNotes` / `updateAgentRelationshipStatus`. Returns `{ ok, agent }` |
| `POST /agents/:id/snooze` | | `dismissFollowUpAgent` |
| `POST /bookings/:id/invoice-sent` | | `markInvoiceSent` |
| `POST /bookings/:id/complete` | `{ driveHours, editingHours, shootingHours, logisticsHours, additionalCosts }` (number or null each) | `markBookingCompleted` |
| `POST /bookings/:id/reopen` | | `reopenBooking` |
| `POST /reminders` | `ReminderInput` | `createReminder`. Its `{ error }` → 400 |
| `PUT /reminders/:id` | `ReminderInput` | `updateReminder` |
| `POST /reminders/:id/done` | `{ done: boolean }` | `setReminderDone` |
| `DELETE /reminders/:id` | | `deleteReminder` |
| `POST /schedule/follow-ups/:listingId/dismiss` | | `dismissListingFollowUp` → `{ ok, previous }` (`previous` lets the app offer Undo) |
| `POST /schedule/follow-ups/:listingId/restore` | `{ followUpAt, followUpNote }` | `restoreListingFollowUp` |

**Why the text endpoints confirm the text at once (`POST /listings/:id/texts`, `POST /agents/:id/texts`):** both mean "the native Messages sheet reported the text was sent". The web parks a text as pending and asks later, because an `sms:` link can't report back. The native composer does report back, so these endpoints confirm the text immediately and nothing lands in the web's "did you send it?" prompt. Put this in a comment.

#### Quick actions and templates (added 2026-10-10)

A text template lists other templates as **quick actions**: the buttons on a message sent from it. This replaces the single "Send samples" email (`followUpEmail` and `POST /messages/:id/samples` still work for older builds, and mean the first email quick action).

`GET /messages/:id` now also returns:

```jsonc
"quickActions": [            // in the order to show them; may be empty
  {
    "presetId": "…", "name": "Send contact",
    "channel": "sms" | "email",
    "variantId": "…",
    "text": "Here's my contact if you want to save it.",   // rendered for this agent and listing
    "subject": null,                                         // email only
    "attachments": [{ "id": "…", "filename": "Lukas Hahn.vcf", "contentType": "text/vcard", "size": 240 }]
  }
]
```

| Method & path | Body | What it does |
|---|---|---|
| `POST /messages/:id/quick-actions/:presetId` | email: `{ email? }`. sms: `{ variantId }` | **email: sends real email** (`sendQuickActionEmail`) to the address on file, or to `email` when there is none; show a confirm naming the template and address first. **sms: sends nothing**; call it only after `MFMessageComposeViewController` reports `.sent`, to record the text (`recordQuickActionText`). Returns `{ ok, note }` |
| `GET /presets` | | `{ presets: [PresetSummary] }`, every template that isn't archived (`listPresets`) |
| `PATCH /presets/:id` | any of `{ name, enabled, secondMessage, quickActionPresetIds }` | `patchPreset`. `quickActionPresetIds` is the whole ordered list. Returns `{ preset }` |
| `POST /presets/:id/variants` | `{ label, body, subject? }` | `createVariant` |
| `PATCH /presets/variants/:variantId` | `{ label, body, subject? }` and/or `{ enabled }` | `updateVariant` / `toggleVariant` |
| `POST /presets/:id/attachments` | **the file's raw bytes** (not JSON). `Content-Type` is the file's type; `X-Filename` is its name, percent-encoded | Adds it. 4 MB max, one file per request. Returns `{ attachments }` |
| `GET /presets/:id/attachments/:attachmentId` | | The file's bytes. Immutable: cache on disk by attachment id |
| `DELETE /presets/:id/attachments/:attachmentId` | | Removes it |

```jsonc
// PresetSummary
{
  "id": "…", "name": "Backup Option",
  "type": "initial_outreach" | "follow_up", "channel": "sms" | "email",
  "enabled": true, "aiGenerated": false, "protected": false,
  "secondMessage": "…" | null,
  "quickActionPresetIds": ["…"],
  "quickActionOnly": false,       // true: only ever a quick action (the vCard, the photos), never in a send dialog
  "attachments": [{ "id": "…", "filename": "…", "contentType": "…", "size": 0 }],
  "variants": [{ "id": "…", "label": "A", "subject": null, "body": "…", "enabled": true }]   // empty for an AI draft
}
```

**Sending a text quick action:** fetch each attachment (cache by id), then present the composer with the recipient, `text` as the body, and `addAttachmentData(data, typeIdentifier:, filename:)` for each file. On `.sent`, `POST …/quick-actions/:presetId` with the `variantId`. On cancel, record nothing. A template that is switched off, or has no enabled variant, is left out of `quickActions`, which is how "Photo samples" stays hidden until it has photos and is switched on.

**Which templates can be picked as a quick action:** enabled, not `aiGenerated`, not `protected`, and either `type == "follow_up"` or `quickActionOnly` (the web's rule, `messaging/page.tsx`). Never the template itself.

---

## Acceptance (run locally, report the output)

Use `npm run dev` on port 3000. Load the token with `export T=$(grep ^MOBILE_API_SECRET= .env.local | cut -d= -f2- | tr -d '"')`.

**Gate on:** start dev with `ADMIN_PASSWORD=test SESSION_SECRET=dev-secret-0123456789abcdef0123456789 npm run dev`.

1. `curl -sI localhost:3000/agents` → `307`, `location: /login?next=%2Fagents`.
2. `curl -s -o /dev/null -w "%{http_code}" -X POST localhost:3000/agents` → `401`.
3. `curl -sI localhost:3000/login`, `/sw.js`, `/icon-192.png` → `200`.
4. `curl -sI -H "Host: gallery.lukashahn.art" localhost:3000/` → `307` to `https://lukashahn.art/real-estate` (unchanged).
5. `/api/unsubscribe` and `/api/mcp` answer with their own responses, not a redirect to `/login`.
6. Get the cookie value from a one-off `tsx` call to `sessionToken()` with the same env. Then `curl -sI -b "lf_session=<value>" localhost:3000/agents` → `200`. A wrong value → `307`.
7. If you have a browser: sign in through `/login` with `test`. Confirm the redirect to `next` and that Sign out works.

**Gate off:** restart without the two vars. `/agents` → `200`, as today.

**API:**

8. `curl -s localhost:3000/api/app/v1/ping` → `401`. With `-H "Authorization: Bearer $T"` → `{ "ok": true, … }`.
9. Every GET in B5 returns `200` JSON. Report each one's size and `curl -w "%{time_total}"`.
   - Use real ids taken from `/leads`, `/bookings` and `/agents` for the `:id` routes.
   - The `/leads` counts must match the web Leads header ("N agents · M listings").
10. `/agents` twice, the second time with `-H "If-None-Match: <etag>"` → `304`.
11. `/caller-id`:
    - Entries are strictly ascending.
    - The count is within a few of the number of agents whose phone has 10 digits. That's about 6,000, so it's a sanity check, not an exact match.
    - Print 3 sample labels.
12. Bad input → `400`: `/listings/<id>/message-options?type=bogus`. Malformed id → `404`: `/agents/not-a-uuid`.
13. Reminder round-trip, the only write you may run:
    - `POST /reminders {"title":"API test - delete me","date":"<today>"}`
    - Find it in `/schedule`.
    - `POST /reminders/<id>/done {"done":true}`
    - `DELETE /reminders/<id>`
    - Confirm it's gone.

    Get `<id>` from `/schedule`'s `reminderId`.

**Build:** `npx tsc --noEmit`, `npx eslint` on the files you touched, and `npx next build`, all clean.

**Pages unchanged:** with the gate off, `/`, `/booked` and `/follow-up` render as before. Compare section headings and counts in the HTML before and after your change.

**Report back:**
- Files added and changed.
- The output of each check above (trimmed).
- Anything you skipped or changed from this spec, and why. If an endpoint's shape changed, update this file to match.
