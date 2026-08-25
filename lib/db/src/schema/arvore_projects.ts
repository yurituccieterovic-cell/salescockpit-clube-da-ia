import { pgTable, serial, text, timestamp, integer, bigint } from "drizzle-orm/pg-core";

// Projetos privados da Árvore — AO-only. Cada projeto é uma "biblioteca" com arquivos
// (PDF, TXT, imagens descritas via Gemini Vision) que viram contexto pra Árvore e RODAR
// quando o usuário selecionar o projeto na UI. NUNCA vai pra timeline pública.
export const arvoreProjectsTable = pgTable("arvore_projects", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(), // ex: "cliente-acme", auto-gerado a partir do nome
  nome: text("nome").notNull(),
  descricao: text("descricao"),
  ownerId: text("owner_id").notNull().default("ao"), // sempre "ao" por enquanto (AO-only)
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});

// Arquivos pertencentes a um projeto. Texto já vem extraído (PDF parsed, imagem descrita).
// Conteúdo guardado direto na coluna content pra evitar object storage por ora — cap
// 500k chars por projeto enforced no route handler.
export const arvoreFilesTable = pgTable("arvore_files", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id")
    .notNull()
    .references(() => arvoreProjectsTable.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // "text" | "image"
  name: text("name").notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  content: text("content").notNull(), // texto extraído / descrição da imagem
  uploadedBy: text("uploaded_by").notNull().default("ao"),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
});

// Timeline privada por projeto — NÃO vai pra /arvore/history pública.
// Cada projeto tem sua própria conversa contínua com a Árvore.
export const arvoreProjectChatTable = pgTable("arvore_project_chat", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id")
    .notNull()
    .references(() => arvoreProjectsTable.id, { onDelete: "cascade" }),
  role: text("role").notNull(), // "user" | "assistant"
  author: text("author"), // "ao" | "arvore"
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
