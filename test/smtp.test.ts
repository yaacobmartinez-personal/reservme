import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock nodemailer so no real connection is opened.
const { sendMail } = vi.hoisted(() => ({ sendMail: vi.fn() }));
vi.mock("nodemailer", () => ({
  default: { createTransport: () => ({ sendMail }) },
}));

import { resetSmtpTransport, sendViaSmtp, smtpConfigured } from "@/lib/email/smtp";

const EMAIL = {
  to: "customer@example.com",
  subject: "Booking confirmed",
  html: "<p>Confirmed</p>",
  text: "Confirmed",
};

beforeEach(() => {
  resetSmtpTransport();
  sendMail.mockReset();
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_PORT;
  delete process.env.SMTP_SECURE;
});

afterEach(() => {
  delete process.env.SMTP_HOST;
});

describe("smtpConfigured", () => {
  it("is false without SMTP_HOST and true with it", () => {
    expect(smtpConfigured()).toBe(false);
    process.env.SMTP_HOST = "smtp.example.com";
    expect(smtpConfigured()).toBe(true);
  });
});

describe("sendViaSmtp", () => {
  it("sends with the given from + email fields and reports delivered", async () => {
    process.env.SMTP_HOST = "smtp.example.com";
    sendMail.mockResolvedValue({ messageId: "<abc@example.com>", rejected: [] });

    const res = await sendViaSmtp(EMAIL, "ReservMe <bookings@reservme.pro>");

    expect(res).toEqual({ ok: true, id: "<abc@example.com>", delivered: true });
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "ReservMe <bookings@reservme.pro>",
        to: EMAIL.to,
        subject: EMAIL.subject,
        html: EMAIL.html,
        text: EMAIL.text,
      }),
    );
  });

  it("treats rejected recipients as a failure", async () => {
    process.env.SMTP_HOST = "smtp.example.com";
    sendMail.mockResolvedValue({ messageId: "<x>", rejected: ["customer@example.com"] });

    const res = await sendViaSmtp(EMAIL, "from@x");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("customer@example.com");
  });

  it("surfaces a thrown transport error without throwing", async () => {
    process.env.SMTP_HOST = "smtp.example.com";
    sendMail.mockRejectedValue(new Error("ECONNREFUSED"));

    const res = await sendViaSmtp(EMAIL, "from@x");
    expect(res).toEqual({ ok: false, error: "ECONNREFUSED" });
  });
});

describe("mailer prefers SMTP when configured", () => {
  it("routes sendEmail through SMTP over Resend/log", async () => {
    process.env.SMTP_HOST = "smtp.example.com";
    sendMail.mockResolvedValue({ messageId: "<routed>", rejected: [] });

    const { sendEmail } = await import("@/lib/email/mailer");
    const res = await sendEmail(EMAIL);

    expect(res).toEqual({ ok: true, id: "<routed>", delivered: true });
    expect(sendMail).toHaveBeenCalledOnce();
  });
});
