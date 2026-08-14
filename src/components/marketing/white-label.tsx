import { BrandStudio } from "@/components/marketing/brand-studio";
import { Reveal } from "@/components/marketing/reveal";
import { BRANDING } from "@/content/marketing";

export function WhiteLabel() {
  return (
    <section className="py-20 sm:py-28">
      <div className="shell">
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1fr)] lg:gap-20">
          <Reveal>
            <h2 className="text-head text-balance">{BRANDING.title}</h2>
            <p className="mt-5 max-w-[34rem] text-sub text-ink-2 text-pretty">
              {BRANDING.body}
            </p>

            <ul className="mt-8 space-y-3.5">
              {BRANDING.points.map((point) => (
                <li key={point} className="flex items-start gap-3">
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
                    {point}
                  </span>
                </li>
              ))}
            </ul>
          </Reveal>

          <Reveal>
            <BrandStudio />
          </Reveal>
        </div>
      </div>
    </section>
  );
}
