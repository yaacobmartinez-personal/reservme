"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { useCountUp } from "@/components/marketing/use-count-up";
import {
  MAX_LISTED_SPACES,
  MONTHS_BILLED_YEARLY,
  PLANS,
  PRICING,
  peso,
  planForSpaces,
} from "@/content/marketing";

type Billing = "monthly" | "yearly";

/** "1 space" · "2–6 spaces" · "16+ spaces" */
function spaceRange(plan: (typeof PLANS)[number]) {
  if (plan.maxSpaces === null) return `${plan.minSpaces}+ spaces`;
  if (plan.minSpaces === plan.maxSpaces) {
    return `${plan.minSpaces} space${plan.minSpaces === 1 ? "" : "s"}`;
  }
  return `${plan.minSpaces}–${plan.maxSpaces} spaces`;
}

/** Yearly bills ten months, shown as its monthly equivalent. */
function monthlyRate(price: number, billing: Billing) {
  return billing === "yearly"
    ? Math.round((price * MONTHS_BILLED_YEARLY) / 12)
    : price;
}

export function Pricing() {
  const sliderId = useId();
  const [spaces, setSpaces] = useState(4);
  const [billing, setBilling] = useState<Billing>("monthly");

  const active = planForSpaces(spaces);
  const quoted = active.price === null;
  const rate = useCountUp(active.price === null ? 0 : monthlyRate(active.price, billing));

  return (
    <section
      id="pricing"
      className="scroll-mt-28 border-t border-rule bg-paper-2 py-20 sm:py-28"
    >
      <div className="shell">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-head text-balance">{PRICING.title}</h2>
          <p className="mt-5 text-sub text-ink-2 text-pretty">{PRICING.lede}</p>
        </div>

        {/* Billing period */}
        <div className="mt-10 flex justify-center">
          <div className="inline-flex items-center gap-1 rounded-pill border border-rule bg-card p-1 shadow-plate">
            {(["monthly", "yearly"] as const).map((period) => {
              const selected = billing === period;
              return (
                <button
                  key={period}
                  type="button"
                  onClick={() => setBilling(period)}
                  aria-pressed={selected}
                  className={[
                    "whitespace-nowrap rounded-pill px-4 py-2 text-[0.875rem] capitalize",
                    "transition-colors duration-[--dur-fast] ease-out",
                    selected
                      ? "bg-ink text-paper"
                      : "text-ink-2 hover:bg-paper-3 hover:text-ink",
                  ].join(" ")}
                >
                  {period}
                  {period === "yearly" ? (
                    <span className={selected ? "text-paper/70" : "text-accent"}>
                      {" "}
                      · 2 months free
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        {/* The bands */}
        <ul className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PLANS.map((plan) => {
            const selected = plan.id === active.id;
            return (
              <li key={plan.id}>
                <div
                  className={[
                    "flex h-full flex-col rounded-lg border p-6",
                    "transition-[border-color,box-shadow,transform] duration-[--dur-base] ease-out",
                    selected
                      ? "border-ink bg-card shadow-lift lg:-translate-y-1"
                      : "border-rule bg-card/60 shadow-plate",
                  ].join(" ")}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 className="text-xl leading-none">{plan.name}</h3>
                    {selected ? (
                      <span className="label shrink-0 rounded-pill bg-accent-soft px-2 py-1 text-accent-ink">
                        Your venue
                      </span>
                    ) : null}
                  </div>

                  <p className="mt-2 font-mono text-[0.8125rem] text-ink-3">
                    {spaceRange(plan)}
                  </p>

                  <p className="mt-5 flex items-baseline gap-1.5">
                    {plan.price === null ? (
                      <span className="font-display text-3xl leading-none tracking-[-0.03em]">
                        Let&rsquo;s talk
                      </span>
                    ) : (
                      <>
                        <span className="font-display text-4xl leading-none tracking-[-0.03em] tabular-nums">
                          {peso(monthlyRate(plan.price, billing))}
                        </span>
                        <span className="text-[0.8125rem] text-ink-3">/ mo</span>
                      </>
                    )}
                  </p>

                  <p className="mt-4 text-[0.875rem] leading-relaxed text-ink-2">
                    {plan.blurb}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>

        {/* Count your spaces */}
        <div className="mx-auto mt-4 max-w-5xl rounded-xl border border-rule bg-card p-7 shadow-float sm:p-9">
          <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)] lg:gap-16">
            <div>
              <label htmlFor={sliderId} className="text-[0.9375rem] font-medium">
                How many spaces do you run?
              </label>

              <div className="mt-5 flex items-center gap-4">
                <input
                  id={sliderId}
                  className="range flex-1"
                  type="range"
                  min={1}
                  max={MAX_LISTED_SPACES}
                  step={1}
                  value={spaces}
                  onChange={(event) => setSpaces(Number(event.target.value))}
                  aria-describedby={`${sliderId}-outcome`}
                />
                <output
                  htmlFor={sliderId}
                  className="grid h-12 min-w-12 shrink-0 place-items-center rounded-md border border-rule bg-paper-2 px-3 font-mono text-lg tabular-nums shadow-plate"
                >
                  {spaces === MAX_LISTED_SPACES ? `${spaces}+` : spaces}
                </output>
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                {PRICING.presets.map((preset) => {
                  const selected = preset.spaces === spaces;
                  return (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => setSpaces(preset.spaces)}
                      aria-pressed={selected}
                      className={[
                        "whitespace-nowrap rounded-pill border px-3.5 py-1.5 text-[0.8125rem]",
                        "transition-[background-color,border-color,color,transform] duration-[--dur-fast] ease-out",
                        "hover:-translate-y-px active:translate-y-0 motion-reduce:transform-none",
                        selected
                          ? "border-ink bg-ink text-paper"
                          : "border-rule bg-card text-ink-2 hover:border-rule-strong hover:text-ink",
                      ].join(" ")}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>

              <hr className="hairline my-7" />

              <div id={`${sliderId}-outcome`}>
                <p className="label text-ink-3">
                  {active.name} · {spaceRange(active)}
                </p>

                {quoted ? (
                  <p className="mt-3 font-display text-4xl leading-none tracking-[-0.03em]">
                    Let&rsquo;s talk
                  </p>
                ) : (
                  <>
                    <p className="mt-3 flex items-baseline gap-2">
                      <span className="font-display text-6xl leading-none tracking-[-0.035em] tabular-nums sm:text-7xl">
                        {peso(rate)}
                      </span>
                      <span className="text-[0.9375rem] text-ink-3">/ month</span>
                    </p>
                    <p className="mt-2 text-[0.875rem] text-ink-3">
                      {billing === "yearly"
                        ? `Billed ${peso(active.price! * MONTHS_BILLED_YEARLY)} a year — ${PRICING.yearlyRibbon.toLowerCase()}. First month still free.`
                        : `${PRICING.ribbon}, then ${peso(active.price!)} for the whole venue. ${PRICING.note}`}
                    </p>
                  </>
                )}

                <ButtonLink
                  href={quoted ? PRICING.quoteCta.href : PRICING.cta.href}
                  size="lg"
                  className="mt-7 w-full sm:w-auto"
                >
                  {quoted ? PRICING.quoteCta.label : PRICING.cta.label}
                </ButtonLink>

                <p className="mt-4 text-[0.8125rem] text-ink-3">{PRICING.fine}</p>
              </div>
            </div>

            {/* Included, in every band */}
            <div className="lg:border-l lg:border-rule lg:pl-16">
              <h3 className="font-sans text-[0.9375rem] font-semibold">
                In every band, including Solo
              </h3>
              <ul className="mt-5 space-y-3">
                {PRICING.included.map((item) => (
                  <li key={item} className="flex items-start gap-3">
                    <svg
                      viewBox="0 0 16 16"
                      aria-hidden="true"
                      className="mt-1 size-4 shrink-0 text-accent"
                    >
                      <path
                        d="M2.5 8.5 6 12l7.5-8"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    <span className="text-[0.9375rem] leading-relaxed text-ink-2">
                      {item}
                    </span>
                  </li>
                ))}
              </ul>

              <p className="mt-6 border-t border-rule pt-5 text-[0.875rem] leading-relaxed text-ink-3">
                {PRICING.gateway}
              </p>
            </div>
          </div>
        </div>

        <p className="mx-auto mt-8 max-w-5xl text-[0.9375rem] text-ink-3">
          {PRICING.volume.text}{" "}
          <Link
            href={PRICING.volume.href}
            className="whitespace-nowrap rounded-xs text-accent underline decoration-accent-line underline-offset-4 transition-colors duration-[--dur-fast] ease-out hover:text-accent-hover hover:decoration-accent"
          >
            {PRICING.volume.label}
          </Link>
        </p>
      </div>
    </section>
  );
}
