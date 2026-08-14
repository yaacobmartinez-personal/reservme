import type { ReactNode } from "react";

type RevealProps = {
  children: ReactNode;
  className?: string;
};

/**
 * Below-the-fold scroll reveal. A server component — the animation is driven
 * entirely by CSS `animation-timeline: view()` (see globals.css `[data-reveal]`).
 * No hydration, no IntersectionObserver, no client JS.
 *
 * Where scroll-driven animations aren't supported, the element is plainly
 * visible. There is no state in which content can be stranded hidden.
 *
 * Above the fold, use `Enter` instead — a load-time animation, since there is
 * no scroll to drive anything yet.
 */
export function Reveal({ children, className }: RevealProps) {
  return (
    <div className={className} data-reveal="">
      {children}
    </div>
  );
}
