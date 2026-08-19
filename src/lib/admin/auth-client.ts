"use client";

import { createAuthClient } from "better-auth/react";
import { adminUrl } from "@/lib/env";

/**
 * Auth client for the platform console. It posts to the ADMIN host's /api/auth,
 * so the session cookie is set (host-only) on admin.reservme.pro — a session
 * distinct from the owner app on app.reservme.pro.
 *
 * The owner-app client (src/lib/auth-client.ts) is fixed to the app host; using
 * it here would set the cookie on the app host, which the admin console can't
 * read — leaving admin sign-in permanently bounced back to /login. adminUrl()
 * is already a trustedOrigin in src/lib/auth.ts, so the POST is accepted.
 */
export const adminAuthClient = createAuthClient({
  baseURL: adminUrl(),
});
