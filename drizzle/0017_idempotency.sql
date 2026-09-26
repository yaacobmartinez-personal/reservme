-- What an `Idempotency-Key` produced, so a booking retried after a dropped
-- connection returns the first reservation instead of making a second one.
--
-- Keyed by organisation as well as by key: two venues cannot collide, and a
-- key replayed against a different venue is a new request rather than a way to
-- read somebody else's booking.
--
-- Rows are disposable. They only need to outlive a retry, and the worker's
-- sweep prunes them like it prunes rate-limit buckets.

CREATE TABLE IF NOT EXISTS "idempotency_key" (
  organization_id text NOT NULL REFERENCES "organization"(id) ON DELETE CASCADE,
  key             text NOT NULL,
  reservation_id  uuid NOT NULL REFERENCES "reservation"(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, key)
);

CREATE INDEX IF NOT EXISTS idempotency_key_created_idx ON "idempotency_key" (created_at);
