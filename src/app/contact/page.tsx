import type { Metadata } from "next";
import Link from "next/link";
import { Wordmark } from "@/components/marketing/wordmark";
import { AUTH } from "@/content/marketing";
import { LEGAL } from "@/content/legal";

export const metadata: Metadata = {
  title: "Contact",
  description: "Get in touch with the ReservMe team.",
};

const CHANNELS = [
  {
    label: "Sales & new venues",
    detail: "Setting up, pricing for 10+ spaces, or a custom integration.",
    email: "hello@reservme.pro",
  },
  {
    label: "Support",
    detail: "Help with your venue, bookings, or account.",
    email: "support@reservme.pro",
  },
  {
    label: "Privacy",
    detail: "Data requests and privacy questions.",
    email: LEGAL.contactEmail,
  },
];

export default function ContactPage() {
  return (
    <main className="flex-1 py-14 sm:py-20">
      <div className="shell max-w-2xl">
        <Link href="/" className="inline-block">
          <Wordmark />
        </Link>

        <h1 className="mt-10 text-head text-balance">Talk to us</h1>
        <p className="mt-4 text-sub text-ink-2 text-pretty">
          The fastest way to start is to create your venue — it takes a few
          minutes and the first month is free. For anything else, here&rsquo;s
          where to reach us.
        </p>

        <div className="mt-8">
          <Link
            href={AUTH.signup}
            className="inline-flex h-12 items-center rounded-pill bg-accent px-6 text-[0.9375rem] font-medium text-on-accent shadow-plate transition-[transform,background-color] duration-[--dur-base] ease-out hover:-translate-y-px hover:bg-accent-hover"
          >
            Create your page
          </Link>
        </div>

        <div className="mt-12 space-y-3">
          {CHANNELS.map((channel) => (
            <div
              key={channel.email}
              className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-lg border border-rule bg-card p-5 shadow-plate"
            >
              <div className="min-w-0">
                <p className="font-medium">{channel.label}</p>
                <p className="text-[0.875rem] text-ink-3">{channel.detail}</p>
              </div>
              <a
                href={`mailto:${channel.email}`}
                className="whitespace-nowrap font-mono text-[0.875rem] text-accent underline decoration-accent-line underline-offset-4 hover:decoration-accent"
              >
                {channel.email}
              </a>
            </div>
          ))}
        </div>

        <footer className="mt-16 border-t border-rule pt-6 text-[0.8125rem] text-ink-3">
          <nav className="flex flex-wrap gap-x-5 gap-y-2">
            <Link href="/" className="hover:text-accent">
              Home
            </Link>
            <Link href="/privacy" className="hover:text-accent">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-accent">
              Terms
            </Link>
          </nav>
        </footer>
      </div>
    </main>
  );
}
