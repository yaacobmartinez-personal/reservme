-- Customer self-service. A per-reservation, unguessable token is the capability
-- behind the "manage your booking" link in confirmation emails — never the short
-- human `reference`, which is printed on tickets. Existing rows are backfilled.

ALTER TABLE "reservation" ADD COLUMN IF NOT EXISTS manage_token uuid;
UPDATE "reservation" SET manage_token = gen_random_uuid() WHERE manage_token IS NULL;
ALTER TABLE "reservation" ALTER COLUMN manage_token SET DEFAULT gen_random_uuid();
ALTER TABLE "reservation" ALTER COLUMN manage_token SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS reservation_manage_token_idx ON "reservation" (manage_token);
