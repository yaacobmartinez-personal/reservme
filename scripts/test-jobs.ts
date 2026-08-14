/**
 * P0-4/P0-3 verification: a booking's confirmation job is picked up and
 * processed by the worker, and expired holds are swept.
 *
 *   Terminal 1: npm run worker
 *   Terminal 2: npm run test:jobs
 *
 * Emails "succeed" by logging when RESEND_API_KEY is unset, so this passes
 * without a mail provider — it proves the pipeline, not the delivery.
 */
import postgres from "postgres";

const ORG_ID = "org_katipunan";
let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 4, onnotice: () => {} });
  const { reserveSpace } = await import("../src/lib/booking/reserve");
  const { enqueueBookingConfirmation, scheduleBookingReminder } = await import(
    "../src/lib/jobs/enqueue"
  );

  const [space] = await sql<{ id: string }[]>`
    SELECT id FROM space WHERE organization_id = ${ORG_ID} ORDER BY sort_order LIMIT 1`;

  // 3 days ahead at 02:00 UTC = 10:00 Manila (fixed UTC+8), inside 06:00–22:00.
  const startsAt = new Date(Date.now() + 3 * 86400_000);
  startsAt.setUTCHours(2, 0, 0, 0);
  const email = `jobs-${Date.now()}@example.com`;
  let reservation: { id: string; reference: string } | undefined;

  try {
    /* 1 · A real booking, then enqueue exactly as the booking action does */
    reservation = await reserveSpace({
      organizationId: ORG_ID,
      spaceId: space.id,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 3600_000),
      customer: { name: "Jobs Test", email },
    });
    const job = { reservationId: reservation.id, organizationId: ORG_ID };
    await enqueueBookingConfirmation(job);
    await scheduleBookingReminder(job, startsAt);
    check("confirmation + reminder enqueued", true);

    /* 2 · The worker should process the confirmation within a few seconds */
    let confirmationState: string | null = null;
    let reminderScheduled = false;
    for (let i = 0; i < 30; i += 1) {
      await new Promise((r) => setTimeout(r, 500));
      const rows = await sql<{ name: string; state: string }[]>`
        SELECT name, state FROM pgboss.job
        WHERE data->>'reservationId' = ${reservation.id}
        UNION ALL
        SELECT name, state FROM pgboss.archive
        WHERE data->>'reservationId' = ${reservation.id}
      `;
      const confirm = rows.find((r) => r.name === "booking-confirmation");
      const remind = rows.find((r) => r.name === "booking-reminder");
      if (confirm) confirmationState = confirm.state;
      if (remind) reminderScheduled = true;
      if (confirmationState === "completed") break;
    }

    check(
      "worker processed the confirmation job (is the worker running?)",
      confirmationState === "completed",
      `state=${confirmationState ?? "not found"}`,
    );
    check(
      "reminder job is scheduled for later",
      reminderScheduled,
      reminderScheduled ? "" : "no reminder job found",
    );

    /* 3 · The hold-sweep cron is registered */
    const [cron] = await sql<{ name: string; cron: string }[]>`
      SELECT name, cron FROM pgboss.schedule WHERE name = 'hold-sweep'`;
    check("hold-sweep cron is scheduled", cron?.cron === "* * * * *", cron?.cron ?? "missing");

    console.log(
      failures === 0
        ? "\nJob pipeline verified: booking → queue → worker → email (logged).\n"
        : `\n${failures} check(s) FAILED. Is the worker running (npm run worker)?\n`,
    );
  } finally {
    if (reservation) {
      await sql`DELETE FROM reservation WHERE id = ${reservation.id}::uuid`;
      await sql`DELETE FROM pgboss.job WHERE data->>'reservationId' = ${reservation.id}`;
      await sql`DELETE FROM pgboss.archive WHERE data->>'reservationId' = ${reservation.id}`;
    }
    await sql`DELETE FROM customer WHERE email = ${email}`;
    await sql.end();
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
