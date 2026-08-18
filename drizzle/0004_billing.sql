-- Subscription billing — venue → ReservMe. Track each venue's free month and
-- subscription state, and record InstaPay transfers an owner submits for a
-- platform admin to verify. Band (what they owe) is NOT stored — it's computed
-- from active spaces at read time (planForSpaces), so a venue that pauses spaces
-- for the off-season drops a band without a write.
--
-- Deliberately NOT auto-suspending on non-payment: cutting off a venue's
-- bookings is a manual admin decision, not a billing side effect.

CREATE TABLE IF NOT EXISTS "subscription" (
  organization_id text PRIMARY KEY REFERENCES "organization"(id) ON DELETE CASCADE,
  status          text NOT NULL DEFAULT 'trialing'
                    CHECK (status IN ('trialing','active','past_due','cancelled','comped')),
  trial_ends_at   timestamptz NOT NULL,
  -- Paid through this date (manual/verified collection).
  paid_until      timestamptz,
  -- Provider fields, unused until the PayMongo phase.
  provider        text,
  provider_ref    text,
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS subscription_status_idx ON "subscription" (status);
CREATE INDEX IF NOT EXISTS subscription_trial_idx  ON "subscription" (trial_ends_at);

-- Owner-submitted InstaPay transfers awaiting (or having had) verification. The
-- proof is the InstaPay reference number — no screenshot (no blob storage yet).
CREATE TABLE IF NOT EXISTS "billing_payment" (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL REFERENCES "organization"(id) ON DELETE CASCADE,
  amount_cents    integer NOT NULL,
  reference       text NOT NULL,
  paid_at         date NOT NULL,
  status          text NOT NULL DEFAULT 'submitted'
                    CHECK (status IN ('submitted','approved','rejected')),
  reviewed_by     text REFERENCES "user"(id) ON DELETE SET NULL,
  reviewed_at     timestamptz,
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS billing_payment_org_idx    ON "billing_payment" (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS billing_payment_status_idx ON "billing_payment" (status);

-- Platform-wide settings, edited by a platform admin from the console. Holds
-- ReservMe's own InstaPay QR details (qr url, payee, account) so they can change
-- without a redeploy. One row per key.
CREATE TABLE IF NOT EXISTS "platform_setting" (
  key        text PRIMARY KEY,
  value      text NOT NULL,
  updated_by text REFERENCES "user"(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Backfill: every existing org gets a trialing subscription from its created_at.
INSERT INTO "subscription" (organization_id, status, trial_ends_at)
SELECT o.id, 'trialing', o.created_at + interval '1 month'
FROM "organization" o
LEFT JOIN "subscription" s ON s.organization_id = o.id
WHERE s.organization_id IS NULL
ON CONFLICT DO NOTHING;
