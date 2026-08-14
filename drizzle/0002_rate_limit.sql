-- Fixed-window rate limiting, in Postgres — no Redis, no new service.
--
-- One row per bucket ("book:ip:1.2.3.4", "book:venue:org_x"). The window rolls
-- forward in place via the upsert in src/lib/rate-limit.ts, so the table stays
-- tiny (one row per active key) and a periodic sweep clears idle keys.

CREATE TABLE IF NOT EXISTS "rate_limit" (
  bucket       text PRIMARY KEY,
  window_start timestamptz NOT NULL DEFAULT now(),
  count        integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS rate_limit_window_idx ON "rate_limit" (window_start);
