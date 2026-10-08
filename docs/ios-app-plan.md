# LeadFinder for iPhone: plan

Drafted 2026-10-08 on the Linux box. Building starts on the Mac. Lukas's decisions are in [Decisions](#decisions-2026-10-08).

## Why

Lukas does much of his work from his phone on the road. The PWA loads slowly and responds slowly to taps, partly because every tab is server-rendered on each visit, and `/agents` alone sends about 1.5 MB of HTML with all 8,900 agents in it. The native app opens straight to cached data and refreshes it in the background. It covers only what's useful away from the desk. Everything else stays on the web.

An Expo app was tried once (branch `mobile-app`, 2026-09-11, never merged). It re-implemented the leads grouping in the client, which then drifted from the web. **This time all business logic stays on the server and the app only renders what the API returns.**

## What goes where

### iPhone app (v1)

1. **Leads: the full list.** Same sections, order and badges as the web Leads page ("Agents you know", Photo, Video, Backup, then Unlikely, collapsed). Tap a lead to see its photos, price, the agent, and their history with Lukas. Swipe actions: **Text** and **Pass** (Pass covers every listing in that agent's group, as on the web).
2. **Texting agents.** Tapping Text loads the message options from the server: the same presets, A/B rotation and **Gemini AI draft** as the web dialog. Lukas picks one, edits it if he wants, and taps Send in the **native Messages sheet** (`MFMessageComposeViewController`).
   - The app logs the text only when the sheet reports `.sent`. That means no "did you send it?" prompt.
   - If the preset has a `secondMessage`, copy it to the clipboard on send, as the web does.
   - Texting also works from an agent's screen (Follow up, directory) with no listing attached. That opens a blank composer, as on the web.
3. **Follow up.** The same board as the web: Just listed, Past clients, Interested gone quiet, Warm. Text, or snooze for later.
4. **Log what happened.** Quick buttons on an agent: *replied, interested, not now, declined, called (answered / no answer / voicemail)*. Plus an editable notes field and the relationship status. This covers replies that come in through Messages, since the app can't read them. After a call (`tel:`), ask how it went when the app comes back to the foreground, as the web does.
5. **Schedule and bookings: everything.**
   - Today first, then upcoming: bookings, reminders and listing follow-ups (the same items as the web Schedule).
   - A booking shows the address with an **Apple Maps directions** button, the lockbox code, the on-site agent (call or text), notes, and the line items and total.
   - Booking actions:
     - **Mark invoice sent**
     - **Complete job**, with drive, editing, shooting and logistics hours plus additional costs, like the web dialog
     - **Reopen**
     - **View the invoice** (a web view, which can be shared as a PDF)
   - Reminders: add (quick, e.g. "text Lisa Tuesday"), edit, check off, delete.
   - Bookings list: Upcoming, Waiting for payment, Completed.
6. **Agent directory and caller ID.**
   - The directory is searchable by name, brokerage or **phone number digits**, and works offline.
   - **Caller ID only, nothing added to Contacts.** A Call Directory extension labels incoming calls from the ~6,000 agent numbers, e.g. "Jane Doe · Interested", "Jane Doe · Client", or "Jane Doe · Coldwell Banker" for agents he hasn't worked with. The server builds the labels.

### Stays web-only (desk work)

- Email: Queue, cold email compose, bulk sends, email presets and attachments.
- Messaging presets, A/B stats and variant editing.
- Pipeline kanban, imports, merging agents, bulk pass.
- Creating and editing bookings and line items, galleries, Dropbox.
- Settings, search sources, Develop.

**The phone app never sends anything by itself.** Texts go out only when Lukas taps Send in the Messages sheet. No email sending from the phone.

## Architecture

### Backend (Next.js, this repo): Phases 0–1

**Full spec: [`docs/ios-backend-spec.md`](ios-backend-spec.md).**
- A password login for the web app.
- `/api/app/v1/*`, behind `Authorization: Bearer <MOBILE_API_SECRET>`. The env var already exists from the Expo attempt.
- The endpoints call the same functions as the web pages. Inline page logic (Leads, Booked) is extracted so both share it.

### iOS app (SwiftUI): Phases 2–5

- **Stack:** current Xcode, Swift 6, SwiftUI. No third-party packages to start. Minimum iOS 18 (his iPhone 16e).
- **Location:** `ios/` in this repo, so one Claude session sees both the API and the app. Vercel ignores it.
- **Signing: free Apple ID ("Personal Team"), no paid program.** See [Free Apple account](#free-apple-account-what-it-means).
- **Config:** the API base URL (`https://realestate.lukashahn.art`) and `MOBILE_API_SECRET` go in a git-ignored `ios/Secrets.xcconfig` and reach both targets through Info.plist. Building them in means the caller ID extension can use them without sharing anything with the app.
- **Tabs:** Leads · Schedule · Messages · Agents. Two lists hang off the headers rather than taking a tab each, because four is already the most the bar should carry: **Follow up** off Agents (it is a board over agents) and **Bookings** off Schedule. Leads stays flat — no subpages. Every detail screen (lead, listing, agent, booking, message) is a **slide-up sheet**, not a pushed page: they are looks, not places you navigate away from. A dark theme close to the web app (`#111116`). Big rows and one-handed reach, with pull to refresh.
- **Booking stats** lead the Bookings page, ported from the web's `bookingMath.ts`: last 30 days, all time, average per booking, average per hour.
- **Messages.** The web's Messaging stats card, top templates, reply-rate-by-day chart and message history, on the phone. The web's two real send paths — "Send samples" and "Compose" — are deliberately **not** in the API, so the app cannot put mail in an agent's inbox. "Keep in touch" and "Declined" are there; they only record what happened. This is a change from the plan below, which had messaging web-only.
- **Offline-first:** each screen renders its last cached JSON (files in the app's container) immediately, then refreshes. This is the main speed fix. The directory uses the ETag, so it only downloads again when something changed.
- **Texting:** `MFMessageComposeViewController` with the recipient and body prefilled. On `.sent`, POST to the API. On `.cancelled`, nothing happens.
- **Caller ID:** a Call Directory extension (`CXCallDirectoryProvider`). It needs no special entitlement.
  - The extension downloads `GET /api/app/v1/caller-id` itself: entries already sorted ascending, as iOS requires, with labels built by the server. It adds them with `addIdentificationEntry`. Whether App Groups provision on a free account is unclear (Apple's own pages disagree), so this route avoids depending on them.
  - The main app calls `CXCallDirectoryManager.reloadExtension` after each sync, when the `version` changed.
  - Lukas turns it on once: Settings › Apps › Phone › Call Blocking & Identification › LeadFinder.
  - It only labels numbers that aren't in Contacts, and it doesn't affect Messages.
- **Calls and directions:** `tel:` links for calls; directions open Apple Maps with the booking's `mapsQuery`.
- **Local notifications** (no push needed, works on a free account): after each sync, schedule on-device alerts for today's reminders that have a time, and for bookings, e.g. 45 minutes before the job time.

## Free Apple account: what it means

- **The app expires after 7 days** and has to be re-installed. Two ways to do that:
  - Re-run it from Xcode once a week, with the iPhone plugged in or over Wi-Fi.
  - [SideStore](https://github.com/SideStore/SideStore): free, and refreshes the app in the background on the phone itself, no Mac needed after setup.
- **Free accounts get 3 apps on the device at once.** The caller ID extension may count as one of them. SideStore itself takes a slot too.
- **No push notifications (APNs).** Apple doesn't give the Push Notifications capability to Personal Teams.
- **No TestFlight.** Install straight from Xcode, or via SideStore.
- If the weekly re-install gets annoying, the $99/yr program removes the expiry and adds real push. Nothing else in this plan changes.

## Notifications without a paid account

Today's web push alerts (new leads, warm agents listing, price cuts) keep working through the home-screen web app, since web push needs no Apple account. Plan:

1. **Keep web push as it is.** It's free and already works.
2. **Make tapping a notification open the native app.** This is Lukas's idea; it isn't proven yet:
   - The native app registers a custom URL scheme, `leadfinder://` (works on a free account).
   - In `public/sw.js`, `notificationclick` saves the target (e.g. `leadfinder://lead/<id>`) in the Cache API.
   - It then opens a tiny static page, `/open-in-app`, which reads the target and sets `location.href` to it.
   - iOS has known bugs where `clients.openWindow` opens the web app's start page instead of the given URL. So the start page also checks for a target saved in the last ~15 s and forwards it.
   - **Unknowns, to test on the phone:**
     - whether iOS lets a home-screen web app jump to a custom scheme without an "Open in LeadFinder?" prompt;
     - how long the hop takes (the web app opens for a moment first).
3. **Fallback if the hop is bad:** the free [ntfy](https://ntfy.sh) app, which has its own push. The server POSTs alerts to a secret topic with a `Click: leadfinder://…` header. Also unverified on iOS. Note that topics on ntfy.sh are only as private as their name.
4. **Local notifications** from the native app cover the schedule (see above) without any of this.

## Phases

| # | Where | What | Rough size |
|---|---|---|---|
| 0 | Linux | Login for the web app ([spec](ios-backend-spec.md), Part A) | short |
| 1 | Linux | `/api/app/v1` ([spec](ios-backend-spec.md), Part B), tested with curl | 1 session |
| 2 | Mac | Xcode project, API client, cache, the four tabs read-only | 1–2 sessions |
| 3 | Mac | ~~Texting sheet + AI drafts~~ **done in Phase 2**: the Contact sheet opens the native Messages sheet with the server's presets and an AI draft, and only records a text when the sheet reports `.sent`. Snooze, notes, reminders, booking actions and the invoice view remain | 1–2 sessions |
| 4 | Mac | Call Directory extension, local notifications | 1 session |
| 5 | Mac | Install on the iPhone (Xcode, then SideStore), the notification-tap bridge, fix what real use turns up | 1 session |
| later | | Lock-screen widget for the next job, Siri / App Intents ("what's my next job"), real push if he ever pays for the program | |

## Needs

- **A Mac with the current Xcode**, signed in with Lukas's Apple ID (free).
- **The iPhone model and iOS version,** to set the minimum target.

## Decisions (2026-10-08)

1. **Apple Developer Program:** no. Use the free Personal Team (see above).
2. **Caller ID:** yes, labels only. Nothing added to Contacts.
3. **AI drafts on the phone:** yes.
4. **Bookings on the phone:** everything (view, directions, call/text, mark invoice sent, complete job, reopen, invoice).
5. **Leads on the phone:** the full list.
6. **Push:** web push stays. Try the notification-tap → native app bridge, with ntfy as the fallback.
7. **Backend now on Linux:** yes. Spec written, handed to another agent; Claude verifies and ships.
8. **Lock down `realestate.lukashahn.art`:** yes, Phase 0.

iPhone: 16e on iOS 18, so the minimum target is iOS 18.

## Kickoff prompt for the Mac session

> Read `CLAUDE.md`, `docs/ios-app-plan.md` and `docs/ios-backend-spec.md`. We're building the LeadFinder iPhone app in `ios/` with SwiftUI, signed with my free Apple ID (Personal Team). Phases 0–1 (web login + `/api/app/v1`) should already be live; check git log and `curl https://realestate.lukashahn.art/api/app/v1/ping` with the token from `.env.local` (`MOBILE_API_SECRET`). Then start Phase 2. My iPhone is a 16e on iOS 18.
