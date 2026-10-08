import type { NextRequest } from "next/server";
import { requireAppAuth } from "@/lib/appApiAuth";
import { isUuid, notFound } from "../../../helpers";
// The web's own invoice handler, reused rather than re-rendered: the HTML has to
// be the same document the web prints, and it carries the invoice-numbering
// side effect. Like the web's "Create invoice" button, the first call assigns
// this booking's invoice number.
import { GET as invoiceHtml } from "@/app/api/bookings/[id]/invoice/route";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireAppAuth(req);
  if (denied) return denied;

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const response = await invoiceHtml(req, { params: Promise.resolve({ id }) });
  // The web's own 404 is a JSON body with different wording; keep the API's.
  if (response.status === 404) return notFound();
  return response;
}
