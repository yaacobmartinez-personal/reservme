/**
 * Verifies auth hardening — email verification and password reset — end to end
 * against a throwaway user. Runs the flow through Better Auth's own server API
 * in-process, with AUTH_TEST_CAPTURE on so the tokens (only ever delivered by
 * email) can be read back and the real flow completed.
 *
 *   npm run test:auth        (local: point DATABASE_URL at docker, not Neon)
 *
 * Proves the security-critical properties: verification flips the flag; a reset
 * actually changes the password; the request response can't enumerate accounts;
 * tokens are single-use; a bogus token is refused. (Rate-limiting engages on the
 * HTTP layer, not these in-process calls — it's checked in the browser pass.)
 */
process.env.AUTH_TEST_CAPTURE = "1";

import postgres from "postgres";
import { expect, it } from "vitest";

const EMAIL = `auth-test-${Date.now()}@example.com`;
const OLD_PW = "old-password-123";
const NEW_PW = "new-password-456";
let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

function tokenFrom(url: string): string | null {
  try {
    const u = new URL(url);
    const q = u.searchParams.get("token");
    if (q) return q;
    const m = u.pathname.match(/\/(?:reset-password|verify-email)\/([^/?]+)/);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { onnotice: () => {} });
  const { auth } = await import("../src/lib/auth");
  const { lastAuthCapture } = await import("../src/lib/email/auth-emails");

  const threw = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      return false;
    } catch {
      return true;
    }
  };
  const cleanup = async () => {
    await sql`DELETE FROM "user" WHERE email = ${EMAIL}`;
    await sql`DELETE FROM verification WHERE identifier ILIKE ${"%" + EMAIL + "%"}`;
  };

  try {
    await cleanup();

    /* ── sign up sends a verification email; account starts unverified ── */
    await auth.api.signUpEmail({ body: { email: EMAIL, password: OLD_PW, name: "Auth Test" } });
    const [afterSignup] = await sql<{ email_verified: boolean }[]>`
      SELECT email_verified FROM "user" WHERE email = ${EMAIL}`;
    check("new account starts unverified", afterSignup?.email_verified === false);

    const vCap = lastAuthCapture();
    check("a verification email was sent on sign-up", vCap?.kind === "verify" && !!vCap.url,
      vCap?.kind ?? "none");
    const vToken = vCap ? tokenFrom(vCap.url) : null;
    check("verification link carries a token", !!vToken);

    /* ── verifying flips the flag ── */
    await auth.api.verifyEmail({ query: { token: vToken! } });
    const [afterVerify] = await sql<{ email_verified: boolean }[]>`
      SELECT email_verified FROM "user" WHERE email = ${EMAIL}`;
    check("clicking the link marks the email verified", afterVerify?.email_verified === true);

    /* ── forgot password: generic for real AND unknown emails ── */
    const realOk = !(await threw(() =>
      auth.api.requestPasswordReset({ body: { email: EMAIL, redirectTo: "http://app.localhost:3000/reset-password" } }),
    ));
    check("reset request for a real account succeeds", realOk);
    const rCap = lastAuthCapture();
    const rToken = rCap?.kind === "reset" ? tokenFrom(rCap.url) : null;
    check("reset email carries a token", !!rToken);

    const unknownOk = !(await threw(() =>
      auth.api.requestPasswordReset({ body: { email: "nobody-here@example.com", redirectTo: "http://app.localhost:3000/reset-password" } }),
    ));
    check("reset request for an unknown email returns the SAME success (no enumeration)", unknownOk);

    /* ── a bogus token is refused ── */
    const bogus = await threw(() =>
      auth.api.resetPassword({ body: { newPassword: NEW_PW, token: "not-a-real-token" } }),
    );
    check("a bogus reset token is refused", bogus);

    /* ── the real token changes the password ── */
    await auth.api.resetPassword({ body: { newPassword: NEW_PW, token: rToken! } });

    const oldFails = await threw(() => auth.api.signInEmail({ body: { email: EMAIL, password: OLD_PW } }));
    check("the old password no longer works", oldFails);
    const newWorks = !(await threw(() => auth.api.signInEmail({ body: { email: EMAIL, password: NEW_PW } })));
    check("the new password works", newWorks);

    /* ── the reset token is single-use ── */
    const reused = await threw(() =>
      auth.api.resetPassword({ body: { newPassword: "another-password-789", token: rToken! } }),
    );
    check("the reset token can't be used twice", reused);

    console.log(
      failures === 0
        ? "\nAuth hardening verified: verification, reset, no enumeration, single-use tokens.\n"
        : `\n${failures} check(s) FAILED.\n`,
    );
  } finally {
    await cleanup();
    await sql.end();
  }
}

it("auth hardening", async () => {
  await main();
  expect(failures, "one or more checks failed").toBe(0);
}, 30_000);
