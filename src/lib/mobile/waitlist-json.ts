import { listWaitlist } from "@/lib/booking/waitlist";

/**
 * The waitlist, shaped for the app (API-CONTRACT #23).
 *
 * Read-only in v1, exactly as the web page is: the queue moves when a booking
 * is cancelled and `promoteWaitlist` emails the earliest match, not when
 * somebody taps something here.
 *
 * `claimExpiresAt` is always null, and that is not an oversight. The app draws
 * a countdown on a notified entry, but the server has no claim window — being
 * notified is an email with a booking link, and whoever books first wins. A
 * deadline the server does not enforce would be a promise the venue could not
 * keep, so the field stays null until there is something real behind it.
 */
export async function waitlistEntries(organizationId: string, timezone: string) {
  const entries = await listWaitlist(organizationId, timezone);
  return entries.map((e) => ({
    id: e.id,
    customerName: e.customerName,
    customerEmail: e.customerEmail,
    customerPhone: e.customerPhone,
    spaceName: e.spaceName,
    startsAt: e.startsAt.toISOString(),
    endsAt: e.endsAt.toISOString(),
    whenLabel: `${e.dayLabel} · ${e.timeLabel}`,
    status: e.status,
    createdAt: e.createdAt.toISOString(),
    notifiedAt: e.notifiedAt?.toISOString() ?? null,
    claimExpiresAt: null,
  }));
}
