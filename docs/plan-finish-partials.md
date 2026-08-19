# Plan — finish the three "Partial" pillars

Built together (owner asked to finish all partials). Each gap that is genuinely a
separate product is called out and left out of scope; what's built is the piece
that belongs in a booking product for a PH pilot. One commit + one test each.

---

## 1 · Booking rules & pricing → peak/off-peak pricing

**Gap being closed:** time-based rate overrides (a court costs more on Fri/Sat
evenings). **Out of scope** (needs memberships, which don't exist yet): member
pricing, per-member quotas.

- **Schema** `0010_pricing.sql`: `pricing_rule(id, org, space_id, label,
  weekdays smallint[], starts_at time, ends_at time, price_cents)`. A rule
  overrides the space's base price for slots whose local weekday + start time
  fall in its window.
- **Engine:** both `getDayAvailability` (per-slot price shown) and the reserve
  path (`derivePlacement` → amount charged) resolve a slot's price from the
  best-matching rule, falling back to `space.price_cents`. Priced by the slot's
  **start** time, so availability and the charge always agree for a public
  single-slot booking.
- **Owner UI:** a "Peak / off-peak pricing" section on the space edit page — add
  a rule (label, weekdays, time range, price), list, remove.
- **Test:** a rule raises the price of a matching slot in both availability and
  the booked amount; a non-matching slot keeps the base price.

## 2 · Staff management → change a member's role

**Gap being closed:** promote a member to admin / demote back — the roles story
was invite-only. **Out of scope** (separate products): shift scheduling, time
tracking, payroll/commissions, and a full custom-permission ACL (owner/admin/
member already gate every sensitive action).

- **Read:** `listMembers` also returns the Better Auth `member.id`.
- **UI:** a role dropdown per non-owner member in Settings → Team →
  `authClient.organization.updateMemberRole`. Owner rows aren't editable
  (protects the last owner); owner/admin only.
- **Test:** covered by the existing `test-staff` reads + a role-flip assertion at
  the DB level (the plugin mutation is exercised in the browser).

## 3 · Programming → owner-created sessions (+ weekly recurrence)

**Gap being closed:** owners can't create open-play / class sessions at all today
(seed-only); registration already works on the public page via
`reserveSessionSeats`. **Out of scope:** leagues, brackets, DUPR/ratings.

- **Lib/actions** `session-actions.ts`: `createSession` (space, title, date,
  start, end, capacity, price-per-person; optional **repeat weekly ×N**) and
  `cancelSession`. Guard: refuse to create a session over an existing confirmed
  rental on that space+time (the reserve path already stops rentals over
  sessions; this closes the other direction).
- **Read:** `listSessions(orgId, tz)` — upcoming sessions with spots.
- **UI:** a "Play sessions" section on the space edit page — create (with a
  "repeat weekly" option), list upcoming, cancel.
- **Test:** create inserts a session; repeat-weekly creates N; a session over a
  live rental is refused; cancel marks it cancelled.

---

**Verification (all):** each `test:*` green + `tsc`/`eslint`/`build` clean + a
browser pass. Migrations `0010` apply to Neon on deploy.
