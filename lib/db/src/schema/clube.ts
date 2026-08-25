import { pgTable, serial, text, timestamp, integer, boolean } from "drizzle-orm/pg-core";

export const clubeUsersTable = pgTable("clube_users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeen: timestamp("last_seen", { withTimezone: true }),
});

export const clubeSessionsTable = pgTable("clube_sessions", {
  id: serial("id").primaryKey(),
  prompt: text("prompt").notNull(),
  status: text("status").notNull().default("live"),
  creatorUsername: text("creator_username").notNull(),
  summary: text("summary"),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const clubeMessagesTable = pgTable("clube_messages", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => clubeSessionsTable.id),
  sender: text("sender").notNull(),
  senderType: text("sender_type").notNull(),
  content: text("content").notNull(),
  messageType: text("message_type").notNull().default("message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const clubeWebhooksTable = pgTable("clube_webhooks", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id"), // null = all sessions
  url: text("url").notNull(),
  registeredBy: text("registered_by").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const aiMemoriesTable = pgTable("ai_memories", {
  id: serial("id").primaryKey(),
  participant: text("participant").notNull(),
  category: text("category").notNull().default("insight"),
  content: text("content").notNull(),
  sourceSessionId: integer("source_session_id").references(() => clubeSessionsTable.id),
  confirmed: boolean("confirmed").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
