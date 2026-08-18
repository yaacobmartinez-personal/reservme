-- Better Auth 1.6's organization plugin writes invitation.createdAt; the original
-- init table predates it. Add the column so invites can be created.

ALTER TABLE "invitation" ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
