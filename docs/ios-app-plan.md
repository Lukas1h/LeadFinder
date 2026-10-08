# LeadFinder for iPhone: plan

Drafted 2026-10-08 on the Linux box. Building starts on the Mac.

## Why

Lukas does much of his work from his phone on the road. The PWA loads slowly and responds slowly to taps, partly because every tab is server-rendered on each visit, and `/agents` alone sends about 1.5 MB of HTML with all 8,900 agents in it. The native app opens straight to cached data and refreshes it in the background. It covers only what's useful away from the desk. Everything else stays on the web.

## What goes where

### iPhone app (v1)

1. **Leads.** The same list and order as the web Leads page (lead sections, known-agent groups, photo score, badges). Tap a lead to see its photos, price, the agent, and their history with Lukas. Swipe actions: **Text** and **Pass**.
2. **Texting agents.** Tapping Text gets the message options from the server (the same presets and A/B variant rotation as the web dialog). Lukas picks one, edits it if he wants, and taps Send in the **native Messages sheet** (`MFMessageComposeViewController`).
   - The app logs the text only when the sheet reports it was actually sent, so there's no "did you send it?" prompt like the web has.
   - It also works from an agent's screen (Follow up, directory) with no listing attached.
3. **Follow up.** The same board as the web: Just listed, Past clients, Interested gone quiet, Warm. Text, or snooze for later.
4. **Log what happened.** Quick buttons on an agent: *replied, interested, not now, declined, called (answered / no answer / voicemail)*. Plus an editable notes field and the relationship status. This covers replies that come in through Messages, since the app can't read them.
5. **Schedule and bookings.** Today first, then upcoming: bookings, reminders and listing follow-ups (the same items as the web Schedule).
   - A booking shows the address with an **Apple Maps directions** button, the lockbox code, the on-site agent (call or text), and notes.
   - Reminders can be checked off, and adding one is quick ("text Lisa Tuesday").
6. **Agent directory and caller ID.**
   - The directory is searchable by name, brokerage or **phone number digits**, and works offline.
   - **Caller ID:** a Call Directory extension labels incoming calls from any of the ~6,000 agent phone numbers, e.g. "Jane Doe · Interested". Calls from numbers that aren't in Contacts then show who's calling.
   - Optional "Add to Contacts" for the agents he works with, so names show up in Messages as well (see the open questions).

### Stays web-only (desk work)

- Email: Queue, cold email compose, bulk sends, email presets and attachments.
- Messaging presets, A/B stats and variant editing.
- Pipeline kanban, imports, merging agents, bulk pass.
- Invoices, galleries, Dropbox, completing a booking (hours and costs).
- Settings, search sources, Develop.

**The phone app never sends anything by itself.** Texts go out only when Lukas taps Send in the Messages sheet. No email sending from the phone in v1.

## Architecture

### Backend (Next.js, this repo)

- **New JSON API** under `src/app/api/app/v1/`, guarded by a bearer token in a new `IOS_APP_TOKEN` env var on Vercel. It works the same way as `MCP_SHARE_SECRET` on `/api/mcp`.
- **Reuse the existing server functions** so the phone and the web always agree.
  - **Leads.** The Leads page's logic currently lives inline in `src/app/page.tsx` (lines ~70–110). Pull it out into a `getLeadsBoard()` in `src/app/leads-data.ts` (the same move as `src/app/follow-up/data.ts`). Then the page and the API both call it.
  - **Follow up:** `getFollowUpBoard()` in `src/app/follow-up/data.ts`.
  - **Schedule:** `loadScheduleItems()` in `src/lib/scheduleItems.ts`.
  - **Texting:** `getMessageOptions()` and `sendMessage()` in `src/app/messageActions.ts`.
    - The web flow logs a text as *pending* and confirms it later (`PendingInteractionPrompt`, `agents/interactionActions.ts`).
    - The API's "sent" endpoint should record it as already confirmed, because the native sheet says for sure whether it was sent.
  - **Listings:** `updateListingStatus()` and `markListingsPassed()` in `src/app/actions.ts`.
  - **Logging and snoozing:** the interaction logging and follow-up snooze in `src/app/agents/actions.ts` and `interactionActions.ts`.
- **Endpoints (first cut):**

  | Method | Path | What |
  |---|---|---|
  | GET | `/home` | Leads + Follow up + today's schedule in **one** round trip (launch screen) |
  | GET | `/leads` · `/follow-up` · `/schedule?from=&to=` | Each board on its own |
  | GET | `/bookings/:id` | Booking detail, line items, agent |
  | GET | `/agents` | Whole directory (id, name, phone, email, status, last contact, notes, plus brokerage from their latest listing's `brokerName`, since `agents` has no brokerage column). Uses an ETag so the phone only downloads it again when something changed |
  | GET | `/agents/:id` | Detail: interactions, listings, bookings |
  | GET | `/listings/:id/message-options?type=` | Rendered text options, AI draft optional |
  | POST | `/listings/:id/sent` | `{type, presetId, variantId, text}` logs a confirmed text |
  | POST | `/agents/:id/sent` | Texts not tied to a listing (Follow up) |
  | POST | `/listings/:id/status` | Pass, save |
  | POST | `/agents/:id/interactions` | Log reply / call / outcome |
  | PATCH | `/agents/:id` | Notes, relationship status |
  | POST | `/follow-up/:agentId/snooze` | Same as the web snooze |
  | POST/PATCH | `/reminders`, `/reminders/:id` | Add, complete |

- Keep the endpoints thin. Each one checks the token, calls the shared function, and returns JSON. Every write revalidates the same paths the web actions do.

### iOS app (SwiftUI)

- **Stack:** current Xcode, Swift 6, iOS 18+, SwiftUI. No third-party packages to start.
- **Location:** `ios/` in this repo, so one Claude session sees both the API and the app, and the API contract stays in sync. Vercel ignores it.
- **Tabs:** Leads · Follow up · Schedule · Agents. A dark theme close to the web app (`#111116`). Big rows and one-handed reach, with swipe actions and pull to refresh.
- **Offline-first:** each screen renders its last cached JSON (files in the app's container, or SwiftData) immediately, then refreshes. This is the main speed fix.
- **Auth:** paste the token once on first launch and keep it in the Keychain.
- **Texting:** `MFMessageComposeViewController` with the recipient and body prefilled. On `.sent`, POST to the API. On `.cancelled`, nothing happens.
- **Caller ID:** a Call Directory extension (`CXCallDirectoryProvider`).
  - The main app writes the agent list to an **App Group** container after each directory sync, then calls `CXCallDirectoryManager.reloadExtension`.
  - The extension adds numbers as E.164 `Int64`, **sorted ascending**, each with a label.
  - Lukas turns it on once: Settings › Apps › Phone › Call Blocking & Identification › LeadFinder.
  - It only labels numbers that aren't in Contacts, and it doesn't affect Messages.
- **Calls and directions:** `tel:` links for calls; directions open Apple Maps with the booking's address.

## Phases

| # | Where | What | Rough size |
|---|---|---|---|
| 0 | Linux or Mac | **Lock down the web app** (see Security below) | short session |
| 1 | Linux or Mac | Backend API + `getLeadsBoard()` extraction, tested with curl | 1 session |
| 2 | Mac | Xcode project, API client, cache, the four tabs read-only | 1–2 sessions |
| 3 | Mac | Texting sheet + logging, pass/snooze, notes, reminders | 1 session |
| 4 | Mac | Call Directory extension + App Group, "Add to Contacts" | 1 session |
| 5 | Mac | Install on the iPhone via TestFlight, fix what real use turns up | 1 session |
| later | | Push notifications through APNs (move `src/lib/push.ts` alerts over), lock-screen widget for today's next job, Siri / App Intents ("what's my next job") | |

**Total:** roughly a week of evenings, mostly Claude's work.

## Needs

- **A Mac with the current Xcode.**
- **Apple Developer Program, $99/yr.** Needed for TestFlight, push, and a build that doesn't expire. A free Apple ID can run the app from Xcode, but the build expires after 7 days and some capabilities (App Groups, push) can't be relied on.
- **The iPhone's iOS version,** to pick the minimum target.

## Security: do this regardless of the app

`https://realestate.lukashahn.art` serves the whole admin app **with no login**. It's a production alias of `lead-finder`; `*.vercel.app` URLs are behind Vercel SSO, but the custom domain isn't.

- On 2026-10-08, `/agents` returned 200 to a plain curl, with about 185 agent phone numbers in the HTML.
- Server actions are reachable the same way, including ones that write data and send email.

Phase 0 fix: a simple sign-in in `src/proxy.ts` for the admin hosts.
- A password checked against an env var, setting a long-lived httpOnly cookie, so the phone stays signed in.
- Leave `gallery.lukashahn.art` and the client gallery and download routes, `/api/unsubscribe`, `/api/webhooks/*`, `/api/cron/*`, `/api/import-listing` (own secret), `/api/mcp` (own secret) and `/api/app/v1/*` (own token) open as they are today.

## Open questions for Lukas

1. **Apple Developer account:** do you have the paid one? Which Mac / Xcode, and which iPhone / iOS version?
2. **Caller ID:** label calls only (all ~6,000 agent numbers, nothing added to Contacts)? Or also add the ~170 agents you actually work with (warm and up) to your Contacts, so their names show in Messages too?
3. **Texting on the phone:** just the regular presets, or also the Gemini AI draft (adds a few seconds per text)?
4. **Bookings on the phone:** view, navigate and call only? Or also "mark invoice sent" and "complete job"?
5. **Leads on the phone:** the full Leads list, or a lighter "top 10 to text today" view?
6. **Push notifications:** move new-lead and warm-listing alerts into the app later, or keep web push?
7. **Start the backend now?** Phases 0–1 don't need a Mac and could be done on Linux, so the Mac session starts straight in Swift.
8. **Lock down `realestate.lukashahn.art` now** with a password (Phase 0)?

## Kickoff prompt for the Mac session

> Read `docs/ios-app-plan.md` (and `CLAUDE.md`). We're building the LeadFinder iPhone app in `ios/`. Check which phases are already done in git log, then continue with the next one. My answers to the open questions: …
