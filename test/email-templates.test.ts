import { describe, expect, it } from "vitest";
import {
  type BookingEmailData,
  bookingConfirmationEmail,
  bookingReminderEmail,
} from "@/lib/email/templates";

const data: BookingEmailData = {
  customerName: "Maria Santos",
  venueName: "Katipunan Padel",
  venueSlug: "katipunan",
  spaceName: "Court 1",
  whenLabel: "Sat 23 Aug, 6:00 PM",
  reference: "ABCD-1234",
  amountCents: 90000,
  currency: "PHP",
  address: "12 Katipunan Ave, QC",
  manageUrl: "https://reservme.pro/katipunan/manage/ABCD-1234",
};

describe("booking email templates", () => {
  it("confirmation carries the venue, when-label, and manage link", () => {
    const { subject, html, text } = bookingConfirmationEmail(data);
    expect(subject).toContain("Booking confirmed");
    expect(subject).toContain("Katipunan Padel");
    expect(subject).toContain(data.whenLabel);
    expect(html).toContain(data.manageUrl);
    expect(html).toContain("Maria Santos");
    // Amount is formatted, not a raw cents integer.
    expect(html).not.toContain("90000");
    expect(text).toContain("ABCD-1234");
  });

  it("reminder is distinct from the confirmation but shares the details", () => {
    const reminder = bookingReminderEmail(data);
    const confirm = bookingConfirmationEmail(data);
    expect(reminder.subject).toContain("Reminder");
    expect(reminder.subject).not.toBe(confirm.subject);
    expect(reminder.html).toContain(data.manageUrl);
    expect(reminder.html).toContain("Court 1");
  });

  it("produces a plain-text alternative alongside the HTML", () => {
    const { html, text } = bookingConfirmationEmail(data);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(text).not.toContain("<");
  });
});
