import { Reveal } from "@/components/marketing/reveal";
import { FAQS } from "@/content/marketing";

/**
 * Native <details> — no JS, keyboard-operable for free, and findable by the
 * browser's own in-page search on every current engine.
 */
export function Faq() {
  return (
    <section id="faq" className="scroll-mt-28 py-20 sm:py-28">
      <div className="shell">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1fr)] lg:gap-20">
          <Reveal>
            <h2 className="text-head text-balance lg:sticky lg:top-28">
              Questions we get asked
            </h2>
          </Reveal>

          <Reveal>
            <div>
              {FAQS.map((faq) => (
                <details
                  key={faq.q}
                  name="faq"
                  className="group border-t border-rule last:border-b"
                >
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-5 text-left text-[1.0625rem] font-medium leading-snug transition-colors duration-[--dur-fast] ease-out hover:text-accent [&::-webkit-details-marker]:hidden">
                    {faq.q}
                    <svg
                      viewBox="0 0 16 16"
                      aria-hidden="true"
                      className="size-4 shrink-0 text-ink-3 transition-transform duration-[--dur-base] ease-out group-open:rotate-45 motion-reduce:transition-none"
                    >
                      <path
                        d="M8 2.5v11M2.5 8h11"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                      />
                    </svg>
                  </summary>
                  <p className="max-w-prose pb-6 pr-10 text-[0.9375rem] leading-relaxed text-ink-2">
                    {faq.a}
                  </p>
                </details>
              ))}
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
