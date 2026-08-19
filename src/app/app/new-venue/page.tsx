import type { Metadata } from "next";
import Link from "next/link";
import { requireVenue } from "@/lib/tenancy";
import { CreateVenueForm } from "./create-venue-form";

export const metadata: Metadata = { title: "New venue" };
export const dynamic = "force-dynamic";

export default async function NewVenuePage() {
  await requireVenue(); // must be signed in

  return (
    <main className="flex-1 py-10 sm:py-16">
      <div className="shell max-w-md">
        <Link href="/" className="text-[0.875rem] text-ink-2 hover:text-accent">
          ← Back
        </Link>
        <h1 className="mt-4 text-head">Add a venue</h1>
        <p className="mt-2 text-[0.9375rem] text-ink-2">
          Run more than one site from this login. Each venue gets its own booking
          page, spaces, and settings; switch between them anytime.
        </p>
        <div className="mt-8 rounded-xl border border-rule bg-card p-6 shadow-float sm:p-8">
          <CreateVenueForm />
        </div>
      </div>
    </main>
  );
}
