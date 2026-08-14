/** Postgres SQLSTATE for an exclusion constraint violation. */
export const EXCLUSION_VIOLATION = "23P01";

export type BookingFailure =
  | "slot_taken"
  | "session_full"
  | "outside_hours"
  | "too_soon"
  | "too_far_ahead"
  | "closed"
  | "space_inactive"
  | "bad_slot"
  | "not_found";

const MESSAGES: Record<BookingFailure, string> = {
  slot_taken: "That slot has just been taken. Pick another and we'll hold it for you.",
  session_full: "That session filled up while you were deciding.",
  outside_hours: "The venue isn't open then.",
  too_soon: "That's too close to the start time to book online.",
  too_far_ahead: "That's further ahead than this venue takes bookings.",
  closed: "The venue is closed then.",
  space_inactive: "That space isn't taking bookings right now.",
  bad_slot: "That isn't a bookable slot for this space — it may have changed. Please pick again.",
  not_found: "We couldn't find what you were trying to book.",
};

export class BookingError extends Error {
  readonly reason: BookingFailure;

  constructor(reason: BookingFailure) {
    super(MESSAGES[reason]);
    this.name = "BookingError";
    this.reason = reason;
  }
}

/** Deadlock detected. */
export const DEADLOCK_DETECTED = "40P01";
/** Serialization failure. */
export const SERIALIZATION_FAILURE = "40001";

function sqlState(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? (error as { code?: string }).code
    : undefined;
}

/**
 * True when Postgres rejected a write because it would have overlapped a live
 * reservation. This is the happy path of losing a race, not a bug — see
 * `reservation_no_overlap` in drizzle/0000_init.sql.
 */
export function isSlotTakenError(error: unknown): boolean {
  return sqlState(error) === EXCLUSION_VIOLATION;
}

/**
 * True when the write failed for contention rather than for a decided reason,
 * and is worth attempting again.
 *
 * Exclusion constraints deadlock under load by design: Postgres inserts the
 * tuple first and only then scans the index for conflicts, so two concurrent
 * transactions can each insert and then each find the other's uncommitted row.
 * One gets killed with 40P01. That is not an answer about the slot — it is a
 * dropped question, and the caller should ask again.
 */
export function isTransientConflict(error: unknown): boolean {
  const code = sqlState(error);
  return code === DEADLOCK_DETECTED || code === SERIALIZATION_FAILURE;
}

/**
 * Retries a write that failed on contention. Never retries an exclusion
 * violation — 23P01 is a decided answer and repeating it just wastes a
 * round trip and misleads the customer.
 */
export async function withContentionRetry<T>(
  operation: () => Promise<T>,
  attempts = 5,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isTransientConflict(error)) throw error;
      lastError = error;
      // Full jitter, so retries of a pile-up don't re-collide in lockstep.
      const ceiling = 8 * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, Math.random() * ceiling));
    }
  }

  throw lastError;
}
