# Plan — final daily-use gaps (reschedule · staff invites · waitlist)

Three features built together (owner asked for "all in one go" — the per-feature
wireframe/approval gates are waived; each still gets a plan slice, a test, and a
browser pass, and lands as its own commit).

---

## 1 · Reschedule (finish customer self-service)

**Goal.** On the manage page (from the email link), let a customer move their
booking to another open slot on the same space — the reschedule the flow already
promised.

- **Engine:** `moveReservation` gains an `opts.staff` flag (default true, keeping
  the calendar's behaviour). The customer path passes `staff:false`, so the move
  re-checks notice + horizon like a fresh public booking (not the relaxed staff
  move). Physical guarantees unchanged.
- **Eligibility:** reuse `cancelEligibility` — if a booking can be cancelled it
  can be rescheduled (a `never` policy blocks both; grace/anytime allow).
- **Read:** `getManageableBooking` also returns `spaceId`, `timezone`,
  `slotMinutes`; a `rescheduleOptions(orgId, spaceId, tz, days)` returns open
  slots per local date (reuse `getDayAvailability`).
- **Action:** `rescheduleBooking(formData)` (token, new date + time) — rate-limit,
  re-derive eligibility, resolve the instant in venue time, `moveReservation(...,
  {staff:false})`; refuse an overlap.
- **UI:** a "Reschedule" toggle on the manage page → date chips + open-slot chips
  for the same space → confirm → the card updates.
- **Test:** extend `test-self-service.ts` — reschedule to an open slot moves the
  booking and frees the old one; a taken slot is refused; `never` blocks it.

## 2 · Staff invitations & roles

**Goal.** An owner invites staff to help run the venue, with a role.

- **Better Auth org plugin** already models `member` + `invitation`; wire its
  `sendInvitationEmail` to the Resend mailer and set an invite link.
- **Owner UI:** a **Team** section in Settings — list members (name, email, role),
  pending invites, an invite form (email + role: admin | member), and remove /
  revoke. Owner/admin only.
- **Accept flow:** `/app/accept-invite?id=…` — the invitee signs in or signs up,
  then accepts (`organization.acceptInvitation`); lands in the venue.
- **Actions:** thin wrappers over `authClient.organization.inviteMember /
  cancelInvitation / removeMember` (client) + a server list of members/invites.
- **Guard:** never remove the last owner; roles are owner/admin/member.
- **Test:** `test-staff.ts` — invite creates a pending row scoped to the org;
  accept adds a member; remove works; last-owner protection; cross-org isolation.

## 3 · Waitlist

**Goal.** When a slot is taken, a customer can join a waitlist; when it frees
(a cancellation), notify the first person waiting.

- **Schema** `0007_waitlist.sql`: `waitlist(id, org, space_id, starts_at, ends_at,
  customer_id, status[waiting|notified|converted|expired], notified_at,
  created_at)`, indexed by `(space_id, starts_at, status)`.
- **Join:** on the public booking page, a taken/held slot offers "Join the
  waitlist" → `joinWaitlist` (rate-limited, upserts a `waiting` row + a customer).
- **Fill:** `cancelReservation` (and the customer cancel) calls
  `promoteWaitlist(spaceId, startsAt, endsAt)` — find the earliest `waiting`
  entry overlapping the freed slot, mark it `notified`, and email them a booking
  link. (Notification only — first to re-book wins; no auto-hold in v1.)
- **Owner:** a small "Waitlist" count/list on the calendar day or dashboard
  "needs you" (optional Should).
- **Test:** `test-waitlist.ts` — join adds a waiting row; cancelling a booking
  promotes the earliest overlapping waiter to `notified`; a non-overlapping waiter
  is untouched; isolation.

---

**Verification (all):** each feature's `test:*` green + `tsc`/`eslint`/`build`
clean + a browser pass. New migrations (`0007`) apply to Neon on deploy. Owner
sign-off at the end covers all three.
