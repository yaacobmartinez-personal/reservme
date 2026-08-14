import Link from "next/link";
import { Wordmark } from "@/components/marketing/wordmark";
import { currentVenue } from "@/lib/tenancy";
import { AppNavLinks } from "./nav-links";
import { SignOutButton } from "./sign-out-button";

export const dynamic = "force-dynamic";

/**
 * Shared chrome for the owner dashboard. The nav is rendered only when there
 * is an active venue, so the login page (which has no session) stays bare.
 */
export default async function AppLayout({ children }: LayoutProps<"/app">) {
  const venue = await currentVenue();

  if (!venue) return <>{children}</>;

  return (
    <>
      <header className="border-b border-rule bg-paper-2">
        <div className="shell flex items-center gap-4 py-3.5">
          <Link href="/" className="shrink-0">
            <Wordmark />
          </Link>
          <AppNavLinks />
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden max-w-[12rem] truncate text-[0.875rem] text-ink-3 sm:block">
              {venue.name}
            </span>
            <SignOutButton />
          </div>
        </div>
      </header>

      {venue.impersonatedBy ? (
        <div className="bg-clay text-paper">
          <div className="shell py-2 text-[0.8125rem]">
            You are viewing this venue as a platform admin. Changes you make are
            real and are recorded.
          </div>
        </div>
      ) : null}

      {children}
    </>
  );
}
