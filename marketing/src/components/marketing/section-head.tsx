import type { ReactNode } from "react";
import { Reveal } from "@/components/marketing/reveal";

type SectionHeadProps = {
  title: ReactNode;
  lede?: ReactNode;
  /** Centred heads are used once, on the closing pricing block. */
  align?: "start" | "center";
  className?: string;
};

/**
 * Heading and lede always stack in a single column. The tag-left /
 * heading-right split is banned outright — it is the loudest templated
 * -editorial tell there is.
 */
export function SectionHead({
  title,
  lede,
  align = "start",
  className = "",
}: SectionHeadProps) {
  const centred = align === "center";

  return (
    <Reveal className={className}>
      <div className={centred ? "mx-auto max-w-2xl text-center" : "max-w-2xl"}>
        <h2 className="text-head text-balance">{title}</h2>
        {lede ? (
          <p className="mt-5 text-sub text-ink-2 text-pretty">{lede}</p>
        ) : null}
      </div>
    </Reveal>
  );
}
