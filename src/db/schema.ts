/**
 * Drizzle mirror of drizzle/0000_init.sql.
 *
 * The SQL file is the source of truth — it carries the exclusion constraint,
 * the generated `during` column and the CHECKs, none of which Drizzle can
 * express. This file exists so queries are typed. Change the SQL first.
 */
import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

const createdAt = timestamp("created_at", { withTimezone: true })
  .notNull()
  .defaultNow();

/* ── Auth ──────────────────────────────────────────────────────── */

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt,
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  createdAt,
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  activeOrganizationId: text("active_organization_id"),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  password: text("password"),
  createdAt,
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt,
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const organization = pgTable("organization", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /** The venue's public booking path: reservme.pro/<slug> */
  slug: text("slug").notNull().unique(),
  logo: text("logo"),
  metadata: text("metadata"),
  createdAt,
});

export const member = pgTable(
  "member",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"),
    createdAt,
  },
  (t) => [unique().on(t.organizationId, t.userId)],
);

export const invitation = pgTable("invitation", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: text("role"),
  status: text("status").notNull().default("pending"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  inviterId: text("inviter_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  createdAt,
});

/* ── Venue ─────────────────────────────────────────────────────── */

export type CancellationMode = "anytime" | "grace" | "never";

export const venue = pgTable("venue", {
  organizationId: text("organization_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  timezone: text("timezone").notNull().default("Asia/Manila"),
  currency: text("currency").notNull().default("PHP"),
  theme: text("theme").notNull().default("pine"),
  tagline: text("tagline"),
  address: text("address"),
  minNoticeMinutes: integer("min_notice_minutes").notNull().default(60),
  maxHorizonDays: integer("max_horizon_days").notNull().default(60),
  cancellationMode: text("cancellation_mode")
    .$type<CancellationMode>()
    .notNull()
    .default("grace"),
  cancellationGraceHours: integer("cancellation_grace_hours").notNull().default(24),
  refundTerms: text("refund_terms"),
  gcashQrUrl: text("gcash_qr_url"),
  gcashName: text("gcash_name"),
  /** Branding (0005): a cover image as a data URL. Logo is on organization. */
  coverUrl: text("cover_url"),
  createdAt,
});

export const space = pgTable(
  "space",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    kind: text("kind").notNull().default("court"),
    capacity: integer("capacity").notNull().default(1),
    slotMinutes: integer("slot_minutes").notNull().default(60),
    bufferMinutes: integer("buffer_minutes").notNull().default(0),
    priceCents: integer("price_cents").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt,
  },
  (t) => [unique().on(t.organizationId, t.slug)],
);

/** Peak/off-peak price overrides for a space (0010). */
export const pricingRule = pgTable(
  "pricing_rule",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => space.id, { onDelete: "cascade" }),
    label: text("label"),
    weekdays: smallint("weekdays").array().notNull(),
    startsAt: time("starts_at").notNull(),
    endsAt: time("ends_at").notNull(),
    priceCents: integer("price_cents").notNull(),
    createdAt,
  },
  (t) => [index("pricing_rule_space_idx").on(t.spaceId, t.createdAt)],
);

export const openingHours = pgTable("opening_hours", {
  id: uuid("id").primaryKey().defaultRandom(),
  spaceId: uuid("space_id")
    .notNull()
    .references(() => space.id, { onDelete: "cascade" }),
  /** 0 = Sunday, matching Postgres `EXTRACT(DOW ...)`. */
  weekday: smallint("weekday").notNull(),
  opensAt: time("opens_at").notNull(),
  closesAt: time("closes_at").notNull(),
});

export const closure = pgTable("closure", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  /** null closes the whole venue. */
  spaceId: uuid("space_id").references(() => space.id, { onDelete: "cascade" }),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  reason: text("reason"),
});

export const customer = pgTable(
  "customer",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    email: text("email").notNull(),
    phone: text("phone"),
    noShowCount: integer("no_show_count").notNull().default(0),
    // CRM (0003): hand-curated tags + marketing consent. See customerNote below.
    tags: text("tags").array().notNull().default([]),
    marketingOptIn: boolean("marketing_opt_in").notNull().default(false),
    createdAt,
  },
  (t) => [unique().on(t.organizationId, t.email)],
);

/** Free-form staff notes on a customer (0003_crm.sql). */
export const customerNote = pgTable(
  "customer_note",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customer.id, { onDelete: "cascade" }),
    // Kept when the staffer is deleted; the org cascade reaps the note.
    authorUserId: text("author_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    body: text("body").notNull(),
    createdAt,
  },
  (t) => [index("customer_note_customer_idx").on(t.customerId, t.createdAt)],
);

export const playSession = pgTable(
  "play_session",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => space.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    capacity: integer("capacity").notNull(),
    bookedSpots: integer("booked_spots").notNull().default(0),
    pricePerPersonCents: integer("price_per_person_cents").notNull().default(0),
    cancelled: boolean("cancelled").notNull().default(false),
    createdAt,
  },
  (t) => [index("play_session_space_starts_idx").on(t.spaceId, t.startsAt)],
);

/* ── Reservations ──────────────────────────────────────────────── */

export type ReservationKind = "rental" | "session_block" | "session_seat";
export type ReservationStatus = "held" | "confirmed" | "cancelled" | "no_show";

export const reservation = pgTable(
  "reservation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => space.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").references(() => playSession.id, {
      onDelete: "cascade",
    }),
    customerId: uuid("customer_id").references(() => customer.id, {
      onDelete: "set null",
    }),
    kind: text("kind").$type<ReservationKind>().notNull().default("rental"),
    status: text("status").$type<ReservationStatus>().notNull().default("held"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    // `during` is GENERATED ALWAYS in SQL and deliberately not mapped here —
    // it must never be written from application code.
    partySize: integer("party_size").notNull().default(1),
    amountCents: integer("amount_cents").notNull().default(0),
    holdExpiresAt: timestamp("hold_expires_at", { withTimezone: true }),
    checkedInAt: timestamp("checked_in_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    reference: text("reference").notNull().unique(),
    /** Unguessable capability behind the customer "manage booking" link (0006). */
    manageToken: uuid("manage_token").notNull().defaultRandom(),
    notes: text("notes"),
    createdAt,
  },
  (t) => [
    index("reservation_org_starts_idx").on(t.organizationId, t.startsAt),
    index("reservation_space_starts_idx").on(t.spaceId, t.startsAt),
  ],
);

/* ── Subscription billing (0004) ───────────────────────────────── */

export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "cancelled"
  | "comped";

export const subscription = pgTable("subscription", {
  organizationId: text("organization_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  status: text("status").$type<SubscriptionStatus>().notNull().default("trialing"),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }).notNull(),
  paidUntil: timestamp("paid_until", { withTimezone: true }),
  provider: text("provider"),
  providerRef: text("provider_ref"),
  note: text("note"),
  // Reminder dedup (0009): when the owner was last nudged for each state.
  trialReminderAt: timestamp("trial_reminder_at", { withTimezone: true }),
  dueReminderAt: timestamp("due_reminder_at", { withTimezone: true }),
  createdAt,
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type BillingPaymentStatus = "submitted" | "approved" | "rejected";

export const billingPayment = pgTable(
  "billing_payment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    amountCents: integer("amount_cents").notNull(),
    reference: text("reference").notNull(),
    paidAt: timestamp("paid_at", { withTimezone: true }).notNull(),
    status: text("status").$type<BillingPaymentStatus>().notNull().default("submitted"),
    reviewedBy: text("reviewed_by").references(() => user.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    note: text("note"),
    createdAt,
  },
  (t) => [index("billing_payment_org_idx").on(t.organizationId, t.createdAt)],
);

export type WaitlistStatus = "waiting" | "notified" | "converted" | "expired";

/** Waitlist entries for a taken slot (0007). */
export const waitlist = pgTable(
  "waitlist",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => space.id, { onDelete: "cascade" }),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customer.id, { onDelete: "cascade" }),
    status: text("status").$type<WaitlistStatus>().notNull().default("waiting"),
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    createdAt,
  },
  (t) => [index("waitlist_slot_idx").on(t.spaceId, t.startsAt, t.status)],
);

/** Platform-wide key/value settings (e.g. ReservMe's InstaPay QR details). */
export const platformSetting = pgTable("platform_setting", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PaymentMethod = "gcash_proof" | "paymongo" | "xendit" | "cash";
export type PaymentStatus = "awaiting" | "approved" | "rejected" | "refunded";

export const payment = pgTable("payment", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  reservationId: uuid("reservation_id")
    .notNull()
    .references(() => reservation.id, { onDelete: "cascade" }),
  method: text("method").$type<PaymentMethod>().notNull(),
  status: text("status").$type<PaymentStatus>().notNull().default("awaiting"),
  amountCents: integer("amount_cents").notNull(),
  proofUrl: text("proof_url"),
  gatewayRef: text("gateway_ref"),
  reviewedBy: text("reviewed_by").references(() => user.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt,
});

/* ── Relations ─────────────────────────────────────────────────── */

export const organizationRelations = relations(organization, ({ one, many }) => ({
  venue: one(venue, {
    fields: [organization.id],
    references: [venue.organizationId],
  }),
  spaces: many(space),
  reservations: many(reservation),
}));

export const spaceRelations = relations(space, ({ one, many }) => ({
  organization: one(organization, {
    fields: [space.organizationId],
    references: [organization.id],
  }),
  openingHours: many(openingHours),
  reservations: many(reservation),
}));

export const reservationRelations = relations(reservation, ({ one, many }) => ({
  space: one(space, { fields: [reservation.spaceId], references: [space.id] }),
  customer: one(customer, {
    fields: [reservation.customerId],
    references: [customer.id],
  }),
  playSession: one(playSession, {
    fields: [reservation.sessionId],
    references: [playSession.id],
  }),
  payments: many(payment),
}));

export const playSessionRelations = relations(playSession, ({ one, many }) => ({
  space: one(space, { fields: [playSession.spaceId], references: [space.id] }),
  seats: many(reservation),
}));
