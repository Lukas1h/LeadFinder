/**
 * Dry-run version: shows what would be updated without making changes
 * Run with: npx tsx scripts/backfill-declined-status-dryrun.ts
 */

import { db } from "@/db";
import { agents } from "@/db/schema";
import { isNotNull } from "drizzle-orm";

async function dryrunBackfill() {
  try {
    const agentsToUpdate = await db
      .select({ 
        id: agents.id, 
        name: agents.name,
        phone: agents.phone,
        email: agents.email,
        declinedAt: agents.declinedAt,
        relationshipStatus: agents.relationshipStatus,
      })
      .from(agents)
      .where(isNotNull(agents.declinedAt));

    if (agentsToUpdate.length === 0) {
      console.log("✓ No agents with declinedAt found. Nothing to backfill.");
      return;
    }

    console.log(`\n📋 Found ${agentsToUpdate.length} agent(s) with declinedAt that would be updated:\n`);
    
    agentsToUpdate.forEach((agent, index) => {
      console.log(`${index + 1}. ${agent.name ?? "Unknown"}`);
      console.log(`   Phone: ${agent.phone ?? "N/A"}`);
      console.log(`   Email: ${agent.email ?? "N/A"}`);
      console.log(`   Current Status: ${agent.relationshipStatus}`);
      console.log(`   Declined At: ${agent.declinedAt?.toISOString()}`);
      console.log(`   → Would update to: relationshipStatus = "declined"\n`);
    });

    console.log(`📊 Summary: ${agentsToUpdate.length} agent(s) would be updated to status = "declined"`);
    console.log(`\n✅ To actually run the backfill, execute: npx tsx scripts/backfill-declined-status.ts\n`);
  } catch (error) {
    console.error("Error during dry-run:", error);
    process.exit(1);
  }
}

dryrunBackfill();
