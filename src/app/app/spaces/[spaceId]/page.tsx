import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { getOpeningHours, getOwnerSpace, listPricingRules, listSpaceSessions } from "@/lib/owner";
import { formatMoney } from "@/lib/money";
import { requireVenue } from "@/lib/tenancy";
import { addPricingRule, removePricingRule, setOpeningHours, updateSpace } from "../../actions";
import { cancelSession, createSession } from "../../session-actions";

const DAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const metadata: Metadata = { title: "Edit space" };
export const dynamic = "force-dynamic";

const FIELD =
  "h-11 w-full rounded-sm border border-rule bg-paper-2 px-3 text-[0.9375rem]";
const LABEL = "grid gap-1.5 text-[0.875rem] text-ink-2";

// Display Monday-first; store Postgres DOW (0 = Sunday).
const WEEK = [
  { n: 1, label: "Monday" },
  { n: 2, label: "Tuesday" },
  { n: 3, label: "Wednesday" },
  { n: 4, label: "Thursday" },
  { n: 5, label: "Friday" },
  { n: 6, label: "Saturday" },
  { n: 0, label: "Sunday" },
] as const;

export default async function EditSpacePage({
  params,
}: {
  params: Promise<{ spaceId: string }>;
}) {
  const venue = await requireVenue();
  const { spaceId } = await params;

  const space = await getOwnerSpace(venue.organizationId, spaceId);
  if (!space) notFound();

  const [hours, rules, sessions] = await Promise.all([
    getOpeningHours(spaceId),
    listPricingRules(spaceId),
    listSpaceSessions(spaceId, venue.timezone),
  ]);
  const byDay = new Map(hours.map((h) => [h.weekday, h]));

  return (
    <main className="flex-1 py-10 sm:py-14">
      <div className="shell-wide">
        <Link href="/spaces" className="text-[0.875rem] text-ink-2 hover:text-accent">
          ← Spaces
        </Link>
        <h1 className="mt-4 text-head">{space.name}</h1>

        {/* Details */}
        <section className="mt-8 rounded-xl border border-rule bg-card p-6 shadow-float sm:p-8">
          <h2 className="text-xl">Details</h2>
          <form action={updateSpace} className="mt-6 grid gap-4">
            <input type="hidden" name="spaceId" value={space.id} />

            <label className={LABEL}>
              <span>Name</span>
              <input name="name" required defaultValue={space.name} className={FIELD} />
            </label>

            <div className="grid grid-cols-2 gap-4">
              <label className={LABEL}>
                <span>Type</span>
                <input name="kind" defaultValue={space.kind} className={FIELD} />
              </label>
              <label className={LABEL}>
                <span>Price (₱ per slot)</span>
                <input
                  name="price"
                  inputMode="decimal"
                  defaultValue={(space.priceCents / 100).toString()}
                  className={FIELD}
                />
              </label>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <label className={LABEL}>
                <span>Slot length</span>
                <select
                  name="slotMinutes"
                  defaultValue={String(space.slotMinutes)}
                  className={FIELD}
                >
                  <option value="30">30 min</option>
                  <option value="60">1 hour</option>
                  <option value="90">90 min</option>
                  <option value="120">2 hours</option>
                </select>
              </label>
              <label className={LABEL}>
                <span>Buffer (min)</span>
                <input
                  name="bufferMinutes"
                  type="number"
                  min={0}
                  defaultValue={space.bufferMinutes}
                  className={FIELD}
                />
              </label>
              <label className={LABEL}>
                <span>Capacity</span>
                <input
                  name="capacity"
                  type="number"
                  min={1}
                  defaultValue={space.capacity}
                  className={FIELD}
                />
              </label>
            </div>

            <Button type="submit" className="mt-2 justify-self-start">
              Save details
            </Button>
          </form>
        </section>

        {/* Opening hours */}
        <section className="mt-6 rounded-xl border border-rule bg-card p-6 shadow-float sm:p-8">
          <h2 className="text-xl">Opening hours</h2>
          <p className="mt-1 text-[0.875rem] text-ink-3">
            In {venue.timezone}. Uncheck a day to close it.
          </p>

          <form action={setOpeningHours} className="mt-6">
            <input type="hidden" name="spaceId" value={space.id} />

            <div className="space-y-2">
              {WEEK.map((day) => {
                const existing = byDay.get(day.n);
                const open = Boolean(existing);
                return (
                  <div
                    key={day.n}
                    className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-rule py-2.5 last:border-b-0"
                  >
                    <label className="flex w-32 items-center gap-2.5">
                      <input
                        type="checkbox"
                        name={`open_${day.n}`}
                        defaultChecked={open}
                        className="size-4 accent-[var(--color-accent)]"
                      />
                      <span className="text-[0.9375rem]">{day.label}</span>
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="time"
                        name={`opens_${day.n}`}
                        defaultValue={existing?.opensAt ?? "08:00"}
                        className="h-10 rounded-sm border border-rule bg-paper-2 px-2 text-[0.875rem]"
                      />
                      <span className="text-ink-3">–</span>
                      <input
                        type="time"
                        name={`closes_${day.n}`}
                        defaultValue={existing?.closesAt ?? "22:00"}
                        className="h-10 rounded-sm border border-rule bg-paper-2 px-2 text-[0.875rem]"
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            <Button type="submit" className="mt-6">
              Save hours
            </Button>
          </form>
        </section>

        {/* Peak / off-peak pricing */}
        <section className="mt-6 rounded-xl border border-rule bg-card p-6 shadow-float sm:p-8">
          <h2 className="text-xl">Peak / off-peak pricing</h2>
          <p className="mt-1 text-[0.875rem] text-ink-3">
            Override the {formatMoney(space.priceCents, venue.currency)} base price at
            busy times. A slot&rsquo;s start time sets its price; the newest matching
            rule wins.
          </p>

          {rules.length > 0 ? (
            <ul className="mt-4 space-y-2">
              {rules.map((rule) => (
                <li
                  key={rule.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-rule bg-paper-2 p-3"
                >
                  <span className="font-medium">{formatMoney(rule.priceCents, venue.currency)}</span>
                  <span className="text-[0.8125rem] text-ink-2">
                    {rule.label ? `${rule.label} · ` : ""}
                    {rule.weekdays.map((d) => DAY_ABBR[d]).join(" ")} · {rule.startsAt}–{rule.endsAt}
                  </span>
                  <form action={removePricingRule} className="ml-auto">
                    <input type="hidden" name="ruleId" value={rule.id} />
                    <input type="hidden" name="spaceId" value={space.id} />
                    <button type="submit" className="text-[0.8125rem] text-ink-3 hover:text-clay-ink">
                      Remove
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          ) : null}

          <form action={addPricingRule} className="mt-5 grid gap-4">
            <input type="hidden" name="spaceId" value={space.id} />
            <div className="grid grid-cols-2 gap-4">
              <label className={LABEL}>
                <span>Label (optional)</span>
                <input name="label" placeholder="Peak" className={FIELD} />
              </label>
              <label className={LABEL}>
                <span>Price (₱ per slot)</span>
                <input name="price" inputMode="decimal" placeholder="1400" className={FIELD} />
              </label>
            </div>
            <div>
              <span className="text-[0.875rem] text-ink-2">Days</span>
              <div className="mt-2 flex flex-wrap gap-2">
                {WEEK.map((day) => (
                  <label
                    key={day.n}
                    className="flex items-center gap-1.5 rounded-pill border border-rule px-3 py-1.5 text-[0.8125rem]"
                  >
                    <input type="checkbox" name={`wd_${day.n}`} className="size-3.5 accent-[var(--color-accent)]" />
                    {day.label.slice(0, 3)}
                  </label>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input type="time" name="starts" defaultValue="18:00" className="h-10 rounded-sm border border-rule bg-paper-2 px-2 text-[0.875rem]" />
              <span className="text-ink-3">–</span>
              <input type="time" name="ends" defaultValue="22:00" className="h-10 rounded-sm border border-rule bg-paper-2 px-2 text-[0.875rem]" />
            </div>
            <Button type="submit" className="justify-self-start">
              Add rule
            </Button>
          </form>
        </section>

        {/* Play sessions */}
        <section className="mt-6 rounded-xl border border-rule bg-card p-6 shadow-float sm:p-8">
          <h2 className="text-xl">Play sessions</h2>
          <p className="mt-1 text-[0.875rem] text-ink-3">
            Open-play or classes on this space — people book a spot each. They show on
            the public page and your calendar.
          </p>

          {sessions.length > 0 ? (
            <ul className="mt-4 space-y-2">
              {sessions.map((s) => (
                <li
                  key={s.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-rule bg-paper-2 p-3"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{s.title}</span>
                    <span className="block truncate text-[0.8125rem] text-ink-3">
                      {s.whenLabel} · {s.bookedSpots}/{s.capacity} booked ·{" "}
                      {formatMoney(s.priceCents, venue.currency)}/person
                    </span>
                  </span>
                  <form action={cancelSession} className="ml-auto">
                    <input type="hidden" name="sessionId" value={s.id} />
                    <input type="hidden" name="spaceId" value={space.id} />
                    <button type="submit" className="text-[0.8125rem] text-ink-3 hover:text-clay-ink">
                      Cancel
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          ) : null}

          <form action={createSession} className="mt-5 grid gap-4">
            <input type="hidden" name="spaceId" value={space.id} />
            <label className={LABEL}>
              <span>Title</span>
              <input name="title" required placeholder="Open play" className={FIELD} />
            </label>
            <div className="grid grid-cols-2 gap-4">
              <label className={LABEL}>
                <span>Date</span>
                <input name="date" type="date" required className={FIELD} />
              </label>
              <label className={LABEL}>
                <span>Repeat</span>
                <select name="repeatWeeks" defaultValue="0" className={FIELD}>
                  <option value="0">Just once</option>
                  <option value="3">Weekly · 4 weeks</option>
                  <option value="7">Weekly · 8 weeks</option>
                  <option value="11">Weekly · 12 weeks</option>
                </select>
              </label>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <label className={LABEL}>
                <span>Start</span>
                <input name="start" type="time" required defaultValue="19:00" className={FIELD} />
              </label>
              <label className={LABEL}>
                <span>End</span>
                <input name="end" type="time" required defaultValue="21:00" className={FIELD} />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <label className={LABEL}>
                <span>Capacity</span>
                <input name="capacity" type="number" min={1} required defaultValue={12} className={FIELD} />
              </label>
              <label className={LABEL}>
                <span>Price (₱ per person)</span>
                <input name="price" inputMode="decimal" placeholder="350" className={FIELD} />
              </label>
            </div>
            <Button type="submit" className="justify-self-start">
              Add session
            </Button>
          </form>
        </section>
      </div>
    </main>
  );
}
