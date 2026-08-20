# ReservMe — project status

**Last updated:** 2026-08-14 · **Branch:** `feat/reservme-soft-launch`

This is the current source of truth for what exists, what's verified, and what's
left. It supersedes the status sections of
[`launch-readiness.md`](launch-readiness.md) (which remains useful for the
detailed gap reasoning). Related docs:
[`app-plan.md`](app-plan.md) (architecture),
[`ph-pricing-research.md`](ph-pricing-research.md) (pricing),
[`dpa-template.md`](dpa-template.md) (legal).

---

## What ReservMe is

Booking software for Philippine venues — courts, studios, private rooms,
restaurants, tours. A venue signs up, adds its spaces, and gets a branded public
booking page. Flat price per venue, banded by space count, first month free, 0%
commission. Built for the PH market (peso pricing, GCash-first, Neon in
Singapore).

### Architecture (three surfaces)

| Surface | Host | What it is | Status |
| --- | --- | --- | --- |
| Marketing | `reservme.pro` | Landing, Privacy, Terms, Contact | **Static site extracted to `marketing/`** — deploy to Vercel now |
| App | `app.reservme.pro` | Auth + owner dashboard + public booking pages | Built, **not deployed** |
| Admin | `admin.reservme.pro` | Platform console (cross-tenant, staff only) | Built, not deployed |

Stack: Next.js 16, Postgres (Neon), Drizzle + raw SQL, Better Auth, pg-boss
worker, Resend email, all in one repo. The marketing site is a separate static
Next export.

---

## What's built and verified

Everything below has an automated test or a manual browser walkthrough behind
it — not "should work," but "seen working."

### The booking engine — the load-bearing part
- **Double-booking is structurally impossible.** A `btree_gist` `EXCLUDE`
  constraint enforces non-overlap at the database; a per-space advisory lock
  serialises writes so the constraint never deadlocks. `npm test`
  fires 24 concurrent bookings at one slot → exactly one wins, 10/10 from cold.
- Availability derived in **venue-local time** (DST-correct), holds with expiry,
  shared-session capacity via atomic conditional update.

### Multi-tenancy & auth
- Better Auth (organization plugin) over Neon. Owner/admin/staff roles.
- Tenant scope resolved in exactly one place (`src/lib/tenancy.ts`), never from
  a route param or form. Verified against Neon (real signup → session).

### Owner surface (`app.reservme.pro`)
- Sign up → create venue → **first-run "add your first space"** → live booking page.
- Venue management: spaces, weekly opening hours, closures, booking policy,
  settings. `npm run test:onboarding` + browser walkthrough.
- Run sheet with **check-in / no-show / cancel** (no-show flags the customer).
  `npm test` + browser.

### Public booking (`reservme.pro/<slug>`)
- Anonymous booking, no account. Space/date pickers, live slots, instant confirm.
- **Rate limited** (per-IP + per-venue) with a Turnstile hook.
  `npm test` (exact under concurrency).

### Platform admin console (`admin.reservme.pro`)
- Tenant list (with billing band + 30-day volume), tenant detail, suspend /
  reactivate, **impersonation** (server-side, time-boxed, audited), audit log.
- The one component that crosses tenants — built to leave a trace.
  `npm run test:admin` proves it refuses everyone it should.

### Background & platform
- **Worker** (pg-boss): reliable hold sweep, confirmation + reminder emails.
  `npm run test:jobs`.
- **Email** (Resend, gated on `RESEND_API_KEY`) — confirmation + reminder templates.
- **Observability**: structured JSON logs + Sentry-gated capture + `/api/healthz`.
- **Backups**: `pg_dump` backup/restore with retention (`npm run db:backup`).
- **Deploy artifacts**: Dockerfile (web + worker), `docker-compose.prod.yml`,
  GitHub Actions CI running lint + build + all six suites.

### Marketing & legal
- Premium PH-tailored landing page, banded peso pricing, honest copy (no invented
  proof). Extracted to `marketing/` as a static site for immediate hosting.
- Privacy Policy, Terms, Contact pages; DPA template. **Drafted, needs legal review.**

---

## What needs to be done

Ordered roughly by importance for running this as a real business.

> **Execution plans exist** for the two priorities below — self-contained,
> ready to hand to a cold start: [`plan-dashboard-redesign.md`](plan-dashboard-redesign.md)
> and [`plan-billing.md`](plan-billing.md).

### 1. Redesign the owner dashboard as a real business dashboard — ✅ DONE (2026-08-14)

Built and verified. The dashboard is now KPI tiles with sparklines + deltas
(booked value, bookings, utilisation, no-show rate), booked-value & utilisation
trend charts, a booking-mix donut, revenue-by-space bars, a peak-hours heatmap,
a customers panel, a "needs you" list, a period selector (today/7d/30d/90d), and
the run sheet with its actions. `src/lib/analytics.ts` does the aggregation in
venue-local time; charts are Recharts, token-coloured. `npm test`
(13 checks) + a 237-booking browser walkthrough. Remaining polish if wanted:
closures in the utilisation denominator, a custom date range, dark mode.

<details><summary>Original brief (kept for context)</summary>

**This is a business, not a school project, and the dashboard currently looks
like one.** Today it's a row of stat tiles and a flat run-sheet list — functional,
but it does not look or work like software a venue owner pays for and opens every
morning. It needs to become a proper operations-and-analytics dashboard.

What a booking business actually needs to see:

- **Revenue** — today / this week / this month, each with a **trend line** and a
  delta vs the previous period. Revenue **by space**. Confirmed vs pending.
- **Occupancy / utilisation** — % of bookable hours actually filled, overall and
  per space, over time. This is the number a venue lives or dies by.
- **Peak-hours heatmap** — day-of-week × hour — so an owner sees when demand is
  and prices/staffs accordingly.
- **Booking mix** — upcoming / completed / cancelled / no-show, with **no-show
  rate** trended (we already track no-shows per customer).
- **Customers** — new vs returning, top customers, repeat rate.
- **"Needs you" action list** — payments to verify, sessions half-empty, today's
  check-ins — surfaced above the run sheet.

**The good news: the data is already there.** Reservations carry timestamps,
amounts, statuses, spaces, and customers. This is a **presentation + query
layer**, not a new data model — mostly aggregation queries plus a charting
library (Recharts / visx, or hand-built SVG) and a genuinely designed layout
(KPI tiles with sparklines, line/bar charts, a heatmap, a status donut). It
should read like Linear/Stripe-grade product UI, not an MVP.

The public booking page and the run sheet's *actions* are fine; it's the
**dashboard's information design and visual quality** that need the lift. Treat
this as a first-class feature, not a polish pass.

</details>

### 2. Billing — knowing when the free month is up and collecting

**Not built.** Today nothing tracks a tenant's trial or subscription:

- The org's free month starts implicitly at `organization.created_at`, but
  **nothing computes when it ends**, flags an overdue venue, or records payment.
- The admin console shows what a venue *would* owe (band × price) but not whether
  they've paid or whether their free month has lapsed.

What's needed (see the dedicated section below): a trial/subscription state per
org, a way to see and act on "past free month, owes ₱X," and — later — automated
collection via a PH rail (PayMongo subscriptions). For a soft launch this can be
**manual** (admin sees who's due, marks paid), which is small to build.

### 3. Payments (customer → venue)

**Not built** — soft launch is pay-at-venue. The `payment` table exists but
nothing writes to it. Per the plan, build **Tier-0 GCash-QR-and-proof** first
(no gateway account), then PayMongo/Xendit. See
[`app-plan.md`](app-plan.md) §6.

### 4. Remaining product features
- Waitlists (auto-fill on cancellation).
- Prepaid packs & passes; weekly regulars (SAVEPOINT-per-week logic designed).
- Staff invitations UI (Better Auth supports it; no screen yet).
- Branding upload (logo / theme / cover photo).
- CSV export + live calendar feed.
- Customer self-service reschedule/cancel via `manage/[token]` (route not built).
- Auth hardening: email verification + password reset (needs email configured).

### 5. Deploy & go-live (mostly ops, yours)
- **Marketing**: deploy `marketing/` to Vercel (Root Directory = `marketing`,
  `vercel.json` set) → point `reservme.pro`.
- **App**: deploy web + worker (Fly / Railway run both; Vercel needs the worker
  elsewhere). Set prod env: fresh `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, the
  `NEXT_PUBLIC_*_HOST` values, Neon URL, and optionally `RESEND_API_KEY`,
  `SENTRY_DSN`, Turnstile keys.
- **DNS** for the three subdomains; **legal review**; **schedule backups**.

---

## Billing / free-month tracking — current state & recommendation

Because it was asked directly: **how do we know a tenant has passed the free
month and should pay? Today, we can't — it isn't built.** The recommended shape:

1. **Track trial + subscription state on the org.** Add (e.g.) `trial_ends_at`
   (default `created_at + interval '1 month'`) and a `billing_status`
   (`trialing` → `active` / `past_due` / `cancelled`).
2. **Derive "should be paying now"**: `now() > trial_ends_at AND billing_status =
   'trialing'`. The amount owed is already computed (active-space band × price).
3. **Surface it in the admin console**: a "Billing" view listing venues whose
   free month has lapsed, what band/amount they owe, and — for soft launch — a
   **"mark paid until <date>"** action (manual collection).
4. **Nudge the owner**: a dashboard banner and a reminder email a few days before
   the free month ends (the worker + email pipeline already exist).
5. **Later, automate**: PayMongo subscriptions (peso, GCash/card) as the billing
   rail — not Stripe. A `subscription` record per org, updated on webhook.

This is a contained build (one migration + a couple of admin/dashboard views +
one reminder job). Flagging it as the natural next step after — or alongside —
the dashboard redesign.

---

## Test suites (all green)

```bash
npm test                  # the whole Vitest suite (24 DB/lib scenarios)
npm run test:coverage     # same, with a v8 coverage summary
npm run test:onboarding   # empty venue → bookable through the owner surface  (needs the app running)
npm run test:admin        # platform console refuses everyone it should       (needs the app running)
npm run test:jobs         # booking → queue → worker → email  (needs `npm run worker`)
```
The Vitest suite covers booking concurrency, run-sheet management, rate limiting,
analytics, CRM, calendar, auth, billing, branding, self-service, staff, waitlist,
export, reminders, pricing, sessions, portfolio, promo, engagement, memberships,
integrations, suspension, admin ops, and storage. `test:onboarding`/`test:admin`/
`test:jobs` are HTTP suites still run as standalone scripts.

Plus lint, typecheck, and `npm run build`. CI runs all of it on push/PR.

---

## Key decisions & caveats on record
- **Soft launch = pay-at-venue.** Customer payments and our own subscription
  billing are deferred; the app is otherwise complete for hand-held pilots.
- **Legal pages are honest drafts, not reviewed** — get counsel before public.
- **Marketing is a copy, not shared code** — the `marketing/` site duplicates the
  landing components/tokens as a hosting bridge; consolidate into a shared package
  when the app serves the apex itself.
- **PH-first throughout**: peso pricing, GCash rails (not Stripe), Neon in
  Singapore, Philippine Standard Time defaults.
