# Luxury Video Outreach

This folder contains agents reserved for luxury video outreach campaigns.

## Status
- **luxuryVideoAgents.ts**: 19 agents prepared (cleaned from new-since-last-2.csv, Elizabeth Davidson deduplicated)
- **NOT to be sent yet**: Awaiting brainstorm of new email template specifically for luxury video outreach
- **Next step**: After Oregon and new-since-last batches complete, create new "Luxury Video" message preset

## Notes
- Deduplicated one duplicate entry (Elizabeth Davidson, 503-939-2035)
- Fixed one malformed email (removed "mailto:" prefix)
- Fixed one URL-encoded email (removed %20 prefix)
- Ready to add more agents if needed — just update this file

## Possible cross-list duplicate to watch
- **Brian Porter, Tigard** appears here as `laura@brianporter.com` (from new-since-last-2.csv)
- The regular cold-outreach batch (`scripts/newSinceLast5Agents.ts`, from new-since-last-5.csv) also has **Brian Porter, Tigard** but as `brian@brianporter.com`
- Same name/brokerage/city, different email — likely the same office (Brian's own address vs. an assistant/team inbox named Laura)
- The regular batch already emailed `brian@brianporter.com` as a normal cold-outreach send
- Before sending the luxury batch, decide whether to still email `laura@brianporter.com` (different inbox, arguably fine) or skip it as a likely duplicate contact
