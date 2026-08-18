# Plan — Customer self-service (manage booking link)

**Pipeline:** plan → refine → **PM review** (below) → UX wireframes → dev → QA →
owner sign-off. Self-contained.

**Goal.** Give a customer a link in their confirmation email that opens *their*
booking, where they can see the details and **cancel** (and, stretch,
**reschedule**) — enforcing the venue's cancellation policy. Today the emailed
"View booking" button just drops them on the venue's booking page
(`manageUrl = apexUrl('/'+slug)`); there is no per-booking manage flow, so the
"reschedule link" the emails/marketing imply doesn't exist and every change is a
phone call to the venue.

---

## What exists (reuse)

- **Booking engine**: `cancelReservation(orgId, id)` frees the slot (and returns
  a session seat's spot); `moveReservation` relocates a rental. Both in
  `src/lib/booking/reserve.ts`. (Owner paths — they don't check policy.)
- **Cancellation policy** already on the venue: `cancellation_mode`
  (`anytime | grace | never`) + `cancellation_grace_hours`, surfaced by
  `getVenueBySlug`.
- **Emails**: `src/lib/email/send-booking.ts` builds `manageUrl` — change it to
  the token link. Rate limiter (`src/lib/rate-limit.ts`) for the public POST.
- The apex host serves `/[venueSlug]` anonymously — the manage page lives beside
  it, also anonymous.

## Scope

**In (Must):**
- **A manage token** per reservation (unguessable) → migration `0006_manage.sql`,
  backfilled; the email link becomes `reservme.pro/<slug>/manage/<token>`.
- **Manage page** `/[venueSlug]/manage/[token]`: shows the booking (space, when in
  venue-local time, reference, amount, status) and a **Cancel** action **that
  enforces the venue's cancellation policy** — or a clear reason why it can't be
  cancelled online. A cancelled state after the fact.
- **Policy-enforced customer cancel** (server-side, re-derived, rate-limited).
- **Update the confirmation + reminder emails** to point at the token link.

**Should:** **reschedule** — pick another open slot on the same space (reuse the
availability grid) and move the booking, re-checking availability + notice/horizon
the way a fresh booking would.

**Could (defer):** move to a different space; a "download .ics" / add-to-calendar;
resend-confirmation.

**Out:** customer accounts/login (the token is the capability); changing party
size or paying (no payments yet).

## Data model — `drizzle/0006_manage.sql`

```sql
ALTER TABLE "reservation" ADD COLUMN IF NOT EXISTS manage_token uuid;
UPDATE "reservation" SET manage_token = gen_random_uuid() WHERE manage_token IS NULL;
ALTER TABLE "reservation" ALTER COLUMN manage_token SET DEFAULT gen_random_uuid();
ALTER TABLE "reservation" ALTER COLUMN manage_token SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS reservation_manage_token_idx ON "reservation" (manage_token);
```
Mirror `manageToken` in `src/db/schema.ts`. (A v4 UUID is ~122 bits — not
enumerable; the short human `reference` stays for phone/ticket use and is never
the capability.)

## Library — `src/lib/booking/manage.ts`

- `getManageableBooking(venueSlug, token)` → `null`, or the booking view:
  `{ venueName, spaceName, whenLabel, reference, amountCents, currency, status,
     startsAt, cancellation: { canCancel, reason } }`, all venue-local. Looks up
  by token, confirms the slug matches, and computes cancel eligibility from the
  venue policy (below). Works even if the venue is suspended.
- `cancelEligibility(status, startsAt, mode, graceHours, now)` — **pure**,
  unit-tested:
  - not `confirmed` → no (already cancelled / no-show / past-marked);
  - `startsAt <= now` → no ("this booking has already passed");
  - `never` → no ("this venue doesn't allow online cancellation");
  - `grace` and `now > startsAt - graceHours` → no ("too close to the start —
    contact the venue");
  - otherwise yes.

## Action — `src/app/[venueSlug]/manage-actions.ts`

- `cancelBooking(formData)` (token): rate-limit by IP; re-load by token,
  **re-derive `cancelEligibility` server-side** (never trust the page), then
  `cancelReservation(orgId, id)`; `revalidatePath` the manage page. Returns a
  result for inline messaging.
- (Should) `rescheduleBooking(formData)` (token, new date/slot): validate the new
  slot is open for the same space and passes notice/horizon, then move; refuse an
  overlap.

## Pages

- `/[venueSlug]/manage/[token]/page.tsx` (apex, anonymous): the booking card;
  Cancel (client button → action) when eligible, else the reason; a "cancelled"
  confirmation once done; a friendly not-found for a bad/rotated token. Themed by
  the venue's `data-brand` (reuses branding). (Should) a reschedule slot picker.
- Email: `send-booking.ts` `manageUrl = apexUrl('/'+slug+'/manage/'+token)` (add
  `r.manage_token` to its query).

## Acceptance criteria

1. A confirmation email links to `/<slug>/manage/<token>`; opening it shows the
   correct booking in venue-local time.
2. With policy `anytime`, a future booking can be cancelled and the slot frees
   (re-bookable); a session seat returns its spot.
3. With `grace`, cancel is refused inside the grace window and allowed before it,
   with a clear message; with `never`, online cancel is refused.
4. A past, already-cancelled, or no-show booking can't be cancelled; a wrong/
   rotated token 404s; a token from another venue's slug doesn't resolve.
5. The cancel endpoint is rate-limited; the amount/side-effects are server-derived.
6. Works while the venue is suspended; build/eslint/tsc clean; no overflow at 375px.

## Verification — `scripts/test-self-service.ts` (local docker)

Unit: `cancelEligibility` across all modes × (future/past, grace inside/outside,
already-cancelled). Integration: book → get token → `getManageablebooking`
returns it; cancel (anytime) frees the slot (re-book proves it); grace inside the
window refuses; `never` refuses; a foreign slug + a random token don't resolve.
`test:selfservice` in CI. Browser: open a real manage link and cancel.

## Files
- **New:** `drizzle/0006_manage.sql`; `src/lib/booking/manage.ts`;
  `src/app/[venueSlug]/manage/[token]/page.tsx` (+ a small client cancel/confirm
  component); `src/app/[venueSlug]/manage-actions.ts`; `scripts/test-self-service.ts`.
- **Modify:** `src/db/schema.ts`; `src/lib/email/send-booking.ts` (token link);
  `package.json`; `.github/workflows/ci.yml`.

---

## 🧭 Project-manager review (stage 3)

**Must / Should / Could** — as above. Ship **view + policy-enforced cancel**
(Must); reschedule is Should and only lands if the Must slice is solid.

**Risks & overrides.**
1. **Capability = token, not reference.** The `reference` is short and printed on
   tickets; it must never be the thing that authorises a cancel. Use a per-row v4
   UUID `manage_token`; the reference stays for humans. (Override.)
2. **Policy is enforced server-side on the cancel**, re-derived from the venue —
   the owner cancel path bypasses policy, the customer path must not. A pure
   `cancelEligibility` is the single source and is unit-tested.
3. **Anonymous public endpoint.** No auth; the token is the capability. Rate-limit
   the cancel POST (per IP) and 404 unknown tokens without leaking whether one
   existed.
4. **Suspended venue.** A customer with an existing booking must still be able to
   cancel even though new bookings are closed — the manage page is not gated on
   suspension (only new booking is).
5. **Reschedule scope.** Same-space slot pick, re-checking availability + notice/
   horizon like a fresh booking (not the relaxed staff move). Kept as Should so it
   can't hold up the cancel flow; "to reschedule, cancel and rebook, or contact
   the venue" is the fallback copy until it lands.
6. **Token in emails.** Update both confirmation and reminder links; existing rows
   are backfilled so old emails' (venue-page) links still work, new ones deep-link.

**Sequencing (dev).** (1) migration 0006 + schema; (2) `manage.ts`
(`cancelEligibility` + `getManageableBooking`) + unit tests; (3) manage page +
cancel action + email link; (4) `test-self-service` integration + browser; (5)
(Should) reschedule.

**Sharper acceptance.** Cancel eligibility is identical on the page and in the
action; cancelling frees the slot and returns a session spot; unknown/rotated
tokens 404; the endpoint is throttled; policy `never`/`grace` are honoured.

**PM verdict:** right-sized — one column, one library, one public page + action,
one test; reschedule deferred to Should. Green-light to wireframes on the Must
slice with the overrides (token capability; server-side policy; anonymous +
rate-limited; works while suspended).
