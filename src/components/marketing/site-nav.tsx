"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ButtonLink } from "@/components/ui/button";
import { Wordmark } from "@/components/marketing/wordmark";
import { NAV_LINKS } from "@/content/marketing";

/** N5 — floating pill. Detached from the page edge, opaque once you scroll. */
export function SiteNav() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const close = useCallback(() => setMenuOpen(false), []);

  useEffect(() => {
    if (!menuOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };

    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [menuOpen, close]);

  return (
    <header className="fixed inset-x-0 top-0 z-50 pt-3 sm:pt-5">
      <div className="shell">
        <nav
          aria-label="Primary"
          className={[
            "flex items-center gap-3 rounded-pill border py-2 pl-4 pr-2 sm:pl-6 sm:pr-3",
            "transition-[background-color,border-color,box-shadow] duration-[--dur-base] ease-out",
            scrolled
              ? "border-rule bg-card/88 shadow-float backdrop-blur-xl"
              : "border-transparent bg-card/0",
          ].join(" ")}
        >
          <Link
            href="/"
            onClick={close}
            className="rounded-sm text-[0.95rem] transition-opacity duration-[--dur-fast] ease-out hover:opacity-70"
          >
            <Wordmark />
            <span className="sr-only">— home</span>
          </Link>

          <ul className="ml-auto hidden items-center gap-1 md:flex">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="inline-flex h-9 items-center whitespace-nowrap rounded-pill px-3.5 text-[0.9375rem] text-ink-2 transition-colors duration-[--dur-fast] ease-out hover:bg-paper-3 hover:text-ink"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>

          <div className="ml-auto flex items-center gap-1 md:ml-2">
            <Link
              href="/login"
              className="hidden h-9 items-center whitespace-nowrap rounded-pill px-3.5 text-[0.9375rem] text-ink-2 transition-colors duration-[--dur-fast] ease-out hover:bg-paper-3 hover:text-ink sm:inline-flex"
            >
              Log in
            </Link>
            <ButtonLink href="/signup" className="h-9 px-4 text-[0.9375rem]">
              Start free
            </ButtonLink>

            <button
              type="button"
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              aria-expanded={menuOpen}
              aria-controls="nav-sheet"
              onClick={() => setMenuOpen((open) => !open)}
              className="ml-1 inline-flex size-9 items-center justify-center rounded-pill text-ink transition-colors duration-[--dur-fast] ease-out hover:bg-paper-3 md:hidden"
            >
              <svg viewBox="0 0 20 20" aria-hidden="true" className="size-5">
                {menuOpen ? (
                  <path
                    d="m5 5 10 10M15 5 5 15"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  />
                ) : (
                  <path
                    d="M3 6h14M3 13h14"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  />
                )}
              </svg>
            </button>
          </div>
        </nav>

        {menuOpen ? (
          <div
            id="nav-sheet"
            className="mt-2 rounded-lg border border-rule bg-card p-2 shadow-float md:hidden"
          >
            <ul>
              {[...NAV_LINKS, { label: "Log in", href: "/login" }].map((link) => (
                <li key={link.label}>
                  <Link
                    href={link.href}
                    onClick={close}
                    className="flex h-11 items-center whitespace-nowrap rounded-sm px-3 text-[0.9375rem] text-ink-2 transition-colors duration-[--dur-fast] ease-out hover:bg-paper-3 hover:text-ink"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </header>
  );
}
