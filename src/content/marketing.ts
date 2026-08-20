/**
 * Marketing content for the apex page (rendered inside this app).
 *
 * Everything comes from the shared, environment-independent package so the app
 * and the standalone marketing site stay in step from one source. Only AUTH —
 * the sign-in / create-venue URLs — is wired per-environment here, via appUrl(),
 * which resolves the app host for the current deployment (a different origin
 * from the apex, so the links must be absolute; `?new=1` opens create-venue).
 * The CTA-bearing content (hero, pricing, closing, footer) is built from AUTH.
 */
import { appUrl } from "@/lib/env";
import {
  type AuthLinks,
  buildClosing,
  buildFooterGroups,
  buildHero,
  buildPricing,
} from "../../packages/marketing-content";

export * from "../../packages/marketing-content";

export const AUTH: AuthLinks = {
  login: appUrl("/login"),
  signup: appUrl("/login?new=1"),
} as const;

export const HERO = buildHero(AUTH);
export const PRICING = buildPricing(AUTH);
export const CLOSING = buildClosing(AUTH);
export const FOOTER_GROUPS = buildFooterGroups(AUTH);
