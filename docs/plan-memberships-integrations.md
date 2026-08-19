# Plan — Memberships/passes + Distribution & integrations

Two Open pillars from the State of ReservMe. Payments stay pay-at-venue /
proof-based (consistent with subscription billing), so this is the **foundation**:
owners define and sell plans, credits are tracked and consumed at booking; the
online card/GCash charge is a later, separate pillar.

## A. Memberships, packages & passes  (migration 0014)

**Model**
- `membership_plan` — org, name, `kind` (`pass` = one-time credit pack |
  `membership` = recurring), `price_cents`, `credits` (booking credits granted;
  null = none), `period` (`one_time` | `monthly`), `benefit_discount_pct`
  (optional % off bookings), `valid_days` (validity window; null = no expiry),
  `active`. Unique (org, name).
- `customer_membership` — a customer's holding: org, customer, plan,
  `credits_remaining`, `status` (active|expired|cancelled), `starts_at`,
  `expires_at`.
- `membership_redemption` — org, customer_membership, reservation (set null),
  `credits_used`, `discount_cents`. One row per booking that used a benefit.

**Redemption** (applied after promo, on the remaining amount)
1. A live holding with `credits_remaining > 0` → consume 1 credit atomically,
   the booking is covered (amount → 0), record credits_used=1.
2. Else if the plan has `benefit_discount_pct` → discount the remaining amount.
- Consumed on **both** the public path (auto-applied by the booking email — a
  returning customer with a pack gets the benefit; accepted trade-off: no
  customer login yet, so an email alone can spend credits) and the staff manual
  booking.

**UI**
- New **Memberships** nav page: define plans (CRUD + activate/deactivate).
- CRM profile: "Passes & memberships" section — active holdings (credits, expiry)
  + Grant a plan to this customer.

**Test** `test-memberships`: grant → credit consumed at booking (amount 0) +
redemption recorded + balance decremented; exhaustion falls back to discount %;
expiry; owner isolation.

Out of scope: online purchase/charge, auto-renew billing, member-only pricing
tiers per space, family/shared credits.

## B. Distribution & integrations  (migration 0015)

**1. iCal feed** — `venue.ical_token`. Route `GET /api/calendar/[token]` →
`text/calendar` of upcoming confirmed bookings for that org. Settings shows the
private URL + regenerate.

**2. Outbound webhooks** — `webhook_endpoint` (org, url, secret, events[],
active). On `booking.created` / `booking.cancelled`, fan out a pg-boss delivery
job that POSTs a JSON payload signed `X-ReservMe-Signature: sha256=…` (HMAC of
the body with the endpoint secret); pg-boss owns retries. Settings UI to add /
reveal secret / delete.

**3. Read API + keys** — `api_key` (org, name, key_prefix, key_hash,
last_used_at, revoked_at). `Authorization: Bearer <key>` resolves the org.
Endpoints `GET /api/v1/spaces`, `GET /api/v1/bookings`. Key shown once on
creation; stored as SHA-256. Settings UI to create / list / revoke.

**4. Accounting CSV** — `GET /app/export/transactions`: date, reference,
customer, space, status, gross, discount, net — a finance-oriented export
alongside the existing bookings/customers CSVs.

**Tests** `test-integrations`: iCal feed lists an org's bookings only; webhook
signature verifies + fan-out picks active endpoints for the event; API key
hash/verify + revoked keys rejected + cross-org isolation; transactions CSV rows.

Out of scope: OAuth Google Calendar two-way sync, inbound webhooks, write API,
door/access hardware, per-endpoint delivery dashboards.
