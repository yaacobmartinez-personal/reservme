import { afterEach, describe, expect, it, vi } from "vitest";
import { sendEmail } from "@/lib/email/mailer";

afterEach(() => vi.restoreAllMocks());

describe("sendEmail without RESEND_API_KEY", () => {
  it("logs the message and reports it as not delivered, never failing", async () => {
    expect(process.env.RESEND_API_KEY).toBeUndefined();
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const result = await sendEmail({
      to: "maria@example.com",
      subject: "Booking confirmed",
      html: "<p>Confirmed</p>",
      text: "Confirmed",
    });
    expect(result).toEqual({ ok: true, id: null, delivered: false });
    expect(info).toHaveBeenCalledOnce();
    expect(info.mock.calls[0][0]).toContain("maria@example.com");
  });
});
