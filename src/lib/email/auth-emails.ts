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

function inviteTemplate(orgName: string, url: string) {
  return {
    subject: `You're invited to help run ${orgName} on ReservMe`,
    html: shell(
      "You've been invited",
      `<p style="margin:0 0 18px;color:${MUTE};font-size:15px;line-height:1.6;">You've been invited to help run <strong style="color:${INK};">${orgName}</strong> on ReservMe. Accept to get access to its bookings and schedule.</p>
       ${button(url, "Accept invitation")}
       <p style="margin:18px 0 0;color:${MUTE};font-size:12px;">If you weren't expecting this, you can ignore it.</p>`,
    ),
    text: `You've been invited to help run ${orgName} on ReservMe.\nAccept: ${url}\n`,
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

export type AuthEmailKind = "verify" | "reset" | "invite";

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
  const tpl =
    kind === "verify"
      ? verifyEmailTemplate(name, url)
      : kind === "invite"
        ? inviteTemplate(name, url)
        : resetPasswordTemplate(name, url);
  return sendEmail({ to, subject: tpl.subject, html: tpl.html, text: tpl.text });
}

/* ── Codes, for the mobile app ─────────────────────────────────────── */

/**
 * The app cannot receive a click. A link would open a browser, verify there,
 * and leave the app holding an unverified session it has no way to refresh —
 * so the mobile flows send a six-digit code the person types back in.
 *
 * Deliberately a *second* channel rather than a replacement: the web keeps its
 * links (`overrideDefaultEmailVerification` stays off), because a link is one
 * tap in a browser and strictly better there.
 */
function codeBlock(code: string): string {
  return `<div style="margin:0 0 18px;font-size:30px;font-weight:700;letter-spacing:0.18em;color:${PINE};font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;">${code}</div>`;
}

function verifyCodeTemplate(name: string, code: string) {
  return {
    subject: `${code} is your ReservMe code`,
    html: shell(
      "Confirm your email",
      `<p style="margin:0 0 18px;color:${MUTE};font-size:15px;line-height:1.6;">Hi ${name}, enter this code in the ReservMe app to confirm your email.</p>
       ${codeBlock(code)}
       <p style="margin:0;color:${MUTE};font-size:12px;">It expires in 10 minutes. If you weren't expecting this, you can ignore it.</p>`,
    ),
    text: `Confirm your email

Hi ${name}, enter this code in the ReservMe app:

${code}

It expires in 10 minutes.
`,
  };
}

function resetCodeTemplate(name: string, code: string) {
  return {
    subject: `${code} is your ReservMe reset code`,
    html: shell(
      "Reset your password",
      `<p style="margin:0 0 18px;color:${MUTE};font-size:15px;line-height:1.6;">Hi ${name}, enter this code in the ReservMe app to choose a new password.</p>
       ${codeBlock(code)}
       <p style="margin:0;color:${MUTE};font-size:12px;">It expires in 10 minutes. Didn't ask for this? Ignore this email — your password won't change.</p>`,
    ),
    text: `Reset your password

Hi ${name}, enter this code in the ReservMe app:

${code}

It expires in 10 minutes. Didn't ask for this? Ignore this email.
`,
  };
}

export type AuthCodeKind = "verify" | "reset";

declare global {
  var __authCodeCapture: { kind: AuthCodeKind; to: string; code: string } | undefined;
}

/** Test-only, same contract as [lastAuthCapture]. */
export function lastAuthCodeCapture() {
  return globalThis.__authCodeCapture ?? null;
}

export async function deliverAuthCode(
  kind: AuthCodeKind,
  { to, name, code }: { to: string; name: string; code: string },
) {
  if (process.env.AUTH_TEST_CAPTURE === "1") {
    globalThis.__authCodeCapture = { kind, to, code };
  }
  const tpl = kind === "verify" ? verifyCodeTemplate(name, code) : resetCodeTemplate(name, code);
  return sendEmail({ to, subject: tpl.subject, html: tpl.html, text: tpl.text });
}
