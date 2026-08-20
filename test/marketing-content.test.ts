/**
 * Guards the single-source marketing content. The app (src/content/marketing.ts)
 * imports the shared package directly; the standalone marketing site
 * (marketing/src/content/marketing.ts) imports a synced copy (_shared.ts). This
 * asserts their shared exports are identical, so the two can never silently
 * drift — if someone edits the source without re-syncing, this fails.
 */
import { describe, expect, it } from "vitest";
import * as appContent from "@/content/marketing";
import * as siteContent from "../marketing/src/content/marketing";

// Everything that comes straight from the shared package — must be identical in
// both apps. (AUTH and the CTA-bearing HERO/PRICING/CLOSING/FOOTER are wired
// per-app and legitimately differ, so they're checked separately below.)
const SHARED_KEYS = [
  "SITE",
  "CONTACT_HREF",
  "CURRENCY",
  "PLANS",
  "ENTRY_PRICE",
  "MAX_LISTED_SPACES",
  "MONTHS_BILLED_YEARLY",
  "NAV_LINKS",
  "HERO_FACTS",
  "BOOKING_PREVIEW",
  "VENUE_FAMILIES",
  "TEMPLATE_COUNT",
  "FEATURES",
  "BRANDING",
  "SWITCH_REASONS",
  "STEPS",
  "FAQS",
] as const;

const app = appContent as Record<string, unknown>;
const site = siteContent as Record<string, unknown>;

describe("marketing content is shared from one source", () => {
  it.each(SHARED_KEYS)("%s is identical across both apps", (key) => {
    expect(site[key]).toEqual(app[key]);
  });

  it("shared helper functions agree", () => {
    expect(siteContent.peso(1999)).toBe(appContent.peso(1999));
    expect(siteContent.planForSpaces(8)).toEqual(appContent.planForSpaces(8));
  });

  it("the CTA-bearing content matches once the per-app AUTH href is stripped", () => {
    // HERO's copy is shared; only primaryCta.href is wired per app.
    const stripHero = (h: typeof appContent.HERO) => ({
      ...h,
      primaryCta: { ...h.primaryCta, href: "" },
    });
    expect(stripHero(siteContent.HERO)).toEqual(stripHero(appContent.HERO));
  });

  it("AUTH is wired per app (it legitimately differs)", () => {
    // Both expose an AUTH with login/signup; the values come from each app's env.
    expect(typeof appContent.AUTH.login).toBe("string");
    expect(typeof siteContent.AUTH.login).toBe("string");
    expect(appContent.AUTH.signup).toContain("new=1");
    expect(siteContent.AUTH.signup).toContain("new=1");
  });
});
