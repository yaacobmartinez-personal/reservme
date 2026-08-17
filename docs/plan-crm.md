# Plan — Customers / CRM section

**Pipeline:** plan → refine → **PM review** (below) → UX wireframes → dev → QA →
owner sign-off. This doc covers the first three stages; it is self-contained so
each later stage can start from it.

**Goal.** Give owners a real customer view: find anyone, open a profile with
their history, spend, no-shows, notes and tags, and act on it. Today a customer
is an invisible row created by a booking; this turns them into something you
manage. Chosen as the first pipeline pilot because it's high-value, self-
contained, and reuses data that already exists.

---

## Scope

**In:** a Customers list (search / sort / filter / segments), a customer profile
(stats, booking history, notes, tags, edit contact), and the supporting schema,
queries, actions, nav entry, and tests.

**Out (deferred, noted so they aren't assumed):** marketing campaigns, email/SMS
to customers, merge-duplicates, CSV import, GDPR/DPA export-per-customer button
(the privacy right exists; the button is a later add), loyalty/points.

**Deferred to the Calendar feature — "New booking for this customer".** A
prominent action on the customer profile that opens a pre-filled manual/walk-in
booking. Deliberately held back: manual booking entry is the calendar/schedule
feature (pillar 3 in `dashboard-feature-research.md`), which lands next. When it
ships, add a "New booking" button to the profile header that deep-links into the
calendar's create flow with this customer pre-selected. Owner-confirmed at the
wireframe stage (2026-08-17).

---

## What exists vs what's new

Already there:
- `customer` (id, organization_id, name, email, phone, no_show_count, created_at),
  unique on (organization_id, email); one per venue, never a login.
- `reservation.customer_id` links bookings; amounts, statuses, timestamps present.
- Patterns to reuse: `src/lib/analytics.ts` (venue-local aggregation), tenancy
  (`requireVenue`), the sidebar nav, `formatMoney`, run-sheet action style.

New — migration `drizzle/0003_crm.sql`:
```sql
-- Free-form staff notes on a customer (timestamped, attributed).
CREATE TABLE IF NOT EXISTS "customer_note" (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL REFERENCES "organization"(id) ON DELETE CASCADE,
  customer_id     uuid NOT NULL REFERENCES "customer"(id) ON DELETE CASCADE,
  author_user_id  text REFERENCES "user"(id) ON DELETE SET NULL,
  body            text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customer_note_customer_idx ON "customer_note" (customer_id, created_at DESC);

-- Tags as a text[] on the customer — light, queryable with && / @>, no join.
ALTER TABLE "customer" ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';
ALTER TABLE "customer" ADD COLUMN IF NOT EXISTS marketing_opt_in boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS customer_tags_idx ON "customer" USING gin (tags);
```
Mirror in `src/db/schema.ts`.

---

## Data layer — `src/lib/customers.ts`

All functions take `organizationId` from `requireVenue()`, scope every query,
and compute in venue-local time. LTV = sum of **confirmed** `amount_cents`.

- `listCustomers(orgId, tz, opts)` → paginated rows with aggregates:
  `{ id, name, email, phone, tags, bookings, lifetimeValueCents, lastVisit,
     noShowCount, createdAt }`. `opts`: `search` (name/email/phone ilike),
  `tag`, `segment` ('all'|'new'|'at_risk'|'no_shows'), `sort`, `page`.
  - `new` = created in last 30d; `at_risk` = has a past confirmed booking but
    none in 60d; `no_shows` = `no_show_count > 0`.
- `getCustomer(orgId, id, tz)` → profile: the row + full aggregates + `tags` +
  upcoming & past bookings (space, when, status, amount) + notes (with author).
- `customerFacets(orgId)` → the distinct tag list for the filter UI.

Aggregates reuse the analytics SQL style (`FILTER (WHERE status='confirmed')`,
`AT TIME ZONE`). Add indexes only if a query is slow — `reservation(customer_id)`
-adjacent indexes already exist via `reservation_space_starts_idx` etc.; add
`reservation(customer_id)` if needed.

## Server actions — `src/app/app/customer-actions.ts`

`requireVenue`, org-scoped, `revalidatePath`. Staff (`member`) may use all of
these — they're day-to-day, like the run-sheet actions.
- `addCustomerNote(formData)` / `deleteCustomerNote(formData)`
- `addCustomerTag(formData)` / `removeCustomerTag(formData)` (array_append /
  array_remove; dedupe; cap tag length + count)
- `updateCustomerContact(formData)` (name, phone; email is the identity key —
  edit allowed but must stay unique per org, handle the conflict)

## Pages & components

- Nav: add **Customers** to `src/app/app/nav-links.tsx` (icon: people), between
  Today and Spaces.
- `src/app/app/customers/page.tsx` — list. Search box, segment chips
  (All / New / At-risk / No-shows), tag filter, sortable table (name, tags,
  bookings, LTV, last visit, no-shows). Row → profile. Pagination. Empty state.
  Reads filters from `searchParams` (server-rendered, like the dashboard range).
- `src/app/app/customers/[customerId]/page.tsx` — profile:
  - Header: name, email, phone (edit inline), tags (add/remove chips).
  - Stat tiles: lifetime value, total bookings, no-shows, member since / last visit.
  - Booking history: upcoming + past, each with space, when (venue-local), status,
    amount; link into the run sheet where relevant.
  - Notes: timestamped list + an "add note" box.
- Small client bits only where needed (search input debounce optional; tag/ note
  forms are server actions). Everything token-styled, matches the sidebar shell.

## Acceptance criteria (what "done" means)

1. Customers link appears in the sidebar; the page lists this venue's customers
   only, with correct booking count, LTV (confirmed only), last visit, no-shows.
2. Search matches name / email / phone; segment chips and tag filter narrow the
   list; sorting works; pagination works past one page.
3. A profile shows accurate stats and the customer's real booking history in
   venue-local time; a note can be added and appears with author + timestamp; a
   tag can be added and removed and is reflected in the list filter.
4. Editing a phone/name persists; a duplicate email is rejected gracefully.
5. Tenant isolation: a customer/profile from another org is never reachable;
   actions refuse cross-org ids.
6. No page overflow at 375px; no console errors; `build`, `eslint`, `tsc` clean.

## Verification (QA stage)

`scripts/test-crm.ts` (pattern from `test-manage.ts`, run on **local docker**):
seed a venue + customers with a known booking spread; assert list aggregates
(LTV, counts, last visit, no-show), search, each segment, tag add/remove +
filter, note add, and **cross-org isolation** (a second org's customer is not
returned / not editable). Add `test:crm` to `package.json` and CI. Plus a browser
walkthrough on the seeded demo venue.

## Files
- **New:** `drizzle/0003_crm.sql`; `src/lib/customers.ts`;
  `src/app/app/customers/page.tsx`; `src/app/app/customers/[customerId]/page.tsx`;
  `src/app/app/customer-actions.ts`; `src/components/dashboard/…` (small shared
  bits if useful); `scripts/test-crm.ts`.
- **Modify:** `src/db/schema.ts`; `src/app/app/nav-links.tsx`; `package.json`;
  `.github/workflows/ci.yml`.

---

## 🧭 Project-manager review (stage 3)

Reviewing the above as PM — scope realism, risk, sequencing, and sharper
acceptance. Adjustments folded back in:

**Cuts / must-should-could.**
- **Must (M):** list with search + core aggregates; profile with stats + booking
  history + notes; tenant isolation; tests.
- **Should (S):** tags (add/remove/filter); segments (New / At-risk / No-shows);
  edit contact.
- **Could (defer if time):** `marketing_opt_in` column (add the column now, no UI
  yet — cheap and avoids a later migration); `customerFacets` tag list can start
  as a plain distinct query.
Ship M first as a working slice, then layer S. This keeps a demoable increment
early and protects the timeline.

**Risks & how we handle them.**
1. *Aggregate performance* on a busy venue (LTV/last-visit per row). Mitigation:
   compute in one grouped query joined to the page of customers, not N per row;
   add `reservation(customer_id)` index; paginate (25/page). Acceptance: list
   query < 300ms on the 237-booking demo.
2. *Email as identity.* Editing email risks unique-constraint collisions and
   breaks the "returning customer" match. Decision: **don't allow email edits in
   v1** — edit name/phone only. Removes a whole error class. (Overrides the plan
   above.)
3. *Walk-ins / null customer.* Some reservations have no `customer_id`. The list
   only shows real customers; that's fine, but the profile's "history" must not
   assume every booking has a customer. Already handled by scoping to customer_id.
4. *PII surface.* This page concentrates customer PII — make sure it's behind
   auth (it is, under `/app`) and note it for the DPA (processor access). No new
   exposure, but flag it.

**Sequencing (dev stage).** (1) migration + schema + `customers.ts` list query +
`test-crm` list assertions; (2) list page + nav; (3) profile page + history; (4)
notes; (5) tags + segments + filters; (6) browser + a11y + mobile pass. Each step
independently testable.

**Sharper acceptance (adds to the list above).**
- List query returns in one round trip per page (no per-row queries).
- Email is **not** editable in v1; name/phone are.
- Every action validates the id belongs to the active org before writing.

**Out of scope confirmed:** messaging customers, campaigns, merge, import,
per-customer data export button, loyalty. These are their own plans later.

**PM verdict:** scope is right for a first pipeline run — one migration, one
library, two pages, a handful of actions, one test. Green-light to UX wireframes
on the M+S scope with the three overrides above (email read-only, single grouped
aggregate query, ship M then S).
