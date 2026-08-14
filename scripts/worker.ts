/**
 * The background worker. Run it alongside `next start` in production, and
 * locally with `npm run worker`.
 *
 *   - hold-sweep:           every minute, releases expired holds reliably
 *                           (the web app also sweeps opportunistically, but a
 *                           quiet site could otherwise leave a hold sitting).
 *   - booking-confirmation: sends the confirmation email off the request path.
 *   - booking-reminder:     fires a few hours before the booking.
 *
 * Everything degrades safely: with no RESEND_API_KEY the email jobs "succeed"
 * by logging, so the worker is still useful for hold-sweeping alone.
 */
import { getBoss, QUEUES } from "../src/lib/jobs/boss";
import type { BookingJob } from "../src/lib/jobs/enqueue";
import { sweepExpiredHolds } from "../src/lib/booking/reserve";
import { sendBookingConfirmation, sendBookingReminder } from "../src/lib/email/send-booking";
import { pruneRateLimits } from "../src/lib/rate-limit";
import { captureException, initObservability } from "../src/lib/observability";

async function main() {
  initObservability();
  const boss = await getBoss();

  boss.on("error", (error) => captureException(error, { where: "pg-boss" }));

  // Queues must exist before work/schedule in pg-boss v10.
  await boss.createQueue(QUEUES.holdSweep);
  await boss.createQueue(QUEUES.bookingConfirmation);
  await boss.createQueue(QUEUES.bookingReminder);

  // ── hold sweep ────────────────────────────────────────────────────
  await boss.work(QUEUES.holdSweep, async () => {
    const released = await sweepExpiredHolds();
    if (released > 0) console.log(`[worker] released ${released} expired hold(s)`);
    // Piggyback the rate-limit cleanup on the same minute tick.
    await pruneRateLimits();
  });
  // Cron: every minute. Singleton by queue, so overlapping runs can't stack.
  await boss.schedule(QUEUES.holdSweep, "* * * * *");

  // ── confirmation email ────────────────────────────────────────────
  await boss.work<BookingJob>(QUEUES.bookingConfirmation, async ([job]) => {
    const result = await sendBookingConfirmation(job.data.reservationId, job.data.organizationId);
    if (!result.ok) throw new Error(result.error); // let pg-boss retry
    console.log(`[worker] confirmation ${result.delivered ? "sent" : "logged"} for ${job.data.reservationId}`);
  });

  // ── reminder email ────────────────────────────────────────────────
  await boss.work<BookingJob>(QUEUES.bookingReminder, async ([job]) => {
    const result = await sendBookingReminder(job.data.reservationId, job.data.organizationId);
    if (!result.ok) throw new Error(result.error);
    console.log(`[worker] reminder ${result.delivered ? "sent" : "logged"} for ${job.data.reservationId}`);
  });

  console.log("[worker] running — hold-sweep every minute, email queues live.");
}

main().catch((error) => {
  captureException(error, { where: "worker.start" });
  process.exit(1);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    console.log(`\n[worker] ${signal} — stopping`);
    const boss = await getBoss();
    await boss.stop({ graceful: true });
    process.exit(0);
  });
}
