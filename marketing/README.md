# ReservMe — marketing site

The public marketing site (`reservme.pro`): landing page, Privacy, Terms, and
Contact. A **fully static** Next app — no server, no database, no auth — so it
can go live now, independently of the app.

This is a standalone extract of the marketing surface from the main project so
it can be hosted first while the app matures. When the app is ready to serve the
apex itself, this can be retired or kept as the marketing front.

Marketing copy lives in one place — `packages/marketing-content` at the repo
root. This app's build is a walled-off static export and can't import across the
package boundary, so `scripts/sync-shared-content.mjs` copies that source in as
`src/content/_shared.ts` before every `dev`/`build` (the copy is committed too,
so a marketing-only checkout still builds). Only `AUTH` (the sign-in /
create-venue URLs) is wired locally, from `NEXT_PUBLIC_APP_URL`. Never edit
`_shared.ts` by hand — `test/marketing-content.test.ts` in the root repo fails if
the two ever drift.

## Develop

```bash
npm install
npm run dev
```

## Build & preview

```bash
npm run build      # → out/ (static HTML/CSS/JS)
npm run preview    # serves out/ at http://localhost:4000
```

## Deploy

`out/` is plain static files — host on Cloudflare Pages, Netlify, Vercel,
S3+CloudFront, or GitHub Pages. Build command `npm run build`, output directory
`out`.

Point DNS for `reservme.pro` at the host. The "Create your page" / "Log in"
buttons link to the app deployment via `NEXT_PUBLIC_APP_URL` (set it at build
time, e.g. `https://app.reservme.pro`) — those links resolve once the app is
live.

## What lives here vs the app

| Here (static) | The app (root project) |
| --- | --- |
| Landing page, Privacy, Terms, Contact | Auth, owner dashboard, admin console |
| No database | Postgres (Neon), booking engine, worker |
| `reservme.pro` | `app.reservme.pro`, public booking pages |
