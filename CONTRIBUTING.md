# Contributing to ReservMe

Thanks for working on ReservMe. This project optimises for a legible history and
a suite that proves each change — please keep to the conventions below.

## Getting set up

```bash
npm install
cp .env.example .env.local        # local dev secrets (gitignored)
docker compose up -d              # Postgres on 5433
npm run db:migrate && npm run db:seed
npm run dev                       # + `npm run worker` in another shell
```

See the [README](README.md) for the three hosts (`localhost:3000`,
`app.localhost:3000`, `admin.localhost:3000`) and how they route.

## Running the tests

The suite is [Vitest](https://vitest.dev) against a real Postgres (the
booking-concurrency test fires 24 genuinely parallel writes, so an in-memory fake
won't do). It migrates + seeds itself and needs no `.env` file:

```bash
docker compose up -d postgres     # or: docker compose -f docker-compose.test.yml up -d
npm test                          # whole suite
npm run test:coverage             # + v8 coverage summary
npm run test:ci                   # brings the DB up, then runs with coverage
```

Three end-to-end suites still run as standalone scripts because they need the
running app/worker: `npm run test:onboarding`, `npm run test:admin`, and
`npm run test:jobs` (the last needs `npm run worker`).

Before you push, the same checks CI runs:

```bash
npm run build && npx eslint src scripts test && npm test
```

## Commit conventions

- **One feature or fix per commit, and it lands with its test.** A change to
  behaviour edits both the code **and** its `test/*.test.ts` in the same commit.
  No bulk "formatting + refactor + feature" drops — they're hard to review and
  hard to bisect.
- Write imperative, specific commit subjects ("Raise image limits to 2 MB", not
  "updates"). Explain the *why* in the body when it isn't obvious.
- Branch off `feat/reservme-soft-launch` (the working branch); open a PR rather
  than pushing to it directly.

## The rules that bite

- **The database schema is the source of truth.** Constraints live in
  `drizzle/0000_init.sql` and the numbered migrations — not in application code.
  The booking guarantee (no double-booking) is a `btree_gist` `EXCLUDE`
  constraint; never replace it with a read-then-write check.
- **Every schema change is a new numbered migration** in `drizzle/`, mirrored in
  `src/db/schema.ts`. Never edit an applied migration.
- **Tenant scope is resolved in exactly one place** (`src/lib/tenancy.ts`), never
  from a route param or form field.
- **Tests and scripts run only against local docker Postgres** (port 5433), never
  against the production database.
- Add a `## [Unreleased]` entry to [CHANGELOG.md](CHANGELOG.md) for anything a
  user or operator would notice.

## Releasing

Move the `Unreleased` notes into a new versioned section in the CHANGELOG, then
tag: `git tag vX.Y.Z && git push --tags`.
