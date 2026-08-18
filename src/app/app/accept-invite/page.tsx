import type { Metadata } from "next";
import Link from "next/link";
import { Wordmark } from "@/components/marketing/wordmark";
import { getInvitationView } from "@/lib/team";
import { AcceptPanel } from "./accept-panel";

export const metadata: Metadata = { title: "Accept invitation" };
export const dynamic = "force-dynamic";

/** Kept out of the component body so the render stays pure (no Date.now there). */
function notExpired(expiresAt: Date): boolean {
  return expiresAt.getTime() > Date.now();
}

export default async function AcceptInvitePage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const { id } = await searchParams;
  const invite = id ? await getInvitationView(id) : null;
  const valid = invite !== null && invite.status === "pending" && notExpired(invite.expiresAt);

  return (
    <main className="flex flex-1 items-center justify-center py-16">
      <div className="shell max-w-md">
        <Wordmark className="text-lg" />
        {valid ? (
          <>
            <h1 className="mt-8 text-head">Join {invite.organizationName}</h1>
            <p className="mt-3 text-[0.9375rem] text-ink-2">
              You&rsquo;ve been invited as {invite.role}. Sign in or create an account
              for <span className="font-medium text-ink">{invite.email}</span> to accept.
            </p>
            <div className="mt-8 rounded-xl border border-rule bg-card p-6 shadow-float sm:p-8">
              <AcceptPanel
                invitationId={id!}
                orgName={invite.organizationName}
                email={invite.email}
              />
            </div>
          </>
        ) : (
          <>
            <h1 className="mt-8 text-head">Invitation not available</h1>
            <p className="mt-3 text-[0.9375rem] text-ink-2">
              This invitation may have expired or already been used. Ask the venue to
              send a new one.
            </p>
            <Link href="/login" className="mt-6 inline-block text-[0.9375rem] text-accent hover:underline">
              Go to sign in
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
