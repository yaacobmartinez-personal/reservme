"use client";

import { useRouter } from "next/navigation";

/**
 * Native date picker that jumps the booking view to any day within the venue's
 * horizon. Navigates on change, preserving the selected space. Server-rendered
 * links handle the week strip; this handles "go straight to a date".
 */
export function DateJump({
  basePath,
  spaceSlug,
  value,
  min,
  max,
}: {
  basePath: string;
  spaceSlug: string;
  value: string;
  min: string;
  max: string;
}) {
  const router = useRouter();
  return (
    <label className="flex items-center gap-2 text-[0.8125rem] text-ink-3">
      <span>Jump to a date</span>
      <input
        type="date"
        value={value}
        min={min}
        max={max}
        onChange={(e) => {
          const date = e.target.value;
          if (date) {
            const query = new URLSearchParams({ space: spaceSlug, date });
            router.push(`${basePath}?${query}`);
          }
        }}
        className="h-9 rounded-sm border border-rule bg-card px-2 text-[0.8125rem] text-ink"
      />
    </label>
  );
}
