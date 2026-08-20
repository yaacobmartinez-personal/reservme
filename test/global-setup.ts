import { execSync } from "node:child_process";
import { TEST_ENV } from "./test-env";

/**
 * Runs once before the whole suite: brings the schema up to date and seeds the
 * demo venue the concurrency test races against. Uses the resolved test env, so
 * `npm test` works from a fresh clone against the docker DB with no `.env*` file.
 * Assumes the DB is reachable (see README / `npm run test:ci`).
 */
export default function setup() {
  const env = { ...process.env, ...TEST_ENV };
  execSync("npx tsx scripts/migrate.ts", { stdio: "inherit", env });
  execSync("npx tsx scripts/seed.ts", { stdio: "inherit", env });
}
