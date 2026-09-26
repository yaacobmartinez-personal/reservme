import { getBoss, QUEUES } from "./boss";

/**
 * How the web app hands work to the worker. Enqueuing is best-effort: a failure
 * here must never break the thing the user was actually doing (a booking should
 * still succeed if the reminder can't be scheduled), so callers wrap these in a
 * try/catch and carry on.
 *
 * When `INLINE_JOBS=true` there is no worker — the event-driven jobs run in the
 * request instead of being queued (see the worker-free deploy notes). Scheduled
 * jobs are driven by /api/cron in that mode; a per-booking reminder has no
 * inline equivalent, so it's skipped.
 */

export type BookingJob = { reservationId: string; organizationId: string };

/** True in worker-free deploys: run event-driven jobs in-process, don't queue. */
export function jobsInline(): boolean {
  return process.env.INLINE_JOBS === "true";
}

/** Sends the confirmation email for a booking, out of the request path. */
export async function enqueueBookingConfirmation(job: BookingJob): Promise<void> {
  if (jobsInline()) {
    const { sendBookingConfirmation } = await import("@/lib/email/send-booking");
    const result = await sendBookingConfirmation(job.reservationId, job.organizationId);
    if (!result.ok) throw new Error(result.error);
    return;
  }
  const boss = await getBoss();
  await boss.send(QUEUES.bookingConfirmation, job, {
    singletonKey: `confirm:${job.reservationId}`,
    retryLimit: 5,
    retryDelay: 30,
    retryBackoff: true,
  });
}

/**
 * Schedules a reminder to fire `leadHours` before the booking starts. Skipped
 * automatically if that moment is already in the past (a booking made for
 * tonight shouldn't trigger an instant "reminder").
 */
export async function scheduleBookingReminder(
  job: BookingJob,
  startsAt: Date,
  leadHours = 3,
): Promise<void> {
  const sendAt = new Date(startsAt.getTime() - leadHours * 3600_000);
  if (sendAt.getTime() <= Date.now()) return;

  // No in-process equivalent for a future-scheduled send — reminders need the
  // worker (or a per-booking due-reminder sweep). Skipped in worker-free mode.
  if (jobsInline()) return;

  const boss = await getBoss();
  await boss.send(QUEUES.bookingReminder, job, {
    // One reminder per booking, however many times this is called.
    singletonKey: `remind:${job.reservationId}`,
    startAfter: sendAt,
    retryLimit: 3,
    retryDelay: 60,
  });
}
