/**
 * A space's photo, or a themed default when it has none. Presentational and
 * server-safe — shared by the owner Spaces cards, the edit-page uploader, and
 * the public booking widget's court cards. Fills its container; the caller sets
 * the aspect ratio.
 */
export function SpacePhoto({
  src,
  name,
  className = "",
}: {
  src: string | null;
  name: string;
  className?: string;
}) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt={name} className={`h-full w-full object-cover ${className}`} />
    );
  }
  return (
    <div
      className={`grid h-full w-full place-items-center bg-accent-soft ${className}`}
      aria-hidden="true"
    >
      <svg viewBox="0 0 48 48" className="size-10 text-accent-ink/35" fill="none">
        <rect x="7" y="11" width="34" height="26" rx="3" stroke="currentColor" strokeWidth="2" />
        <circle cx="17.5" cy="20.5" r="3.5" stroke="currentColor" strokeWidth="2" />
        <path
          d="M9 33l9-8 6 5 7-7 8 8"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
