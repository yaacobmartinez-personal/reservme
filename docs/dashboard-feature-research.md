# What a venue-management dashboard actually needs — feature research

**Date:** 2026-08-17 · Desk research across the platforms ReservMe competes with,
one per vertical: **Skedda** (courts/desks/rooms), **CourtReserve** &
**Upper Hand** (racket sports), **Mindbody** (fitness/studios), **SevenRooms**
(restaurants), **FareHarbor** (tours). Sources at the bottom.

## The headline

ReservMe has the hard part — a race-safe booking engine, multi-tenant auth, a
public booking page, and now an analytics dashboard. What it's thin on is the
**management surface**: the day-to-day operational and business tooling a venue
owner opens every morning and lives in. Mature platforms in this space converge
on **~12 pillars**. ReservMe today meaningfully covers about **2½** of them.

This isn't a criticism of the build — it's the difference between a booking
*widget* and a business *operating system*, which is what these owners pay for.

---

## The 12 pillars — what they do, what we have, what's missing

Legend: 🟢 solid · 🟡 partial · 🔴 missing.

### 1. Analytics & reporting — 🟡
Mature: utilisation by space/day/hour, revenue, attendance, retention,
lead-conversion; **exportable** reports and **scheduled report delivery**;
multi-location roll-up (Skedda "Insights", Mindbody reports, CourtReserve
"court utilisation, staff time, dedicated members").
- **Have:** KPIs w/ deltas, revenue & utilisation trends, peak-hours heatmap,
  booking mix, revenue-by-space, basic customers panel.
- **Missing:** CSV/PDF **export**, scheduled/emailed reports, financial reports
  (by staff, by program, tax-ready), cohort/retention, multi-location roll-up.

### 2. Customer / guest CRM — 🔴 (biggest single gap)
Mature: rich profiles that build themselves — visit history, preferences,
allergies/notes, tags ("wine lover", "left-handed coach"), **lifetime value**,
no-show history, VIP flags, and **segmentation** for marketing. SevenRooms boasts
"100+ data points per guest"; this is their whole moat.
- **Have:** a `customer` row (name/email/phone/no_show_count) + a top-customers
  widget. No way to open a customer.
- **Missing:** a **Customers section** — searchable list, profile pages (history,
  spend/LTV, no-shows, notes, tags), segments. The data already exists; this is
  presentation + a couple of queries.

### 3. Operational calendar / schedule view — 🔴
Mature: a visual **day/week calendar** with a column per court/room/table,
drag-to-reschedule, and — critically — **staff creating bookings and walk-ins**
directly (FareHarbor manifest, every court tool's grid).
- **Have:** a public slot grid + a run-sheet **list** for today.
- **Missing:** an owner-facing **calendar grid** across all spaces (the
  operational heart of these products), **manual/phone/walk-in booking entry**,
  drag-to-move/reschedule, block-off.

### 4. Memberships, packages & passes — 🔴
Mature: recurring **memberships** with auto-renew billing, **class packs / punch
passes / credits**, tiered plans (CourtReserve, Mindbody). This is how venues get
predictable, recurring revenue and retention.
- **Have:** nothing (packs/passes were designed in the plan, not built).
- **Missing:** the whole pillar — plans, recurring billing, credits, redemption.

### 5. Programming — classes, events, leagues — 🟡
Mature: class timetables, **event & league registration** with waitlists,
recurring sessions, brackets/standings, skill-based grouping (CourtReserve syncs
DUPR ratings; Mindbody class scheduling).
- **Have:** open-play **sessions** (shared capacity, seats).
- **Missing:** class timetables, event/league registration & management,
  recurring session generation, waitlists, brackets/ratings.

### 6. Payments, POS & finance — 🔴
Mature: take payment/deposits online, **refunds**, in-person **POS** for retail /
rentals / pro-shop / F&B, **gift cards**, payouts, tax handling, accounting sync
(Upper Hand POS, FareHarbor POS + gift cards, Mindbody POS).
- **Have:** a `payment` table; pay-at-venue only, nothing wired.
- **Missing:** payment collection (GCash-proof → PayMongo), deposits, refund UI,
  POS/add-ons, gift cards, financial statements. (Already the planned fast-follow
  — see `plan-billing.md` and `app-plan.md` §6.)

### 7. Staff management — 🟡
Mature: staff accounts with **granular role permissions**, staff **schedules /
shifts**, time tracking, **payroll & commissions** (Mindbody staff + payroll,
CourtReserve staff time).
- **Have:** Better Auth roles (owner/admin/member) in the data model.
- **Missing:** staff **invitation UI**, granular permissions, staff scheduling,
  commission/payroll.

### 8. Marketing, engagement & loyalty — 🔴
Mature: email/**SMS** campaigns, **automated flows** (win-back, birthday,
post-visit review request, first-timer→member), **promo/discount codes**,
**reviews & reputation**, **loyalty/points**, referral (Mindbody marketing,
SevenRooms automation + review funnels).
- **Have:** transactional confirmation + reminder emails only.
- **Missing:** campaigns, automations, promo codes, review collection, loyalty,
  referrals, SMS (matters a lot in PH — consider it early).

### 9. Waitlist & guest comms — 🟡
Mature: **waitlist** that auto-fills cancellations, **priority/VIP** ordering,
instant "a slot opened" alerts, two-way guest messaging (SevenRooms priority
alerts).
- **Have:** cancellation frees the slot; reminder emails.
- **Missing:** the waitlist itself (designed, not built), priority ordering,
  auto-fill alerts, guest messaging.

### 10. Booking rules & dynamic pricing — 🟡
Mature: a **rules engine** — per-member quotas, tiered access by membership,
auto-release, min/max notice, buffers, **peak/off-peak & dynamic pricing**,
promo pricing (Skedda's rules engine is a headline feature).
- **Have:** opening hours, closures, min-notice, max-horizon, buffers,
  cancellation policy.
- **Missing:** **peak/off-peak & member pricing**, per-member quotas, tiered
  access, discount rules.

### 11. Distribution & integrations — 🔴
Mature: **calendar sync** (Google/iCal), accounting (QuickBooks/Xero), **OTA /
reseller** channels, ratings (DUPR), Zapier/**public API**, hardware
(door access, POS) (FareHarbor OTA network, CourtReserve integrations/DUPR).
- **Have:** none (a calendar feed was mentioned, not built).
- **Missing:** Google/iCal export, accounting export, API/webhooks, rating sync,
  door/access control.

### 12. Multi-location / franchise — 🔴
Mature: manage several sites from one login with **roll-up reporting** and
per-site drill-down (Skedda multi-location, Mindbody, FareHarbor).
- **Have:** one venue per org (multi-site is a "quote" pricing band).
- **Missing:** multi-location management + roll-up. (Fine to defer.)

---

## What to build, in order (recommended)

Weighted by value to a PH court/studio-first soft launch and by how much
existing data/infrastructure it reuses.

**Now — makes it a usable operating system**
1. **Calendar / schedule view + manual & walk-in booking** (pillar 3). The single
   biggest "it's a real product" lift; staff need to see and create bookings, not
   just watch a public form. Reuses the booking engine directly.
2. **Customers / CRM section** (pillar 2). Searchable list + profile pages
   (history, LTV, no-shows, notes, tags). Data already exists — mostly queries + UI.
3. **Payments — GCash-proof then PayMongo** (pillar 6). Already the planned
   fast-follow; unlocks deposits and real revenue.

**Next — recurring revenue & retention**
4. **Memberships, packages & passes** (pillar 4) + **billing** (`plan-billing.md`).
5. **Programming: classes / events / leagues + waitlist** (pillars 5, 9).
6. **Promo codes + review requests + win-back email** (pillar 8) — cheap, high ROI;
   reuses the email/worker pipeline. Add **SMS** for PH.

**Then — polish & scale**
7. **Report exports (CSV/PDF) + Google Calendar sync** (pillars 1, 11) — low effort,
   high perceived value.
8. **Staff invitations + granular permissions** (pillar 7).
9. **Peak/off-peak & member pricing rules** (pillar 10).
10. **Multi-location roll-up** (pillar 12) — last.

Cross-cutting: a **global search** (bookings / customers / reference) and a
**notifications/activity feed** — every one of these products has both.

---

## Sources
- [Skedda — Insights / analytics dashboard](https://www.skedda.com/platform/analytics-insights-dashboard) · [Skedda platform](https://www.skedda.com/)
- [CourtReserve — club management features](https://courtreserve.com/) · [why clubs choose CourtReserve](https://courtreserve.com/9-reasons-why-club-owners-choose-courtreserve-for-club-management-software/) · [integrations / DUPR](https://courtreserve.com/tennis-pickleball-software-integrations/)
- [Upper Hand — court booking system](https://upperhand.com/court-booking-system/)
- [Mindbody — fitness software](https://www.mindbodyonline.com/business/fitness) · [staff management](https://www.mindbodyonline.com/business/staff-management)
- [SevenRooms — CRM & segmentation](https://sevenrooms.com/platform/crm/) · [reservations & waitlist](https://sevenrooms.com/platform/reservations-waitlist/)
- [FareHarbor — dashboard basics](https://help.fareharbor.com/getting-started/dashboard-basics/navigating-the-dashboard/) · [booking software for tour operators](https://marketing.fareharbor.com/blog/best-booking-software-for-tour-operators/)
