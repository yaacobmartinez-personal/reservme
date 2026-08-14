-- Platform administration.
--
-- Everything else in this schema exists to keep tenants apart. This file
-- deliberately creates the one role that can see across them, so it also
-- creates the record of what that role did.

-- ════════════════════════════════════════════════════════════════════
-- Who is a platform admin
-- ════════════════════════════════════════════════════════════════════
--
-- Explicit grants rather than a boolean on "user", so there is always an
-- answer to "who made this person an admin, and when".
--
-- There is no way to grant the first one from inside the app — that would be
-- a privilege-escalation path from any account. Use: npm run admin:grant

CREATE TABLE IF NOT EXISTS "platform_admin" (
  user_id    text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  granted_by text REFERENCES "user"(id) ON DELETE SET NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  note       text
);

-- Partial index: the common lookup is "is this user currently an admin".
CREATE INDEX IF NOT EXISTS platform_admin_active_idx
  ON "platform_admin" (user_id) WHERE revoked_at IS NULL;

-- ════════════════════════════════════════════════════════════════════
-- What they did
-- ════════════════════════════════════════════════════════════════════
--
-- Append-only by convention. `actor_user_id` is always the real human, even
-- when the action was taken while impersonating a venue — the whole point of
-- an audit log is that impersonation cannot be used to launder an action.

CREATE TABLE IF NOT EXISTS "admin_audit" (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id   text NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  action          text NOT NULL,
  organization_id text REFERENCES "organization"(id) ON DELETE SET NULL,
  target          text,
  impersonating   boolean NOT NULL DEFAULT false,
  detail          jsonb,
  ip              text,
  user_agent      text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_audit_created_idx
  ON "admin_audit" (created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_actor_idx
  ON "admin_audit" (actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_org_idx
  ON "admin_audit" (organization_id, created_at DESC);

-- ════════════════════════════════════════════════════════════════════
-- Impersonation sessions
-- ════════════════════════════════════════════════════════════════════
--
-- Server-side state, not a claim in a cookie. The cookie carries only an
-- opaque token; whether it is still valid is decided here on every request,
-- so revoking is immediate and a stolen cookie expires on its own.

CREATE TABLE IF NOT EXISTS "admin_impersonation" (
  token           text PRIMARY KEY,
  admin_user_id   text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  organization_id text NOT NULL REFERENCES "organization"(id) ON DELETE CASCADE,
  reason          text,
  started_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  ended_at        timestamptz
);

CREATE INDEX IF NOT EXISTS admin_impersonation_active_idx
  ON "admin_impersonation" (admin_user_id) WHERE ended_at IS NULL;

-- ════════════════════════════════════════════════════════════════════
-- Venue suspension
-- ════════════════════════════════════════════════════════════════════
--
-- A suspended venue stops taking public bookings. Existing reservations are
-- left alone — cancelling someone's Saturday court because their venue is in
-- billing arrears is the venue's decision to make, not ours.

ALTER TABLE "venue"
  ADD COLUMN IF NOT EXISTS suspended_at     timestamptz,
  ADD COLUMN IF NOT EXISTS suspended_reason text;
