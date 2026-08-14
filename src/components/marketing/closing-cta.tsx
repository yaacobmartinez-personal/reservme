import { ButtonLink } from "@/components/ui/button";
import { Reveal } from "@/components/marketing/reveal";
import { CLOSING } from "@/content/marketing";

export function ClosingCta() {
  return (
    <section className="pb-20 sm:pb-28">
      <div className="shell">
        <Reveal>
          <div className="rounded-xl border border-accent-line bg-accent-soft px-6 py-16 text-center sm:px-12 sm:py-20">
            <h2 className="mx-auto max-w-[18ch] text-display-s text-balance text-accent-ink">
              {CLOSING.title}
            </h2>
            <p className="mx-auto mt-6 max-w-[46ch] text-sub text-pretty text-accent-ink/80">
              {CLOSING.body}
            </p>
            <div className="mt-9 flex justify-center">
              <ButtonLink href={CLOSING.cta.href} size="lg">
                {CLOSING.cta.label}
              </ButtonLink>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
