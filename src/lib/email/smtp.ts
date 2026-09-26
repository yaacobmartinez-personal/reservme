import nodemailer, { type Transporter } from "nodemailer";
import type { Email, SendResult } from "./mailer";

/**
 * SMTP transport — an alternative to Resend for anyone who'd rather send through
 * their own mail server or a provider that speaks SMTP (Gmail/Workspace, SES,
 * Mailgun, Postmark, a self-hosted relay, …). Enabled by setting SMTP_HOST; the
 * mailer prefers it over Resend when configured.
 *
 * Env:
 *   SMTP_HOST      required to enable                 (e.g. smtp.resend.com)
 *   SMTP_PORT      default 587                        (465 = implicit TLS)
 *   SMTP_SECURE    "true"/"false"; default: 465 ⇒ true, else false (STARTTLS)
 *   SMTP_USER      optional (omit for an open relay)
 *   SMTP_PASS      optional (paired with SMTP_USER)
 */

/** True when SMTP is configured (SMTP_HOST is set). */
export function smtpConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST);
}

// One pooled transporter, created lazily so importing this module never opens a
// connection and an unconfigured deploy pays nothing.
let transport: Transporter | null = null;

function getTransport(): Transporter {
  if (!transport) {
    const port = Number(process.env.SMTP_PORT ?? 587);
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: process.env.SMTP_SECURE
        ? process.env.SMTP_SECURE === "true"
        : port === 465,
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? "" }
        : undefined,
      pool: true,
      // nodemailer waits 2 minutes to connect by default. A host that blocks
      // SMTP (Render's free plan does) then holds every request that sends
      // mail for two minutes and fails silently; ten seconds fails it loudly.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }
  return transport;
}

/** Reset the cached transporter — for tests. */
export function resetSmtpTransport(): void {
  transport = null;
}

export async function sendViaSmtp(email: Email, from: string): Promise<SendResult> {
  try {
    const info = await getTransport().sendMail({
      from,
      to: email.to,
      subject: email.subject,
      html: email.html,
      text: email.text,
      replyTo: email.replyTo,
    });

    if (info.rejected && info.rejected.length > 0) {
      return { ok: false, error: `SMTP rejected: ${info.rejected.join(", ")}` };
    }
    return { ok: true, id: info.messageId ?? null, delivered: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "unknown SMTP error",
    };
  }
}
