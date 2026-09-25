/**
 * Minimal transactional mailer with two interchangeable transports.
 *
 * Priority: SMTP (if SMTP_HOST is set) → Resend (if RESEND_API_KEY is set) →
 * log-only. SMTP goes through nodemailer (see ./smtp); Resend uses its HTTP API
 * directly — no SDK, so nothing to keep in step and it runs anywhere fetch does.
 * When neither is configured (local dev, CI, a fresh clone) the message is
 * logged instead of sent, so the whole app works unconfigured. Email is never on
 * the critical path of a booking.
 */
import { sendViaSmtp, smtpConfigured } from "./smtp";

export type Email = {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
};

export type SendResult =
  | { ok: true; id: string | null; delivered: boolean }
  | { ok: false; error: string };

const FROM = process.env.EMAIL_FROM ?? "ReservMe <bookings@reservme.pro>";

export async function sendEmail(email: Email): Promise<SendResult> {
  /**
   * AUTH_TEST_CAPTURE=1 means a test script is driving the app and reading the
   * tokens and codes back out of the capture hooks. Nothing should leave the
   * building in that mode.
   *
   * This matters more than it looks: `next dev` loads .env.local, so a local
   * run already has the production Resend key in hand, and a test that
   * hammers sign-up and forgot-password would be firing real mail at whatever
   * addresses it invented.
   */
  if (process.env.AUTH_TEST_CAPTURE === "1") {
    console.info(`[email:test] captured, not sent — to ${email.to}: "${email.subject}"`);
    return { ok: true, id: null, delivered: false };
  }

  // Prefer SMTP when configured — your own server / SES / Mailgun / etc.
  if (smtpConfigured()) {
    return sendViaSmtp(email, FROM);
  }

  const key = process.env.RESEND_API_KEY;

  if (!key) {
    // Not an error — just unconfigured. Make it visible in dev without failing.
    console.info(
      `[email:dev] would send to ${email.to} — "${email.subject}" ` +
        `(set SMTP_HOST or RESEND_API_KEY to actually send)`,
    );
    return { ok: true, id: null, delivered: false };
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: FROM,
        to: email.to,
        subject: email.subject,
        html: email.html,
        text: email.text,
        ...(email.replyTo ? { reply_to: email.replyTo } : {}),
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      return { ok: false, error: `Resend ${response.status}: ${detail.slice(0, 200)}` };
    }

    const data = (await response.json()) as { id?: string };
    return { ok: true, id: data.id ?? null, delivered: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "unknown send error",
    };
  }
}
