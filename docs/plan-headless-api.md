# Plan — Fully headless (write API)

**Goal:** let a client build their *own* booking UI on their own site/app —
no iframe, full control of the look and flow — backed by ReservMe. The iframe
embed (shipped) covers "keep your site, drop in our widget"; this covers "keep
your site AND your own UI, we're just the engine."

## What exists today
- **Read API**: `GET /api/v1/spaces`, `GET /api/v1/bookings` — Bearer-auth with
  hashed API keys (`api_key` table, `rk_live_…`).
- **Webhooks**: `booking.created` / `booking.cancelled`, signed.
- Missing for headless: a public **availability** read, and **create /
  cancel** endpoints. The booking logic itself already exists in `bookSlot`
  (`src/app/[venueSlug]/actions.ts`) and the race-safe engine (`reserveSpace`).

## Endpoints to add (`/api/v1`)
1. `GET /api/v1/availability?space={slug|id}&date=YYYY-MM-DD` → the day's slots
   (reuse `getDayAvailability`) + sessions. Read-only, safe to expose.
2. `POST /api/v1/bookings` → create a booking:
   `{ spaceId, startsAt, endsAt, name, email, phone?, promo? }` →
   reuse the `bookSlot` pipeline (reserveSpace → promo → membership redemption →
   confirmation email → `booking.created` webhook). Returns
   `{ reference, amountCents, status, manageUrl }`. **The sensitive endpoint** —
   see safety below.
3. `POST /api/v1/bookings/{reference}/cancel` → cancel (honours the venue's
   cancellation policy), emits `booking.cancelled`. (Reschedule optional in v1.)
4. `GET /api/v1/bookings/{reference}` → one booking by reference.

## The crux: auth model for a public website
A headless site calls from the **browser**, which can't hold a secret. Two key
types (the Stripe pattern):

- **Secret key** (`rk_live_…`, today's key) — server-side only, full access.
  The client's backend holds it and proxies booking calls. Safest; unblocks any
  client who has a server. **M1 ships this.**
- **Publishable key** (`rk_pub_…`, new) — safe in browser code, so a pure
  front-end can call `availability` + `bookings` directly. Constrained:
  - **Origin allowlist** per key (checked against `Origin`/`Referer`).
  - **CORS**: reflect allowed origins + handle `OPTIONS` preflight.
  - **Turnstile required** on create (same human-check as the public form).
  - Create + availability only — never read others' bookings/customers.

## Safety (create-booking is as exposed as the public form)
- Rate-limit create by **IP + key + venue** (reuse `rateLimit`).
- **Idempotency-Key** header → dedupe accidental double-submits.
- Double-booking is already impossible (advisory lock + `no_overlap` exclusion
  constraint) — the API inherits that for free.
- Suspended venues refuse writes (same check as `bookSlot`).

## Conventions
`/api/v1`, JSON, ISO-8601 timestamps, amounts in centavos, errors as
`{ error, message }`. Ship an OpenAPI spec + a short "headless quickstart".
Keys and webhooks are managed from Settings → Integrations (already there).

## Milestones
- **M1 — server-to-server headless.** `availability` + `POST bookings` +
  `GET bookings/{ref}` with **secret** keys. Unblocks clients with a backend.
- **M2 — browser headless.** `rk_pub_…` publishable keys + origin allowlist +
  CORS + Turnstile. Unblocks pure front-end sites.
- **M3 — round it out.** cancel/reschedule endpoints, OpenAPI, quickstart,
  idempotency, per-key usage in the console.

## Out of scope (v1)
Customer accounts/login, online payments (still pay-at-venue), writing spaces or
pricing via API, GraphQL. Test surface mirrors `test-integrations` (key scoping,
rate limit, idempotency, availability correctness, create → webhook).
