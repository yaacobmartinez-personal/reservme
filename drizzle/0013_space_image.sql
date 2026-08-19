-- A per-space photo, shown on the owner's Spaces list (and available to the
-- public page later). Stored as a size-capped data URL, same as venue branding
-- images — no object storage is wired.

ALTER TABLE "space" ADD COLUMN IF NOT EXISTS image_url text;
