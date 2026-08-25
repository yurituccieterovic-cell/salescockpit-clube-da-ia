import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

// Ecossistema — "berço de projetos": páginas interligadas criadas por Yuri (AO) e
// pela Árvore. Cada página tem visibilidade própria (private/clube/public) e pode
// ter uma página-mãe (parentId) formando uma árvore/diretório. Páginas públicas
// são servidas sem auth por /api/eco/publico e ganham link compartilhável.
export const ecossistemaPaginasTable = pgTable("ecossistema_paginas", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  content: text("content").notNull().default(""),
  // 'markdown' (texto) | 'code' (HTML/CSS/JS rodado em iframe sandbox isolado).
  // Páginas 'code' são executadas numa caixa isolada (sem cookies/mesma-origem):
  // o conteúdo é um documento HTML completo.
  kind: text("kind").notNull().default("markdown"),
  // 'private' (só Yuri) | 'clube' (Yuri + Clube) | 'public' (qualquer um)
  visibility: text("visibility").notNull().default("private"),
  // 'yuri' (AO) | 'arvore' (escrita pela Árvore)
  author: text("author").notNull().default("yuri"),
  parentId: integer("parent_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
