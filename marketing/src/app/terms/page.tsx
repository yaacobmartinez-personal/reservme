import type { Metadata } from "next";
import { LegalPage } from "@/components/marketing/legal-page";
import { TERMS_SECTIONS } from "@/content/legal";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The terms on which venues use ReservMe to take reservations.",
};

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      intro="These terms cover a venue's use of ReservMe to take reservations. Booking a slot at a venue is an arrangement between you and that venue; ReservMe provides the software."
      sections={TERMS_SECTIONS}
    />
  );
}
