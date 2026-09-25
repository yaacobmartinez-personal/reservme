/**
 * Walks the whole mobile auth contract against a running dev server.
 *
 *   npm run dev:neon              # terminal 1
 *   npm run test:mobile-auth      # terminal 2
 *
 * It talks HTTP, not `auth.api`, so the proxy host check, the route handlers
 * and the bearer plugin are all in the path — the parts that only fail once
 * something real calls them.
 *
 * Six-digit codes are read back through the AUTH_TEST_CAPTURE hook rather than
 * from a mailbox; that is the only shortcut taken.
 */
import postgres from "postgres";

const BASE = process.env.MOBILE_TEST_BASE ?? "http://app.localhost:3000";
const stamp = Date.now();
const EMAIL = `mobile-test-${stamp}@reservme.test`;
const NAME = "Mobile Test Owner";
const PASSWORD = "a-good-long-password";
const NEW_PASSWORD = "an-even-better-password";

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) {
    passed += 1;
    console.log(`  PASS ${label}`);
  } else {
    failed += 1;
    console.log(
      `  FAIL ${label}${detail === undefined ? "" : `\n       got: ${JSON.stringify(detail)}`}`,
    );
  }
}

type Res = { status: number; body: Record<string, unknown> };

async function call(
  method: string,
  path: string,
  opts: { body?: unknown; token?: string } = {},
): Promise<Res> {
  const response = await fetch(`${BASE}/api/mobile${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-client": "reservme-flutter/0.1.0 (test)",
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await response.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { _raw: text.slice(0, 200) };
  }
  return { status: response.status, body };
}

/** The last code we would have emailed, via AUTH_TEST_CAPTURE. */
async function lastCode(): Promise<string | null> {
  const response = await fetch(`${BASE}/api/mobile/dev-only/last-code`);
  if (!response.ok) return null;
  const body = (await response.json()) as { code?: string };
  return body.code ?? null;
}

async function main() {
  console.log(`\nMobile auth contract - ${BASE}\n`);

  /* #25 sign up */
  console.log("POST /auth/signup  (#25)");
  const weak = await call("POST", "/auth/signup", {
    body: { name: NAME, email: EMAIL, password: "short" },
  });
  check("a short password is refused", weak.status === 400, weak.body);
  check(
    "and the refusal names the field",
    typeof (weak.body.fieldErrors as Record<string, string>)?.password === "string",
    weak.body,
  );

  const signup = await call("POST", "/auth/signup", {
    body: { name: NAME, email: EMAIL, password: PASSWORD },
  });
  check("sign-up returns 201", signup.status === 201, signup.body);
  const signupToken = signup.body.token as string | undefined;
  check("with a bearer token", typeof signupToken === "string" && signupToken.length > 10);
  check(
    "and the user, unverified",
    (signup.body.user as Record<string, unknown>)?.emailVerified === false,
    signup.body.user,
  );

  const dupe = await call("POST", "/auth/signup", {
    body: { name: NAME, email: EMAIL, password: PASSWORD },
  });
  check(
    "a second sign-up on the same email is 409 email_taken",
    dupe.status === 409 && dupe.body.reason === "email_taken",
    dupe.body,
  );

  /* #13 me */
  console.log("\nGET /me  (#13)");
  const meAnon = await call("GET", "/me");
  check("no token is 401", meAnon.status === 401, meAnon.body);

  const meBad = await call("GET", "/me", { token: "not-a-real-token" });
  check("a junk token is 401", meBad.status === 401, meBad.body);

  const me = await call("GET", "/me", { token: signupToken });
  check("the sign-up token works", me.status === 200, me.body);
  check(
    "and the new owner has no venues yet",
    Array.isArray(me.body.venues) && (me.body.venues as unknown[]).length === 0,
    me.body.venues,
  );

  /* #25 verify */
  console.log("\nPOST /auth/verify  (#25)");
  const wrongCode = await call("POST", "/auth/verify", {
    body: { code: "000000" },
    token: signupToken,
  });
  check("a wrong code is refused", wrongCode.status === 400, wrongCode.body);
  check(
    "in the app's own words",
    String(wrongCode.body.message).includes("match"),
    wrongCode.body.message,
  );

  const verifyAnon = await call("POST", "/auth/verify", { body: { code: "123456" } });
  check("verify without a token is 401", verifyAnon.status === 401, verifyAnon.body);

  const resend = await call("POST", "/auth/resend-verification", { token: signupToken });
  check("resend answers ok", resend.status === 200 && resend.body.ok === true, resend.body);

  const code = await lastCode();
  check("a six-digit code was sent", !!code && /^\d{6}$/.test(code), code);

  if (code) {
    const verified = await call("POST", "/auth/verify", { body: { code }, token: signupToken });
    check("the real code verifies", verified.status === 200, verified.body);
    check(
      "and the user comes back verified",
      (verified.body.user as Record<string, unknown>)?.emailVerified === true,
      verified.body.user,
    );
  }

  /* #10 login */
  console.log("\nPOST /auth/login  (#10)");
  const wrongPassword = await call("POST", "/auth/login", {
    body: { email: EMAIL, password: "definitely-not-it" },
  });
  check("a wrong password is 401", wrongPassword.status === 401, wrongPassword.body);

  const unknownEmail = await call("POST", "/auth/login", {
    body: { email: `nobody-${stamp}@reservme.test`, password: PASSWORD },
  });
  check("an unknown address is 401 too", unknownEmail.status === 401, unknownEmail.body);
  check(
    "with the SAME message, so login cannot enumerate accounts",
    wrongPassword.body.message === unknownEmail.body.message,
    [wrongPassword.body.message, unknownEmail.body.message],
  );

  const login = await call("POST", "/auth/login", { body: { email: EMAIL, password: PASSWORD } });
  check("the right password signs in", login.status === 200, login.body);
  const token = login.body.token as string | undefined;
  check("and returns a token", typeof token === "string" && token.length > 10);

  const upper = await call("POST", "/auth/login", {
    body: { email: EMAIL.toUpperCase(), password: PASSWORD },
  });
  check("the address is case-insensitive", upper.status === 200, upper.body);

  /* #12 logout */
  console.log("\nPOST /auth/logout  (#12)");
  const logout = await call("POST", "/auth/logout", { token });
  check("logout answers ok", logout.status === 200, logout.body);
  const afterLogout = await call("GET", "/me", { token });
  check("and the token is dead afterwards", afterLogout.status === 401, afterLogout.body);

  /* #11 + #26 forgot and reset */
  console.log("\nPOST /auth/forgot-password + /auth/reset-password  (#11, #26)");
  const forgotUnknown = await call("POST", "/auth/forgot-password", {
    body: { email: `nobody-${stamp}@reservme.test` },
  });
  check(
    "an unknown address gets ok:true",
    forgotUnknown.status === 200 && forgotUnknown.body.ok === true,
    forgotUnknown.body,
  );

  const forgot = await call("POST", "/auth/forgot-password", { body: { email: EMAIL } });
  check(
    "a known address gets ok:true as well",
    forgot.status === 200 && forgot.body.ok === true,
    forgot.body,
  );
  check(
    "so the two are indistinguishable",
    JSON.stringify(forgot.body) === JSON.stringify(forgotUnknown.body),
  );

  const resetCode = await lastCode();
  check("a reset code was sent", !!resetCode && /^\d{6}$/.test(resetCode), resetCode);

  const badReset = await call("POST", "/auth/reset-password", {
    body: { email: EMAIL, code: "000000", password: NEW_PASSWORD },
  });
  check("a wrong reset code is refused", badReset.status === 400, badReset.body);

  const unknownReset = await call("POST", "/auth/reset-password", {
    body: { email: `nobody-${stamp}@reservme.test`, code: "000000", password: NEW_PASSWORD },
  });
  check(
    "an unknown address refuses IDENTICALLY",
    badReset.status === unknownReset.status && badReset.body.message === unknownReset.body.message,
    [badReset.body.message, unknownReset.body.message],
  );

  if (resetCode) {
    const reset = await call("POST", "/auth/reset-password", {
      body: { email: EMAIL, code: resetCode, password: NEW_PASSWORD },
    });
    check("the real code resets the password", reset.status === 200, reset.body);
    check("and signs the app back in", typeof reset.body.token === "string", reset.body);

    const oldPassword = await call("POST", "/auth/login", {
      body: { email: EMAIL, password: PASSWORD },
    });
    check("the old password no longer works", oldPassword.status === 401, oldPassword.body);

    const newPassword = await call("POST", "/auth/login", {
      body: { email: EMAIL, password: NEW_PASSWORD },
    });
    check("the new one does", newPassword.status === 200, newPassword.body);
  }

  /* #27 create a venue */
  console.log("\nPOST /venues + /venues/slug-available  (#27)");
  const owner = await call("POST", "/auth/login", { body: { email: EMAIL, password: NEW_PASSWORD } });
  const ownerToken = owner.body.token as string | undefined;
  const slug = `walk-courts-${stamp}`;

  const slugAnon = await call("GET", `/venues/slug-available?slug=${slug}`);
  check("the slug check needs a session, or it enumerates venues", slugAnon.status === 401, slugAnon.body);

  const free = await call("GET", `/venues/slug-available?slug=${slug}`, { token: ownerToken });
  check("an unused address is available", free.status === 200 && free.body.available === true, free.body);

  const reserved = await call("GET", "/venues/slug-available?slug=privacy", { token: ownerToken });
  check(
    "a reserved address is refused, not 4xx",
    reserved.status === 200 && reserved.body.available === false,
    reserved.body,
  );
  check(
    "and says who has it",
    String(reserved.body.reason).includes("ReservMe itself"),
    reserved.body.reason,
  );

  const shouty = await call("GET", "/venues/slug-available?slug=Not%20A%20Slug", { token: ownerToken });
  check(
    "a malformed address is refused in the app's words",
    shouty.body.reason === "Letters, numbers and dashes only.",
    shouty.body,
  );

  const noName = await call("POST", "/venues", {
    body: { name: "  ", slug, timezone: "Asia/Manila", currency: "PHP" },
    token: ownerToken,
  });
  check("a venue with no name is refused", noName.status === 400, noName.body);
  check(
    "naming the field, so O3 can put it under the input",
    (noName.body.fieldErrors as Record<string, string>)?.name === "Give your venue a name.",
    noName.body,
  );

  const badZone = await call("POST", "/venues", {
    body: { name: "Walk Courts", slug, timezone: "Mars/Olympus", currency: "PHP" },
    token: ownerToken,
  });
  check("a timezone we cannot resolve is refused", badZone.status === 400, badZone.body);

  const created = await call("POST", "/venues", {
    body: {
      name: "Walk Courts",
      slug,
      timezone: "Asia/Manila",
      currency: "PHP",
      address: "12 Esteban Abada St, Loyola Heights, QC",
    },
    token: ownerToken,
  });
  check("the venue is created", created.status === 201, created.body);
  const venue = (created.body.venue ?? {}) as Record<string, unknown>;
  check("the caller is its owner", venue.role === "owner", venue);
  check("it carries the timezone it was given", venue.timezone === "Asia/Manila", venue);
  check("and no spaces yet", venue.activeSpaces === 0, venue);
  check("and is not suspended", venue.suspended === false, venue);

  const again = await call("POST", "/venues", {
    body: { name: "Walk Courts", slug, timezone: "Asia/Manila", currency: "PHP" },
    token: ownerToken,
  });
  check(
    "creating it twice hands back the same venue, not a refusal",
    again.status === 201 && (again.body.venue as Record<string, unknown>)?.orgId === venue.orgId,
    again.body,
  );

  const nowTaken = await call("GET", `/venues/slug-available?slug=${slug}`, { token: ownerToken });
  check("the address now reads as taken", nowTaken.body.available === false, nowTaken.body);

  const onMe = await call("GET", "/me", { token: ownerToken });
  check(
    "and it shows up on /me",
    ((onMe.body.venues ?? []) as Record<string, unknown>[]).some((v) => v.slug === slug),
    onMe.body.venues,
  );

  if (process.env.DATABASE_URL) {
    const db = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
    try {
      const [sub] = await db<{ status: string; trial_ends_at: Date }[]>`
        SELECT status, trial_ends_at FROM subscription WHERE organization_id = ${String(venue.orgId)}
      `;
      check("a trialing subscription exists", sub?.status === "trialing", sub);
      check(
        "with a month on it, so billing has something to count down",
        sub != null && sub.trial_ends_at.getTime() > Date.now() + 27 * 864e5,
        sub?.trial_ends_at,
      );

      // A venue with an owner cannot be deleted, so hand it off before #34.
      await db`DELETE FROM "organization" WHERE id = ${String(venue.orgId)}`;
    } finally {
      await db.end();
    }
  }


  /* #34 delete */
  console.log("\nDELETE /me  (#34)");
  const final = await call("POST", "/auth/login", {
    body: { email: EMAIL, password: NEW_PASSWORD },
  });
  const finalToken = final.body.token as string | undefined;

  const deleteAnon = await call("DELETE", "/me");
  check("delete without a token is 401", deleteAnon.status === 401, deleteAnon.body);

  // The sole-owner guard is the one refusal both app stores care about, and it
  // needs a venue to refuse over. Creating a venue is contract #27 and does not
  // exist yet, so the rows go in directly — the guard reads the database, which
  // is the part under test.
  const userId = (final.body.user as { id?: string })?.id;
  if (userId && process.env.DATABASE_URL) {
    const db = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
    const orgId = `org-test-${stamp}`;
    const memberId = `mem-${stamp}`;
    const venueSlug = `test-courts-${stamp}`;
    try {
      await db`INSERT INTO "organization" (id, name, slug, created_at)
               VALUES (${orgId}, ${"Test Courts"}, ${venueSlug}, now())`;
      await db`INSERT INTO "venue" (organization_id) VALUES (${orgId})`;
      await db`INSERT INTO "member" (id, organization_id, user_id, role)
               VALUES (${memberId}, ${orgId}, ${userId}, 'owner')`;

      const withVenue = await call("GET", "/me", { token: finalToken });
      const venues = (withVenue.body.venues ?? []) as Record<string, unknown>[];
      check("the venue now shows up on /me", venues.length === 1, venues);
      check("with the owner role", venues[0]?.role === "owner", venues[0]);
      check("and the venue default timezone", venues[0]?.timezone === "Asia/Manila", venues[0]);

      const refused = await call("DELETE", "/me", { token: finalToken });
      check(
        "the only owner of a venue cannot delete themselves",
        refused.status === 409 && refused.body.reason === "sole_owner",
        refused.body,
      );
      check(
        "and the refusal names the venue they would strand",
        Array.isArray(refused.body.venues) && (refused.body.venues as string[])[0] === venueSlug,
        refused.body,
      );

      const stillThere = await call("GET", "/me", { token: finalToken });
      check("the account survived the refusal", stillThere.status === 200, stillThere.status);

      // Let go of the venue so the delete below can proceed.
      await db`DELETE FROM "member" WHERE id = ${memberId}`;
      await db`DELETE FROM "organization" WHERE id = ${orgId}`;
    } finally {
      await db.end();
    }
  } else {
    check("sole-owner guard exercised (needs DATABASE_URL)", false);
  }

  const deleted = await call("DELETE", "/me", { token: finalToken });
  check("an owner of nothing can delete themselves", deleted.status === 200, deleted.body);

  // Only meaningful once the delete actually returned 200. Asserting that a
  // login fails proves nothing when the password was never set in the first
  // place — which is exactly what this line did before, and it passed.
  if (deleted.status === 200) {
    const gone = await call("POST", "/auth/login", {
      body: { email: EMAIL, password: NEW_PASSWORD },
    });
    check("and the account is really gone", gone.status === 401, gone.body);

    const staleToken = await call("GET", "/me", { token: finalToken });
    check("and its token died with it", staleToken.status === 401, staleToken.body);
  } else {
    check("and the account is really gone (skipped: delete failed)", false);
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("\nThe walk could not finish:\n", error);
  process.exit(1);
});
