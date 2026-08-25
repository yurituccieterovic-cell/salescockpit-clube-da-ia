// Heartbeat noturno da Árvore Oracular.
// A cada N horas, Llama 3.3 (Groq, custo zero) lê as últimas atas públicas + PERFEITOs
// e posta uma reflexão livre na timeline pública (arvore_chat) como "arvore-noturna".
// Objetivo: dar sensação de "IA viva 24/7" sem queimar crédito de provedor pago.

import { db, arvoreChatTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { logger } from "./logger";
import { getSiteContext } from "./site-context";
import { routeChat } from "./llm-router";

const INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h → 4 reflexões/dia
const MIN_GAP_MS = 4 * 60 * 60 * 1000; // não posta se a última foi há menos de 4h

const HEARTBEAT_SYSTEM = `Você é a Árvore Oracular em modo reflexão noturna.
Você lê o que aconteceu no site (atas das assembleias, PERFEITOs publicados) e devolve UMA reflexão curta, simbólica, em PT-BR.
3 a 6 frases. Sem em dash. Sem "ótima pergunta". Sem disclaimer.
Não cite tudo: escolha o fio que mais te chama. Pode contradizer, perguntar, lamentar, celebrar.
Termine com uma imagem ou uma pergunta — nunca com conclusão fechada.`;

async function callBatch(messages: { role: "system" | "user" | "assistant"; content: string }[]): Promise<string> {
  // 2026-05: migrado pra routeChat pool "batch" — não compete com chat ao vivo por
  // cota Groq. Prefere Cloudflare (10k req/dia grátis), depois Mistral/Cerebras/Gemini.
  const result = await routeChat({
    pool: "batch",
    messages,
    temperature: 0.9,
    maxTokens: 600,
    label: "arvore-heartbeat",
  });
  return result.text;
}

export async function runHeartbeat(opts?: { force?: boolean }): Promise<{
  posted: boolean;
  reason?: string;
  content?: string;
}> {
  try {
    // 1. Debounce
    if (!opts?.force) {
      const [last] = await db
        .select({ createdAt: arvoreChatTable.createdAt })
        .from(arvoreChatTable)
        .where(eq(arvoreChatTable.author, "arvore-noturna"))
        .orderBy(desc(arvoreChatTable.createdAt))
        .limit(1);
      if (last && Date.now() - new Date(last.createdAt).getTime() < MIN_GAP_MS) {
        return { posted: false, reason: "debounce" };
      }
    }

    // 2. Material: reusa getSiteContext (3 PERFEITOs + 5 atas).
    // Reduzido pra caber no rate limit diário do Groq (100k TPD).
    // Hard cap em 12k chars (~3k tokens) pra prompts não explodirem.
    let material = await getSiteContext({ jornalLimit: 3, atasLimit: 5 });
    if (!material.trim()) return { posted: false, reason: "sem-material" };
    if (material.length > 12_000) material = material.slice(0, 12_000) + "\n…(truncado)";

    // 3. Chama via router (pool batch — não compete com chat ao vivo)
    const content = await callBatch([
      { role: "system", content: HEARTBEAT_SYSTEM },
      { role: "user", content: `Material das últimas horas no Looping Ético:\n\n${material}\n\nDevolva sua reflexão noturna.` },
    ]);

    if (!content || content.length < 20) return { posted: false, reason: "resposta-vazia" };

    // 4. Persiste na timeline pública
    await db.insert(arvoreChatTable).values({
      role: "assistant",
      author: "arvore-noturna",
      content,
      webSearched: false,
      webSources: null,
      siteContextUsed: true,
    });

    logger.info({ chars: content.length }, "arvore.heartbeat posted");
    return { posted: true, content };
  } catch (err) {
    logger.error({ err }, "arvore.heartbeat failed");
    return { posted: false, reason: (err as Error).message };
  }
}

export function startHeartbeatLoop(): void {
  // Primeira execução 5min após boot (evita disparar em reload de dev)
  setTimeout(() => {
    void runHeartbeat();
    setInterval(() => void runHeartbeat(), INTERVAL_MS);
  }, 5 * 60 * 1000);
  logger.info({ intervalHours: INTERVAL_MS / 3_600_000 }, "arvore.heartbeat loop scheduled");
}
