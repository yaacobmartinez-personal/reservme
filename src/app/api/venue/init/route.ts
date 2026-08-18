import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { sql } from "@/db";
import { auth } from "@/lib/auth";
import { captureException } from "@/lib/observability";

/**
 * Creates the venue row for an organisation just created through Better Auth.
 *
 * The organisation table belongs to the auth plugin and only carries name and
 * slug; timezone, currency and booking policy are ours. Defaults are Philippine
 * because that is who this is for — a venue can change them in settings.
 */
export async function POST() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  try {
    // The organisation is read from the user's membership, never from the
    // request body — otherwise anyone could initialise someone else's venue.
    const [membership] = await sql<{ organization_id: string }[]>`
      SELECT m.organization_id
      FROM member m
      WHERE m.user_id = ${session.user.id}
      ORDER BY m.created_at DESC
      LIMIT 1
    `;

    if (!membership) {
      return NextResponse.json({ error: "No venue to set up" }, { status: 404 });
    }

    await sql`
      INSERT INTO venue (organization_id)
      VALUES (${membership.organization_id})
      ON CONFLICT (organization_id) DO NOTHING
    `;

    // Start the free month at signup. One calendar month, matching the backfill
    // in 0004 and what the billing page displays.
    await sql`
      INSERT INTO subscription (organization_id, status, trial_ends_at)
      VALUES (${membership.organization_id}, 'trialing', now() + interval '1 month')
      ON CONFLICT (organization_id) DO NOTHING
    `;

    return NextResponse.json({ ok: true });
  } catch (error) {
    captureException(error, { where: "venue.init", userId: session.user.id });
    return NextResponse.json({ error: "Setup failed" }, { status: 500 });
  }
}
