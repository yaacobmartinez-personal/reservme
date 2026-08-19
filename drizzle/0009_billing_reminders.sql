-- Track when we last nudged an owner about billing, so the daily reminder job
-- emails each state (free month ending soon / lapsed) exactly once.

ALTER TABLE "subscription" ADD COLUMN IF NOT EXISTS trial_reminder_at timestamptz;
ALTER TABLE "subscription" ADD COLUMN IF NOT EXISTS due_reminder_at   timestamptz;
