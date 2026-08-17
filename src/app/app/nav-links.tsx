"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

function Icon({ path }: { path: ReactNode }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="size-[1.15rem] shrink-0">
      {path}
    </svg>
  );
}

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const LINKS = [
  {
    href: "/",
    label: "Today",
    icon: (
      <Icon
        path={
          <>
            <rect x="3" y="4" width="14" height="13" rx="2" {...stroke} />
            <path d="M3 8h14M7 3v3M13 3v3M7 12l2 2 4-4" {...stroke} />
          </>
        }
      />
    ),
  },
  {
    href: "/customers",
    label: "Customers",
    icon: (
      <Icon
        path={
          <>
            <circle cx="7" cy="7" r="2.75" {...stroke} />
            <path d="M2.5 16.5c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4" {...stroke} />
            <path d="M13 4.6a2.75 2.75 0 0 1 0 5.3M14.2 12.8c1.9.5 3.3 1.9 3.3 3.7" {...stroke} />
          </>
        }
      />
    ),
  },
  {
    href: "/spaces",
    label: "Spaces",
    icon: (
      <Icon
        path={
          <>
            <rect x="3" y="3" width="6" height="6" rx="1.5" {...stroke} />
            <rect x="11" y="3" width="6" height="6" rx="1.5" {...stroke} />
            <rect x="3" y="11" width="6" height="6" rx="1.5" {...stroke} />
            <rect x="11" y="11" width="6" height="6" rx="1.5" {...stroke} />
          </>
        }
      />
    ),
  },
  {
    href: "/settings",
    label: "Settings",
    icon: (
      <Icon
        path={
          <>
            <circle cx="10" cy="10" r="2.5" {...stroke} />
            <path
              d="M10 2.5v2M10 15.5v2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M2.5 10h2M15.5 10h2M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4"
              {...stroke}
            />
          </>
        }
      />
    ),
  },
] as const;

export function AppNavLinks({
  orientation = "vertical",
}: {
  orientation?: "vertical" | "horizontal";
}) {
  const pathname = usePathname();
  const vertical = orientation === "vertical";

  return (
    <nav
      aria-label="Dashboard"
      className={vertical ? "flex flex-col gap-1" : "flex gap-1"}
    >
      {LINKS.map((link) => {
        const active =
          link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={[
              "flex items-center gap-2.5 whitespace-nowrap transition-colors duration-[--dur-fast] ease-out",
              vertical
                ? "rounded-lg px-3 py-2 text-[0.9375rem]"
                : "rounded-pill px-3 py-1.5 text-[0.9375rem]",
              active
                ? "bg-ink text-paper"
                : "text-ink-2 hover:bg-paper-3 hover:text-ink",
            ].join(" ")}
          >
            {link.icon}
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
