# Cold Outreach Batch Status

## Summary
Three batches prepared for Oregon real estate agent outreach.

## Completed Batches

### Oregon Agents (227 agents)
- **Status**: ✅ SENT
- **File**: `scripts/coldOutreachCandidates.ts` (combined list)
- **Result**: All 227 agents have been contacted and marked in database
- **Notes**: Previous session container restart didn't cause data loss; script resumed from database state

## Queued Batches

### New-Since-Last Agents (82 agents)
- **Status**: 📋 READY TO RUN
- **File**: `scripts/newSinceLastBatch.ts`
- **Size**: 82 cleaned agents
- **Deduplication**: 4 agents held due to phone number collisions (Jason Mann, Corbin Duncan, Eric M Smith, Miltina Scaife)
- **How to Run**:
  ```bash
  node --env-file=.env.local ./node_modules/.bin/tsx scripts/newSinceLastBatch.ts
  ```
- **Requirements**:
  - ICLOUD_EMAIL and ICLOUD_APP_PASSWORD must be set in environment
  - Requires database access (DATABASE_URL)
  - Pacing: 45 second delay between sends (~1 hour total duration)
- **Expected Result**: ~82 emails sent, database updated with agent records and send logs

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

1. **Send new-since-last batch**
   - Run: `node --env-file=.env.local ./node_modules/.bin/tsx scripts/newSinceLastBatch.ts`
   - Monitor progress
   - Verify all 82 complete successfully

2. **Luxury video preparation** (after new-since-last completes)
   - Brainstorm new email template for luxury video outreach
   - Create "Luxury Video" message preset in app
   - Create `scripts/luxuryBatch.ts` 
   - Send 19+ luxury agents with new template
   - Be ready for user to add more luxury agents

## Environment Setup
- Local development: `.env.local` with ICLOUD credentials
- Production (Vercel): Secrets set via Environment Variables dashboard
- Cloud sessions: Copy ICLOUD credentials from local `.env.local` if available
