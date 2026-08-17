"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * The list's filter bar. Server-rendered results, client-driven URL: every
 * control writes the filter into the query string and lets the page re-render
 * from searchParams (same model as the dashboard range selector). Any change
 * returns to page 1.
 */

const SEGMENTS = [
  { key: "all", label: "All" },
  { key: "new", label: "New" },
  { key: "at_risk", label: "At-risk" },
  { key: "no_shows", label: "No-shows" },
] as const;

const SORTS = [
  { key: "recent", label: "Recently added" },
  { key: "name", label: "Name (A–Z)" },
  { key: "bookings", label: "Most bookings" },
  { key: "value", label: "Highest value" },
  { key: "last_visit", label: "Last visit" },
] as const;

export function CustomerFilters({ tags }: { tags: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const segment = params.get("segment") ?? "all";
  const tag = params.get("tag") ?? "";
  const sort = params.get("sort") ?? "recent";

  const [q, setQ] = useState(params.get("q") ?? "");

  function push(overrides: Record<string, string>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(overrides)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    next.delete("page"); // any filter change returns to the first page
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  // Debounce the search box so we don't push a navigation per keystroke.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => push({ q }), 300);
    return () => clearTimeout(t);
    // push closes over the current params, which is the intended behaviour here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const control =
    "h-10 rounded-sm border border-rule bg-paper-2 px-3 text-[0.875rem] text-ink-2";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <svg
            viewBox="0 0 20 20"
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3"
          >
            <circle cx="9" cy="9" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path d="M13.5 13.5L17 17" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, email, phone"
            aria-label="Search customers"
            className="h-10 w-full rounded-sm border border-rule bg-paper-2 pl-9 pr-3 text-[0.875rem]"
          />
        </div>

        <select
          value={tag}
          onChange={(e) => push({ tag: e.target.value })}
          aria-label="Filter by tag"
          className={control}
          disabled={tags.length === 0}
        >
          <option value="">All tags</option>
          {tags.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>

        <select
          value={sort}
          onChange={(e) => push({ sort: e.target.value === "recent" ? "" : e.target.value })}
          aria-label="Sort customers"
          className={`${control} ml-auto`}
        >
          {SORTS.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {SEGMENTS.map((s) => {
          const active = segment === s.key || (s.key === "all" && segment === "all");
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => push({ segment: s.key === "all" ? "" : s.key })}
              aria-pressed={active}
              className={[
                "rounded-pill px-3.5 py-1.5 text-[0.8125rem] transition-colors duration-[--dur-fast] ease-out",
                active
                  ? "bg-ink text-paper"
                  : "border border-rule text-ink-2 hover:border-rule-strong hover:text-ink",
              ].join(" ")}
            >
              {s.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
