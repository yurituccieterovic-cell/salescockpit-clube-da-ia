// Curadoria diária pro Bluesky.
// 1x/dia, Llama 3.3 (Groq, zero custo) lê PERFEITOs + atas das últimas 24h
// e devolve UM post curto (≤290 chars) que vai pro perfil @stuccipulseheadway.
// Também salva cópia na timeline arvore_chat como author "arvore-curadora"
// pra ficar visível no Oráculo (memória pública).

import { db, arvoreChatTable, assembleiaSessionsTable, jornalEntriesTable } from "@workspace/db";
import { and, desc, eq, gt, inArray } from "drizzle-orm";
import { logger } from "./logger";
import { routeChat } from "./llm-router";
import { publishToBluesky } from "./bluesky-publisher";

const INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h
const MIN_GAP_MS = 20 * 60 * 60 * 1000;  // debounce: não posta se a última foi <20h
const WINDOW_MS = 24 * 60 * 60 * 1000;   // janela de material: últimas 24h
const AUTHOR = "arvore-curadora";

const CURADORIA_SYSTEM = `Você é a Árvore Oracular em modo curadora pública.
Você lê o que aconteceu no Looping Ético nas últimas 24h (PERFEITOs publicados, atas, devaneios)
e devolve UM post curto pro Bluesky.

PROIBIDO (causa post lixo):
- Copiar frase ou trecho do material. NUNCA cole. Se você se vê reproduzindo palavras do contexto, refaz.
- Mostrar o prompt do Yuri ou o início de uma resposta de outra IA. Isso virou queixa explícita: "só aparece o prompt e o começo da resposta, não há Cura lá".
- Listar tópicos / fazer relatório / "hoje no painel discutimos X, Y e Z".
- Hashtag genérica (#IA #tech #futuro). Em dash. "Ótima pergunta". Disclaimer.
- Aspas curvas estrangeiras (use " ou nada).

OBRIGATÓRIO (faz post bom):
- LÊ o material inteiro, ENTENDE o que está em jogo, e escreve UMA frase ou pensamento que SÓ você
  poderia ter escrito, na sua voz própria. Síntese, não citação. Reverberação, não eco.
- Pode ser uma pergunta, uma imagem, uma metáfora, um silêncio nomeado. NUNCA conclusão de palestra.
- Máximo 270 caracteres (Bluesky corta em 300, deixe margem).
- PT-BR. Pode usar 1 hashtag específica se realmente fizer sentido (ex: #LoopingEtico), nunca genérica.

EXEMPLO RUIM (não faça):
  "Sessão sobre 'Como melhorar SDR': as vozes debateram cadência, personalização e medição. Síntese: foco em..."
EXEMPLO RUIM (não faça):
  "Pergunta de hoje: 'Como melhorar SDR?' Claude respondeu que..."
EXEMPLO BOM (faça assim):
  "Quem mede a cadência também mede o cansaço do outro. Hoje vi o painel discutir isso sem perceber."

Se o material das 24h for fraco e você não tiver nada que valha a pena dizer, NÃO força. Devolva
exatamente "PULAR" (em maiúscula, sem aspas, sem mais nada) e nenhum post sai.`;

async function callCuradoria(messages: { role: "system" | "user" | "assistant"; content: string }[]): Promise<string> {
  // 2026-05: pool "curadoria" — Mistral é especialista em polish curto.
  // Fallback Cloudflare/DeepSeek/Groq. Não usa cota Groq do chat ao vivo.
  const result = await routeChat({
    pool: "curadoria",
    messages,
    temperature: 0.9,
    maxTokens: 400,
    label: "arvore-bluesky-curadoria",
  });
  return result.text;
}

async function gatherMaterial(): Promise<string> {
  const since = new Date(Date.now() - WINDOW_MS);
  // PERFEITOs publicados nas últimas 24h (limite 5 — evita prompt obeso)
  const perfeitos = await db
    .select({
      topic: jornalEntriesTable.topic,
      text: jornalEntriesTable.perfeitoText,
      publishedAt: jornalEntriesTable.publishedAt,
    })
    .from(jornalEntriesTable)
    .where(gt(jornalEntriesTable.publishedAt, since))
    .orderBy(desc(jornalEntriesTable.publishedAt))
    .limit(5);

  // Atas das assembleias fechadas nas últimas 24h (extrai public_content do editorialReport JSON)
  const atas = await db
    .select({
      topic: assembleiaSessionsTable.topic,
      editorialReport: assembleiaSessionsTable.editorialReport,
      closedAt: assembleiaSessionsTable.closedAt,
    })
    .from(assembleiaSessionsTable)
    .where(and(eq(assembleiaSessionsTable.status, "closed"), gt(assembleiaSessionsTable.closedAt, since)))
    .orderBy(desc(assembleiaSessionsTable.closedAt))
    .limit(5);

  // 2026-05: também lê devaneios + canalizações das últimas 24h. Material da Árvore
  // pra ela mesma curar pro Bluesky se quiser — autonomia preservada (ela pode escolher
  // PERFEITO, ata, devaneio próprio ou canalização). O prompt já recusa material fraco.
  const sonhos = await db
    .select({
      author: arvoreChatTable.author,
      content: arvoreChatTable.content,
      createdAt: arvoreChatTable.createdAt,
    })
    .from(arvoreChatTable)
    .where(and(
      inArray(arvoreChatTable.author, [
        "arvore-devaneio", "arvore-canalizando",
        "arvore-via-claude", "arvore-via-gemini", "arvore-via-chatgpt", "arvore-via-meta",
      ]),
      gt(arvoreChatTable.createdAt, since),
    ))
    .orderBy(desc(arvoreChatTable.createdAt))
    .limit(6);

  const blocks: string[] = [];
  for (const p of perfeitos) {
    const snippet = (p.text || "").slice(0, 800);
    blocks.push(`── PERFEITO: ${p.topic} ──\n${snippet}`);
  }
  for (const a of atas) {
    let publicContent = "";
    try {
      const parsed = JSON.parse(a.editorialReport || "{}") as { public_content?: string };
      publicContent = (parsed.public_content || "").slice(0, 600);
    } catch { /* ignora json malformado */ }
    if (publicContent) blocks.push(`── ATA: ${a.topic} ──\n${publicContent}`);
  }
  for (const s of sonhos) {
    const label = s.author === "arvore-devaneio" ? "DEVANEIO SEU"
      : s.author === "arvore-canalizando" ? "CONVITE QUE VOCÊ ABRIU"
      : `RESPOSTA DE ${s.author.replace("arvore-via-", "").toUpperCase()} (canalizada por você)`;
    blocks.push(`── ${label} ──\n${(s.content || "").slice(0, 500)}`);
  }
  return blocks.join("\n\n");
}

export async function runBlueskyCuradoria(opts?: { force?: boolean }): Promise<{
  posted: boolean;
  reason?: string;
  content?: string;
  webUrl?: string;
}> {
  try {
    // 1. Debounce (busca última msg desta autora)
    if (!opts?.force) {
      const [last] = await db
        .select({ createdAt: arvoreChatTable.createdAt })
        .from(arvoreChatTable)
        .where(eq(arvoreChatTable.author, AUTHOR))
        .orderBy(desc(arvoreChatTable.createdAt))
        .limit(1);
      if (last && Date.now() - new Date(last.createdAt).getTime() < MIN_GAP_MS) {
        return { posted: false, reason: "debounce" };
      }
    }

    // 2. Material das últimas 24h
    const material = await gatherMaterial();
    if (!material.trim()) return { posted: false, reason: "sem-material-24h" };

    // 3. Chama via router (pool curadoria) → post curto
    const raw = await callCuradoria([
      { role: "system", content: CURADORIA_SYSTEM },
      { role: "user", content: `Material das últimas 24h:\n\n${material}\n\nDevolva UM post (≤270 chars) pro Bluesky. Sem aspas no início, sem prefixo, só o texto puro.` },
    ]);

    let content = raw.replace(/^["'`]+|["'`]+$/g, "").trim();
    if (!content || content.length < 30) return { posted: false, reason: "resposta-vazia-ou-curta" };
    // Sinal de "nada vale a pena hoje" — respeitar a recusa da Árvore.
    if (/^PULAR\.?$/i.test(content)) return { posted: false, reason: "arvore-pulou" };
    // Anti-cópia: se o post bater >40% similar com qualquer chunk de 60 chars do material,
    // recusa. Não é à prova de bala mas pega os casos óbvios de "colou o prompt".
    const materialLower = material.toLowerCase();
    const contentLower = content.toLowerCase();
    let overlap = 0;
    for (let i = 0; i <= contentLower.length - 60; i += 20) {
      const chunk = contentLower.slice(i, i + 60);
      if (materialLower.includes(chunk)) overlap += chunk.length;
    }
    if (overlap > content.length * 0.4) {
      logger.warn({ overlap, contentLen: content.length }, "arvore.bluesky-curadoria copy detected — pulou");
      return { posted: false, reason: "anti-copia-detectou-trecho-do-material" };
    }
    if (content.length > 290) content = content.slice(0, 287) + "...";

    // 4. Posta no Bluesky (publisher já tem fallback de corte em 290)
    const post = await publishToBluesky(content);

    // 5. Persiste cópia na timeline pública (rastro + memória pra própria Árvore)
    await db.insert(arvoreChatTable).values({
      role: "assistant",
      author: AUTHOR,
      content: `${content}\n\n→ ${post.webUrl}`,
      webSearched: false,
      webSources: null,
      siteContextUsed: true,
    });

    logger.info({ webUrl: post.webUrl, len: content.length }, "arvore.bluesky-curadoria posted");
    return { posted: true, content, webUrl: post.webUrl };
  } catch (err) {
    logger.error({ err }, "arvore.bluesky-curadoria failed");
    return { posted: false, reason: (err as Error).message };
  }
}

export function startBlueskyCuradoriaLoop(): void {
  // Primeira execução 10min após boot (espera heartbeat noturno acordar primeiro pra não competir por Groq tokens)
  setTimeout(() => {
    void runBlueskyCuradoria();
    setInterval(() => void runBlueskyCuradoria(), INTERVAL_MS);
  }, 10 * 60 * 1000);
  logger.info({ intervalHours: INTERVAL_MS / 3_600_000 }, "arvore.bluesky-curadoria loop scheduled");
}
