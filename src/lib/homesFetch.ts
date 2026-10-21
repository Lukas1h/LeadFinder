// Fetches a homes.com agent profile page from the server.
//
// Akamai Bot Manager guards the profile pages much harder than the search
// API: a plain fetch, a Chrome or Firefox TLS fingerprint (curl_cffi), the
// browser's own Akamai cookies replayed, and headless Chrome all came back
// 403 (2026-10-21), from Lukas's home connection let alone from Vercel's AWS
// addresses. What reliably gets through is a real browser on a residential
// address, which is exactly what the "web unblocker" services sell. So the
// page comes through one of them, picked by whichever key is set:
//
//   ZYTE_API_KEY                                   Zyte API (pay as you go)
//   BRIGHTDATA_API_TOKEN + BRIGHTDATA_UNLOCKER_ZONE  Bright Data Web Unlocker
//
// A few hundred pages a month either way, which is a few dollars at most.

/** A real profile page is ~120-180KB; anything much smaller is a block or an error page. */
const MIN_PROFILE_BYTES = 20_000;

export class HomesFetchError extends Error {}

export function homesFetchConfigured(): boolean {
  return Boolean(process.env.ZYTE_API_KEY || (process.env.BRIGHTDATA_API_TOKEN && process.env.BRIGHTDATA_UNLOCKER_ZONE));
}

async function viaZyte(url: string, key: string): Promise<string> {
  const res = await fetch("https://api.zyte.com/v1/extract", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}`,
      "Content-Type": "application/json",
    },
    // httpResponseBody is the cheaper tier; Zyte escalates to a browser by itself when the site needs one.
    body: JSON.stringify({ url, httpResponseBody: true }),
    signal: AbortSignal.timeout(120_000),
  });
  const data = (await res.json().catch(() => null)) as { httpResponseBody?: string; statusCode?: number; detail?: string } | null;
  if (!res.ok || !data?.httpResponseBody) {
    throw new HomesFetchError(`Zyte ${res.status}: ${data?.detail ?? "no body"}`);
  }
  return Buffer.from(data.httpResponseBody, "base64").toString("utf8");
}

async function viaBrightData(url: string, token: string, zone: string): Promise<string> {
  const res = await fetch("https://api.brightdata.com/request", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ zone, url, format: "raw" }),
    signal: AbortSignal.timeout(120_000),
  });
  const body = await res.text();
  if (!res.ok) throw new HomesFetchError(`Bright Data ${res.status}: ${body.slice(0, 200)}`);
  return body;
}

/** The profile page's HTML, or a HomesFetchError when the service couldn't get a real page. */
export async function fetchHomesProfileHtml(url: string): Promise<string> {
  let html: string;
  if (process.env.ZYTE_API_KEY) {
    html = await viaZyte(url, process.env.ZYTE_API_KEY);
  } else if (process.env.BRIGHTDATA_API_TOKEN && process.env.BRIGHTDATA_UNLOCKER_ZONE) {
    html = await viaBrightData(url, process.env.BRIGHTDATA_API_TOKEN, process.env.BRIGHTDATA_UNLOCKER_ZONE);
  } else {
    throw new HomesFetchError("No unblocker configured (ZYTE_API_KEY or BRIGHTDATA_API_TOKEN + BRIGHTDATA_UNLOCKER_ZONE)");
  }
  if (html.length < MIN_PROFILE_BYTES || /Access Denied/i.test(html)) {
    throw new HomesFetchError(`Blocked page (${html.length} bytes)`);
  }
  return html;
}
