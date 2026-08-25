import { pgTable, serial, text, timestamp, jsonb, integer, boolean } from "drizzle-orm/pg-core";

// Propostas de mudança de código geradas pela Árvore Oracular (modo programadora).
// Yuri revisa e aprova/rejeita no /arvore-code. Nunca aplica direto.
//
// Plano de voo (estados):
//   1. created     → row criada, status=pending, diffs salvos
//   2. approved    → Yuri clicou aprovar. status=approved, appliedAt setado.
//                    Em PROD: NÃO escreve arquivos (filesystem efêmero). Marca appliedToDisk=false.
//                    Em DEV:  escreve arquivos + git commit local. Marca appliedToDisk=true.
//   3. appliedToDisk → arquivos realmente escritos no Repl de dev (via approve em dev OU
//                    via script `aplicar-aprovadas`). Setado appliedToDiskAt + appliedIn.
//   4. em produção → Yuri faz Republish manual. Sem trackeamento automático.
export const arvoreProposalsTable = pgTable("arvore_proposals", {
  id: serial("id").primaryKey(),
  request: text("request").notNull(), // pedido em linguagem natural
  summary: text("summary").notNull(), // resumo curto do que a Árvore propôs
  diffs: jsonb("diffs").notNull(), // [{path, oldContent: string|null, newContent: string}]
  status: text("status").notNull().default("pending"), // pending | approved | rejected | failed
  createdBy: text("created_by").notNull(),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  errorMsg: text("error_msg"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  appliedAt: timestamp("applied_at", { withTimezone: true }), // quando virou approved
  appliedToDisk: boolean("applied_to_disk").notNull().default(false), // true quando arquivos foram realmente escritos
  appliedToDiskAt: timestamp("applied_to_disk_at", { withTimezone: true }),
  appliedIn: text("applied_in"), // "dev-repl" | "prod-shell" | null. Quem aplicou no disco.
});
