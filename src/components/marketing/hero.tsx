import { ButtonLink } from "@/components/ui/button";
import { BookingPreview } from "@/components/marketing/booking-preview";
import { Enter } from "@/components/marketing/enter";
import { HERO, HERO_FACTS } from "@/content/marketing";

export function Hero() {
  return (
    <section className="relative pt-28 pb-16 sm:pt-36 sm:pb-24">
      {/* Atmosphere: one warm wash off the top edge. No blobs, no mesh. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[42rem] bg-gradient-to-b from-paper-2 to-paper"
      />

      <div className="shell">
        <div className="grid grid-cols-1 items-center gap-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.92fr)] lg:gap-16 xl:gap-24">
          <div>
            <Enter>
              <p className="inline-flex items-center gap-2 rounded-pill border border-accent-line bg-accent-soft py-1.5 pl-2.5 pr-3.5 text-[0.8125rem] text-accent-ink">
                <span className="size-1.5 rounded-pill bg-accent" aria-hidden="true" />
                {HERO.badge}
              </p>

              <h1 className="mt-6 text-display text-balance">{HERO.headline}</h1>

              <p className="mt-6 max-w-[34rem] text-sub text-ink-2 text-pretty">
                {HERO.lede}
              </p>

              <div className="mt-9 flex flex-wrap items-center gap-3">
                <ButtonLink href={HERO.primaryCta.href} size="lg">
                  {HERO.primaryCta.label}
                </ButtonLink>
                <ButtonLink
                  href={HERO.secondaryCta.href}
                  size="lg"
                  variant="outline"
                >
                  {HERO.secondaryCta.label}
                </ButtonLink>
              </div>

              <p className="mt-5 text-[0.875rem] text-ink-3">{HERO.footnote}</p>
            </Enter>
          </div>

          <Enter delay={120} className="lg:pl-6">
            <BookingPreview />
          </Enter>
        </div>

        {/* Product facts. Policy and price, not invented traction. */}
        <Enter delay={200}>
          <dl className="mt-24 grid grid-cols-2 gap-x-6 gap-y-8 border-t border-rule pt-10 sm:mt-28 lg:grid-cols-4">
            {HERO_FACTS.map((fact) => (
              <div key={fact.label} className="min-w-0">
                <dt className="sr-only">{fact.label}</dt>
                <dd>
                  <span className="block font-display text-4xl leading-none tracking-[-0.03em] sm:text-5xl">
                    {fact.value}
                  </span>
                  <span className="mt-2.5 block max-w-[13rem] text-[0.875rem] leading-snug text-ink-3">
                    {fact.label}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        </Enter>
      </div>
    </section>
  );
}
