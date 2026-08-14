import { BOOKING_PREVIEW } from "@/content/marketing";

const SLOT_STATES: Record<string, string> = {
  open: "border-rule bg-card text-ink",
  taken: "border-transparent bg-paper-3 text-ink-3 line-through decoration-ink-3/60",
  selected: "border-accent bg-accent text-on-accent shadow-plate",
};

/**
 * A rendering of the customer-facing booking page, in the product's own
 * chrome. Deliberately no drawn browser frame — no URL pill, no traffic
 * lights. The card is the artefact.
 */
export function BookingPreview() {
  const { venue, initial, slug, space, days, slots, session, confirm, reassurance } =
    BOOKING_PREVIEW;

  return (
    <figure className="relative m-0">
      <div
        aria-hidden="true"
        className="rounded-xl border border-rule bg-card p-5 shadow-float sm:p-6"
      >
        {/* Venue identity */}
        <div className="flex items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-pill bg-accent-soft font-display text-lg text-accent-ink">
            {initial}
          </span>
          <span className="min-w-0">
            <span className="block truncate font-display text-lg leading-tight">
              {venue}
            </span>
            <span className="label block truncate text-ink-3 normal-case tracking-normal">
              {slug}
            </span>
          </span>
        </div>

        <hr className="hairline my-5" />

        {/* Space + day strip */}
        <div className="flex items-center justify-between gap-3">
          <span className="truncate text-[0.9375rem] font-medium">{space}</span>
          <span className="label shrink-0 text-ink-3">August</span>
        </div>

        <div className="mt-3 grid grid-cols-4 gap-2">
          {days.map((day) => {
            const active = "active" in day && day.active;
            return (
              <span
                key={day.date}
                className={[
                  "flex flex-col items-center gap-0.5 rounded-sm border py-2",
                  active
                    ? "border-ink bg-ink text-paper"
                    : "border-rule bg-card text-ink-2",
                ].join(" ")}
              >
                <span className="label opacity-70">{day.weekday}</span>
                <span className="font-mono text-[0.9375rem] leading-none">
                  {day.date}
                </span>
              </span>
            );
          })}
        </div>

        {/* Slots */}
        <div className="mt-4 grid grid-cols-4 gap-2">
          {slots.map((slot) => (
            <span
              key={slot.time}
              className={[
                "flex h-9 items-center justify-center rounded-sm border font-mono text-[0.8125rem]",
                SLOT_STATES[slot.state],
              ].join(" ")}
            >
              {slot.time}
            </span>
          ))}
        </div>

        <div className="mt-5 flex h-12 items-center justify-center rounded-pill bg-ink px-5 text-[0.9375rem] font-medium text-paper">
          {confirm}
        </div>

        <p className="mt-3 text-center text-[0.8125rem] text-ink-3">{reassurance}</p>
      </div>

      {/* Grid-break: the session card breaks the card's left edge on wide screens. */}
      <div
        aria-hidden="true"
        className="mt-4 flex items-center gap-3 rounded-lg border border-accent-line bg-accent-soft p-4 shadow-lift lg:absolute lg:-bottom-7 lg:-left-12 lg:mt-0 lg:w-[19rem]"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[0.9375rem] font-medium text-accent-ink">
            {session.title}
          </span>
          <span className="block truncate text-[0.8125rem] text-accent-ink/75">
            {session.detail}
          </span>
        </span>
        <span className="flex h-9 shrink-0 items-center rounded-pill bg-accent px-4 text-[0.8125rem] font-medium text-on-accent">
          {session.action}
        </span>
      </div>

      <figcaption className="sr-only">
        The {venue} booking page: a court and date picker with live slot
        availability, one slot selected for {confirm.replace("Reserve ", "")}, and a
        shared open-play session with {session.detail}.
      </figcaption>
    </figure>
  );
}
