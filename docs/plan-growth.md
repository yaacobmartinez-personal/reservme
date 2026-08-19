# Plan — Multi-location + Marketing/engagement/loyalty

Two Open pillars, built together. Each gets the pilot-relevant slice; the rest is
named as out of scope. One test + commit per feature.

---

## 1 · Multi-location / franchise

The org model already allows a user to belong to several organizations (Better
Auth), and each org = one venue. So multi-location is: create more venues, switch
between them, and see a roll-up.

- **Create a venue** from inside the app: `organization.create` + `/api/venue/init`
  + `setActive` (the same steps signup runs). A `/app/new-venue` page.
- **Venue switcher** in the app shell: the user's venues, `setActive` to switch,
  and "＋ New venue". Server provides `listUserVenues(userId)`.
- **Portfolio roll-up** `/app/portfolio`: totals (venues, upcoming, 30-day
  bookings + value) and a per-venue table with drill-in (switch to that venue).
- **Out of scope:** shared customers/staff across sites, cross-site booking,
  franchise permission tiers. Each venue stays an isolated tenant.
- **Test:** a user in two orgs sees both in the roll-up with correct per-venue
  stats; another user's venue isn't included.

## 2 · Marketing, engagement & loyalty

### Promo codes
- **Schema** `0011_marketing.sql`: `promo_code(org, code, kind[percent|amount],
  value, max_uses, uses, expires_at, active)` (unique code per org) +
  `promo_redemption(promo_code_id, reservation_id, discount_cents)`.
- **Apply at booking:** the public form gains an optional code; `bookSlot`
  validates it *before* booking, then after `reserveSpace` **atomically consumes**
  it (uses+1 under the cap), discounts the reservation's `amount_cents`, and
  records the redemption — so the confirmation email shows the discounted price.
- **Owner UI:** a **Marketing** page — create/deactivate codes, see uses.

### Engagement emails (worker)
- **Win-back:** a daily job emails customers with a past confirmed booking but
  none in 60 days (the CRM `at_risk` segment), once, tracked by `winback_at` on
  the customer.
- **Review request:** a few hours after a booking's end, email the customer a
  link to leave a review (owner sets `review_url` in settings). Reuses the
  booking-reminder scheduling pattern.

### Loyalty foundation
- Points accrue on a confirmed booking (`loyalty_points` on the customer, 1 pt per
  ₱100 of confirmed value), shown on the CRM profile. **Redemption is out of
  scope** (needs customer accounts / a points economy) — this is accrual +
  visibility.

- **Out of scope (named):** SMS, referrals, a campaign builder, loyalty
  redemption.
- **Test:** a promo discounts the charged amount and can't exceed its max uses;
  loyalty points accrue on a confirmed booking; win-back selects the right
  customers once.

---

**Verification (all):** each `test:*` green + `tsc`/`eslint`/`build` clean + a
browser pass. Migrations `0011` apply to Neon on deploy.
