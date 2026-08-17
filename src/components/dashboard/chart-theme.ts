/**
 * Chart colours — mirror of src/app/tokens.css. Recharts renders SVG
 * stroke/fill attributes, which don't resolve CSS custom properties, so the
 * palette lives here as concrete values. Keep it in step with tokens.css.
 */
export const CHART = {
  accent: "oklch(48% 0.098 163)", // pine
  accentFill: "oklch(48% 0.098 163 / 0.14)",
  ink: "oklch(22% 0.014 70)",
  ink3: "oklch(52% 0.011 78)",
  grid: "oklch(90.5% 0.007 80)", // rule
  /** Categorical sequence for by-space etc. — the six brand swatches. */
  categorical: [
    "oklch(48% 0.098 163)", // pine
    "oklch(50% 0.108 236)", // ocean
    "oklch(60% 0.145 48)", // sunset
    "oklch(48% 0.132 296)", // violet
    "oklch(55% 0.145 12)", // rose
    "oklch(42% 0.024 250)", // slate
  ],
  status: {
    confirmed: "oklch(48% 0.098 163)", // pine
    cancelled: "oklch(72% 0.02 80)", // muted grey
    noShow: "oklch(63% 0.132 48)", // clay
  },
} as const;
