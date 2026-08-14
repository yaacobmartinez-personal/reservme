import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";
import { db, schema } from "@/db";
import { serverEnv } from "@/lib/env";
import { adminUrl, APP_HOST, appUrl } from "@/lib/env";

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
  },

  advanced: {
    // Scope the cookie to the app subdomain — the apex never reads it.
    defaultCookieAttributes: {
      sameSite: "lax",
      secure: APP_HOST.includes("localhost") === false,
    },
  },

  plugins: [
    organization({
      // The venue owner is whoever created it; staff are invited in.
      creatorRole: "owner",
      allowUserToCreateOrganization: true,
    }),
  ],
});

export type Auth = typeof auth;
