/**
 * Applies drizzle/*.sql in filename order, once each, inside a transaction.
 *
 * Hand-written SQL rather than drizzle-kit generate: the schema depends on an
 * EXCLUDE constraint, a GENERATED column and several CHECKs that Drizzle
 * cannot express, and silently losing any of them would take the double-
 * booking guarantee with it.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import postgres from "postgres";

const DIR = join(process.cwd(), "drizzle");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set — copy .env.example to .env.local");

  const sql = postgres(url, { max: 1, onnotice: () => {} });

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS _migration (
        name       text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `;

    const applied = new Set(
      (await sql<{ name: string }[]>`SELECT name FROM _migration`).map((r) => r.name),
    );

    const files = (await readdir(DIR)).filter((f) => f.endsWith(".sql")).sort();
    let ran = 0;

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`· ${file} (already applied)`);
        continue;
      }

      const text = await readFile(join(DIR, file), "utf8");
      await sql.begin(async (tx) => {
        await tx.unsafe(text);
        await tx`INSERT INTO _migration (name) VALUES (${file})`;
      });

      console.log(`✓ ${file}`);
      ran += 1;
    }

    console.log(ran ? `\n${ran} migration(s) applied.` : "\nUp to date.");
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error("\nMigration failed:\n", error);
  process.exit(1);
});
