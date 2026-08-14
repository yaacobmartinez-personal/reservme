import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { serverEnv } from "@/lib/env";
import * as schema from "./schema";

/**
 * Two clients on purpose. Do not collapse them.
 *
 * `drizzle(client)` MUTATES the postgres.js instance it is given: it swaps the
 * serializers and parsers for the date/time OIDs (1184 timestamptz, 1082 date,
 * 1083 time, 1114 timestamp) for pass-throughs, because Drizzle does its own
 * date handling. Any raw tagged-template query on that same client then hands
 * a `Date` object straight to the byte writer and dies with
 * "The string argument must be of type string ... Received an instance of Date".
 *
 * The booking engine is raw SQL — it needs `tstzrange`, `AT TIME ZONE`,
 * `EXCLUDE` violations and generated columns, none of which Drizzle models —
 * so it gets a client Drizzle has never touched.
 */

declare global {
  // Next re-evaluates modules on every dev change; without this the pools
  // would be recreated until Postgres refuses new connections.
  var __reservmeRaw: ReturnType<typeof postgres> | undefined;
  var __reservmeOrm: ReturnType<typeof postgres> | undefined;
}

/** Raw SQL. Serializers intact — pass `Date` objects freely. */
function rawClient() {
  global.__reservmeRaw ??= postgres(serverEnv().DATABASE_URL, {
    max: 10,
    onnotice: () => {},
  });
  return global.__reservmeRaw;
}

/** Drizzle's own client. It will rewrite this one's date serializers. */
function ormClient() {
  global.__reservmeOrm ??= postgres(serverEnv().DATABASE_URL, {
    max: 5,
    onnotice: () => {},
  });
  return global.__reservmeOrm;
}

export const sql = rawClient();
export const db = drizzle(ormClient(), { schema });
export type Database = typeof db;
export { schema };

/** Closes both pools. Scripts only — never call this from a request. */
export async function closeConnections() {
  await Promise.all([
    global.__reservmeRaw?.end(),
    global.__reservmeOrm?.end(),
  ]);
  global.__reservmeRaw = undefined;
  global.__reservmeOrm = undefined;
}
