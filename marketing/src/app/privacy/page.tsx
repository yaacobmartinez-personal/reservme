import type { Metadata } from "next";
import { LegalPage } from "@/components/marketing/legal-page";
import { PRIVACY_SECTIONS } from "@/content/legal";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "How ReservMe handles personal data — for venue owners, and for the customers who book with them.",
};

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      intro="This notice explains what personal data ReservMe handles, why, and the choices you have. It is written for both venue owners who use ReservMe and the customers who book with them."
      sections={PRIVACY_SECTIONS}
    />
  );
}
