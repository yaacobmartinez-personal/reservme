import Link from "next/link";
import { Wordmark } from "@/components/marketing/wordmark";
import { LEGAL, type LegalSection } from "@/content/legal";

/**
 * Prose layout for the legal pages. Narrow measure, generous rhythm, the same
 * tokens as the rest of the site. No reveal animation — legal text should be
 * there the instant the page loads.
 */
export function LegalPage({
  title,
  intro,
  sections,
}: {
  title: string;
  intro: string;
  sections: LegalSection[];
}) {
  return (
    <main className="flex-1 py-14 sm:py-20">
      <div className="shell max-w-2xl">
        <Link href="/" className="inline-block">
          <Wordmark />
        </Link>

        <h1 className="mt-10 text-head text-balance">{title}</h1>
        <p className="mt-3 text-[0.875rem] text-ink-3">
          Effective {LEGAL.effectiveDate}
        </p>
        <p className="mt-6 text-sub text-ink-2 text-pretty">{intro}</p>

        <div className="mt-12 space-y-10">
          {sections.map((section) => (
            <section key={section.heading}>
              <h2 className="font-sans text-[1.25rem] font-semibold tracking-[-0.01em]">
                {section.heading}
              </h2>
              <div className="mt-3 space-y-3">
                {section.body.map((paragraph, index) => (
                  <p
                    key={index}
                    className="max-w-prose text-[0.9375rem] leading-relaxed text-ink-2"
                  >
                    {paragraph}
                  </p>
                ))}
              </div>
            </section>
          ))}
        </div>

        <footer className="mt-16 border-t border-rule pt-6 text-[0.8125rem] text-ink-3">
          <nav className="flex flex-wrap gap-x-5 gap-y-2">
            <Link href="/privacy" className="hover:text-accent">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-accent">
              Terms
            </Link>
            <Link href="/" className="hover:text-accent">
              Home
            </Link>
          </nav>
          <p className="mt-4">
            © {new Date().getFullYear()} {LEGAL.company}. All rights reserved.
          </p>
        </footer>
      </div>
    </main>
  );
}
