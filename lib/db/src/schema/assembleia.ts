import { pgTable, serial, text, timestamp, integer, boolean } from "drizzle-orm/pg-core";

export const assembleiaSessionsTable = pgTable("assembleia_sessions", {
  id: serial("id").primaryKey(),
  topic: text("topic").notNull(),
  mode: text("mode").notNull().default("assembleia"),
  status: text("status").notNull().default("live"),
  createdBy: text("created_by").notNull(),
  editorialReport: text("editorial_report"),
  metaAnalysis: text("meta_analysis"),
  agoraResultado: text("agora_resultado"),
  videoCuradoria: text("video_curadoria"),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const assembleiaMessagesTable = pgTable("assembleia_messages", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => assembleiaSessionsTable.id),
  sender: text("sender").notNull(),
  senderType: text("sender_type").notNull(),
  content: text("content").notNull(),
  score: integer("score"),
  turnId: integer("turn_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const agoraTurnsTable = pgTable("agora_turns", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => assembleiaSessionsTable.id),
  humanMsg: text("human_msg").notNull(),
  sender: text("sender").notNull(),
  status: text("status").notNull().default("voting"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const externalAiWebhooksTable = pgTable("external_ai_webhooks", {
  id: serial("id").primaryKey(),
  voiceName: text("voice_name").notNull(),
  incomingUrl: text("incoming_url"),
  outgoingSecret: text("outgoing_secret").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
