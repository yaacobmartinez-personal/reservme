# ReservMe — Render pre-deploy runbook

Deploying the **app** (apex marketing + booking, owner dashboard, admin console)
to [Render](https://render.com) via the checked-in Blueprint, against an external
Postgres. Work top to bottom; nothing here is reversible-by-accident, but the DB
and DNS steps deserve care.

> **Scope.** This deploys the root Next.js app as **two Render services from one
> Docker image** (`render.yaml`): `reservme-web` (`node server.js`) and
> `reservme-worker` (`node worker.js`). The standalone static site in
> `marketing/` is a **separate, optional** deploy — the web service already
> serves the apex marketing page, so you do **not** need it on Render.

---

## 0. Architecture at a glance

| Piece | What | Notes |
| --- | --- | --- |
| `reservme-web` | Next.js standalone server, all three hosts | Health check `/api/healthz`; migrations run before each deploy goes live |
| `reservme-worker` | pg-boss worker | Hold sweep (1 min), confirmation + reminder emails, loyalty (15 min), engagement (daily 10:00), billing reminders + auto-suspend (daily 09:00), webhook delivery |
| Postgres | **External** (e.g. Neon) | Not created by Render; `DATABASE_URL` points at it |
| Domains | apex + `app.` + `admin.` → `reservme-web` | Host-based routing in `src/proxy.ts` |

One image, one env group (`reservme`), shared by web + worker.

---

## 1. Prerequisites (collect before you start)

- [ ] **Render account** with a payment method (two `starter` services + egress).
- [ ] **A Postgres database** reachable from Render — Neon is the reference
      (Singapore region to match `render.yaml`). You need the **pooled**
      connection string with `?sslmode=require`. The pooled endpoint is fine: the
      booking engine's advisory locks are transaction-scoped and survive
      transaction pooling.
  - [ ] Confirm the `btree_gist` extension is available (Neon and standard
        Postgres 14+ have it). The first migration runs
        `CREATE EXTENSION IF NOT EXISTS btree_gist;` — the no-double-booking
        guarantee depends on it.
- [ ] **A registrable domain** with DNS you control (apex + two subdomains).
- [ ] **Resend account** (optional but recommended) + a **verified sending
      domain** for `EMAIL_FROM`. Without `RESEND_API_KEY`, mail is logged, not
      sent — everything else still works.
- [ ] **Cloudflare R2** (optional) if you want image uploads stored in object
      storage instead of inline data URLs. See §4.
- [ ] **Cloudflare Turnstile** and **Sentry** (both optional). See §4.

---

## 2. Secrets to generate

| Value | How |
| --- | --- |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` (must be ≥ 32 chars — the app refuses to boot otherwise) |
| `DATABASE_URL` | From your Postgres provider, pooled, with `?sslmode=require` |
| `RESEND_API_KEY` | Resend dashboard (optional) |

The app **fails fast at boot** with a readable error if `DATABASE_URL`,
`BETTER_AUTH_SECRET`, or `BETTER_AUTH_URL` is missing or malformed (see
`src/lib/env.ts`), so a bad env group surfaces immediately in the deploy logs,
not at first request.

---

## 3. ⚠️ The one build-time gotcha — public hosts are baked into the image

`NEXT_PUBLIC_*` values are **inlined into the client bundle at build time**. The
`Dockerfile` hard-codes them to the `reservme.pro` domains:

```dockerfile
ENV NEXT_PUBLIC_APEX_HOST=reservme.pro \
    NEXT_PUBLIC_APP_HOST=app.reservme.pro \
    NEXT_PUBLIC_ADMIN_HOST=admin.reservme.pro \
    NEXT_PUBLIC_PROTOCOL=https
```

The same keys in the `render.yaml` env group only affect **server-side** host
routing at runtime.

- **If your public domains are `reservme.pro` / `app.` / `admin.`** — nothing to
  do.
- **If they differ** — you **must** edit the `Dockerfile` `ENV` block (or pass
  build args) to your real domains **before** building, or client-side links and
  redirects will point at `reservme.pro`. Same applies to
  `NEXT_PUBLIC_TURNSTILE_SITE_KEY` if you use Turnstile — set it at build time.

Do this now, commit it, then proceed.

---

## 4. Optional env (add to the `reservme` group before first deploy if wanted)

**Image storage — Cloudflare R2.** Stubbed in the `render.yaml` env group as
`sync: false` — leave blank to store uploaded logos/covers/court photos/QR codes
as **size-capped data URLs in Postgres** (works, but bloats rows), or set **all
five** to use R2:

| Key | Notes |
| --- | --- |
| `R2_ACCOUNT_ID` | |
| `R2_ACCESS_KEY_ID` | |
| `R2_SECRET_ACCESS_KEY` | secret |
| `R2_BUCKET` | |
| `R2_PUBLIC_URL` | the bucket's **public** domain (its `*.r2.dev` URL or a custom domain) — not the S3 API endpoint |

**Email over SMTP (instead of Resend).** Stubbed in `render.yaml` too. Set
`SMTP_HOST` (and usually `SMTP_USER`/`SMTP_PASS`) to send through your own mail
server or any SMTP provider — Gmail/Workspace, Amazon SES, Mailgun, Postmark, a
self-hosted relay. When `SMTP_HOST` is set it **takes priority over Resend**; the
from address is `EMAIL_FROM`. Default `SMTP_PORT` is 587 (STARTTLS); use 465 for
implicit TLS (or set `SMTP_SECURE=true`). With neither SMTP nor Resend set, mail
is logged, not sent.

**Turnstile** (`TURNSTILE_SECRET` runtime + `NEXT_PUBLIC_TURNSTILE_SITE_KEY`
build-time) and **Sentry** (`SENTRY_DSN`) are already stubbed in `render.yaml`
as `sync: false`. Leave blank to run without them (rate limiting still protects
booking; errors still log as structured JSON).

---

## 5. Deploy

1. Push the branch you're deploying to your Git remote (this work currently lives
   on `feat/reservme-soft-launch` and is **unpushed** — push it first).
2. In Render: **New → Blueprint**, pick the repo/branch. Render reads
   `render.yaml` and proposes `reservme-web` + `reservme-worker`.
3. Fill the `sync: false` secrets in the **`reservme` env group** once
   (`DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `RESEND_API_KEY`,
   `TURNSTILE_SECRET`, `SENTRY_DSN`, and any R2 keys from §4). Both services read
   from this group.
   - `BETTER_AUTH_URL` = the **app host** origin, e.g. `https://app.reservme.pro`.
4. Apply. Render builds the image once and starts both services.
   - `reservme-web`'s **`preDeployCommand: node migrate.js`** runs the migrations
     against `DATABASE_URL` **before** the new version receives traffic.
     Migrations are forward-only and idempotent (tracked in a `_migration`
     table); no seeding runs in production.

---

## 6. DNS / custom domains

All three hosts are served by **`reservme-web`**. In its **Settings → Custom
Domains**, add:

- [ ] `reservme.pro` (apex)
- [ ] `app.reservme.pro`
- [ ] `admin.reservme.pro`

Then create the DNS records Render shows (apex ALIAS/ANAME or A record; `CNAME`
for the two subdomains). Wait for certificates to issue (TLS is automatic).

The worker has **no** public domain.

---

## 7. Post-deploy verification

- [ ] **Health** — `curl https://app.reservme.pro/api/healthz` returns
      `{"ok":true,"db":"up"}` (200). It answers on every host and returns **503**
      if the DB is unreachable. Check the apex and admin hosts too.
- [ ] **Migrations** — the web deploy log shows the migration run (`… applied` /
      `Up to date`).
- [ ] **Worker** — `reservme-worker` logs show the queues created and the hold
      sweep ticking. No crash loop.
- [ ] **Apex** — `https://reservme.pro` renders the marketing page.
- [ ] **Sign up** — create an owner account on `https://app.reservme.pro`, create
      a venue, add a space; confirm it goes live at `https://reservme.pro/<slug>`.
- [ ] **Book** — make a booking on the public page; confirm the run sheet shows
      it and (if Resend is set) a confirmation email is delivered — otherwise the
      worker log shows the "would send" line.
- [ ] **Admin** — see §8, then confirm `https://admin.reservme.pro` loads the
      console and a non-admin is refused.

---

## 8. Bootstrap the first platform admin

There is **no in-app path** to grant platform access (by design). The image also
doesn't ship the grant script. Bootstrap from **your machine**, against the prod
DB:

1. Sign up on `https://app.reservme.pro` with the email that should be admin.
2. Put the **production** `DATABASE_URL` in a local `.env.local` (this is what the
   `:neon` scripts read — never commit it).
3. Run:
   ```bash
   npm run admin:grant:neon -- you@example.com
   ```
   `--list` and `--revoke` work too; it refuses to revoke the last active admin.

Grants live in `platform_admin` and are re-checked on every request, so revoking
takes effect on the next page load.

---

## 9. Migrations & rollback

- **Schema is the source of truth** in `drizzle/` (numbered SQL); `node migrate.js`
  applies any not-yet-applied file inside a transaction and records it. It runs
  automatically on every web deploy via `preDeployCommand`.
- **Forward-only.** There are no down-migrations. To roll back **code**, redeploy
  the previous image in Render — but only if it's compatible with the current
  schema. If a deploy included a schema change, rolling the code back does **not**
  revert the migration; plan schema changes to be backward-compatible across one
  deploy, or take a DB snapshot first (see §10).
- A failed `preDeployCommand` **blocks** the new version from going live, so a
  broken migration won't take traffic.

---

## 10. Operations

- **Backups.** If your provider doesn't already (Neon does point-in-time), the
  repo ships `npm run db:backup` / `db:restore` (`pg_dump` custom format, S3
  upload if `BACKUP_S3_BUCKET` is set). Take a manual snapshot before any risky
  migration.
- **Scaling.** Scale `reservme-web` horizontally freely (stateless; sessions are
  DB-backed). Keep **`reservme-worker` at a single instance** unless you've
  validated pg-boss under concurrency — the scheduled jobs are DB-coordinated, so
  extra instances are safe in principle but 1 is the simplest correct default.
- **Logs.** Structured JSON, one object per line — greppable in Render's log view.
  Errors also go to Sentry when `SENTRY_DSN` is set.
- **Email domain.** `EMAIL_FROM` must be on a domain your transport is allowed to
  send from (verified in Resend, or accepted by your SMTP provider) or sends will
  be rejected.

---

## 11. Known gaps / risks to weigh before go-live

- **The `marketing/` static site is not built or tested in CI** (it isn't
  referenced in `.github/workflows/ci.yml`). It's a separate optional deploy; if
  you host it, verify its build there. The root app's apex marketing is covered
  by the normal build.
- **This branch is unpushed** and, at time of writing, has not been through a full
  production readiness pass beyond build + the test suite (auth hardening review,
  load testing, secrets rotation policy, and legal (Terms/Privacy/DPA) review are
  separate — see `docs/launch-readiness.md`).
- **Neon free tier** cold-starts idle connections; use the pooled endpoint and
  expect the first request after idle to be slow. The `/api/healthz` check keeps
  the web service warm on Render's side but not the DB.

---

### Quick reference — env vars

| Key | Required | Set where | Notes |
| --- | --- | --- | --- |
| `DATABASE_URL` | ✅ | env group (secret) | pooled, `?sslmode=require` |
| `BETTER_AUTH_SECRET` | ✅ | env group (secret) | ≥ 32 chars |
| `BETTER_AUTH_URL` | ✅ | env group (secret) | app-host origin, `https://app.…` |
| `NEXT_PUBLIC_APEX_HOST` / `APP_HOST` / `ADMIN_HOST` / `PROTOCOL` | ✅ | **Dockerfile (build)** + env group (runtime) | build-time value wins for the client bundle — see §3 |
| `RESEND_API_KEY` | ➖ | env group (secret) | one email transport; unset ⇒ SMTP or log |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` | ➖ | env group (secrets) | alternate transport; `SMTP_HOST` set ⇒ used over Resend |
| `EMAIL_FROM` | ➖ | env group | the from address; verify the domain with your provider |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET` / `R2_PUBLIC_URL` | ➖ | env group | all five or none; else data-URL fallback |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | ➖ | **Dockerfile (build)** | only if using Turnstile |
| `TURNSTILE_SECRET` | ➖ | env group (secret) | unset ⇒ rate-limiting only |
| `SENTRY_DSN` | ➖ | env group (secret) | unset ⇒ logs only |
