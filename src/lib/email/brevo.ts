/**
 * Brevo's transactional HTTP API. Here because it sends over HTTPS: hosts that
 * block outbound SMTP (Render's free instances do) cannot use ./smtp at all,
 * and Brevo, unlike Resend, will send from a single verified sender address
 * without a domain of your own. Enabled by setting BREVO_API_KEY; the sender
 * in EMAIL_FROM must be verified in the Brevo account.
 */
import type { Email, SendResult } from "./mailer";

const ENDPOINT = "https://api.brevo.com/v3/smtp/email";
const TIMEOUT_MS = 10_000;

export function brevoConfigured(): boolean {
  return Boolean(process.env.BREVO_API_KEY);
}

/** "ReservMe <hi@example.com>" → { name, email }; a bare address has no name. */
export function parseSender(from: string): { name?: string; email: string } {
  const match = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from);
  if (!match) return { email: from.trim() };
  const name = match[1].replace(/^"|"$/g, "").trim();
  return name ? { name, email: match[2].trim() } : { email: match[2].trim() };
}

export async function sendViaBrevo(email: Email, from: string): Promise<SendResult> {
  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "api-key": process.env.BREVO_API_KEY ?? "",
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        sender: parseSender(from),
        to: [{ email: email.to }],
        subject: email.subject,
        htmlContent: email.html,
        textContent: email.text,
        ...(email.replyTo ? { replyTo: { email: email.replyTo } } : {}),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      const detail = await response.text();
      return { ok: false, error: `Brevo ${response.status}: ${detail.slice(0, 200)}` };
    }

    const data = (await response.json()) as { messageId?: string };
    return { ok: true, id: data.messageId ?? null, delivered: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "unknown Brevo error",
    };
  }
}
