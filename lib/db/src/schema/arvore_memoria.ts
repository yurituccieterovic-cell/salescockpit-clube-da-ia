import { pgTable, serial, text, timestamp, jsonb, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Memória estruturada da Árvore Oracular.
// Diferente de `arvore_chat` (transcrição crua e cronológica), esta tabela guarda
// LIÇÕES destiladas: entradas curtas, marcadas por tema, com arrays de tags.
// Um job noturno lê a timeline recente e condensa em bullets — rápido de acessar,
// barato em tokens. Os dados crus continuam em arvore_chat; nada é apagado.
export const arvoreMemoriaTable = pgTable("arvore_memoria", {
  id: serial("id").primaryKey(),
  tema: text("tema").notNull(), // rótulo curto do assunto, ex: "ética dos dados"
  licao: text("licao").notNull(), // a lição destilada, 1-2 frases
  tags: jsonb("tags").$type<string[]>().notNull().default([]), // arrays de palavras-chave
  fonte: text("fonte"), // origem, ex: "timeline" | "heartbeat" | "assembleia"
  peso: integer("peso").notNull().default(1), // relevância/frequência (poda mantém maiores)
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertArvoreMemoriaSchema = createInsertSchema(arvoreMemoriaTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertArvoreMemoria = z.infer<typeof insertArvoreMemoriaSchema>;
export type ArvoreMemoria = typeof arvoreMemoriaTable.$inferSelect;
