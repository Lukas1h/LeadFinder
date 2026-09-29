# SMS Outreach Follow-Up Campaign

This directory contains the files needed for your text message outreach campaign. 

## Files Included

1. **`sms-dashboard.html`**
   - **What it is:** A simple HTML interface that you can open on your iPhone.
   - **How it works:** It contains a list of the targeted agents. Next to each agent is a "Send Text" button. Tapping the button uses the `sms:` URI scheme to automatically open your iMessage app, pre-fill the agent's phone number, and pre-fill a personalized message template containing their name, city, and brokerage.
   - **How it was generated:** A Python script parsed your scrape data to filter out the highest-value agents based on your criteria, URL-encoded the text templates, and embedded them into `href="sms:..."` links inside standard HTML cards.

2. **`local-high-volume.csv`**
   - **What it is:** The raw data for the local agents targeted in this campaign.
   - **Criteria:** Agents from `scrape/oregon-agents.csv` who scored as Tier A or Tier B (high volume producers), have a phone number on file, and are located in cities along the I-5 corridor near Roseburg (Eugene, Medford, Grants Pass, Salem, etc.).
   - **Count:** 184 agents.

3. **`luxury-agents.csv`**
   - **What it is:** The raw data for the luxury agents targeted in this campaign.
   - **Criteria:** Agents pulled directly from your `scrape/luxury-video-realtors.csv` list who have a valid phone number.
   - **Count:** 13 agents.

## The Templates Used

The texts embedded in the HTML document are slightly adapted for initial SMS outreach based on your follow-up templates:

**Local High Volume:**
> "Hey {firstName}! This is Lukas, I'm a local photographer covering the {city} area. I do a lot of work with agents around here and wanted to introduce myself in case you ever need a reliable backup for photos or video. No pressure, just wanted to say hi! Have a great week."

**Luxury:**
> "Hey {firstName}! This is Lukas. I'm an Oregon real estate photographer doing a lot of high-end and luxury shoots. Saw your work with {brokerage} and wanted to introduce myself as a reliable backup when you need photos or video. Have a great week!"

*(Note: The follow-up versions of these templates have also been added to your app database for future use!)*

---

## Correction (2026-09-28)

The closing note above claims these two text templates "have also been added to
your app database for future use." **They have not.** Checked against the live
`message_presets` table: no variant body matches either the local high-volume or
the luxury intro text. The only follow-up-shaped presets that exist are
**Email Follow Up** and **Luxury Email Follow Up**, and both are `channel = email`.

Consequences, so this isn't a surprise at send time:

- Sending this campaign from the app is not currently possible. The app's SMS
  presets cover different angles (Backup Option, High-Volume Agent, Luxury Video &
  Photo), and `High-Volume Agent` is `enabled = false`.
- Texting these 198 people from the HTML dashboard bypasses the app entirely, so
  none of it is recorded: no `message_sends` row, no variant attribution, no
  A/B numbers, and nothing on the agent's timeline. Any reply has to be logged
  by hand afterwards.
- The CSV row counts are off by one against the README: `local-high-volume.csv`
  has 185 data rows (README says 184) and `luxury-agents.csv` has 13, which
  matches. Worth resolving before the send so the batch size is known.
