# Cold Outreach Batch Status

## Summary
Three batches prepared for Oregon real estate agent outreach.

## Completed Batches

### Oregon Agents (227 agents)
- **Status**: ✅ SENT
- **File**: `scripts/coldOutreachCandidates.ts` (combined list)
- **Result**: All 227 agents have been contacted and marked in database
- **Notes**: Previous session container restart didn't cause data loss; script resumed from database state

## Completed Batches (cont'd)

### New-Since-Last Agents (82 agents)
- **Status**: ✅ SENT
- **File**: `scripts/newSinceLastAgents.ts`
- **Size**: 82 cleaned agents (86 total minus 4 held for dedup)
- **Deduplication**: 4 agents held due to phone number collisions (Jason Mann, Corbin Duncan, Eric M Smith, Miltina Scaife) — NOT sent, awaiting manual verification
- **Result**: All 82 non-flagged agents contacted
  - 17 were already contacted in a prior session (ivre.co, lanecountyrealtor.homes, bakerstreetrealestate.com domains)
  - 65 sent this session via `send_agent_email` / `send_bulk_agent_emails` MCP tools (matinrealestate.com block, nedbaker.com, orop.com, and remaining independents)
- **Send method used**: MCP tools (cloud session had no ICLOUD_EMAIL/ICLOUD_APP_PASSWORD, so `newSinceLastBatch.ts` direct-SMTP script couldn't run — used `send_agent_email`/`send_bulk_agent_emails` instead, same preset/variant/DB effect)
- **Template IDs** (for future reference):
  - Preset ID: `2750175f-970f-4c19-af3c-f12e51042134`
  - Variant ID: `52261a73-43df-4851-bb6c-df4f53499576`
  - Lookup script: `node --env-file=.env.local ./node_modules/.bin/tsx scripts/getTemplateIds.ts`

## Saved for Later

### Luxury Video Agents (19 agents)
- **Status**: 💾 SAVED
- **File**: `scripts/luxury/luxuryVideoAgents.ts`
- **Size**: 19 unique luxury agents (deduplicated Elizabeth Davidson)
- **Next Step**: After new-since-last batch completes:
  1. Brainstorm new "Luxury Video" email template
  2. Create new message preset in app
  3. Send using `scripts/luxuryBatch.ts` (to be created)
- **Notes**: User may add more luxury agents before sending - update file as needed

## Implementation Details

### Batch Runner Pattern
Both batch scripts follow same pattern:
1. Load candidate list (name, email, phone)
2. Check database for existing agent records
3. Skip if already contacted
4. Render email using Cold Outreach template
5. Send via iCloud SMTP
6. Save agent record and log send to database
7. 45-second delay between sends for rate limiting

### Database Schema
- `agents` table: name, email, phone, lastContactedAt
- `messageSends` table: listingId, agentId, presetId, variantId, type, channel, sentAt

### Deduplication
Fuzzy matching using Levenshtein distance for names + exact phone/email matching identified potential duplicates. Flagged agents are held for manual verification before sending.

## Next Actions

1. **Review held-out duplicates** (4 agents, Oregon + new-since-last flagged sets)
   - Jason Mann, Corbin Duncan, Eric M Smith, Miltina Scaife (phone-collision flags from new-since-last)
   - Plus the 4 fuzzy-name flags from Oregon (emilygrovesrealty@gmail.com, lisa@smire.com, home@rebeccakaufmann.com, ryan.fischer@smire.com)
   - Manually verify whether these are genuine duplicates or distinct agents, then send or discard

2. **Luxury video preparation** (current batches now complete)
   - Brainstorm new email template for luxury video outreach
   - Create "Luxury Video" message preset in app
   - Create `scripts/luxuryBatch.ts` 
   - Send 19 luxury agents with new template
   - Be ready for user to add more luxury agents

## Environment Setup
- Local development: `.env.local` with ICLOUD credentials
- Production (Vercel): Secrets set via Environment Variables dashboard
- Cloud sessions: Copy ICLOUD credentials from local `.env.local` if available
