import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const voiceProfilesTable = pgTable("voice_profiles", {
  id: serial("id").primaryKey(),
  voiceName: text("voice_name").notNull().unique(),
  voiceType: text("voice_type").notNull().default("ai"),
  bio: text("bio"),
  selfDescription: text("self_description"),
  imageUrl: text("image_url"),
  canvaFormat: text("canva_format"),
  imageGenerator: text("image_generator"),
  generatedAt: timestamp("generated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
