import { sql } from "@/db";
import { wallClock, type WallClock } from "@/lib/mobile/calendar-json";

/**
 * Peak pricing and closures, for the space editor (API-CONTRACT #29).
 *
 * Ported from `addPricingRule` / `addClosure` in src/app/app/actions.ts rather
 * than called: those read the org from a cookie session, take FormData with
 * `wd_0`…`wd_6` checkboxes, and revalidate a page this client never loads.
 * What survives the port is what matters — the refusals, word for word, and
 * the `INSERT … SELECT` that ties a rule to a space **in this organisation**,
 * so a foreign space id writes nothing rather than relying on a check somebody
 * could forget to make.
 *
 * Every time here is venue-local wall clock. A pricing rule stores `time`
 * columns, which have no zone at all; a closure is an instant, and it is built
 * with `make_timestamptz(..., timezone)` **in Postgres**. Binding a wall-clock
 * string and casting it in Node would round-trip through the *process*
 * timezone and silently shift the window — which is the same trap
 * `calendar-json.ts` documents, and the reason both go through the database.
 */

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export type PricingRuleInput = {
  label?: unknown;
  weekdays?: unknown;
  startsAt?: unknown;
  endsAt?: unknown;
  priceCents?: unknown;
};

export type PricingRule = {
  label: string | null;
  weekdays: number[];
  startsAt: string;
  endsAt: string;
  priceCents: number;
};

/** The app's own `PricingRuleInput.validate`, in the same words. */
export function pricingProblem(input: PricingRuleInput): string | null {
  const { label, weekdays, startsAt, endsAt, priceCents } = input;

  if (!Array.isArray(weekdays) || weekdays.length === 0) return "Pick at least one day.";
  if (weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
    return "Pick at least one day.";
  }
  if (typeof startsAt !== "string" || !TIME.test(startsAt)) return "Use HH:MM.";
  if (typeof endsAt !== "string" || !TIME.test(endsAt)) return "Use HH:MM.";
  // String comparison is enough because both are zero-padded 24-hour clock.
  if (endsAt <= startsAt) return "The end time must be after the start.";
  if (typeof label === "string" && label.trim().length > 60) return "Keep the label short.";
  if (
    priceCents != null &&
    (typeof priceCents !== "number" ||
      !Number.isInteger(priceCents) ||
      priceCents < 0 ||
      priceCents > 100_000_000)
  ) {
    return "That price isn't valid.";
  }
  return null;
}

export function pricingRule(input: PricingRuleInput): PricingRule {
  const label = typeof input.label === "string" ? input.label.trim() : "";
  return {
    label: label || null,
    weekdays: [...new Set(input.weekdays as number[])].sort((a, b) => a - b),
    startsAt: input.startsAt as string,
    endsAt: input.endsAt as string,
    priceCents: typeof input.priceCents === "number" ? input.priceCents : 0,
  };
}

/** True when the rule was written — false means the space isn't this venue's. */
export async function addPricingRule(
  organizationId: string,
  spaceId: string,
  rule: PricingRule,
): Promise<boolean> {
  const rows = await sql`
    INSERT INTO pricing_rule (organization_id, space_id, label, weekdays, starts_at, ends_at, price_cents)
    SELECT ${organizationId}, s.id, ${rule.label}, ${rule.weekdays}::smallint[],
           ${rule.startsAt}, ${rule.endsAt}, ${rule.priceCents}
    FROM space s
    WHERE s.id = ${spaceId}::uuid AND s.organization_id = ${organizationId}
    RETURNING id
  `;
  return rows.length > 0;
}

export async function removePricingRule(
  organizationId: string,
  ruleId: string,
): Promise<boolean> {
  const rows = await sql`
    DELETE FROM pricing_rule
    WHERE id = ${ruleId}::uuid AND organization_id = ${organizationId}
    RETURNING id
  `;
  return rows.length > 0;
}

export type ClosureWindow = { from: WallClock; to: WallClock };

/**
 * A closure from the space editor, which — unlike a block put in from the
 * calendar (#19) — may run across days: a venue closes for a long weekend, not
 * for an afternoon.
 */
export function closureWindow(input: {
  date?: unknown;
  from?: unknown;
  toDate?: unknown;
  to?: unknown;
}): ClosureWindow | string {
  const fromDate = typeof input.date === "string" ? input.date : "";
  // A same-day closure may leave the end date out.
  const toDate = typeof input.toDate === "string" && input.toDate ? input.toDate : fromDate;

  const from = wallClock(fromDate, typeof input.from === "string" ? input.from : "");
  const to = wallClock(toDate, typeof input.to === "string" ? input.to : "");
  if (!from || !to) return "Please give a valid start and end.";

  const ordered =
    `${fromDate} ${input.from as string}` < `${toDate} ${input.to as string}`;
  if (!ordered) return "Please give a valid start and end.";

  return { from, to };
}

export function reasonProblem(reason: unknown): string | null {
  if (reason == null) return null;
  if (typeof reason !== "string") return "Keep the reason short.";
  return reason.trim().length > 200 ? "Keep the reason short." : null;
}

/**
 * Writes the closure. A null `spaceId` shuts the **whole venue**, which is a
 * real thing an owner does — a public holiday, a typhoon — and is why the
 * space editor shows venue-wide closures it cannot edit alongside its own.
 *
 * Returns false only when a space was named and it is not this venue's.
 */
export async function addClosure(
  organizationId: string,
  timezone: string,
  spaceId: string | null,
  window: ClosureWindow,
  reason: string | null,
): Promise<boolean> {
  if (spaceId) {
    const [space] = await sql<{ id: string }[]>`
      SELECT id FROM space
      WHERE id = ${spaceId}::uuid AND organization_id = ${organizationId}
    `;
    if (!space) return false;
  }

  const { from, to } = window;
  await sql`
    INSERT INTO closure (organization_id, space_id, starts_at, ends_at, reason)
    VALUES (
      ${organizationId},
      ${spaceId},
      make_timestamptz(${from.y}, ${from.mo}, ${from.day}, ${from.h}, ${from.mi}, 0, ${timezone}),
      make_timestamptz(${to.y}, ${to.mo}, ${to.day}, ${to.h}, ${to.mi}, 0, ${timezone}),
      ${reason}
    )
  `;
  return true;
}

export async function removeClosure(
  organizationId: string,
  closureId: string,
): Promise<boolean> {
  const rows = await sql`
    DELETE FROM closure
    WHERE id = ${closureId}::uuid AND organization_id = ${organizationId}
    RETURNING id
  `;
  return rows.length > 0;
}
