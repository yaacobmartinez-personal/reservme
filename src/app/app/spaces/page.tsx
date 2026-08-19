import type { Metadata } from "next";
import Link from "next/link";
import { formatMoney } from "@/lib/money";
import { listOwnerSpaces } from "@/lib/owner";
import { requireVenue } from "@/lib/tenancy";
import { setSpaceActive } from "../actions";
import { AddSpace } from "./space-forms";
import { SpacePhoto } from "./space-photo";

export const metadata: Metadata = { title: "Spaces" };
export const dynamic = "force-dynamic";

export default async function SpacesPage() {
  const venue = await requireVenue();
  const spaces = await listOwnerSpaces(venue.organizationId);

  return (
    <main className="flex-1 py-10 sm:py-14">
      <div className="shell-wide">
        <h1 className="text-head">Spaces</h1>
        <p className="mt-2 text-[0.9375rem] text-ink-2">
          Each active space is one bookable thing on{" "}
          <span className="font-mono text-ink">reservme.pro/{venue.slug}</span>, and
          counts toward your plan.
        </p>

        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {spaces.map((space) => (
            <li
              key={space.id}
              className="flex flex-col overflow-hidden rounded-xl border border-rule bg-card shadow-plate"
            >
              <Link
                href={`/spaces/${space.id}`}
                className="relative block aspect-video overflow-hidden bg-paper-2"
              >
                <SpacePhoto
                  src={space.imageUrl}
                  name={space.name}
                  className={space.isActive ? "" : "opacity-50 grayscale"}
                />
                {space.isActive ? null : (
                  <span className="label absolute right-2 top-2 rounded-pill bg-ink/75 px-2 py-0.5 text-paper">
                    Off
                  </span>
                )}
              </Link>

              <div className="flex flex-1 flex-col p-4">
                <Link
                  href={`/spaces/${space.id}`}
                  className="truncate font-medium hover:text-accent"
                >
                  {space.name}
                </Link>
                <p className="mt-1 text-[0.8125rem] text-ink-3">
                  {space.kind} · {formatMoney(space.priceCents, venue.currency)} /{" "}
                  {space.slotMinutes}min · open {space.openDays}/7 days
                  {space.capacity > 1 ? ` · up to ${space.capacity}` : ""}
                </p>

                <div className="mt-4 flex items-center gap-2 border-t border-rule pt-3">
                  <Link
                    href={`/spaces/${space.id}`}
                    className="whitespace-nowrap rounded-pill border border-rule-strong px-3.5 py-1.5 text-[0.8125rem] transition-colors duration-[--dur-fast] ease-out hover:border-ink"
                  >
                    Edit
                  </Link>
                  <form action={setSpaceActive} className="ml-auto">
                    <input type="hidden" name="spaceId" value={space.id} />
                    <input
                      type="hidden"
                      name="active"
                      value={space.isActive ? "false" : "true"}
                    />
                    <button
                      type="submit"
                      className="whitespace-nowrap rounded-pill px-3 py-1.5 text-[0.8125rem] text-ink-2 transition-colors duration-[--dur-fast] ease-out hover:bg-paper-3 hover:text-ink"
                    >
                      {space.isActive ? "Turn off" : "Turn on"}
                    </button>
                  </form>
                </div>
              </div>
            </li>
          ))}
        </ul>

        <section className="mt-10 rounded-xl border border-rule bg-card p-6 shadow-float sm:p-8">
          <h2 className="text-xl">Add a space</h2>
          <p className="mt-1 text-[0.875rem] text-ink-3">
            Pausing one for the off-season costs nothing — only active spaces are
            billed.
          </p>
          <div className="mt-6">
            <AddSpace />
          </div>
        </section>
      </div>
    </main>
  );
}
