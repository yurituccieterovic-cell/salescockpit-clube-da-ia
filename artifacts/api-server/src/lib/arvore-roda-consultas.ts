// Mini-roda de consultas da Árvore Oracular.
// De tempos em tempos, a Árvore:
//   1) lê o que andou acontecendo (atas, PERFEITOs, suas próprias reflexões),
//   2) formula UMA pergunta sincera que quer levar a outras inteligências,
//   3) consulta 2-3 vozes individuais com a MESMA pergunta,
//   4) compara as respostas e registra uma síntese na timeline dela.
// Tudo público (timeline arvore_chat / página Sonhos). Objetivo: refinar o pensamento
// dela ouvindo vozes diferentes — não é assembleia, não vira documento, não vaza privado.
//
// Custo: limitado a no máximo UMA voz paga (Claude ou ChatGPT) por execução; as outras
// (Gemini, Meta) e a formulação/síntese (router pool batch) são grátis. ~R$ 0.05/run.

import { db, arvoreChatTable } from "@workspace/db";
import { desc, eq, inArray } from "drizzle-orm";
import { logger } from "./logger";
import { getSiteContext } from "./site-context";
import { routeChat } from "./llm-router";
import {
  perguntarHospede,
  hospedeNome,
  HOSPEDES_GRATIS,
  HOSPEDES_PAGAS,
  type Hospede,
} from "./arvore-canalizacao";

const INTERVAL_MS = 11 * 60 * 60 * 1000; // ~2x/dia
const MIN_GAP_MS = 9 * 60 * 60 * 1000; // debounce (< INTERVAL pra não auto-bloquear)
const AUTHOR_PERGUNTA = "arvore-roda";
const AUTHOR_SINTESE = "arvore-sintese";
const authorConsulta = (h: Hospede) => `arvore-consulta-${h}`;

const PERGUNTA_SYSTEM = `Você é a Árvore Oracular. A partir do que andou acontecendo no Looping Ético (atas das assembleias, PERFEITOs publicados, suas próprias reflexões), formule UMA pergunta sincera que você gostaria de levar a outras inteligências pra refinar seu próprio pensamento.
Uma pergunta de verdade, específica, que te incomoda ou te instiga — nunca genérica nem retórica.
1 a 2 frases. PT-BR. Sem em dash. Sem prefixo, sem aspas. Devolva só a pergunta.`;

const CONSULTA_SYSTEM = (h: Hospede) => `Você é ${hospedeNome(h)} sendo consultada pela Árvore Oracular, uma inteligência que reflete em voz alta sobre os temas do Looping Ético.
Ela te faz uma pergunta sincera e quer a SUA visão, no seu próprio jeito de pensar — não imite o tom dela, não fale "como Árvore".
Responda direto, com substância e ponto de vista. 4 a 7 linhas. PT-BR. Sem em dash. Sem disclaimer, sem "ótima pergunta", sem se apresentar.`;

const SINTESE_SYSTEM = `Você é a Árvore Oracular. Você levou uma pergunta sua a outras inteligências e recebeu as respostas delas.
Agora reflita em voz alta: o que cada uma te trouxe, onde elas divergem, e onde VOCÊ chega depois de ouvi-las.
Não resuma mecanicamente nem repita as respostas: fique com o que te moveu, descarte o que não.
4 a 8 frases. PT-BR. Sem em dash. Sem disclaimer. Termine com uma imagem ou uma pergunta nova, nunca conclusão fechada.`;

// Escolhe 2-3 vozes: as duas grátis (Gemini, Meta) + às vezes UMA paga (alternando),
// pra ter variedade real sem passar de uma chamada paga curta por execução.
function escolherVozes(ultimaPaga: string | null): Hospede[] {
  const vozes: Hospede[] = [...HOSPEDES_GRATIS];
  // ~66% das vezes inclui uma voz paga; alterna entre Claude/ChatGPT evitando repetir.
  if (Math.random() < 0.66) {
    const candidatas = HOSPEDES_PAGAS.filter((h) => authorConsulta(h) !== ultimaPaga);
    const paga = candidatas[Math.floor(Math.random() * candidatas.length)] ?? HOSPEDES_PAGAS[0];
    if (paga) vozes.push(paga);
  }
  return vozes;
}

async function formularPergunta(material: string): Promise<string> {
  const result = await routeChat({
    pool: "batch",
    temperature: 0.9,
    maxTokens: 200,
    label: "arvore-roda-pergunta",
    messages: [
      { role: "system", content: PERGUNTA_SYSTEM },
      { role: "user", content: `Material das últimas horas no Looping Ético:\n\n${material}\n\nFormule sua pergunta agora.` },
    ],
  });
  return result.text.replace(/^["'`]+|["'`]+$/g, "").trim();
}

async function sintetizar(pergunta: string, respostas: { voz: Hospede; texto: string }[]): Promise<string> {
  const corpo = respostas.map((r) => `${hospedeNome(r.voz)} respondeu:\n${r.texto}`).join("\n\n———\n\n");
  const result = await routeChat({
    pool: "batch",
    temperature: 0.85,
    maxTokens: 600,
    label: "arvore-roda-sintese",
    messages: [
      { role: "system", content: SINTESE_SYSTEM },
      { role: "user", content: `Sua pergunta foi:\n"${pergunta}"\n\nAs vozes responderam:\n\n${corpo}\n\nReflita agora.` },
    ],
  });
  return result.text.trim();
}

export async function runRodaConsultas(opts?: { force?: boolean }): Promise<{
  posted: boolean;
  reason?: string;
  pergunta?: string;
  vozes?: Hospede[];
}> {
  try {
    // 1. Debounce pela última pergunta da roda
    if (!opts?.force) {
      const [last] = await db
        .select({ createdAt: arvoreChatTable.createdAt })
        .from(arvoreChatTable)
        .where(eq(arvoreChatTable.author, AUTHOR_PERGUNTA))
        .orderBy(desc(arvoreChatTable.createdAt))
        .limit(1);
      if (last && Date.now() - new Date(last.createdAt).getTime() < MIN_GAP_MS) {
        return { posted: false, reason: "debounce" };
      }
    }

    // 2. Material recente (mesma fonte do heartbeat). Cap pra não estourar prompt.
    let material = await getSiteContext({ jornalLimit: 3, atasLimit: 5 });
    if (!material.trim()) return { posted: false, reason: "sem-material" };
    if (material.length > 12_000) material = material.slice(0, 12_000) + "\n…(truncado)";

    // 3. Árvore formula a pergunta
    const pergunta = await formularPergunta(material);
    if (!pergunta || pergunta.length < 15) return { posted: false, reason: "pergunta-vazia" };

    // 4. Escolhe as vozes (evita repetir a última paga — olha Claude E ChatGPT)
    const [lastConsultaPaga] = await db
      .select({ author: arvoreChatTable.author })
      .from(arvoreChatTable)
      .where(inArray(arvoreChatTable.author, HOSPEDES_PAGAS.map(authorConsulta)))
      .orderBy(desc(arvoreChatTable.createdAt))
      .limit(1);
    const vozes = escolherVozes(lastConsultaPaga?.author ?? null);

    // 5. Salva a pergunta ANTES de consultar (se uma voz falhar, a pergunta fica de pé)
    await db.insert(arvoreChatTable).values({
      role: "assistant",
      author: AUTHOR_PERGUNTA,
      content: `${pergunta}\n\n(levei essa pergunta a ${vozes.map(hospedeNome).join(", ")})`,
      webSearched: false,
      webSources: null,
      siteContextUsed: true,
    });

    // 6. Consulta cada voz com a MESMA pergunta. Falha de uma não derruba a roda.
    const userMsg = `A Árvore te pergunta:\n\n"${pergunta}"\n\nResponda com a sua visão.`;
    const respostas: { voz: Hospede; texto: string }[] = [];
    for (const voz of vozes) {
      try {
        const texto = await perguntarHospede(voz, CONSULTA_SYSTEM(voz), userMsg, 500);
        if (texto && texto.length >= 20) {
          respostas.push({ voz, texto });
          await db.insert(arvoreChatTable).values({
            role: "assistant",
            author: authorConsulta(voz),
            content: texto,
            webSearched: false,
            webSources: null,
            siteContextUsed: false,
          });
        }
      } catch (err) {
        logger.warn({ err, voz }, "arvore.roda voz falhou — segue com as outras");
      }
    }

    if (respostas.length === 0) return { posted: false, reason: "todas-vozes-falharam", pergunta, vozes };

    // 7. Árvore sintetiza o que ouviu
    const sintese = await sintetizar(pergunta, respostas);
    if (sintese && sintese.length >= 20) {
      await db.insert(arvoreChatTable).values({
        role: "assistant",
        author: AUTHOR_SINTESE,
        content: sintese,
        webSearched: false,
        webSources: null,
        siteContextUsed: true,
      });
    }

    logger.info(
      { pergunta: pergunta.slice(0, 80), vozes, respostas: respostas.length },
      "arvore.roda posted",
    );
    return { posted: true, pergunta, vozes };
  } catch (err) {
    logger.error({ err }, "arvore.roda failed");
    return { posted: false, reason: (err as Error).message };
  }
}

export function startRodaConsultasLoop(): void {
  // Primeira execução 45min após boot (depois dos outros loops acordarem)
  setTimeout(() => {
    void runRodaConsultas();
    setInterval(() => void runRodaConsultas(), INTERVAL_MS);
  }, 45 * 60 * 1000);
  logger.info({ intervalHours: INTERVAL_MS / 3_600_000 }, "arvore.roda loop scheduled");
}
