-- Engagement + loyalty foundation.
--
--  * loyalty_points: accrued 1 point per ₱100 of a confirmed booking. Accrual
--    is done by a background job and is idempotent — reservation.loyalty_accrued
--    marks the rows already counted so a re-run never double-awards.
--  * winback_at: stamped when a lapsed ("at risk") customer is emailed a
--    win-back nudge, so each customer is nudged at most once.
--  * review_requested_at: stamped when a review-request email is sent for a
--    completed booking, so each booking is asked at most once.
--  * venue.review_url: the owner's review link (e.g. Google) — review requests
--    only go out for venues that have set one.

ALTER TABLE "customer"
  ADD COLUMN IF NOT EXISTS loyalty_points integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS winback_at timestamptz;

ALTER TABLE "reservation"
  ADD COLUMN IF NOT EXISTS loyalty_accrued boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS review_requested_at timestamptz;

ALTER TABLE "venue"
  ADD COLUMN IF NOT EXISTS review_url text;

-- Existing confirmed history predates loyalty; treat it as already accounted
-- for so the first accrual run doesn't retroactively award points for it.
UPDATE "reservation" SET loyalty_accrued = true WHERE status = 'confirmed';

CREATE INDEX IF NOT EXISTS reservation_loyalty_pending_idx
  ON "reservation" (customer_id)
  WHERE status = 'confirmed' AND loyalty_accrued = false;
