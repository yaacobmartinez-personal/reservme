import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock nodemailer so the SMTP-priority case opens no connection.
const { sendMail } = vi.hoisted(() => ({ sendMail: vi.fn() }));
vi.mock("nodemailer", () => ({
  default: { createTransport: () => ({ sendMail }) },
}));

import { parseSender, sendViaBrevo } from "@/lib/email/brevo";
import { sendEmail } from "@/lib/email/mailer";
import { resetSmtpTransport } from "@/lib/email/smtp";

const EMAIL = {
  to: "owner@example.com",
  subject: "Your ReservMe code",
  html: "<p>123456</p>",
  text: "123456",
};

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  resetSmtpTransport();
  sendMail.mockReset();
  delete process.env.SMTP_HOST;
  delete process.env.RESEND_API_KEY;
  process.env.BREVO_API_KEY = "xkeysib-test";
});

afterEach(() => {
  delete process.env.BREVO_API_KEY;
  delete process.env.SMTP_HOST;
  delete process.env.RESEND_API_KEY;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("parseSender", () => {
  it("splits a display name from the address", () => {
    expect(parseSender("ReservMe <noreply@example.com>")).toEqual({
      name: "ReservMe",
      email: "noreply@example.com",
    });
  });

  it("takes a bare address as-is, with no name", () => {
    expect(parseSender("noreply@example.com")).toEqual({ email: "noreply@example.com" });
  });

  it("drops quotes around the name", () => {
    expect(parseSender('"ReservMe Bookings" <b@example.com>')).toEqual({
      name: "ReservMe Bookings",
      email: "b@example.com",
    });
  });
});

describe("sendViaBrevo", () => {
  it("posts Brevo's shape with the key header and reports delivered", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { messageId: "<m1>" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendViaBrevo(
      { ...EMAIL, replyTo: "desk@example.com" },
      "ReservMe <noreply@example.com>",
    );

    expect(result).toEqual({ ok: true, id: "<m1>", delivered: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.brevo.com/v3/smtp/email");
    expect(init.headers["api-key"]).toBe("xkeysib-test");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(init.body)).toEqual({
      sender: { name: "ReservMe", email: "noreply@example.com" },
      to: [{ email: "owner@example.com" }],
      subject: "Your ReservMe code",
      htmlContent: "<p>123456</p>",
      textContent: "123456",
      replyTo: { email: "desk@example.com" },
    });
  });

  it("turns a refusal into a failure carrying Brevo's reason", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response('{"code":"unauthorized","message":"Key not found"}', { status: 401 }),
      ),
    );
    const result = await sendViaBrevo(EMAIL, "ReservMe <noreply@example.com>");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Brevo 401");
  });

  it("turns a timeout into a failure rather than throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new DOMException("The operation timed out.", "TimeoutError")),
    );
    const result = await sendViaBrevo(EMAIL, "ReservMe <noreply@example.com>");
    expect(result).toEqual({ ok: false, error: "The operation timed out." });
  });
});

describe("sendEmail transport order", () => {
  it("uses Brevo when it is configured and SMTP is not", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { messageId: "<m2>" }));
    vi.stubGlobal("fetch", fetchMock);
    process.env.RESEND_API_KEY = "re_test";

    const result = await sendEmail(EMAIL);

    expect(result).toEqual({ ok: true, id: "<m2>", delivered: true });
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.brevo.com/v3/smtp/email");
  });

  it("prefers SMTP over Brevo", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    process.env.SMTP_HOST = "smtp.example.com";
    sendMail.mockResolvedValue({ messageId: "<s1>", rejected: [] });

    const result = await sendEmail(EMAIL);

    expect(result).toEqual({ ok: true, id: "<s1>", delivered: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("logs a failed send, since most callers never read the result", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("nope", { status: 400 })),
    );
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await sendEmail(EMAIL);

    expect(result.ok).toBe(false);
    expect(error).toHaveBeenCalledOnce();
    expect(error.mock.calls[0][0]).toContain("owner@example.com");
    expect(error.mock.calls[0][0]).toContain("Brevo 400");
  });
});
