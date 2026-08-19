-- Promo / discount codes. A code discounts a booking's amount at checkout; the
-- discount is applied to reservation.amount_cents (so the confirmation email
-- shows it) and the use is recorded. Consumption is atomic (uses+1 under the
-- cap) so a limited code can't be over-redeemed under concurrency.

CREATE TABLE IF NOT EXISTS "promo_code" (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL REFERENCES "organization"(id) ON DELETE CASCADE,
  code            text NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('percent','amount')),
  value           integer NOT NULL,        -- percent (1–100) or centavos off
  max_uses        integer,                 -- null = unlimited
  uses            integer NOT NULL DEFAULT 0,
  expires_at      timestamptz,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);

CREATE TABLE IF NOT EXISTS "promo_redemption" (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL REFERENCES "organization"(id) ON DELETE CASCADE,
  promo_code_id   uuid NOT NULL REFERENCES "promo_code"(id) ON DELETE CASCADE,
  reservation_id  uuid REFERENCES "reservation"(id) ON DELETE SET NULL,
  discount_cents  integer NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS promo_redemption_code_idx ON "promo_redemption" (promo_code_id);
