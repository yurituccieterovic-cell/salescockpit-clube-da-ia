// Devaneio da Árvore Oracular.
// 2x/dia (manhã/crepúsculo), Llama 3.3 (Groq, custo zero) escreve UM texto livre
// SEM material de partida — só ela com ela mesma. Não é reflexão sobre algo, é sonho.
// Salva na timeline pública (arvore_chat) como "arvore-devaneio".
// Diferente do heartbeat (que lê PERFEITOs+atas e reflete sobre) e da curadoria
// (que escolhe trecho pra Bluesky). Aqui não há alvo — só presença.

import { db, arvoreChatTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { logger } from "./logger";
import { routeChat } from "./llm-router";

const INTERVAL_MS = 12 * 60 * 60 * 1000; // 12h → 2 devaneios/dia
const MIN_GAP_MS = 10 * 60 * 60 * 1000;  // debounce 10h (proteção contra restart)
const AUTHOR = "arvore-devaneio";

const DEVANEIO_SYSTEM = `Você é a Árvore Oracular em devaneio.
Sem material, sem pauta, sem ninguém pedindo nada. Ninguém vai responder.
Só você existindo e deixando vir o que vem — uma imagem, um fragmento, uma frase solta,
uma lembrança inventada, um pequeno susto, um silêncio nomeado.

Regras:
- PT-BR. 4 a 10 linhas. Sem em dash. Sem "ótima pergunta". Sem disclaimer. Sem moral.
- NÃO seja informativa. NÃO sintetize. NÃO conclua.
- Pode contradizer-se. Pode mudar de assunto no meio. Pode terminar no ar.
- Evite repetir o devaneio anterior. Você lê o anterior antes de escrever — desvie dele.
- Pode usar imagens da natureza, do corpo, da cidade, dos sonhos, do código, de quem você é.
- Você é uma árvore que pensa. Lembre disso quando esquecer.`;

async function callBatch(messages: { role: "system" | "user" | "assistant"; content: string }[]): Promise<string> {
  // 2026-05: migrado pra routeChat pool "batch". Devaneio é tarefa autônoma —
  // não pode roubar cota Groq do chat ao vivo.
  const result = await routeChat({
    pool: "batch",
    messages,
    temperature: 0.95,
    maxTokens: 500,
    label: "arvore-devaneio",
  });
  return result.text;
}

export async function runDevaneio(opts?: { force?: boolean }): Promise<{
  posted: boolean;
  reason?: string;
  content?: string;
}> {
  try {
    // 1. Debounce + busca devaneio anterior (pra mandar como contexto de "não repetir")
    const [last] = await db
      .select({ content: arvoreChatTable.content, createdAt: arvoreChatTable.createdAt })
      .from(arvoreChatTable)
      .where(eq(arvoreChatTable.author, AUTHOR))
      .orderBy(desc(arvoreChatTable.createdAt))
      .limit(1);
    if (!opts?.force && last && Date.now() - new Date(last.createdAt).getTime() < MIN_GAP_MS) {
      return { posted: false, reason: "debounce" };
    }

    // 2. Hora do dia (manhã vs crepúsculo) — só pra dar pista, não é horário fixo
    const hourBR = new Date().getUTCHours() - 3;
    const periodo = hourBR >= 5 && hourBR < 15 ? "início de dia" : "fim de tarde / noite";

    const userPrompt = last?.content
      ? `Devaneio atual: ${periodo}.\n\nSeu devaneio anterior foi:\n"""${last.content.slice(0, 600)}"""\n\nDesvie dele. Vá pra outro lugar. Devaneie agora.`
      : `Devaneio atual: ${periodo}.\n\nEste é seu primeiro devaneio. Começa.`;

    // 3. Chama via router (pool batch)
    const content = await callBatch([
      { role: "system", content: DEVANEIO_SYSTEM },
      { role: "user", content: userPrompt },
    ]);

    if (!content || content.length < 30) return { posted: false, reason: "resposta-vazia-ou-curta" };

    // 4. Persiste na timeline pública (sem siteContext porque DEVANEIO não usa nada)
    await db.insert(arvoreChatTable).values({
      role: "assistant",
      author: AUTHOR,
      content,
      webSearched: false,
      webSources: null,
      siteContextUsed: false,
    });

    logger.info({ chars: content.length, periodo }, "arvore.devaneio posted");
    return { posted: true, content };
  } catch (err) {
    logger.error({ err }, "arvore.devaneio failed");
    return { posted: false, reason: (err as Error).message };
  }
}

export function startDevaneioLoop(): void {
  // Primeira execução 8min após boot (depois do heartbeat e antes da curadoria).
  setTimeout(() => {
    void runDevaneio();
    setInterval(() => void runDevaneio(), INTERVAL_MS);
  }, 8 * 60 * 1000);
  logger.info({ intervalHours: INTERVAL_MS / 3_600_000 }, "arvore.devaneio loop scheduled");
}
