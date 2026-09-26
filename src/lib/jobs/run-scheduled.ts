import { sweepExpiredHolds } from "@/lib/booking/reserve";
import { sendBillingReminders, suspendOverdue } from "@/lib/billing-reminders";
import { accrueLoyalty, sendReviewRequests, sendWinbacks } from "@/lib/engagement";
import { pruneRateLimits } from "@/lib/rate-limit";

/**
 * Runs every time-based job the worker would otherwise schedule — hold sweep,
 * rate-limit prune, billing reminders + auto-suspend, loyalty accrual, and the
 * engagement (win-back + review) emails.
 *
 * Every one of these is idempotent and internally guarded (a stamp column, or a
 * "not yet done" filter), so it's safe to call at any frequency and safe to
 * overlap. That's what lets a worker-free deploy drive them from a plain cron
 * hit on /api/cron instead of a long-running pg-boss process.
 */
export type ScheduledSummary = {
  holdsReleased: number;
  trialSoon: number;
  pastDue: number;
  suspended: number;
  loyaltyCustomers: number;
  loyaltyPoints: number;
  winbacks: number;
  reviewRequests: number;
};

export async function runScheduledJobs(): Promise<ScheduledSummary> {
  const holdsReleased = await sweepExpiredHolds();
  await pruneRateLimits();

  const { trialSoon, pastDue } = await sendBillingReminders();
  const suspended = await suspendOverdue();

  const loyalty = await accrueLoyalty();
  const winbacks = await sendWinbacks();
  const reviewRequests = await sendReviewRequests();

  return {
    holdsReleased,
    trialSoon,
    pastDue,
    suspended,
    loyaltyCustomers: loyalty.customers,
    loyaltyPoints: loyalty.points,
    winbacks,
    reviewRequests,
  };
}
