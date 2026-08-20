import { describe, expect, it } from "vitest";
import { getDateWindow, getLocalDates } from "@/lib/venue";

const TZ = "Asia/Manila";
const DAY = 86_400_000;
const iso = (base: number, offset: number) =>
  new Date(base + offset * DAY).toISOString().slice(0, 10);

describe("getLocalDates", () => {
  it("returns `count` consecutive days from the offset", async () => {
    const rows = await getLocalDates(TZ, 7);
    expect(rows).toHaveLength(7);
    const base = Date.parse(rows[0].d);
    rows.forEach((r, i) => {
      expect(r.d).toBe(iso(base, i));
      expect(r.weekday).toMatch(/^[A-Z][a-z]{2}$/); // "Mon", "Tue", …
      expect(r.day).toMatch(/^\d{2}$/);
    });
  });

  it("honours the start offset", async () => {
    const [today] = await getLocalDates(TZ, 1);
    const [plusThree] = await getLocalDates(TZ, 1, 3);
    expect(Date.parse(plusThree.d) - Date.parse(today.d)).toBe(3 * DAY);
  });
});

describe("getDateWindow", () => {
  it("bounds the picker to [today, today + horizon]", async () => {
    const w = await getDateWindow(TZ, 30);
    expect(Date.parse(w.maxDate) - Date.parse(w.today)).toBe(30 * DAY);
    expect(w.activeDate).toBe(w.today);
    expect(w.prevWeekDate).toBeNull(); // week 0
    expect(w.nextWeekDate).not.toBeNull();
    expect(w.dates.length).toBeGreaterThan(0);
    expect(w.dates.length).toBeLessThanOrEqual(7);
    // The strip starts on the active week (today).
    expect(w.dates[0].d).toBe(w.today);
  });

  it("clamps a selection before today up to today", async () => {
    const w = await getDateWindow(TZ, 30, "2000-01-01");
    expect(w.activeDate).toBe(w.today);
  });

  it("clamps a selection past the horizon down to maxDate", async () => {
    const w = await getDateWindow(TZ, 30, "2999-01-01");
    expect(w.activeDate).toBe(w.maxDate);
  });

  it("pages the strip in week-aligned blocks and exposes prev/next", async () => {
    const base = Date.parse((await getDateWindow(TZ, 30)).today);
    // Pick a day in the second week (offset 9 → weekStart 7).
    const w = await getDateWindow(TZ, 30, iso(base, 9));
    expect(w.dates[0].d).toBe(iso(base, 7));
    expect(w.prevWeekDate).toBe(iso(base, 0));
    expect(w.nextWeekDate).toBe(iso(base, 14));
  });

  it("has no next-week link once the strip reaches the horizon", async () => {
    // horizon 6 fits in one week from today, so there is no next page.
    const w = await getDateWindow(TZ, 6);
    expect(w.nextWeekDate).toBeNull();
    expect(w.prevWeekDate).toBeNull();
  });
});
