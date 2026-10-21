// Checks the name key that the homes.com capture matches agents with.
//
// The key is computed in SQL, so the bug it had can't be caught by testing
// the JavaScript side alone: the expression stripped every capital letter
// BEFORE lower-casing, so "Geoff O'Neill" reduced to "eoff" and never matched
// the homes.com spelling "Geoff O'neill". This runs the real expression
// against the real database and checks it agrees with nameKey().
//
// Run: node --env-file=.env.local --import tsx scripts/homes-capture-match.test.ts
import assert from "node:assert/strict";
import { neon } from "@neondatabase/serverless";
import { LOOSE_NAME_SQL_PATTERN, looseNameKey, nameKey } from "../src/lib/homesCapture";

const url = process.env.DATABASE_URL;
if (!url) {
  console.log("\nno DATABASE_URL — skipping (the check needs the database)\n");
  process.exit(0);
}
const sql = neon(url);

let pass = 0;
let fail = 0;
async function t(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    pass++;
    console.log("  ok   " + name);
  } catch (e) {
    fail++;
    console.log("  FAIL " + name + "\n         " + (e as Error).message);
  }
}

// The exact expression lib/homesCapture.ts matches on.
const KEY_SQL = `lower(regexp_replace(lower(name), '[^a-z0-9]', '', 'g'))`;

async function keyInSql(name: string): Promise<string> {
  const rows = await sql.query(`select ${KEY_SQL} as key from (values ($1)) as t(name)`, [name]);
  return rows[0].key as string;
}

async function main() {
  console.log("\nname key (SQL) vs nameKey (JS)");

  await t("agrees on the homes.com spelling of a name", async () => {
    for (const name of ["Geoff O'neill", "Geoff O'Neill", "Geoff Oneill", "geoff o'neill"]) {
      assert.equal(await keyInSql(name), nameKey(name), name);
    }
  });

  await t("agrees on every agent we have on file", async () => {
    const rows = await sql`select name from agents where name is not null limit 200`;
    assert.ok(rows.length > 0, "no agents to check");
    for (const row of rows) {
      const name = row.name as string;
      assert.equal(await keyInSql(name), nameKey(name), name);
    }
  });

  await t("a differently-cased name finds the agent row", async () => {
    // Geoff O'Neill in our CRM; homes.com calls him "Geoff O'neill".
    const rows = await sql.query(
      `select id, name from agents where ${KEY_SQL} = $1`,
      [nameKey("Geoff O'neill")]
    );
    const row = rows[0];
    assert.ok(row, "no agent matched the homes.com spelling");
    assert.equal(row.name, "Geoff O'Neill");
  });

  await t("a dropped middle initial still finds the agent row", async () => {
    // Our "Cody M Testa" is homes.com's "Cody Testa".
    const loose = `regexp_replace(regexp_replace(lower(name), '${LOOSE_NAME_SQL_PATTERN}', ' ', 'g'), '[^a-z0-9]', '', 'g')`;
    const rows = await sql.query(`select id, name from agents where ${loose} = $1`, [looseNameKey("Cody Testa")]);
    assert.equal(looseNameKey("Shelli R. Neal"), looseNameKey("Shelli Neal"));
    assert.equal(looseNameKey("J. Ryan Smith"), looseNameKey("Ryan Smith"));
    const row = rows[0];
    assert.ok(row, "no agent matched the shorter spelling");
    assert.equal(row.name, "Cody M Testa");
  });

  await t("the loose key agrees with looseNameKey on every agent", async () => {
    const loose = `regexp_replace(regexp_replace(lower(name), '${LOOSE_NAME_SQL_PATTERN}', ' ', 'g'), '[^a-z0-9]', '', 'g')`;
    const rows = await sql.query(`select name from agents where name is not null limit 200`);
    assert.ok(rows.length > 0, "no agents to check");
    for (const row of rows) {
      const name = row.name as string;
      const [sqlKey] = await sql.query(`select ${loose} as key from (values ($1)) as t(name)`, [name]);
      assert.equal(sqlKey.key as string, looseNameKey(name), name);
    }
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
