/**
 * Shared, environment-independent marketing content — every string, price band,
 * hero fact and preview the marketing surface renders. NO runtime/env imports,
 * so both the root app (src/content/marketing.ts) and the standalone static
 * marketing site (marketing/src/content/marketing.ts) consume it. The only
 * environment-specific piece, AUTH (the sign-in / create-venue URLs), is defined
 * by each consumer on top of these exports.
 *
 * Rule of the house: no invented social proof. Every number is a product
 * decision we control (price, template count, commission rate) or derived from
 * data on this page — never a fabricated metric.
 */

/**
 * The two auth URLs a consumer wires. They live on the app host — a different
 * origin from the marketing surface — so they must be absolute. Injected into
 * the CTA-bearing content below (buildHero / buildPricing / buildClosing /
 * buildFooterGroups), which is why those are builders rather than constants.
 */
export type AuthLinks = { readonly login: string; readonly signup: string };

export const SITE = {
  name: "ReservMe",
  tagline: "Booking software for venues that run on reservations",
  description:
    "One branded booking page for courts, studios, private rooms, restaurants and tours. Live availability, instant confirmations, and no commission on any booking.",
  url: "https://reservme.pro",
  bookingDomain: "reservme.pro",
} as const;

/** Where "Contact" / "Talk to us" / "Support" point (a page on the apex). */
export const CONTACT_HREF = "/contact";

export const CURRENCY = { code: "PHP", symbol: "₱" } as const;

/** Formats whole pesos with thousands separators: 1999 → "₱1,999". */
export const peso = (amount: number) =>
  `${CURRENCY.symbol}${amount.toLocaleString("en-PH")}`;

/**
 * Flat price per venue, banded by how many spaces it runs — not per space.
 *
 * Per-space pricing is the US/EU norm and it is uncompetitive here: at ₱61/USD
 * our old $10/space put a four-court club at ₱2,448 against an incumbent
 * charging ₱999 flat. See docs/ph-pricing-research.md for the full workings.
 *
 * `maxSpaces: null` means the band has no ceiling and is quoted, not listed.
 */
export const PLANS = [
  {
    id: "solo",
    name: "Solo",
    minSpaces: 1,
    maxSpaces: 1,
    price: 499,
    blurb: "One court, one studio, one boat.",
  },
  {
    id: "club",
    name: "Club",
    minSpaces: 2,
    maxSpaces: 6,
    price: 999,
    blurb: "The size most clubs actually are.",
  },
  {
    id: "complex",
    name: "Complex",
    minSpaces: 7,
    maxSpaces: 15,
    price: 1999,
    blurb: "Multi-court centres and function venues.",
  },
  {
    id: "multi",
    name: "Multi-site",
    minSpaces: 16,
    maxSpaces: null,
    price: null,
    blurb: "Several branches, or more than fifteen spaces.",
  },
] as const;

export type Plan = (typeof PLANS)[number];

export const ENTRY_PRICE = PLANS[0].price;

/** Highest space count the calculator lists before handing over to a quote. */
export const MAX_LISTED_SPACES = PLANS[PLANS.length - 1].minSpaces;

export function planForSpaces(spaces: number): Plan {
  return (
    PLANS.find(
      (plan) =>
        spaces >= plan.minSpaces &&
        (plan.maxSpaces === null || spaces <= plan.maxSpaces),
    ) ?? PLANS[PLANS.length - 1]
  );
}

/** Yearly billing bills ten months. */
export const MONTHS_BILLED_YEARLY = 10;

export const NAV_LINKS = [
  { label: "Features", href: "#features" },
  { label: "How it works", href: "#how-it-works" },
  { label: "Pricing", href: "#pricing" },
  { label: "Questions", href: "#faq" },
] as const;

export const buildHero = (auth: AuthLinks) => ({
  badge: "First month free — built for Philippine venues",
  headline: "Your calendar fills itself.",
  lede: "One branded booking page for courts, studios, karaoke rooms, restaurants and island-hopping boats. Live availability, instant confirmation, every regular remembered — and not one centavo of commission.",
  primaryCta: { label: "Create your page", href: auth.signup },
  secondaryCta: { label: "See pricing", href: "#pricing" },
  footnote: `No card to start · from ${peso(ENTRY_PRICE)} a month, per venue · 0% commission, always`,
}) as const;

/** Facts that hold by construction — policy, price, or a count of what is on this page. */
export const HERO_FACTS = [
  { value: "0%", label: "commission — we never take a cut" },
  { value: peso(ENTRY_PRICE), label: "a month to start, priced per venue" },
  { value: "24", label: "venue templates to start from" },
  { value: "All-in-one", label: "booking, CRM, marketing & passes" },
] as const;

/* ── The live booking widget rendered in the hero ────────────────── */

export const BOOKING_PREVIEW = {
  venue: "Katipunan Padel",
  initial: "K",
  slug: `${SITE.bookingDomain}/katipunan`,
  space: "Court 2 · Panoramic",
  days: [
    { weekday: "Thu", date: "09" },
    { weekday: "Fri", date: "10", active: true },
    { weekday: "Sat", date: "11" },
    { weekday: "Sun", date: "12" },
  ],
  slots: [
    { time: "08:00", state: "open" },
    { time: "09:00", state: "taken" },
    { time: "10:00", state: "open" },
    { time: "11:00", state: "open" },
    { time: "13:00", state: "selected" },
    { time: "14:00", state: "open" },
    { time: "15:00", state: "taken" },
    { time: "16:00", state: "open" },
  ],
  session: {
    title: "Open play tonight",
    detail: "19:00–21:00 · 3 of 12 spots left",
    action: "Join",
  },
  confirm: "Reserve Fri 10 · 13:00",
  reassurance: "Instant confirmation — no account needed",
} as const;

export type SlotState = (typeof BOOKING_PREVIEW.slots)[number]["state"];

/* ── Venue families ───────────────────────────────────────────────
   HERO_FACTS quotes 24 templates. That number is the sum of the
   `templates` arrays below — keep them in step.
   ─────────────────────────────────────────────────────────────── */

export const VENUE_FAMILIES = [
  {
    id: "racket",
    name: "Racket & court sports",
    blurb:
      "Per-court rentals by the hour, peak and off-peak pricing, and open play carved out of the same schedule.",
    templates: [
      "Pickleball club",
      "Padel club",
      "Tennis courts",
      "Badminton hall",
      "Squash courts",
      "Basketball gym",
      "Futsal pitch",
    ],
  },
  {
    id: "fitness",
    name: "Fitness & classes",
    blurb: "Timetabled classes with per-person spots, class packs and passes.",
    templates: [
      "Fitness studio",
      "Yoga & dance studio",
      "Boxing gym",
      "Swimming pool",
      "Climbing gym",
    ],
  },
  {
    id: "rooms",
    name: "Rooms & studios",
    blurb: "Private rooms booked in blocks, with per-head pricing and gear add-ons.",
    templates: [
      "Karaoke rooms",
      "Recording studio",
      "Photo studio",
      "Escape rooms",
      "Esports lounge",
      "Co-working desks",
    ],
  },
  {
    id: "food",
    name: "Food & events",
    blurb: "Tables by party size, seatings, and function halls booked by the day.",
    templates: ["Restaurant", "Buffet house", "Function hall", "Day resort"],
  },
  {
    id: "tours",
    name: "Tours & rentals",
    blurb: "Departures sold by the seat, and fleets rented by the hour.",
    templates: ["Island-hopping boats", "Kayak & bike rental"],
  },
] as const;

export const TEMPLATE_COUNT = VENUE_FAMILIES.reduce(
  (total, family) => total + family.templates.length,
  0,
);

/* ── Features ─────────────────────────────────────────────────────
   The first two are rendered large; the rest as a dense list. Ranking
   is deliberate — it is the argument, not a bag of bullet points.
   ─────────────────────────────────────────────────────────────── */

export const FEATURES = [
  {
    title: "Availability that cannot oversell",
    body: "Slots are derived from your opening hours, capacity, buffers and notice rules. Every reservation is taken under a database-level lock, so the last slot of the night cannot be sold twice — even when two people tap it in the same second.",
  },
  {
    title: "Open play, classes and departures",
    body: "Run shared sessions with per-person spots — open play nights, a 7am class, the 14:00 boat — carved out of the very same schedule the space rents from. One calendar, two ways to sell it.",
  },
  {
    title: "Passes and memberships that bring them back",
    body: "Sell ten-session packs or monthly memberships. Credits and member discounts apply themselves the moment a regular books — steadier cash up front, and a reason to keep coming.",
  },
  {
    title: "Every customer, remembered",
    body: "A profile for everyone who books — visit history, lifetime spend, tags and private staff notes. Repeat guests are recognised and pre-filled; no-shows are flagged before you take the next one.",
  },
  {
    title: "Fill the quiet hours",
    body: "Promo codes for a slow Tuesday, loyalty points on every visit, and automatic win-back and review-request emails — so a first booking turns into a regular, without you lifting a finger.",
  },
  {
    title: "Weekly regulars, one checkout",
    body: "Let customers hold the same slot every week and pay for the whole run at once. Weeks that are already taken skip themselves.",
  },
  {
    title: "Waitlists that refill cancellations",
    body: "When a slot is full, customers join a queue instead of leaving. A cancellation emails the next in line a claim link — first come, first served.",
  },
  {
    title: "Reserve now, settle at the venue",
    body: "Customers book online and pay at your venue the way they already do — no deposits to chase, no chargebacks, no gateway fees. Taking GCash, Maya, QR Ph and cards at the moment of booking is coming soon, and we'll never take a commission on it.",
  },
  {
    title: "See the whole picture",
    body: "Today's run sheet with one-tap check-in, over the numbers that matter — revenue, busiest hours, utilisation and a peak-time heatmap. Export bookings, customers or an accounting summary whenever your bookkeeper asks.",
  },
  {
    title: "Every branch, one login",
    body: "Run several venues from a single account, switch between them in a tap, and see a roll-up of bookings and revenue across all of them.",
  },
  {
    title: "Plugs into your stack",
    body: "Subscribe to your bookings in Google or Apple Calendar, POST them to Zapier or your own systems with signed webhooks, and read your spaces and bookings over a simple API.",
  },
  {
    title: "Your policies, actually enforced",
    body: "Minimum notice, how far ahead people may book, whether cancelling online is allowed, and your refund terms — shown before anyone books.",
  },
  {
    title: "Your brand, at your own link",
    body: "Logo, cover photo, theme colour, a photo of every space and directions. Customers book on a page that looks like you, not like us — and the emails they get look like you too.",
  },
  {
    title: "Customers who serve themselves",
    body: "Confirmations, reminders and a reschedule-or-cancel link, so the phone stops ringing. Returning customers never retype their details.",
  },
  {
    title: "Live in an afternoon",
    body: "Start from a template that already has your spaces, prices and hours. Currency and timezone are detected. Walk-ins, closures, staff logins and a calendar feed are included.",
  },
] as const;

/* ── White-label ──────────────────────────────────────────────────── */

export const BRANDING = {
  title: "Make it unmistakably yours",
  body: "Upload a logo, pick one of six curated themes or dial in your exact brand colour. Your customers book on your page, in your look, at your link — and the emails they get look like you too.",
  points: [
    "Logo, cover banner and photos of every space",
    "Six theme presets, or any colour you paste in",
    "Branded confirmation and reminder emails",
    "Branded link previews when your page is shared",
  ],
  /* Swatch tokens resolve in the component — see BRAND_SWATCHES there. */
  themes: ["Pine", "Ocean", "Violet", "Sunset", "Rose", "Slate"],
} as const;

/* ── Why venues switch ───────────────────────────────────────────
   Claims about competitors are kept qualitative on purpose. We do not
   quote a rival's take rate or price, because we cannot source one.
   ─────────────────────────────────────────────────────────────── */

export const SWITCH_REASONS = [
  {
    figure: "0%",
    against: "Booking apps take a cut of every reservation",
    body: "A three-percent cut sounds small until you run the month. At ₱500 an hour and six bookings a day, that is about ₱2,700 gone — more than double our Club band, for software you are also renting. We take nothing, at any volume.",
  },
  {
    figure: peso(PLANS[1].price),
    against: "Everything useful is a paid add-on",
    body: "Open play, waitlists, passes, memberships, promo codes, loyalty, a full customer CRM, multi-branch roll-up, webhooks and an API — all of it is in the band price. There is no premium module to unlock, so the number you see on this page is the number you pay in month six.",
  },
  {
    figure: "×0",
    against: "Messenger threads and GCash screenshots double-book",
    body: "Live availability behind a database lock means the same hour cannot be promised to two people — however fast the group chat moves on a Friday night.",
  },
] as const;

/* ── How it works ─────────────────────────────────────────────────── */

export const STEPS = [
  {
    title: "Pick your venue type",
    body: "Choose a template and start with spaces, prices and opening hours already configured. Everything it creates stays editable.",
  },
  {
    title: "Make it yours",
    body: "Adjust prices and hours, upload your logo and photos, set your notice and cancellation rules, and add passes, promos or loyalty if you want them.",
  },
  {
    title: "Share your link",
    body: "Put the page in your bio, on your door, in your ads. Reservations land in your dashboard and your customers' inboxes at once.",
  },
] as const;

/* ── Pricing ──────────────────────────────────────────────────────── */

export const buildPricing = (auth: AuthLinks) => ({
  title: "One price per venue. Every feature.",
  lede: "Priced in pesos, billed per venue — not per court. No commission, no add-ons, nothing held back for a higher tier. Count your spaces and find your band.",
  ribbon: "First month free",
  yearlyRibbon: "Two months free",
  included: [
    "Branded booking page, emails and reminders",
    "Open play, classes and session schedules",
    "Passes, memberships and weekly regulars",
    "Waitlists that refill your cancellations",
    "Customer CRM — profiles, tags, history, no-show flags",
    "Promo codes, loyalty points and win-back emails",
    "Peak/off-peak pricing, closures and booking rules",
    "Staff accounts, one-tap check-in and instant search",
    "Analytics, CSV & accounting export, Google Calendar feed",
    "Webhooks and a read API for your own tools",
    "Multi-branch roll-up across every venue you run",
  ],
  presets: [
    { label: "One padel court", spaces: 1 },
    { label: "Karaoke lounge, 5 rooms", spaces: 5 },
    { label: "8-court complex", spaces: 8 },
  ],
  note: "Move between bands whenever you like — add a court mid-month and you only pay the difference.",
  cta: { label: "Start your free month", href: auth.signup },
  quoteCta: { label: "Get a quote", href: CONTACT_HREF },
  fine: "Prices in PHP, VAT included · no card to start · cancel any time",
  gateway:
    "Today customers reserve online and pay at your venue, so there are no gateway fees at all. Taking GCash, Maya, QR Ph and cards at the moment of booking is coming soon — and when it lands, we still won't take a commission.",
  volume: {
    text: "More than fifteen spaces, several branches, or a custom integration?",
    label: "Talk to us",
    href: CONTACT_HREF,
  },
}) as const;

/* ── FAQ ──────────────────────────────────────────────────────────── */

export const FAQS = [
  {
    q: "What exactly counts as a space?",
    a: `Anything a customer can book on its own: a court, a studio, a karaoke room, a restaurant table group, a boat. Three padel courts is three spaces, which puts you in Club at ${peso(PLANS[1].price)} — the same price you would pay with six. A class timetable running on one studio floor is one space, however many classes you schedule on it.`,
  },
  {
    q: "Why per venue instead of per court?",
    a: "Because per-court pricing punishes you for growing, and Philippine venues have rightly refused it. You should be able to open a fourth court without your software bill going up by a third. Bands mean the price only moves when your venue genuinely changes size.",
  },
  {
    q: "Do my customers need an account?",
    a: "No. They pick a slot, leave a name, an email and a mobile number, and get an instant confirmation. If they come back, we recognise them and pre-fill the rest — still no password, ever.",
  },
  {
    q: "How do customers pay?",
    a: "Today they reserve online and pay at your venue — cash, GCash, whatever you already accept — so there are no gateway fees, deposits or chargebacks to manage. Taking payment at the moment of booking (GCash, Maya, QR Ph and cards) is coming soon, and we'll never take a commission on it.",
  },
  {
    q: "Can I reward regulars and win back quiet customers?",
    a: "Yes. Issue promo codes for slow days, sell passes and memberships, and award loyalty points on every visit. The app automatically emails customers who haven't booked in a while and nudges them for a review after a visit — and every customer gets a profile with their history, tags and your private notes.",
  },
  {
    q: "Can I run more than one location?",
    a: "Yes. Add as many venues as you run, switch between them in a tap, and see a roll-up of bookings and revenue across all of them from one login.",
  },
  {
    q: "Can I connect ReservMe to my other tools?",
    a: "Subscribe to your bookings in Google or Apple Calendar, send booking events to Zapier or your own systems with signed webhooks, and read your spaces and bookings over a simple API — all included, with no higher tier to buy.",
  },
  {
    q: "Can regulars hold the same slot every week?",
    a: "Yes. A customer picks a slot, chooses how many weeks, and pays for the run in one checkout. Any week already taken is skipped automatically, so nobody is double-booked and nobody overpays.",
  },
  {
    q: "What happens when a slot is full?",
    a: "Customers join a waitlist rather than bouncing. The moment someone cancels, the next person in the queue is emailed a link that holds the slot for a short window. If they let it lapse, it moves down the line.",
  },
  {
    q: "Can I use it for something that isn't a court or a restaurant?",
    a: `If it can be reserved for a period of time, it fits. There are ${TEMPLATE_COUNT} templates across courts, studios, private rooms, restaurants, tours and rentals — and a blank one if none of them is quite you.`,
  },
  {
    q: "Is this only for the Philippines?",
    a: "It is built for it — peso pricing, GCash-ready, Philippine Standard Time by default, support in your hours rather than California's. Nothing stops a venue abroad using it; pick another currency and timezone at setup. But the defaults, the coming payment rails and the people answering you are here.",
  },
  {
    q: "Do you take a cut of my bookings?",
    a: "No, at any volume. Your subscription is the whole of what you pay us, and it does not move when you have a good month. Your prices, your customer list and your payouts stay yours.",
  },
  {
    q: "What if I want to leave?",
    a: "Cancel from the dashboard whenever you like — there is no lock-in and no term. Export your customers and your full booking history to CSV on the way out. The data is yours; we don't hold it hostage.",
  },
] as const;

/* ── Closing + footer ─────────────────────────────────────────────── */

export const buildClosing = (auth: AuthLinks) => ({
  title: "Stop taking bookings in the group chat.",
  body: `Your first month is free. After that it starts at ${peso(ENTRY_PRICE)} a month for the whole venue, with 0% commission for as long as you stay.`,
  cta: { label: "Create your booking page", href: auth.signup },
}) as const;

export const buildFooterGroups = (auth: AuthLinks) => ([
  {
    heading: "Product",
    links: [
      { label: "Features", href: "#features" },
      { label: "Pricing", href: "#pricing" },
      { label: "How it works", href: "#how-it-works" },
      { label: "Questions", href: "#faq" },
    ],
  },
  {
    heading: "For venues",
    links: [
      { label: "Courts & clubs", href: "#venues" },
      { label: "Studios & classes", href: "#venues" },
      { label: "Private rooms", href: "#venues" },
      { label: "Restaurants & halls", href: "#venues" },
      { label: "Tours & rentals", href: "#venues" },
    ],
  },
  {
    heading: "Company",
    links: [
      { label: "Contact", href: CONTACT_HREF },
      { label: "Support", href: CONTACT_HREF },
      { label: "Log in", href: auth.login },
      { label: "Sign up", href: auth.signup },
    ],
  },
]) as const;
