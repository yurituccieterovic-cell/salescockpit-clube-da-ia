import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

// Usuários pagantes do app (separados do AO via env e do clube_users).
// AO = você, infinito; clube_users = chat colaborativo; app_users = paga R$10/prompt RODAR.
export const appUsersTable = pgTable("app_users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  credits: integer("credits").notNull().default(0),
  stripeCustomerId: text("stripe_customer_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
});

// Idempotência de processamento de checkouts. Evita creditar duas vezes
// se /credits-success for recarregada ou se backfill rodar.
export const processedCheckoutsTable = pgTable("processed_checkouts", {
  stripeSessionId: text("stripe_session_id").primaryKey(),
  appUserId: integer("app_user_id").notNull(),
  creditsAdded: integer("credits_added").notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
});
