import { headers } from "next/headers";
import Link from "next/link";
import { Wordmark } from "@/components/marketing/wordmark";
import { auth } from "@/lib/auth";
import { getBillingState } from "@/lib/billing";
import { formatMoney } from "@/lib/money";
import { currentVenue } from "@/lib/tenancy";
import { BillingBanner } from "./billing-banner";
import { AppNavLinks } from "./nav-links";
import { SignOutButton } from "./sign-out-button";
import { VerifyBanner } from "./verify-banner";

export const dynamic = "force-dynamic";

/**
 * App shell: a fixed sidebar on desktop, a compact top bar + horizontal nav on
 * mobile. Rendered only when there's an active venue, so the login page (no
 * session) stays bare.
 */
export default async function AppLayout({ children }: LayoutProps<"/app">) {
  const venue = await currentVenue();

  if (!venue) return <>{children}</>;

  // Soft email-verification nudge. Skipped while a platform admin is
  // impersonating — that banner would be about the admin, not the venue.
  const session = venue.impersonatedBy
    ? null
    : await auth.api.getSession({ headers: await headers() });
  const verifyBanner =
    session?.user && !session.user.emailVerified ? (
      <VerifyBanner email={session.user.email} />
    ) : null;

  // Billing nudge (skipped while impersonating — it's the venue's bill, not the
  // admin's). Amount is null for the multi-site quote band.
  const billingBanner = await (async () => {
    if (venue.impersonatedBy) return null;
    const state = await getBillingState(venue.organizationId);
    const price = state.amountDueCents !== null ? formatMoney(state.amountDueCents, "PHP") : null;
    if (state.pendingPayment) {
      return <BillingBanner kind="review" message="Payment received — under review. We’ll confirm shortly." />;
    }
    if (state.dueNow) {
      return (
        <BillingBanner
          kind="due"
          message={
            price
              ? `Your free month has ended — pay ${price} to keep everything running.`
              : "Your free month has ended — contact us to arrange billing."
          }
        />
      );
    }
    if (state.status === "trialing" && (state.daysLeftInTrial ?? 99) <= 5) {
      const left = state.daysLeftInTrial ?? 0;
      return (
        <BillingBanner
          kind="trial"
          message={`Your free month ends in ${left} day${left === 1 ? "" : "s"}${price ? ` — ${price}/mo after` : ""}.`}
        />
      );
    }
    return null;
  })();

  const impersonation = venue.impersonatedBy ? (
    <div className="bg-clay text-paper">
      <div className="px-5 py-2 text-[0.8125rem] sm:px-8">
        You are viewing this venue as a platform admin. Changes you make are real
        and are recorded.
      </div>
    </div>
  ) : null;

  return (
    <div className="flex min-h-full">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-rule bg-paper-2 lg:flex">
        <div className="px-5 py-5">
          <Link href="/" className="inline-block">
            <Wordmark />
          </Link>
        </div>
        <div className="flex-1 px-3">
          <AppNavLinks orientation="vertical" />
        </div>
        <div className="border-t border-rule p-3">
          <p className="truncate px-2 pb-2 text-[0.8125rem] text-ink-3">{venue.name}</p>
          <SignOutButton className="w-full" />
        </div>
      </aside>

      {/* Main column (offset by the sidebar on desktop) */}
      <div className="flex min-w-0 flex-1 flex-col lg:pl-60">
        {/* Mobile top bar + nav */}
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-rule bg-paper-2/95 px-4 py-3 backdrop-blur lg:hidden">
          <Link href="/" className="shrink-0">
            <Wordmark />
          </Link>
          <span className="ml-auto max-w-[9rem] truncate text-[0.8125rem] text-ink-3">
            {venue.name}
          </span>
          <SignOutButton className="h-9 px-3.5 text-[0.875rem]" />
        </header>
        <div className="overflow-x-auto border-b border-rule bg-paper-2 px-3 py-2 lg:hidden">
          <AppNavLinks orientation="horizontal" />
        </div>

        {impersonation}
        {verifyBanner}
        {billingBanner}
        {children}
      </div>
    </div>
  );
}
