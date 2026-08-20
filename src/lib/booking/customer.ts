import { sql } from "@/db";
import { withContentionRetry } from "./errors";

export type CustomerDetails = {
  name: string;
  email: string;
  phone?: string;
};

/**
 * Finds or creates the customer record for this venue. Customers are per-org
 * and never users — no password, no account, and the same email at two venues
 * is two unrelated records.
 *
 * Pass a transaction handle as `tx` to run inside a booking transaction;
 * defaults to the shared connection for standalone callers (e.g. the waitlist).
 */
export async function upsertCustomer(
  organizationId: string,
  details: CustomerDetails,
  tx: typeof sql = sql,
): Promise<string> {
  const email = details.email.trim().toLowerCase();
  const name = details.name.trim();
  const phone = details.phone?.trim() || null;

  // Read before writing, and use DO NOTHING rather than DO UPDATE.
  //
  // `ON CONFLICT DO UPDATE` uses speculative insertion and takes a row lock;
  // twenty-odd of them landing on one unique index at once deadlock freely,
  // even though every row is a different customer. Retrying that is treating
  // the symptom. The overwhelmingly common case is a returning customer, which
  // this resolves with a plain SELECT and no write at all.
  return await withContentionRetry(async () => {
    const [existing] = await tx<{ id: string; name: string; phone: string | null }[]>`
      SELECT id, name, phone FROM customer
      WHERE organization_id = ${organizationId} AND email = ${email}
    `;

    if (existing) {
      // Only write when something actually changed, so a regular booking the
      // same court every week costs zero writes here.
      if (existing.name !== name || (phone !== null && existing.phone !== phone)) {
        await tx`
          UPDATE customer
             SET name = ${name}, phone = COALESCE(${phone}, phone)
           WHERE id = ${existing.id}::uuid
        `;
      }
      return existing.id;
    }

    const [inserted] = await tx<{ id: string }[]>`
      INSERT INTO customer (organization_id, name, email, phone)
      VALUES (${organizationId}, ${name}, ${email}, ${phone})
      ON CONFLICT (organization_id, email) DO NOTHING
      RETURNING id
    `;

    if (inserted) return inserted.id;

    // Someone else created this customer between our SELECT and INSERT.
    const [raced] = await tx<{ id: string }[]>`
      SELECT id FROM customer
      WHERE organization_id = ${organizationId} AND email = ${email}
    `;
    return raced.id;
  });
}
