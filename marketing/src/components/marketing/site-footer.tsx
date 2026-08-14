import Link from "next/link";
import { Wordmark } from "@/components/marketing/wordmark";
import { FOOTER_GROUPS, SITE } from "@/content/marketing";

/** Ft5 — statement-led. The links are secondary and stay that way. */
export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-rule bg-paper-2 pt-16 pb-10 sm:pt-20">
      <div className="shell">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-20">
          <div>
            <Wordmark className="text-lg" />
            <p className="mt-6 max-w-[26rem] text-sub leading-relaxed text-ink-2 text-pretty">
              Booking software for the places people show up to. Your brand, your
              link, your calendar — full.
            </p>
          </div>

          <nav
            aria-label="Footer"
            className="grid grid-cols-2 gap-x-8 gap-y-10 sm:grid-cols-3"
          >
            {FOOTER_GROUPS.map((group) => (
              <div key={group.heading}>
                <h2 className="label font-sans text-ink-3">{group.heading}</h2>
                <ul className="mt-4 space-y-2.5">
                  {group.links.map((link) => (
                    <li key={link.label}>
                      <Link
                        href={link.href}
                        className="inline-block whitespace-nowrap rounded-xs text-[0.9375rem] text-ink-2 transition-colors duration-[--dur-fast] ease-out hover:text-accent"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        <div className="mt-16 flex flex-col gap-3 border-t border-rule pt-8 text-[0.8125rem] text-ink-3 sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {new Date().getFullYear()} {SITE.name}. All rights reserved.
          </p>
          <nav aria-label="Legal" className="flex flex-wrap gap-x-5 gap-y-2">
            <Link href="/privacy" className="hover:text-accent">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-accent">
              Terms
            </Link>
          </nav>
        </div>
      </div>
    </footer>
  );
}
