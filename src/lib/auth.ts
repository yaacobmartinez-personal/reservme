import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer, emailOTP, organization } from "better-auth/plugins";
import { db, schema } from "@/db";
import { serverEnv } from "@/lib/env";
import { adminUrl, APP_HOST, appUrl } from "@/lib/env";
import { deliverAuthCode, deliverAuthEmail } from "@/lib/email/auth-emails";
import { log } from "@/lib/log";

/**
 * BETTER_AUTH_URL is *our app's* origin (where /api/auth is served) — the same
 * origin as NEXT_PUBLIC_APP_HOST. It is NOT a database URL and NOT a hosted
 * auth service (Better Auth runs in this app; it only stores its tables in our
 * Postgres). A common mistake is to paste a "Neon Auth" URL here — that is a
 * different product we don't use. Warn loudly if the origin doesn't line up,
 * because the symptom otherwise is broken sign-in with no obvious cause.
 */
function assertAuthUrlCoherent() {
  try {
    const authOrigin = new URL(serverEnv().BETTER_AUTH_URL).host;
    const appOrigin = new URL(appUrl()).host;
    if (authOrigin !== appOrigin) {
      log.warn("BETTER_AUTH_URL does not match the app host — sign-in will break", {
        betterAuthUrlHost: authOrigin,
        expectedHost: appOrigin,
        hint: "Set BETTER_AUTH_URL to your app origin (e.g. https://app.reservme.pro), not a database or Neon Auth URL.",
      });
    }
  } catch {
    log.warn("BETTER_AUTH_URL is not a valid URL");
  }
}

assertAuthUrlCoherent();

/**
 * Auth lives only on app.reservme.pro. The apex serves marketing and the
 * public booking pages, which are anonymous by design — a customer books a
 * court without ever having an account, so nothing there needs a session.
 */
export const auth = betterAuth({
  appName: "ReservMe",
  secret: serverEnv().BETTER_AUTH_SECRET,
  baseURL: serverEnv().BETTER_AUTH_URL,
  // Both signed-in surfaces post to /api/auth. The apex is deliberately absent:
  // public booking pages are anonymous and must never carry a session.
  trustedOrigins: [appUrl(), adminUrl()],

  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
      organization: schema.organization,
      member: schema.member,
      invitation: schema.invitation,
    },
  }),

  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
    // A locked-out owner needs a way back in. The link is single-use and expires
    // in an hour (Better Auth default); the request response is deliberately
    // generic (see the forgot-password page) so it can't confirm who has an
    // account here.
    sendResetPassword: async ({ user, url }) => {
      await deliverAuthEmail("reset", { to: user.email, name: user.name, url });
    },
  },

  emailVerification: {
    // Send on sign-up, but do NOT require verification to use the app: the
    // sign-up flow creates the venue with the session it gets back, and gating
    // that behind a clicked link would 401 every new owner mid-onboarding. We
    // nudge with an in-app banner instead (soft verification).
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      await deliverAuthEmail("verify", { to: user.email, name: user.name, url });
    },
  },

  advanced: {
    // Scope the cookie to the app subdomain — the apex never reads it.
    defaultCookieAttributes: {
      sameSite: "lax",
      secure: APP_HOST.includes("localhost") === false,
    },
  },

  // On everywhere (not just prod) so dev/CI exercise it too. The global limit is
  // generous — auth endpoints include getSession, hit on every navigation — but
  // the two unauthenticated, abusable POSTs are held tight: a reset request
  // can't be used to email-bomb an address, and sign-in can't be brute-forced.
  // Memory store is fine for a single instance; switch to database storage when
  // we run more than one.
  rateLimit: {
    enabled: true,
    window: 60,
    max: 120,
    customRules: {
      "/request-password-reset": { window: 300, max: 3 },
      "/forget-password": { window: 300, max: 3 },
      "/sign-in/email": { window: 60, max: 10 },
      "/reset-password": { window: 300, max: 10 },
    },
  },

  hooks: {
    /**
     * The email-OTP plugin ships a passwordless sign-in at
     * /sign-in/email-otp. We want its verification and reset codes, not a
     * second way into an owner account that nothing in the product offers,
     * nobody expects, and no screen explains. Plugins add every endpoint they
     * own, so the unwanted one is closed here.
     */
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path === "/sign-in/email-otp" || ctx.path === "/forget-password/email-otp") {
        throw new APIError("NOT_FOUND", { message: "Not found" });
      }
    }),
  },

  plugins: [
    /**
     * The mobile app holds a bearer token, not a cookie: it talks to
     * app.reservme.pro from a process that has no cookie jar shared with a
     * browser, and a Set-Cookie on a native HTTP client is nobody's friend.
     *
     * The plugin does two things. On the way in it converts
     * `Authorization: Bearer <token>` into the session cookie the rest of
     * Better Auth already understands, so every existing endpoint and
     * `getSession` work unchanged. On the way out it returns the session token
     * in `set-auth-token`, which is where POST /api/mobile/auth/login reads it.
     *
     * The token is the session row's own token — opaque, revocable by deleting
     * the session, and expiring with it. It carries no readable `exp`, so the
     * app falls back to its 30-day default and the server stays the authority.
     */
    bearer(),

    /**
     * Six-digit codes, for the app only.
     *
     * `overrideDefaultEmailVerification` is deliberately left off: the web's
     * verify-and-reset links keep working exactly as they did, and the codes
     * are a second channel used by the /api/mobile/auth/* routes. Turning it on
     * would swap the web over too and make a browser user type digits for no
     * reason.
     *
     * Hashed at rest, because a code that grants a password reset is a
     * credential — a leaked `verification` table should not be a set of live
     * reset codes.
     */
    emailOTP({
      otpLength: 6,
      // Long enough to switch apps, find the mail and come back; the web's
      // link gets an hour because a link is harder to retype.
      expiresIn: 60 * 10,
      allowedAttempts: 5,
      storeOTP: "hashed",
      // Never create an account from a code alone — sign-up is a password flow.
      disableSignUp: true,
      rateLimit: { window: 300, max: 3 },
      async sendVerificationOTP({ email, otp, type }) {
        if (type === "sign-in") return; // path is blocked below; belt and braces
        await deliverAuthCode(type === "forget-password" ? "reset" : "verify", {
          to: email,
          // We have no name here, and the templates read fine without one.
          name: email.split("@")[0],
          code: otp,
        });
      },
    }),

    organization({
      // The venue owner is whoever created it; staff are invited in.
      creatorRole: "owner",
      allowUserToCreateOrganization: true,
      // A pending invite is a capability; keep it short-lived.
      invitationExpiresIn: 60 * 60 * 48, // 48h
      async sendInvitationEmail(data) {
        await deliverAuthEmail("invite", {
          to: data.email,
          name: data.organization.name,
          url: appUrl(`/accept-invite?id=${data.id}`),
        });
      },
    }),
  ],
});

export type Auth = typeof auth;
