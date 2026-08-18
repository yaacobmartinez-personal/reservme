import type { Metadata } from "next";
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

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const venue = await requireVenue();
  const today = localToday(venue.timezone);
  const sp = await searchParams;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : today;

  const day = await getCalendarDay(venue.organizationId, venue.timezone, date);

  return (
    <CalendarClient day={day} date={date} today={today} currency={venue.currency} />
  );
}
