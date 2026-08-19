-- Memberships, packages & passes — the foundation. Owners define plans and sell
-- them to customers (payment stays pay-at-venue / proof-based, like the venue
-- subscription); credits are tracked here and consumed at booking. A credit
-- covers one booking; a membership may instead carry a % discount.

CREATE TABLE IF NOT EXISTS "membership_plan" (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      text NOT NULL REFERENCES "organization"(id) ON DELETE CASCADE,
  name                 text NOT NULL,
  kind                 text NOT NULL CHECK (kind IN ('pass','membership')),
  price_cents          integer NOT NULL DEFAULT 0,
  credits              integer,                 -- booking credits granted; null = none
  period               text NOT NULL DEFAULT 'one_time' CHECK (period IN ('one_time','monthly')),
  benefit_discount_pct integer,                 -- optional % off bookings; null = 0
  valid_days           integer,                 -- validity window from grant; null = no expiry
  active               boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

CREATE TABLE IF NOT EXISTS "customer_membership" (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   text NOT NULL REFERENCES "organization"(id) ON DELETE CASCADE,
  customer_id       uuid NOT NULL REFERENCES "customer"(id) ON DELETE CASCADE,
  plan_id           uuid NOT NULL REFERENCES "membership_plan"(id) ON DELETE RESTRICT,
  credits_remaining integer NOT NULL DEFAULT 0,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','cancelled')),
  starts_at         timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS customer_membership_customer_idx
  ON "customer_membership" (customer_id, status);

CREATE TABLE IF NOT EXISTS "membership_redemption" (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        text NOT NULL REFERENCES "organization"(id) ON DELETE CASCADE,
  customer_membership_id uuid NOT NULL REFERENCES "customer_membership"(id) ON DELETE CASCADE,
  reservation_id         uuid REFERENCES "reservation"(id) ON DELETE SET NULL,
  credits_used           integer NOT NULL DEFAULT 0,
  discount_cents         integer NOT NULL DEFAULT 0,
  created_at             timestamptz NOT NULL DEFAULT now()
);
