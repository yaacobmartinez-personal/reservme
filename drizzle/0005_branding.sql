-- Venue branding. The logo lives on organization.logo and the theme on
-- venue.theme (both already exist); only the cover photo needs a new column.
-- Images are stored as size-capped data URLs (no object storage yet) — a URL is
-- a URL, so moving to a CDN later doesn't touch this schema.

ALTER TABLE "venue" ADD COLUMN IF NOT EXISTS cover_url text;
