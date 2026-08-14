# ReservMe — application plan

The marketing page makes three promises that are hard to keep. Everything below
is arranged around keeping them:

1. **"The last slot cannot be sold twice."** Correctness under concurrency.
2. **"No account needed."** Customers are records, not users.
3. **"0% commission."** Money moves venue ⇄ customer; we are never in the path.

---

## 1. Stack

| Concern | Choice | Why |
| --- | --- | --- |
| Framework | Next.js 16, App Router, RSC + Server Actions | Already scaffolded |
| Database | Postgres 17 (Docker, port **5433**) | Exclusion constraints and range types are the core of the booking engine |
| Query layer | **Drizzle ORM** + hand-written SQL migrations | We need `tstzrange`, `btree_gist` and `EXCLUDE` constraints. Prisma cannot express these; Drizzle stays out of the way |
| Auth | **Better Auth** (organization plugin) | Ships orgs, memberships and roles — which is exactly our tenancy model. Auth.js v5 + Drizzle adapter is the fallback if we'd rather hand-roll orgs |
| Payments | **PayMongo / Xendit** (venue's own account) + GCash QR with proof approval | PH rails, not Stripe. Two separate surfaces, see §6 |
| Email | Resend + React Email | Confirmations, reminders, waitlist claims |
| Jobs | Postgres-backed queue (`pg-boss`) | Hold expiry, reminders, waitlist promotion. No extra infrastructure |

Port 5433 is deliberate — it keeps clear of any Postgres already running locally.

---

## 2. Tenancy

```
organization ──< membership >── user          (staff: owner | manager | staff)
     │
     ├──< space          (count of active ones picks the billing band)
     ├──< customer       (per-org, NOT a user)
     ├──< reservation
     └──< policy, branding, opening_hours, closure, price_rule
```

**`user` and `customer` are different tables and must stay that way.** A `user`
signs in and runs a venue. A `customer` books a court and never has a password.
The same human may be both, in different orgs, with no relationship between the
records. Collapsing them is the single easiest way to break the "no account
needed" promise later.

Every tenant-scoped table carries `organization_id`. Enforce it in a single
data-access layer that takes the active org from the session — not per-query at
call sites, which is where cross-tenant leaks come from.

---

## 3. The booking engine

### 3.1 Time is stored in UTC and reasoned about in venue-local

- Every instant is `timestamptz` — Postgres stores UTC.
- `organization.timezone` is an IANA name (`Asia/Manila`, `Europe/Madrid`).
- `opening_hours` stores **weekday + local time-of-day**, never an instant.

Slot generation converts local → UTC at query time, so a club that opens at
09:00 still opens at 09:00 the week the clocks change. Storing opening hours as
instants breaks silently twice a year.

### 3.2 Exclusive rentals — the database refuses to double-book

This is the load-bearing decision. We do **not** check-then-insert; that is a
race with a comfortable-looking window in it.

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE reservation (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organization(id),
  space_id         uuid NOT NULL REFERENCES space(id),
  session_id       uuid     REFERENCES session(id),   -- null = exclusive rental
  customer_id      uuid NOT NULL REFERENCES customer(id),
  during           tstzrange NOT NULL,
  status           text NOT NULL,   -- held | confirmed | cancelled | no_show
  hold_expires_at  timestamptz,
  party_size       int  NOT NULL DEFAULT 1,
  amount_cents     int  NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT reservation_live_hold_has_expiry
    CHECK (status <> 'held' OR hold_expires_at IS NOT NULL)
);

-- Two live exclusive reservations may never overlap on one space.
ALTER TABLE reservation
  ADD CONSTRAINT reservation_no_overlap
  EXCLUDE USING gist (space_id WITH =, during WITH &&)
  WHERE (session_id IS NULL AND status IN ('held', 'confirmed'));
```

`during` as a range gives us `&&` (overlaps) for free, and the partial `WHERE`
means cancelled bookings stop blocking the slot the moment they're cancelled.

The application's job shrinks to: attempt the insert, and translate
`23P01 exclusion_violation` into "that slot just went". Two people tapping the
same 20:00 in the same millisecond is no longer a code path we have to be clever
about — one insert wins, the other raises.

**Buffers** (turnaround time between bookings) are folded into `during` on the
way in — a 60-minute booking with a 10-minute buffer is stored as a 70-minute
range and displayed as 60. That keeps the constraint doing the work.

### 3.3 Shared sessions — a counter with a CHECK

Exclusion constraints can't count, so open play, classes and tour departures
use an atomic conditional update instead of a lock-and-count:

```sql
CREATE TABLE session (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id     uuid NOT NULL REFERENCES space(id),
  during       tstzrange NOT NULL,
  capacity     int NOT NULL CHECK (capacity > 0),
  booked_spots int NOT NULL DEFAULT 0,
  CONSTRAINT session_not_oversold CHECK (booked_spots BETWEEN 0 AND capacity)
);

-- Claim N spots, or affect zero rows if they aren't there.
UPDATE session
   SET booked_spots = booked_spots + $spots
 WHERE id = $id
   AND booked_spots + $spots <= capacity
RETURNING id;
```

Zero rows returned means "full" — no explicit `FOR UPDATE`, no read-modify-write
window. The `CHECK` is the backstop if anyone ever writes the counter by hand.

A session also occupies its space, so it needs its own non-overlap guarantee
against exclusive rentals. Give each session a mirror row in `reservation` with
`session_id` set and let a second exclusion constraint cover session-vs-rental
collisions on the same space.

### 3.4 Holds, so payment latency can't lose a slot

`held` reservations participate in the exclusion constraint. The flow:

1. Customer picks a slot → insert `status='held'`, `hold_expires_at = now() + 10 min`.
2. A PayMongo/Xendit charge is created, or a GCash proof is uploaded for approval.
3. Webhook flips the row to `confirmed` and clears `hold_expires_at`.
4. A `pg-boss` job sweeps expired holds back to `cancelled` (and decrements
   `booked_spots` for sessions).

Without holds, a slow card check-out is a slot someone else can take mid-payment.

### 3.5 Weekly regulars

Insert one reservation per week inside a **single transaction with a SAVEPOINT
per week**. An exclusion violation aborts only that savepoint, so a taken week
is skipped rather than failing the whole run — which is exactly the advertised
"weeks that are taken skip themselves". Charge for the weeks that survived.

### 3.6 Waitlists

`waitlist_entry(space_id | session_id, during, customer_id, created_at,
claim_token, claim_expires_at)`. On cancellation, a job takes the oldest
matching entry, mints a claim token valid ~30 minutes, and emails it. Claiming
creates a normal `held` reservation, so it goes through the same constraint as
everyone else. Let the token lapse and the next entry is offered.

---

## 4. Availability (the read path)

Generating slots is derivation, never the source of truth:

```
candidate slots
  = opening_hours (in venue tz)
  − closures
  − existing live reservations (incl. buffers)
  − sessions occupying the space
  ∩ [now + min_notice_minutes, now + max_horizon_days]
```

Cache per `(space_id, local_date)`; invalidate on any write touching that space
and day. If the read path and the constraint ever disagree, the constraint is
right and the cache is stale — design every error message around that.

---

## 5. Routes

```
app/
  (marketing)/page.tsx              ← built
  (auth)/login, /signup, /onboarding
  (dashboard)/app/[orgSlug]/
      page.tsx                      today's run sheet + "needs you"
      calendar, spaces, sessions, customers, payments, settings/*
  (public)/[venueSlug]/
      page.tsx                      branded booking page
      [spaceSlug], checkout, manage/[token]
  api/webhooks/stripe/route.ts
```

`(public)` must not import anything from `(dashboard)`; it renders for anonymous
traffic and is the only surface a customer ever sees. `manage/[token]` is how a
customer reschedules or cancels without an account.

---

## 6. Money — Philippine rails, two separate surfaces

Stripe is **not** the answer here. It works in PH but with restrictions (PHP-only
payouts, FX loss) and it is not what local venues use. See
[`ph-pricing-research.md`](ph-pricing-research.md) for the rates and reasoning.

### Venue ⇄ customer — three tiers, and the cheapest one matters most

**Tier 0 · GCash QR with proof approval.** The venue uploads its GCash or Maya
QR. The customer pays, attaches the receipt, and the booking sits as `held` with
a payment awaiting approval; the owner confirms or rejects in one tap. Zero
gateway fees, no merchant account, and it matches how most small PH venues
already work over Messenger. **Build this first** — it is the lowest-friction
path to a venue's first online booking, and every competitor treats it as an
afterthought.

**Tier 1 · Bring your own gateway.** The venue connects its own PayMongo or
Xendit account; we hold API credentials and create the charge, but funds settle
directly to them. Nothing routes through us, which is what makes "0% commission"
literally true rather than a pricing claim.

**Tier 2 · Xendit xenPlatform (only if needed).** Sub-accounts with split
settlement — the local equivalent of Stripe Connect — for venues that cannot get
their own merchant account. Platform fee set to **zero**. Adds KYC and funds-flow
obligations, so don't reach for it until a real venue is blocked without it.

Store `payment_method` and `gateway_ref` on the payment row so all three tiers
reconcile through one ledger.

### Us ⇄ venue — subscription billing

One subscription per org, priced by **band** (Solo / Club / Complex), not by
quantity. Band is derived from the count of active spaces and re-evaluated on
every space activation or pause; crossing a boundary prorates. First month free;
yearly billing charges ten months.

We can't dogfood Tier 1 for our own collection, so bill via PayMongo
subscriptions or recurring invoices with GCash and card options — our customers
are PH venues and will expect to pay us the same way their customers pay them.

Keep the two surfaces in separate modules. Conflating them is how a platform fee
accidentally ends up on a customer's booking.

---

## 7. Build order

| Phase | Ships | Done when |
| --- | --- | --- |
| 1 | Auth, orgs, memberships, spaces, opening hours | A staff member logs in and defines a court |
| 2 | **Booking engine** — schema, constraints, availability, holds | Two concurrent bookings for one slot: one succeeds, one gets a clean "just went" |
| 3 | Public booking page, customers, confirmation email | A stranger books without an account |
| 4 | GCash proof approval, then PayMongo/Xendit, deposits, refunds, policies | Money reaches a test venue's own account |
| 5 | Sessions, open play, classes, capacity | Twelve people share one court hour |
| 6 | Waitlists, packs & passes, weekly regulars, no-shows | A cancellation refills itself |
| 7 | Branding, dashboard insights, band subscription billing, CSV & calendar feed | A venue could actually pay us |

Phase 2 is the one to over-test. Write the concurrency test before the feature:
fire N parallel inserts at one slot and assert exactly one `confirmed` row and
`N-1` clean rejections. Everything else in the product is recoverable; selling
the same court twice on a Friday night is not.
