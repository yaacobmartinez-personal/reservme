/**
 * Walks the whole mobile contract against a running dev server.
 *
 *   npm run dev:neon             # terminal 1
 *   npm run test:mobile-api      # terminal 2
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
  console.log(`\nMobile API contract - ${BASE}\n`);

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

      await db.end();
    } finally {
      // reopened below for the space checks
    }
  }

  /* #28 spaces and hours, #30 settings — the rest of onboarding */
  const NL = String.fromCharCode(10);
  console.log(NL + "POST /venues/{slug}/spaces + hours + PATCH  (#28, #30)");

  const noName2 = await call("POST", `/venues/${slug}/spaces`, {
    body: { name: " ", kind: "court" },
    token: ownerToken,
  });
  check("a space with no name is refused", noName2.status === 400, noName2.body);

  const madeSpace = await call("POST", `/venues/${slug}/spaces`, {
    body: { name: "Court 1", kind: "court", slotMinutes: 60, priceCents: 90000, capacity: 1 },
    token: ownerToken,
  });
  check("the first space is created", madeSpace.status === 201, madeSpace.body);
  const space = (madeSpace.body.space ?? {}) as Record<string, unknown>;
  const spaceId = String(space.id ?? "");
  check("it is on sale by default", space.isActive === true, space);
  check("and priced as asked", space.priceCents === 90000, space);
  check(
    "and opens every day, or it would be unbookable the moment it exists",
    Array.isArray(space.hours) && (space.hours as unknown[]).length === 7,
    space.hours,
  );
  check("with no photo, so the kind placeholder shows", space.imageUrl === null, space);

  const twin = await call("POST", `/venues/${slug}/spaces`, {
    body: { name: "Court 1", kind: "court", slotMinutes: 60, priceCents: 90000 },
    token: ownerToken,
  });
  const twinSlug = ((twin.body.space ?? {}) as Record<string, unknown>).slug;
  check("a second space of the same name gets its own address", twinSlug === "court-1-2", twinSlug);

  const hours = await call("PUT", `/venues/${slug}/spaces/${spaceId}/hours`, {
    body: {
      hours: [
        ...[1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opensAt: "09:00", closesAt: "22:00" })),
      ],
    },
    token: ownerToken,
  });
  check("the week saves", hours.status === 200, hours.body);
  const saved = ((hours.body.space ?? {}) as Record<string, unknown>).hours as
    | Record<string, unknown>[]
    | undefined;
  check("Sunday is closed by being absent, not by a flag", saved?.length === 6, saved);
  check("and Sunday is the missing one", !saved?.some((h) => h.weekday === 0), saved);
  check(
    "times come back as wall clock, not instants",
    saved?.[0]?.opensAt === "09:00",
    saved?.[0],
  );

  const backwards = await call("PUT", `/venues/${slug}/spaces/${spaceId}/hours`, {
    body: {
      hours: [
        { weekday: 1, opensAt: "22:00", closesAt: "09:00" },
        { weekday: 2, opensAt: "09:00", closesAt: "22:00" },
      ],
    },
    token: ownerToken,
  });
  const kept = ((backwards.body.space ?? {}) as Record<string, unknown>).hours as
    | Record<string, unknown>[]
    | undefined;
  check(
    "a backwards day is dropped without losing the rest of the week",
    backwards.status === 200 && kept?.length === 1 && kept[0].weekday === 2,
    kept,
  );

  // Put the real week back before going live.
  await call("PUT", `/venues/${slug}/spaces/${spaceId}/hours`, {
    body: {
      hours: [1, 2, 3, 4, 5, 6].map((weekday) => ({
        weekday,
        opensAt: "09:00",
        closesAt: "22:00",
      })),
    },
    token: ownerToken,
  });

  const renamed = await call("PATCH", `/venues/${slug}/spaces/${spaceId}`, {
    body: { name: "Centre Court", kind: "court", slotMinutes: 60, priceCents: 95000 },
    token: ownerToken,
  });
  check("the editor can rename and reprice", renamed.status === 200, renamed.body);
  check(
    "but the share link's address does not move under it",
    ((renamed.body.space ?? {}) as Record<string, unknown>).slug === space.slug,
    renamed.body.space,
  );

  const foreign = await call("GET", `/venues/${slug}/spaces/00000000-0000-4000-8000-000000000000`, {
    token: ownerToken,
  });
  check("a space that is not ours is 404", foreign.status === 404, foreign.body);

  const paused = await call("POST", `/venues/${slug}/spaces/${spaceId}/active`, {
    body: { active: false },
    token: ownerToken,
  });
  check("a space can be paused", paused.status === 200, paused.body);
  check(
    "which is what the delete refusal offers instead",
    ((paused.body.space ?? {}) as Record<string, unknown>).isActive === false,
    paused.body.space,
  );
  await call("POST", `/venues/${slug}/spaces/${spaceId}/active`, {
    body: { active: true },
    token: ownerToken,
  });

  /* #29 peak pricing and closures — the rest of the space editor */
  console.log(NL + "POST /spaces/{id}/pricing-rules + /closures  (#29)");

  const noDays = await call("POST", `/venues/${slug}/spaces/${spaceId}/pricing-rules`, {
    body: { weekdays: [], startsAt: "18:00", endsAt: "22:00", priceCents: 120000 },
    token: ownerToken,
  });
  check(
    "a rule for no days at all is refused",
    noDays.status === 400 &&
      (noDays.body.fieldErrors as Record<string, string>)?.weekdays === "Pick at least one day.",
    noDays.body,
  );

  const backwardsRule = await call("POST", `/venues/${slug}/spaces/${spaceId}/pricing-rules`, {
    body: { weekdays: [1], startsAt: "22:00", endsAt: "18:00", priceCents: 120000 },
    token: ownerToken,
  });
  check(
    "and so is one that ends before it starts",
    backwardsRule.status === 400 &&
      (backwardsRule.body.fieldErrors as Record<string, string>)?.endsAt ===
        "The end time must be after the start.",
    backwardsRule.body,
  );

  const rule = await call("POST", `/venues/${slug}/spaces/${spaceId}/pricing-rules`, {
    body: {
      label: "  Peak  ",
      weekdays: [5, 1, 3],
      startsAt: "18:00",
      endsAt: "22:00",
      priceCents: 120000,
    },
    token: ownerToken,
  });
  check("a peak rule goes in", rule.status === 201, rule.body);
  // The answer is the whole space, so the editor redraws from one round trip.
  const ruledSpace = (rule.body.space ?? {}) as Record<string, unknown>;
  const rules = (ruledSpace.pricingRules ?? []) as Record<string, unknown>[];
  check("and comes back on the space", rules.length === 1, rules);
  check("with its label trimmed", rules[0]?.label === "Peak", rules[0]);
  check(
    "its days sorted",
    JSON.stringify(rules[0]?.weekdays) === JSON.stringify([1, 3, 5]),
    rules[0]?.weekdays,
  );
  check(
    "and its window as wall clock, with no zone on it",
    // "18:00", not an instant: a peak hour is the venue's evening, and must
    // not move when a clock somewhere else changes.
    rules[0]?.startsAt === "18:00" && rules[0]?.endsAt === "22:00",
    rules[0],
  );

  const liftRule = await call(
    "DELETE",
    `/venues/${slug}/spaces/${spaceId}/pricing-rules/${rules[0]?.id}`,
    { token: ownerToken },
  );
  check("a rule can be lifted", liftRule.status === 200, liftRule.body);
  check(
    "leaving the space with none",
    (((liftRule.body.space ?? {}) as Record<string, unknown>).pricingRules as unknown[]).length === 0,
    liftRule.body.space,
  );
  const liftedTwice = await call(
    "DELETE",
    `/venues/${slug}/spaces/${spaceId}/pricing-rules/${rules[0]?.id}`,
    { token: ownerToken },
  );
  check("and lifting it twice is a 404, not a crash", liftedTwice.status === 404, liftedTwice.status);

  const badWindow = await call("POST", `/venues/${slug}/closures`, {
    body: { spaceId, date: "2026-12-26", from: "08:00", toDate: "2026-12-24", to: "22:00" },
    token: ownerToken,
  });
  check(
    "a closure that ends before it starts is refused",
    badWindow.status === 400, badWindow.body,
  );

  const closure = await call("POST", `/venues/${slug}/closures`, {
    body: {
      spaceId,
      date: "2026-12-24",
      from: "08:00",
      toDate: "2026-12-26",
      to: "22:00",
      reason: "Christmas",
      forSpaceId: spaceId,
    },
    token: ownerToken,
  });
  check("a multi-day closure goes in", closure.status === 201, closure.body);
  const closures = (((closure.body.space ?? {}) as Record<string, unknown>).closures ??
    []) as Record<string, unknown>[];
  check("and comes back on the space", closures.length === 1, closures);
  check(
    "built in the venue's zone, not the server's",
    // 08:00 in Asia/Manila is 00:00 UTC, always.
    String(closures[0]?.startsAt) === "2026-12-24T00:00:00.000Z",
    closures[0]?.startsAt,
  );

  const venueWide = await call("POST", `/venues/${slug}/closures`, {
    body: { date: "2026-12-31", from: "00:00", to: "23:00", reason: "Stocktake", forSpaceId: spaceId },
    token: ownerToken,
  });
  check("a venue-wide closure needs no space", venueWide.status === 201, venueWide.body);
  const bothClosures = (((venueWide.body.space ?? {}) as Record<string, unknown>).closures ??
    []) as Record<string, unknown>[];
  // It is not this space's closure, but it shuts it — an editor that hid it
  // would show an open day that is not open.
  check(
    "and still shows on the space it shuts",
    bothClosures.some((c) => c.spaceId === null),
    bothClosures,
  );

  const lift = await call(
    "DELETE",
    `/venues/${slug}/closures/${closures[0]?.id}?forSpaceId=${spaceId}`,
    { token: ownerToken },
  );
  check("a closure can be lifted", lift.status === 200, lift.body);
  const liftedGone = await call(
    "DELETE",
    `/venues/${slug}/closures/${closures[0]?.id}?forSpaceId=${spaceId}`,
    { token: ownerToken },
  );
  check("and lifting it twice is a 404", liftedGone.status === 404, liftedGone.status);
  await call("DELETE", `/venues/${slug}/closures/${bothClosures.find((c) => c.spaceId === null)?.id}`, {
    token: ownerToken,
  });

  const foreignRule = await call(
    "POST",
    `/venues/${slug}/spaces/00000000-0000-4000-8000-000000000000/pricing-rules`,
    {
      body: { weekdays: [1], startsAt: "18:00", endsAt: "22:00", priceCents: 1 },
      token: ownerToken,
    },
  );
  check("a rule on a space that is not ours is a 404", foreignRule.status === 404, foreignRule.status);

  const settings = await call("GET", `/venues/${slug}/settings`, { token: ownerToken });
  check("settings read back", settings.status === 200, settings.body);
  const vs = (settings.body.venue ?? {}) as Record<string, unknown>;
  check("with the policy defaults", vs.cancellationMode === "grace", vs);
  check("and the venue not suspended", vs.suspended === false, vs);

  const live = await call("PATCH", `/venues/${slug}`, {
    body: {
      cancellationMode: "grace",
      cancellationGraceHours: 24,
      minNoticeMinutes: 60,
      maxHorizonDays: 60,
    },
    token: ownerToken,
  });
  check("going live saves the policy alone", live.status === 200, live.body);
  check(
    "without wiping the name it never sent",
    ((live.body.venue ?? {}) as Record<string, unknown>).name === "Walk Courts",
    live.body.venue,
  );
  check(
    "and hands back the booking link for the poster",
    String(live.body.bookingUrl).endsWith(`/${slug}`),
    live.body.bookingUrl,
  );
  check("and names the space, so O7 does not say 'your space'", live.body.spaceName != null, live.body);

  // Found on a device: the PATCH answered 200 and the app said "Something went
  // wrong", because onboarding parses `venue` as a VenueMembership while the
  // settings screen parses the same field as VenueSettings. One object has to
  // satisfy both.
  const lv = (live.body.venue ?? {}) as Record<string, unknown>;
  for (const field of ["orgId", "role", "activeSpaces", "slug", "name", "timezone", "currency", "theme", "suspended"]) {
    check(`the venue carries ${field}, which one of its two parsers needs`, lv[field] !== undefined, lv);
  }

  const themed = await call("PATCH", `/venues/${slug}`, {
    body: { theme: "ocean", tagline: "Book a court in seconds" },
    token: ownerToken,
  });
  check(
    "settings can change the theme without touching policy",
    ((themed.body.venue ?? {}) as Record<string, unknown>).theme === "ocean" &&
      ((themed.body.venue ?? {}) as Record<string, unknown>).cancellationGraceHours === 24,
    themed.body.venue,
  );

  const cleared = await call("PATCH", `/venues/${slug}`, {
    body: { tagline: "" },
    token: ownerToken,
  });
  check(
    "an emptied field clears rather than staying put",
    ((cleared.body.venue ?? {}) as Record<string, unknown>).tagline === null,
    cleared.body.venue,
  );

  const badTheme = await call("PATCH", `/venues/${slug}`, {
    body: { theme: "neon" },
    token: ownerToken,
  });
  check("an unknown theme is refused", badTheme.status === 400, badTheme.body);

  const otherVenue = await call("GET", "/venues/somebody-elses-venue/settings", {
    token: ownerToken,
  });
  check(
    "a venue we do not belong to is 404, not 403 — 403 would confirm it exists",
    otherVenue.status === 404,
    otherVenue.body,
  );

  const deleteSpace = await call("DELETE", `/venues/${slug}/spaces/${spaceId}`, {
    token: ownerToken,
  });
  check("an unbooked space can be deleted", deleteSpace.status === 200, deleteSpace.body);

  /* #14 Today, #15 the run-sheet actions */
  console.log("\nGET /venues/{slug}/today + booking actions  (#14, #15)");

  const empty = await call("GET", `/venues/${slug}/today`, { token: ownerToken });
  check("today reads back on a venue with nothing in it", empty.status === 200, empty.body);
  check(
    "the date is the venue's own, not the server's",
    /^\d{4}-\d{2}-\d{2}$/.test(String(empty.body.date)),
    empty.body.date,
  );
  check(
    "an empty run sheet is an empty list, not an error",
    Array.isArray(empty.body.runSheet) && (empty.body.runSheet as unknown[]).length === 0,
    empty.body.runSheet,
  );

  const emptyStats = (empty.body.stats ?? {}) as Record<string, number>;
  for (const key of ["todayCount", "checkedIn", "upcomingCount", "activeSpaces", "totalSpaces", "todayRevenueCents"]) {
    check(`stats carry ${key}`, typeof emptyStats[key] === "number", emptyStats);
  }

  if (process.env.DATABASE_URL) {
    const db = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
    try {
      const [{ org_id: orgId }] = await db<{ org_id: string }[]>`
        SELECT id AS org_id FROM organization WHERE slug = ${slug}
      `;
      const [space2] = await db<{ id: string }[]>`
        INSERT INTO space (organization_id, name, slug, slot_minutes, price_cents, sort_order)
        VALUES (${orgId}, 'Court A', 'court-a', 60, 90000, 0) RETURNING id
      `;
      const [cust] = await db<{ id: string }[]>`
        INSERT INTO customer (organization_id, name, email, phone)
        VALUES (${orgId}, 'Marites Reyes', ${`marites-${stamp}@reservme.test`}, '+639170000000')
        RETURNING id
      `;
      // Today in the venue's own zone, so a booking lands on the sheet whatever
      // hour the test runs and whatever the server thinks the date is.
      const mk = async (ref: string, status: string, hour: number) => {
        const [r] = await db<{ id: string }[]>`
          INSERT INTO reservation (organization_id, space_id, customer_id, reference, kind,
                                   status, party_size, amount_cents, starts_at, ends_at,
                                   hold_expires_at)
          VALUES (
            ${orgId}, ${space2.id}::uuid, ${cust.id}::uuid, ${ref}, 'rental', ${status}, 2, 90000,
            ((now() AT TIME ZONE 'Asia/Manila')::date + ${`${hour}:00`}::time) AT TIME ZONE 'Asia/Manila',
            ((now() AT TIME ZONE 'Asia/Manila')::date + ${`${hour + 1}:00`}::time) AT TIME ZONE 'Asia/Manila',
            -- A hold with no expiry is a slot blocked forever, and the schema
            -- refuses it. Confirmed rows must leave it null.
            ${status === "held" ? db`now() + interval '15 minutes'` : db`NULL`}
          ) RETURNING id
        `;
        return r.id;
      };
      const ref = (n: string) => `${n}-${String(stamp).slice(-6)}`;
      const bookingId = await mk(ref("AAA"), "confirmed", 10);
      await mk(ref("BBB"), "held", 12);
      // A block is a closure, never a reservation. If one is ever written as a
      // session_block it must still stay off the run sheet.
      await db`
        INSERT INTO reservation (organization_id, space_id, reference, kind, status,
                                 party_size, amount_cents, starts_at, ends_at)
        VALUES (${orgId}, ${space2.id}::uuid, ${ref("ZZZ")}, 'session_block', 'confirmed', 1, 0,
          ((now() AT TIME ZONE 'Asia/Manila')::date + '14:00'::time) AT TIME ZONE 'Asia/Manila',
          ((now() AT TIME ZONE 'Asia/Manila')::date + '15:00'::time) AT TIME ZONE 'Asia/Manila')
      `;

      const today = await call("GET", `/venues/${slug}/today`, { token: ownerToken });
      const sheet = (today.body.runSheet ?? []) as Record<string, unknown>[];
      check("the run sheet has both live bookings", sheet.length === 2, sheet.map((r) => r.reference));
      check("and no block, because a block is a closure", !sheet.some((r) => r.reference === ref("ZZZ")), sheet);
      check("ordered by start time", sheet[0]?.reference === ref("AAA"), sheet);

      const row = sheet[0];
      check("the label is venue-local wall clock", row?.label === "10:00\u201311:00", row?.label);
      check("with instants alongside, so the app can re-render them itself", typeof row?.startsAt === "string", row);
      check("the customer comes through", row?.customerName === "Marites Reyes", row);
      check("with their phone, for tap-to-call", row?.customerPhone === "+639170000000", row);
      check("and their history — two bookings each, so neither is a first visit", row?.firstVisit === false, row);
      check("no-show count starts at zero", row?.noShowCount === 0, row);

      const stats = (today.body.stats ?? {}) as Record<string, number>;
      check("stats count today's two", stats.todayCount === 2, stats);
      check("nobody is checked in yet", stats.checkedIn === 0, stats);
      check("takings count the confirmed one only, not the held one", stats.todayRevenueCents === 90000, stats);
      // Measured as a change, not a total: the space section above leaves its
      // second "Court 1" behind, so a hard-coded 1 asserts the wrong thing and
      // breaks whenever that section does.
      check(
        "adding a space moves both space counts by one",
        stats.totalSpaces === emptyStats.totalSpaces + 1 &&
          stats.activeSpaces === emptyStats.activeSpaces + 1,
        { before: emptyStats, after: stats },
      );

      const bad = await call("POST", `/venues/${slug}/bookings/${bookingId}/sabotage`, { token: ownerToken });
      check("an unknown action is 404", bad.status === 404, bad.body);

      const foreign = await call(
        "POST",
        `/venues/${slug}/bookings/00000000-0000-4000-8000-000000000000/checkin`,
        { token: ownerToken },
      );
      check("a booking that is not ours is 404", foreign.status === 404, foreign.body);

      const checkedIn = await call("POST", `/venues/${slug}/bookings/${bookingId}/checkin`, { token: ownerToken });
      check("check-in works", checkedIn.status === 200, checkedIn.body);
      check(
        "and hands back the row, so the sheet updates one line",
        (checkedIn.body.booking as Record<string, unknown>)?.checkedInAt != null,
        checkedIn.body,
      );

      const afterCheckIn = await call("GET", `/venues/${slug}/today`, { token: ownerToken });
      check(
        "which the stats reflect",
        ((afterCheckIn.body.stats ?? {}) as Record<string, number>).checkedIn === 1,
        afterCheckIn.body.stats,
      );

      const undone = await call("POST", `/venues/${slug}/bookings/${bookingId}/undo-checkin`, { token: ownerToken });
      check(
        "undo clears it",
        undone.status === 200 && (undone.body.booking as Record<string, unknown>)?.checkedInAt === null,
        undone.body,
      );

      // A check-in time outside the booking is a typo; storing it would put the
      // arrival outside the booking it belongs to.
      const early = await call("POST", `/venues/${slug}/bookings/${bookingId}/checkin`, {
        body: { at: "2020-01-01T00:00:00.000Z" },
        token: ownerToken,
      });
      const earlyRow = (early.body.booking ?? {}) as Record<string, unknown>;
      // Two bounds, and which one binds depends on the hour the walk runs:
      // for a slot already under way the clamp is its start, and for one still
      // ahead it is *now*, because somebody arriving early has arrived now —
      // recording the slot start would claim an arrival that has not happened.
      // The first version of this asserted only the first case and passed
      // until the clock rolled past midnight.
      const clampedAt = String(earlyRow.checkedInAt);
      const floor =
        String(earlyRow.startsAt) < new Date().toISOString()
          ? String(earlyRow.startsAt)
          : null;
      check(
        "a check-in time before the slot is clamped into it",
        early.status === 200 && (floor === null || clampedAt >= floor),
        { clamped: earlyRow.checkedInAt, startsAt: earlyRow.startsAt },
      );
      // A minute of slack: the clamp is the *database's* now(), and this
      // process's clock is not the same clock. Without it this asserts that
      // two machines agree to the millisecond, which they do not.
      const soon = new Date(Date.now() + 60_000).toISOString();
      check(
        "and never lands in the future",
        early.status === 200 && clampedAt <= soon,
        { clamped: earlyRow.checkedInAt, ceiling: soon },
      );

      await call("POST", `/venues/${slug}/bookings/${bookingId}/undo-checkin`, { token: ownerToken });

      const noShow = await call("POST", `/venues/${slug}/bookings/${bookingId}/no-show`, { token: ownerToken });
      check("no-show works", noShow.status === 200, noShow.body);
      check(
        "and it counts against the customer",
        (noShow.body.booking as Record<string, unknown>)?.noShowCount === 1,
        noShow.body,
      );

      const twice = await call("POST", `/venues/${slug}/bookings/${bookingId}/no-show`, { token: ownerToken });
      check("marking it twice is a 409, not a 404", twice.status === 409, twice.body);
      check("and names the state it is already in", twice.body.reason === "already_no_show", twice.body);

      const goneFromSheet = await call("GET", `/venues/${slug}/today`, { token: ownerToken });
      check(
        "a no-show leaves the run sheet",
        ((goneFromSheet.body.runSheet ?? []) as Record<string, unknown>[]).length === 1,
        goneFromSheet.body.runSheet,
      );

      const [heldRow] = await db<{ id: string }[]>`
        SELECT id FROM reservation WHERE organization_id = ${orgId} AND reference = ${ref("BBB")}
      `;
      const cancelled = await call("POST", `/venues/${slug}/bookings/${heldRow.id}/cancel`, { token: ownerToken });
      check("a held booking can be cancelled from the desk", cancelled.status === 200, cancelled.body);
      check(
        "and comes back cancelled",
        (cancelled.body.booking as Record<string, unknown>)?.status === "cancelled",
        cancelled.body,
      );

      const emptied = await call("GET", `/venues/${slug}/today`, { token: ownerToken });
      check(
        "leaving the sheet empty",
        ((emptied.body.runSheet ?? []) as Record<string, unknown>[]).length === 0,
        emptied.body.runSheet,
      );

      await db`DELETE FROM reservation WHERE organization_id = ${orgId}`;
      await db`DELETE FROM customer WHERE organization_id = ${orgId}`;
      await db`DELETE FROM space WHERE organization_id = ${orgId}`;
    } finally {
      await db.end();
    }
  }


  /* #16 the day grid, #17 walk-ins, #18 move, #19 blocks, #20 customer search */
  console.log("\nGET /venues/{slug}/calendar + bookings + blocks  (#16-#20)");

  if (process.env.DATABASE_URL) {
    const db = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
    try {
      const [{ org_id: orgId }] = await db<{ org_id: string }[]>`
        SELECT id AS org_id FROM organization WHERE slug = ${slug}
      `;
      const [court] = await db<{ id: string }[]>`
        INSERT INTO space (organization_id, name, slug, slot_minutes, price_cents, sort_order)
        VALUES (${orgId}, 'Show Court', 'show-court', 60, 90000, 0) RETURNING id
      `;
      // Open every day, so the grid has an axis whichever day the test runs.
      for (let weekday = 0; weekday < 7; weekday += 1) {
        await db`
          INSERT INTO opening_hours (space_id, weekday, opens_at, closes_at)
          VALUES (${court.id}::uuid, ${weekday}, '08:00', '22:00')
        `;
      }
      const [{ day }] = await db<{ day: string }[]>`
        SELECT ((now() AT TIME ZONE 'Asia/Manila')::date + 2)::text AS day
      `;

      const grid = await call("GET", `/venues/${slug}/calendar?date=${day}`, { token: ownerToken });
      check("the day grid reads back", grid.status === 200, grid.body);
      check("for the day asked for", grid.body.date === day, grid.body.date);
      const lanes = (grid.body.lanes ?? []) as Record<string, unknown>[];
      check("with a lane for the space", lanes.some((l) => l.spaceId === court.id), lanes);
      check(
        "and an hour axis even though nothing is booked",
        Array.isArray(grid.body.rows) && (grid.body.rows as string[]).length > 0,
        grid.body.rows,
      );
      check(
        "drawn from opening hours, not from what happens to be booked",
        (grid.body.rows as string[])[0] === "08:00",
        grid.body.rows,
      );

      const noDate = await call("GET", `/venues/${slug}/calendar`, { token: ownerToken });
      check("no date falls back to the venue's today", noDate.status === 200, noDate.body);
      const badDate = await call("GET", `/venues/${slug}/calendar?date=tuesday`, { token: ownerToken });
      check("a malformed date is refused", badDate.status === 400, badDate.body);

      /* #17 the walk-in */
      const walkIn = await call("POST", `/venues/${slug}/bookings`, {
        body: {
          spaceId: court.id,
          date: day,
          time: "18:00",
          slotCount: 2,
          partySize: 4,
          name: "Ramon Cruz",
          email: `ramon-${stamp}@reservme.test`,
          phone: "+639170000900",
          notes: "Paying cash",
        },
        token: ownerToken,
      });
      check("a walk-in can be taken at the desk", walkIn.status === 201, walkIn.body);
      const booked = (walkIn.body.booking ?? {}) as Record<string, unknown>;
      check("and comes back as a run-sheet row", typeof booked.reference === "string", booked);
      check("two slots means two of THIS space's slots", booked.label === "18:00\u201320:00", booked.label);
      check("the party size is kept", booked.partySize === 4, booked);

      const clash = await call("POST", `/venues/${slug}/bookings`, {
        body: {
          spaceId: court.id, date: day, time: "18:00", slotCount: 1, partySize: 2,
          name: "Someone Else", email: `else-${stamp}@reservme.test`,
        },
        token: ownerToken,
      });
      check("a second booking on the same slot is refused", clash.status === 409, clash.body);
      check("with a reason the grid can act on", typeof clash.body.reason === "string", clash.body);

      const nameless = await call("POST", `/venues/${slug}/bookings`, {
        body: { spaceId: court.id, date: day, time: "09:00", slotCount: 1, partySize: 2 },
        token: ownerToken,
      });
      check("a booking with no customer at all is refused", nameless.status === 400, nameless.body);

      const onGrid = await call("GET", `/venues/${slug}/calendar?date=${day}`, { token: ownerToken });
      const items = (((onGrid.body.lanes ?? []) as Record<string, unknown>[])[0]?.items ?? []) as Record<string, unknown>[];
      check("the booking is on the grid", items.some((i) => i.reference === booked.reference), items);
      check("as a booking, not a block", items[0]?.kind === "booking", items[0]);

      /* #18 move */
      const moved = await call("POST", `/venues/${slug}/bookings/${booked.id}/move`, {
        body: { spaceId: court.id, date: day, time: "20:00" },
        token: ownerToken,
      });
      check("a booking can be moved", moved.status === 200, moved.body);
      check(
        "and carries its own length with it",
        (moved.body.booking as Record<string, unknown>)?.label === "20:00\u201322:00",
        moved.body.booking,
      );

      const moveOntoSelf = await call("POST", `/venues/${slug}/bookings/${booked.id}/move`, {
        body: { spaceId: court.id, date: day, time: "bad" },
        token: ownerToken,
      });
      check("a malformed move time is refused", moveOntoSelf.status === 400, moveOntoSelf.body);

      /* #19 blocks */
      const block = await call("POST", `/venues/${slug}/blocks`, {
        body: { spaceId: court.id, date: day, from: "12:00", to: "14:00", reason: "Net repair" },
        token: ownerToken,
      });
      check("a block can be put in", block.status === 201, block.body);
      const blockRow = (block.body.block ?? {}) as Record<string, unknown>;
      check("it is a block, not a booking", blockRow.kind === "block", blockRow);
      check("and carries its reason", blockRow.title === "Net repair", blockRow);

      const backwards = await call("POST", `/venues/${slug}/blocks`, {
        body: { spaceId: court.id, date: day, from: "14:00", to: "12:00" },
        token: ownerToken,
      });
      check("a backwards block is refused", backwards.status === 400, backwards.body);

      const wholeVenue = await call("POST", `/venues/${slug}/blocks`, {
        body: { date: day, from: "06:00", to: "07:00", reason: "Typhoon" },
        token: ownerToken,
      });
      check("a whole-venue block needs no space", wholeVenue.status === 201, wholeVenue.body);
      check(
        "and says so",
        ((wholeVenue.body.block ?? {}) as Record<string, unknown>).subtitle === "Whole venue",
        wholeVenue.body.block,
      );

      const withBlocks = await call("GET", `/venues/${slug}/calendar?date=${day}`, { token: ownerToken });
      const laneItems = (((withBlocks.body.lanes ?? []) as Record<string, unknown>[])[0]?.items ?? []) as Record<string, unknown>[];
      check(
        "a venue-wide block is drawn in every lane, not nowhere",
        laneItems.filter((i) => i.kind === "block").length === 2,
        laneItems.filter((i) => i.kind === "block"),
      );

      // A block stops NEW bookings; it does not cancel the ones inside it.
      const intoBlock = await call("POST", `/venues/${slug}/bookings`, {
        body: {
          spaceId: court.id, date: day, time: "12:00", slotCount: 1, partySize: 2,
          name: "Blocked Out", email: `blocked-${stamp}@reservme.test`,
        },
        token: ownerToken,
      });
      check("booking into a block is refused", intoBlock.status === 409, intoBlock.body);

      const lifted = await call("DELETE", `/venues/${slug}/blocks/${blockRow.id}`, { token: ownerToken });
      check("a block can be lifted", lifted.status === 200, lifted.body);
      const goneTwice = await call("DELETE", `/venues/${slug}/blocks/${blockRow.id}`, { token: ownerToken });
      check("and lifting it twice is a 404, not a crash", goneTwice.status === 404, goneTwice.body);

      const nowFree = await call("POST", `/venues/${slug}/bookings`, {
        body: {
          spaceId: court.id, date: day, time: "12:00", slotCount: 1, partySize: 2,
          name: "Free Again", email: `free-${stamp}@reservme.test`,
        },
        token: ownerToken,
      });
      check("and the slot is bookable again", nowFree.status === 201, nowFree.body);

      /* #20 customer search */
      const hits = await call("GET", `/venues/${slug}/customers?q=Ramon`, { token: ownerToken });
      check("the typeahead finds a customer", hits.status === 200, hits.body);
      const found = (hits.body.rows ?? []) as Record<string, unknown>[];
      check("by name", found.some((c) => c.name === "Ramon Cruz"), found);
      check(
        "with the fields the sheet shows",
        found[0]?.email !== undefined && found[0]?.bookings !== undefined,
        found[0],
      );
      // One page shape for both readers: the typeahead and the Customers
      // screen call the same endpoint, and they used to disagree about the key.
      check("and a total the header can count", typeof hits.body.total === "number", hits.body.total);

      const noHits = await call("GET", `/venues/${slug}/customers?q=zzzznobody`, { token: ownerToken });
      check(
        "and an empty search is an empty list, not an error",
        noHits.status === 200 && (noHits.body.rows as unknown[]).length === 0,
        noHits.body,
      );

      const segmented = await call("GET", `/venues/${slug}/customers?segment=noShows`, {
        token: ownerToken,
      });
      check("a segment chip filters rather than being ignored", segmented.status === 200, segmented.body);
      check(
        "and nobody in it is clean",
        ((segmented.body.rows ?? []) as Record<string, unknown>[]).every(
          (c) => Number(c.noShowCount) > 0,
        ),
        segmented.body.rows,
      );
      const nonsense = await call("GET", `/venues/${slug}/customers?segment=whales`, {
        token: ownerToken,
      });
      check(
        "and a segment this server does not know shows everybody",
        nonsense.status === 200 &&
          ((nonsense.body.rows ?? []) as unknown[]).length >=
            ((segmented.body.rows ?? []) as unknown[]).length,
        nonsense.status,
      );

      /* #21 one customer's page, #22 the CRM writes */
      const ramonId = String(found.find((c) => c.name === "Ramon Cruz")?.id ?? "");
      const page = await call("GET", `/venues/${slug}/customers/${ramonId}`, { token: ownerToken });
      check("a customer opens with their history", page.status === 200, page.body);
      const history = [
        ...((page.body.upcoming ?? []) as Record<string, unknown>[]),
        ...((page.body.past ?? []) as Record<string, unknown>[]),
      ];
      check("with at least one booking on it", history.length > 0, history.length);
      check(
        "each carrying the reference the customer quotes",
        history.every((b) => typeof b.reference === "string" && String(b.reference).length > 0),
        history[0],
      );
      check(
        "and a label in the venue's own wall clock",
        /^\w{3} \d{2} \w{3} \u00b7 \d{2}:\d{2}$/.test(String(history[0]?.whenLabel)),
        history[0]?.whenLabel,
      );

      const strangerId = "00000000-0000-4000-8000-000000000000";
      const stranger = await call("GET", `/venues/${slug}/customers/${strangerId}`, { token: ownerToken });
      check("a customer who is not this venue's is a 404", stranger.status === 404, stranger.status);
      const notAUuid = await call("GET", `/venues/${slug}/customers/banana`, { token: ownerToken });
      check("and so is a malformed id, rather than a 500", notAUuid.status === 404, notAUuid.status);

      const note = await call("POST", `/venues/${slug}/customers/${ramonId}/notes`, {
        body: { body: "  Prefers the far court  " },
        token: ownerToken,
      });
      check("a note can be written", note.status === 201, note.body);
      const noteRow = (note.body.note ?? {}) as Record<string, unknown>;
      check("trimmed", noteRow.body === "Prefers the far court", noteRow.body);
      check("and signed by whoever wrote it", noteRow.authorName !== undefined, noteRow);

      const emptyNote = await call("POST", `/venues/${slug}/customers/${ramonId}/notes`, {
        body: { body: "   " },
        token: ownerToken,
      });
      check(
        "an empty note is refused in the desk's own words",
        emptyNote.status === 400 && (emptyNote.body.fieldErrors as Record<string, string>)?.body === "Write something first.",
        emptyNote.body,
      );

      const withNote = await call("GET", `/venues/${slug}/customers/${ramonId}`, { token: ownerToken });
      check(
        "and it shows on the customer's page",
        ((withNote.body.notes ?? []) as unknown[]).length === 1,
        withNote.body.notes,
      );

      const unnote = await call(
        "DELETE",
        `/venues/${slug}/customers/${ramonId}/notes/${noteRow.id}`,
        { token: ownerToken },
      );
      check("a note can be taken back", unnote.status === 200, unnote.body);
      const unnoteTwice = await call(
        "DELETE",
        `/venues/${slug}/customers/${ramonId}/notes/${noteRow.id}`,
        { token: ownerToken },
      );
      check("and deleting it twice is not a second success", unnoteTwice.status === 404, unnoteTwice.status);

      const tags = await call("PUT", `/venues/${slug}/customers/${ramonId}/tags`, {
        body: { tags: ["Regular", "Pay & Play"] },
        token: ownerToken,
      });
      check("tags are set as a list", tags.status === 200, tags.body);
      check(
        "and come back on the customer",
        JSON.stringify((tags.body.customer as Record<string, unknown>)?.tags) ===
          JSON.stringify(["Regular", "Pay & Play"]),
        tags.body.customer,
      );

      const again = await call("PUT", `/venues/${slug}/customers/${ramonId}/tags`, {
        body: { tags: ["Regular", "Pay & Play"] },
        token: ownerToken,
      });
      check(
        "sending the same list twice changes nothing",
        JSON.stringify((again.body.customer as Record<string, unknown>)?.tags) ===
          JSON.stringify(["Regular", "Pay & Play"]),
        again.body.customer,
      );

      const badTag = await call("PUT", `/venues/${slug}/customers/${ramonId}/tags`, {
        body: { tags: ["semi;colon"] },
        token: ownerToken,
      });
      check(
        "a tag with punctuation the server rejects says which characters are allowed",
        badTag.status === 400 &&
          (badTag.body.fieldErrors as Record<string, string>)?.tags === "Tags can use letters, numbers, spaces and - . &",
        badTag.body,
      );

      const renamed = await call("PATCH", `/venues/${slug}/customers/${ramonId}`, {
        body: { name: "Ramon S. Cruz", phone: " +63 917 555 0000 " },
        token: ownerToken,
      });
      check("the contact can be corrected", renamed.status === 200, renamed.body);
      const fixed = (renamed.body.customer ?? {}) as Record<string, unknown>;
      check("name trimmed", fixed.name === "Ramon S. Cruz", fixed.name);
      check("phone trimmed", fixed.phone === "+63 917 555 0000", fixed.phone);
      // The (organization_id, email) identity key the booking engine matches
      // returning customers on — editable here would split one person in two.
      check("and the email untouched", String(fixed.email).includes("@"), fixed.email);

      const unnamed = await call("PATCH", `/venues/${slug}/customers/${ramonId}`, {
        body: { name: "  " },
        token: ownerToken,
      });
      check(
        "a nameless customer is refused",
        unnamed.status === 400 && (unnamed.body.fieldErrors as Record<string, string>)?.name === "Name can't be empty.",
        unnamed.body,
      );

      /* #23 the waitlist */
      const [waiter] = await db<{ id: string }[]>`
        SELECT id FROM customer WHERE organization_id = ${orgId} LIMIT 1
      `;
      const soonest = new Date(Date.now() + 2 * 3600_000);
      const later = new Date(Date.now() + 48 * 3600_000);
      await db`
        INSERT INTO waitlist (organization_id, space_id, starts_at, ends_at, customer_id, status)
        VALUES (${orgId}, ${court.id}::uuid, ${later}, ${new Date(later.getTime() + 3600_000)},
                ${waiter.id}::uuid, 'notified'),
               (${orgId}, ${court.id}::uuid, ${soonest}, ${new Date(soonest.getTime() + 3600_000)},
                ${waiter.id}::uuid, 'waiting')
      `;

      const queue = await call("GET", `/venues/${slug}/waitlist`, { token: ownerToken });
      check("the waitlist reads", queue.status === 200, queue.body);
      const entries = (queue.body.entries ?? []) as Record<string, unknown>[];
      check("with both entries", entries.length === 2, entries.length);
      check(
        "soonest slot first",
        new Date(String(entries[0]?.startsAt)) < new Date(String(entries[1]?.startsAt)),
        entries.map((e) => e.startsAt),
      );
      check(
        "and no claim countdown, because the server has no claim window",
        entries.every((e) => e.claimExpiresAt === null),
        entries.map((e) => e.claimExpiresAt),
      );
      check(
        "a notified entry says so",
        entries.some((e) => e.status === "notified"),
        entries.map((e) => e.status),
      );

      await db`
        UPDATE waitlist SET starts_at = now() - interval '2 hours',
                            ends_at = now() - interval '1 hour'
        WHERE organization_id = ${orgId}
      `;
      const pastQueue = await call("GET", `/venues/${slug}/waitlist`, { token: ownerToken });
      check(
        "and a queue for a slot that has passed is history, not work",
        ((pastQueue.body.entries ?? []) as unknown[]).length === 0,
        pastQueue.body.entries,
      );

      await db`DELETE FROM waitlist WHERE organization_id = ${orgId}`;
      await db`DELETE FROM customer_note WHERE organization_id = ${orgId}`;
      await db`DELETE FROM closure WHERE organization_id = ${orgId}`;
      await db`DELETE FROM reservation WHERE organization_id = ${orgId}`;
      await db`DELETE FROM customer WHERE organization_id = ${orgId}`;
      await db`DELETE FROM space WHERE organization_id = ${orgId} AND slug = 'show-court'`;
    } finally {
      await db.end();
    }
  }


  /* #31 team, #32 billing, #33 insights — the three owner screens */
  console.log(NL + "GET /team + /billing + /insights  (#31-#33)");

  const team = await call("GET", `/venues/${slug}/team`, { token: ownerToken });
  check("the team reads", team.status === 200, team.body);
  const members = (team.body.members ?? []) as Record<string, unknown>[];
  check("with the owner on it", members.some((m) => m.role === "owner"), members);
  // So the screen says "you" rather than making somebody recognise their own
  // address in a list.
  check("marked as you", members.some((m) => m.isSelf === true), members);
  check("and your own role, so the screen can explain rather than hide",
    team.body.yourRole === "owner", team.body.yourRole);

  const badInvite = await call("POST", `/venues/${slug}/team/invitations`, {
    body: { email: "not-an-email", role: "member" },
    token: ownerToken,
  });
  check(
    "an invitation nobody could accept is refused",
    badInvite.status === 400 &&
      (badInvite.body.fieldErrors as Record<string, string>)?.email ===
        "That email doesn't look right.",
    badInvite.body,
  );

  const invite = await call("POST", `/venues/${slug}/team/invitations`, {
    body: { email: `staff-${stamp}@reservme.test`, role: "member" },
    token: ownerToken,
  });
  check("an invitation goes out", invite.status === 201, invite.body);
  const invitations = (invite.body.invitations ?? []) as Record<string, unknown>[];
  check("and shows as pending", invitations.length === 1, invitations);
  check(
    "with an expiry the screen can count down",
    typeof invitations[0]?.expiresAt === "string",
    invitations[0],
  );

  const unInvite = await call(
    "DELETE",
    `/venues/${slug}/team/invitations/${invitations[0]?.id}`,
    { token: ownerToken },
  );
  check("an invitation can be taken back", unInvite.status === 200, unInvite.body);
  check(
    "leaving none pending",
    ((unInvite.body.invitations ?? []) as unknown[]).length === 0,
    unInvite.body.invitations,
  );
  const unInviteTwice = await call(
    "DELETE",
    `/venues/${slug}/team/invitations/${invitations[0]?.id}`,
    { token: ownerToken },
  );
  check("and twice is a 404", unInviteTwice.status === 404, unInviteTwice.status);

  // The guard Better Auth has no opinion about, and the one that is not
  // recoverable from inside the app.
  const ownSelf = members.find((m) => m.isSelf === true);
  const demoteSelf = await call("PATCH", `/venues/${slug}/team/members/${ownSelf?.id}`, {
    body: { role: "member" },
    token: ownerToken,
  });
  check(
    "the last owner cannot demote themselves",
    demoteSelf.status === 409 && demoteSelf.body.reason === "last_owner",
    demoteSelf.body,
  );
  check(
    "and the refusal says what to do about it",
    String(demoteSelf.body.message).includes("owner first"),
    demoteSelf.body.message,
  );
  const removeSelf = await call("DELETE", `/venues/${slug}/team/members/${ownSelf?.id}`, {
    token: ownerToken,
  });
  check(
    "nor remove themselves",
    removeSelf.status === 409 && removeSelf.body.reason === "last_owner",
    removeSelf.body,
  );
  const stillOwner = await call("GET", `/venues/${slug}/team`, { token: ownerToken });
  check(
    "and the venue still has its owner",
    ((stillOwner.body.members ?? []) as Record<string, unknown>[]).some(
      (m) => m.role === "owner",
    ),
    stillOwner.body.members,
  );

  const billing = await call("GET", `/venues/${slug}/billing`, { token: ownerToken });
  check("billing reads", billing.status === 200, billing.body);
  const bill = (billing.body.billing ?? {}) as Record<string, unknown>;
  const band = (bill.band ?? {}) as Record<string, unknown>;
  // One active space at this point in the walk, so: Solo.
  check("with the band derived from active spaces", band.id === "solo", bill);
  check("its price named", band.pricePesos === 499, band);
  check("and the venue still trialing", bill.status === "trialing", bill.status);
  check(
    "with the days left on it",
    typeof bill.daysLeftInTrial === "number",
    bill.daysLeftInTrial,
  );

  const proof = await fetch(`${BASE}/api/mobile/venues/${slug}/billing/proof`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${ownerToken}`,
      "x-client": "reservme-flutter/0.1.0 (test)",
    },
    body: (() => {
      const form = new FormData();
      form.set("reference", "INSTA-WALK-1");
      form.set("paidAt", "2026-09-20");
      return form;
    })(),
  });
  const proofBody = (await proof.json()) as Record<string, unknown>;
  check("a transfer can be submitted", proof.status === 201, proofBody);
  const pending = ((proofBody.billing ?? {}) as Record<string, unknown>)
    .pendingPayment as Record<string, unknown> | null;
  // Never in the request: the form cannot declare what it owes.
  check("and is priced from the band, not the form", pending?.amountCents === 49900, pending);
  check("with the date as a day, not an instant", pending?.paidAt === "2026-09-20", pending);

  const secondProof = await fetch(`${BASE}/api/mobile/venues/${slug}/billing/proof`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${ownerToken}`,
      "x-client": "reservme-flutter/0.1.0 (test)",
    },
    body: (() => {
      const form = new FormData();
      form.set("reference", "INSTA-WALK-2");
      form.set("paidAt", "2026-09-21");
      return form;
    })(),
  });
  const secondBody = (await secondProof.json()) as Record<string, unknown>;
  check(
    "a second while one is under review is refused",
    secondProof.status === 409 && secondBody.reason === "already_pending",
    secondBody,
  );

  const insights = await call("GET", `/venues/${slug}/insights?period=7d`, {
    token: ownerToken,
  });
  check("insights read", insights.status === 200, insights.body);
  const ins = (insights.body.insights ?? {}) as Record<string, unknown>;
  check("for the period asked for", ins.range === "7d", ins.range);
  check(
    "with a row per day carrying both value and utilisation",
    ((ins.bookedByDay ?? []) as Record<string, unknown>[]).length === 7 &&
      ((ins.bookedByDay ?? []) as Record<string, unknown>[]).every(
        (d) => typeof d.cents === "number" && typeof d.utilisationPct === "number",
      ),
    ins.bookedByDay,
  );
  check(
    "a full week of full days in the heatmap",
    ((ins.peakHours ?? []) as unknown[][]).length === 7 &&
      ((ins.peakHours ?? []) as unknown[][]).every((row) => row.length === 24),
    (ins.peakHours as unknown[][])?.length,
  );
  check(
    "and no awaiting-payments tile, because v1 is pay-at-venue",
    Object.keys((ins.needsYou ?? {}) as object).sort().join() === "halfEmptySessions,toCheckIn",
    ins.needsYou,
  );
  const nonsense = await call("GET", `/venues/${slug}/insights?period=forever`, {
    token: ownerToken,
  });
  check(
    "a period this server does not know falls back rather than failing",
    nonsense.status === 200 &&
      ((nonsense.body.insights ?? {}) as Record<string, unknown>).range === "30d",
    nonsense.status,
  );

  if (process.env.DATABASE_URL) {
    const db = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
    try {
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
