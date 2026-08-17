"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatMoney } from "@/lib/money";
import { CHART } from "./chart-theme";

/** "2026-08-14" → "Aug 14" for dense axes. */
function shortDay(day: string) {
  const d = new Date(`${day}T00:00:00`);
  return d.toLocaleDateString("en-PH", { month: "short", day: "numeric" });
}

const axisTick = { fill: CHART.ink3, fontSize: 11 };
const tooltipStyle = {
  contentStyle: {
    borderRadius: 10,
    border: "1px solid " + CHART.grid,
    fontSize: 12,
    boxShadow: "0 8px 24px -12px oklch(22% 0.014 70 / 0.18)",
  },
  labelStyle: { color: CHART.ink3, marginBottom: 2 },
};

export function RevenueTrend({
  data,
  currency,
}: {
  data: { day: string; cents: number }[];
  currency: string;
}) {
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
          <defs>
            <linearGradient id="revfill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART.accent} stopOpacity={0.22} />
              <stop offset="100%" stopColor={CHART.accent} stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="day"
            tickFormatter={shortDay}
            tick={axisTick}
            tickLine={false}
            axisLine={{ stroke: CHART.grid }}
            minTickGap={28}
          />
          <YAxis
            tickFormatter={(v: number) => formatMoney(v, currency)}
            tick={axisTick}
            tickLine={false}
            axisLine={false}
            width={62}
          />
          <Tooltip
            {...tooltipStyle}
            formatter={(v) => [formatMoney(Number(v), currency), "Booked"]}
            labelFormatter={(label) => shortDay(String(label))}
          />
          <Area
            type="monotone"
            dataKey="cents"
            stroke={CHART.accent}
            strokeWidth={2}
            fill="url(#revfill)"
            dot={false}
            activeDot={{ r: 4 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function UtilisationTrend({ data }: { data: { day: string; pct: number }[] }) {
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
          <XAxis
            dataKey="day"
            tickFormatter={shortDay}
            tick={axisTick}
            tickLine={false}
            axisLine={{ stroke: CHART.grid }}
            minTickGap={28}
          />
          <YAxis
            domain={[0, 100]}
            tickFormatter={(v: number) => `${v}%`}
            tick={axisTick}
            tickLine={false}
            axisLine={false}
            width={38}
          />
          <Tooltip
            {...tooltipStyle}
            formatter={(v) => [`${v}%`, "Utilisation"]}
            labelFormatter={(label) => shortDay(String(label))}
          />
          <Line
            type="monotone"
            dataKey="pct"
            stroke={CHART.accent}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function BookingMixDonut({
  confirmed,
  cancelled,
  noShow,
}: {
  confirmed: number;
  cancelled: number;
  noShow: number;
}) {
  const data = [
    { name: "Confirmed", value: confirmed, fill: CHART.status.confirmed },
    { name: "Cancelled", value: cancelled, fill: CHART.status.cancelled },
    { name: "No-show", value: noShow, fill: CHART.status.noShow },
  ].filter((d) => d.value > 0);
  const total = confirmed + cancelled + noShow;

  if (total === 0) {
    return <p className="py-12 text-center text-[0.875rem] text-ink-3">No bookings yet.</p>;
  }

  return (
    <div className="flex items-center gap-4">
      <div className="relative h-40 w-40 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              innerRadius={48}
              outerRadius={70}
              paddingAngle={2}
              stroke="none"
            >
              {data.map((d) => (
                <Cell key={d.name} fill={d.fill} />
              ))}
            </Pie>
            <Tooltip {...tooltipStyle} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-display text-2xl leading-none">{total}</span>
          <span className="text-[0.6875rem] text-ink-3">bookings</span>
        </div>
      </div>
      <ul className="space-y-2 text-[0.875rem]">
        {data.map((d) => (
          <li key={d.name} className="flex items-center gap-2">
            <span className="size-2.5 rounded-full" style={{ background: d.fill }} />
            <span className="text-ink-2">{d.name}</span>
            <span className="ml-auto font-mono tabular-nums">{d.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SpaceBars({
  data,
  currency,
}: {
  data: { name: string; cents: number }[];
  currency: string;
}) {
  const rows = data.filter((d) => d.cents > 0);
  if (rows.length === 0) {
    return <p className="py-12 text-center text-[0.875rem] text-ink-3">No booked value yet.</p>;
  }
  return (
    <div className="w-full" style={{ height: Math.max(120, rows.length * 44) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={rows}
          layout="vertical"
          margin={{ top: 4, right: 12, left: 4, bottom: 4 }}
        >
          <XAxis type="number" hide tickFormatter={(v: number) => formatMoney(v, currency)} />
          <YAxis
            type="category"
            dataKey="name"
            tick={{ fill: CHART.ink, fontSize: 12 }}
            tickLine={false}
            axisLine={false}
            width={110}
          />
          <Tooltip
            {...tooltipStyle}
            cursor={{ fill: "oklch(94.4% 0.011 80 / 0.5)" }}
            formatter={(v) => [formatMoney(Number(v), currency), "Booked"]}
          />
          <Bar dataKey="cents" radius={[0, 6, 6, 0]} maxBarSize={22}>
            {rows.map((_, i) => (
              <Cell key={i} fill={CHART.categorical[i % CHART.categorical.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
