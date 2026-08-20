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
    label: "Tenants",
    icon: (
      <Icon
        path={
          <>
            <path d="M3 17V8l7-4 7 4v9" {...stroke} />
            <path d="M3 17h14M8 17v-4h4v4" {...stroke} />
          </>
        }
      />
    ),
  },
  {
    href: "/billing",
    label: "Billing",
    icon: (
      <Icon
        path={
          <>
            <rect x="2.5" y="4.5" width="15" height="11" rx="2" {...stroke} />
            <path d="M2.5 8.5h15M6 12.5h3" {...stroke} />
          </>
        }
      />
    ),
  },
  {
    href: "/audit",
    label: "Audit log",
    icon: (
      <Icon
        path={
          <>
            <path d="M4 5h12M4 10h12M4 15h7" {...stroke} />
            <circle cx="15.5" cy="15" r="2.5" {...stroke} />
          </>
        }
      />
    ),
  },
] as const;

export function AdminNavLinks({
  orientation = "vertical",
}: {
  orientation?: "vertical" | "horizontal";
}) {
  const pathname = usePathname();
  const vertical = orientation === "vertical";

  return (
    <nav
      aria-label="Platform"
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
              active ? "bg-ink text-paper" : "text-ink-2 hover:bg-paper-3 hover:text-ink",
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
