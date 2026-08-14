import { SITE } from "@/content/marketing";

/**
 * The mark is an occupancy ring — a faint full hour with a solid booked arc
 * laid over it. Same idea the product is built on, drawn in two paths.
 */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="size-[1.35em] shrink-0 text-accent"
      >
        <circle
          cx="12"
          cy="12"
          r="9"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.25"
          opacity="0.22"
        />
        <path
          d="M12 3a9 9 0 0 1 7.79 13.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.25"
          strokeLinecap="round"
        />
      </svg>
      <span className="font-display text-[1.15em] leading-none tracking-[-0.02em] text-ink">
        {SITE.name}
      </span>
    </span>
  );
}
