import { Reveal } from "@/components/marketing/reveal";
import { SectionHead } from "@/components/marketing/section-head";
import { STEPS } from "@/content/marketing";

/** Genuinely ordinal content — one of the two places numbering is earned. */
export function HowItWorks() {
  return (
    <section id="how-it-works" className="scroll-mt-28 py-20 sm:py-28">
      <div className="shell">
        <SectionHead
          title="Live in three steps"
          lede="Most venues are taking their first online booking the same afternoon they sign up."
        />

        <ol className="mt-14 grid grid-cols-1 gap-x-10 gap-y-4 lg:grid-cols-3">
          {STEPS.map((step, index) => (
            <li key={step.title}>
              <Reveal>
                <div className="h-full border-t-2 border-ink pt-6">
                  <span className="font-mono text-[0.8125rem] text-accent">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <h3 className="mt-3 text-2xl leading-tight">{step.title}</h3>
                  <p className="mt-3 max-w-prose text-[0.9375rem] leading-relaxed text-ink-2">
                    {step.body}
                  </p>
                </div>
              </Reveal>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
