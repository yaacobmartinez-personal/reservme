"use client";

import {
  Bar,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CHART } from "@/components/dashboard/chart-theme";
import type { GrowthPoint } from "@/lib/admin/queries";

/** "2026-08" → "Aug" (with the year on January, to anchor the axis). */
function shortMonth(month: string) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  return m === 1
    ? d.toLocaleDateString("en-PH", { month: "short", year: "2-digit" })
    : d.toLocaleDateString("en-PH", { month: "short" });
}

const axisTick = { fill: CHART.ink3, fontSize: 11 };

export function GrowthChart({ data }: { data: GrowthPoint[] }) {
  const rows = data.map((d) => ({ ...d, label: shortMonth(d.month) }));

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
          <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} />
          <YAxis yAxisId="left" tick={axisTick} tickLine={false} axisLine={false} allowDecimals={false} />
          <YAxis
            yAxisId="right"
            orientation="right"
            tick={axisTick}
            tickLine={false}
            axisLine={false}
            allowDecimals={false}
          />
          <Tooltip
            contentStyle={{
              borderRadius: 10,
              border: `1px solid ${CHART.grid}`,
              fontSize: 12,
            }}
            formatter={(value, name) => [
              value as number,
              name === "cumulative"
                ? "Total venues"
                : name === "signups"
                  ? "New venues"
                  : "Cancellations",
            ]}
          />
          <Bar yAxisId="left" dataKey="signups" fill={CHART.accent} radius={[3, 3, 0, 0]} maxBarSize={26} />
          <Bar yAxisId="left" dataKey="cancellations" fill={CHART.status.noShow} radius={[3, 3, 0, 0]} maxBarSize={26} />
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="cumulative"
            stroke={CHART.ink}
            strokeWidth={2}
            dot={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
