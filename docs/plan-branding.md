# Plan — Venue branding (logo · theme · cover)

**Pipeline:** plan → refine → **PM review** (below) → UX wireframes → dev → QA →
owner sign-off. Self-contained.

**Goal.** Let a venue make its public booking page its own: upload a **logo**, pick
a **theme colour**, and set a **cover photo**. Today every booking page looks
identical — a first-letter badge on pine — and `venue.theme` is stored but never
applied. This is white-label polish that makes a venue proud to share its link.

---

## What exists (reuse)

- **Theme swatches already defined** for this exact purpose in `src/app/tokens.css`:
  `--color-swatch-pine | ocean | violet | sunset | rose | slate`
  ("Theme presets offered to venues (white-label swatches)").
- `organization.logo` (text) and `venue.theme` (text, default `'pine'`) columns
  already exist — `theme` is currently unused; `logo` unwritten.
- Public booking page `src/app/[venueSlug]/page.tsx` renders the identity header
  (a letter badge) and uses `accent-*` tokens throughout.
- Owner **Settings** page + `updateVenueSettings` action pattern
  (`src/app/app/actions.ts`), `getVenueBySlug` (`src/lib/venue.ts`).

## Scope

**In (Must):**
- **Theme**: pick one of the six preset colours; applied to the public page (and
  a preview) by re-theming the `accent-*` tokens. Stored in `venue.theme`.
- **Logo**: upload an image; shown on the public page header (replacing the
  letter badge). Stored on `organization.logo`.
- **Cover photo**: upload an image; shown as a banner across the top of the
  public page. Stored in a new `venue.cover_url`.
- **Owner branding UI** (a Branding section in Settings): swatch picker, logo +
  cover upload with a small preview and a remove control, and validation.

**Should:** the logo in the owner app shell / on booking emails; a live preview
card of the public header as you edit.

**Could (defer):** SVG logos (with sanitisation), a custom hex colour, a favicon,
and moving images to object storage + CDN.

**Out:** full page-layout customisation; multiple themes per venue; per-space
branding.

## Image storage — data URLs in the DB (no object storage)

We have no blob storage wired, and standing up S3/R2 is an ops decision, not this
build. So uploaded images are stored as **data URLs** in the existing text
columns — real upload UX (a file input, not a pasted URL), no new infrastructure.
Caps keep the DB and page weight sane:
- **Logo ≤ 128 KB**, **cover ≤ 512 KB**; types **PNG / JPEG / WebP only**.
- **SVG is disallowed** in v1 — an SVG can carry script, and we'd be injecting it
  into the public page; not worth the XSS surface for a logo.
Object storage + CDN delivery is the documented later upgrade; the columns don't
change when we do it (a URL is a URL).

## Data model — `drizzle/0005_branding.sql`

```sql
ALTER TABLE "venue" ADD COLUMN IF NOT EXISTS cover_url text;
```
(Logo reuses `organization.logo`; theme reuses `venue.theme`.) Mirror `cover_url`
in `src/db/schema.ts`.

## Theme application

Add six palette blocks to `src/app/globals.css`, each overriding the full accent
set for a `data-brand` value:
```css
[data-brand="ocean"]  { --color-accent: …; --color-accent-hover: …; --color-accent-ink: …;
                        --color-accent-soft: …; --color-accent-line: …; --color-on-accent: …; }
/* pine (default) needs no block */
```
The public page wraps its content in `<div data-brand={venue.theme}>`, so every
`accent-*` Tailwind utility re-themes with no per-element change. The owner
preview uses the same wrapper.

## Library & actions

- `src/lib/branding.ts`:
  - `THEMES` (the six ids + labels) and `isTheme(x)`.
  - `validateImageDataUrl(value, maxBytes)` — **pure**, returns `{ ok } | { ok:
    false, error }`: must be `data:image/(png|jpeg|webp);base64,…`, decoded size
    ≤ maxBytes. (Unit-tested.)
  - `getBranding(orgId)` — current theme/logo/cover for the settings form.
- Extend `getVenueBySlug` to return `logo` and `coverUrl` (and it already returns
  `theme`).
- `updateBranding(formData)` in `src/app/app/branding-actions.ts`
  (`requireRole('owner','admin')`): theme in the set; logo/cover each validated or
  cleared; write `organization.logo`, `venue.cover_url`, `venue.theme`;
  `revalidatePath('/settings')` + the public page.

## Pages & components

- **Settings → Branding section** (`src/app/app/settings/branding.tsx`, client):
  swatch radio picker; two `ImageField`s (file input → read as data URL →
  client-side size/type check → hidden field), each with a thumbnail preview and
  Remove; a live preview of the public header using the chosen theme + logo.
  Submits `updateBranding`.
- **Public page**: `data-brand` wrapper; render `cover_url` as a banner; render
  `logo` in place of the letter badge (fallback to the badge when absent).

## Acceptance criteria

1. Choosing a theme changes the public page's accent colour (buttons, chips,
   session cards) to the selected preset; the letter badge/logo and links follow.
2. Uploading a logo shows it on the public header and in the settings preview;
   removing it restores the letter badge.
3. Uploading a cover shows it as a banner on the public page; removing it hides it.
4. A too-large image or a non-PNG/JPEG/WebP (incl. SVG) is rejected with a clear
   message and nothing is stored.
5. Branding is owner/admin only; another venue's branding is untouched (tenant
   isolation); migration applies; build/eslint/tsc clean; no overflow at 375px.

## Verification — `scripts/test-branding.ts` (local docker)

Unit: `validateImageDataUrl` accepts a small PNG data URL, rejects an oversized
one, a non-image, and an SVG. Integration: set theme+logo+cover for a throwaway
venue (via the same SQL the action runs) → `getVenueBySlug` returns them; an
invalid theme isn't stored; a second venue is unaffected. `test:branding` in CI.
Plus a browser pass: pick a theme, upload a logo + cover, view the public page.

## Files
- **New:** `drizzle/0005_branding.sql`; `src/lib/branding.ts`;
  `src/app/app/branding-actions.ts`; `src/app/app/settings/branding.tsx`;
  `scripts/test-branding.ts`.
- **Modify:** `src/db/schema.ts`; `src/app/globals.css` (theme palettes);
  `src/lib/venue.ts` (`getVenueBySlug` returns logo/cover); `src/app/[venueSlug]/page.tsx`
  (apply brand); `src/app/app/settings/page.tsx` (render the Branding section);
  `package.json`; `.github/workflows/ci.yml`.

---

## 🧭 Project-manager review (stage 3)

**Must / Should / Could** — as above. Ship theme + logo + cover with validation
(Must); the app-shell/email logo and live preview are Should.

**Risks & overrides.**
1. **Storage.** No blob storage exists. **Decision: store images as data URLs in
   the DB**, size-capped (logo 128 KB / cover 512 KB), PNG/JPEG/WebP only. Real
   upload UX, zero new infra; object storage is a later swap with no schema change.
2. **SVG / XSS.** Injecting an uploaded SVG into the public page is a script
   vector. **SVG is disallowed in v1** (raster only); sanitised SVG is a Could.
3. **Theme via data attribute, not inline vars.** Define the six palettes once in
   CSS under `[data-brand=…]` and set the attribute on a wrapper — robust, no
   per-element overrides, and `pine` stays the default with no block.
4. **Page weight.** A 512 KB cover as a base64 data URL adds ~33% to the page
   HTML. Acceptable at pilot scale with the caps; the object-storage upgrade is
   the real fix and is noted.
5. **Contrast.** The presets are hand-tuned (accent L≈48–60) so on-accent text
   stays legible; we don't allow arbitrary colours in v1, which sidesteps
   contrast failures.
6. **Access.** Branding is owner/admin (`requireRole`); staff don't see it.

**Sequencing (dev).** (1) migration 0005 + schema + CSS palettes; (2)
`branding.ts` (validator + themes) + `test-branding` unit; (3) `getVenueBySlug` +
public page apply brand; (4) settings Branding section + `updateBranding`; (5)
browser + a11y/mobile.

**Sharper acceptance.** Oversized / non-raster images are refused before any
write; removing a logo/cover reverts cleanly; the six themes each render legibly
on the public page; tenant isolation holds.

**PM verdict:** right-sized — one small column, one library, one owner section, a
public-page pass, one test. Green-light to wireframes on Must + Should with the
overrides (data-URL storage; no SVG; `data-brand` theming).
