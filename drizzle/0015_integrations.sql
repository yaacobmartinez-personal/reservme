-- Distribution & integrations: a private iCal feed token per venue, outbound
-- webhook endpoints, and API keys. All served on the app host under /api
-- (the token / bearer key is the auth; the proxy 404s these on the apex host).

ALTER TABLE "venue"
  ADD COLUMN IF NOT EXISTS ical_token uuid NOT NULL DEFAULT gen_random_uuid();

CREATE TABLE IF NOT EXISTS "webhook_endpoint" (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL REFERENCES "organization"(id) ON DELETE CASCADE,
  url             text NOT NULL,
  secret          text NOT NULL,           -- HMAC key; shown to the owner
  events          text[] NOT NULL DEFAULT '{}',
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS webhook_endpoint_org_idx
  ON "webhook_endpoint" (organization_id) WHERE active;

CREATE TABLE IF NOT EXISTS "api_key" (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL REFERENCES "organization"(id) ON DELETE CASCADE,
  name            text NOT NULL,
  key_prefix      text NOT NULL,           -- first chars, shown in the list
  key_hash        text NOT NULL,           -- sha-256 of the full key
  last_used_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  revoked_at      timestamptz
);

CREATE INDEX IF NOT EXISTS api_key_hash_idx ON "api_key" (key_hash);
