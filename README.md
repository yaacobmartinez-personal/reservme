# ReservMe

Booking software for Philippine venues that run on reservations — courts,
studios, karaoke rooms, restaurants and island-hopping boats.

Three surfaces, one Next app:

| Host | Serves |
| --- | --- |
| `reservme.pro` | Marketing, and every venue's public booking page at `/<venueSlug>` |
| `app.reservme.pro` | Auth and the owner dashboard |
| `admin.reservme.pro` | The platform console — cross-tenant, staff only |

Locally those are `localhost:3000`, **`app.localhost:3000`** and
**`admin.localhost:3000`** — `*.localhost` resolves to 127.0.0.1 in every
current browser, so there is nothing to add to your hosts file.

## Running it

```bash
npm install
```

```bash
cp .env.example .env.local
```

```bash
docker compose up -d
```

```bash
npm run db:migrate && npm run db:seed
```

```bash
npm run dev
```

The background worker runs as its own process (hold-sweep + emails):

```bash
npm run worker
```

Then:

- http://localhost:3000 — marketing page
- http://localhost:3000/katipunan — a seeded venue's booking page
- http://app.localhost:3000 — dashboard; sign up to create your own venue, add a
  space, and it goes live at http://localhost:3000/&lt;your-slug&gt;
- http://admin.localhost:3000 — platform console (grant yourself with
  `npm run admin:grant -- you@example.com`)

Postgres listens on **5433**, not 5432, so it doesn't collide with a local
install. Generate a real `BETTER_AUTH_SECRET` before deploying anywhere. Email
sends only when `RESEND_API_KEY` is set; otherwise the worker logs each message,
so everything runs unconfigured.

## Background worker

`npm run worker` starts a pg-boss worker on the same Postgres (no Redis). It:

- sweeps expired holds every minute (the web app also sweeps opportunistically,
  but a quiet site could otherwise strand a hold);
- sends booking **confirmation** emails off the request path;
- sends a **reminder** a few hours before each booking.

Enqueuing is best-effort and wrapped in try/catch in the booking action — a mail
or queue hiccup never fails a committed booking. In production, run one worker
process alongside `next start`.

## Observability

Structured JSON logs (`src/lib/log.ts`) — one object per line, greppable and
parseable by any log pipeline. Errors go through `captureException`
(`src/lib/observability.ts`), which always logs and additionally forwards to
Sentry when `SENTRY_DSN` is set (a pure logger otherwise). `src/instrumentation.ts`
initialises it at server startup and captures request errors. Point an uptime
monitor at `/api/healthz` — it returns 503 when the database is unreachable.

## Backups

Bookings are money, so keep your own restorable copy even on managed Postgres.

```bash
DATABASE_URL=... npm run db:backup      # → backups/reservme-<UTC>.dump
DATABASE_URL=... npm run db:restore backups/reservme-<UTC>.dump
```

`scripts/backup.sh` writes a compressed pg_dump (custom format, pgboss's
transient queues excluded), keeps the newest `BACKUP_RETENTION` (default 14),
and uploads to S3 if `BACKUP_S3_BUCKET` is set. `scripts/restore.sh` overwrites
the target (confirmation required unless `FORCE=1`). Both need `pg_dump`/
`pg_restore` on PATH. Schedule the backup from cron, a platform job, or
`docker compose -f docker-compose.prod.yml run --rm backup`.

## The part that matters

The product's central claim is that the last slot cannot be sold twice. That is
not enforced by application code — it is enforced by the database:

```sql
ALTER TABLE reservation
  ADD CONSTRAINT reservation_no_overlap
  EXCLUDE USING gist (space_id WITH =, during WITH &&)
  WHERE (kind IN ('rental','session_block') AND status IN ('held','confirmed'));
```

There is no read-then-write check anywhere in the booking path, because such a
check is a race with a comfortable-looking window in it. `reserveSpace()`
attempts the insert and lets Postgres decide; a `23P01` exclusion violation
becomes a clean "that slot just went".

Two things this cost, both worth knowing before touching `src/lib/booking/`:

- **Exclusion constraints deadlock under load.** Postgres inserts the tuple
  first and only then scans for conflicts, so concurrent inserts can each end up
  waiting on another's uncommitted row. Postgres kills one with `40P01`, which
  is not an answer about the slot — it's a dropped question. Retrying is not a
  fix. `reserveSpace()` takes a `pg_advisory_xact_lock` on the space first, so
  contenders queue instead of colliding and every loser gets a decisive `23P01`.
- **Shared sessions can't use an exclusion constraint** — those can't count.
  Capacity is enforced by an atomic conditional `UPDATE` plus a `CHECK` backstop.

Verify it any time:

```bash
npm run test:booking
```

24 parallel bookings for one slot, 18 people racing for 12 session spots. It
asserts exactly one winner, that every loser fails cleanly rather than crashing,
and that cancelling frees the slot again. It passes 10/10 from a cold database.

## The platform console

`admin.reservme.pro` is the one component that deliberately breaks tenant
isolation, so it is built to leave a trace rather than to be convenient.

```bash
npm run admin:grant -- you@example.com
```

- **The first admin can only be created from the shell.** There is no in-app
  path to granting platform access — that would put every account one request
  away from cross-tenant reads. Sign up on the app host first, then run the
  script. `--revoke` and `--list` also work, and it refuses to revoke the last
  active admin.
- **Grants live in `platform_admin`**, checked against the database on *every*
  request. Revoking takes effect on the next page load, not at session expiry.
- **Everything privileged is audited** to `admin_audit` — including merely
  opening a tenant. `actor_user_id` is `ON DELETE RESTRICT`: a user cannot be
  deleted out from under their own audit trail. Actions taken while
  impersonating are attributed to the real admin and flagged, so impersonation
  can never be used to launder an action.
- **Impersonation is server-side state.** The cookie holds an opaque token and
  nothing else; the organisation, the admin and the expiry are all read from the
  database, and the admin's grant is re-checked each time. Sessions last 30
  minutes, one at a time.
- **The impersonated view renders inside the console**, not on the app host.
  That keeps the cookie host-only — scoping it to `.reservme.pro` would send it
  to the public booking pages too — and the banner is unmissable.
- **Suspension is enforced in two places**: the public page stops rendering the
  form, *and* the booking action refuses the write. Existing reservations are
  left alone.

```bash
npm run test:admin   # needs the dev server running
```

Asserts that a signed-in user without a grant is refused, that a venue owner
can't reach the console or the audit log, that opening a tenant is recorded,
that revocation is immediate, that suspension actually closes a venue, and that
a forged impersonation cookie grants nothing.

## Layout

```
drizzle/0000_init.sql   the schema — SOURCE OF TRUTH (constraints live here)
scripts/                migrate · seed · test:booking
src/
  proxy.ts              hostname routing: apex vs app subdomain
  app/
    page.tsx            marketing (apex /)
    [venueSlug]/        public booking page — anonymous, no account
    app/                dashboard, rewritten here from app.reservme.pro
    api/auth/           Better Auth handler
  lib/
    booking/            availability (read) · reserve (write) · errors
    tenancy.ts          the ONLY place the active organisation is resolved
    auth.ts  env.ts  venue.ts  money.ts
  db/
    index.ts            two Postgres clients — read the comment before editing
    schema.ts           Drizzle mirror of the SQL, for typed queries
  content/marketing.ts  every string on the marketing page
docs/
  app-plan.md              schema, concurrency model, build order
  ph-pricing-research.md   competitor research behind the pricing
```

### Things that will bite you

- **`src/db/index.ts` exports two clients on purpose.** `drizzle(client)` mutates
  the postgres.js instance it is handed — it replaces the serializers for the
  date/time OIDs. Share one client between Drizzle and raw SQL and every raw
  query with a `Date` parameter dies with a confusing `ERR_INVALID_ARG_TYPE`.
- **`drizzle/*.sql` is the source of truth, not `schema.ts`.** The exclusion
  constraint, the generated `during` column and every `CHECK` exist only in SQL.
  Change the SQL first, then mirror it.
- **Opening hours are weekday + local time-of-day, never instants.** Slots are
  generated in venue-local time and converted per-slot, so a venue in a DST zone
  still opens at 09:00 the week the clocks move.
- **`user` and `customer` are different tables.** A user runs a venue; a
  customer books a court and never has a password. Collapsing them breaks the
  "no account needed" promise.
- **Tenant scope comes from `tenancy.ts`, never from a route param or form
  field.** Trusting the caller for the tenant only has to be got wrong once.

## Marketing page

- **Copy** lives in `src/content/marketing.ts`. Edit `PLANS` and the hero, band
  cards, calculator, comparison and FAQ all follow.
- **Colour and type** live in `src/app/tokens.css`. Nothing inlines a hex, an
  `oklch()` or a `font-family`.
- **Pricing is banded per venue, in pesos** — not per space. See
  [`docs/ph-pricing-research.md`](docs/ph-pricing-research.md) for the competitor
  research, and the one open decision (whether prices are stated VAT-inclusive).
- **No content is ever hidden by JavaScript.** `<Enter>` (load-time CSS keyframe)
  above the fold, `<Reveal>` (scroll-driven `animation-timeline: view()`) below
  it — both server components. A hidden start state may only exist in a context
  guaranteed to undo it, which is why `[data-reveal]`'s `opacity: 0` sits inside
  `@supports (animation-timeline: view())`.
- **No invented proof** — no testimonials, logos or "trusted by N venues".

## Not built yet

**Payments** are the big one — the schema carries `payment` but nothing writes
to it, so bookings are currently free. The plan in
[`docs/app-plan.md`](docs/app-plan.md) §6 covers the three tiers, starting with
GCash-QR-and-proof (no gateway account). Also not built: waitlists, class packs
and passes, weekly regulars, no-show flagging, staff invitations, branding
upload, and CSV export. See [`docs/launch-readiness.md`](docs/launch-readiness.md)
for the full gap list and sequencing.

## Checks

```bash
npm run build && npx eslint src scripts && npm run test:booking
```

Test scripts (the DB must be up; `test:jobs` also needs `npm run worker`):

- `test:booking` — concurrency: a slot can't be sold twice
- `test:manage` — run-sheet transitions: check-in / no-show / cancel
- `test:ratelimit` — the booking endpoint can't be flooded
- `test:onboarding` — an empty venue becomes bookable through the owner surface
- `test:admin` — the platform console refuses everyone it should
- `test:jobs` — booking → queue → worker → email pipeline

CI (`.github/workflows/ci.yml`) runs lint + typecheck + build + all six suites
against a throwaway Postgres on every push and PR.

## Deploying

`Dockerfile` builds one standalone image that runs either surface:

- web — `node server.js` (default CMD)
- worker — `node worker.js`

`docker-compose.prod.yml` is a reference composition: it migrates once
(`node migrate.js`), then runs web + worker. Point `DATABASE_URL` at managed
Postgres and set the real hosts + secrets. `/api/healthz` answers on every host
(returns 503 if the database is unreachable) for orchestrator health checks.

```bash
npm run build && npx eslint src scripts && npm run test:booking
```
