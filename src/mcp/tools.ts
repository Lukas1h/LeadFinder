/**
 * LeadFinder's MCP tools, registered against a fresh McpServer per request
 * by src/app/api/mcp/route.ts. See src/mcp/tools/*.ts for the actual tool
 * implementations, grouped by area (agents, listings, bookings, messaging,
 * interactions).
 *
 * Deliberately does NOT import from any "use server" file
 * (composeEmailActions.ts, agents/actions.ts, booked/actions.ts, etc.)
 * even though this runs inside a real Next.js request (where
 * revalidatePath would actually work) — every tool module reimplements
 * the same validate-then-write patterns those files use, so this never
 * touches (and can't accidentally break) the routes/actions the web app
 * and its own external integrations (the IMPORT_SHARE_SECRET Shortcut,
 * the compose-email flow) already depend on.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAgentTools } from "./tools/agents";
import { registerListingTools } from "./tools/listings";
import { registerBookingTools } from "./tools/bookings";
import { registerMessagingTools } from "./tools/messaging";
import { registerInteractionTools } from "./tools/interactions";

export function registerLeadFinderTools(server: McpServer): void {
  registerAgentTools(server);
  registerListingTools(server);
  registerBookingTools(server);
  registerMessagingTools(server);
  registerInteractionTools(server);
}
