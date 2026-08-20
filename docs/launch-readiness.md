# ReservMe — launch-readiness review

**Reviewer:** project lead pass · **Date:** 2026-08-13
**Scope:** the app (`app.reservme.pro`) and the platform console
(`admin.reservme.pro`). Marketing page excluded, as requested.

---

## Update — P0 work landed (2026-08-13)

Four of the five P0s are **done and verified**; the fifth is a product decision,
not a build gap.

| P0 | Status | Verified by |
| --- | --- | --- |
| P0-2 · session seats self-cancel | **Fixed** — created `confirmed`, guarded | `test:booking` (survives a sweep) |
| P0-1 · no way to add a court | **Built** — spaces, hours, closures, policy, first-run | `test:onboarding` + browser (real action click) |
| P0-4 · no job runner | **Built** — pg-boss worker, hold-sweep cron, email queues | `test:jobs` |
| P0-3 · no email | **Built** — Resend over HTTP + confirmation/reminder, logs when unconfigured | `test:jobs` + template smoke |
| P0-5 · no payments | **Open — needs the launch-shape decision** (soft vs paid) | — |

Notable finds fixed along the way: an owner `redirect()` that 404'd across the
host-rewrite boundary (now revalidates in place), and a closure time stored 8h
off because a wall-clock string round-tripped through the driver in the Node
process timezone (now `make_timestamptz` with explicit zone). Both had tests
added. Full suite green: `test:booking`, `test:onboarding`, `test:admin`,
`test:jobs`, lint, typecheck, build.

**Remaining before launch:** the P0-5 payments decision, then the P1s and the
non-code blockers below (legal, deploy, commit history, observability, backups).

---

## Update — soft-launch track (2026-08-14)

Decision taken: **soft launch, pay-at-venue** — payments (P0-5) and billing
(P1-4) deferred to fast-follow. The soft-launch code work is done:

| Item | Status | Verified by |
| --- | --- | --- |
| P1-3 · owner booking management | **Built** — check-in / undo / no-show / cancel from the run sheet | `test:manage` + browser click-through |
| P1-1 · booking abuse protection | **Built** — Postgres rate limiter (per-IP + per-venue) + Turnstile hook (no-op until keyed) | `test:ratelimit` (incl. concurrency) |
| Deploy readiness | **Built** — `/api/healthz`, standalone Dockerfile (web + worker), `docker-compose.prod.yml`, GitHub Actions CI | build + esbuild worker/migrate compile; healthz answers on every host |

No-show marks the reservation and **bumps the customer's `no_show_count`** — the
signal a venue uses to decide when to ask for a deposit. The rate limiter is
exact under concurrency (20 parallel → exactly the limit pass) and the window
recovers. CI runs lint + typecheck + build + all six test suites against a
throwaway Postgres.

**Still blocking a *public* launch (mostly yours, not code):**

1. **Legal** — ~~Privacy Policy, ToS, DPA~~ **Drafted and live** at `/privacy`,
   `/terms`, and `docs/dpa-template.md`, written accurate to actual data
   practices under the PH Data Privacy Act. **Still needs a lawyer's review**
   before you rely on them — they are honest drafts, not executed advice.
2. **Deploy the artifacts** — the Dockerfile/compose/CI exist but nothing is
   *deployed*: no host, no DNS for the three subdomains, no managed Postgres, no
   real secrets set. That's an ops task on your side.
3. **Commit history** — still one initial commit with everything uncommitted.
   Commit and turn the CI on.
4. **Observability + backups** — ~~none~~ **Built.** Structured JSON logging +
   Sentry-gated error capture (`SENTRY_DSN`, no-op until set) + `/api/healthz`
   for uptime; pg_dump backup/restore scripts with retention and an S3 hook
   (`npm run db:backup`). Wire `SENTRY_DSN` and schedule the backup at deploy.

**What's actually left before a public soft launch:** the legal review (#1) and
the deploy/commit (#2, #3) — both yours. The code side of the soft launch,
including observability and backups, is done.

---

## Verdict

**Not launchable yet — but the hard part is done.** The booking engine is
genuinely solid: race-safe at the database level, proven under concurrency, and
correct across timezones. That is the piece most teams get wrong, and it is the
piece we can build on with confidence.

What stands between us and a first paying venue is not the engine — it is
everything around it. A venue that signs up today gets an **empty venue with no
way to add a court**, receives **no email**, cannot **take payment**, and if it
runs open-play sessions those bookings **silently cancel after ten minutes**.
None of these are hard in the way the engine was hard; they are just not built.

My estimate: **~3–4 focused weeks** for one engineer to a credible paid launch
with a small number of hand-held pilot venues, longer for self-serve at scale.
The sequencing matters more than the total — see the plan at the end.

---

## What we can rely on (verified, not assumed)

These are load-bearing and I checked them against the code, not the README:

- **Double-booking is impossible.** `reservation_no_overlap` (a `btree_gist`
  `EXCLUDE` constraint) enforces it in the database; `test/booking-concurrency.test.ts`
  fires 24 parallel bookings at one slot and passes 10/10 from cold. The advisory
  lock in `reserveSpace` removes the deadlock class rather than papering over it.
- **Tenant isolation holds.** Every tenant query resolves `organization_id` in
  one place (`src/lib/tenancy.ts`). `scripts/test-admin.ts` proves a non-admin
  cannot reach the console, revocation is immediate, and suspension actually
  closes a venue.
- **The admin console is audited and contained.** Impersonation is server-side
  state, time-boxed, and every privileged action lands in `admin_audit` attributed
  to the real human.
- **Timezone handling is correct.** Opening hours are weekday + local time,
  converted per-slot, so DST venues don't drift.

Translation: the risky foundations are sound. The remaining work is
comparatively conventional product engineering.

---

## P0 — blocks any real launch

### P0-1 · A new venue cannot add a single court
**The biggest gap.** Sign-up creates the organisation and a `venue` row with
**zero spaces**, and the entire owner dashboard (`src/app/app/`) is read-only —
there is not one `"use server"` mutation in it. The only venue with spaces,
hours and prices is the one `scripts/seed.ts` created by hand.

So the product works end-to-end **only for the seeded demo**. A real customer
who signs up lands on an empty run sheet with no button to add a court, set
opening hours, or price anything. Onboarding is the product, and it doesn't
exist yet.

*Needs:* CRUD for spaces, opening hours, closures, and venue policy/settings,
plus a first-run "add your first space" flow. **Effort: L (~5–7 days).**

### P0-2 · Open-play / class bookings self-cancel after 10 minutes
`reserveSpace` was fixed to insert `status = 'confirmed'` (rentals persist), but
`reserveSessionSeats` still inserts `'held'` with a 10-minute expiry
(`src/lib/booking/reserve.ts:328`), and **nothing ever calls
`confirmReservation`**. `sweepExpiredHolds` runs on every availability read, so a
customer who books an open-play spot is told "confirmed instantly," then has their
seat quietly cancelled and the counter decremented ten minutes later.

Rentals and sessions are inconsistent, and the session path is simply broken
while there is no payment step to confirm against. Until payments land, session
seats should be created `confirmed` exactly like rentals.

*Needs:* one-line-ish fix + a regression test. **Effort: S (~half a day).**

### P0-3 · No email, anywhere
`grep` for any mailer returns nothing. The booking form promises a confirmation;
the marketing page promises "confirmations, reminders and a reschedule link." We
send none of it. A booking with no confirmation email is not a credible product,
and there is no way for a customer to find their reference later.

*Needs:* Resend + React Email, booking confirmation to start, then reminders.
**Effort: M (~2–3 days for confirmations; reminders depend on P0-4).**

### P0-4 · No job runner — nothing scheduled actually runs
`sweepExpiredHolds` is only invoked opportunistically on page load. There is no
`pg-boss`/cron, so **reminders, waitlist promotion, and reliable hold expiry do
not exist**. The moment we introduce anything time-based (payment holds,
reminders, waitlists), we need a real scheduler.

*Needs:* `pg-boss` (already the plan — needs no new infra) wired to a worker
process, with hold-sweep, reminders, and later waitlist jobs. **Effort: M (~2 days
for the harness + hold sweep).**

### P0-5 · No payments — bookings are currently free
The `payment` table exists but **nothing writes to it**. The whole pitch —
GCash proof approval, then PayMongo/Xendit — is unbuilt. For pilot venues that
take payment at the door this is survivable for a *soft* launch, but "no deposit,
no online payment" is a different, weaker product than the one the marketing page
sells, and it caps who we can onboard.

*Decision needed:* do we soft-launch pay-at-venue only (defer payments to
fast-follow), or hold launch for at least Tier-0 GCash proof? See
`docs/app-plan.md` §6. **Effort: Tier-0 GCash proof M (~3–4 days); PayMongo L.**

---

## P1 — needed for a credible, safe launch

### P1-1 · Public booking endpoint is unauthenticated and unthrottled
`bookSlot` (`src/app/[venueSlug]/actions.ts`) is public, with no rate limit,
no CAPTCHA, no abuse protection. Because bookings now persist as `confirmed`, a
trivial script can fill a venue's entire calendar with junk reservations
(griefing) or harvest availability. This is a real vector the moment we're public.

*Needs:* per-IP + per-venue rate limiting on the booking action, and a bot check
(Cloudflare Turnstile is free) before we advertise any venue. **Effort: M.**

### P1-2 · No self-service venue management beyond spaces
Staff invitations, branding upload (logo/theme/photos), and editable policy are
all promised and unbuilt. Better Auth's org plugin gives us invitations for
nearly free; branding and policy are forms over columns that already exist.
**Effort: M.**

### P1-3 · Booking management for owners
An owner can see today's run sheet but cannot **check in, mark a no-show, or
cancel** a booking from the dashboard. `cancelReservation` and the `no_show`
status exist in the engine; there is no UI. This is table stakes for daily use.
**Effort: M.**

### P1-4 · No subscription billing / band enforcement
We *sell* banded subscriptions with a free first month, but nothing meters spaces,
enforces a band, charges anyone, or ends a trial. Fine to defer if pilots are
free/manual, but it must exist before we charge — and someone should decide the
billing rail (the research says PayMongo subscriptions, not Stripe). **Effort: L.**

### P1-5 · Auth hardening
Email verification is configured off and there is no verification/reset sender,
so owner emails are never confirmed and there is no password reset. Add
verification + reset (depends on P0-3 email) and confirm cookie flags are correct
under the real subdomains before launch. **Effort: S–M.**

---

## P2 — fast-follow (not launch blockers)

- Waitlists (schema-ready in the plan, no table/UI yet).
- Prepaid packs & passes; weekly regulars (SAVEPOINT-per-week logic designed, not built).
- No-show auto-flagging on repeat offenders.
- CSV export and live calendar feed.
- Customer self-service reschedule/cancel via `manage/[token]` (route doesn't exist yet).

---

## Non-code launch requirements (owned by us, not the codebase)

These will block a *public* launch even if every feature above ships:

1. **Legal — highest non-eng priority.** We collect customer PII (name, email,
   phone) for third-party venues. The Philippines **Data Privacy Act** applies:
   we need a Privacy Policy, Terms of Service, and almost certainly a
   Data Processing Agreement with each venue (we are a processor). No legal pages
   exist. **Do not go public without this.**
2. **Deployment.** No Dockerfile, no CI, no host, no DNS for the three subdomains,
   no migration-on-deploy step, no `NODE_ENV=production` config path validated.
   `next dev` is the only way it has ever run.
3. **Nothing is committed.** The entire app is uncommitted working tree on top of
   the Create-Next-App initial commit (`git log`: one commit). No branch, no PR,
   no history. This should be committed and put behind CI immediately.
4. **Observability.** No error monitoring (Sentry or similar), no structured
   logging, no uptime check. We will be blind in production.
5. **Backups.** The Postgres container has no backup story. Bookings are money;
   losing them is fatal to trust.
6. **Secrets.** `BETTER_AUTH_SECRET` must be a real generated value per
   environment; the placeholder in `.env.example` must never reach prod.

---

## Testing gap

Coverage today is two hand-written scripts (`test-concurrency`, `test-admin`) —
excellent for what they cover, but there is **no test framework and no CI gate**.
Before we add payments and money movement, we want Vitest + a thin Playwright
smoke suite wired into CI, so a green build means something. **Effort: M.**

---

## Recommended path to launch

Sequenced so each week ends somewhere shippable. Effort is indicative
single-engineer.

**Week 1 — make it usable by a real venue**
1. Fix P0-2 (session self-cancel) — half a day, do it first.
2. P0-1 space/hours/policy management — the unlock for onboarding anyone.
3. Commit everything, stand up CI (P2-testing harness), pick a host.

**Week 2 — make it trustworthy**
4. P0-4 job runner + reliable hold sweep.
5. P0-3 confirmation emails (+ P1-5 verification/reset).
6. P1-1 rate limiting + Turnstile on the booking endpoint.

**Week 3 — make it operable + legal**
7. P1-3 owner booking management (check-in / no-show / cancel).
8. P1-2 staff invites + branding.
9. Legal pages + DPA template; observability + backups.

**Payments decision gates the shape of launch:**
- *Soft launch, pay-at-venue:* defer P0-5 and P1-4 to a fast-follow; the three
  weeks above get us to a real, if unmonetised-online, product.
- *Paid launch:* add ~1–1.5 weeks for Tier-0 GCash proof (P0-5) and basic
  band billing (P1-4) before charging.

**Fastest responsible path to a first pilot venue:** Week 1 + Week 2 + legal,
running payments at the door. Everything else is fast-follow.

---

## One thing worth saying

The temptation will be to read "not launchable" as bad news. It isn't. The work
remaining is the kind that is well-understood and low-risk; the work already done
is the kind that quietly sinks products when it's wrong, and ours is right and
proven. We are closer than the gap list makes it look — provided we resist
shipping before the legal and payments decisions are actually made rather than
deferred by accident.
