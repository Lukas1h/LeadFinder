// Runs a SQL file against the database in .env.local, as one statement batch.
// For what drizzle-kit push doesn't manage (triggers, functions).
//   npx tsx --env-file=.env.local scripts/apply-sql.mts drizzle/0006_agent_status_changes.sql
// Node 20 needs NODE_OPTIONS=--experimental-websocket for the Pool (Node 22+ has WebSocket built in).
import { readFileSync } from "node:fs";
import { Pool } from "@neondatabase/serverless";

const file = process.argv[2];
if (!file) throw new Error("Usage: apply-sql.mts <file.sql>");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
await pool.query(readFileSync(file, "utf8"));
await pool.end();
console.log(`Applied ${file}`);
