import { describe, expect, it } from "vitest";
import { clientIp, verifyTurnstile } from "@/lib/abuse";

// clientIp accepts Next's ReadonlyHeaders; a standard Headers is structurally
// compatible (both expose .get()).
const h = (rec: Record<string, string>) =>
  new Headers(rec) as unknown as Parameters<typeof clientIp>[0];

describe("clientIp", () => {
  it("takes the left-most x-forwarded-for entry", () => {
    expect(clientIp(h({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" }))).toBe("1.2.3.4");
  });

  it("falls back to x-real-ip when there's no forwarded header", () => {
    expect(clientIp(h({ "x-real-ip": "9.9.9.9" }))).toBe("9.9.9.9");
  });

  it("falls back to a constant when nothing is present", () => {
    expect(clientIp(h({}))).toBe("0.0.0.0");
  });
});

describe("verifyTurnstile", () => {
  it("passes through when TURNSTILE_SECRET is unset (unconfigured = allow)", async () => {
    // The test env sets no TURNSTILE_SECRET, so verification is a no-op pass.
    expect(process.env.TURNSTILE_SECRET).toBeUndefined();
    expect(await verifyTurnstile(null, "1.2.3.4")).toBe(true);
    expect(await verifyTurnstile("any-token", "1.2.3.4")).toBe(true);
  });
});
