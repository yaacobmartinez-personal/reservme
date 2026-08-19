import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { sql } from "@/db";
import { listApiKeys } from "@/lib/api-keys";
import { appUrl } from "@/lib/env";
import { getBranding, getClosures, getVenueSettings, listOwnerSpaces } from "@/lib/owner";
import { listInvitations, listMembers } from "@/lib/team";
import { requireVenue } from "@/lib/tenancy";
import { listWebhooks } from "@/lib/webhooks";
import { addClosure, removeClosure, updateVenueSettings } from "../actions";
import { BrandingSection } from "./branding";
import { IntegrationsSection } from "./integrations";
import { TeamSection } from "./team";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

const FIELD =
  "h-11 w-full rounded-sm border border-rule bg-paper-2 px-3 text-[0.9375rem]";
const LABEL = "grid gap-1.5 text-[0.875rem] text-ink-2";

// A short, PH-first list. Owners abroad can still type any IANA name — the
// column accepts it — but these cover the common cases without a huge dropdown.
const TIMEZONES = [
  "Asia/Manila",
  "Asia/Singapore",
  "Asia/Hong_Kong",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Europe/Madrid",
  "Europe/London",
  "America/Los_Angeles",
  "America/New_York",
];

export default async function SettingsPage() {
  const venue = await requireVenue();
  const [settings, closures, spaces, branding, members, invites, webhooks, apiKeys, icalRows] =
    await Promise.all([
      getVenueSettings(venue.organizationId),
      getClosures(venue.organizationId, venue.timezone),
      listOwnerSpaces(venue.organizationId),
      getBranding(venue.organizationId),
      listMembers(venue.organizationId),
      listInvitations(venue.organizationId),
      listWebhooks(venue.organizationId),
      listApiKeys(venue.organizationId),
      sql<{ ical_token: string }[]>`
        SELECT ical_token FROM venue WHERE organization_id = ${venue.organizationId}
      `,
    ]);
  if (!settings) notFound();

  const icalUrl = appUrl(`/api/calendar/${icalRows[0]?.ical_token ?? ""}`);
  const fmtDate = (d: Date | null) =>
    d
      ? new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeZone: venue.timezone }).format(d)
      : null;
  const apiKeyViews = apiKeys.map((k) => ({
    id: k.id,
    name: k.name,
    keyPrefix: k.keyPrefix,
    lastUsedAt: fmtDate(k.lastUsedAt),
    createdAt: fmtDate(k.createdAt) ?? "",
    revokedAt: fmtDate(k.revokedAt),
  }));

  return (
    <main className="flex-1 py-10 sm:py-14">
      <div className="shell-wide">
        <h1 className="text-head">Settings</h1>

        {/* Venue details + policy */}
        <section className="mt-8 rounded-xl border border-rule bg-card p-6 shadow-float sm:p-8">
          <form action={updateVenueSettings} className="grid gap-5">
            <h2 className="text-xl">Venue</h2>

            <label className={LABEL}>
              <span>Name</span>
              <input name="name" required defaultValue={settings.name} className={FIELD} />
            </label>

            <label className={LABEL}>
              <span>Tagline</span>
              <input
                name="tagline"
                defaultValue={settings.tagline ?? ""}
                placeholder="Two panoramic courts on Katipunan Ave."
                className={FIELD}
              />
            </label>

            <label className={LABEL}>
              <span>Address</span>
              <input
                name="address"
                defaultValue={settings.address ?? ""}
                className={FIELD}
              />
            </label>

            <div className="grid grid-cols-2 gap-4">
              <label className={LABEL}>
                <span>Timezone</span>
                <select name="timezone" defaultValue={settings.timezone} className={FIELD}>
                  {[...new Set([settings.timezone, ...TIMEZONES])].map((tz) => (
                    <option key={tz} value={tz}>
                      {tz}
                    </option>
                  ))}
                </select>
              </label>
              <label className={LABEL}>
                <span>Currency</span>
                <input
                  name="currency"
                  defaultValue={settings.currency}
                  maxLength={3}
                  className={`${FIELD} uppercase`}
                />
              </label>
            </div>

            <h2 className="mt-2 text-xl">Booking policy</h2>

            <div className="grid grid-cols-2 gap-4">
              <label className={LABEL}>
                <span>Min notice (minutes)</span>
                <input
                  name="minNoticeMinutes"
                  type="number"
                  min={0}
                  defaultValue={settings.minNoticeMinutes}
                  className={FIELD}
                />
              </label>
              <label className={LABEL}>
                <span>Book up to (days ahead)</span>
                <input
                  name="maxHorizonDays"
                  type="number"
                  min={1}
                  defaultValue={settings.maxHorizonDays}
                  className={FIELD}
                />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <label className={LABEL}>
                <span>Online cancellation</span>
                <select
                  name="cancellationMode"
                  defaultValue={settings.cancellationMode}
                  className={FIELD}
                >
                  <option value="anytime">Any time before start</option>
                  <option value="grace">Up to a cutoff</option>
                  <option value="never">Not online</option>
                </select>
              </label>
              <label className={LABEL}>
                <span>Cutoff (hours before)</span>
                <input
                  name="cancellationGraceHours"
                  type="number"
                  min={0}
                  defaultValue={settings.cancellationGraceHours}
                  className={FIELD}
                />
              </label>
            </div>

            <label className={LABEL}>
              <span>Refund terms (shown before payment)</span>
              <textarea
                name="refundTerms"
                rows={2}
                defaultValue={settings.refundTerms ?? ""}
                className="w-full rounded-sm border border-rule bg-paper-2 px-3 py-2 text-[0.9375rem]"
              />
            </label>

            <label className={LABEL}>
              <span>GCash name (for pay-by-proof)</span>
              <input
                name="gcashName"
                defaultValue={settings.gcashName ?? ""}
                className={FIELD}
              />
            </label>

            <Button type="submit" className="justify-self-start">
              Save settings
            </Button>
          </form>
        </section>

        <BrandingSection
          initial={branding}
          venueName={settings.name}
          tagline={settings.tagline}
        />

        <TeamSection
          organizationId={venue.organizationId}
          members={members}
          invites={invites}
          canManage={venue.role === "owner" || venue.role === "admin"}
        />

        {/* Closures */}
        <section className="mt-6 rounded-xl border border-rule bg-card p-6 shadow-float sm:p-8">
          <h2 className="text-xl">Closures</h2>
          <p className="mt-1 text-[0.875rem] text-ink-3">
            Block out a holiday, a private event, or maintenance. Times are in{" "}
            {venue.timezone}.
          </p>

          {closures.length > 0 ? (
            <ul className="mt-5 space-y-2">
              {closures.map((closure) => (
                <li
                  key={closure.id}
                  className="flex items-center justify-between gap-3 rounded-sm border border-rule bg-paper-2 px-4 py-3"
                >
                  <span className="min-w-0">
                    <span className="block text-[0.9375rem]">{closure.label}</span>
                    <span className="block truncate text-[0.8125rem] text-ink-3">
                      {closure.spaceName ?? "Whole venue"}
                      {closure.reason ? ` · ${closure.reason}` : ""}
                    </span>
                  </span>
                  <form action={removeClosure}>
                    <input type="hidden" name="closureId" value={closure.id} />
                    <button
                      type="submit"
                      className="whitespace-nowrap rounded-pill px-3 py-1.5 text-[0.8125rem] text-ink-2 hover:bg-paper-3 hover:text-ink"
                    >
                      Remove
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-5 text-[0.875rem] text-ink-3">No upcoming closures.</p>
          )}

          <form action={addClosure} className="mt-6 grid gap-4 border-t border-rule pt-6">
            <label className={LABEL}>
              <span>Space</span>
              <select name="spaceId" defaultValue="" className={FIELD}>
                <option value="">Whole venue</option>
                {spaces.map((space) => (
                  <option key={space.id} value={space.id}>
                    {space.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-4">
              <label className={LABEL}>
                <span>From</span>
                <input name="startsAt" type="datetime-local" required className={FIELD} />
              </label>
              <label className={LABEL}>
                <span>To</span>
                <input name="endsAt" type="datetime-local" required className={FIELD} />
              </label>
            </div>
            <label className={LABEL}>
              <span>Reason (optional)</span>
              <input name="reason" placeholder="Holiday" className={FIELD} />
            </label>
            <Button type="submit" variant="outline" className="justify-self-start">
              Add closure
            </Button>
          </form>
        </section>

        <IntegrationsSection
          icalUrl={icalUrl}
          webhooks={webhooks.map((w) => ({
            id: w.id,
            url: w.url,
            secret: w.secret,
            events: w.events,
            active: w.active,
          }))}
          apiKeys={apiKeyViews}
        />
      </div>
    </main>
  );
}
