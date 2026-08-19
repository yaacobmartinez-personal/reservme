"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  cancelReservation,
  markCheckedIn,
  markNoShow,
  undoCheckIn,
} from "@/lib/booking/reserve";
import { promoteWaitlistForReservation } from "@/lib/booking/waitlist";
import { emitBookingEvent } from "@/lib/webhooks";
import { requireVenue } from "@/lib/tenancy";

/**
 * Day-to-day run-sheet actions. Any staff member can run the day — these use
 * requireVenue (membership) rather than requireRole, unlike the structural
 * edits in actions.ts. Every one resolves the org from the session and scopes
 * the write to it.
 */

const reservationId = z.string().uuid();

export async function checkInBooking(formData: FormData) {
  const venue = await requireVenue();
  const id = reservationId.parse(formData.get("reservationId"));
  await markCheckedIn(venue.organizationId, id);
  revalidatePath("/");
}

export async function undoCheckInBooking(formData: FormData) {
  const venue = await requireVenue();
  const id = reservationId.parse(formData.get("reservationId"));
  await undoCheckIn(venue.organizationId, id);
  revalidatePath("/");
}

export async function noShowBooking(formData: FormData) {
  const venue = await requireVenue();
  const id = reservationId.parse(formData.get("reservationId"));
  await markNoShow(venue.organizationId, id);
  revalidatePath("/");
}

export async function cancelBooking(formData: FormData) {
  const venue = await requireVenue();
  const id = reservationId.parse(formData.get("reservationId"));
  await cancelReservation(venue.organizationId, id);
  await emitBookingEvent(venue.organizationId, "booking.cancelled", id);
  await promoteWaitlistForReservation(venue.organizationId, id);
  revalidatePath("/");
  revalidatePath("/calendar");
}
