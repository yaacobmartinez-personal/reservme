-- Waitlist. When a slot is taken, a customer can ask to be told if it frees.
-- On a cancellation we promote the earliest waiter for the freed slot and email
-- them a booking link — a notification, not an auto-hold: first to re-book wins.

CREATE TABLE IF NOT EXISTS "waitlist" (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL REFERENCES "organization"(id) ON DELETE CASCADE,
  space_id        uuid NOT NULL REFERENCES "space"(id) ON DELETE CASCADE,
  starts_at       timestamptz NOT NULL,
  ends_at         timestamptz NOT NULL,
  customer_id     uuid NOT NULL REFERENCES "customer"(id) ON DELETE CASCADE,
  status          text NOT NULL DEFAULT 'waiting'
                    CHECK (status IN ('waiting','notified','converted','expired')),
  notified_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS waitlist_slot_idx ON "waitlist" (space_id, starts_at, status);
-- One live waiting entry per customer per slot.
CREATE UNIQUE INDEX IF NOT EXISTS waitlist_unique_waiting
  ON "waitlist" (space_id, starts_at, customer_id) WHERE status = 'waiting';
