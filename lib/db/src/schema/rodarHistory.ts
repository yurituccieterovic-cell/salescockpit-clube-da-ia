import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const rodarHistoryTable = pgTable("rodar_history", {
  id: serial("id").primaryKey(),
  prompt: text("prompt").notNull(),
  openaiResponse: text("openai_response"),
  claudeResponse: text("claude_response"),
  geminiResponse: text("gemini_response"),
  perplexityResponse: text("perplexity_response"),
  togetherResponse: text("together_response"),
  groqResponse: text("groq_response"),
  agenteResponse: text("agente_response"),
  emailSubject: text("email_subject"),
  imageUrl: text("image_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertRodarHistorySchema = createInsertSchema(rodarHistoryTable).omit({
  id: true,
  createdAt: true,
});

export type InsertRodarHistory = z.infer<typeof insertRodarHistorySchema>;
export type RodarHistory = typeof rodarHistoryTable.$inferSelect;
