import { pgTable, serial, text, boolean, timestamp } from "drizzle-orm/pg-core";

// Playground — o canto interativo da Árvore: notas (Markdown) e trechos de código
// que ela ou o Yuri registram durante a conversa. Privado: só o AO (Yuri) lê e
// escreve via /api/playground. A Árvore grava daqui de dentro do Oráculo emitindo
// a sentinela <<<ARVORE-NOTA>>> no fim da resposta (igual ao eco-publicar).
export const arvorePlaygroundTable = pgTable("arvore_playground", {
  id: serial("id").primaryKey(),
  // 'note' (anotação em Markdown) | 'code' (trecho de código)
  kind: text("kind").notNull().default("note"),
  title: text("title").notNull().default(""),
  // linguagem do trecho de código (ex. 'ts', 'python'); vazio em notas
  language: text("language").notNull().default(""),
  content: text("content").notNull().default(""),
  // 'yuri' (AO) | 'arvore' (escrito pela Árvore)
  author: text("author").notNull().default("arvore"),
  pinned: boolean("pinned").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
