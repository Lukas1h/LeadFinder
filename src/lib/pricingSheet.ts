import type { PortfolioPrices } from "@/lib/portfolioPrices";
import { formatPrice } from "@/lib/portfolioPrices";

export const PRICING_SHEET_FILENAME = "Hahn Media Pricing Sheet.pdf";

const QR_URL =
  "https://api.qrserver.com/v1/create-qr-code/?size=300x300&margin=0&data=" +
  encodeURIComponent("https://lukashahn.art/real-estate");

/**
 * Full HTML document for the sheet. Uses prices.photo, prices.drone (add-on), prices.video, prices.socialEdit (add-on), prices.fullPackage.
 * `featured` = the "Featured in the Eugene Tour of Homes" line: Oregon markets only, it means nothing
 * out of state (Lukas, 2026-11-26).
 */
export function pricingSheetHtml(prices: PortfolioPrices, { featured = true }: { featured?: boolean } = {}): string {
  const row = (label: string, price: string, sub = false) => `
    <div class="row${sub ? " sub" : ""}">
      <span class="label">${label}</span><span class="leader"></span><span class="price">${price}</span>
    </div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Hahn Media Pricing</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600&family=Noto+Serif:wght@600;700&display=swap" rel="stylesheet">
<style>
  @page { size: Letter; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: 8.5in; height: 11in; background: #fff; }
  body { font-family: "Outfit", sans-serif; color: #181A1C; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .page { position: relative; width: 8.5in; height: 11in; overflow: hidden; padding: 0 36px; }
  .serif { font-family: "Noto Serif", Georgia, serif; }
  .wordmark { text-align: center; font-family: "Noto Serif", Georgia, serif; font-weight: 700; font-size: 98px; line-height: 1; letter-spacing: -0.5px; padding-top: 34px; }
  .tagline { text-align: center; font-size: 17px; font-weight: 400; letter-spacing: 0.62em; margin-right: -0.62em; color: #595A5C; margin-top: 14px; }
  .featured { text-align: center; font-size: 12px; font-weight: 500; letter-spacing: 0.1em; color: #995000; margin-top: 26px; }
  .featured i { display: inline-block; width: 5px; height: 5px; background: #D4822A; vertical-align: middle; margin: 0 10px 2px; }
  .section { font-size: 11px; font-weight: 600; letter-spacing: 0.2em; color: #995000; margin-top: 36px; }
  .row { display: flex; align-items: baseline; margin-top: 20px; }
  .row .label { font-size: 18.5px; font-weight: 400; }
  .row .leader { flex: 1; border-bottom: 1.5px solid #DADBDC; margin: 0 14px; transform: translateY(-2px); }
  .row .price { font-family: "Noto Serif", Georgia, serif; font-weight: 700; font-size: 22px; }
  .row.sub { margin-top: 10px; padding-left: 22px; }
  .row.sub .label { font-size: 14px; color: #595A5C; font-weight: 400; }
  .row.sub .leader { border-bottom-width: 1px; }
  .row.sub .price { font-family: "Outfit", sans-serif; font-size: 14px; font-weight: 500; color: #995000; }
  .group + .group { margin-top: 18px; }
  .package { margin-top: 26px; background: #F7F2EF; border-left: 3px solid #D4822A; padding: 14px 22px 24px 21px; }
  .package .row { margin-top: 14px; }
  .package .row .label { font-weight: 600; font-size: 18.5px; }
  .package .row .price { color: #D4822A; font-size: 28px; }
  .package p { font-size: 13px; color: #595A5C; margin-top: 10px; }
  .info { display: flex; gap: 14px; margin-top: 30px; }
  .info div { flex: 1; background: #F7F2EF; padding: 16px 20px 20px; font-size: 14px; line-height: 1.65; }
  .cta { text-align: center; font-family: "Noto Serif", Georgia, serif; font-weight: 700; font-size: 18px; color: #D4822A; margin-top: 30px; }
  .footer { position: absolute; left: 36px; right: 36px; top: 878px; border-top: 1.5px solid #DADBDC; padding-top: 26px; }
  .footer .name { font-size: 16px; font-weight: 600; }
  .footer .co { font-size: 13.5px; color: #595A5C; margin-top: 6px; }
  .footer .lines { font-size: 13.5px; line-height: 1.65; margin-top: 12px; }
  .footer .lines .web { color: #995000; }
  .footer img { position: absolute; right: 0; top: 52px; width: 88px; height: 88px; }
</style>
</head>
<body>
<div class="page">
  <div class="wordmark">Hahn Media</div>
  <div class="tagline">REAL ESTATE PHOTO &amp; VIDEO</div>
  ${featured ? `<div class="featured"><i></i>FEATURED IN THE EUGENE TOUR OF HOMES<i></i></div>` : ""}
  <div class="section">PRICING</div>
  <div class="group">
    ${row("Interior &amp; Exterior Photography", formatPrice(prices.photo))}
    ${row("Add Aerial Drone Photography", formatPrice(prices.drone, true), true)}
  </div>
  <div class="group">
    ${row("Cinematic Walkthrough Video", formatPrice(prices.video))}
    ${row("Add Social Media Edit", formatPrice(prices.socialEdit, true), true)}
  </div>
  <div class="package">
    ${row("The Full Package", formatPrice(prices.fullPackage))}
    <p>Photography &amp; walkthrough video, including drone and social media edit.</p>
  </div>
  <div class="info">
    <div>Photos delivered in 24 hours.</div>
    <div>Every shoot guaranteed. If you are not happy with the images, I reshoot at no cost.</div>
  </div>
  <div class="cta">Reach out to book your shoot.</div>
  <div class="footer">
    <div class="name">Lukas Hahn</div>
    <div class="co">Hahn Media</div>
    <div class="lines">
      <div>(541) 430-3372</div>
      <div>lukas@lukashahn.art</div>
      <div class="web">lukashahn.art/real-estate</div>
    </div>
    <img src="${QR_URL}" alt="">
  </div>
</div>
</body>
</html>`;
}
