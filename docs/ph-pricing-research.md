# Philippine pricing research

Desk research, August 2026. Everything below is sourced; where a competitor
doesn't publish a number, it says so rather than guessing.

## The finding that forced a rewrite

Our original model was **$10 per bookable space / month**, copied from the
US/EU norm. At ₱61.23/USD (12 Aug 2026) that is **₱612 per space**:

| Venue | Old model | PlayServe (PH) |
| --- | --- | --- |
| 1 court | ₱612 | ₱999 |
| 4-court club | **₱2,448** | ₱999 |
| 8-court complex | **₱4,896** | ₱999 |

**Per-space pricing is not competitive in the Philippines.** The local market
has anchored on a *flat fee per venue*. A four-court club would have paid us 2.5×
what the incumbent charges, and an eight-court complex nearly 5×. The only band
where we won was the single-court operator — whom PlayServe overcharges at ₱999.

## Who is actually in this market

| Player | Model | Published price | Notes |
| --- | --- | --- | --- |
| **PlayServe** (Negros Oriental) | Flat per facility, unlimited courts | **₱999/mo** | The direct competitor. GCash/Maya/QR Ph, no cut per booking. 22 venues live. **Premium features are paid add-ons** — and their own copy says pricing "scales with court count and which modules you enable", which contradicts the flat headline |
| **CourtHub.ph** | Commission | **~3% on card bookings** (₱500 booking → ₱485 net) | No subscription. Cash bookings free |
| **Korte.ph**, **Courtly.ph** | Player-facing marketplaces | Not published | Discovery apps, not venue software. Venue economics undisclosed |
| **Courtsite** (Malaysia) | Tiered SaaS + transaction fee | RM99 / RM199 / custom (≈ ₱1,430 / ₱2,870) | Regional benchmark, not PH-domiciled |
| **Eat App** (restaurants) | Tiered SaaS, peso pricing | **from ~₱4,000/mo** | Shows a peso-priced restaurant tier exists well above court pricing |
| **Mindbody / Glofox** (fitness) | USD, enterprise | USD-billed | FX exposure is a live complaint for PH studios |

## Where the openings are

1. **PlayServe overcharges the single-space operator.** ₱999 for one court is
   steep. A genuine entry band under ₱500 takes that segment outright.
2. **Add-ons are the soft spot.** PlayServe gates premium modules; Courtsite
   gates by tier. "Every feature, whichever band you're in" is a claim neither
   can match without repricing.
3. **Commission vs subscription is winnable arithmetic.** At ₱500/hour and six
   bookings a day, CourtHub's ~3% on cards costs about **₱2,700/month** — more
   than double our mid band. That comparison is computable on stated
   assumptions, not an invented statistic.
4. **Nobody is priced in pesos across all verticals.** Court software is local;
   restaurant and studio software is USD-billed and expensive.

## Payments — the PH rails are not Stripe

Stripe has been available in PH since 2021 but PH accounts are restricted
(PHP payouts only, FX loss on USD), and it is **not** what local venues use.

Published PayMongo rates (June 2026):

| Method | Rate |
| --- | --- |
| QR Ph | 1.34% |
| Maya | 1.79% |
| GrabPay | 1.96% |
| ShopeePay | 1.70% |
| **GCash** | **2.23%** |
| Cards (domestic Visa/MC) | 3.125% + ₱13.39 |
| Cards (international) | 4.02% + ₱13.39, +1% cross-border |

Two architectural consequences:

- **Bring-your-own gateway.** The venue connects its own PayMongo or Xendit
  account; funds never touch us. That is what makes "0% commission" literally
  true rather than a pricing claim. **Xendit xenPlatform** is the local
  equivalent of Stripe Connect (sub-accounts, split settlement, platform fee)
  if we ever need to onboard venues that can't get their own merchant account —
  with the platform fee set to zero.
- **Manual GCash / bank transfer with proof approval is table stakes.** A large
  share of small PH venues take a GCash QR screenshot over Messenger. Supporting
  "customer uploads proof, owner approves" costs the venue nothing in gateway
  fees and matches how they already work. We had dropped this in favour of
  Stripe; for PH it has to come back.

## The model we shipped

Flat **per venue**, banded by space count, in pesos:

| Band | Spaces | Price | Positioned against |
| --- | --- | --- | --- |
| Solo | 1 | **₱499** | PlayServe's ₱999 for the same single court — half price |
| Club | 2–6 | **₱999** | Matches PlayServe's headline, but with no add-ons to unlock |
| Complex | 7–15 | **₱1,999** | Courtsite Advanced (≈₱2,870), Eat App (₱4,000+) |
| Multi-site | 16+ or several branches | Talk to us | — |

Yearly billing gives two months free. First month free on every band.

**Open decision:** prices are stated VAT-inclusive, which is the friendlier PH
convention. If ReservMe isn't VAT-registered yet, switch the line in
`src/content/marketing.ts` to "+ 12% VAT" — it is one string.

## Sources

- [PlayServe — Pickleball Booking App for the Philippines](https://playserve.co/pickleball-booking-app-philippines)
- [CourtHub.ph](https://courthub.ph/)
- [Korte.ph](https://korte.ph/)
- [Courtly.ph](https://www.courtly.ph/)
- [Courtsite pricing](https://business.courtsite.my/pricing)
- [PayMongo — transaction fees, rates and charges](https://www.paymongo.com/academy/transaction-fees-rates-and-charges)
- [PayMongo — accept payments](https://www.paymongo.com/products/accept-payments)
- [Xendit xenPlatform](https://www.xendit.co/en-ph/products/xenplatform/)
- [Eat App — best restaurant reservation software in the Philippines (2026)](https://restaurant.eatapp.co/blog/best-restaurant-reservation-software-apps-in-the-philippines-2026)
- [Is Stripe available in the Philippines in 2026?](https://hynogo.com/blog/is-stripe-available-in-philippines-2026)
- [USD/PHP spot rate, August 2026](https://tradingeconomics.com/philippines/currency)
