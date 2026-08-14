/**
 * Legal content for the public pages.
 *
 * IMPORTANT — these are honest, product-accurate drafts, not lawyer-reviewed
 * final copy. They describe what the system actually does today (collects a
 * booker's name/email/phone, processes it on behalf of the venue, uses one
 * essential auth cookie, no tracking, pay-at-venue in soft launch). Have
 * counsel review before you rely on them publicly. See docs/launch-readiness.md.
 *
 * Written against the Philippine Data Privacy Act of 2012 (RA 10173): for a
 * booker's data the VENUE is the Personal Information Controller and ReservMe is
 * the Personal Information Processor; for a venue owner's own account data,
 * ReservMe is the Controller.
 */

export const LEGAL = {
  effectiveDate: "14 August 2026",
  company: "ReservMe",
  contactEmail: "privacy@reservme.pro",
  dpoEmail: "dpo@reservme.pro",
  jurisdiction: "the Republic of the Philippines",
  regulator: "the National Privacy Commission (NPC)",
} as const;

export type LegalSection = { heading: string; body: string[] };

export const PRIVACY_SECTIONS: LegalSection[] = [
  {
    heading: "Who we are, and the two roles we play",
    body: [
      "ReservMe provides booking software to venues — courts, studios, rooms, restaurants and tours. How we handle personal data depends on whose data it is.",
      "When a venue owner signs up and runs their venue on ReservMe, we are the controller of that owner's account information. When a customer books a slot at a venue, the venue decides why and how that booking data is used — the venue is the controller, and ReservMe is only the processor acting on the venue's instructions.",
    ],
  },
  {
    heading: "What we collect",
    body: [
      "From a customer making a booking: your name, email address, an optional mobile number, and the details of the booking itself (which space, when, the amount). Customers do not create an account and we never ask a customer for a password.",
      "From a venue owner or staff member: name, email address, a hashed password, and the venue details you enter (spaces, prices, opening hours, policies).",
      "Automatically, for security and reliability: your IP address and basic request information, used for rate limiting and abuse prevention, kept only briefly.",
    ],
  },
  {
    heading: "What we do not collect",
    body: [
      "We do not use advertising or analytics cookies, and we do not track you across other websites. The only cookie we set is an essential one that keeps a signed-in venue owner logged in — customers booking a slot are not given any tracking cookie.",
      "In the current pay-at-venue model we do not take card payments, so we do not collect or store card numbers. When online payments are introduced they will be handled by a licensed payment provider (such as PayMongo or Xendit); we will update this notice before that happens.",
    ],
  },
  {
    heading: "How we use it",
    body: [
      "To take and confirm bookings, send confirmation and reminder emails, and show a venue its schedule. Confirmation and reminder emails are sent through our email provider (Resend) on the venue's behalf.",
      "To keep the service secure and working — preventing a single source from flooding a venue's calendar, and diagnosing errors.",
      "We do not sell personal data, and we do not use a venue's customer list for our own marketing.",
    ],
  },
  {
    heading: "Who we share it with",
    body: [
      "The venue you booked with, so it can honour your reservation. That is the whole point of the booking.",
      "A small number of service providers who process data only to run ReservMe for us: our email provider (Resend), our hosting and database provider, and — once online payments are enabled — the payment provider you choose. Each acts under contract and only on our instructions.",
      "We may disclose information if required by law, or to protect the rights and safety of people and venues.",
    ],
  },
  {
    heading: "How long we keep it",
    body: [
      "Booking and customer records are kept for as long as the venue uses ReservMe, so the venue has its history, and are deleted (or returned) when the venue leaves. Security data such as IP-based rate-limit counters is discarded within hours.",
      "A venue can export its customers and booking history at any time, and can ask us to delete records on its behalf.",
    ],
  },
  {
    heading: "Your rights",
    body: [
      "Under the Data Privacy Act you may ask to access, correct, delete, or object to the processing of your personal data, and to receive a copy of it. For booking data, the venue is the controller — contact the venue, and we will help the venue act on your request. For a venue owner's own account data, contact us directly.",
      `You also have the right to complain to ${LEGAL.regulator} if you believe your data has been mishandled.`,
    ],
  },
  {
    heading: "How we protect it",
    body: [
      "Data is stored in a managed database, access is limited to what each part of the system needs, passwords are hashed, and connections are encrypted in transit. No system is perfectly secure, but we design to fail safe — for example, the booking engine refuses to double-book at the database level rather than relying on a check that could be raced.",
      "If a personal-data breach occurs that is likely to cause serious harm, we will notify the affected controllers and, where required, the National Privacy Commission and affected individuals, in line with the Data Privacy Act.",
    ],
  },
  {
    heading: "Contact",
    body: [
      `Questions about this notice, or a request about your data, can be sent to ${LEGAL.contactEmail}. Our Data Protection Officer can be reached at ${LEGAL.dpoEmail}.`,
    ],
  },
];

export const TERMS_SECTIONS: LegalSection[] = [
  {
    heading: "What ReservMe is",
    body: [
      "ReservMe is software that lets a venue take reservations on its own branded page. We provide the tool. The reservation itself is an arrangement between the venue and its customer — ReservMe is not a party to it, does not own the venue's calendar or prices, and does not take a commission on bookings.",
    ],
  },
  {
    heading: "Your account",
    body: [
      "You must give accurate details and keep your login secure. You are responsible for what happens under your account and for your staff's use of it. You must be able to enter into a contract and operate your venue lawfully.",
    ],
  },
  {
    heading: "Running your venue",
    body: [
      "You set your spaces, prices, opening hours, and policies, and they are yours. You are responsible for honouring the bookings you accept, for your own cancellation and refund terms, for any payments you take at your venue, and for how you treat your customers' personal data as its controller.",
      "In the current model, payment is arranged directly between you and your customer (for example, at the venue). ReservMe does not collect payment on your behalf and does not hold your customers' money.",
    ],
  },
  {
    heading: "Acceptable use",
    body: [
      "Don't use ReservMe to break the law, infringe others' rights, send spam, or attempt to disrupt or overload the service. Don't misrepresent your venue or take bookings you don't intend to honour.",
    ],
  },
  {
    heading: "Fees",
    body: [
      "ReservMe is offered on a subscription priced per venue, with a free first month. We charge no commission on your bookings. Fees, and any changes to them, are shown before you are billed. Gateway fees for online payments, when enabled, are set by the payment provider, not by us.",
    ],
  },
  {
    heading: "Availability",
    body: [
      "We work to keep ReservMe available and correct, but we provide it “as is” without a guarantee of uninterrupted service. We may change or improve features over time. We will give reasonable notice of significant changes that affect how you use the service.",
    ],
  },
  {
    heading: "Liability",
    body: [
      "To the extent the law allows, ReservMe is not liable for indirect or consequential losses, or for lost bookings or revenue arising from matters outside our reasonable control. Nothing here limits liability that cannot be limited by law.",
    ],
  },
  {
    heading: "Ending it",
    body: [
      "You can cancel at any time from your dashboard — there is no lock-in. You can export your customers and booking history on the way out; the data is yours. We may suspend or end an account that breaches these terms or puts the service or others at risk.",
    ],
  },
  {
    heading: "Governing law",
    body: [
      `These terms are governed by the laws of ${LEGAL.jurisdiction}. Questions can be sent to ${LEGAL.contactEmail}.`,
    ],
  },
];

/** Slugs a venue may not take, because the apex serves them as its own pages. */
export const RESERVED_SLUGS = new Set([
  "privacy",
  "terms",
  "legal",
  "dpa",
  "about",
  "contact",
  "support",
  "pricing",
  "login",
  "signup",
  "admin",
  "app",
  "api",
  "healthz",
  "www",
  "help",
  "blog",
]);
