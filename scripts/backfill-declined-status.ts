/**
 * Backfill agents with declinedAt timestamp to have relationshipStatus = "declined"
 * Run once to migrate existing data from timestamp-based to status-based decline tracking
 */

import { db } from "@/db";
import { agents } from "@/db/schema";
import { isNotNull, eq } from "drizzle-orm";

async function backfillDeclinedStatus() {
  try {
    const agentsToUpdate = await db
      .select({ id: agents.id, declinedAt: agents.declinedAt })
      .from(agents)
      .where(isNotNull(agents.declinedAt));

    if (agentsToUpdate.length === 0) {
      console.log("No agents with declinedAt found. Nothing to backfill.");
      return;
    }

    console.log(`Found ${agentsToUpdate.length} agents with declinedAt. Updating to status = "declined"...`);

    for (const agent of agentsToUpdate) {
      await db
        .update(agents)
        .set({ relationshipStatus: "declined" })
        .where(eq(agents.id, agent.id));
    }

    console.log(`✓ Successfully updated ${agentsToUpdate.length} agents to relationshipStatus = "declined"`);
  } catch (error) {
    console.error("Error during backfill:", error);
    process.exit(1);
  }
}

backfillDeclinedStatus();
