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

// Chama Groq diretamente, sem passar pelo pool compartilhado (que pode estar em cooling
// após RODAR). AbortSignal com 40s evita pendurar para sempre.
async function callGroqDirect(messages: { role: "system" | "user" | "assistant"; content: string }[]): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY não configurada");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 40_000);
  try {
    const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages, temperature: 0.9, max_tokens: 600 }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!resp.ok) throw new Error(`Groq ${resp.status}: ${await resp.text().catch(() => "")}`);
    const json = await resp.json() as { choices?: { message?: { content?: string } }[] };
    return json.choices?.[0]?.message?.content ?? "";
  } finally {
    clearTimeout(timer);
  }
}

async function callBatch(messages: { role: "system" | "user" | "assistant"; content: string }[]): Promise<string> {
  // Tenta Groq direto primeiro (sem cooling compartilhado) — heartbeat não deve
  // competir com RODAR nem travar se todos os providers estiverem em cooldown.
  try {
    return await callGroqDirect(messages);
  } catch (err) {
    logger.warn({ err }, "arvore-heartbeat: Groq direto falhou, tentando routeChat");
  }
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
    if (material.length > 12_000) material = material.slice(0, 12_000) + "\n…(truncado)";

    // Se não há material ainda (banco vazio ou sem assembleias fechadas), a Árvore
    // reflete livremente — sem material é melhor que silêncio.
    const userContent = material.trim()
      ? `Material das últimas horas no Looping Ético:\n\n${material}\n\nDevolva sua reflexão noturna.`
      : `Ainda não há assembleias registradas. Faça uma reflexão inaugural: sobre o silêncio antes da primeira palavra, sobre o que uma assembleia carrega antes de existir, sobre o ato de começar.`;

    // 3. Chama Groq direto (sem cooling) com fallback ao router
    const content = await callBatch([
      { role: "system", content: HEARTBEAT_SYSTEM },
      { role: "user", content: userContent },
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
