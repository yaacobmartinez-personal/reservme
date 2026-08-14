import { formatMoney } from "@/lib/money";

/**
 * Plain, robust HTML emails — inline styles only, table-free where possible,
 * no external assets. They render the same in Gmail, Outlook and Apple Mail
 * without a build step. The palette echoes the product's pine-on-paper.
 */

export type BookingEmailData = {
  customerName: string;
  venueName: string;
  venueSlug: string;
  spaceName: string;
  whenLabel: string; // already formatted in the venue's timezone
  reference: string;
  amountCents: number;
  currency: string;
  address: string | null;
  manageUrl: string;
};

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
      Sent by ReservMe on behalf of the venue.
    </div>
  </div>
</body></html>`;
}

function detailRows(data: BookingEmailData): string {
  const rows: [string, string][] = [
    ["Venue", data.venueName],
    ["Space", data.spaceName],
    ["When", data.whenLabel],
    ["Reference", data.reference],
  ];
  if (data.amountCents > 0) {
    rows.push(["Amount", formatMoney(data.amountCents, data.currency)]);
  }
  if (data.address) rows.push(["Where", data.address]);

  return `<div style="margin:18px 0;border:1px solid ${RULE};border-radius:10px;">
    ${rows
      .map(
        ([label, value], i) =>
          `<div style="display:flex;justify-content:space-between;gap:16px;padding:11px 16px;${
            i < rows.length - 1 ? `border-bottom:1px solid ${RULE};` : ""
          }">
            <span style="color:${MUTE};font-size:13px;">${label}</span>
            <span style="font-size:14px;font-weight:600;text-align:right;">${value}</span>
          </div>`,
      )
      .join("")}
  </div>`;
}

function textLines(data: BookingEmailData): string {
  const lines = [
    `Venue: ${data.venueName}`,
    `Space: ${data.spaceName}`,
    `When: ${data.whenLabel}`,
    `Reference: ${data.reference}`,
  ];
  if (data.amountCents > 0) {
    lines.push(`Amount: ${formatMoney(data.amountCents, data.currency)}`);
  }
  if (data.address) lines.push(`Where: ${data.address}`);
  lines.push(`Manage: ${data.manageUrl}`);
  return lines.join("\n");
}

export function bookingConfirmationEmail(data: BookingEmailData) {
  const subject = `Booking confirmed — ${data.venueName}, ${data.whenLabel}`;
  const html = shell(
    "You're booked in.",
    `<p style="margin:0;color:${MUTE};font-size:15px;line-height:1.6;">Thanks, ${data.customerName}. Your reservation is confirmed.</p>
     ${detailRows(data)}
     <a href="${data.manageUrl}" style="display:inline-block;background:${PINE};color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:11px 18px;border-radius:999px;">View booking</a>
     <p style="margin:18px 0 0;color:${MUTE};font-size:12px;">No account needed — keep this email or your reference.</p>`,
  );
  const text =
    `You're booked in.\n\nThanks, ${data.customerName}. Your reservation is confirmed.\n\n` +
    `${textLines(data)}\n`;
  return { subject, html, text };
}

export function bookingReminderEmail(data: BookingEmailData) {
  const subject = `Reminder — ${data.venueName} at ${data.whenLabel}`;
  const html = shell(
    "See you soon.",
    `<p style="margin:0;color:${MUTE};font-size:15px;line-height:1.6;">Hi ${data.customerName}, a quick reminder of your upcoming booking.</p>
     ${detailRows(data)}
     <a href="${data.manageUrl}" style="display:inline-block;background:${PINE};color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:11px 18px;border-radius:999px;">View booking</a>`,
  );
  const text =
    `See you soon.\n\nHi ${data.customerName}, a reminder of your upcoming booking.\n\n` +
    `${textLines(data)}\n`;
  return { subject, html, text };
}
