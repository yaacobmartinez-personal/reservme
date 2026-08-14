import { Button } from "@/components/ui/button";
import { createSpace } from "../actions";

const FIELD =
  "h-11 w-full rounded-sm border border-rule bg-paper-2 px-3 text-[0.9375rem]";
const LABEL = "grid gap-1.5 text-[0.875rem] text-ink-2";

/**
 * The core fields for a new space. Kept minimal on purpose — a name and a
 * price is enough to be bookable, because creating the space also seeds a
 * default daily schedule (see createSpace). Everything else is refinable on
 * the edit page.
 */
function SpaceFields() {
  return (
    <div className="grid gap-4">
      <label className={LABEL}>
        <span>Name</span>
        <input name="name" required placeholder="Court 1" className={FIELD} />
      </label>

      <div className="grid grid-cols-2 gap-4">
        <label className={LABEL}>
          <span>Type</span>
          <input name="kind" defaultValue="court" className={FIELD} />
        </label>
        <label className={LABEL}>
          <span>
            Price <span className="text-ink-3">(₱ per slot)</span>
          </span>
          <input
            name="price"
            inputMode="decimal"
            placeholder="900"
            className={FIELD}
          />
        </label>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <label className={LABEL}>
          <span>Slot length</span>
          <select name="slotMinutes" defaultValue="60" className={FIELD}>
            <option value="30">30 min</option>
            <option value="60">1 hour</option>
            <option value="90">90 min</option>
            <option value="120">2 hours</option>
          </select>
        </label>
        <label className={LABEL}>
          <span>
            Buffer <span className="text-ink-3">(min)</span>
          </span>
          <input
            name="bufferMinutes"
            type="number"
            min={0}
            defaultValue={0}
            className={FIELD}
          />
        </label>
        <label className={LABEL}>
          <span>
            Capacity <span className="text-ink-3">(per session)</span>
          </span>
          <input
            name="capacity"
            type="number"
            min={1}
            defaultValue={1}
            className={FIELD}
          />
        </label>
      </div>
    </div>
  );
}

/**
 * First-run. Creating the space revalidates "/", so this same page re-renders
 * as the run sheet in place — no redirect, which also avoids resolving a
 * redirect across the app-host rewrite boundary.
 */
export function FirstSpace() {
  return (
    <form action={createSpace}>
      <SpaceFields />
      <Button type="submit" size="lg" className="mt-6 w-full">
        Add space & go live
      </Button>
      <p className="mt-3 text-center text-[0.8125rem] text-ink-3">
        Opens 8am–10pm daily to start — you can change the hours next.
      </p>
    </form>
  );
}

/** Add-another form on the Spaces list. */
export function AddSpace() {
  return (
    <form action={createSpace}>
      <SpaceFields />
      <Button type="submit" className="mt-6">
        Add space
      </Button>
    </form>
  );
}
