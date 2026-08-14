import Link from "next/link";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

type Variant = "solid" | "outline" | "ghost";
type Size = "md" | "lg";

const BASE = [
  "group/btn inline-flex items-center justify-center gap-2",
  "whitespace-nowrap rounded-pill font-medium",
  // Motion primitive 2 of 3 — hover lift. Transform + colour only.
  "transition-[transform,background-color,border-color,color,box-shadow]",
  "duration-[--dur-base] ease-out",
  "hover:-translate-y-px active:translate-y-0 active:duration-[--dur-fast]",
  "disabled:pointer-events-none disabled:opacity-45 aria-disabled:opacity-45",
  "motion-reduce:transform-none motion-reduce:transition-none",
].join(" ");

const VARIANTS: Record<Variant, string> = {
  solid: [
    "bg-accent text-on-accent shadow-plate",
    "hover:bg-accent-hover hover:shadow-lift",
    "active:bg-accent-ink active:shadow-plate",
  ].join(" "),
  outline: [
    "border border-rule-strong bg-card text-ink shadow-plate",
    "hover:border-ink hover:shadow-lift",
    "active:bg-paper-3 active:shadow-plate",
  ].join(" "),
  ghost: "text-ink-2 hover:text-ink hover:bg-paper-3",
};

const SIZES: Record<Size, string> = {
  md: "h-11 px-5 text-[0.9375rem]",
  lg: "h-13 px-6 text-base sm:px-7",
};

function classesFor(variant: Variant, size: Size, className?: string) {
  return [BASE, VARIANTS[variant], SIZES[size], className]
    .filter(Boolean)
    .join(" ");
}

type SharedProps = {
  variant?: Variant;
  size?: Size;
  className?: string;
  children: ReactNode;
};

type ButtonLinkProps = SharedProps & {
  href: string;
} & Omit<ComponentPropsWithoutRef<typeof Link>, "href" | "className" | "children">;

export function ButtonLink({
  href,
  variant = "solid",
  size = "md",
  className,
  children,
  ...rest
}: ButtonLinkProps) {
  return (
    <Link href={href} className={classesFor(variant, size, className)} {...rest}>
      {children}
    </Link>
  );
}

type ButtonProps = SharedProps &
  Omit<ComponentPropsWithoutRef<"button">, "className" | "children">;

export function Button({
  variant = "solid",
  size = "md",
  className,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button type={type} className={classesFor(variant, size, className)} {...rest}>
      {children}
    </button>
  );
}
