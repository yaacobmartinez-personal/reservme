"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Today" },
  { href: "/spaces", label: "Spaces" },
  { href: "/settings", label: "Settings" },
] as const;

export function AppNavLinks() {
  const pathname = usePathname();

  return (
    <nav aria-label="Dashboard" className="flex gap-1">
      {LINKS.map((link) => {
        const active =
          link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={[
              "rounded-pill px-3 py-1.5 text-[0.9375rem] transition-colors duration-[--dur-fast] ease-out",
              active ? "bg-ink text-paper" : "text-ink-2 hover:bg-paper-3 hover:text-ink",
            ].join(" ")}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
