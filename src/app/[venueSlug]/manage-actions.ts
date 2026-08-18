"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { clientIp } from "@/lib/abuse";
import { getBookingForCancel } from "@/lib/booking/manage";
import { cancelReservation, moveReservation } from "@/lib/booking/reserve";
import { BookingError } from "@/lib/booking/errors";
import { promoteWaitlistForReservation } from "@/lib/booking/waitlist";
import { rateLimit } from "@/lib/rate-limit";

/**
 * Customer-facing cancel. Anonymous — the manage token is the capability — so it
 * is rate-limited by IP, and cancellation eligibility is re-derived server-side
 * from the venue policy (never trusting the page that rendered the button).
 */

export type CancelResult = { ok: true } | { ok: false; error: string };

export async function cancelBooking(formData: FormData): Promise<CancelResult> {
  const slug = String(formData.get("slug") ?? "");
  const token = String(formData.get("token") ?? "");

  const ip = clientIp(await headers());
  const limit = await rateLimit(`cancel:ip:${ip}`, 10, 60);
  if (!limit.allowed) {
    return { ok: false, error: "Too many attempts — please try again in a minute." };
  }

  const booking = await getBookingForCancel(slug, token);
  if (!booking) return { ok: false, error: "We couldn't find that booking." };
  if (!booking.eligibility.canCancel) {
    return { ok: false, error: booking.eligibility.reason ?? "This booking can't be cancelled." };
  }

  try {
    await cancelReservation(booking.organizationId, booking.reservationId);
    // The freed slot may have someone waiting — notify the first in line.
    await promoteWaitlistForReservation(booking.organizationId, booking.reservationId);
  } catch (error) {
    // Already gone (e.g. a double click) — the page will render the cancelled
    // state, which is the outcome the customer wanted anyway.
    if (!(error instanceof BookingError)) throw error;
  }

  revalidatePath(`/${slug}/manage/${token}`);
  return { ok: true };
}

export async function rescheduleBooking(formData: FormData): Promise<CancelResult> {
  const slug = String(formData.get("slug") ?? "");
  const token = String(formData.get("token") ?? "");
  const startsAt = new Date(String(formData.get("startsAt") ?? ""));

  const ip = clientIp(await headers());
  const limit = await rateLimit(`reschedule:ip:${ip}`, 10, 60);
  if (!limit.allowed) {
    return { ok: false, error: "Too many attempts — please try again in a minute." };
  }
  if (Number.isNaN(startsAt.getTime())) return { ok: false, error: "Please pick a valid time." };

  const booking = await getBookingForCancel(slug, token);
  if (!booking) return { ok: false, error: "We couldn't find that booking." };
  if (!booking.eligibility.canCancel) {
    return { ok: false, error: booking.eligibility.reason ?? "This booking can't be changed." };
  }

  try {
    // staff:false → the new slot must pass the same notice/horizon as a fresh
    // public booking; an overlap is refused, not forced.
    await moveReservation(booking.organizationId, booking.reservationId, booking.spaceId, startsAt, {
      staff: false,
    });
  } catch (error) {
    if (error instanceof BookingError) return { ok: false, error: error.message };
    throw error;
  }

  revalidatePath(`/${slug}/manage/${token}`);
  return { ok: true };
}
