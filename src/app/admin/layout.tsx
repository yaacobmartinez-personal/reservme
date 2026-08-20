import type { Metadata } from "next";
import Link from "next/link";
import { AdminNavLinks } from "./nav-links";
import { AdminSignOut } from "./admin-sign-out";

export const metadata: Metadata = {
  title: { default: "Platform", template: "%s · ReservMe platform" },
  robots: { index: false, follow: false },
};

/**
 * Platform console shell — a fixed sidebar on desktop, a compact top bar +
 * horizontal nav on mobile, mirroring the owner app. Impersonation runs on the
 * app host now (see /api/impersonate), so nothing venue-specific lives here.
 */
export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <div className="flex min-h-full">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-rule bg-paper-2 lg:flex">
        <div className="px-5 py-5">
          <Link href="/" className="font-display text-lg">
            ReservMe <span className="text-ink-3">platform</span>
          </Link>
        </div>
        <div className="flex-1 px-3">
          <AdminNavLinks orientation="vertical" />
        </div>
        <div className="border-t border-rule p-3">
          <AdminSignOut className="w-full" />
        </div>
      </aside>

      {/* Main column (offset by the sidebar on desktop) */}
      <div className="flex min-w-0 flex-1 flex-col lg:pl-60">
        {/* Mobile top bar + nav */}
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-rule bg-paper-2/95 px-4 py-3 backdrop-blur lg:hidden">
          <Link href="/" className="shrink-0 font-display text-lg">
            ReservMe <span className="text-ink-3">platform</span>
          </Link>
          <div className="ml-auto">
            <AdminSignOut className="h-9 px-3.5 text-[0.8125rem]" />
          </div>
        </header>
        <div className="overflow-x-auto border-b border-rule bg-paper-2 px-3 py-2 lg:hidden">
          <AdminNavLinks orientation="horizontal" />
        </div>

        {children}
      </div>
    </div>
  );
}
