/**
 * Marketing content for the standalone static site.
 *
 * Everything comes from the shared, environment-independent content — copied in
 * as `_shared.ts` by scripts/sync-shared-content.mjs (this app's build is a
 * walled-off static export and can't import across the package boundary). One
 * source of truth: packages/marketing-content/index.ts.
 *
 * Only AUTH — the sign-in / create-venue URLs — is wired here. Auth lives in the
 * separate app deployment; set NEXT_PUBLIC_APP_URL to its origin (e.g.
 * https://app.reservme.pro) so these CTAs point there. `?new=1` opens the
 * create-venue tab. Until the app is deployed these links won't resolve yet;
 * that's expected for a marketing-first launch.
 */
import {
  type AuthLinks,
  buildClosing,
  buildFooterGroups,
  buildHero,
  buildPricing,
} from "./_shared";

export * from "./_shared";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://app.reservme.pro").replace(/\/$/, "");

export const AUTH: AuthLinks = {
  login: `${APP_URL}/login`,
  signup: `${APP_URL}/login?new=1`,
} as const;

export const HERO = buildHero(AUTH);
export const PRICING = buildPricing(AUTH);
export const CLOSING = buildClosing(AUTH);
export const FOOTER_GROUPS = buildFooterGroups(AUTH);
