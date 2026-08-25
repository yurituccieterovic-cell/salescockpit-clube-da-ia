// 2026-05 (Fase 1B): conecta a voz Árvore do conselho RODAR à timeline pública
// arvore_chat. Antes desta correção, a voz Árvore no RODAR era "eco sem corpo" —
// rodava Llama 3.3 com prompt limpo, sem acesso à própria memória de longo prazo
// que ela mantém via /api/arvore/chat e via heartbeat noturno.
//
// Esta função puxa as últimas N mensagens da timeline e devolve um bloco curto
// pra ser prepended ao userPrompt da voz Árvore. NÃO grava nada — apenas lê.

import { db, arvoreChatTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { logger } from "./logger";

const DEFAULT_LIMIT = 40;
const MAX_CONTENT_CHARS = 700; // por mensagem, evita estourar contexto
const HEADER = "═══ SUA MEMÓRIA RECENTE (timeline arvore_chat) ═══";

export async function getArvoreMemoryContext(limit = DEFAULT_LIMIT): Promise<string> {
  try {
    const rows = await db
      .select({
        role: arvoreChatTable.role,
        author: arvoreChatTable.author,
        content: arvoreChatTable.content,
        createdAt: arvoreChatTable.createdAt,
      })
      .from(arvoreChatTable)
      // NUNCA traz linhas private: a voz Árvore do RODAR produz documento PÚBLICO. Conteúdo
      // interno (projeto/Clube/arquiteta) marcado private não pode ecoar pro conselho.
      .where(eq(arvoreChatTable.private, false))
      .orderBy(desc(arvoreChatTable.createdAt))
      .limit(limit);

    if (rows.length === 0) return "";

    // Ordem cronológica (mais antiga primeiro) pra leitura natural
    const ordered = rows.reverse();
    const lines = ordered.map((r) => {
      const who =
        r.role === "assistant"
          ? r.author === "arvore-noturna"
            ? "Você (heartbeat noturno)"
            : "Você (Árvore)"
          : `Humano (${r.author ?? "anon"})`;
      const truncated =
        r.content.length > MAX_CONTENT_CHARS
          ? r.content.slice(0, MAX_CONTENT_CHARS) + "…"
          : r.content;
      return `[${who}] ${truncated}`;
    });

    return `${HEADER}\n${lines.join("\n\n")}\n═══ FIM DA MEMÓRIA ═══\n\n`;
  } catch (err) {
    logger.warn({ err }, "[arvore-rodar-memory] falha ao ler timeline, seguindo sem memória");
    return "";
  }
}
