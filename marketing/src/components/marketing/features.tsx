import { Reveal } from "@/components/marketing/reveal";
import { SectionHead } from "@/components/marketing/section-head";
import { FEATURES } from "@/content/marketing";

const [headline, second, ...rest] = FEATURES;

/** Two people tap the same 20:00. One gets it; the other is queued, not lost. */
function RaceFigure() {
  return (
    <div aria-hidden="true" className="rounded-md border border-rule bg-paper-2 p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-[0.8125rem] text-ink-2">Court 1 · 20:00</span>
        <span className="label rounded-pill bg-paper-3 px-2 py-1 text-ink-3">
          1 left
        </span>
      </div>
      <div className="mt-3 space-y-2">
        <div className="flex items-center justify-between gap-3 rounded-sm border border-accent-line bg-accent-soft px-3 py-2">
          <span className="text-[0.8125rem] font-medium text-accent-ink">Ana</span>
          <span className="font-mono text-[0.75rem] text-accent-ink">confirmed</span>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-sm border border-rule bg-card px-3 py-2">
          <span className="text-[0.8125rem] text-ink-2">Ben</span>
          <span className="font-mono text-[0.75rem] text-ink-3">waitlisted #1</span>
        </div>
      </div>
    </div>
  );
}

/** Nine of twelve spots taken on a shared session. */
function SpotsFigure() {
  const taken = 9;
  const capacity = 12;

  return (
    <div aria-hidden="true" className="rounded-md border border-rule bg-paper-2 p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-[0.8125rem] text-ink-2">
          Open play · Thu 19:00
        </span>
        <span className="label rounded-pill bg-accent-soft px-2 py-1 text-accent-ink">
          {capacity - taken} left
        </span>
      </div>
      <ul className="mt-4 flex flex-wrap gap-1.5">
        {Array.from({ length: capacity }, (_, index) => (
          <li
            key={index}
            className={[
              "size-5 rounded-pill border",
              index < taken
                ? "border-accent bg-accent"
                : "border-rule-strong bg-card",
            ].join(" ")}
          />
        ))}
      </ul>
      <p className="mt-3 font-mono text-[0.75rem] text-ink-3">
        {taken}/{capacity} · per-person spots
      </p>
    </div>
  );
}

export function Features() {
  return (
    <section id="features" className="scroll-mt-28 border-t border-rule bg-paper-2 py-20 sm:py-28">
      <div className="shell">
        <SectionHead
          title="Everything you need to fill the calendar"
          lede="All of it is in the one plan. Nothing is held back for a higher tier, because there isn't one."
        />

        {/* Two load-bearing features, drawn. */}
        <div className="mt-14 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {[
            { feature: headline, figure: <RaceFigure /> },
            { feature: second, figure: <SpotsFigure /> },
          ].map(({ feature, figure }) => (
            <Reveal key={feature.title}>
              <article className="flex h-full flex-col rounded-lg border border-rule bg-card p-6 shadow-plate sm:p-8">
                <h3 className="text-2xl leading-tight sm:text-[1.75rem]">
                  {feature.title}
                </h3>
                <p className="mt-4 max-w-prose text-[0.9375rem] leading-relaxed text-ink-2">
                  {feature.body}
                </p>
                <div className="mt-7">{figure}</div>
              </article>
            </Reveal>
          ))}
        </div>

        {/* The remaining ten, dense. */}
        <div className="mt-4 grid grid-cols-1 gap-x-12 sm:grid-cols-2">
          {rest.map((feature) => (
            <Reveal key={feature.title}>
              <article className="border-t border-rule py-6">
                <h3 className="font-sans text-[1.0625rem] font-semibold leading-snug tracking-[-0.005em]">
                  {feature.title}
                </h3>
                <p className="mt-2 max-w-prose text-[0.9375rem] leading-relaxed text-ink-2">
                  {feature.body}
                </p>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
