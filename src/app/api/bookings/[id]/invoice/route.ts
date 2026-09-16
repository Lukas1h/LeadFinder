import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { bookings, bookingLineItems, listings, agents } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { formatDate, formatPrice } from "@/lib/format";

// Numbering picks up after 105 — 106 itself was the 1353 Dalton Ct /
// Chandra Reynolds job, sent by hand before this feature existed, and is
// meant to be (re)created as this app's very first tracked invoice rather
// than skipped over. See the comment on bookings.invoiceNumber.
const LAST_MANUAL_INVOICE_NUMBER = 105;

// Fixed business details from Lukas's real invoice template — not
// booking-specific, so hardcoded here rather than modeled in the DB, same
// spirit as the signature block baked into BLANK_EMAIL_BODY
// (src/lib/messageTemplate.ts).
const BUSINESS = {
  name: "Lukas Hahn",
  entity: "Lukas Hahn Art LLC",
  phone: "(541) 430-3372",
  email: "lukas@lukashahn.art",
  website: "lukashahn.art/real-estate",
  checkPayee: "Lukas Hahn Art LLC",
  checkAddress: "662 Winston Section RD, Winston, OR 97496",
  venmo: "@lukashahn",
  cashApp: "$LukasHahn",
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Assigns this booking's invoice number the first time it's viewed, then
 * never again — re-opening/re-printing the same booking's invoice always
 * shows the same number. A GET route mutating state is unusual, but this
 * mirrors the vCard route's "plain <a href>, no client JS" simplicity
 * (src/app/api/agents/[id]/vcard/route.ts), and the write is idempotent —
 * every call after the first is a pure read.
 */
async function getOrAssignInvoiceNumber(bookingId: string, existing: number | null): Promise<number> {
  if (existing != null) return existing;

  const [{ max }] = await db.select({ max: sql<number | null>`max(${bookings.invoiceNumber})` }).from(bookings);
  const next = (max ?? LAST_MANUAL_INVOICE_NUMBER) + 1;

  await db.update(bookings).set({ invoiceNumber: next, invoicedAt: new Date() }).where(eq(bookings.id, bookingId));
  return next;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [booking] = await db.select().from(bookings).where(eq(bookings.id, id));
  if (!booking) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }

  const [linkedListing, contact, lineItems] = await Promise.all([
    booking.listingId
      ? db.select().from(listings).where(eq(listings.id, booking.listingId)).then((r) => r[0] ?? null)
      : Promise.resolve(null),
    booking.contactAgentId
      ? db
          .select({ name: agents.name, phone: agents.phone })
          .from(agents)
          .where(eq(agents.id, booking.contactAgentId))
          .then((r) => r[0] ?? null)
      : Promise.resolve(null),
    db
      .select({ description: bookingLineItems.description, amount: bookingLineItems.amount })
      .from(bookingLineItems)
      .where(eq(bookingLineItems.bookingId, id)),
  ]);

  const invoiceNumber = await getOrAssignInvoiceNumber(id, booking.invoiceNumber);
  const invoicedAt = booking.invoicedAt ?? new Date();

  const total = lineItems.reduce((sum, li) => sum + li.amount, 0);
  const addressLine = [linkedListing?.address ?? booking.address, linkedListing?.city ?? booking.city, linkedListing?.state ?? booking.state]
    .filter(Boolean)
    .join(", ");
  const billedToName = contact?.name ?? "Client";
  const billedToSub = linkedListing?.brokerName ?? null;

  const lineItemRows = lineItems
    .map(
      (li) => `
      <div style="display:grid;grid-template-columns:1fr 70px 110px 110px;gap:16px;padding:16px 0;border-bottom:1px solid rgba(24,26,28,0.1);align-items:baseline;">
        <div style="font-family:'Outfit',sans-serif;font-weight:400;font-size:16px;color:#181A1C;">${escapeHtml(li.description)}</div>
        <div style="font-family:'Outfit',sans-serif;font-weight:400;font-size:16px;color:#181A1C;text-align:center;">1</div>
        <div style="font-family:'Outfit',sans-serif;font-weight:400;font-size:16px;color:#181A1C;text-align:right;">${formatPrice(li.amount)}</div>
        <div style="font-family:'Outfit',sans-serif;font-weight:500;font-size:16px;color:#181A1C;text-align:right;">${formatPrice(li.amount)}</div>
      </div>`
    )
    .join("");

  const notesBlock = booking.notes
    ? `
    <div style="background:#F9F4F1;border-left:3px solid #D67F1F;padding:16px 20px;margin-top:0.24in;flex-shrink:0;">
      <div style="font-family:'Outfit',sans-serif;font-weight:600;font-size:12px;letter-spacing:0.18em;text-transform:uppercase;color:#995000;">Notes</div>
      <p style="margin:10px 0 0;font-family:'Outfit',sans-serif;font-weight:400;font-size:15px;color:#181A1C;line-height:1.5;">${escapeHtml(booking.notes)}</p>
    </div>`
    : "";

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Invoice ${invoiceNumber} — ${escapeHtml(billedToName)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="">
<link href="https://fonts.googleapis.com/css2?family=Noto+Serif:ital,wght@0,400;0,700;1,400&family=Outfit:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin: 0; background: #E7E5E3; font-family: 'Outfit', sans-serif; }
  .page {
    width: 8.5in;
    min-height: 11in;
    margin: 0.4in auto;
    background: #ffffff;
    box-shadow: 0 4px 24px rgba(0,0,0,0.14);
    padding: 0.375in;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    color: #181A1C;
  }
  .print-bar {
    position: sticky;
    top: 0;
    display: flex;
    justify-content: center;
    padding: 14px;
    background: #E7E5E3;
  }
  .print-bar button {
    font-family: 'Outfit', sans-serif;
    font-weight: 600;
    font-size: 14px;
    color: #ffffff;
    background: #181A1C;
    border: none;
    border-radius: 8px;
    padding: 10px 20px;
    cursor: pointer;
  }
  @media print {
    body { background: #ffffff; }
    .print-bar { display: none; }
    .page { margin: 0; box-shadow: none; }
    @page { size: letter; margin: 0; }
  }
</style>
</head>
<body>
  <div class="print-bar"><button onclick="window.print()">Print / Save as PDF</button></div>
  <section class="page">
    <div style="text-align:center;flex-shrink:0;">
      <div id="big-logo" style="font-family:'Noto Serif',serif;font-weight:700;font-size:82px;line-height:0.95;color:#181A1C;letter-spacing:-0.01em;display:inline-block;white-space:nowrap;">Hahn Media</div>
      <div id="big-sub" style="font-family:'Outfit',sans-serif;font-weight:400;font-size:16px;text-transform:uppercase;color:#181A1C;opacity:0.72;margin-top:9px;display:inline-block;">Real Estate Photo &amp; Video</div>
    </div>

    <div style="height:1px;background:#181A1C;opacity:0.14;margin:0.3in 0 0;flex-shrink:0;"></div>

    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:40px;margin-top:0.26in;flex-shrink:0;">
      <div>
        <div style="font-family:'Outfit',sans-serif;font-weight:600;font-size:12px;letter-spacing:0.18em;text-transform:uppercase;color:#995000;">Billed To</div>
        <div style="margin-top:12px;display:flex;flex-direction:column;gap:3px;">
          <div style="font-family:'Outfit',sans-serif;font-weight:600;font-size:17px;color:#181A1C;">${escapeHtml(billedToName)}</div>
          ${billedToSub ? `<div style="font-family:'Outfit',sans-serif;font-weight:400;font-size:14px;color:#181A1C;opacity:0.72;">${escapeHtml(billedToSub)}</div>` : ""}
        </div>
      </div>
      <div style="text-align:right;flex-shrink:0;">
        <div style="font-family:'Noto Serif',serif;font-weight:700;font-size:30px;color:#181A1C;line-height:1;">Invoice</div>
        <div style="margin-top:12px;display:flex;flex-direction:column;gap:3px;">
          <div style="font-family:'Outfit',sans-serif;font-weight:500;font-size:14px;color:#181A1C;">No. ${invoiceNumber}</div>
          <div style="font-family:'Outfit',sans-serif;font-weight:400;font-size:14px;color:#181A1C;opacity:0.72;">${formatDate(invoicedAt)}</div>
          ${addressLine ? `<div style="font-family:'Outfit',sans-serif;font-weight:400;font-size:14px;color:#181A1C;opacity:0.72;">${escapeHtml(addressLine)}</div>` : ""}
        </div>
      </div>
    </div>

    <div style="margin-top:0.34in;flex-shrink:0;">
      <div style="display:grid;grid-template-columns:1fr 70px 110px 110px;gap:16px;padding-bottom:9px;border-bottom:1px solid rgba(24,26,28,0.22);">
        <div style="font-family:'Outfit',sans-serif;font-weight:600;font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:#995000;">Description</div>
        <div style="font-family:'Outfit',sans-serif;font-weight:600;font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:#995000;text-align:center;">Qty</div>
        <div style="font-family:'Outfit',sans-serif;font-weight:600;font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:#995000;text-align:right;">Price</div>
        <div style="font-family:'Outfit',sans-serif;font-weight:600;font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:#995000;text-align:right;">Total</div>
      </div>
      ${lineItemRows}
    </div>

    <div style="display:flex;justify-content:flex-end;margin-top:0.26in;flex-shrink:0;">
      <div style="background:#F9F4F1;border-left:3px solid #D67F1F;padding:16px 22px;display:flex;align-items:baseline;gap:26px;">
        <span style="font-family:'Outfit',sans-serif;font-weight:600;font-size:13px;letter-spacing:0.14em;text-transform:uppercase;color:#181A1C;">Total Due</span>
        <span style="font-family:'Noto Serif',serif;font-weight:700;font-size:30px;color:#D67F1F;line-height:1;">${formatPrice(total)}</span>
      </div>
    </div>

    <div style="margin-top:auto;padding-top:0.34in;flex-shrink:0;">
      <div>
        <div style="font-family:'Outfit',sans-serif;font-weight:600;font-size:12px;letter-spacing:0.18em;text-transform:uppercase;color:#995000;">Payment Methods</div>
        <div style="display:grid;grid-template-columns:1.6fr 1fr 1fr;gap:0;margin-top:16px;">
          <div style="padding-right:24px;">
            <div style="font-family:'Outfit',sans-serif;font-weight:600;font-size:14px;color:#181A1C;">Check by mail</div>
            <div style="font-family:'Outfit',sans-serif;font-weight:400;font-size:14px;color:#181A1C;opacity:0.72;line-height:1.45;margin-top:4px;">Make checks payable to ${escapeHtml(BUSINESS.checkPayee)}<br>${escapeHtml(BUSINESS.checkAddress)}</div>
          </div>
          <div style="padding:0 24px;border-left:1px solid rgba(24,26,28,0.14);">
            <div style="font-family:'Outfit',sans-serif;font-weight:600;font-size:14px;color:#181A1C;">Venmo</div>
            <div style="font-family:'Outfit',sans-serif;font-weight:400;font-size:14px;color:#181A1C;opacity:0.72;margin-top:4px;">${escapeHtml(BUSINESS.venmo)}</div>
          </div>
          <div style="padding:0 24px;border-left:1px solid rgba(24,26,28,0.14);">
            <div style="font-family:'Outfit',sans-serif;font-weight:600;font-size:14px;color:#181A1C;">Cash App</div>
            <div style="font-family:'Outfit',sans-serif;font-weight:400;font-size:14px;color:#181A1C;opacity:0.72;margin-top:4px;">${escapeHtml(BUSINESS.cashApp)}</div>
          </div>
        </div>
      </div>
    </div>

    ${notesBlock}

    <div style="padding-top:0.3in;flex-shrink:0;">
      <div style="height:1px;background:#181A1C;opacity:0.14;margin:0 0 0.16in;"></div>
      <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:24px;">
        <div style="display:flex;flex-direction:column;gap:4px;">
          <div style="font-family:'Outfit',sans-serif;font-weight:600;font-size:16px;color:#181A1C;">${escapeHtml(BUSINESS.name)}</div>
          <div style="font-family:'Outfit',sans-serif;font-weight:400;font-size:13px;color:#181A1C;opacity:0.72;">${escapeHtml(BUSINESS.entity)}</div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:2px;">
          <div style="font-family:'Outfit',sans-serif;font-weight:400;font-size:14px;color:#181A1C;">${escapeHtml(BUSINESS.phone)}</div>
          <div style="font-family:'Outfit',sans-serif;font-weight:400;font-size:14px;color:#181A1C;">${escapeHtml(BUSINESS.email)}</div>
          <div style="font-family:'Outfit',sans-serif;font-weight:500;font-size:14px;color:#995000;">${escapeHtml(BUSINESS.website)}</div>
        </div>
      </div>
    </div>
  </section>
  <script>
    // Stretches the subtitle's letter-spacing so its width visually
    // matches the logo above it — same trick as the original design doc's
    // matchWidths() component logic.
    function matchWidths() {
      var logo = document.getElementById('big-logo');
      var sub = document.getElementById('big-sub');
      if (!logo || !sub) return;
      sub.style.letterSpacing = '0px';
      var target = logo.getBoundingClientRect().width;
      var natural = sub.getBoundingClientRect().width;
      var text = sub.textContent || '';
      var gaps = Math.max(text.length - 1, 1);
      var extra = (target - natural) / gaps;
      extra = Math.max(Math.min(extra, 24), 0);
      sub.style.letterSpacing = extra + 'px';
    }
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(matchWidths);
    }
    window.addEventListener('resize', matchWidths);
    matchWidths();
  </script>
</body>
</html>`;

  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
