import type { Metadata } from "next";
import Link from "next/link";
import { currentImpersonation } from "@/lib/admin/impersonation";
import { stopImpersonating } from "./actions";

export const metadata: Metadata = {
  title: { default: "Platform", template: "%s · ReservMe platform" },
  robots: { index: false, follow: false },
};

/**
 * The banner is not decoration. An admin who forgets they are impersonating is
 * one click from "fixing" the wrong venue's schedule, so it is rendered above
 * everything, on every page, for as long as the session is open.
 */
export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const impersonation = await currentImpersonation();

  return (
    <>
      {impersonation ? (
        <div className="sticky top-0 z-50 bg-clay text-paper">
          <div className="shell flex flex-wrap items-center gap-x-4 gap-y-2 py-2.5">
            <span className="label">Viewing as</span>
            <span className="min-w-0 flex-1 truncate text-[0.9375rem] font-medium">
              {impersonation.organizationName}
            </span>
            <span className="font-mono text-[0.75rem] opacity-80">
              until{" "}
              {new Intl.DateTimeFormat("en-PH", {
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
              }).format(impersonation.expiresAt)}
            </span>
            <form action={stopImpersonating}>
              <button
                type="submit"
                className="whitespace-nowrap rounded-pill bg-paper px-3.5 py-1.5 text-[0.8125rem] font-medium text-clay-ink transition-opacity duration-[--dur-fast] ease-out hover:opacity-85"
              >
                Stop viewing
              </button>
            </form>
          </div>
        </div>
      ) : null}

      <header className="border-b border-rule bg-paper-2">
        <div className="shell flex items-center gap-6 py-4">
          <Link href="/" className="font-display text-lg">
            ReservMe <span className="text-ink-3">platform</span>
          </Link>
          <nav aria-label="Platform" className="flex gap-1">
            {[
              { href: "/", label: "Tenants" },
              { href: "/audit", label: "Audit log" },
            ].map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-pill px-3 py-1.5 text-[0.9375rem] text-ink-2 transition-colors duration-[--dur-fast] ease-out hover:bg-paper-3 hover:text-ink"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      {children}
    </>
  );
}
