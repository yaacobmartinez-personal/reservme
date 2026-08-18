import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { Wordmark } from "@/components/marketing/wordmark";

export const metadata: Metadata = { title: "Verify email" };
export const dynamic = "force-dynamic";

/**
 * Landing after Better Auth's verify-email endpoint runs. It redirects here on
 * success (no error) or with an `error` query when the token was bad/expired.
 */
export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const ok = !(await searchParams).error;

  return (
    <main className="flex flex-1 items-center justify-center py-16">
      <div className="shell max-w-md text-center">
        <Wordmark className="text-lg" />
        <div className="mt-8 rounded-xl border border-rule bg-card p-8 shadow-float">
          {ok ? (
            <>
              <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-accent-soft text-accent-ink">
                <svg viewBox="0 0 24 24" className="size-6" aria-hidden="true">
                  <path d="M5 13l4 4 10-10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <h1 className="mt-5 text-2xl font-medium">Email verified</h1>
              <p className="mt-2 text-[0.9375rem] text-ink-2">
                Thanks — your email is confirmed. You&rsquo;re all set.
              </p>
              <ButtonLink href="/" size="lg" className="mt-6">
                Go to dashboard
              </ButtonLink>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-medium">We couldn&rsquo;t verify that link</h1>
              <p className="mt-2 text-[0.9375rem] text-ink-2">
                It may have expired or already been used. Log in and resend the
                link from the banner at the top of your dashboard.
              </p>
              <Link
                href="/login"
                className="mt-6 inline-block text-[0.9375rem] text-accent hover:underline"
              >
                Log in
              </Link>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
