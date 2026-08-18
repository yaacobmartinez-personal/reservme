# Plan — Auth hardening (email verification + password reset)

**Pipeline:** plan → refine → **PM review** (below) → UX wireframes → dev → QA →
owner sign-off. Self-contained.

**Goal.** Close the two auth gaps that block a public launch (P1-5 in
`launch-readiness.md`): owner emails are **never verified**, and there is **no
password reset** — a locked-out owner has no way back in, and we can't trust that
the address we email is real. Add email verification and a full forgot/reset
flow, reusing the Resend mailer and Better Auth, without breaking the existing
sign-up-creates-a-venue onboarding.

---

## What exists

- Better Auth (`src/lib/auth.ts`): email+password on, `minPasswordLength: 10`,
  organization plugin. **No `emailVerification` block, no `sendResetPassword`** —
  so verification is off and reset is impossible. Cookies: `sameSite: lax`,
  `secure` off only on localhost, host-scoped to `app.reservme.pro`.
- Mailer (`src/lib/email/mailer.ts`): `sendEmail()` over Resend HTTP; logs
  instead of sending when `RESEND_API_KEY` is unset (dev/CI). Booking email
  templates in `src/lib/email/templates.ts` (pine-on-paper, inline styles).
- Login (`src/app/app/login/login-form.tsx`): a signin/signup tabbed form. Sign
  up calls `signUp.email` → `organization.create` → `/api/venue/init`, then
  redirects. **This depends on sign-up producing a session immediately.**

## Scope

**In:**
- **Email verification (soft):** send a verification email on sign-up; an in-app
  banner for unverified owners with a one-click **resend**; a `/verify-email`
  landing that confirms the token and flips `emailVerified`.
- **Password reset:** a **Forgot password?** link → `/forgot-password` request
  form → email with a tokenised link → `/reset-password?token=…` to set a new
  password. Generic "if an account exists, we've emailed a link" response (no
  account enumeration). Tokens single-use and expiring (Better Auth default 1h).
- **Abuse limits:** rate-limit the reset-request and sign-in paths so neither can
  be used to brute-force or to email-bomb an address.
- **Cookie/secret hygiene:** confirm `secure` + `sameSite` are right under the
  real subdomains; assert a strong secret in prod (the coherence guard already
  warns on a bad `BETTER_AUTH_URL`).
- Two auth email templates (verify, reset) in the product's style.

**Out (deferred):** 2FA/TOTP, passkeys, social login, magic-link sign-in,
email-change re-verification, HIBP breached-password check. Their own plans.

## Design

`src/lib/auth.ts`:
- `emailVerification: { sendOnSignUp: true, autoSignInAfterVerification: true,
  sendVerificationEmail: async ({ user, url }) => deliverAuthEmail("verify", …) }`.
- `emailAndPassword.sendResetPassword: async ({ user, url }) => deliverAuthEmail("reset", …)`
  and `resetPasswordTokenExpiresIn` left at the 1h default.
- **Do NOT set `requireEmailVerification: true`** — see PM override.
- Keep Better Auth's built-in rate limiting on (`rateLimit` enabled in prod);
  additionally guard the reset-request server action with our Postgres limiter
  (`src/lib/abuse.ts` / rate-limit) keyed on IP + email.

`src/lib/email/auth-emails.ts` (new): `verifyEmailTemplate({ name, url })` and
`resetPasswordTemplate({ name, url })` reusing the `shell()` style; a
`deliverAuthEmail(kind, { to, name, url })` helper that calls `sendEmail`. Under
`AUTH_TEST_CAPTURE=1` it also records the last token/url to a global so the test
can complete the real flow (never set in prod).

Pages/components (all on `app.reservme.pro`, token-styled, match login):
- `/app/forgot-password` — email field → `authClient.requestPasswordReset({
  email, redirectTo: "/reset-password" })`; always shows the generic success.
- `/app/reset-password` — reads `?token=`; new-password + confirm → 
  `authClient.resetPassword({ newPassword, token })`; on success → login.
- `/app/verify-email` — reads `?token=`; calls verify; shows done/failed with a
  resend option.
- **Verify banner**: a small client component in the app shell shown when the
  session's `emailVerified` is false, with a **Resend** button
  (`authClient.sendVerificationEmail`). Dismissible per session.
- **Forgot password?** link on the sign-in tab.

## Acceptance criteria

1. Signing up sends a verification email (logged in dev); the new owner still
   lands in their venue immediately (onboarding unbroken); an unverified owner
   sees the verify banner; **Resend** re-sends; clicking the link flips
   `emailVerified` and clears the banner.
2. **Forgot password** sends a reset link for a real account and shows the *same*
   generic message for an unknown email (no enumeration).
3. The reset link sets a new password; the **old password no longer works and the
   new one does**; a used or expired or bogus token is refused.
4. Reset-request and sign-in are rate-limited (repeated hits are throttled).
5. Cookies are `secure` + `sameSite=lax` in prod, host-scoped; no secret leaks;
   `build` / `eslint` / `tsc` clean; no page overflow at 375px.

## Verification (QA stage)

`scripts/test-auth.ts` on **local docker** (with `AUTH_TEST_CAPTURE=1`): sign a
user up; assert a verify token is issued and `verifyEmail` flips `emailVerified`;
`requestPasswordReset` returns the generic success for both a real and an unknown
email; a captured reset token changes the password (old fails, new succeeds); the
token is single-use (second use rejected) and a bogus token is rejected; the
reset-request limiter throttles a burst. Wire `test:auth` into CI. Plus a browser
walkthrough of forgot → reset and the verify banner.

## Files

- **New:** `src/lib/email/auth-emails.ts`; `src/app/app/forgot-password/page.tsx`
  + form; `src/app/app/reset-password/page.tsx` + form; `src/app/app/verify-email/page.tsx`;
  a verify-banner client component; `scripts/test-auth.ts`.
- **Modify:** `src/lib/auth.ts` (verification + reset senders, rate limit);
  `src/app/app/login/login-form.tsx` (Forgot password? link); `src/app/app/layout.tsx`
  (banner); `package.json`; `.github/workflows/ci.yml`; `.env.example` (note
  `AUTH_TEST_CAPTURE`).

---

## 🧭 Project-manager review (stage 3)

**Must / Should / Could.**
- **Must:** password reset end-to-end (request → email → reset → sign in with the
  new password), no account enumeration, tokens single-use + expiring; email
  verification *sent* on sign-up + a verify landing that flips the flag; tests.
- **Should:** the in-app verify banner with resend; rate-limiting the reset/sign-in
  paths.
- **Could:** "password changed" confirmation email; a "verify to unlock X" nudge.

**Risks & overrides.**
1. **Hard-gating verification breaks onboarding (the important one).** Setting
   `requireEmailVerification: true` stops `signUp.email` from creating a session,
   and the login form immediately needs that session to `organization.create` the
   venue — so a hard gate would 401 every new owner mid-signup. **Decision
   (override): soft verification in v1** — send on sign-up, nudge with a banner,
   but don't block use. Hard-gating (or moving org creation server-side into the
   signup) is a later, separate change.
2. **Account enumeration.** The forgot-password response must be identical for
   known and unknown emails, and reset/verify must not reveal whether an address
   exists. Better Auth's `requestPasswordReset` already returns generic success;
   we keep the UI generic too.
3. **Email bombing / brute force.** Reset-request and sign-in are unauthenticated
   POSTs. Keep Better Auth's built-in limiter on and add our Postgres limiter to
   the reset-request keyed on IP+email. Acceptance includes a throttle test.
4. **Token capture in tests.** Tokens are single-use and only delivered by email,
   so the happy-path test needs the plaintext token. Use a **test-only capture**
   (`AUTH_TEST_CAPTURE=1`) that records the last auth URL to a global — guarded so
   it is inert in every non-test environment.
5. **Deliverability depends on ops.** Verification/reset only actually send once
   `RESEND_API_KEY` + a verified sending domain exist in prod; until then they log
   (fine for dev/pilot). Note it for the deploy checklist; not a code blocker.

**Sequencing (dev).** (1) auth email templates + `deliverAuthEmail` + capture
seam; (2) wire `sendResetPassword` + `emailVerification` in auth.ts; (3)
forgot/reset pages + Forgot-password link; (4) verify-email page + banner; (5)
rate-limit the reset-request; (6) `test-auth` + browser + a11y/mobile.

**Sharper acceptance.** Old password fails and new works after reset; second use
of a reset token is rejected; forgot-password is byte-identical for known/unknown
emails; onboarding still creates a venue on sign-up with verification *sent* but
not required.

**PM verdict:** right-sized — no migration, one library config change, three small
pages + a banner, one test. Green-light to wireframes on Must + Should with the
soft-verification override (don't hard-gate; keep onboarding intact).
