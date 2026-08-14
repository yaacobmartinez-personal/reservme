import { SiteNav } from "@/components/marketing/site-nav";
import { Hero } from "@/components/marketing/hero";
import { VenueFamilies } from "@/components/marketing/venue-families";
import { Features } from "@/components/marketing/features";
import { WhiteLabel } from "@/components/marketing/white-label";
import { SwitchReasons } from "@/components/marketing/switch-reasons";
import { HowItWorks } from "@/components/marketing/how-it-works";
import { Pricing } from "@/components/marketing/pricing";
import { Faq } from "@/components/marketing/faq";
import { ClosingCta } from "@/components/marketing/closing-cta";
import { SiteFooter } from "@/components/marketing/site-footer";

export default function HomePage() {
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-100 focus:rounded-pill focus:bg-ink focus:px-5 focus:py-3 focus:text-paper"
      >
        Skip to content
      </a>

      <SiteNav />

      <main id="main" className="flex-1">
        <Hero />
        <VenueFamilies />
        <Features />
        <WhiteLabel />
        <SwitchReasons />
        <HowItWorks />
        <Pricing />
        <Faq />
        <ClosingCta />
      </main>

      <SiteFooter />
    </>
  );
}
