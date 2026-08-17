-- Customers / CRM. Turns the invisible `customer` row (created as a side effect
-- of a booking) into something an owner manages: tags, notes, and a profile.
--
-- No new identity: a customer is still one-per-venue, keyed by
-- (organization_id, email), never a login. This migration only adds the
-- attributes owners asked for — free-form notes, tags, and a marketing flag.

-- Free-form staff notes on a customer (timestamped, attributed).
-- author_user_id is SET NULL on user delete so a note survives the staffer who
-- wrote it; the org cascade is what actually reaps notes when a venue is gone.
CREATE TABLE IF NOT EXISTS "customer_note" (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL REFERENCES "organization"(id) ON DELETE CASCADE,
  customer_id     uuid NOT NULL REFERENCES "customer"(id) ON DELETE CASCADE,
  author_user_id  text REFERENCES "user"(id) ON DELETE SET NULL,
  body            text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Newest-first per customer is the only access pattern.
CREATE INDEX IF NOT EXISTS customer_note_customer_idx
  ON "customer_note" (customer_id, created_at DESC);

-- Tags as a text[] on the customer — light, queryable with && / @>, no join
-- table for what is a short hand-curated list per customer.
ALTER TABLE "customer" ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';

-- Marketing consent. Column now (cheap, avoids a later migration); no UI in v1.
ALTER TABLE "customer" ADD COLUMN IF NOT EXISTS marketing_opt_in boolean NOT NULL DEFAULT false;

-- GIN for the tag filter (@> / &&).
CREATE INDEX IF NOT EXISTS customer_tags_idx ON "customer" USING gin (tags);

-- The list aggregates reservations by customer; make that join cheap.
CREATE INDEX IF NOT EXISTS reservation_customer_idx
  ON "reservation" (customer_id) WHERE customer_id IS NOT NULL;
