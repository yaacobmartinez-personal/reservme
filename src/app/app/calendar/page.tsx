import type { Metadata } from "next";
import { sql } from "@/db";
import { getCalendarDay } from "@/lib/calendar";
import { requireVenue } from "@/lib/tenancy";
import { CalendarClient } from "./calendar-client";

export const metadata: Metadata = { title: "Calendar" };
export const dynamic = "force-dynamic";

/** Today's date in the venue's own zone, as YYYY-MM-DD (en-CA gives that shape). */
function localToday(timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; newFor?: string }>;
}) {
  const venue = await requireVenue();
  const today = localToday(venue.timezone);
  const sp = await searchParams;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : today;

  // Deep-link from a customer's "New booking" button: prefill the panel. Scoped
  // to the org, so a foreign id resolves to nothing rather than leaking a name.
  let initialBooking = null;
  if (sp.newFor && UUID.test(sp.newFor)) {
    const [c] = await sql<{ id: string; name: string; email: string; phone: string | null }[]>`
      SELECT id, name, email, phone FROM customer
      WHERE id = ${sp.newFor}::uuid AND organization_id = ${venue.organizationId}
    `;
    if (c) initialBooking = c;
  }

  const day = await getCalendarDay(venue.organizationId, venue.timezone, date);

  return (
    <CalendarClient
      day={day}
      date={date}
      today={today}
      currency={venue.currency}
      initialBooking={initialBooking}
    />
  );
}
