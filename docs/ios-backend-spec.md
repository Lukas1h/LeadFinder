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
| `GET /follow-up` | `getFollowUpBoard()` | `{ today: [Item], later: [Item], doneToday, dailyTarget, news, justListed, groups }`. See "The Follow up page" below |
| `GET /schedule` | `loadScheduleItems(todayScheduleDate())` | `{ today, items }`. Each item as-is, but `listing` goes through `listingJson(…,"first")` |
| `GET /bookings` | `loadBookingsWithDetails()` + `groupBookings()` | `{ upcoming, tentative, editing, waitingForPayment, completed }`, each `bookingJson[]`. `editing` is shot but not invoiced yet (`shotAt` set, photos still being edited), oldest shoot first; those are no longer in `upcoming`. Show it as "Editing" between Upcoming and Waiting for payment. Each section header shows its total (line items minus `additionalCosts`, as the web does). `tentative` is the part of `upcoming` with `dateTentative: true` (the agent said yes but no day is settled; `jobDate` is a placeholder or null), longest since `contactLastContactedAt` first. Show it as "Tentative" above Upcoming and leave those out of Upcoming. `GET /schedule` leaves tentative bookings out, and the app shouldn't schedule notifications for them. `PATCH /bookings/:id` and `POST /bookings` take `dateTentative` (boolean) |
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
| `POST /bookings/:id/shot` | | `markBookingShot`: sets `shotAt`, moving the booking to Editing. `POST /bookings/:id/reopen` clears the latest step (completed, then invoice sent, then shot) |
| `POST /bookings/:id/invoice-sent` | | `markInvoiceSent` |
| `POST /bookings/:id/complete` | `{ editingHours, shootingHours, logisticsHours }` (number or null each). `driveHours` and `additionalCosts` are ignored since 2026-10-16: drive time and costs come from the job's trips and expenses (web Finances page). `bookingJson` still returns both, derived: `driveHours` is the job's share of its trips' drive time, `additionalCosts` its share of their gas plus its expenses (whole dollars), so `total − additionalCosts` is still the profit. The app should drop those two inputs from its completion and edit sheets. | `markBookingCompleted` |
| `POST /bookings/:id/reopen` | | `reopenBooking` |
| `POST /bookings/:id/airspace` | | `recheckBookingAirspace`: re-runs the FAA airspace check now, even when the address hasn't changed (an airport can start or stop offering LAANC), for the "Check again" button in the booking's airspace note. Always 200, with the same `{ summary }` / `{ error }` the web's action returns — a lookup that found nothing is an answer, not a bad request |
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

#### The goal card (added 2026-10-10)

`GET /messages` also returns `goal`, the web's GoalCard (`lib/goal.ts`): the monthly goal worked backwards into a steady weekly pace. Show it above the stats.

```jsonc
"goal": {
  "goal": 3000, "month": "October",
  "booked": 1820, "jobs": 8,            // jobs dated this month and their value
  "gap": 1180, "avgJob": 281, "jobsNeeded": 5,   // gap is 0 once the goal is met
  "rates": { "reply": 0.29, "interested": 0.24, "book": 0.14, "bookMeasured": true },
  "bookSample": { "booked": 7, "of": 33 },        // what rates.book rests on
  "interested": { "live": 39, "needed": 51 },     // in touch in the last 30 days; needed per month
  "plan": {
    "repeat": 950,               // this month's work from people who had booked before
    "newRevenue": 2050,          // what new clients have to bring in a month
    "firstJob": 297, "newClientsPerMonth": 6.9, "newClientsThisMonth": 3,
    "textsPerWeek": 171, "repliesPerWeek": 49      // the weekly targets
  },
  "note": "The estimate: repeat clients cover $950 of a month, …",   // show as is; don't rebuild it from the rates
  "thisWeek": { "textsToGo": 61, "repliesToGo": 12, "texts": 110, "replies": 37, "followUps": 20, "followUpsDue": 13 },
  "today": { "texts": 18, "textsTarget": 8 }
}
```

`today.textsTarget` is what was left of the week's texts this morning spread over the days left (Mon–Sat); Home shows it as "Texts N of M". `thisWeek.textsToGo` and `repliesToGo` are the weekly target less what this week has done, 0 once it's met (show "On pace"). The web's fourth stat is new clients (`plan.newClientsThisMonth`, "about N a month needed" from `plan.newClientsPerMonth` rounded up).

#### The Follow up page (reworked 2026-10-11)

Everyone Lukas knows who is due to hear from him, one entry per agent, already sorted: strongest reason first, then nearest, then whoever lists most. `today` is the next few, enough to bring the day to `dailyTarget` (5); `later` is the rest in the same order. `doneToday` counts people he got back in touch with after a gap today; a snooze isn't one, the next person moves up. Render `today` under "Today (2 of 5 done)" and `later` under "Later"; when `today` is empty and `doneToday >= dailyTarget`, say the day is done.

```jsonc
// Item
{
  "agent": {/* Agent */}, "lastReplyAt": "…" | null,
  "listing": {/* listingJson first */} | null,     // the listing the reason is about
  "headline": "Just listed Oct 9 with weak photos", // the reason, in the words to show
  "reason": "weak_photos" | "samples" | "just_listed" | "news" | "price_cut" | "quiet",
  "suggestion": "Hey Aisha! Saw Flowerdale went pending, congrats!!", // a text to start from; fill Messages with it
  "listingCount": 12,                // tracked listings, for the card's "12 listings"
  "avgDaysBetweenListings": 45 | null
}
```

Headlines read "Just listed Oct 9", "Samples sent Oct 3, no word since", "Pending since Oct 7, you shot it", "Price cut Oct 7, weak photos", "Quiet since Sep 20". For a home he shot that was booked by address alone, `listing` is null and the headline leads with the address. Show `quiet` muted and every other reason as a highlight. The rules behind each reason and the timers are in `src/app/follow-up/data.ts`.

`suggestion` is written by the server for the reason and the agent (`src/app/follow-up/suggest.ts`). Show it on the card, and open Messages with it as the body from the card's Text button; he edits and sends it, and a sent text is recorded with `POST /agents/:id/texts` as any other. The reason goes above the name, as on the web.

Nobody is on the page within 10 days of the last contact either way (clients excepted), and samples wait 14 days. The timer is one number per relationship: interested 14 days, warm 21, clients 28.

`droneOffers` is a trial section for the top of the page (he may drop it; `src/app/follow-up/droneOffers.ts`): `[{ "title": "Thu, Oct 15 · Klamath Falls trip (through Grants Pass, Medford)", "heldBack": 6, "items": [/* shaped like today's items, reason "drone", listing null */] }]`. Render it above Today under "Free drone shots this week", one sub-heading per group with the same cards, and when `heldBack` > 0 a line "N more you know here heard from you in the last 10 days." Omit the section when the array is empty or missing.

`upcoming` is everyone else he knows, soonest first: `[{ "agent": {...}, "dueAt": "2026-10-15T…" | null, "note": "Last contact Sep 24" }]`. Show it as a compact "Coming up (N)" list under Later, name, status and note on the left and the date on the right; a null `dueAt` reads "When they list or sell" (they stopped answering, so the timer no longer brings them back).

`POST /agents/:id/snooze` with `{ "days": 7 | 14 | 28 }` (no body: 7) takes someone off the page for that long. A listing or sale of theirs from after the snooze still brings them back early; when it ends, whatever is still current shows again. Offer the three lengths in a menu.

`news`, `justListed` and `groups` carry the same people in the shape builds from before this change read (`news` and `justListed` are Items; `groups` is `[{ label, entries: [{ agent, lastReplyAt }] }]`). New builds ignore them.

---

#### Finances (added 2026-10-16)

Mirrors the web's Finances pages (`src/app/finances`). Every number comes from `src/lib/finance/reports.ts`, the same functions the web pages render, so the app shows exactly what the web shows. Don't recompute any of it on the phone. Routes are in `src/app/api/app/v1/finances/`. Money is in dollars (floats; round for display). Dates are `"YYYY-MM-DD"` Pacific wall-clock strings, months `"YYYY-MM"`.

How the numbers work (show these short explanations in the UI where the web does):
- **Real profit** = revenue − gas − business expenses. A trip's gas is its miles ÷ MPG × the price per gallon on the latest gas receipt before it, not the gas receipts themselves (fill-ups also pay for personal driving).
- A trip's miles, gas and drive time split across its linked jobs by revenue. Expenses linked to a trip split the same way.
- **The tax view** = revenue − deductible expenses − the mileage deduction (the IRS rate for the trip's date: 72.5¢ through June 2026, 76¢ from July).
- **Hours** = the booking's shooting + editing + logistics hours plus its share of the drive.

| Method + path | Returns / body | Notes |
|---|---|---|
| `GET /finances` | `OverviewReport`: `{ month, year, thisMonth, yearToDate, yearTaxOwed, months, spend, mpg }`. `thisMonth`/`yearToDate` are `{ revenue, jobs, costs, gas, profit, hours, perHour, miles }`. `months` is newest first: `{ month, revenue, jobs, miles, gas, gasBought, costsByCategory, costs, profit, hours, perHour, mileageDeduction, deductibleExpenses }`. `spend` is this year's costs by category, biggest first: `{ category, label, amount }` | The Overview tab, and the source for the Home dashboard's money numbers |
| `GET /finances/jobs` | `{ jobs, multiJobDays }`. `jobs` (shot jobs, newest first): `{ bookingId, label, city, date, revenue, gas, expenses, profit, profitAfterCarWear, hours, perHour, miles, driveHours, mileageDeduction, tripIds }`. `multiJobDays`: `{ tripId, date, purpose, jobs: [{ bookingId, label }], miles, revenue, gas, expenses, hours, profit, perHour }` | `profitAfterCarWear` charges the IRS rate per mile instead of just gas |
| `GET /finances/trips` | `MileageReport`: `{ year, mpg, yearMiles, yearTrips, yearDeduction, yearGas, trips }`. Each trip: `{ id, date, purpose, category, stops, miles, driveMinutes, milesEstimated, notes, bookingIds, jobLabels, gallons, pricePerGallon, gas, rate, deduction }`. `stops` is one stop per line, home excluded | The Mileage tab |
| `POST /finances/trips` | `{ date, purpose, category, miles, stops?, driveMinutes?, milesEstimated?, notes?, bookingIds? }` → `{ ok, id }` | `category` is a value from `tripCategories`. Validation errors are 400 `{ error }` with a readable message |
| `PATCH /finances/trips/:id` | any of the POST fields → `{ ok, id }` | Fields not sent stay. `bookingIds`, when sent, replaces the links. Sending `miles` without `milesEstimated` clears the estimated flag |
| `DELETE /finances/trips/:id` | `{ ok }` | |
| `POST /finances/trips/:id/bookings` | `{ bookingId }` → `{ ok }` | Adds a job to a trip already logged (the second job of a two-job day). The web's booking detail offers "Same drive as …? Add to it" for trips on the job's date |
| `POST /finances/trips/estimate` | `{ stops: string[] }` → `{ miles, driveMinutes, approximate: string[] }` | Round trip from home through the stops. Takes a few seconds, so show a spinner. `approximate` lists stops routed to their town; mention them. Saves nothing |
| `GET /finances/expenses` | `{ expenses }`, newest first. Each: `{ id, date, amount, vendor, description, category, deductiblePercent, deductibleAmount, gallons, pricePerGallon, paidPersonally, spreadMonths, bookingId, tripId, receiptNumber, notes, hasReceipt, receiptPath, createdAt }` | `spreadMonths: 12` is a yearly charge ("Yearly" in the UI) |
| `GET /finances/expenses/:id` | `{ expense }` | |
| `POST /finances/expenses` | `{ date, amount, description, category, vendor?, deductiblePercent?, gallons?, pricePerGallon?, paidPersonally?, spreadMonths?, bookingId?, tripId?, notes? }` → `{ ok, expense }` | When the category changes, set `deductiblePercent` to that category's `deductible` from `expenseCategories` (the user can override it: 100, 50 or 0). Gallons and price per gallon only matter for `gas` |
| `PATCH /finances/expenses/:id` | any of the POST fields → `{ ok, expense }` | Fields not sent stay |
| `DELETE /finances/expenses/:id` | `{ ok }` | Deletes its receipt too |
| `PUT /finances/expenses/:id/receipt` | Raw file body, `Content-Type: image/jpeg` or `application/pdf`, optional `?name=` → `{ ok, receiptNumber }` | Shrink photos to about 1800px on the long side, JPEG ~0.8, first: Vercel rejects bodies over 4.5 MB. The first receipt gives the expense the next receipt number |
| `GET /finances/expenses/:id/receipt` | the file | Bearer auth like every route, so load it with the API client, not a plain URL |
| `POST /finances/receipts/read` | Raw file body (same as above) → `{ date, amount, vendor, description, category, gallons, pricePerGallon }`, any null | Gemini reads the receipt. Use it for the "photo a receipt" flow: shrink, read, prefill the form, let him check it, POST the expense, then PUT the same file as its receipt. Saves nothing on its own |
| `GET /finances/taxes?year=` | `TaxReport`: `{ year, revenue, deductibleExpenses, mileageDeduction, miles, taxableProfit, otherWagesYearly, tax: { selfEmployment, federal, oregon, total }, effectiveRate, deductions, saved, savedByMileage, marginalRate, settings: { mpg, otherWagesMonthly } }` | Label it an estimate, as the web does. `marginalRate` is the tax on the next dollar of profit |
| `GET /finances/settings` · `PATCH /finances/settings` | `{ mpg, otherWagesMonthly }` (PATCH takes either or both) | |
| `GET /finances/link-options` | `{ bookings: [{ id, label, date }], trips: [{ id, date, purpose, miles, bookingIds }], expenseCategories: [{ value, label, deductible, hint }], tripCategories: [{ value, label }] }` | The pickers in the expense and trip forms. Use these lists, don't hard-code categories |

`bookingJson` also carries `airspace` and `airspaceCheckedAt`: the drone airspace at the address, checked by the server a few seconds after a booking is created or its address changes. `airspace` is `{ status: "uncontrolled" | "controlled", airspaces: [{ name, class }], ceilingFt, laanc, airport: { name, id } | null, lat, lng, approximate, place, summary }`. `controlled` (Class B, C, D or a Class E surface area) means Part 107 needs ATC authorization before flying: LAANC, or DroneZone when `laanc` is false or `ceilingFt` is 0. Show an amber "Class D airspace" tag (`airspaces[0].class`) on upcoming bookings when controlled and `summary` in the detail; uncontrolled is at most one muted line. `approximate` = the town center was checked, not the street. Null = no street address, not checked yet, or the check failed (`airspaceCheckedAt` set). The detail's note also offers "Check again" (`POST /bookings/:id/airspace`), which returns the fresh `summary` or the reason there isn't one.

`bookingJson` also carries `costs: { miles, gas, expenses, mileageDeduction, trips: [{ id, date, purpose, miles, driveMinutes, jobs }], expenseItems: [{ id, date, description, amount, deductiblePercent }] }` for the booking's "Time & money" section. The web shows it once a job is shot, or whenever it has a trip or an expense: hours, driving, each trip ("Oct 15 · 335 mi, split with 1 other job"), gas, each expense, then profit, per hour and the mileage deduction, with "Log the trip" (prefilled: the job's date, "Shoot for <contact>, <address>", the address as the stop, linked to the job) and "Add an expense" (prefilled with the job's date and linked to it).

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
