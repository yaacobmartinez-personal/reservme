import { describe, expect, it } from "vitest";
import { slugify } from "@/lib/slug";

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Court 2 · Panoramic")).toBe("court-2-panoramic");
  });

  it("collapses runs of separators and trims edges", () => {
    expect(slugify("  Hello --- World!!  ")).toBe("hello-world");
  });

  it("keeps the base letter of an accented character via NFKD", () => {
    // "é" decomposes to "e" + a combining mark; the mark (a non-alphanumeric)
    // is dropped, leaving the base letter.
    expect(slugify("Café")).toBe("cafe");
  });

  it("caps the slug at 48 characters", () => {
    const slug = slugify("a".repeat(100));
    expect(slug.length).toBe(48);
  });

  it("falls back to a prefixed unique slug when nothing survives", () => {
    const slug = slugify("···", "space");
    expect(slug.startsWith("space-")).toBe(true);
    expect(slug.length).toBeGreaterThan("space-".length);
  });

  it("uses the default fallback prefix when none is given", () => {
    expect(slugify("!!!").startsWith("item-")).toBe(true);
  });
});
