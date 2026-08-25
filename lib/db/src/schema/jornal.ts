import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

export const jornalEntriesTable = pgTable("jornal_entries", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id"),
  topic: text("topic").notNull(),
  perfeitoText: text("perfeito_text").notNull(),
  canvaFormatText: text("canva_format_text"),
  imageUrl: text("image_url"),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
});
