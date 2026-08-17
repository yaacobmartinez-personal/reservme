import Link from "next/link";
import { RANGES, type DashboardData, type RangeKey } from "@/lib/analytics";
import { apexUrl } from "@/lib/env";
import { formatMoney } from "@/lib/money";
import type { ActiveVenue } from "@/lib/tenancy";
import {
  BookingMixDonut,
  RevenueTrend,
  SpaceBars,
  UtilisationTrend,
} from "./charts";
import {
  CustomersPanel,
  KpiTile,
  NeedsYou,
  Panel,
  PeakHeatmap,
  RunSheet,
} from "./panels";

type RunRow = Parameters<typeof RunSheet>[0]["runSheet"][number];

function PeriodSelector({ active, basePath }: { active: RangeKey; basePath: string }) {
  return (
    <div className="inline-flex rounded-pill border border-rule bg-card p-1 shadow-plate">
      {RANGES.map((r) => {
        const on = r.key === active;
        return (
          <Link
            key={r.key}
            href={`${basePath}?range=${r.key}`}
            aria-current={on ? "page" : undefined}
            className={[
              "rounded-pill px-3 py-1.5 text-[0.8125rem] transition-colors duration-[--dur-fast] ease-out",
              on ? "bg-ink text-paper" : "text-ink-2 hover:bg-paper-3 hover:text-ink",
            ].join(" ")}
          >
            {r.label}
          </Link>
        );
      })}
    </div>
  );
}

export function Dashboard({
  venue,
  data,
  runSheet,
  activeRange,
  basePath = "/",
}: {
  venue: ActiveVenue;
  data: DashboardData;
  runSheet: RunRow[];
  activeRange: RangeKey;
  /** Where the period tabs link — "/" on the owner dashboard, "/viewing" when impersonating. */
  basePath?: string;
}) {
  const today = new Intl.DateTimeFormat("en-PH", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: venue.timezone,
  }).format(new Date());
  const bookingUrl = apexUrl(`/${venue.slug}`);
  const k = data.kpis;

  return (
    <div className="space-y-4">
      {/* Header */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="label text-ink-3">{today}</p>
          <h1 className="mt-2 text-head">{venue.name}</h1>
          <p className="mt-1 text-[0.875rem] text-ink-2">
            <a
              href={bookingUrl}
              className="rounded-xs text-accent underline decoration-accent-line underline-offset-4 hover:decoration-accent"
            >
              {bookingUrl.replace(/^https?:\/\//, "")}
            </a>
          </p>
        </div>
        <PeriodSelector active={activeRange} basePath={basePath} />
      </header>

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiTile
          label="Booked value"
          value={formatMoney(k.bookedValueCents.value, venue.currency)}
          deltaPct={k.bookedValueCents.deltaPct}
          series={k.bookedValueCents.series}
        />
        <KpiTile
          label="Bookings"
          value={String(k.bookings.value)}
          deltaPct={k.bookings.deltaPct}
          series={k.bookings.series}
        />
        <KpiTile
          label="Utilisation"
          value={`${k.utilisationPct.value}%`}
          deltaPct={k.utilisationPct.deltaPct}
          series={k.utilisationPct.series}
        />
        <KpiTile
          label="No-show rate"
          value={`${k.noShowRatePct.value}%`}
          deltaPct={k.noShowRatePct.deltaPct}
          series={k.noShowRatePct.series}
          higherIsBetter={false}
        />
      </div>

      {/* Revenue + mix */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel title="Booked value" hint="not yet collected" className="lg:col-span-2">
          <RevenueTrend data={data.revenueSeries} currency={venue.currency} />
        </Panel>
        <Panel title="Booking mix">
          <BookingMixDonut
            confirmed={data.bookingMix.confirmed}
            cancelled={data.bookingMix.cancelled}
            noShow={data.bookingMix.noShow}
          />
        </Panel>
      </div>

      {/* Utilisation + needs you */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel title="Utilisation" hint="% of open hours booked" className="lg:col-span-2">
          <UtilisationTrend data={data.utilisationSeries} />
        </Panel>
        <Panel title="Needs you">
          <NeedsYou needsYou={data.needsYou} currency={venue.currency} />
        </Panel>
      </div>

      {/* Peak hours */}
      <Panel title="When you're busy" hint="bookings by day & hour">
        <PeakHeatmap grid={data.peakHeatmap} />
      </Panel>

      {/* By space + customers */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Booked value by space">
          <SpaceBars data={data.bySpace} currency={venue.currency} />
        </Panel>
        <Panel title="Customers">
          <CustomersPanel customers={data.customers} />
        </Panel>
      </div>

      {/* Run sheet — always today */}
      <Panel title="Today's run sheet">
        <RunSheet runSheet={runSheet} currency={venue.currency} />
      </Panel>
    </div>
  );
}
