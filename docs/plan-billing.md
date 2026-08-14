# Plan — billing & free-month tracking

**Goal:** know when a tenant's free month is up, what they owe, and let us act on
it. Soft-launch scope is **manual collection** (see who's due, mark paid);
automated PH billing (PayMongo) is a later phase the schema is built to accept.

**Self-contained handoff.** Everything to execute is below. No prior conversation
context required.

---

## Current state (the gap)

Nothing tracks trial or subscription today:
- `organization` has only `id, name, slug, logo, metadata, created_at` — **no
  trial end, no billing status, no payment record.**
- The free month starts implicitly at `organization.created_at`, but nothing
  computes when it ends or flags an overdue venue.
- `src/lib/admin/queries.ts` computes what a venue *would* owe (band × price via
  `withBand`/`planForSpaces`) but not whether they've paid.

### Pricing model (already defined — reuse, don't reinvent)
`src/content/marketing.ts` → `PLANS` and `planForSpaces(activeSpaces)`:
- Solo (1 space) ₱499 · Club (2–6) ₱999 · Complex (7–15) ₱1,999 ·
  Multi-site (16+) = quote (`price: null`).
- Band is a function of **active** space count. First month free. 0% commission.

**Design decision — compute the band at read time** from current active spaces,
rather than storing a price that drifts. Store only trial/subscription *state*.

---

## Data model

New migration `drizzle/0003_billing.sql` (follow the existing hand-written SQL
pattern; it's applied by `scripts/migrate.ts` in filename order). Add a dedicated
table rather than columns on `organization` — cleaner, and ready for a provider.

```sql
CREATE TABLE IF NOT EXISTS "subscription" (
  organization_id text PRIMARY KEY REFERENCES "organization"(id) ON DELETE CASCADE,
  status          text NOT NULL DEFAULT 'trialing'
                    CHECK (status IN ('trialing','active','past_due','cancelled','comped')),
  trial_ends_at   timestamptz NOT NULL,
  -- Manual soft-launch collection: paid through this date.
  paid_until      timestamptz,
  -- Provider fields, unused until PayMongo phase.
  provider        text,           -- 'paymongo' | null
  provider_ref    text,           -- subscription id at the provider
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS subscription_status_idx ON "subscription" (status);
CREATE INDEX IF NOT EXISTS subscription_trial_idx ON "subscription" (trial_ends_at);

-- Backfill existing orgs: trial = created + 1 month.
INSERT INTO "subscription" (organization_id, status, trial_ends_at)
SELECT o.id, 'trialing', o.created_at + interval '1 month'
FROM "organization" o
LEFT JOIN "subscription" s ON s.organization_id = o.id
WHERE s.organization_id IS NULL
ON CONFLICT DO NOTHING;
```

Mirror it in `src/db/schema.ts` (Drizzle) for typed reads, following the existing
table definitions there.

---

## Create the row on signup

Venue creation currently happens in **`src/app/api/venue/init/route.ts`** (it
inserts the `venue` row after the org is created). Extend that same route to also
create the subscription in the same flow:
```sql
INSERT INTO subscription (organization_id, status, trial_ends_at)
VALUES (${organizationId}, 'trialing', now() + interval '1 month')
ON CONFLICT (organization_id) DO NOTHING;
```

---

## Billing logic

New `src/lib/billing.ts`:

```ts
export type BillingState = {
  status: 'trialing'|'active'|'past_due'|'cancelled'|'comped';
  band: { name: string; price: number|null };   // from planForSpaces(activeSpaces)
  trialEndsAt: Date;
  paidUntil: Date | null;
  daysLeftInTrial: number | null;   // when trialing
  dueNow: boolean;                   // trial ended (or paid_until passed) and not comped/active-paid
  amountDueCents: number | null;     // band.price*100, or null if 'quote'
};

export async function getBillingState(orgId: string): Promise<BillingState>;
export async function listBilling(): Promise<Array<BillingState & { orgId, name, slug, activeSpaces }>>;
```

Rules:
- `activeSpaces` from `count(*) FROM space WHERE organization_id=$org AND is_active`.
- `band = planForSpaces(activeSpaces)`.
- `dueNow` = `status='trialing' AND now() > trial_ends_at`, OR
  `status IN ('active','past_due') AND paid_until IS NOT NULL AND now() > paid_until`.
- `amountDueCents` = `band.price === null ? null : band.price*100`.
- `daysLeftInTrial` = ceil((trial_ends_at - now)/day) when trialing, else null.

**Do not auto-suspend.** Per `launch-readiness.md`, cutting off a venue's
bookings over billing is the venue's decision, not ours — flag + nudge only. A
manual "suspend" already exists in the admin console if ever needed.

---

## Admin console — a Billing view

New page `src/app/admin/billing/page.tsx` (guard with `requirePlatformAdmin`,
add "Billing" to the admin nav in `src/app/admin/layout.tsx`). Show a table from
`listBilling()`, grouped/sortable by state:
- **Trialing** — days left, band, amount that will be due.
- **Due now** — free month lapsed (or paid_until passed), amount owed, how long overdue.
- **Active / comped** — paid_until, band.

Actions (server actions in `src/app/admin/billing-actions.ts`, each
`requirePlatformAdmin` + audited via `recordAdminAction`):
- **Mark paid until `<date>`** → set `status='active'`, `paid_until=<date>`.
- **Comp** → `status='comped'`.
- **Cancel** → `status='cancelled'`.
- New audit action names in `src/lib/admin/audit.ts`:
  `admin.marked_paid | admin.comped | admin.cancelled_subscription`.

Also surface a small billing summary on the admin **tenant detail** page
(`src/app/admin/tenant/[orgId]/page.tsx`) and in the tenant list
(`src/lib/admin/queries.ts` already has `band`; add `billing_status`).

---

## Owner-facing nudge

- **Dashboard banner** (`src/components/dashboard/billing-banner.tsx`, rendered
  in `src/app/app/layout.tsx` or the dashboard): when `daysLeftInTrial <= 5`
  ("Your free month ends in N days — ₱X/mo after"), and a stronger past-due
  banner when `dueNow`. Link to a "Billing" info page or contact.
- **Reminder emails** via the existing worker + Resend pipeline
  (`src/lib/email/`, `scripts/worker.ts`): a scheduled job that finds trials
  ending in ~3 days and emails the owner; a second for past-due. Add a template
  in `src/lib/email/templates.ts` and a queue in `src/lib/jobs/boss.ts`,
  scheduled on a daily cron in the worker (pattern already there for hold-sweep).

---

## Later phase — automated collection (PayMongo)

Out of soft-launch scope; the schema is ready. When building:
- Create a PayMongo subscription per org on trial→active; store `provider`,
  `provider_ref`.
- Webhook route (`src/app/api/webhooks/paymongo/route.ts`) updates `status` /
  `paid_until` on payment events.
- Band changes push a quantity/price update to the provider.
- **Not Stripe** — PH rails (peso, GCash/card via PayMongo). See
  `ph-pricing-research.md`.

---

## Verification
- `scripts/test-billing.ts` (pattern from `scripts/test-manage.ts`): create a
  throwaway org+venue → assert `status='trialing'`, `dueNow=false`,
  `daysLeftInTrial≈30`; set `trial_ends_at = now()-interval '1 day'` → assert
  `dueNow=true`, `amountDueCents` matches band; "mark paid until +1 month" →
  assert `status='active'`, `dueNow=false`; clean up.
- Assert band tracks active spaces: 1 active → Solo/₱499; activate more → Club.
- Admin isolation: a non-admin can't reach `/admin/billing` (extend
  `scripts/test-admin.ts`).
- `npm run db:migrate` applies 0003 cleanly; existing orgs backfilled.
- Build/lint/typecheck clean.

## Files
- **New:** `drizzle/0003_billing.sql`; `src/lib/billing.ts`;
  `src/app/admin/billing/page.tsx`; `src/app/admin/billing-actions.ts`;
  `src/components/dashboard/billing-banner.tsx`; `scripts/test-billing.ts`;
  (later) `src/app/api/webhooks/paymongo/route.ts`.
- **Modify:** `src/db/schema.ts` (subscription table); `src/app/api/venue/init/route.ts`
  (create subscription on signup); `src/app/admin/layout.tsx` (nav);
  `src/app/admin/tenant/[orgId]/page.tsx` + `src/lib/admin/queries.ts` (show
  status); `src/lib/admin/audit.ts` (action names); `src/lib/email/templates.ts`
  + `src/lib/jobs/boss.ts` + `scripts/worker.ts` (reminder job); `package.json`
  (`test:billing`).

## Gotchas
- **Backfill existing orgs** in the migration (done above) or they'll have no
  subscription row and `getBillingState` must handle a missing row defensively.
- **Multi-site band = quote** (`price: null`): `amountDueCents` is null — the
  admin view should show "quote / contact" not "₱0".
- Compute band from **active** spaces at read time; a venue that pauses spaces
  for the off-season drops a band.
- Don't auto-suspend on non-payment (soft-launch policy).
- Trial length is one calendar month from `created_at` (`interval '1 month'`),
  not 30 days — keep it consistent between migration, signup insert, and display.
