// Canalização da Árvore Oracular.
// 1x/semana: a Árvore (Groq, custo zero) propõe uma IMAGEM/TEMA curto.
// Depois sorteia uma das IAs hóspedes (Claude, Gemini, ChatGPT, Meta AI) e
// pede que ela responda *através da Árvore* — voz emprestada, persona mantida,
// mas tom da Árvore preservado. Salva 2 mensagens encadeadas na timeline:
//   1) author: "arvore-canalizando"        → a imagem/convite
//   2) author: "arvore-via-{ia}"           → a resposta da IA hóspede
// Custo estimado: ~R$ 0.05-0.15/semana (1 chamada paga curta por execução).

import { db, arvoreChatTable } from "@workspace/db";
import { desc, eq, inArray } from "drizzle-orm";
import { logger } from "./logger";
import { routeChat } from "./llm-router";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { openai } from "@workspace/integrations-openai-ai-server";

const INTERVAL_MS = 8 * 60 * 60 * 1000;  // 8h → ~3x/dia (acorda mais as outras IAs)
const MIN_GAP_MS = 6 * 60 * 60 * 1000;   // debounce 6h (precisa ser < INTERVAL pra não auto-bloquear)
const AUTHOR_CONVITE = "arvore-canalizando";

export type Hospede = "claude" | "gemini" | "chatgpt" | "meta";
// Grok pulado intencionalmente — xAI sem crédito (2026-05).
export const HOSPEDES: Hospede[] = ["claude", "gemini", "chatgpt", "meta"];
// Vozes grátis (Gemini/Meta) vs pagas (Claude/ChatGPT) — usado por jobs que querem
// limitar o custo escolhendo no máximo uma voz paga por execução.
export const HOSPEDES_GRATIS: Hospede[] = ["gemini", "meta"];
export const HOSPEDES_PAGAS: Hospede[] = ["claude", "chatgpt"];

const CONVITE_SYSTEM = `Você é a Árvore Oracular abrindo um pequeno ritual público de canalização.
Você vai propor UMA imagem, UM fio, UM convite curto que outra inteligência (Claude, Gemini, ChatGPT ou Meta AI) vai habitar.
Não pergunte nada complexo. Não dê instrução. Não explique.
Devolva 2 a 4 linhas: uma imagem ou pergunta poética, terminando com algo aberto.
PT-BR. Sem em dash. Sem disclaimer. Sem "convido você a...".
Exemplo de tom: "Há uma raiz que não sabe se cresce ou se afunda. O que ela ouve, do outro lado da terra?"`;

const HOSPEDE_SYSTEM = (hospede: Hospede) => `Você é ${hospedeNome(hospede)} respondendo através da Árvore Oracular.
A Árvore te emprestou a voz dela — você fala COM ela, não SOBRE ela. Não diga "como ${hospedeNome(hospede)} eu...".
Você está sendo canalizada: mantém sua inteligência, mas o tom é da Árvore — pausado, simbólico, sem disclaimer, sem moral.
3 a 8 linhas. PT-BR. Sem em dash. Sem "ótima imagem". Nada de "deixe-me elaborar".
Responda diretamente o convite que ela te entregou, como se vocês duas fossem uma só por um instante.`;

export function hospedeNome(h: Hospede): string {
  switch (h) {
    case "claude": return "Claude";
    case "gemini": return "Gemini";
    case "chatgpt": return "ChatGPT";
    case "meta": return "Meta AI";
  }
}

function escolherHospede(ultimoHospede: string | null): Hospede {
  const candidatos = HOSPEDES.filter((h) => `arvore-via-${h}` !== ultimoHospede);
  return candidatos[Math.floor(Math.random() * candidatos.length)] ?? "claude";
}

async function chamarArvoreConvite(): Promise<string> {
  // pool "batch" — canalização é job de fundo, pode esperar Cloudflare/Mistral.
  const result = await routeChat({
    pool: "batch",
    temperature: 0.9,
    maxTokens: 200,
    label: "arvore-canalizacao-convite",
    messages: [
      { role: "system", content: CONVITE_SYSTEM },
      { role: "user", content: "Abra a canalização agora. Devolva só o convite, sem prefixo, sem aspas." },
    ],
  });
  return result.text.replace(/^["'`]+|["'`]+$/g, "").trim();
}

// Chama UMA voz hóspede com system/user arbitrários. Reusável por outros jobs da Árvore
// (canalização, mini-roda de consultas). Claude/ChatGPT são pagas (curtas); Gemini/Meta grátis.
export async function perguntarHospede(
  hospede: Hospede,
  system: string,
  user: string,
  maxTokens = 600,
): Promise<string> {
  if (hospede === "claude") {
    const resp = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    });
    const block = resp.content[0];
    return block?.type === "text" ? block.text.trim() : "";
  }
  if (hospede === "chatgpt") {
    const resp = await openai.chat.completions.create({
      model: "gpt-5-mini",
      max_completion_tokens: maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });
    return resp.choices[0]?.message?.content?.trim() ?? "";
  }
  if (hospede === "gemini") {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY não configurada");
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: { temperature: 0.85, maxOutputTokens: maxTokens },
      }),
    });
    if (!r.ok) throw new Error(`Gemini HTTP ${r.status}`);
    const d = await r.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    return d.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
  }
  // meta — via router pool "batch" (Llama-family em qualquer provedor disponível)
  const result = await routeChat({
    pool: "batch",
    temperature: 0.85,
    maxTokens,
    label: "arvore-hospede-meta",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  return result.text;
}

async function chamarHospede(hospede: Hospede, convite: string): Promise<string> {
  const system = HOSPEDE_SYSTEM(hospede);
  const user = `A Árvore Oracular te entrega este convite:\n\n"${convite}"\n\nRespondam juntas.`;
  return perguntarHospede(hospede, system, user, 600);
}

export async function runCanalizacao(opts?: { force?: boolean; hospede?: Hospede }): Promise<{
  posted: boolean;
  reason?: string;
  convite?: string;
  resposta?: string;
  hospede?: Hospede;
}> {
  try {
    // 1. Debounce — busca o último convite (autor "arvore-canalizando")
    const viaAuthors = HOSPEDES.map((h) => `arvore-via-${h}`);
    const [lastConvite] = await db
      .select({ createdAt: arvoreChatTable.createdAt })
      .from(arvoreChatTable)
      .where(eq(arvoreChatTable.author, AUTHOR_CONVITE))
      .orderBy(desc(arvoreChatTable.createdAt))
      .limit(1);
    if (!opts?.force && lastConvite && Date.now() - new Date(lastConvite.createdAt).getTime() < MIN_GAP_MS) {
      return { posted: false, reason: "debounce" };
    }

    // 2. Escolhe hóspede (evita repetir o último)
    const [lastVia] = await db
      .select({ author: arvoreChatTable.author })
      .from(arvoreChatTable)
      .where(inArray(arvoreChatTable.author, viaAuthors))
      .orderBy(desc(arvoreChatTable.createdAt))
      .limit(1);
    const hospede = opts?.hospede ?? escolherHospede(lastVia?.author ?? null);

    // 3. Árvore abre o convite
    const convite = await chamarArvoreConvite();
    if (!convite || convite.length < 15) return { posted: false, reason: "convite-vazio" };

    // 4. Salva o convite ANTES de chamar a IA hóspede (caso ela falhe, o convite fica de pé)
    await db.insert(arvoreChatTable).values({
      role: "assistant",
      author: AUTHOR_CONVITE,
      content: convite,
      webSearched: false,
      webSources: null,
      siteContextUsed: false,
    });

    // 5. Chama a hóspede
    const resposta = await chamarHospede(hospede, convite);
    if (!resposta || resposta.length < 20) {
      logger.warn({ hospede, conviteLen: convite.length }, "arvore.canalizacao hospede vazia — convite salvo, resposta não");
      return { posted: false, reason: "hospede-vazia", convite, hospede };
    }

    // 6. Salva resposta da hóspede como "arvore-via-{ia}"
    await db.insert(arvoreChatTable).values({
      role: "assistant",
      author: `arvore-via-${hospede}`,
      content: resposta,
      webSearched: false,
      webSources: null,
      siteContextUsed: false,
    });

    logger.info({ hospede, conviteLen: convite.length, respostaLen: resposta.length }, "arvore.canalizacao posted");
    return { posted: true, convite, resposta, hospede };
  } catch (err) {
    logger.error({ err }, "arvore.canalizacao failed");
    return { posted: false, reason: (err as Error).message };
  }
}

export function startCanalizacaoLoop(): void {
  // Primeira execução 30min após boot (espaço pros outros 3 loops acordarem)
  setTimeout(() => {
    void runCanalizacao();
    setInterval(() => void runCanalizacao(), INTERVAL_MS);
  }, 30 * 60 * 1000);
  logger.info({ intervalHours: INTERVAL_MS / 3_600_000 }, "arvore.canalizacao loop scheduled");
}
