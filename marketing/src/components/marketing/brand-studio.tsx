"use client";

import { useState, type CSSProperties } from "react";
import { BRANDING, SITE } from "@/content/marketing";

/** Keys map to --color-swatch-* tokens. No raw colour values live here. */
const SWATCHES = BRANDING.themes.map((name) => ({
  name,
  token: `var(--color-swatch-${name.toLowerCase()})`,
}));

export function BrandStudio() {
  const [active, setActive] = useState(SWATCHES[0]);

  return (
    <div
      style={{ "--brand": active.token } as CSSProperties}
      className="rounded-xl border border-rule bg-card p-6 shadow-float sm:p-8"
    >
      {/* Mini booking page, rendered in the selected brand colour. */}
      <div className="rounded-lg border border-rule bg-paper-2 p-5">
        <div className="flex items-center gap-3">
          <span
            className="grid size-10 shrink-0 place-items-center rounded-pill font-display text-lg text-paper transition-colors duration-[--dur-base] ease-out bg-[var(--brand)]"
            aria-hidden="true"
          >
            H
          </span>
          <span className="min-w-0">
            <span className="block truncate font-display text-lg leading-tight">
              Harbour Rooms
            </span>
            <span className="block truncate font-mono text-[0.75rem] text-ink-3">
              {SITE.bookingDomain}/harbour
            </span>
          </span>
        </div>

        <div className="mt-5 flex flex-wrap gap-1.5" aria-hidden="true">
          {["Room A", "Room B", "Room C"].map((room, index) => (
            <span
              key={room}
              className={[
                "rounded-pill px-3 py-1.5 text-[0.8125rem] transition-colors duration-[--dur-base] ease-out",
                index === 0
                  ? "text-paper bg-[var(--brand)]"
                  : "border border-rule bg-card text-ink-2",
              ].join(" ")}
            >
              {room}
            </span>
          ))}
        </div>

        <div
          aria-hidden="true"
          className="mt-4 flex h-11 items-center justify-center rounded-pill text-[0.9375rem] font-medium text-paper transition-colors duration-[--dur-base] ease-out bg-[var(--brand)]"
        >
          Reserve · 19:00
        </div>
      </div>

      <fieldset className="mt-6">
        <legend className="label text-ink-3">Theme</legend>
        <div className="mt-3 flex flex-wrap gap-2.5">
          {SWATCHES.map((swatch) => {
            const selected = swatch.name === active.name;
            return (
              <button
                key={swatch.name}
                type="button"
                onClick={() => setActive(swatch)}
                aria-pressed={selected}
                title={swatch.name}
                style={{ "--swatch": swatch.token } as CSSProperties}
                className={[
                  "size-9 rounded-pill border-2 bg-[var(--swatch)]",
                  "transition-[transform,box-shadow,border-color] duration-[--dur-base] ease-out",
                  "hover:-translate-y-0.5 hover:shadow-lift active:translate-y-0",
                  "motion-reduce:transform-none",
                  selected
                    ? "border-ink shadow-lift"
                    : "border-transparent shadow-plate",
                ].join(" ")}
              >
                <span className="sr-only">{swatch.name}</span>
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-[0.875rem] text-ink-3">
          Or paste a hex code and we match the whole page to it —{" "}
          <span className="text-ink-2">{active.name}</span> is just the preset.
        </p>
      </fieldset>
    </div>
  );
}
