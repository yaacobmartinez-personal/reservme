# Changelog

All notable changes to ReservMe are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims to
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_Nothing yet._

## [0.1.0] — 2026-08-20

First tagged cut of the soft-launch build: a working multi-tenant booking
platform for Philippine venues, not yet deployed.

### Added
- **Booking engine** — double-booking made structurally impossible by a
  `btree_gist` `EXCLUDE` constraint plus a per-space advisory lock; availability
  derived in venue-local (DST-correct) time; holds with expiry; shared-session
  capacity via an atomic conditional update.
- **Multi-tenancy & auth** — Better Auth (organization plugin) over Postgres;
  owner/admin/staff roles; tenant scope resolved in exactly one place
  (`src/lib/tenancy.ts`), never from a route param or form.
- **Owner surface** (`app.reservme.pro`) — sign up → create venue → first-run
  "add your first space" → live booking page; spaces, weekly opening hours,
  closures, booking policy, and settings; a run sheet with check-in / no-show /
  cancel; a KPI + charts business dashboard (booked value, bookings, utilisation,
  no-show rate, booking mix, revenue by space, peak-hours heatmap) in
  venue-local time.
- **Public booking** (`reservme.pro/<slug>`) — anonymous booking with no account,
  space/date pickers, live slots, instant confirm; per-IP + per-venue rate
  limiting with a Turnstile hook.
- **Platform admin console** (`admin.reservme.pro`) — a sidebar shell and visual
  dashboard; tenant list with billing band and 30-day volume, tenant detail,
  suspend / reactivate, and an audit log; full-app impersonation (server-side,
  time-boxed, audited — you see exactly what the tenant sees); every privileged
  action is recorded.
- **Image storage** — Cloudflare R2 (S3-compatible) for court images, venue
  logos, cover photos, and payment QR codes, with a graceful data-URL fallback
  when unconfigured. Uploads go directly browser → `/api/upload` → short URL, so
  Server Action payloads stay small (logo/cover limit 2 MB each). The public
  embed shows the venue logo + cover and lets customers pick any date up to the
  booking horizon; courts render as photo cards.
- **Background & platform** — pg-boss worker (hold sweep, confirmation + reminder
  emails); Resend email gated on `RESEND_API_KEY`; structured JSON logs +
  Sentry-gated capture + `/api/healthz`; `pg_dump` backup/restore with retention.
- **Branding, pricing, memberships & passes, promo codes, engagement/loyalty,
  waitlists, CSV export, staff invitations, calendar (iCal), and distribution
  integrations.**
- **Marketing & legal** — PH-tailored landing page with banded peso pricing,
  extracted to `marketing/` as a static site; Privacy, Terms, Contact pages and a
  DPA template (drafted, pending legal review).
- **Deploy artifacts** — Dockerfile (web + worker), `docker-compose.prod.yml`,
  and a GitHub Actions CI running lint + typecheck + build + the test suites.

### Testing
- **Vitest** with v8 coverage. The 24 DB/lib-level scenario suites live in
  `test/*.test.ts` and run from a fresh clone with no `.env` file — the runner
  defaults to the docker DB and migrates + seeds itself. CI runs
  `npm run test:coverage` and uploads the coverage report; a
  `docker-compose.test.yml` provides a throwaway DB.

[Unreleased]: https://github.com/yaacobmartinez-personal/reservme/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/yaacobmartinez-personal/reservme/releases/tag/v0.1.0
