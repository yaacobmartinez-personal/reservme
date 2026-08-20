import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { signPayload, WEBHOOK_EVENTS } from "@/lib/webhooks";

describe("signPayload", () => {
  const secret = "whsec_test_0123456789";
  const body = JSON.stringify({ event: "booking.created", id: "abc" });

  it("matches an independently computed sha256 HMAC", () => {
    const expected =
      "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
    expect(signPayload(secret, body)).toBe(expected);
  });

  it("is deterministic", () => {
    expect(signPayload(secret, body)).toBe(signPayload(secret, body));
  });

  it("changes when the secret changes", () => {
    expect(signPayload(secret, body)).not.toBe(signPayload("other", body));
  });

  it("changes when the body changes", () => {
    expect(signPayload(secret, body)).not.toBe(signPayload(secret, body + " "));
  });
});

describe("WEBHOOK_EVENTS", () => {
  it("exposes the supported event names", () => {
    expect(WEBHOOK_EVENTS).toContain("booking.created");
    expect(WEBHOOK_EVENTS).toContain("booking.cancelled");
  });
});
