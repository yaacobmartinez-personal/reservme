import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";
import { db, schema } from "@/db";
import { serverEnv } from "@/lib/env";
import { adminUrl, APP_HOST, appUrl } from "@/lib/env";
import { deliverAuthEmail } from "@/lib/email/auth-emails";
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

  plugins: [
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
