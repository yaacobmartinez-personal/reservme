"use client";

import { useEffect, useRef, useState } from "react";

const DURATION = 340;

/** cubic ease-out, matching --ease-out closely enough for a number roll. */
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * Motion primitive 3 of 3 — rolls a number to its new value instead of
 * snapping. Returns the target immediately on the server, on first paint,
 * and whenever the user has asked for reduced motion.
 */
export function useCountUp(target: number): number {
  const [value, setValue] = useState(target);
  const displayed = useRef(target);
  const firstRun = useRef(true);

  useEffect(() => {
    // First paint already renders the target; nothing to roll from.
    if (firstRun.current) {
      firstRun.current = false;
      displayed.current = target;
      return;
    }

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduced || displayed.current === target) {
      displayed.current = target;
      setValue(target);
      return;
    }

    const from = displayed.current;
    const start = performance.now();
    let frame = 0;

    const tick = (now: number) => {
      const progress = Math.min((now - start) / DURATION, 1);
      const next = Math.round(from + (target - from) * easeOut(progress));
      displayed.current = next;
      setValue(next);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);

    // This hook drives a price. requestAnimationFrame is paused in background
    // tabs, which would leave the roll stranded mid-way — showing a number that
    // is not what the customer would actually be charged. Guarantee the target
    // on a timer; if the animation did finish, this is a no-op re-render.
    const settle = window.setTimeout(() => {
      displayed.current = target;
      setValue(target);
    }, DURATION + 80);

    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(settle);
    };
  }, [target]);

  return value;
}
