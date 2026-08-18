"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { sql } from "@/db";
import { clientIp } from "@/lib/abuse";
import { joinWaitlist } from "@/lib/booking/waitlist";
import { rateLimit } from "@/lib/rate-limit";

export type JoinResult = { ok: true; already: boolean } | { ok: false; error: string };

export async function joinWaitlistAction(formData: FormData): Promise<JoinResult> {
  const parsed = z
    .object({
      venueSlug: z.string().min(1),
      spaceId: z.string().uuid(),
      startsAt: z.string(),
      endsAt: z.string(),
      name: z.string().trim().min(1, "Please give your name.").max(120),
      email: z.string().trim().toLowerCase().email("Please give a valid email."),
      phone: z.string().trim().max(40).optional(),
    })
    .safeParse({
      venueSlug: formData.get("venueSlug"),
      spaceId: formData.get("spaceId"),
      startsAt: formData.get("startsAt"),
      endsAt: formData.get("endsAt"),
      name: formData.get("name"),
      email: formData.get("email"),
      phone: formData.get("phone") ?? undefined,
    });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }
  const d = parsed.data;

  const ip = clientIp(await headers());
  const limit = await rateLimit(`waitlist:ip:${ip}`, 10, 60);
  if (!limit.allowed) return { ok: false, error: "Too many attempts — please try again shortly." };

  // Resolve the org from the slug and confirm the space belongs to it.
  const [space] = await sql<{ organization_id: string }[]>`
    SELECT s.organization_id
    FROM space s JOIN organization o ON o.id = s.organization_id
    WHERE s.id = ${d.spaceId}::uuid AND o.slug = ${d.venueSlug}
  `;
  if (!space) return { ok: false, error: "That space no longer exists." };

  const startsAt = new Date(d.startsAt);
  const endsAt = new Date(d.endsAt);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
    return { ok: false, error: "That slot isn't valid." };
  }

  const result = await joinWaitlist({
    organizationId: space.organization_id,
    spaceId: d.spaceId,
    startsAt,
    endsAt,
    customer: { name: d.name, email: d.email, phone: d.phone },
  });
  return { ok: true, already: result.already };
}
