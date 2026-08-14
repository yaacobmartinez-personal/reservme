import { Reveal } from "@/components/marketing/reveal";
import { SWITCH_REASONS } from "@/content/marketing";

/**
 * The one ink-dark band on the page. It carries the argument, so it gets the
 * weight — and it breaks up an otherwise uninterrupted run of warm paper.
 */
export function SwitchReasons() {
  return (
    <section className="bg-ink py-20 text-paper sm:py-28">
      <div className="shell">
        <Reveal>
          <div className="max-w-2xl">
            <h2 className="text-head text-balance text-paper">
              Why venues move over
            </h2>
            <p className="mt-5 text-sub text-pretty text-paper/70">
              Booking tools have made owners choose between paying a commission,
              paying for a suite built for chains, or running the whole thing out
              of a notebook. We built the fourth option.
            </p>
          </div>
        </Reveal>

        <div className="mt-14">
          {SWITCH_REASONS.map((reason) => (
            <Reveal key={reason.against}>
              <article className="grid grid-cols-1 gap-4 border-t border-paper/15 py-8 sm:grid-cols-[7rem_minmax(0,1fr)] sm:gap-8 sm:py-10 lg:grid-cols-[9rem_minmax(0,1fr)]">
                <p className="font-display text-5xl leading-none tracking-[-0.03em] text-accent-bright lg:text-6xl">
                  {reason.figure}
                </p>
                <div>
                  <h3 className="font-sans text-[1.0625rem] font-medium leading-snug text-paper/55">
                    {reason.against}
                  </h3>
                  <p className="mt-3 max-w-prose text-sub leading-relaxed text-paper/85">
                    {reason.body}
                  </p>
                </div>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
