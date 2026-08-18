import { sendEmail } from "./mailer";

/**
 * Account emails — verify-your-email and reset-your-password. Same plain,
 * inline-styled, asset-free shell as the booking emails (pine-on-paper), so they
 * render everywhere without a build step. Better Auth hands us the tokenised
 * `url`; we only dress it.
 */

const PINE = "#2f6b52";
const INK = "#2b2622";
const MUTE = "#6b645c";
const PAPER = "#faf9f6";
const RULE = "#e6e2da";

function shell(heading: string, body: string): string {
  return `<!doctype html><html><body style="margin:0;background:${PAPER};padding:24px 12px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${INK};">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid ${RULE};border-radius:14px;overflow:hidden;">
    <div style="padding:22px 28px;border-bottom:1px solid ${RULE};">
      <span style="font-size:18px;font-weight:700;letter-spacing:-0.02em;">ReservMe</span>
    </div>
    <div style="padding:28px;">
      <h1 style="margin:0 0 6px;font-size:22px;line-height:1.25;color:${INK};">${heading}</h1>
      ${body}
    </div>
    <div style="padding:16px 28px;border-top:1px solid ${RULE};color:${MUTE};font-size:12px;">
      Sent by ReservMe. If you weren't expecting this, you can ignore it.
    </div>
  </div>
</body></html>`;
}

function button(url: string, label: string): string {
  return `<a href="${url}" style="display:inline-block;background:${PINE};color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:11px 18px;border-radius:999px;">${label}</a>`;
}

function verifyEmailTemplate(name: string, url: string) {
  return {
    subject: "Confirm your email — ReservMe",
    html: shell(
      "Confirm your email",
      `<p style="margin:0 0 18px;color:${MUTE};font-size:15px;line-height:1.6;">Hi ${name}, confirm your email to secure your ReservMe account.</p>
       ${button(url, "Confirm email")}
       <p style="margin:18px 0 0;color:${MUTE};font-size:12px;">If the button doesn't work, paste this link into your browser:<br>${url}</p>`,
    ),
    text: `Confirm your email\n\nHi ${name}, confirm your email to secure your ReservMe account:\n${url}\n`,
  };
}

function resetPasswordTemplate(name: string, url: string) {
  return {
    subject: "Reset your password — ReservMe",
    html: shell(
      "Reset your password",
      `<p style="margin:0 0 18px;color:${MUTE};font-size:15px;line-height:1.6;">Hi ${name}, we received a request to reset your ReservMe password. This link works once and expires in an hour.</p>
       ${button(url, "Choose a new password")}
       <p style="margin:18px 0 0;color:${MUTE};font-size:12px;">Didn't ask for this? Ignore this email — your password won't change.</p>`,
    ),
    text: `Reset your password\n\nHi ${name}, reset your ReservMe password (works once, expires in an hour):\n${url}\n\nDidn't ask for this? Ignore this email.\n`,
  };
}

export type AuthEmailKind = "verify" | "reset";

/**
 * Test-only capture. When AUTH_TEST_CAPTURE=1 (scripts/test-auth.ts, never prod)
 * the last tokenised URL is stashed so the test can complete the real flow that
 * is otherwise only deliverable by email. Inert in every other environment.
 */
declare global {
  var __authCapture: { kind: AuthEmailKind; to: string; url: string } | undefined;
}

export function lastAuthCapture() {
  return globalThis.__authCapture ?? null;
}

export async function deliverAuthEmail(
  kind: AuthEmailKind,
  { to, name, url }: { to: string; name: string; url: string },
) {
  if (process.env.AUTH_TEST_CAPTURE === "1") {
    globalThis.__authCapture = { kind, to, url };
  }
  const tpl = kind === "verify" ? verifyEmailTemplate(name, url) : resetPasswordTemplate(name, url);
  return sendEmail({ to, subject: tpl.subject, html: tpl.html, text: tpl.text });
}
