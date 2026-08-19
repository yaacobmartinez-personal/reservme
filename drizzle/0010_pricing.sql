-- Peak / off-peak pricing. A rule overrides a space's base price for slots whose
-- local weekday + start time fall in its window (e.g. Fri–Sat 18:00–22:00 = ₱1,400).
-- The slot's start time decides its price; if several rules match, the most
-- recently created one wins. Base price (space.price_cents) is the fallback.

CREATE TABLE IF NOT EXISTS "pricing_rule" (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL REFERENCES "organization"(id) ON DELETE CASCADE,
  space_id        uuid NOT NULL REFERENCES "space"(id) ON DELETE CASCADE,
  label           text,
  weekdays        smallint[] NOT NULL,   -- 0=Sun … 6=Sat, matching Postgres DOW
  starts_at       time NOT NULL,
  ends_at         time NOT NULL,
  price_cents     integer NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pricing_rule_space_idx ON "pricing_rule" (space_id, created_at DESC);
