# Plan — Calendar / schedule view + manual & walk-in booking

**Pipeline:** plan → refine → **PM review** (below) → UX wireframes → dev → QA →
owner sign-off. This doc is the first three stages, self-contained.

**Goal.** Give staff the operational surface they open every morning: a day grid
with a column per space, every booking laid out on it, and the ability to **create
bookings directly** — phone, walk-in, manual — reschedule them, and block off time.
Today staff can only *watch* the public form fill in (a run-sheet list) and act on
what's already there. This is the "booking widget → operating system" step, and
the single biggest missing pillar (pillar 3 in
`docs/dashboard-feature-research.md`). It also unblocks the **"New booking for this
customer"** action deferred from the CRM (`docs/plan-crm.md`).

---

## Scope

**In (v1 — the Must slice):**
- A **day resource grid**: columns = active spaces, vertical axis = time in the
  venue's own zone. Renders rentals, open-play session blocks, and closures as
  positioned blocks, coloured by status (held / confirmed / checked-in / no-show).
  Day navigation (prev / next / today / date picker).
- **Manual booking**: click an empty slot → a create panel prefilled with space +
  start time. Pick an existing customer (reuse CRM search) or add one inline; set
  duration (whole slot steps); party size; notes. Creates a **confirmed** booking
  through the engine. A **walk-in** is the same panel defaulted to "now".
- **Booking popover**: click a block → check-in / no-show / cancel (reuse
  `booking-actions`) and a link to the customer's CRM profile.
- **Block off**: select a range on a space (or the whole venue) → creates a
  closure (reuse `addClosure`).

**Should (layer after Must works):** reschedule via an edit form (change
time/space); a **week view** for one space; drag-to-move a block.

**Could (defer):** drag-to-resize duration; keyboard grid nav; printable manifest.

**Out (deferred, named so they aren't assumed):** recurring bookings; class /
league / event scheduling; staff assignment to bookings; two-way guest messaging;
payments/deposits at booking (soft launch stays pay-at-venue). These are their own
plans.

---

## What exists vs what's new

Reuse (do not reinvent):
- `src/lib/booking/availability.ts` — `getDayAvailability` / `getDaySessions`
  already compute slots and sessions per space per local date, in venue time.
- `src/lib/booking/reserve.ts` — `reserveSpace` **re-derives every rule on the
  write** (opening hours, notice, horizon, closures, session conflict, exact grid
  length) and enforces overlap via the `reservation_no_overlap` exclusion
  constraint + a per-space `pg_advisory_xact_lock`. This is the crux (see risk 1).
- `src/app/app/booking-actions.ts` — check-in / no-show / cancel / undo.
- `src/app/app/actions.ts` — `addClosure` / `removeClosure` (block-off).
- `src/lib/customers.ts` — customer search for the picker; `upsertCustomer` for a
  new one. No new customer identity.
- The run-sheet query in `src/lib/venue.ts` — the grid is its visual superset.

New:
- **`src/lib/calendar.ts`** — `getCalendarDay(orgId, tz, localDate)`: one read that
  returns, across all active spaces, every reservation (rental + session_seat for
  labels), session block, and closure overlapping that local day, each with
  venue-local start/end and the space it sits on, ready to position. Plus the
  space list (order, slot_minutes) so the grid can lay out its columns.
- **Staff booking path** — an owner/staff booking that relaxes *policy* checks
  (notice window, booking horizon, single-grid-step length) so a walk-in can be
  booked **now** and a 2-hour rental spans slots — but keeps every *physical*
  check (overlap, closed, session conflict, inactive space). See PM override.
- **`moveReservation(orgId, id, newSpaceId, newStartsAt)`** — validates and updates
  `starts_at`/`ends_at` through the same advisory-lock + constraint path; a move
  that would overlap is refused, not forced.
- **Pages/components**: `/app/calendar` (day grid), a Calendar nav entry, and
  client components for the grid, the create/edit panel, and the customer picker.
- **`src/app/app/calendar-actions.ts`** — `createManualBooking`, `moveReservation`
  wrapper, block-off — all `requireVenue`, org-scoped, `revalidatePath`.

---

## Data layer — `src/lib/calendar.ts`

`getCalendarDay(orgId, tz, localDate)` → `{ spaces: {id,name,slotMinutes,order}[],
blocks: CalendarBlock[] }` where a `CalendarBlock` is
`{ id, kind: 'rental'|'session'|'closure', spaceId|null, title, startsAt, endsAt,
startLabel, endLabel, status, customerId?, customerName?, partySize?, amountCents? }`.
Everything venue-local via `AT TIME ZONE ${tz}`; a closure with `space_id IS NULL`
spans all columns. Scoped to the org; positioned client-side from start/end.

## Server actions — `src/app/app/calendar-actions.ts`

`requireVenue`, org-scoped, id validated against the org before any write.
- `createManualBooking(formData)` — space, startsAt (venue-local wall-clock parts,
  like `addClosure`), slotCount, customer (existing id or new name/email/phone),
  party size, notes → staff booking path → confirmed reservation.
- `moveReservation(formData)` — reservationId, newSpaceId, new start → move.
- `blockOff(formData)` — thin wrapper over `addClosure`.
- Popover actions reuse `booking-actions` unchanged.

## Pages & components

- Nav: add **Calendar** to `nav-links.tsx`, first (it's the daily home) or after
  Today.
- `src/app/app/calendar/page.tsx` — reads `?date=` (default today, venue-local),
  server-renders the grid data; client grid handles interaction.
- Client: `CalendarGrid` (columns per space, time rows, positioned blocks,
  click-empty → create, click-block → popover), `BookingPanel` (create/edit,
  customer picker), `CustomerPicker` (debounced search over `listCustomers`).
- Token-styled, matches the sidebar shell; the grid scrolls horizontally inside
  its own `overflow-x-auto` container so the page never does.

## Acceptance criteria

1. The grid shows every reservation, session block, and closure for the chosen
   local date, one column per active space, positioned by time in venue-local.
2. Clicking an empty slot and completing the panel creates a **confirmed** booking
   (existing or newly-added customer); it appears on the grid and the run sheet.
3. A walk-in defaulted to "now" books despite the notice window; a slot already
   taken is refused with a clear message; **double-booking stays impossible under
   concurrency** (test), including via the staff path.
4. Clicking a block offers check-in / no-show / cancel and links to the customer.
5. Block-off closes a range; the grid shows it; bookings elsewhere are untouched.
6. Reschedule (Should) moves a booking and refuses a move that would overlap.
7. Tenant isolation on every read and write; no overflow at 375px; build / eslint
   / tsc clean.

## Verification (QA stage)

`scripts/test-calendar.ts` on **local docker**: `getCalendarDay` returns the right
blocks for a known day; manual booking creates confirmed + customer; walk-in-now is
allowed; an overlapping manual booking is refused; `moveReservation` validates and
refuses overlap; block-off; cross-org isolation. **Extend
`test/booking-concurrency.test.ts`** to hammer the staff booking path (double-booking
must be impossible there too). Plus a browser walkthrough on the seeded demo venue.

## Files

- **New:** `src/lib/calendar.ts`; `src/app/app/calendar/page.tsx` + client
  components; `src/app/app/calendar-actions.ts`; `scripts/test-calendar.ts`.
- **Modify:** `src/lib/booking/reserve.ts` (extract shared rental core + staff
  path + `moveReservation`); `src/app/app/nav-links.tsx`; `package.json`;
  `.github/workflows/ci.yml`. **Follow-up:** wire the CRM profile's "New booking"
  button to deep-link into the create panel.

---

## 🧭 Project-manager review (stage 3)

**Must / Should / Could.**
- **Must:** day resource grid (read); click-empty → manual booking (customer
  search/add, slot-step duration, confirmed) via a shared engine core; booking
  popover (check-in / no-show / cancel + customer link); block-off; tests incl.
  **concurrency + isolation + walk-in-now**.
- **Should:** reschedule via edit form; week view; drag-to-move.
- **Could:** drag-to-resize; keyboard nav; print.
Ship Must as a working slice, then layer Should. Drag and week view must **not**
gate the release.

**Risks & handling.**
1. **Engine reuse vs. fork (the whole ballgame).** Re-implementing booking rules
   for staff would let the two paths drift and could weaken the double-booking
   guarantee. **Decision (override):** *extend, don't fork.* Factor a shared
   `bookRental` core; the staff path relaxes only **policy** checks — notice
   window, booking horizon, the exact-one-grid-step length — and keeps **every
   physical** check: overlap (the exclusion constraint + advisory lock),
   closures, session conflict, inactive space, `ends > starts`, and slot-grid
   alignment. Physical invariants are never overridable. The concurrency suite
   runs against the staff path too.
2. **Duration.** Allow any whole number of slot steps (`N × slot_minutes`) snapped
   to the grid — not free-form minutes — so pricing (`price_cents × minutes /
   slot_minutes`) and the grid stay coherent in v1. Free-form is a later add.
3. **Move → overlap.** A move goes through the same advisory-lock + constraint; on
   `23P01` it surfaces "that slot's taken" and does **not** move. Never an
   `UPDATE` that trusts availability.
4. **Walk-in / past bookings bypass notice.** Intended for staff; still fully
   org-scoped and role-gated (any signed-in staff may run the day, like the run
   sheet). Booking in the past is allowed for reconciling a walk-in already
   playing; a hard floor (e.g. not > 24h in the past) is a cheap guard.
5. **Drag + timezone math.** Highest-effort, lowest-certainty piece → it's Should.
   Ship click-to-create + an edit-form move first; add drag once the grid is
   proven. All positioning stays in venue-local, never UTC pixel math.
6. **PII / auth.** The grid concentrates customer names; it's behind `/app` auth
   already. No new exposure; note it for the DPA (processor access), as with CRM.

**Sequencing (dev).** (1) engine refactor: extract `bookRental` core + staff path
+ `moveReservation`, extend concurrency test; (2) `getCalendarDay` + its test; (3)
calendar page + read-only day grid; (4) manual-booking panel + customer picker +
`createManualBooking`; (5) popover actions (reuse) + block-off; (6) move (edit
form) + a11y + mobile. Each step independently testable; a demoable increment
exists by step 3.

**Sharper acceptance (adds to the list).**
- Staff and public booking share one write core; the concurrency test proves
  double-booking impossible via **both**.
- Manual-booking duration is a whole number of slot steps; pricing scales with it.
- Every move/booking validates the id(s) belong to the active org before writing.

**Out of scope confirmed:** recurring bookings, class/league scheduling, staff
assignment, guest messaging, payment-at-booking. Own plans later.

**PM verdict:** right-sized for a pipeline run *if* the engine is extended, not
forked — that guardrail is non-negotiable and is the review's main instruction to
the dev stage. Green-light to UX wireframes on the Must + Should scope with the
three overrides above (extend the engine; slot-step durations; drag/week view are
Should).
