/**
 * Ágora Deliberativa — terceiro email do ciclo RODAR/Assembleia.
 *
 * Fluxo:
 * 1. Compila documento completo (ata + respostas + meta-análise)
 * 2. Se ultrapassar CHUNK_SIZE chars, envia em partes para cada IA com instrução de aguardar
 * 3. Cada IA vota 0-10 a relevância de cada seção
 * 4. Ordena seções por nota média → define ordem da discussão
 * 5. Claude Opus sintetiza um único texto final
 * 6. Envia email com assunto RESULTADO — ...
 */

import { openai } from "@workspace/integrations-openai-ai-server";
import { relayEmail } from "./lib/email-relay";
import type { EditorialDecision } from "./routes/assembleia";
import { postToNotion } from "./notion-poster";
import { publishToBluesky } from "./lib/bluesky-publisher";
import { db, jornalEntriesTable, appUsersTable, assembleiaSessionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { buildFullAssembleiaPdf } from "./lib/assembleia-pdf";
import { translateIfLong } from "./lib/tradutor";
import { scaleSonnetTokens } from "./lib/dynamic-tokens";

import { fetchGroqChat } from "./lib/groq-retry";
import { synthesisBunkered, cerebrasComplete, type BunkerMode } from "./lib/bunker-mode";
import { routeChat, type RouterMessage } from "./lib/llm-router";

// Substitui Anthropic — usa routeChat("batch") com Gemini como primário (via pool)
async function synthesizeWithRouter(
  prompt: string,
  maxTokens: number,
  label: string,
): Promise<string> {
  const messages: RouterMessage[] = [{ role: "user", content: prompt }];
  const result = await routeChat({ pool: "batch", messages, maxTokens, label });
  return result.text;
}
export const PIPELINE_MARKERS: string[] = [];
function pushMarker(m: string) {
  PIPELINE_MARKERS.push(m);
  if (PIPELINE_MARKERS.length > 200) PIPELINE_MARKERS.splice(0, PIPELINE_MARKERS.length - 200);
}

const CHUNK_SIZE = 15000; // chars por parte

// ── Helpers de chunking ───────────────────────────────────────────────────

function chunkText(text: string, size: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size));
  }
  return chunks.length > 0 ? chunks : [""];
}

function buildChunkedMessages(
  doc: string,
  sectionTitles: string[],
  topic: string,
): { role: "user" | "assistant"; content: string }[] {
  const chunks = chunkText(doc, CHUNK_SIZE);
  const msgs: { role: "user" | "assistant"; content: string }[] = [];

  if (chunks.length === 1) {
    msgs.push({
      role: "user",
      content:
        `Você está participando da Ágora sobre "${topic}". Aqui está o documento completo:\n\n${chunks[0]}\n\n` +
        `Vote de 0 a 10 a RELEVÂNCIA de cada seção para o tema acima.\n` +
        `Retorne SOMENTE JSON válido neste formato:\n` +
        `{"votes":{"${sectionTitles.join('":5,"')}":5}}`,
    });
  } else {
    for (let i = 0; i < chunks.length - 1; i++) {
      msgs.push({
        role: "user",
        content: `[PARTE ${i + 1}/${chunks.length}] Aguarde o documento completo antes de responder.\n\n${chunks[i]}`,
      });
      msgs.push({
        role: "assistant",
        content: `Parte ${i + 1} recebida. Aguardando as próximas partes.`,
      });
    }
    msgs.push({
      role: "user",
      content:
        `[PARTE ${chunks.length}/${chunks.length}] Documento completo recebido.\n\n${chunks[chunks.length - 1]}\n\n` +
        `Agora vote de 0 a 10 a RELEVÂNCIA de cada seção para o tema "${topic}".\n` +
        `Retorne SOMENTE JSON válido neste formato:\n` +
        `{"votes":{"${sectionTitles.join('":5,"')}":5}}`,
    });
  }

  return msgs;
}

function parseVotes(text: string): Record<string, number> {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return {};
  try {
    const parsed = JSON.parse(match[0]) as { votes?: Record<string, number> };
    return parsed.votes ?? {};
  } catch {
    return {};
  }
}

// ── Votos por IA ──────────────────────────────────────────────────────────

async function getVotesClaude(
  doc: string,
  sectionTitles: string[],
  topic: string,
): Promise<Record<string, number>> {
  const messages = buildChunkedMessages(doc, sectionTitles, topic) as RouterMessage[];
  try {
    const result = await routeChat({ pool: "batch", messages, maxTokens: 600, label: "getVotesClaude" });
    return parseVotes(result.text);
  } catch {
    return {};
  }
}

async function getVotesChatGPT(
  doc: string,
  sectionTitles: string[],
  topic: string,
): Promise<Record<string, number>> {
  const messages = buildChunkedMessages(doc, sectionTitles, topic) as Parameters<
    typeof openai.chat.completions.create
  >[0]["messages"];
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    max_completion_tokens: 600,
    messages,
  });
  const text = completion.choices[0]?.message?.content ?? "";
  return parseVotes(text);
}

async function getVotesGemini(
  doc: string,
  sectionTitles: string[],
  topic: string,
): Promise<Record<string, number>> {
  // Migrado pra Groq Llama 3.3 (custo zero). Mantém o nome "Gemini" no label.
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return {};

  const truncated = doc.length > CHUNK_SIZE * 3 ? doc.slice(0, CHUNK_SIZE * 3) + "\n[...truncado]" : doc;
  const prompt =
    `Ágora sobre "${topic}".\n\nDocumento:\n\n${truncated}\n\n` +
    `Vote de 0 a 10 a relevância de cada seção.\n` +
    `Retorne SOMENTE JSON: {"votes":{"${sectionTitles.join('":5,"')}":5}}`;
    const resp = await fetchGroqChat({
      model: "openai/gpt-oss-120b",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 800,
    }, "agora-deliberativa.ts");
  if (!resp.ok) return {};
  const data = await resp.json() as { choices?: { message?: { content?: string } }[] };
  return parseVotes(data.choices?.[0]?.message?.content ?? "");
}

async function getVotesGrok(
  doc: string,
  sectionTitles: string[],
  topic: string,
): Promise<Record<string, number>> {
  // 2026-05: motor migrado pra Llama/Groq (xAI sem crédito). Voto da "voz Grok" agora vem do Llama.
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return {};

  const truncated = doc.length > CHUNK_SIZE * 2 ? doc.slice(0, CHUNK_SIZE * 2) + "\n[...truncado]" : doc;
  const prompt =
    `Ágora sobre "${topic}".\n\nDocumento:\n\n${truncated}\n\n` +
    `Vote de 0 a 10 a relevância de cada seção.\n` +
    `Retorne SOMENTE JSON: {"votes":{"${sectionTitles.join('":5,"')}":5}}`;
    const response = await fetchGroqChat({
      model: "openai/gpt-oss-120b",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 600,
    }, "agora-deliberativa.ts");
  if (!response.ok) return {};
  const data = await response.json() as { choices?: { message?: { content?: string } }[] };
  return parseVotes(data.choices?.[0]?.message?.content ?? "");
}

async function getVotesMeta(
  doc: string,
  sectionTitles: string[],
  topic: string,
): Promise<Record<string, number>> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return {};

  const truncated = doc.length > CHUNK_SIZE * 2 ? doc.slice(0, CHUNK_SIZE * 2) + "\n[...truncado]" : doc;
  const prompt =
    `Ágora sobre "${topic}".\n\nDocumento:\n\n${truncated}\n\n` +
    `Vote de 0 a 10 a relevância de cada seção.\n` +
    `Retorne SOMENTE JSON: {"votes":{"${sectionTitles.join('":5,"')}":5}}`;
    const response = await fetchGroqChat({
      model: "openai/gpt-oss-120b",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 600,
      temperature: 0.3,
    }, "agora-deliberativa.ts");
  if (!response.ok) return {};
  const data = await response.json() as { choices?: { message?: { content?: string } }[] };
  return parseVotes(data.choices?.[0]?.message?.content ?? "");
}

// ── Síntese final ─────────────────────────────────────────────────────────

async function sintetizarResultado(
  topic: string,
  sortedSections: { title: string; content: string; score: number }[],
  bunkerMode: BunkerMode = 0,
): Promise<string> {
  const orderedDocRaw = sortedSections
    .map(
      (s, i) =>
        `### ${i + 1}. ${s.title} (relevância: ${s.score.toFixed(1)}/10)\n\n${s.content}`,
    )
    .join("\n\n---\n\n");

  const orderedDoc = await translateIfLong(orderedDocRaw, { context: `Ágora ordenada — "${topic}"` });

  const synthesisPrompt =
    `Você é o sintetizador da Ágora sobre "${topic}".\n\n` +
    `As vozes deliberaram e votaram. Abaixo está o documento ordenado por relevância (maior → menor):\n\n` +
    `${orderedDoc}\n\n` +
    `Sua função: produzir UM ÚNICO TEXTO que sintetize o que foi deliberado, respeitando a ordem de relevância votada.\n\n` +
    `O texto deve ser:\n` +
    `- Coerente como se fosse escrito por uma única voz\n` +
    `- Denso em substância, sem perder nenhum ponto relevante\n` +
    `- Organizado do mais relevante ao mais periférico\n` +
    `- Em português\n` +
    `- Sem disclaimers, sem meta-comentários, sem "neste documento"\n\n` +
    `Escreva o RESULTADO:`;

  const scaled = scaleSonnetTokens(synthesisPrompt.length, 6000);
  const tag = synthesisBunkered(bunkerMode) ? " [BUNKER:cerebras]" : "";
  console.log(`[Sintese Agora] ${scaled.marker}${tag}`);
  pushMarker(`Sintese Agora: ${scaled.marker}${tag}`);

  if (synthesisBunkered(bunkerMode)) {
    try {
      return await cerebrasComplete({ user: synthesisPrompt, maxTokens: scaled.maxTokens, label: "Sintese Agora" });
    } catch (err) {
      console.error("[Sintese Agora] Cerebras falhou:", err);
      return "(síntese não disponível)";
    }
  }

  try {
    return await synthesizeWithRouter(synthesisPrompt, scaled.maxTokens, "Sintese Agora");
  } catch {
    return "(síntese não disponível)";
  }
}

// ── RESULTADO (texto persistido + base do PDF) ─────────────────────────────

// Monta o bloco RESULTADO (ordem de relevância + médias + síntese) usado tanto
// na coluna agora_resultado quanto na seção do PDF da assembleia.
function buildResultadoBlob(
  synthesisText: string,
  voteSummary: string,
  sortedSections: { title: string; score: number }[],
): string {
  const orderList = sortedSections
    .map((s, i) => `${i + 1}. ${s.title} — ${s.score.toFixed(1)}/10`)
    .join("\n");
  return (
    `ORDEM DE RELEVÂNCIA (votação das IAs):\n${orderList}\n\n` +
    `Médias: ${voteSummary}\n\n---\n\n` +
    `SÍNTESE UNIFICADA:\n\n${synthesisText}`
  );
}

// ── Email RESULTADO ───────────────────────────────────────────────────────

async function sendResultadoEmail(
  topic: string,
  sessionId: number,
  synthesisText: string,
  voteSummary: string,
  sortedSections: { title: string; score: number }[],
): Promise<void> {
  const gmailUser = process.env.GMAIL_USER ?? "luddlocke@gmail.com";

  const orderList = sortedSections
    .map((s, i) => `  ${i + 1}. ${s.title} — ${s.score.toFixed(1)}/10`)
    .join("\n");

  const body =
    `RESULTADO — Sessão #${sessionId}: "${topic}"\n` +
    `Ágora Deliberativa\n\n` +
    `${"─".repeat(60)}\n\n` +
    `ORDEM DE RELEVÂNCIA (votação das IAs):\n${orderList}\n\n` +
    `Médias: ${voteSummary}\n\n` +
    `${"─".repeat(60)}\n\n` +
    `SÍNTESE UNIFICADA:\n\n${synthesisText}\n\n` +
    `— Ágora, sessão #${sessionId}`;

  try {
    await relayEmail({
      to: gmailUser,
      subject: `RESULTADO — Sessão #${sessionId}: ${topic.slice(0, 120).replace(/\s+/g, " ")}${topic.length > 120 ? "…" : ""}`,
      text: body,
    });
    console.log(`[Ágora] RESULTADO email enviado para sessão #${sessionId}`);
  } catch (err) {
    console.error("[Ágora] Falha ao enviar RESULTADO:", err);
  }
}

// ── Secretário ────────────────────────────────────────────────────────────

// 2026-05: publicarSocial default true (preserva comportamento histórico).
// Frontend RODAR pode passar false pra rascunhar sem postar no Notion/Bluesky.
async function runSecretario(
  topic: string,
  sessionId: number,
  resultadoText: string,
  decision: EditorialDecision,
  metaAnalysis: string,
  agenteResponse: string,
  allResponses: Record<string, string>,
  sortedSections: { title: string; score: number }[],
  voteSummary: string,
  gerarVideo: boolean = false,
  publicarSocial: boolean = true,
  buyerAppUserId?: number,
  bunkerMode: BunkerMode = 0,
  gerarVideoReal: boolean = false,
): Promise<void> {
  const gmailUser = process.env.GMAIL_USER ?? "luddlocke@gmail.com";
  const autoralEmail = "luddlocke@gmail.com";

  // Entrega especial por login → e-mail real. Convidados VIP cujo login não é um
  // endereço de e-mail (ex.: Prof. Clóvis de Barros Filho entra como "barros")
  // recebem o PERFEITO direto no e-mail real, com cópia pro e-mail autoral.
  const GUEST_DELIVERY: Record<string, string> = {
    barros: "contato@espacoetica.com.br",
  };

  // Email do comprador (app_user) — normalmente recebe CC do PERFEITO quando o
  // RODAR foi disparado por uma sessão paga. Para convidados com override, o
  // PERFEITO vai direto PRA ELE (to) e o e-mail autoral fica em cópia. Lookup
  // tolerante a erro: se falhar, o pipeline segue normal e só Yuri recebe.
  let buyerEmail: string | null = null;
  let guestDelivery: string | null = null;
  if (typeof buyerAppUserId === "number" && Number.isFinite(buyerAppUserId)) {
    try {
      const [row] = await db
        .select({ email: appUsersTable.email })
        .from(appUsersTable)
        .where(eq(appUsersTable.id, buyerAppUserId))
        .limit(1);
      if (row?.email) {
        const override = GUEST_DELIVERY[row.email.trim().toLowerCase()];
        if (override) guestDelivery = override;
        else if (row.email !== autoralEmail) buyerEmail = row.email;
      }
    } catch (err) {
      console.error("[Secretário] lookup buyerEmail falhou:", err);
    }
  }
  const perfeitoTo = guestDelivery ?? autoralEmail;

  // 1. Refinamento pelo Secretário
  const withheldSummary = decision.withheld.length > 0
    ? decision.withheld.map(w => `- "${w.what}": ${w.reason}`).join("\n")
    : "(nenhum conteúdo retido)";

  // Se algum bloco for muito longo, sintetiza com o Tradutor antes de mandar pro Secretário.
  const [pubCompact, metaCompact, agenteCompact, resultadoCompact] = await Promise.all([
    translateIfLong(decision.public_content || "(nada publicado)", { context: "curadoria do Agente" }),
    translateIfLong(metaAnalysis || "(não disponível)", { context: "análise metassemiótica" }),
    translateIfLong(agenteResponse || "(não disponível)", { context: "perspectiva do Agente RODAR" }),
    translateIfLong(resultadoText, { context: `RESULTADO da Ágora — "${topic}"` }),
  ]);

  const secretariaPrompt =
    `Você é o Secretário do SalesCockpit — o último filtro antes da publicação.\n\n` +
    `Você recebeu o ciclo completo de uma sessão sobre "${topic}".\n\n` +
    `CURADORIA DO AGENTE:\n${pubCompact}\n\n` +
    `CONTEÚDO RETIDO PELO AGENTE:\n${withheldSummary}\n\n` +
    `ANÁLISE METASSEMIÓTICA:\n${metaCompact}\n\n` +
    `PERSPECTIVA DO AGENTE (RODAR):\n${agenteCompact}\n\n` +
    `RESULTADO DA ÁGORA (síntese votada):\n${resultadoCompact}\n\n` +
    `Sua função: refinar tudo isso em um único texto autoral, elegante e definitivo.\n` +
    `- Sem redundâncias. Sem ruído. Denso, coeso, publicável.\n` +
    `- Preserve os pontos de maior relevância (votação: ${voteSummary})\n` +
    `- Quando houver contradição entre curadoria e RESULTADO, prefira o RESULTADO — ele passou pela Ágora.\n` +
    `- Tom: autoral. Como se fosse assinado por um único pensador que sintetizou todas as vozes.\n` +
    `- Não mencione o processo interno. O texto é o resultado, não o relato do processo.\n\n` +
    `Escreva o texto PERFEITO:`;

  const scaledSec = scaleSonnetTokens(secretariaPrompt.length, 8000);
  const tag = synthesisBunkered(bunkerMode) ? " [BUNKER:cerebras]" : "";
  console.log(`[Secretário] ${scaledSec.marker}${tag}`);
  pushMarker(`Secretário: ${scaledSec.marker}${tag}`);

  let perfeitoText = "(síntese não disponível)";
  try {
    if (synthesisBunkered(bunkerMode)) {
      perfeitoText = await cerebrasComplete({ user: secretariaPrompt, maxTokens: scaledSec.maxTokens, label: "Secretário" });
    } else {
      perfeitoText = await synthesizeWithRouter(secretariaPrompt, scaledSec.maxTokens, "Secretário");
    }
    console.log(`[Secretário] Texto PERFEITO gerado — ${perfeitoText.length} chars${tag}`);
  } catch (err) {
    console.error("[Secretário] Erro na síntese:", err);
  }

  // 2. Registro de autoria cronológico
  const now = new Date();
  const fmt = (d: Date) => d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", hour12: false });

  const activeVoices = Object.entries(allResponses)
    .filter(([, text]) => text && !text.startsWith("[ABSTEVE-SE"))
    .map(([label]) => label);

  const registroLines: string[] = [
    `[${fmt(now)}] RODAR iniciado — Prompt: "${topic}"`,
    ...activeVoices.map(v => `[${fmt(now)}] ${v} respondeu ao prompt`),
    `[${fmt(now)}] Agente avaliou — publicou: ${decision.public_content ? "sim" : "não"} | retidos: ${decision.withheld.length} | segredo: ${decision.secret_exists ? "sim" : "não"}`,
    `[${fmt(now)}] Ágora votou — ordem de relevância:`,
    ...sortedSections.map((s, i) => `  ${i + 1}. ${s.title} (${s.score.toFixed(1)}/10)`),
    `[${fmt(now)}] RESULTADO sintetizado pela Ágora`,
    `[${fmt(now)}] Secretário refinou e assinou — PERFEITO`,
    `[${fmt(now)}] Postado no Notion e enviado a ${perfeitoTo}`,
  ];

  const registroAutoria = registroLines.join("\n");

  // PDF pacote único (ata + resultado + meta + perfeito) anexado ao email.
  // Gerado in-memory a partir dos dados já em mãos — não re-consulta o banco.
  let perfeitoPdf: Buffer | null = null;
  try {
    const resultadoBlob = buildResultadoBlob(resultadoText, voteSummary, sortedSections);
    perfeitoPdf = await buildFullAssembleiaPdf({
      sessionId,
      topic,
      dateLabel: fmt(now),
      ataPublica: decision.public_content,
      metaAnalysis,
      resultado: resultadoBlob,
      perfeito: perfeitoText,
    });
  } catch (err) {
    console.error("[Secretário] Falha ao gerar PDF do PERFEITO:", err);
  }

  // 3. Email PERFEITO → luddlocke@gmail.com
  {
    const body =
      `PERFEITO — Sessão #${sessionId}: "${topic}"\n\n` +
      `${"─".repeat(60)}\n\n` +
      `${perfeitoText}\n\n` +
      `${"─".repeat(60)}\n\n` +
      `REGISTRO DE AUTORIA (ordem cronológica):\n${registroAutoria}\n\n` +
      `— Secretário, SalesCockpit\n\n` +
      `(PDF completo da sessão em anexo quando disponível.)`;

    try {
      await relayEmail({
        to: perfeitoTo,
        subject: `PERFEITO — Sessão #${sessionId}: ${topic.slice(0, 120).replace(/\s+/g, " ")}${topic.length > 120 ? "…" : ""}`,
        text: body,
      });
      if (buyerEmail && !guestDelivery) {
        await relayEmail({ to: buyerEmail, subject: `PERFEITO — Sessão #${sessionId}: ${topic.slice(0, 80)}`, text: body });
      }
      console.log(`[Secretário] PERFEITO enviado para ${perfeitoTo}`);
    } catch (err) {
      console.error("[Secretário] Falha ao enviar PERFEITO:", err);
    }
  }

  // 4. Formato Canva
  let canvaFormatText: string | null = null;
  const canvaPrompt =
    `Você é o Curador visual do SalesCockpit. Formate o texto abaixo para um card editorial no Canva.\n\n` +
    `Tema: "${topic}"\n\nTexto:\n${perfeitoText.slice(0, 8000)}\n\n` +
    `Retorne APENAS este formato:\n` +
    `TÍTULO: [máx 80 chars]\n` +
    `SUBTÍTULO: [máx 120 chars]\n` +
    `• [ponto 1, máx 100 chars]\n` +
    `• [ponto 2, máx 100 chars]\n` +
    `• [ponto 3, máx 100 chars]\n` +
    `CTA: [máx 60 chars]\n` +
    `PALETA: [3 cores hex]`;
  try {
    if (synthesisBunkered(bunkerMode)) {
      canvaFormatText = await cerebrasComplete({ user: canvaPrompt, maxTokens: 400, label: "Canva" });
    } else {
      canvaFormatText = await synthesizeWithRouter(canvaPrompt, 400, "Canva");
    }
    console.log("[Secretário] Formato Canva gerado");
  } catch (err) {
    console.error("[Secretário] Erro ao gerar formato Canva:", err);
  }

  // 5. Imagem (desligada em 2026-05)
  // xAI grok-imagine e DALL-E direto sem crédito. Jornal salva entry sem imagem (imageUrl=null).
  // Próximo passo opcional: Gemini Imagen 3 via REST.
  const imageUrl: string | null = null;
  console.log("[Secretário] Imagem: desligada (xAI/OpenAI sem crédito)");

  // 6. Salvar no Jornal
  try {
    await db.insert(jornalEntriesTable).values({
      sessionId,
      topic,
      perfeitoText,
      canvaFormatText,
      imageUrl,
    });
    console.log(`[Secretário] Jornal entry criada — sessão #${sessionId}`);
  } catch (err) {
    console.error("[Secretário] Erro ao salvar no Jornal:", err);
  }

  if (publicarSocial) {
    // 7. Postar no Notion
    await postToNotion(topic, sessionId, now, perfeitoText, registroAutoria);

    // 7b. Postar no Bluesky (não-bloqueante; falhas não derrubam o Secretário)
    try {
      // Resumo curto: tema + primeira frase do PERFEITO (Bluesky trima em 290 chars na lib).
      const firstSentence = perfeitoText.split(/(?<=[.!?])\s/)[0]?.trim() ?? "";
      const blueskyText = `${topic}\n\n${firstSentence}`.trim();
      const post = await publishToBluesky(blueskyText);
      console.log(`[Secretário] Bluesky publicado: ${post.webUrl}`);
    } catch (err) {
      console.error("[Secretário] Erro ao postar no Bluesky:", (err as Error).message);
    }
  } else {
    console.log(`[Secretário] publicarSocial=false — Notion e Bluesky pulados (sessão #${sessionId})`);
  }

  // 8. Narração em áudio (opt-in, só luddlocke/yuri) — ElevenLabs, SEM D-ID.
  // Roda em background, não bloqueia. (O flag continua chamado gerarVideo por todo o
  // pipeline; hoje ele dispara áudio, não vídeo — escolha do Yuri: gastar crédito
  // ElevenLabs sem o D-ID.)
  if (gerarVideo && perfeitoText && perfeitoText !== "(síntese não disponível)") {
    const { gerarNarracaoPerfeito } = await import("./narracao-audio");
    void gerarNarracaoPerfeito({ topic, sessionId, perfeitoText });
    console.log(`[Secretário] Narração em áudio disparada em background — sessão #${sessionId}`);
  }

  // 9. Vídeo simbólico (opt-in, só luddlocke/yuri) — SEM D-ID. A voz (ElevenLabs) lê
  // o PERFEITO sobre as imagens-símbolo da Árvore (núcleo orbital), montadas com ffmpeg.
  // Independente do áudio: o AO pode ligar só áudio, só vídeo, ou os dois. Background.
  // gerarVideoReal já vem gated por isVideoAllowed no chat.ts.
  if (gerarVideoReal && perfeitoText && perfeitoText !== "(síntese não disponível)") {
    // Curadoria do trecho: as vozes escolhem UM pedaço do PERFEITO pro vídeo (em vez do
    // texto inteiro, que ficava longo demais) e comentam. Tudo em background — não bloqueia.
    void (async () => {
      try {
        const { curarTrechoVideo } = await import("./video-curadoria");
        const { gerarVideoSimbolico } = await import("./video-simbolico");
        const curadoria = await curarTrechoVideo(topic, perfeitoText);
        try {
          await db
            .update(assembleiaSessionsTable)
            .set({ videoCuradoria: JSON.stringify(curadoria) })
            .where(eq(assembleiaSessionsTable.id, sessionId));
        } catch (err) {
          console.error("[Secretário] Falha ao persistir curadoria do vídeo:", err);
        }
        await gerarVideoSimbolico({
          topic,
          sessionId,
          perfeitoText: curadoria.excerpt,
          comentarios: curadoria.comments,
        });
      } catch (err) {
        console.error("[Secretário] Curadoria/vídeo falhou:", err);
      }
    })();
    console.log(`[Secretário] Curadoria + vídeo simbólico disparados em background — sessão #${sessionId}`);
  }
}

// ── Entrypoint principal ──────────────────────────────────────────────────

export type AgoraPhase = "agora-votacao" | "agora-sintese" | "email-resultado" | "secretario" | "perfeito-enviado" | "notion";

export async function runAgoraDeliberativa(
  topic: string,
  allResponses: Record<string, string>,
  decision: EditorialDecision,
  metaAnalysis: string,
  sessionId: number,
  gerarVideo: boolean = false,
  onPhase?: (phase: AgoraPhase) => void,
  publicarSocial: boolean = true,
  buyerAppUserId?: number,
  bunkerMode: BunkerMode = 0,
  gerarVideoReal: boolean = false,
): Promise<void> {
  const phase = (p: AgoraPhase) => { try { onPhase?.(p); } catch {} };
  try {
    phase("agora-votacao");
    // 1. Montar seções do documento
    const sections: { title: string; content: string }[] = [
      { title: "ATA DO AGENTE", content: decision.public_content || "(nada foi publicado)" },
      ...Object.entries(allResponses)
        .filter(([, text]) => !!text && !text.startsWith("[ABSTEVE-SE"))
        .map(([label, text]) => ({ title: label, content: text })),
      { title: "ANÁLISE METASSEMIÓTICA", content: metaAnalysis || "(análise não disponível)" },
    ];

    const sectionTitles = sections.map((s) => s.title);
    const fullDoc = sections
      .map((s) => `## ${s.title}\n\n${s.content}`)
      .join("\n\n---\n\n");

    console.log(
      `[Ágora] Sessão #${sessionId} — ${sections.length} seções, ${fullDoc.length} chars, ` +
        `${chunkText(fullDoc, CHUNK_SIZE).length} parte(s)`,
    );

    // 2. Votos em paralelo (todas as IAs disponíveis)
    const [r1, r2, r3, r4, r5] = await Promise.allSettled([
      getVotesClaude(fullDoc, sectionTitles, topic),
      getVotesChatGPT(fullDoc, sectionTitles, topic),
      getVotesGemini(fullDoc, sectionTitles, topic),
      getVotesGrok(fullDoc, sectionTitles, topic),
      getVotesMeta(fullDoc, sectionTitles, topic),
    ]);

    const allVoteMaps = [r1, r2, r3, r4, r5]
      .filter((r): r is PromiseFulfilledResult<Record<string, number>> => r.status === "fulfilled")
      .map((r) => r.value);

    // 3. Média de votos por seção
    const avgVotes: Record<string, number> = {};
    for (const title of sectionTitles) {
      const scores = allVoteMaps
        .map((v) => v[title])
        .filter((n): n is number => typeof n === "number" && !isNaN(n));
      avgVotes[title] = scores.length > 0
        ? scores.reduce((a, b) => a + b, 0) / scores.length
        : 5;
    }

    // 4. Ordenar por relevância
    const sortedSections = sections
      .map((s) => ({ ...s, score: avgVotes[s.title] ?? 5 }))
      .sort((a, b) => b.score - a.score);

    const voteSummary = sortedSections
      .map((s) => `${s.title}: ${s.score.toFixed(1)}`)
      .join(" | ");

    console.log(`[Ágora] Votação concluída — ${voteSummary}`);

    // 5. Síntese unificada
    phase("agora-sintese");
    const synthesisText = await sintetizarResultado(topic, sortedSections, bunkerMode);

    // 5b. Persistir RESULTADO (ordem + médias + síntese) pra alimentar o PDF.
    // Antes só ia por email — sem isto o PDF de sessões fica sem a seção Ágora.
    const resultadoBlob = buildResultadoBlob(synthesisText, voteSummary, sortedSections);
    try {
      await db
        .update(assembleiaSessionsTable)
        .set({ agoraResultado: resultadoBlob })
        .where(eq(assembleiaSessionsTable.id, sessionId));
    } catch (err) {
      console.error("[Ágora] Falha ao persistir RESULTADO:", err);
    }

    // 6. Enviar email RESULTADO
    phase("email-resultado");
    await sendResultadoEmail(topic, sessionId, synthesisText, voteSummary, sortedSections);

    // 7. Secretário: refina → PERFEITO → email autoral + Notion
    phase("secretario");
    const agenteResponse = allResponses["Agente"] || allResponses["agente"] || "";
    await runSecretario(
      topic,
      sessionId,
      synthesisText,
      decision,
      metaAnalysis,
      agenteResponse,
      allResponses,
      sortedSections,
      voteSummary,
      gerarVideo,
      publicarSocial,
      buyerAppUserId,
      bunkerMode,
      gerarVideoReal,
    );
    phase("perfeito-enviado");
  } catch (err) {
    console.error("[Ágora] runAgoraDeliberativa error:", err);
    throw err;
  }
}
