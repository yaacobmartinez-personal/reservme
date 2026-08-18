# Plan — Subscription billing (InstaPay QR + verify)

**Pipeline:** plan → refine → **PM review** (below) → UX wireframes → dev → QA →
owner sign-off. Self-contained. **Supersedes `docs/plan-billing.md`**, which had
admin-only manual "mark paid"; this adds the owner-facing **pay-by-InstaPay-QR +
reference proof + admin verify** loop the owner asked for.

**Goal.** Let ReservMe actually get paid by its venues. Track each venue's free
month and subscription state; show an owner what they owe; let them **pay via
ReservMe's InstaPay (QR Ph) code and submit the transfer reference**; let a
platform admin **verify and mark them paid**. Today nothing tracks a trial or
records a payment — we can't tell who owes us or collect from them.

*This is venue → ReservMe (our SaaS subscription). It is separate from the later
customer → venue payments feature; they don't share a rail.*

---

## What exists (reuse)

- **Pricing** — `src/content/marketing.ts`: `PLANS` + `planForSpaces(active)` →
  Solo (1) ₱499 · Club (2–6) ₱999 · Complex (7–15) ₱1,999 · Multi-site (16+) =
  quote (`price: null`). Band is a function of **active** spaces; first month
  free; 0% commission.
- **Signup** — `src/app/api/venue/init/route.ts` inserts the `venue` row after
  org creation; extend it to also create the subscription.
- **Admin console** — `requirePlatformAdmin`, `recordAdminAction`
  (`src/app/admin/actions.ts` pattern), admin nav (`src/app/admin/layout.tsx`),
  tenant list/detail, audit log.
- **App shell banner slot** — the verify banner (`verify-banner.tsx`) shows the
  pattern for an owner-facing nudge in `src/app/app/layout.tsx`.
- **Money/email/worker** — `formatMoney`, the Resend mailer, pg-boss worker for
  the (Should) reminder job.

## Scope

**In (Must):**
- **Schema** (`drizzle/0004_billing.sql`): a `subscription` row per org (trial /
  active / paid-through) with backfill; a `billing_payment` table for submitted
  InstaPay references awaiting verification. Mirror in `schema.ts`.
- **`src/lib/billing.ts`**: `getBillingState(orgId)` (band at read time, trial
  countdown, due-now, amount due, latest payment status) and `listBilling()` for
  the admin.
- **Create the subscription on signup** (trial = `created_at + 1 month`).
- **Owner Billing page** `/app/billing` + a "Billing" nav entry: current plan &
  status, amount due, and a **Pay via InstaPay** panel — ReservMe's QR image,
  payee, the exact amount, and a form to **submit the InstaPay reference number**
  after paying. Shows "under review" once submitted. Owner/admin only.
- **Owner banner**: trial ending (≤5 days), past-due, or "payment under review",
  rendered in the app shell; links to `/billing`.
- **Admin Billing view** `/app/admin/billing` + nav: submitted payments to
  **approve / reject**, and due/trialing/active venues; **mark-paid-until** manual
  override. Every write `requirePlatformAdmin` + audited.

**Should:** reminder emails (trial-ending, past-due) via the worker; comp / cancel
admin actions; surface `billing_status` in the tenant list + detail.

**Could (defer):** PayMongo automation (schema is ready); screenshot-image proof
(needs blob storage); dynamic-amount QR; auto-suspend on non-payment.

**Out:** customer → venue payments (its own plan); auto-suspension (policy: we
flag and nudge, we don't cut off a venue's bookings — `launch-readiness.md`).

---

## Data model — `drizzle/0004_billing.sql`

```sql
CREATE TABLE IF NOT EXISTS "subscription" (
  organization_id text PRIMARY KEY REFERENCES "organization"(id) ON DELETE CASCADE,
  status          text NOT NULL DEFAULT 'trialing'
                    CHECK (status IN ('trialing','active','past_due','cancelled','comped')),
  trial_ends_at   timestamptz NOT NULL,
  paid_until      timestamptz,          -- manual/verified collection: paid through
  provider        text,                 -- 'paymongo' | null (later)
  provider_ref    text,
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS subscription_status_idx ON "subscription" (status);
CREATE INDEX IF NOT EXISTS subscription_trial_idx  ON "subscription" (trial_ends_at);

-- Owner-submitted InstaPay transfers awaiting (or having had) verification.
CREATE TABLE IF NOT EXISTS "billing_payment" (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL REFERENCES "organization"(id) ON DELETE CASCADE,
  amount_cents    integer NOT NULL,
  reference       text NOT NULL,        -- the InstaPay reference number
  paid_at         date NOT NULL,        -- when the owner says they paid
  status          text NOT NULL DEFAULT 'submitted'
                    CHECK (status IN ('submitted','approved','rejected')),
  reviewed_by     text REFERENCES "user"(id) ON DELETE SET NULL,
  reviewed_at     timestamptz,
  note            text,                 -- admin note on reject/approve
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS billing_payment_org_idx    ON "billing_payment" (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS billing_payment_status_idx ON "billing_payment" (status);

-- Backfill: every existing org gets a trialing subscription from its created_at.
INSERT INTO "subscription" (organization_id, status, trial_ends_at)
SELECT o.id, 'trialing', o.created_at + interval '1 month'
FROM "organization" o
LEFT JOIN "subscription" s ON s.organization_id = o.id
WHERE s.organization_id IS NULL
ON CONFLICT DO NOTHING;
```

## ReservMe's InstaPay QR — platform-admin editable (owner decision)

The subscription is paid to **one** ReservMe merchant QR — **not per-venue** and
**not env** (owner chose console-editable so it changes without a redeploy). A
small `platform_setting(key, value, updated_by, updated_at)` key/value table (in
`0004`) holds three keys, edited from an admin form (a section on `/admin/billing`,
`requirePlatformAdmin` + audited `admin.updated_billing_config`):
- `instapay_qr_url` — a hosted image URL of ReservMe's QR Ph code (a pasted URL,
  no upload — we have no blob storage yet),
- `instapay_payee` — the account name shown ("ReservMe Inc."),
- `instapay_account` — a human label ("BPI ••• 1234" / "GCash 0917…").

`src/lib/billing.ts` exposes `instapayConfig()` reading those. Until set, the
Billing page shows a "bank transfer details coming soon — contact us" fallback;
status and amount still render. A static QR Ph carries no amount, so the UI says
"pay exactly ₱X, then enter your reference."

**Owner decisions (wireframe stage, 2026-08-18):** (1) proof is the **InstaPay
reference number only** — no screenshot upload in v1; (2) the QR is **editable in
the admin console** via `platform_setting`, not environment variables.

## Billing logic — `src/lib/billing.ts`

`getBillingState(orgId)` → `{ status, band:{name,price}, trialEndsAt, paidUntil,
daysLeftInTrial, dueNow, amountDueCents, pendingPayment }`:
- `activeSpaces = count(space where is_active)`, `band = planForSpaces(active)`.
- `dueNow` = `trialing AND now > trial_ends_at`, OR `active/past_due AND
  paid_until IS NOT NULL AND now > paid_until`.
- `amountDueCents = band.price===null ? null : band.price*100` (multi-site = quote).
- `pendingPayment` = the latest `billing_payment` if `status='submitted'`.

`listBilling()` → the admin table rows (state + org + activeSpaces + latest
submitted payment).

## Actions

Owner `src/app/app/billing-actions.ts` (`requireRole('owner','admin')`,
org from session):
- `submitBillingPayment(formData)` — validate reference + paid_at; amount is the
  computed `amountDueCents` (server-derived, not trusted from the form); insert
  `billing_payment` 'submitted'; refuse if a submitted one already exists.

Admin `src/app/admin/billing-actions.ts` (`requirePlatformAdmin` + `recordAdminAction`):
- `approveBillingPayment(formData)` — payment→approved; subscription
  `status='active'`, `paid_until = GREATEST(now, coalesce(paid_until, trial_ends_at)) + interval '1 month'`.
  Audit `admin.approved_payment`.
- `rejectBillingPayment(formData)` — payment→rejected with a note. Audit `admin.rejected_payment`.
- `markPaidUntil(formData)` — manual override for an offline payment. Audit `admin.marked_paid`.
- (Should) `compSubscription` / `cancelSubscription`. Audit `admin.comped` / `admin.cancelled_subscription`.

New audit action names in `src/lib/admin/audit.ts`.

## Pages & components

- Nav: **Billing** in the app sidebar (`nav-links.tsx`) and in the admin nav.
- `/app/billing/page.tsx` — plan/status/amount + the InstaPay pay panel + submit
  form + payment history (last few). Owner/admin only.
- `src/components/dashboard/billing-banner.tsx` — trial-ending / due / under-review,
  in `src/app/app/layout.tsx` (next to the verify banner).
- `/app/admin/billing/page.tsx` — submitted queue (approve/reject) + due/trialing/
  active tables + mark-paid. `billing_status` added to tenant list/detail.

## Acceptance criteria

1. A new org gets a `trialing` subscription ending one month out; `getBillingState`
   reports ~30 days left, not due, amount = its band.
2. When the trial passes, `dueNow` is true and the amount equals the band from
   **active** spaces (pausing spaces drops a band; multi-site shows quote/contact).
3. An owner can submit an InstaPay reference; the page shows "under review"; a
   second submission while one is pending is refused.
4. A platform admin sees the submission, and **approve** sets the subscription
   active with `paid_until` a month out (from the later of now / current end);
   **reject** records a note; both are in the audit log; a non-admin can't reach
   `/admin/billing` or these actions.
5. The owner banner nudges at ≤5 days and past-due; no venue is auto-suspended.
6. Amount is server-derived (a tampered form can't change what's owed); migration
   applies with existing orgs backfilled; build/eslint/tsc clean; no overflow at 375px.

## Verification — `scripts/test-billing.ts` (local docker)

Create a throwaway org+venue+spaces: assert `trialing`, `dueNow=false`, ~30 days,
band=Solo/₱499; activate more spaces → Club/₱999. Force `trial_ends_at` into the
past → `dueNow=true`, `amountDueCents=99900`. Submit a payment → row 'submitted',
`getBillingState.pendingPayment` set, and a second submit refused. Approve →
subscription 'active', `paid_until ≈ +1 month`, `dueNow=false`, payment 'approved'.
Reject path sets 'rejected' + note. Multi-site (16 spaces) → `amountDueCents=null`.
Tenant isolation: another org's billing isn't returned/actionable. Extend
`test-admin.ts` to prove `/admin/billing` refuses a non-admin. `test:billing` in CI.

## Files
- **New:** `drizzle/0004_billing.sql`; `src/lib/billing.ts`;
  `src/app/app/billing/page.tsx` + form; `src/app/app/billing-actions.ts`;
  `src/components/dashboard/billing-banner.tsx`; `src/app/admin/billing/page.tsx`;
  `src/app/admin/billing-actions.ts`; `scripts/test-billing.ts`.
- **Modify:** `src/db/schema.ts`; `src/app/api/venue/init/route.ts`;
  `src/app/app/nav-links.tsx`; `src/app/app/layout.tsx`; `src/app/admin/layout.tsx`;
  `src/app/admin/tenant/[orgId]/page.tsx` + `src/lib/admin/queries.ts`;
  `src/lib/admin/audit.ts`; `.env.example`; `package.json`; `.github/workflows/ci.yml`.

---

## 🧭 Project-manager review (stage 3)

**Must / Should / Could** — as scoped above. Ship Must (track + owner pay-by-QR +
admin verify) first; reminder emails and comp/cancel are Should.

**Risks & overrides.**
1. **Migration number.** `plan-billing.md` said `0003_billing.sql`, but `0003` is
   the CRM migration. **This is `0004_billing.sql`.**
2. **Proof format.** No blob storage exists, so v1 proof is the **InstaPay
   reference number** (+ date + server-derived amount), verified by an admin
   against ReservMe's statement — **not** a screenshot upload. Screenshot is a
   later add once storage exists. (Override on the old plan.)
3. **One platform QR, config-gated.** The QR is ReservMe's single merchant QR Ph
   from env, gated like RESEND/SENTRY with a graceful fallback — never per-venue,
   and never committed as a real financial asset. The owner drops the real QR in
   at deploy.
4. **Amount integrity.** The owed amount is computed server-side from active
   spaces; the submit action ignores any amount in the form. Prevents a venue
   under-declaring what it owes.
5. **No auto-suspend.** Keep the policy — flag and nudge only; the manual admin
   suspend already exists if ever needed.
6. **Access.** Billing is **owner/admin** on the app side (`requireRole`), and
   **platform-admin** on the console side; staff never see it. Tenant isolation +
   admin-guard are in the tests.
7. **Trial length** is one calendar month (`interval '1 month'`) — identical in
   the migration backfill, the signup insert, and the display.

**Sequencing (dev).** (1) migration 0004 + schema + backfill + create-on-signup;
(2) `billing.ts` + InstaPay config + `test-billing` core; (3) owner `/billing`
page + submit action + nav + banner; (4) admin `/billing` + approve/reject/
mark-paid + audit + tenant surfacing; (5) reminder job (Should); (6) build/lint/
browser.

**Sharper acceptance.** Approve extends `paid_until` from the later of now / current
end (paying early never loses days); a second pending submission is refused; the
amount is server-derived; every admin action is audited and non-admins are refused.

**PM verdict:** right-sized for a pipeline run — one migration (two tables), one
library, two owner surfaces (page + banner), one admin view, a handful of audited
actions, one test. Green-light to wireframes on Must + Should with the seven
overrides (0004; reference-not-screenshot proof; one config-gated QR; server-derived
amount; no auto-suspend; owner/admin+platform-admin access; one-calendar-month trial).
