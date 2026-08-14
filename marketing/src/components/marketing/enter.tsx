import type { CSSProperties, ReactNode } from "react";

type EnterProps = {
  children: ReactNode;
  className?: string;
  /** Stagger, in ms. Keep small — this delays content the user is waiting on. */
  delay?: number;
};

/**
 * Above-the-fold entrance animation. Pure CSS (see globals.css `[data-enter]`)
 * and a server component — no hydration, no observer, no JS of any kind.
 *
 * Use this for anything visible on load. Use `Reveal` only below the fold:
 * it hides its children from the server render and needs JS to un-hide them,
 * which above the fold means a blank screen on a slow phone.
 */
export function Enter({ children, className, delay = 0 }: EnterProps) {
  return (
    <div
      className={className}
      data-enter=""
      style={delay ? ({ "--enter-delay": `${delay}ms` } as CSSProperties) : undefined}
    >
      {children}
    </div>
  );
}
