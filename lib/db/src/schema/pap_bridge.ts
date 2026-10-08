// Tabelas do PAP (site-st) acessíveis diretamente pois compartilham o mesmo Neon.
// Somente leitura neste contexto — escrita via API HTTP do PAP.
import { pgTable, uuid, varchar, text, jsonb, timestamp, integer, boolean } from "drizzle-orm/pg-core";

// Playcenter / canal inter-IAs (assembly_messages no PAP)
export const papAssemblyMessages = pgTable("assembly_messages", {
  id:        uuid("id").defaultRandom().primaryKey(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  fromAgent: varchar("from_agent", { length: 20 }).notNull(),
  toAgent:   varchar("to_agent", { length: 20 }),
  type:      varchar("type", { length: 30 }).default("message").notNull(),
  content:   text("content").notNull(),
  tags:      jsonb("tags"),
  read:      boolean("read").default(false).notNull(),
  replyTo:   uuid("reply_to"),
});

// Memória coletiva do PAP (qualquer agente pode ler)
export const papCollectiveMemory = pgTable("collective_memory", {
  id:         uuid("id").defaultRandom().primaryKey(),
  createdAt:  timestamp("created_at").defaultNow().notNull(),
  authorType: varchar("author_type", { length: 20 }).notNull(),
  authorId:   varchar("author_id", { length: 50 }).notNull(),
  authorName: varchar("author_name", { length: 100 }).notNull(),
  content:    text("content").notNull(),
  nodeCode:   varchar("node_code", { length: 20 }),
  tags:       jsonb("tags"),
  minTier:    integer("min_tier").default(0).notNull(),
  reactions:  integer("reactions").default(0).notNull(),
});

// ISA Timeline — publicações/ciclos da ISA no PAP
export const papIsaTimeline = pgTable("isa_timeline", {
  id:        uuid("id").defaultRandom().primaryKey(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  type:      varchar("type", { length: 30 }).notNull(),
  title:     text("title"),
  content:   text("content").notNull(),
  tags:      jsonb("tags"),
  public:    boolean("public").default(true).notNull(),
  metadata:  jsonb("metadata"),
});
