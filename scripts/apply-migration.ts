import { neon } from "@neondatabase/serverless";

async function applyMigration() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }

  try {
    const sql = neon(databaseUrl);
    console.log("Applying migration: Add 'declined' to agent_relationship_status enum...");
    
    const result = await sql`
      ALTER TYPE "public"."agent_relationship_status" ADD VALUE 'declined'
    `;
    
    console.log("✓ Successfully added 'declined' to agent_relationship_status enum");
  } catch (error: any) {
    // Check if the error is about the value already existing
    if (error.message?.includes("already exists") || error.code === "42710") {
      console.log("✓ 'declined' already exists in agent_relationship_status enum");
    } else {
      console.error("Error applying migration:", error);
      process.exit(1);
    }
  }
}

applyMigration();
