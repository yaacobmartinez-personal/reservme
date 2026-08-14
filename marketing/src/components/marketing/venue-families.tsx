import { Reveal } from "@/components/marketing/reveal";
import { SectionHead } from "@/components/marketing/section-head";
import { TEMPLATE_COUNT, VENUE_FAMILIES } from "@/content/marketing";

/** The first family gets a double-width tile; the rest fall in behind it. */
const SPANS = ["lg:col-span-2", "", "", "", ""];

export function VenueFamilies() {
  return (
    <section id="venues" className="scroll-mt-28 py-20 sm:py-28">
      <div className="shell">
        <SectionHead
          title="If it can be reserved, it runs here"
          lede={`${TEMPLATE_COUNT} templates across five families. Pick yours at signup and start with spaces, prices and opening hours already configured — then change every one of them.`}
        />

        <div className="mt-14 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {VENUE_FAMILIES.map((family, index) => (
            <Reveal
              key={family.id}
              className={SPANS[index]}
            >
              <article className="flex h-full flex-col rounded-lg border border-rule bg-card p-6 shadow-plate transition-[transform,box-shadow] duration-[--dur-base] ease-out hover:-translate-y-0.5 hover:shadow-lift motion-reduce:transform-none sm:p-7">
                <h3 className="text-xl leading-tight sm:text-2xl">{family.name}</h3>
                <p className="mt-3 max-w-prose text-[0.9375rem] leading-relaxed text-ink-2">
                  {family.blurb}
                </p>

                <ul className="mt-6 flex flex-wrap gap-1.5">
                  {family.templates.map((template) => (
                    <li
                      key={template}
                      className="rounded-pill border border-rule bg-paper-2 px-3 py-1.5 text-[0.8125rem] text-ink-2"
                    >
                      {template}
                    </li>
                  ))}
                </ul>
              </article>
            </Reveal>
          ))}
        </div>

        <Reveal>
          <p className="mt-6 text-[0.9375rem] text-ink-3">
            Nothing here quite you? Start from a blank venue and describe your
            spaces yourself.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
