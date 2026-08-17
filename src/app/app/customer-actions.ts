"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { sql } from "@/db";
import { auth } from "@/lib/auth";
import { requireVenue } from "@/lib/tenancy";

/**
 * Customer / CRM writes. Same contract as src/app/app/actions.ts:
 *   - organizationId comes from the session (requireVenue), never the form;
 *   - every write is scoped by organization_id, so one venue can't touch
 *     another's customers — the id in the form is validated against the org
 *     before anything is written;
 *   - these are day-to-day (notes, tags, fixing a phone number), so any staff
 *     member may run them — like the run-sheet actions, not owner-only.
 *
 * Email is deliberately NOT editable here (v1): it's the (organization_id,
 * email) identity key, and letting it change invites unique-constraint
 * collisions and breaks returning-customer matching. Name and phone only.
 */

const MAX_TAGS = 20;

const tagSchema = z
  .string()
  .trim()
  .min(1, "Tag can't be empty.")
  .max(30, "Keep tags under 30 characters.")
  .regex(/^[\p{L}\p{N} .&-]+$/u, "Tags can use letters, numbers, spaces and - . &");

/** The user actually performing the action (the admin, if impersonating). */
async function actingUserId(): Promise<string | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user?.id ?? null;
}

export async function addCustomerNote(formData: FormData) {
  const venue = await requireVenue();
  const customerId = z.string().uuid().parse(formData.get("customerId"));
  const body = z
    .string()
    .trim()
    .min(1, "Write something first.")
    .max(2000, "That note is too long.")
    .parse(formData.get("body"));

  const authorId = await actingUserId();

  // INSERT ... SELECT: the row is written only if the customer belongs to this
  // org, so ownership is enforced in the same statement as the write.
  const inserted = await sql`
    INSERT INTO customer_note (organization_id, customer_id, author_user_id, body)
    SELECT ${venue.organizationId}, c.id, ${authorId}, ${body}
    FROM customer c
    WHERE c.id = ${customerId}::uuid AND c.organization_id = ${venue.organizationId}
    RETURNING id
  `;
  if (inserted.length === 0) throw new Error("Customer not found.");

  revalidatePath(`/customers/${customerId}`);
}

export async function deleteCustomerNote(formData: FormData) {
  const venue = await requireVenue();
  const noteId = z.string().uuid().parse(formData.get("noteId"));
  const customerId = z.string().uuid().parse(formData.get("customerId"));

  await sql`
    DELETE FROM customer_note
    WHERE id = ${noteId}::uuid AND organization_id = ${venue.organizationId}
  `;

  revalidatePath(`/customers/${customerId}`);
}

export async function addCustomerTag(formData: FormData) {
  const venue = await requireVenue();
  const customerId = z.string().uuid().parse(formData.get("customerId"));
  const tag = tagSchema.parse(formData.get("tag"));

  // Append only when absent (dedupe) and under the cap. Scoped to the org, so a
  // foreign id updates nothing.
  await sql`
    UPDATE customer
       SET tags = array_append(tags, ${tag})
     WHERE id = ${customerId}::uuid
       AND organization_id = ${venue.organizationId}
       AND NOT (tags @> ARRAY[${tag}]::text[])
       AND COALESCE(array_length(tags, 1), 0) < ${MAX_TAGS}
  `;

  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/customers");
}

export async function removeCustomerTag(formData: FormData) {
  const venue = await requireVenue();
  const customerId = z.string().uuid().parse(formData.get("customerId"));
  const tag = z.string().parse(formData.get("tag"));

  await sql`
    UPDATE customer
       SET tags = array_remove(tags, ${tag})
     WHERE id = ${customerId}::uuid
       AND organization_id = ${venue.organizationId}
  `;

  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/customers");
}

export async function updateCustomerContact(formData: FormData) {
  const venue = await requireVenue();
  const customerId = z.string().uuid().parse(formData.get("customerId"));
  const parsed = z
    .object({
      name: z.string().trim().min(1, "Name can't be empty.").max(120),
      phone: z
        .string()
        .trim()
        .max(40)
        .optional()
        .transform((v) => (v ? v : null)),
    })
    .parse({
      name: formData.get("name"),
      phone: formData.get("phone") ?? undefined,
    });

  await sql`
    UPDATE customer
       SET name = ${parsed.name}, phone = ${parsed.phone}
     WHERE id = ${customerId}::uuid
       AND organization_id = ${venue.organizationId}
  `;

  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/customers");
}
