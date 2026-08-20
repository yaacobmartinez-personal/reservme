# ReservMe — QA & project-lead review

**Scope:** the signed-in **app** (`app.reservme.pro` — owner dashboard, auth) and
the **admin console** (`admin.reservme.pro` — platform/tenant tooling), plus the
public booking write path they both depend on. Marketing (`src/components/marketing/*`,
apex `/`) was explicitly out of scope and not touched.

**Reviewer role split**

- *Senior QA* — found and **fixed** correctness bugs (below, §1).
- *Project lead* — items to **raise / flag** that are product or architecture
  decisions, not bugs to silently fix (§2).

Verification: `tsc --noEmit` clean; `npm run test:booking` green (8/8, incl. the
24-way concurrency race); the pre-existing `scripts/_qa.ts` write-path probe now
refuses every crafted request it previously accepted.

---

## 1. QA — bugs fixed on this branch

### 1.1 [P0] The booking write path enforced *no* venue policy — only overlap

**Files:** `src/lib/booking/reserve.ts`, `src/lib/booking/errors.ts`,
`src/app/[venueSlug]/actions.ts`

`reserveSpace()` looked up the space, computed a price, and inserted a `held`
row. The **only** thing standing between a request and a reservation was the
database exclusion constraint `reservation_no_overlap`. Everything else the
product promises about *when* a slot is bookable — opening hours, minimum
notice, booking horizon, closures, the slot grid, and a shared session sitting
on the court — was computed on the **read** path (`getDayAvailability`) and
never re-checked on the **write**.

`startsAt`/`endsAt` reach the server as hidden `<input>` fields
(`booking-form.tsx`). A caller who ignores the UI and posts directly could
create a confirmed-looking hold that was:

- **in the past**, or **5 minutes out** when the venue requires 60;
- **at 3 a.m.**, when the venue is shut;
- **thirty days long** (or a 7-minute off-grid sliver);
- **on top of a live open-play session** on the same court.

This isn't hypothetical — `scripts/_qa.ts` (already in the repo) is a probe that
fires exactly these and logs `ACCEPTED` for each. The dead giveaway in the code:
`errors.ts` defines `outside_hours`, `too_soon`, `too_far_ahead`, `closed` and
`space_inactive`, and **none of them were ever thrown**. The vocabulary for
write-path validation existed; the validation didn't.

**Fix.** `reserveSpace()` now re-derives, in one SQL round-trip against the same
tables availability reads, whether the requested range is legitimate, and throws
the appropriate `BookingError` before holding anything:

- duration must equal the space's `slot_minutes` (kills past/giant/off-grid) → `bad_slot`;
- must fall inside `opening_hours` for that weekday in the venue's timezone → `outside_hours`;
- must not intersect a `closure` → `closed`;
- must clear `min_notice_minutes` → `too_soon`; must be within `max_horizon_days` → `too_far_ahead`;
- must not overlap a non-cancelled `play_session` on the court → `slot_taken`.

The public action (`bookSlot`) already surfaces `BookingError.message`; it now
also `revalidatePath`s on any such rejection, so a customer whose page was stale
sees corrected availability instead of a dead-end error.

Consistent with the codebase's own philosophy ("availability is a good-faith
prediction the write may still reject"). Added one new failure reason,
`bad_slot`.

### 1.2 [P1, partial] Rentals could be sold over shared sessions — closed on the write side

The plan (§3.3) says each `play_session` needs a mirror `session_block`
reservation row so the exclusion constraint stops a rental being sold over it.
**No code creates that mirror row** (see §2.2), so the constraint couldn't see
the session, and `getDayAvailability` only looks at `reservation` rows — a court
running open-play showed its hour as *open*.

The write-path guard above now rejects a rental that overlaps a live
`play_session` regardless of whether the mirror row exists, so the money-losing
outcome (two things sold on one court) can't happen from the rental side. The
**read** path still shows those slots as open until the mirror row is created —
tracked in §2.2, because it belongs with building session creation.

### 1.3 [P2] Concurrency test booked a possibly-closed slot

**File:** `test/booking-concurrency.test.ts`

The load-bearing test picked `now() + 36h`, UTC-aligned. That "worked" only
because nothing validated opening hours; with §1.1 in place it started failing
whenever wall-clock time pushed the slot outside 06:00–22:00 Manila (0 winners,
all rejected). Pointed it at a deterministic in-hours slot (04:00 UTC = 12:00
Manila, two days out). The test now proves the same thing it always claimed to —
one winner, N−1 clean `slot_taken` — against a slot the venue is actually open
for. 8/8 green.

---

## 2. Project lead — things to raise, decide, or schedule

These are **not** bugs I should silently "fix"; each is a product or
architecture call.

### 2.1 [P0 — RESOLVED (interim): bookings now auto-confirm]

**Resolution.** `reserveSpace()` now inserts `status='confirmed'` with no
`hold_expires_at`, and the booking-form copy no longer claims an email was sent
or a 10-minute hold. Booking *is* the confirmation while there's no online
payment step — which matches the marketing ("instant confirmation, no account
needed") and unblocks every `confirmed`-status metric. The concurrency guarantee
is unchanged: `held` and `confirmed` both participate in `reservation_no_overlap`,
so one racer still wins. **Follow-ups still open:** wire the confirmation email
(Resend, plan §1); and when a payment tier (2.1a below) is built, revert this to
`held` + `hold_expires_at` and call `confirmReservation()` on settlement. The
`held`/sweep machinery is left intact for that day. Original analysis below for
the record.

---

The single most important thing on this list. Before the fix, end to end:

1. A customer picks a slot → `reserveSpace` inserts `status='held'`,
   `hold_expires_at = now() + 10 min`.
2. `booking-form.tsx` immediately shows **"Confirmed"**, a reference number, and
   *"we've emailed you the details."*
3. **Nothing ever confirms it.** `confirmReservation()` exists but has **no
   caller anywhere in the codebase**. There is no payment step, no webhook, no
   "confirm without payment" path.
4. `sweepExpiredHolds()` — which runs on every public page view and every
   dashboard load — flips the hold to `cancelled` after 10 minutes. The slot
   reopens. The customer believes they have a booking.

So the product's primary happy path does not persist a booking, while telling
the customer it did **and** that an email went out (no email is wired —
Resend/React Email from plan §1 isn't built).

Knock-on: because nothing reaches `confirmed`, **every `status='confirmed'`
metric is permanently zero** — the dashboard's "Taken today" revenue, the admin
tenant "30d value", `getVenueStats`, `listTenants` revenue. Those screens look
built and correct but can only ever show ₱0 in production.

Root cause is sequencing: payments (plan Phase 4) aren't built, and Tier 0
(GCash-proof approval — the plan says "build this first") isn't either. Options
to decide:

- **(a)** Build Tier 0 GCash-proof approval — the owner confirms/rejects the
  uploaded proof (flips `held`→`confirmed`). Matches the plan and the marketing.
- **(b)** For venues that take no online payment, auto-confirm on booking
  (`held`→`confirmed` immediately), and keep holds only for the paid flows.
- **(c)** Interim honesty stopgap: change the confirmation copy so it stops
  claiming "Confirmed" + "emailed", and reflect the 10-minute hold. (One-line
  copy change; I left it alone because it's a visible product decision and
  doesn't fix the underlying expiry.)

I did **not** change behaviour here because "should an unpaid booking auto-confirm"
is your call, not QA's.

### 2.2 [P1] `session_block` mirror rows are never created

`play_session` rows have no creation path (no admin/owner UI, only the seed
makes them), and nothing writes the `session_block` reservation the plan relies
on to keep a session and a rental off the same court. When session creation is
built, it must insert the session and its `session_block` mirror **atomically**,
and `getDayAvailability` should treat an overlapping session as `taken` so the
read path matches the write-path guard added in §1.2.

### 2.3 [P1] `sweepExpiredHolds()` is a write on every page render

It runs opportunistically inside `force-dynamic` GET renders of the public venue
page *and* the dashboard/viewing pages — an unscoped `UPDATE … WHERE status =
'held'` across **all** tenants, on every hit, including bots. The plan's real
mechanism is a `pg-boss` scheduled job (not built). Recommend: build the
scheduled sweep, then drop or tightly gate the per-render call. As-is it's write
amplification and a cross-tenant hotspot the moment traffic arrives.

### 2.4 [P2] No in-app way to see or revoke platform admins

`revokeAdmin()` (a server action) and the audit reasons `admin.granted_admin` /
`admin.revoked_admin` exist, but **no page lists platform admins or calls
`revokeAdmin`**, and `admin.granted_admin` is never emitted (granting is
CLI-only via `scripts/grant-admin.ts`). The most privileged role in the system
has no console surface for review or offboarding. Low urgency, real governance
gap.

### 2.5 [P2] Signup → org → venue is three client calls with no atomicity

`login-form.tsx` runs `signUp.email` → `organization.create` →
`fetch('/api/venue/init')` in sequence on the client. Failure modes:

- slug is derived from the venue name; a **slug collision** makes
  `organization.create` throw *after* the account already exists — the user is
  stranded with an account and no venue and no obvious recovery;
- if `/api/venue/init` fails, the org exists with **no `venue` row**, and nearly
  every query `JOIN venue` — so the org effectively vanishes from the product.

Recommend collapsing onboarding into a single server action that creates
user/org/venue atomically and resolves slug collisions (suffix + retry).

### 2.6 [P3] `reserveSessionSeats` has no policy guard and no caller yet

The seat-claim path is implemented and concurrency-safe, but it isn't wired to
any UI (the public page lists sessions read-only — there's no "Join" action) and
it doesn't apply the notice/horizon/past checks §1.1 added for rentals. When
session booking ships, give it the same guard (a session in the past or beyond
the horizon shouldn't be claimable).

### 2.7 [P3] No anti-abuse on the public booking action

`bookSlot` is unauthenticated by design ("no account needed"), and
`upsertCustomer` writes a customer row per attempt even when the booking then
fails (the code notes this). Nothing rate-limits holds, so a hostile client can
place 10-minute holds across a venue's slots to make a small venue look full at
peak, and spray customer rows. Holds self-expire so impact is bounded, but
per-IP/per-email throttling (and a challenge on repeated failures) is worth
scheduling before launch.

### 2.8 [note] Healthy things worth keeping

Not everything is a problem — flagging what's load-bearing so it isn't
"refactored" away:

- The concurrency model (advisory lock → exclusion constraint → `23P01`→
  `slot_taken`, retry only on `40P01/40001`) is correct and well-reasoned.
- Two `postgres.js` clients (raw vs Drizzle) — `db/index.ts` documents *why*
  (Drizzle mutates date serializers); do not collapse them.
- The host-routing `proxy.ts` is the Next 16 rename of middleware (verified
  against the bundled docs) and correctly blocks internal prefixes on the wrong
  host — **and** every page/action still re-checks auth server-side, so
  authorization never depends on the proxy. Keep both.
- Impersonation is server-side state keyed by an opaque cookie token, re-checked
  every request, always attributed to the real admin in the audit log. Solid.

---

## 3. Suggested order

1. **2.1** — decide the confirmation/payment model; nothing else matters if a
   booking doesn't stick. (Do 1.1 first, which is done — it makes holds *correct*
   even if short-lived.)
2. **2.3** — scheduled hold sweep, before real traffic.
3. **2.5** — atomic onboarding, before real signups.
4. **2.2 / 2.6** — when the sessions feature is picked up.
5. **2.4 / 2.7** — governance and anti-abuse hardening.
</content>
</invoke>
