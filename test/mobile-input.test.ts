import { describe, expect, it } from "vitest";
import { ok, conflict, fromAuthError, invalid, rateLimited, unauthorized } from "@/lib/mobile/respond";
import { hoursSchema, spaceSchema, usableHours } from "@/lib/mobile/space-input";
import {
  isResolvableTimezone,
  slugProblem,
  suggestSlug,
  venueProblem,
} from "@/lib/mobile/venue-input";

/**
 * The pure half of the mobile API (docs/API-CONTRACT.md #27, #28, #30).
 *
 * These rules exist twice on purpose — the app validates locally so onboarding
 * can refuse without a round trip, and the server validates because a client is
 * not a gatekeeper. The wording is asserted, not just the outcome: when the two
 * copies drift, an owner sees a different refusal depending on which side
 * caught it, which reads as a bug in whichever one they saw second.
 */

describe("venue slug rules (#27)", () => {
  it("accepts an ordinary address", () => {
    expect(slugProblem("katipunan-courts")).toBeNull();
    expect(slugProblem("court9")).toBeNull();
  });

  it("refuses an empty one", () => {
    expect(slugProblem("  ")).toBe("Pick a booking-page address.");
  });

  it("refuses anything that is not letters, numbers and single dashes", () => {
    const message = "Letters, numbers and dashes only.";
    for (const bad of ["Katipunan", "has space", "trailing-", "-leading", "double--dash", "und_score"]) {
      expect(slugProblem(bad), bad).toBe(message);
    }
  });

  it("refuses the slugs the apex serves as its own pages", () => {
    // A venue here would be shadowed and its booking page unreachable.
    for (const reserved of ["privacy", "terms", "login", "admin", "api"]) {
      expect(slugProblem(reserved), reserved).toBe("That address is taken by ReservMe itself.");
    }
  });

  it("caps the length", () => {
    expect(slugProblem("a".repeat(48))).toBeNull();
    expect(slugProblem("a".repeat(49))).toBe("Keep the address under 48 characters.");
  });

  it("suggests a slug from a name, side-stepping the reserved ones", () => {
    expect(suggestSlug("Katipunan Courts")).toBe("katipunan-courts");
    expect(suggestSlug("Court 2 · Panoramic")).toBe("court-2-panoramic");
    // "about" is reserved, so the suggestion must not be a slug we then refuse.
    expect(suggestSlug("About")).toBe("about-venue");
    expect(slugProblem(suggestSlug("About"))).toBeNull();
  });
});

describe("venue input (#27)", () => {
  const base = { name: "Katipunan Courts", slug: "katipunan-courts", timezone: "Asia/Manila", currency: "PHP" };

  it("accepts a complete venue", () => {
    expect(venueProblem(base)).toBeNull();
  });

  it("names the field it refuses, so the form can put it under the input", () => {
    expect(venueProblem({ ...base, name: " " })).toEqual({
      field: "name",
      message: "Give your venue a name.",
    });
    expect(venueProblem({ ...base, slug: "Not A Slug" })?.field).toBe("slug");
    expect(venueProblem({ ...base, currency: "PHPP" })?.field).toBe("currency");
    expect(venueProblem({ ...base, address: "x".repeat(201) })?.field).toBe("address");
  });

  it("refuses a timezone the server cannot resolve", () => {
    // It would make every rendered time quietly wrong rather than obviously
    // broken, which is far worse to debug from a customer complaint.
    expect(venueProblem({ ...base, timezone: "Mars/Olympus" })).toEqual({
      field: "timezone",
      message: "We don't know that timezone.",
    });
    expect(isResolvableTimezone("Asia/Manila")).toBe(true);
    expect(isResolvableTimezone("Europe/Madrid")).toBe(true);
    expect(isResolvableTimezone("Nowhere/Nothing")).toBe(false);
  });
});

describe("space input (#28)", () => {
  it("fills in the defaults a minimal space leaves out", () => {
    const parsed = spaceSchema.parse({ name: "Court 1" });
    expect(parsed).toMatchObject({
      kind: "court",
      capacity: 1,
      slotMinutes: 60,
      bufferMinutes: 0,
      priceCents: 0,
    });
  });

  it("refuses a nameless space in the app's words", () => {
    const parsed = spaceSchema.safeParse({ name: "   " });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0].message).toBe("Give the space a name.");
  });

  it("holds the bounds the web form holds", () => {
    expect(spaceSchema.safeParse({ name: "A", slotMinutes: 14 }).success).toBe(false);
    expect(spaceSchema.safeParse({ name: "A", slotMinutes: 15 }).success).toBe(true);
    expect(spaceSchema.safeParse({ name: "A", slotMinutes: 1441 }).success).toBe(false);
    expect(spaceSchema.safeParse({ name: "A", capacity: 0 }).success).toBe(false);
    expect(spaceSchema.safeParse({ name: "A", capacity: 501 }).success).toBe(false);
    expect(spaceSchema.safeParse({ name: "A", priceCents: -1 }).success).toBe(false);
  });
});

describe("opening hours (#28)", () => {
  const day = (weekday: number, opensAt = "09:00", closesAt = "22:00") => ({ weekday, opensAt, closesAt });

  it("keeps a well-formed week in weekday order", () => {
    const rows = usableHours([day(3), day(1), day(6)]);
    expect(rows.map((r) => r.weekday)).toEqual([1, 3, 6]);
  });

  it("drops a backwards day without losing the rest of the week", () => {
    // A week is edited as a whole; refusing all seven because one pair is
    // inverted would silently lose the other six.
    const rows = usableHours([day(1, "22:00", "09:00"), day(2)]);
    expect(rows.map((r) => r.weekday)).toEqual([2]);
  });

  it("drops a zero-length day", () => {
    expect(usableHours([day(1, "09:00", "09:00")])).toEqual([]);
  });

  it("lets the last row win for a repeated weekday", () => {
    const rows = usableHours([day(1, "09:00", "12:00"), day(1, "13:00", "22:00")]);
    expect(rows).toEqual([{ weekday: 1, opensAt: "13:00", closesAt: "22:00" }]);
  });

  it("a closed day is an absent row, never a flag", () => {
    // The only way this schema can say "Sunday is closed". Availability reads
    // the absence; there is no is_open column to set.
    const rows = usableHours([1, 2, 3, 4, 5, 6].map((w) => day(w)));
    expect(rows).toHaveLength(6);
    expect(rows.some((r) => r.weekday === 0)).toBe(false);
  });

  it("refuses a time that is not wall clock", () => {
    for (const bad of ["9:00", "24:00", "09:60", "0900", "09:00:00", ""]) {
      const parsed = hoursSchema.safeParse({ hours: [{ weekday: 1, opensAt: bad, closesAt: "22:00" }] });
      expect(parsed.success, bad).toBe(false);
    }
    expect(hoursSchema.safeParse({ hours: [day(0, "00:00", "23:59")] }).success).toBe(true);
  });

  it("refuses a weekday outside 0–6 and a week longer than seven days", () => {
    expect(hoursSchema.safeParse({ hours: [day(7)] }).success).toBe(false);
    expect(hoursSchema.safeParse({ hours: [day(-1)] }).success).toBe(false);
    expect(hoursSchema.safeParse({ hours: Array.from({ length: 8 }, () => day(1)) }).success).toBe(false);
  });
});

describe("the error shape every mobile route answers with", () => {
  const body = async (response: Response) => (await response.json()) as Record<string, unknown>;

  it("separates the slug the app switches on from the sentence a person reads", async () => {
    // The app reads `message`; `error` is machine-readable. Collapsing them made
    // the first real refusal render as "unauthorized" on the login screen.
    const json = await body(unauthorized());
    expect(json.error).toBe("unauthorized");
    expect(String(json.message)).toMatch(/Sign in/);
  });

  it("carries fieldErrors so a refusal lands under the right input", async () => {
    const response = invalid({ slug: "Letters, numbers and dashes only." });
    expect(response.status).toBe(400);
    expect((await body(response)).fieldErrors).toEqual({
      slug: "Letters, numbers and dashes only.",
    });
  });

  it("carries a reason and any extras on a conflict", async () => {
    const response = conflict("sole_owner", "You're the only owner.", { venues: ["katipunan"] });
    expect(response.status).toBe(409);
    const json = await body(response);
    expect(json.reason).toBe("sole_owner");
    expect(json.venues).toEqual(["katipunan"]);
  });

  it("answers 429 with something a person can act on", async () => {
    const response = rateLimited();
    expect(response.status).toBe(429);
    expect(String((await body(response)).message)).toMatch(/try again/i);
  });

  it("passes a body straight through on success", async () => {
    const response = ok({ venue: { slug: "katipunan" } }, 201);
    expect(response.status).toBe(201);
    expect(await body(response)).toEqual({ venue: { slug: "katipunan" } });
  });

  describe("mapping Better Auth's own failures", () => {
    it("keeps 401 a 401, so the app signs out rather than showing a 500", async () => {
      const response = fromAuthError({ statusCode: 401, body: { message: "Invalid password" } }, "fallback");
      expect(response.status).toBe(401);
      expect((await body(response)).message).toBe("Invalid password");
    });

    it("turns 422 into our 400, which is where validation lives", async () => {
      expect(fromAuthError({ statusCode: 422 }, "fallback").status).toBe(400);
    });

    it("keeps a rate limit a rate limit", async () => {
      expect(fromAuthError({ statusCode: 429 }, "fallback").status).toBe(429);
    });

    it("falls back to our own words when it gives none", async () => {
      const response = fromAuthError({ statusCode: 401 }, "That email and password don't match.");
      expect((await body(response)).message).toBe("That email and password don't match.");
    });

    it("treats anything unrecognised as a 500 rather than leaking it", async () => {
      const response = fromAuthError(new Error("boom"), "We couldn't do that.");
      expect(response.status).toBe(500);
      expect((await body(response)).message).toBe("We couldn't do that.");
    });
  });
});
