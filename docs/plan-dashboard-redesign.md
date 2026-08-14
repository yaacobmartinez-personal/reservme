# Plan — redesign the owner dashboard as a business analytics dashboard

**Goal:** turn the owner dashboard from a stat row + flat list into software a
venue owner pays for and opens every morning — real metrics, charts, and an
information design that reads like Linear/Stripe, not an MVP.

**Self-contained handoff.** Everything needed to execute is below: exact files,
the data model that already exists, aggregation queries, components, and
verification. No prior conversation context required.

---

## Current state (what to replace)

- Entry: `src/app/app/page.tsx` → renders `VenueDashboard`
  (`src/components/dashboard/venue-dashboard.tsx`).
- `VenueDashboard` shows four stat tiles (`getVenueStats`) + today's run sheet
  (`getRunSheet`), both in `src/lib/venue.ts`.
- **Keep** the run-sheet *actions* (check-in / no-show / cancel — they work).
  **Replace** the information design and add analytics.

The data already exists — this is a **query + presentation** layer, not a new
data model.

### Tables to aggregate (all columns real)
- `reservation`: `organization_id, space_id, session_id, customer_id, kind
  ('rental'|'session_block'|'session_seat'), status ('held'|'confirmed'|
  'cancelled'|'no_show'), starts_at, ends_at, party_size, amount_cents,
  checked_in_at, created_at`.
- `space`: `id, name, price_cents, slot_minutes, is_active, sort_order`.
- `opening_hours`: `space_id, weekday (0=Sun), opens_at, closes_at`.
- `customer`: `id, email, no_show_count, created_at`.
- `play_session`: `space_id, starts_at, ends_at, capacity, booked_spots`.
- `payment`: `reservation_id, status ('awaiting'|'approved'|...), amount_cents`.

**Timezone rule (non-negotiable):** every date bucket / hour / "today" is in the
venue's timezone — `... AT TIME ZONE ${venue.timezone}` — exactly as
`getRunSheet`/`getVenueStats` already do. Never bucket in UTC.

**Revenue note:** in the pay-at-venue soft launch, `amount_cents` on a
`confirmed` reservation is *booked value*, not collected cash. Label it
"Booked" / "Expected", not "Revenue collected", until online payments land.

---

## Metrics to build (the dashboard's content)

Create `src/lib/analytics.ts`. One function per metric, each taking
`(organizationId, timezone, range)` where `range` is a start/end pair chosen by
the period selector (Today / 7d / 30d / custom). All money in centavos.

1. **KPI tiles with trend + delta vs previous period**
   - Booked value, booking count, utilisation %, no-show rate.
   - Each returns `{ value, previousValue, deltaPct, sparkline: number[] }`
     (sparkline = per-day series across the range).

2. **Booked value over time** — daily (or weekly for 30d+) buckets of
   `sum(amount_cents)` for `status='confirmed'`, joined against a
   `generate_series` of dates so empty days are 0.
   ```sql
   SELECT d::date AS day,
          COALESCE(sum(r.amount_cents),0)::int AS cents
   FROM generate_series($start::date, $end::date, interval '1 day') d
   LEFT JOIN reservation r
     ON r.organization_id = $org
    AND r.status = 'confirmed'
    AND r.kind IN ('rental','session_seat')
    AND (r.starts_at AT TIME ZONE $tz)::date = d::date
   GROUP BY day ORDER BY day;
   ```

3. **Utilisation / occupancy** (the number that matters most). Per day:
   `booked_hours / bookable_hours`.
   - `bookable_hours` per day = sum over active spaces of
     `(closes_at - opens_at)` for that weekday from `opening_hours`, minus
     closures.
   - `booked_hours` per day = sum of `EXTRACT(EPOCH FROM (ends_at-starts_at))/3600`
     for `confirmed` reservations that occupy the space
     (`kind IN ('rental','session_block')`).
   - Return per-day % and an overall figure. This is the hardest query —
     build it against the seeded Katipunan venue and eyeball the numbers.

4. **Peak-hours heatmap** — `(weekday 0–6) × (hour 0–23)` grid of booking count
   (and a money variant) over the range, in venue tz:
   ```sql
   SELECT EXTRACT(DOW  FROM r.starts_at AT TIME ZONE $tz)::int AS dow,
          EXTRACT(HOUR FROM r.starts_at AT TIME ZONE $tz)::int AS hour,
          count(*)::int AS n
   FROM reservation r
   WHERE r.organization_id=$org AND r.status IN ('confirmed','no_show')
     AND r.starts_at >= $start AND r.starts_at < $end
   GROUP BY dow, hour;
   ```

5. **Booking mix** — counts by `status` over the range (donut): confirmed /
   cancelled / no_show, plus **no-show rate** = no_show / (confirmed+no_show).

6. **Booked value by space** — `sum(amount_cents)` grouped by `space.name`
   (horizontal bar).

7. **Customers** — new (`customer.created_at` in range) vs returning
   (customers with ≥2 confirmed bookings), repeat rate, top 5 by booking count.

8. **"Needs you" action list** — surfaced above the run sheet:
   - payments `awaiting` (count + total) — `payment.status='awaiting'`;
   - upcoming sessions < 50% full — `play_session` where `starts_at > now()` and
     `booked_spots < capacity/2`;
   - today's confirmed bookings not yet checked in.

Add DB indexes only if a query is slow — `reservation(organization_id, starts_at)`
already exists.

---

## UI / presentation

**Before writing any component, load the design skills** (this is where "looks
like a business" is won or lost):
- `dataviz` skill — for chart palette, mark specs, and a coherent viz system
  (light + dark). Swap its placeholder palette for the pine-on-paper tokens in
  `src/app/tokens.css`.
- `ui-ux-pro-max` or `hallmark` — for the dashboard layout/visual quality.

**Charting library:** add **Recharts** (`npm i recharts`) — React-native, works
in client components, small enough. (Alternative: hand-built SVG for full token
control; heavier to build.) Charts live in **client components**; the page is a
server component that fetches via `analytics.ts` and passes data down.

**Everything references design tokens** — no inline hex/oklch, no raw
`font-family`. Charts must be **theme-aware** and legible at WCAG AA.

### Component structure (`src/components/dashboard/`)
- `dashboard.tsx` — the new server component orchestrating the layout (replaces
  the body of `VenueDashboard`).
- `period-selector.tsx` (client) — Today / 7d / 30d / custom; drives a
  searchParam (`?range=30d`), read server-side.
- `kpi-tile.tsx` — big number + delta chip (▲/▼ vs previous) + sparkline.
- `revenue-chart.tsx` — line/area over time.
- `utilisation-chart.tsx` — line or stacked bar of occupancy %.
- `peak-heatmap.tsx` — dow × hour grid, colour-scaled.
- `booking-mix.tsx` — donut + no-show rate.
- `revenue-by-space.tsx` — horizontal bar.
- `customers-panel.tsx` — new/returning + top customers.
- `needs-you.tsx` — action list.
- Keep the run sheet + its actions (extract to `run-sheet.tsx`).

### Layout
- A **bento grid**: KPI row across the top, then a 2-column mix of charts, the
  heatmap full-width, "Needs you" + run sheet below. Responsive (single column
  on mobile — reuse the grid-safety rules: `grid-cols-1` base, `minmax(0,1fr)`).
- **Empty state matters**: a brand-new venue has no data — show a helpful
  "your numbers will appear here once you take bookings" rather than empty charts.

---

## Build order
1. `analytics.ts` metrics 1–3 + a `test:analytics` script → verify numbers vs
   the seeded venue.
2. Page scaffold + period selector + KPI tiles + revenue chart (Recharts wired,
   tokens applied, theme-aware).
3. Utilisation + peak heatmap + booking mix + by-space.
4. Customers panel + "Needs you" + run sheet re-integration.
5. Empty states, mobile pass, a11y (chart `aria-label`s / data tables fallback).

## Verification
- `scripts/test-analytics.ts`: seed a spread of bookings across days/hours/spaces
  on a throwaway venue, assert each aggregation (revenue totals, utilisation
  bounds 0–100%, heatmap counts, no-show rate, by-space sums), then clean up.
  Follow the pattern in `scripts/test-manage.ts`.
- Browser: drive the dashboard against the seeded Katipunan venue, switch
  periods, confirm charts render with no console errors at 375/768/1440.
- `npm run build`, `npx eslint src`, `npx tsc --noEmit` clean.

## Files
- **New:** `src/lib/analytics.ts`; `src/components/dashboard/{dashboard,period-selector,kpi-tile,revenue-chart,utilisation-chart,peak-heatmap,booking-mix,revenue-by-space,customers-panel,needs-you,run-sheet}.tsx`; `scripts/test-analytics.ts`.
- **Modify:** `src/app/app/page.tsx` (render new `Dashboard`); `package.json` (recharts + `test:analytics`).
- **Keep:** the run-sheet server actions in `src/app/app/booking-actions.ts` (unchanged).

## Gotchas
- Bucket in **venue tz**, always.
- "Revenue" = booked value until online payments exist — label honestly.
- Utilisation query is the tricky one — validate by hand before trusting it.
- New-venue empty state — don't ship empty/broken charts.
- Recharts + static/SSR: charts are client components; guard against SSR window
  access (Recharts handles this, but keep them under `"use client"`).
