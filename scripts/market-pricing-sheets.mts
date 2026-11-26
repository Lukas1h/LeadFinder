/**
 * Makes each market's pricing sheet PDF from its prices (markets.prices,
 * lib/pricingSheet.ts) and puts it on every template that carries the
 * regular "Hahn Media Pricing Sheet.pdf", tagged with the market
 * (PresetAttachment.market), so that market's agents get their own prices
 * and nobody gets two sheets (lib/attachments.ts attachmentsForMarket).
 * A market on the default prices gets no sheet of its own (any old one is
 * removed) and falls back to the regular file. Local / regional are the
 * regular file and are never touched.
 *
 * Run it after changing a market's prices on the Markets page. Needs network
 * (Google Fonts, the QR image) and puppeteer (a devDependency), so it runs
 * locally, not on Vercel.
 *
 *   npx tsx scripts/market-pricing-sheets.mts           # dry run: says what it would do
 *   npx tsx scripts/market-pricing-sheets.mts --write   # writes the templates
 *   npx tsx scripts/market-pricing-sheets.mts --pdf-dir /tmp/sheets   # also saves the PDFs to look at
 */
import { config } from "dotenv";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
config({ path: ".env.local", quiet: true });

const { db } = await import("@/db");
const { messagePresets } = await import("@/db/schema");
const { eq } = await import("drizzle-orm");
const { loadMarketDefs } = await import("@/lib/marketsData");
const { MarketIndex } = await import("@/lib/markets");
const { DEFAULT_PORTFOLIO_PRICES } = await import("@/lib/portfolioPrices");
const { PRICING_SHEET_FILENAME, pricingSheetHtml } = await import("@/lib/pricingSheet");
const puppeteer = (await import("puppeteer")).default;

const write = process.argv.includes("--write");
const pdfDirArg = process.argv.indexOf("--pdf-dir");
const pdfDir = pdfDirArg > 0 ? process.argv[pdfDirArg + 1] : null;

const mk = new MarketIndex(await loadMarketDefs());
const SHEET_KEYS = ["photo", "drone", "video", "socialEdit", "fullPackage"] as const;

const browser = await puppeteer.launch();
const sheets = new Map<string, string | null>(); // market → base64 PDF, null = use the regular file
for (const m of mk.shooterMarkets) {
  const prices = mk.prices(m.key);
  const custom = SHEET_KEYS.some((k) => prices[k] !== DEFAULT_PORTFOLIO_PRICES[k]);
  if (!custom) {
    sheets.set(m.key, null);
    console.log(`${m.label}: default prices, regular sheet`);
    continue;
  }
  const page = await browser.newPage();
  await page.setContent(pricingSheetHtml(prices), { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  const pdf = Buffer.from(await page.pdf({ format: "Letter", printBackground: true }));
  await page.close();
  sheets.set(m.key, pdf.toString("base64"));
  if (pdfDir) {
    fs.mkdirSync(pdfDir, { recursive: true });
    fs.writeFileSync(path.join(pdfDir, `${m.key}.pdf`), pdf);
  }
  console.log(`${m.label}: photo $${prices.photo}, video $${prices.video}, full package $${prices.fullPackage} → own sheet (${Math.round(pdf.length / 1024)} KB)`);
}
await browser.close();

const presets = await db.select({ id: messagePresets.id, name: messagePresets.name, attachments: messagePresets.attachments }).from(messagePresets);
for (const p of presets) {
  const atts = p.attachments ?? [];
  if (!atts.some((a) => a.filename === PRICING_SHEET_FILENAME && !a.market)) continue;
  let next = atts.filter((a) => !(a.filename === PRICING_SHEET_FILENAME && a.market && sheets.has(a.market)));
  for (const [market, content] of sheets) {
    if (content) next.push({ id: randomUUID(), filename: PRICING_SHEET_FILENAME, content, contentType: "application/pdf", market });
  }
  next = next.sort((a, b) => (a.market ? 1 : 0) - (b.market ? 1 : 0));
  const tagged = next.filter((a) => a.filename === PRICING_SHEET_FILENAME && a.market).map((a) => a.market);
  console.log(`${write ? "update" : "would update"} "${p.name}": market sheets → ${tagged.join(", ") || "none"}`);
  if (write) await db.update(messagePresets).set({ attachments: next }).where(eq(messagePresets.id, p.id));
}
if (!write) console.log("Dry run. Pass --write to save.");
process.exit(0);
