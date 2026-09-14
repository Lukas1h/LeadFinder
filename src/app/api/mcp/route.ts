import { NextRequest, NextResponse } from "next/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { registerLeadFinderTools } from "@/mcp/tools";

// A cold-start MCP round trip (spin up server, register tools, handle one
// JSON-RPC call) is fast, but send_agent_email's SMTP call can be slow —
// same reasoning as the other routes that touch mailer.ts/zillapi.ts.
export const maxDuration = 60;

// Bearer-token gated, same pattern as IMPORT_SHARE_SECRET on
// /api/import-listing — this exposes real writes (send email, edit/import
// agents), not just a public read endpoint. Also accepts ?key= (same
// fallback import-listing uses), since MCP client connector UIs vary in
// whether they let you set a custom Authorization header vs. only a plain
// URL.
function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.MCP_SHARE_SECRET;
  if (!secret) return false;
  if (req.headers.get("authorization") === `Bearer ${secret}`) return true;
  return new URL(req.url).searchParams.get("key") === secret;
}

/**
 * One McpServer + transport per request — this is the documented pattern
 * for a stateless/serverless MCP HTTP endpoint (no sessionIdGenerator, no
 * shared state across invocations, since a Vercel function instance isn't
 * guaranteed to still exist for the next request anyway).
 */
async function handle(req: NextRequest): Promise<Response> {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const server = new McpServer({ name: "leadfinder", version: "0.1.0" });
  registerLeadFinderTools(server);

  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);

  return transport.handleRequest(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function DELETE(req: NextRequest) {
  return handle(req);
}
