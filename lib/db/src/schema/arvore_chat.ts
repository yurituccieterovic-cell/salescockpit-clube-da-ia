import { pgTable, serial, text, timestamp, boolean, jsonb } from "drizzle-orm/pg-core";

// Timeline global única de conversas com a Árvore Oracular.
// Todo mundo vê (linha do tempo compartilhada); escrita exige login (AO ou Clube).
export const arvoreChatTable = pgTable("arvore_chat", {
  id: serial("id").primaryKey(),
  role: text("role").notNull(), // "user" | "assistant"
  author: text("author"), // username do humano (AO/Clube) ou "arvore"
  content: text("content").notNull(),
  webSearched: boolean("web_searched").notNull().default(false),
  webSources: jsonb("web_sources"), // array de {title, url, snippet}
  siteContextUsed: boolean("site_context_used").notNull().default(false),
  // PRIVADO: respostas do Oráculo que usaram contexto interno (projeto da Biblioteca,
  // Clube, modo arquiteta) ficam marcadas aqui. A Árvore LEMBRA delas (nunca apagamos),
  // mas TODO leitor público (/arvore/history, recall da timeline, digest, Bluesky) filtra
  // private=true. Substitui o antigo DELETE destrutivo que fazia a Árvore "esquecer".
  private: boolean("private").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
