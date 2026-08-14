-- ReservMe · initial schema
--
-- The load-bearing part of this file is `reservation_no_overlap` at the very
-- bottom. Everything else is bookkeeping around it.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ════════════════════════════════════════════════════════════════════
-- Auth (Better Auth core + organization plugin)
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "user" (
  id             text PRIMARY KEY,
  name           text NOT NULL,
  email          text NOT NULL UNIQUE,
  email_verified boolean NOT NULL DEFAULT false,
  image          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "session" (
  id                       text PRIMARY KEY,
  expires_at               timestamptz NOT NULL,
  token                    text NOT NULL UNIQUE,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  ip_address               text,
  user_agent               text,
  user_id                  text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  active_organization_id   text
);

CREATE TABLE IF NOT EXISTS "account" (
  id                        text PRIMARY KEY,
  account_id                text NOT NULL,
  provider_id               text NOT NULL,
  user_id                   text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  access_token              text,
  refresh_token             text,
  id_token                  text,
  access_token_expires_at   timestamptz,
  refresh_token_expires_at  timestamptz,
  scope                     text,
  password                  text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "verification" (
  id         text PRIMARY KEY,
  identifier text NOT NULL,
  value      text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- The tenant. `slug` is the venue's public booking path: reservme.pro/<slug>
CREATE TABLE IF NOT EXISTS "organization" (
  id         text PRIMARY KEY,
  name       text NOT NULL,
  slug       text NOT NULL UNIQUE,
  logo       text,
  metadata   text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "member" (
  id              text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES "organization"(id) ON DELETE CASCADE,
  user_id         text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  role            text NOT NULL DEFAULT 'member',
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id)
);

CREATE TABLE IF NOT EXISTS "invitation" (
  id              text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES "organization"(id) ON DELETE CASCADE,
  email           text NOT NULL,
  role            text,
  status          text NOT NULL DEFAULT 'pending',
  expires_at      timestamptz NOT NULL,
  inviter_id      text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE
);

-- ════════════════════════════════════════════════════════════════════
-- Venue configuration (1:1 with organization)
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "venue" (
  organization_id           text PRIMARY KEY REFERENCES "organization"(id) ON DELETE CASCADE,
  -- IANA name. Opening hours are local time-of-day; this is what converts them.
  timezone                  text NOT NULL DEFAULT 'Asia/Manila',
  currency                  text NOT NULL DEFAULT 'PHP',
  theme                     text NOT NULL DEFAULT 'pine',
  tagline                   text,
  address                   text,
  -- Policy, shown before anyone pays.
  min_notice_minutes        integer NOT NULL DEFAULT 60 CHECK (min_notice_minutes >= 0),
  max_horizon_days          integer NOT NULL DEFAULT 60 CHECK (max_horizon_days > 0),
  cancellation_mode         text NOT NULL DEFAULT 'grace'
                              CHECK (cancellation_mode IN ('anytime', 'grace', 'never')),
  cancellation_grace_hours  integer NOT NULL DEFAULT 24 CHECK (cancellation_grace_hours >= 0),
  refund_terms              text,
  -- Tier 0 payments: show a QR, customer uploads proof, owner approves.
  gcash_qr_url              text,
  gcash_name                text,
  created_at                timestamptz NOT NULL DEFAULT now()
);

-- A bookable thing: a court, a room, a table group, a boat.
-- The count of active rows here picks the billing band.
CREATE TABLE IF NOT EXISTS "space" (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL REFERENCES "organization"(id) ON DELETE CASCADE,
  name            text NOT NULL,
  slug            text NOT NULL,
  kind            text NOT NULL DEFAULT 'court',
  -- Per-person capacity when this space runs shared sessions.
  capacity        integer NOT NULL DEFAULT 1 CHECK (capacity > 0),
  -- Booking granularity and turnaround time, in minutes.
  slot_minutes    integer NOT NULL DEFAULT 60 CHECK (slot_minutes > 0),
  buffer_minutes  integer NOT NULL DEFAULT 0 CHECK (buffer_minutes >= 0),
  price_cents     integer NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  is_active       boolean NOT NULL DEFAULT true,
  sort_order      integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, slug)
);

-- Weekday + local time-of-day. Never an instant: storing opening hours as
-- instants breaks silently twice a year wherever the clocks move.
CREATE TABLE IF NOT EXISTS "opening_hours" (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id  uuid NOT NULL REFERENCES "space"(id) ON DELETE CASCADE,
  weekday   smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),  -- 0 = Sunday
  opens_at  time NOT NULL,
  closes_at time NOT NULL,
  CHECK (closes_at > opens_at)
);

CREATE TABLE IF NOT EXISTS "closure" (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL REFERENCES "organization"(id) ON DELETE CASCADE,
  -- NULL space_id closes the whole venue (a public holiday, a typhoon).
  space_id        uuid REFERENCES "space"(id) ON DELETE CASCADE,
  starts_at       timestamptz NOT NULL,
  ends_at         timestamptz NOT NULL,
  reason          text,
  CHECK (ends_at > starts_at)
);

-- ════════════════════════════════════════════════════════════════════
-- Customers — deliberately NOT users. They never get a password.
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "customer" (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL REFERENCES "organization"(id) ON DELETE CASCADE,
  name            text NOT NULL,
  email           text NOT NULL,
  phone           text,
  no_show_count   integer NOT NULL DEFAULT 0 CHECK (no_show_count >= 0),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, email)
);

-- ════════════════════════════════════════════════════════════════════
-- Shared sessions — open play, classes, tour departures
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "play_session" (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         text NOT NULL REFERENCES "organization"(id) ON DELETE CASCADE,
  space_id                uuid NOT NULL REFERENCES "space"(id) ON DELETE CASCADE,
  title                   text NOT NULL,
  starts_at               timestamptz NOT NULL,
  ends_at                 timestamptz NOT NULL,
  capacity                integer NOT NULL CHECK (capacity > 0),
  booked_spots            integer NOT NULL DEFAULT 0,
  price_per_person_cents  integer NOT NULL DEFAULT 0 CHECK (price_per_person_cents >= 0),
  cancelled               boolean NOT NULL DEFAULT false,
  created_at              timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  -- The backstop. Spots are claimed with a conditional UPDATE, but if anyone
  -- ever writes this counter by hand the database still refuses to oversell.
  CONSTRAINT play_session_not_oversold
    CHECK (booked_spots BETWEEN 0 AND capacity)
);

-- ════════════════════════════════════════════════════════════════════
-- Reservations
-- ════════════════════════════════════════════════════════════════════
--
-- `kind` decides whether a row occupies the space exclusively:
--   rental        — someone booked the whole space for that period
--   session_block — a play_session's footprint, so a session and a rental
--                   can never be sold over each other
--   session_seat  — one person's spot inside a session. Does NOT occupy the
--                   space; capacity is enforced by play_session.booked_spots
--
-- `during` is generated, so the range can never drift from the timestamps.

CREATE TABLE IF NOT EXISTS "reservation" (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL REFERENCES "organization"(id) ON DELETE CASCADE,
  space_id        uuid NOT NULL REFERENCES "space"(id) ON DELETE CASCADE,
  session_id      uuid REFERENCES "play_session"(id) ON DELETE CASCADE,
  customer_id     uuid REFERENCES "customer"(id) ON DELETE SET NULL,

  kind            text NOT NULL DEFAULT 'rental'
                    CHECK (kind IN ('rental', 'session_block', 'session_seat')),
  status          text NOT NULL DEFAULT 'held'
                    CHECK (status IN ('held', 'confirmed', 'cancelled', 'no_show')),

  starts_at       timestamptz NOT NULL,
  ends_at         timestamptz NOT NULL,
  during          tstzrange GENERATED ALWAYS AS
                    (tstzrange(starts_at, ends_at, '[)')) STORED,

  party_size      integer NOT NULL DEFAULT 1 CHECK (party_size > 0),
  amount_cents    integer NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),

  hold_expires_at timestamptz,
  checked_in_at   timestamptz,
  cancelled_at    timestamptz,
  reference       text NOT NULL UNIQUE,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),

  CHECK (ends_at > starts_at),
  -- A hold with no expiry is a slot that is blocked forever.
  CONSTRAINT reservation_hold_has_expiry
    CHECK (status <> 'held' OR hold_expires_at IS NOT NULL),
  CONSTRAINT reservation_seat_has_session
    CHECK (kind <> 'session_seat' OR session_id IS NOT NULL)
);

-- ────────────────────────────────────────────────────────────────────
-- THE constraint.
--
-- Two live reservations that occupy a space may never overlap on it. This
-- is not a check the application performs — it is a rule the database will
-- not allow to be broken, so two people tapping the same 20:00 in the same
-- millisecond resolve to one winner and one clean rejection.
--
-- Cancelled and no-show rows drop out of the constraint immediately, which
-- is what frees the slot for someone else.
-- ────────────────────────────────────────────────────────────────────
ALTER TABLE "reservation"
  ADD CONSTRAINT reservation_no_overlap
  EXCLUDE USING gist (space_id WITH =, during WITH &&)
  WHERE (kind IN ('rental', 'session_block') AND status IN ('held', 'confirmed'));

CREATE INDEX IF NOT EXISTS reservation_org_starts_idx
  ON "reservation" (organization_id, starts_at);
CREATE INDEX IF NOT EXISTS reservation_space_starts_idx
  ON "reservation" (space_id, starts_at);
CREATE INDEX IF NOT EXISTS reservation_hold_sweep_idx
  ON "reservation" (hold_expires_at) WHERE status = 'held';
CREATE INDEX IF NOT EXISTS play_session_space_starts_idx
  ON "play_session" (space_id, starts_at);

-- ════════════════════════════════════════════════════════════════════
-- Payments — Tier 0 (GCash proof) and Tier 1 (PayMongo/Xendit)
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "payment" (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL REFERENCES "organization"(id) ON DELETE CASCADE,
  reservation_id  uuid NOT NULL REFERENCES "reservation"(id) ON DELETE CASCADE,
  method          text NOT NULL
                    CHECK (method IN ('gcash_proof', 'paymongo', 'xendit', 'cash')),
  status          text NOT NULL DEFAULT 'awaiting'
                    CHECK (status IN ('awaiting', 'approved', 'rejected', 'refunded')),
  amount_cents    integer NOT NULL CHECK (amount_cents >= 0),
  proof_url       text,
  gateway_ref     text,
  reviewed_by     text REFERENCES "user"(id) ON DELETE SET NULL,
  reviewed_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payment_org_status_idx
  ON "payment" (organization_id, status);
