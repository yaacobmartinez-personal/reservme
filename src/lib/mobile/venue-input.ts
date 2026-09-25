import { RESERVED_SLUGS } from "@/content/legal";
import { slugify } from "@/lib/slug";

/**
 * Validation for POST /mobile/venues and its slug check (API-CONTRACT #27).
 *
 * The messages below are copied from the app's own `VenueInput.validate`
 * (lib/features/onboarding/domain/onboarding_input.dart). That is not
 * duplication for its own sake — the app validates locally so O3 can refuse
 * before a round trip, and the server validates because a client is not a
 * gatekeeper. When both say the same words, an owner who trips the rule sees
 * one refusal, not two different ones depending on which side caught it.
 */

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const MAX_SLUG_LENGTH = 48;
export const MAX_NAME_LENGTH = 120;
export const MAX_ADDRESS_LENGTH = 200;

/** Why this slug cannot be used, or null when the shape is fine. */
export function slugProblem(raw: string): string | null {
  const slug = raw.trim();
  if (!slug) return "Pick a booking-page address.";
  if (slug.length > MAX_SLUG_LENGTH) return "Keep the address under 48 characters.";
  if (!SLUG.test(slug)) return "Letters, numbers and dashes only.";
  // The apex serves these as its own pages, so a venue here would be shadowed
  // and its booking page unreachable.
  if (RESERVED_SLUGS.has(slug)) return "That address is taken by ReservMe itself.";
  return null;
}

export type VenueInput = {
  name: string;
  slug: string;
  timezone: string;
  currency: string;
  address?: string;
};

/** The first thing wrong with this venue, as `{field, message}`, or null. */
export function venueProblem(input: VenueInput): { field: string; message: string } | null {
  const name = input.name.trim();
  if (!name) return { field: "name", message: "Give your venue a name." };
  if (name.length > MAX_NAME_LENGTH) return { field: "name", message: "That name is too long." };

  const slug = slugProblem(input.slug);
  if (slug) return { field: "slug", message: slug };

  if (!input.timezone.trim()) return { field: "timezone", message: "Pick a timezone." };
  // A zone the server cannot resolve would make every rendered time quietly
  // wrong rather than obviously broken — the same refusal venue settings makes.
  if (!isResolvableTimezone(input.timezone.trim())) {
    return { field: "timezone", message: "We don't know that timezone." };
  }

  if (input.currency.trim().length !== 3) return { field: "currency", message: "Pick a currency." };
  if ((input.address ?? "").trim().length > MAX_ADDRESS_LENGTH) {
    return { field: "address", message: "That address is too long." };
  }
  return null;
}

export function isResolvableTimezone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** The app's `VenueInput.slugify`, and the web's, are the same function. */
export function suggestSlug(name: string): string {
  const base = slugify(name, "venue");
  return RESERVED_SLUGS.has(base) ? `${base}-venue` : base;
}
