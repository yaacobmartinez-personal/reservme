import PgBoss from "pg-boss";
import { serverEnv } from "@/lib/env";

/**
 * pg-boss runs on the same Postgres we already have — no Redis, no extra
 * service. It keeps its own schema (`pgboss`) and does not touch ours.
 *
 * One instance per process. The web app enqueues jobs through this; the worker
 * process (scripts/worker.ts) is what actually runs them.
 */

declare global {
  var __reservmeBoss: PgBoss | undefined;
  var __reservmeBossStarted: Promise<PgBoss> | undefined;
}

function create(): PgBoss {
  return new PgBoss({
    connectionString: serverEnv().DATABASE_URL,
    // Keep a small footprint; this shares the database with request traffic.
    max: 4,
    schema: "pgboss",
  });
}

/** Started, ready-to-use boss. Safe to call repeatedly — it starts once. */
export async function getBoss(): Promise<PgBoss> {
  if (global.__reservmeBossStarted) return global.__reservmeBossStarted;

  global.__reservmeBossStarted = (async () => {
    const boss = global.__reservmeBoss ?? create();
    global.__reservmeBoss = boss;
    // Installs the pgboss schema on first run, connects thereafter. Guarded by
    // the promise above so it runs once per process.
    await boss.start();
    return boss;
  })();

  return global.__reservmeBossStarted;
}

export const QUEUES = {
  holdSweep: "hold-sweep",
  bookingConfirmation: "booking-confirmation",
  bookingReminder: "booking-reminder",
} as const;
