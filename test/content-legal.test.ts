import { describe, expect, it } from "vitest";
import {
  LEGAL,
  PRIVACY_SECTIONS,
  RESERVED_SLUGS,
  TERMS_SECTIONS,
} from "@/content/legal";

describe("legal content", () => {
  it("exposes the legal metadata", () => {
    expect(LEGAL.company).toBe("ReservMe");
    expect(LEGAL.contactEmail).toContain("@");
    expect(LEGAL.jurisdiction).toMatch(/Philippines/);
  });

  it("has privacy and terms sections, each with a heading and body", () => {
    expect(PRIVACY_SECTIONS.length).toBeGreaterThan(0);
    expect(TERMS_SECTIONS.length).toBeGreaterThan(0);
    for (const section of [...PRIVACY_SECTIONS, ...TERMS_SECTIONS]) {
      expect(section.heading.length).toBeGreaterThan(0);
      expect(Array.isArray(section.body)).toBe(true);
      expect(section.body.length).toBeGreaterThan(0);
      expect(section.body.every((p) => p.length > 0)).toBe(true);
    }
  });

  it("reserves system slugs so a venue can't claim them", () => {
    expect(RESERVED_SLUGS.has("login")).toBe(true);
    expect(RESERVED_SLUGS.has("admin")).toBe(true);
    expect(RESERVED_SLUGS.has("api")).toBe(true);
    expect(RESERVED_SLUGS.has("katipunan")).toBe(false); // a real venue slug is fine
  });
});
