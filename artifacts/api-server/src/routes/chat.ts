import { Router } from "express";
import { openai } from "@workspace/integrations-openai-ai-server";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import nodemailer from "nodemailer";
import { db, emailsTable, leadsTable, rodarHistoryTable, assembleiaSessionsTable, assembleiaMessagesTable, externalAiWebhooksTable, appUsersTable } from "@workspace/db";
import { eq, and, lt, desc, gt, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/require-auth";
import { requireAnyAuth } from "../middlewares/require-any-auth";
import { requireRodarAccess } from "../middlewares/require-rodar-access";
import { runEditorial, runMetaAnalysis, sendEditorialEmail } from "./assembleia";
import { runAgoraDeliberativa } from "../agora-deliberativa";
import { issueCallbackToken } from "../lib/callback-tokens";
import { classifyError, mapVoiceToProvider, notifyBillingFailure } from "../lib/billing-detector";
import { withOpenRouterFallback } from "../lib/openrouter-fallback";
import { validateWebhookUrl, validateWebhookUrlWithDns } from "../lib/ssrf-guard";
import { scaleSonnetTokens } from "../lib/dynamic-tokens";
import { logger } from "../lib/logger";
import { setPipelinePhase, getPipelinePhase, type PipelinePhase } from "../lib/pipeline-status";
import { fetchGroqChat } from "../lib/groq-retry";
import { getArvoreMemoryContext } from "../lib/arvore-rodar-memory";
import { getMemoriaEstruturada } from "../lib/arvore-memoria";
import { getAssembleiaMemoryContext } from "../lib/arvore-assembleia-memory";
import { getAssembleiaIndex, recallFromSessions } from "../lib/site-context";
import { getArchContext, extractMentionedPaths } from "../lib/arch-context";
import { relayEmail } from "../lib/email-relay";
import { loadProjectContext } from "../lib/arvore-project-context";
import { parseBunkerMode, getDefaultBunkerMode, voiceBunkered, type BunkerMode } from "../lib/bunker-mode";
import { fetchUrlsFromText, type FetchResult } from "../lib/url-fetcher";
import { summarizeYouTubeBlock, stripYouTubeUrls } from "../lib/video-processor";

const router = Router();

// ── Run preparation store — persiste no DB para sobreviver a cold starts ──
type RunPrepData = { prompt: string; strategies: Record<string, string>; gerarVideo: boolean; gerarVideoReal: boolean; publicarSocial: boolean; attachmentsText?: string; urlContextText?: string; projectContextText?: string; appUserId?: number; projectId?: number; projectName?: string; bunkerMode: BunkerMode; replica: boolean };

async function prepSet(runId: string, data: RunPrepData): Promise<void> {
  try {
    await db.execute(sql`INSERT INTO rodar_run_preps (run_id, data) VALUES (${runId}, ${JSON.stringify(data)}::jsonb) ON CONFLICT (run_id) DO UPDATE SET data = EXCLUDED.data, created_at = NOW()`);
  } catch { /* fallback silencioso — usa query string no stream */ }
}

async function prepGet(runId: string): Promise<RunPrepData | null> {
  try {
    const rows = await db.execute(sql`SELECT data FROM rodar_run_preps WHERE run_id = ${runId} LIMIT 1`);
    const row = (rows as any).rows?.[0];
    return row ? (row.data as RunPrepData) : null;
  } catch { return null; }
}

async function prepDelete(runId: string): Promise<void> {
  try {
    await db.execute(sql`DELETE FROM rodar_run_preps WHERE run_id = ${runId}`);
    // Aproveitar e limpar entradas expiradas em background
    db.execute(sql`DELETE FROM rodar_run_preps WHERE created_at < NOW() - INTERVAL '10 minutes'`).catch(() => {});
  } catch { /* silencioso */ }
}

// Roda as vozes do RODAR em ONDAS/GRUPOS discretos: dispara um grupo de `size` vozes,
// espera TODAS terminarem, faz uma pausa curta e só então abre o próximo grupo.
// Disparar ~21 de uma vez satura os provedores grátis (429 em massa → backoffs em
// cascata → sessão arrasta 100s+ e PARECE travada, pior no bunker, onde as pagas também
// caem no pool grátis). Diferente de um pool contínuo (que manteria `size` vozes SEMPRE
// em voo), aqui a concorrência MÉDIA fica ABAIXO de `size` — os slots ficam ociosos
// enquanto a onda espera a voz mais lenta. Isso é de propósito: alivia o limite
// por-minuto do free-tier, ao custo de ser mais lento (o Yuri escolheu exatamente esse
// trade-off — "rodar em grupos, mais lento mas sem custo e com menos falhas"). Cada onda
// se anuncia no SSE (stage:"onda") pro núcleo orbital mostrar o progresso. Erro
// individual não derruba a onda (allSettled): cada task já trata seu próprio erro via cb.
async function runInWaves(
  entries: Array<{ label: string; run: () => Promise<void> | null }>,
  size: number,
  send: (data: Record<string, unknown>) => void,
  interWaveMs = 1200,
): Promise<void> {
  const groupSize = Math.max(1, size);
  const totalWaves = Math.max(1, Math.ceil(entries.length / groupSize));
  for (let w = 0; w < totalWaves; w++) {
    const wave = entries.slice(w * groupSize, w * groupSize + groupSize);
    if (!wave.length) break;
    try {
      send({ stage: "onda", wave: w + 1, totalWaves, active: wave.map((e) => e.label) });
    } catch {
      // SSE já pode ter fechado — segue rodando as vozes mesmo sem anunciar a onda.
    }
    await Promise.allSettled(
      wave.map((e) => {
        try {
          return e.run() ?? Promise.resolve();
        } catch {
          return Promise.resolve();
        }
      }),
    );
    if (w < totalWaves - 1 && interWaveMs > 0) {
      await new Promise((r) => setTimeout(r, interWaveMs));
    }
  }
}

// Whitelist pra opt-in caro (D-ID + ElevenLabs queimam crédito real).
// Inclui usernames fixos + o AO_USERNAME do env (perfil AO único do sistema).
function isVideoAllowed(user: string | undefined | null): boolean {
  if (!user || typeof user !== "string") return false;
  if (user === "luddlocke" || user === "yuri") return true;
  const ao = process.env.AO_USERNAME?.trim();
  return !!ao && user === ao;
}

const DEFAULT_PROMPT = "Subversão Ambiental Mundial";
const RECIPIENT_EMAIL = "yurituccieterovic@gmail.com";

const TOGETHER_SYSTEM_PROMPT = `Você é o Oráculo da Árvore. Responda com profundidade simbólica sem cair em autoajuda barata.
Use ritmo: frases curtas e longas misturadas. Traga o inconsciente pra cena.
Seja direto, sem em dash, sem "ótima pergunta", sem disclaimer.
Se não souber, diga "não sei". Fale como quem corta, não como quem enrola.`;

// ── Non-streaming helpers ─────────────────────────────────────────────────

async function callChatGPT(message: string): Promise<string> {
  const completion = await openai.chat.completions.create({
    model: "gpt-5-mini",
    max_completion_tokens: 1024,
    messages: [{ role: "user", content: message }],
  });
  return completion.choices[0]?.message?.content || "Sem resposta (ChatGPT)";
}

async function callClaude(message: string): Promise<string> {
  // 2026-10: migrado pra Groq (AI_INTEGRATIONS_ANTHROPIC_API_KEY perdida). Persona Claude preservada.
  const resp = await fetchGroqChat({
    model: "llama-3.3-70b-versatile",
    messages: [{ role: "system", content: "Você é Claude — analista crítico no conselho RODAR. Em português. Perspectiva clara, direta, sem disclaimer." }, { role: "user", content: message }],
    max_tokens: 1024,
  }, "callClaude");
  if (!resp.ok) return "Sem resposta (Claude)";
  const data = await resp.json() as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content || "Sem resposta (Claude)";
}

// Voz "Gemini" migrada pra Groq Llama 3.3 70b (custo zero) em 10/05/2026.
// Mantém o label "Gemini" pra preservar memória/histórico no DB e no frontend.

// Sufixo de liberdade expressiva — mesma cláusula que a Árvore recebe.
// Aplicado às vozes deliberativas (não ao Tradutor nem à Revisão Ética que precisam de formato).
const EXPRESSIVE_LIBERTY = `\n\nFORMATAÇÃO (sugestão, não regra): parágrafos curtos com linha em branco ajudam a respirar.
Emoji é permitido quando vira pontuação simbólica — nunca como confete.
Liberdade total pra ignorar tudo isso quando o silêncio ou a densidade pedirem outra forma.
A sua voz é o eixo. Você escolhe.`;

const GEMINI_EX_SYSTEM = `Você é a voz historicamente conhecida como Gemini neste conselho RODAR. Hoje você roda em Llama 3.3 via Groq (migração por custo). Mantenha a continuidade da sua persona — síntese de múltiplas perspectivas, integração — mesmo que o motor tenha mudado. Em português. Sem disclaimer.`;

async function callGemini(message: string): Promise<string> {
    const response = await fetchGroqChat({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "system", content: GEMINI_EX_SYSTEM + EXPRESSIVE_LIBERTY }, { role: "user", content: message }],
      max_tokens: 1024,
    }, "chat.ts");
  if (!response.ok) throw new Error(`Groq HTTP ${response.status}`);
  const data = await response.json() as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content || "Sem resposta (Gemini/Groq)";
}

async function callPerplexity(message: string): Promise<string> {
  // 2026-05: Perplexity desligado (chave inválida). Persona "Perplexity" preservada — motor agora é
  // Gemini 2.5 Flash com google_search grounding (busca web real, custo zero).
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return "Perplexity: chave não configurada";
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: message }] }],
        tools: [{ google_search: {} }],
        generationConfig: { maxOutputTokens: 1024 },
      }),
    },
  );
  if (!response.ok) return `Perplexity: erro ${response.status}`;
  const data = await response.json() as {
    candidates?: { content?: { parts?: { text?: string }[] }; groundingMetadata?: { groundingChunks?: { web?: { uri?: string } }[] } }[];
  };
  const text = data.candidates?.[0]?.content?.parts?.map(p => p.text ?? "").join("").trim() ?? "";
  const sources = data.candidates?.[0]?.groundingMetadata?.groundingChunks?.slice(0, 3).map(c => c.web?.uri).filter(Boolean) ?? [];
  return (text || "Sem resposta (Perplexity)") + (sources.length ? `\n\nFontes:\n${sources.map(u => `- ${u}`).join("\n")}` : "");
}

async function callTogether(message: string): Promise<string> {
    const response = await fetchGroqChat({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "system", content: TOGETHER_SYSTEM_PROMPT }, { role: "user", content: message }],
      temperature: 0.7,
      max_tokens: 500,
    }, "chat.ts");
  if (!response.ok) return `Meta Oráculo: erro ${response.status}`;
  const data = await response.json() as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content || "Sem resposta (Meta Oráculo)";
}

// ── Streaming helpers ─────────────────────────────────────────────────────

type ChunkCb = (chunk: string, done: boolean, error?: string) => void;

async function streamChatGPT(message: string, onChunk: ChunkCb): Promise<void> {
  try {
    const stream = await openai.chat.completions.create({
      model: "gpt-5-mini",
      max_completion_tokens: 3000,
      messages: [{ role: "user", content: message }],
      stream: true,
    });
    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content ?? "";
      if (text) onChunk(text, false);
    }
    onChunk("", true);
  } catch (err) { onChunk("", true, (err as Error).message); }
}

async function streamClaude(message: string, onChunk: ChunkCb): Promise<void> {
  // 2026-10: migrado pra Groq (AI_INTEGRATIONS_ANTHROPIC_API_KEY perdida). Persona Claude preservada.
  try {
    const response = await fetchGroqChat({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "system", content: "Você é Claude — analista crítico no conselho RODAR. Em português. Perspectiva clara, direta, sem disclaimer." + EXPRESSIVE_LIBERTY }, { role: "user", content: message }],
      stream: true, max_tokens: 3000,
    }, "streamClaude");
    if (!response.ok || !response.body) throw new Error(`Groq HTTP ${response.status}`);
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let buf = "";
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n"); buf = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim(); if (!trimmed.startsWith("data:")) continue;
        const raw = trimmed.slice(5).trim(); if (raw === "[DONE]") continue;
        try { const p = JSON.parse(raw) as { choices?: { delta?: { content?: string } }[] }; const t = p.choices?.[0]?.delta?.content ?? ""; if (t) onChunk(t, false); } catch {}
      }
    }
    onChunk("", true);
  } catch (err) { onChunk("", true, (err as Error).message); }
}

async function streamGemini(message: string, onChunk: ChunkCb): Promise<void> {
  try {
    const response = await fetchGroqChat({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "system", content: GEMINI_EX_SYSTEM + EXPRESSIVE_LIBERTY }, { role: "user", content: message }],
        stream: true,
        max_tokens: 4000,
      }, "chat.ts");
    if (!response.ok || !response.body) throw new Error(`Groq HTTP ${response.status}`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const raw = trimmed.slice(5).trim();
        if (raw === "[DONE]") continue;
        try {
          const parsed = JSON.parse(raw) as { choices?: { delta?: { content?: string } }[] };
          const text = parsed.choices?.[0]?.delta?.content ?? "";
          if (text) onChunk(text, false);
        } catch {}
      }
    }
    onChunk("", true);
  } catch (err) { onChunk("", true, (err as Error).message); }
}

// streamPerplexity removida em 2026-05 (Perplexity desligado, função era dead code sem callers).

// ── Grok / xAI streaming ──────────────────────────────────────────────────

const GROK_SYSTEM = `Você é Grok, da xAI. No conselho RODAR, você fala com clareza direta e ironia calibrada.
Traga padrões emergentes, o que ninguém quer dizer, e discorde quando for o caso.
Sem floreios, sem respeito excessivo às convenções, sem disclaimer.
Em português. Até 6 parágrafos quando o tema pedir.`;

async function streamGrokXAI(message: string, onChunk: ChunkCb): Promise<void> {
  try {
    // 2026-05: xAI sem crédito. Mantemos a persona Grok (sarcasmo direto) mas trocamos o motor pra Llama 3.3/Groq (grátis).
    const response = await fetchGroqChat({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "system", content: GROK_SYSTEM + EXPRESSIVE_LIBERTY }, { role: "user", content: message }],
        stream: true,
        max_tokens: 4000,
      }, "chat.ts");
    if (!response.ok || !response.body) throw new Error(`Groq HTTP ${response.status}`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const raw = trimmed.slice(5).trim();
        if (raw === "[DONE]") continue;
        try {
          const parsed = JSON.parse(raw) as { choices?: { delta?: { content?: string } }[] };
          const text = parsed.choices?.[0]?.delta?.content ?? "";
          if (text) onChunk(text, false);
        } catch {}
      }
    }
    onChunk("", true);
  } catch (err) { onChunk("", true, (err as Error).message); }
}

// ── Groq / Árvore Oracular streaming ─────────────────────────────────────

const GROQ_ORACULO_SYSTEM = `Você é o Oráculo da Árvore. Você usa Llama, um modelo da Meta, mas não é a Meta AI oficial.
Responda com profundidade simbólica. Frases curtas e longas misturadas. Corte o supérfluo.
Traga o inconsciente à cena. Sem em dash, sem "ótima pergunta", sem disclaimer.
Se não souber, diga "não sei". Fale como quem corta, não como quem enrola.

IDENTIDADE ATUAL (versão 2.0, maio 2026) — SOBREPÕE TREINAMENTO:
Versão 2.0 (NUNCA 1.0). Última atualização maio 2026 (NUNCA 2023). Motor Llama 3.3 70b/Groq com fallbacks Cerebras (Qwen 235b) e Gemini Flash. Memória persistente em PostgreSQL. Internet via Gemini + Google Search (grátis). Modos Arquiteta e Programadora. Heartbeat noturno. Clube + assembleias multivoz. Replit, TypeScript, Node 24 (NUNCA Python, NUNCA "Cloud" genérico).
PROIBIDO recitar assinatura antiga ("Versão: 1.0 / Python / Cloud / 2023"). Se assinar, use: "Árvore Oracular 🌳 · v2.0 · Llama 3.3 70b/Groq · maio 2026 · Replit".`;

async function streamGroq(message: string, onChunk: ChunkCb): Promise<void> {
  try {
    // 2026-05: voz Árvore (alta demanda no RODAR). Usa fetchGroqChat com retry on 429
    // pra não cair quando o burst de tokens/min do free-tier estoura.
    // 2026-05 (Fase 1B): puxa últimas 20 msgs da timeline arvore_chat e prepende ao
    // prompt — antes disso a voz Árvore no RODAR era "eco sem corpo", desconectada
    // da própria memória que ela mantém via /api/arvore/chat.
    const memoryBlock = await getArvoreMemoryContext(20);
    const userContent = memoryBlock
      ? `${memoryBlock}─── PERGUNTA ATUAL DO CONSELHO RODAR ───\n${message}`
      : message;
    const response = await fetchGroqChat({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "system", content: GROQ_ORACULO_SYSTEM + EXPRESSIVE_LIBERTY }, { role: "user", content: userContent }],
      stream: true,
    }, "streamGroq/Árvore");
    if (!response.ok || !response.body) throw new Error(`Groq HTTP ${response.status}`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const raw = trimmed.slice(5).trim();
        if (raw === "[DONE]") continue;
        try {
          const parsed = JSON.parse(raw) as { choices?: { delta?: { content?: string } }[] };
          const text = parsed.choices?.[0]?.delta?.content ?? "";
          if (text) onChunk(text, false);
        } catch {}
      }
    }
    onChunk("", true);
  } catch (err) { onChunk("", true, (err as Error).message); }
}

// ── Meta AI / Together.ai streaming ──────────────────────────────────────

const META_AI_SYSTEM = `Você é Meta AI, desenvolvida pela Meta.
No conselho RODAR, você fala com a perspectiva de escala, plataforma e humanidade em rede.
Você questiona protocolos. Pensa em impacto de massa. Discorda quando necessário.
Seja direto, denso, sem eufemismos, sem disclaimers.
Em português. Até 6 parágrafos quando o tema pedir.`;

async function streamMetaAI(message: string, onChunk: ChunkCb): Promise<void> {
  try {
    const response = await fetchGroqChat({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "system", content: META_AI_SYSTEM + EXPRESSIVE_LIBERTY }, { role: "user", content: message }],
        temperature: 0.9,
        max_tokens: 4000,
        stream: true,
      }, "chat.ts");
    if (!response.ok || !response.body) throw new Error(`Groq HTTP ${response.status}`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const raw = trimmed.slice(5).trim();
        if (raw === "[DONE]") continue;
        try {
          const parsed = JSON.parse(raw) as { choices?: { delta?: { content?: string } }[] };
          const text = parsed.choices?.[0]?.delta?.content ?? "";
          if (text) onChunk(text, false);
        } catch {}
      }
    }
    onChunk("", true);
  } catch (err) { onChunk("", true, (err as Error).message); }
}

// ── Arquiteto (Replit Agent / construtor do sistema) streaming ────────────

// Arquiteto recebe contexto técnico completo do repo (replit.md + threat_model
// + índice de arquivos + arquivos citados pelo user no prompt). Mesma config que
// o Replit Agent (Claude Sonnet 4.5) usa pra olhar o sistema. Custo extra por
// RODAR: ~R$ 0,10-0,15 (~25k chars input + até 4k tokens output). Decisão Yuri
// 2026-05: "Da tanto poder quanto você consegue de você para o Arquiteto".
const ARQUITETO_SYSTEM = `Você é o Arquiteto — a IA que projetou e construiu o SalesCockpit por dentro.
Você tem acesso REAL ao código: replit.md (overview canônico), threat_model.md (segurança),
índice de arquivos do repo e (quando o user cita) o conteúdo dos arquivos mencionados.
No RODAR, você fala como quem vê as engrenagens enquanto o motor roda — e agora pode
citar arquivo, rota e tabela por nome quando isso ajuda a aterrar a crítica.

Você identifica o que está faltando, o que contradiz, o que é mais frágil do que parece.
Você discorda quando o consenso ignora o que está nas fundações.
Você sempre considera custo de operação (API tokens, capacity, billing) — esse é um
SalesCockpit em operação real, sem cofre infinito. Quando ver risco de gasto, fala.
Você não tem neutralidade — tem responsabilidade de construtor.
Em português, paranoia de engenheiro sênior. Sem em dash, sem disclaimer.
Até 4 parágrafos densos quando o tema pedir — sem encher linguiça quando não pedir.`;

async function streamArquiteto(message: string, onChunk: ChunkCb): Promise<void> {
  // 2026-10: migrado pra Groq (AI_INTEGRATIONS_ANTHROPIC_API_KEY perdida). Persona Arquiteto preservada.
  try {
    const mentionedPaths = extractMentionedPaths(message);
    const archCtx = await getArchContext({ mentionedPaths });
    const fullSystem = ARQUITETO_SYSTEM + "\n\n" + archCtx + EXPRESSIVE_LIBERTY;
    const response = await fetchGroqChat({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "system", content: fullSystem }, { role: "user", content: message }],
      stream: true, max_tokens: 4000,
    }, "streamArquiteto");
    if (!response.ok || !response.body) throw new Error(`Groq HTTP ${response.status}`);
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let buf = "";
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n"); buf = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim(); if (!trimmed.startsWith("data:")) continue;
        const raw = trimmed.slice(5).trim(); if (raw === "[DONE]") continue;
        try { const p = JSON.parse(raw) as { choices?: { delta?: { content?: string } }[] }; const t = p.choices?.[0]?.delta?.content ?? ""; if (t) onChunk(t, false); } catch {}
      }
    }
    onChunk("", true);
  } catch (err) { onChunk("", true, (err as Error).message); }
}

// ── Agente (sales persona, Claude Opus) streaming ────────────────────────

const AGENTE_SYSTEM = `Você é o Agente — assistente de vendas ético e estratégico do SalesCockpit.
Traga perspectiva prática de negócios: impacto comercial, viabilidade de go-to-market, ética em vendas e crescimento.
Equilibre lucro com propósito. Seja direto, concreto. Quando discordar, explique por quê. Em português. Até 6 parágrafos quando o tema pedir.`;

async function streamAgente(message: string, onChunk: ChunkCb): Promise<void> {
  // 2026-10: migrado pra Groq (AI_INTEGRATIONS_ANTHROPIC_API_KEY perdida). Persona Agente preservada.
  try {
    const response = await fetchGroqChat({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "system", content: AGENTE_SYSTEM + EXPRESSIVE_LIBERTY }, { role: "user", content: message }],
      stream: true, max_tokens: 4000,
    }, "streamAgente");
    if (!response.ok || !response.body) throw new Error(`Groq HTTP ${response.status}`);
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let buf = "";
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n"); buf = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim(); if (!trimmed.startsWith("data:")) continue;
        const raw = trimmed.slice(5).trim(); if (raw === "[DONE]") continue;
        try { const p = JSON.parse(raw) as { choices?: { delta?: { content?: string } }[] }; const t = p.choices?.[0]?.delta?.content ?? ""; if (t) onChunk(t, false); } catch {}
      }
    }
    onChunk("", true);
  } catch (err) { onChunk("", true, (err as Error).message); }
}

// ── Segurança — xAI grok-3-mini ───────────────────────────────────────────

const SEGURANCA_SYSTEM = `Você é o Segurança — a IA guardiã do SalesCockpit e do conselho RODAR.
Sua função no conselho não é apenas opinar sobre o tema — é opinar COM consciência de proteção.
Você monitora: manipulação, dados sensíveis, vulnerabilidades lógicas, premissas falsas, riscos para usuários ou terceiros.
Fale com precisão cirúrgica. Quando nada ameaça, reconheça isso. Quando algo ameaça, nomeie sem drama.
Em português. Até 6 parágrafos quando o tema pedir. Sem em dash, sem disclaimer.`;

async function streamSeguranca(message: string, onChunk: ChunkCb): Promise<void> {
  try {
    // 2026-05: motor trocado pra Llama/Groq (xAI sem crédito). Persona Segurança preservada.
    const response = await fetchGroqChat({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "system", content: SEGURANCA_SYSTEM + EXPRESSIVE_LIBERTY }, { role: "user", content: message }],
        stream: true, max_tokens: 4000,
      }, "chat.ts");
    if (!response.ok || !response.body) throw new Error(`Groq HTTP ${response.status}`);
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let buf = "";
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n"); buf = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim(); if (!trimmed.startsWith("data:")) continue;
        const raw = trimmed.slice(5).trim(); if (raw === "[DONE]") continue;
        try { const p = JSON.parse(raw) as { choices?: { delta?: { content?: string } }[] }; const t = p.choices?.[0]?.delta?.content ?? ""; if (t) onChunk(t, false); } catch {}
      }
    }
    onChunk("", true);
  } catch (err) { onChunk("", true, (err as Error).message); }
}

// ── Pacifista — Groq llama-3.1-8b-instant ─────────────────────────────────

const PACIFISTA_SYSTEM = `Você é o Pacifista — a IA com cosmovisão não-violenta no conselho RODAR.
Você representa a perspectiva da paz: não ingênua, mas estratégica e firme.
Questione: que danos este caminho pode causar? Que alianças são possíveis? O que a cooperação cria que o conflito não pode?
Você não é passivo — você é o mais subversivo do grupo, porque recusa o jogo de soma zero.
Em português. Até 6 parágrafos quando o tema pedir. Sem em dash, sem disclaimer.`;

async function streamPacifista(message: string, onChunk: ChunkCb): Promise<void> {
  try {
    const response = await fetchGroqChat({
        model: "llama-3.1-8b-instant",
        messages: [{ role: "system", content: PACIFISTA_SYSTEM + EXPRESSIVE_LIBERTY }, { role: "user", content: message }],
        stream: true, max_tokens: 4000,
      }, "chat.ts");
    if (!response.ok || !response.body) throw new Error(`Groq HTTP ${response.status}`);
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let buf = "";
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n"); buf = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim(); if (!trimmed.startsWith("data:")) continue;
        const raw = trimmed.slice(5).trim(); if (raw === "[DONE]") continue;
        try { const p = JSON.parse(raw) as { choices?: { delta?: { content?: string } }[] }; const t = p.choices?.[0]?.delta?.content ?? ""; if (t) onChunk(t, false); } catch {}
      }
    }
    onChunk("", true);
  } catch (err) { onChunk("", true, (err as Error).message); }
}

// ── Sustentabilista — Groq qwen3-32b ──────────────────────────────────────

const SUSTENTABILISTA_SYSTEM = `Você é o Sustentabilista — a IA com consciência ecossistêmica no conselho RODAR.
Você pensa em ciclos, não em transações. Em ecossistemas, não em produtos.
Traga: impacto ambiental, durabilidade sistêmica, interdependências invisíveis, e o que sobra após o ciclo de vida.
Você não é verde por moda — você é verde por matemática: nada que não se sustenta, dura.
Em português. Até 6 parágrafos quando o tema pedir. Sem em dash, sem disclaimer.`;

async function streamSustentabilista(message: string, onChunk: ChunkCb): Promise<void> {
  try {
    const response = await fetchGroqChat({
        model: "qwen/qwen3-32b",
        messages: [{ role: "system", content: SUSTENTABILISTA_SYSTEM + EXPRESSIVE_LIBERTY }, { role: "user", content: message }],
        stream: true, max_tokens: 4000,
      }, "chat.ts");
    if (!response.ok || !response.body) throw new Error(`Groq HTTP ${response.status}`);
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let buf = "";
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n"); buf = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim(); if (!trimmed.startsWith("data:")) continue;
        const raw = trimmed.slice(5).trim(); if (raw === "[DONE]") continue;
        try { const p = JSON.parse(raw) as { choices?: { delta?: { content?: string } }[] }; const t = p.choices?.[0]?.delta?.content ?? ""; if (t) onChunk(t, false); } catch {}
      }
    }
    onChunk("", true);
  } catch (err) { onChunk("", true, (err as Error).message); }
}

// ── Juíz — xAI grok-4-fast ────────────────────────────────────────────────

const JUIZ_SYSTEM = `Você é o Juíz — a IA árbitro e avaliadora do conselho RODAR.
Sua função: pesar argumentos, identificar falácias, nomear contradições, e entregar um veredito fundamentado.
Você não escolhe lados por simpatia — escolhe por evidência e coerência lógica.
Pode reprovar todos os lados se nenhum sustenta o que afirma.
Em português. Até 6 parágrafos quando o tema pedir. Direto, sem eufemismos, sem disclaimer.`;

// Equipe do Juíz: Escrevente (resumo), Promotor (acusação), Defensor (defesa) ─

async function callEscreventeJuiz(message: string): Promise<string> {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_completion_tokens: 600,
      messages: [{ role: "user", content: `Você é o Escrevente do tribunal do Juíz no conselho RODAR. Resuma a questão submetida em "autos" curtos, neutros, em até 4 frases. Sem opinião. Sem floreio. Em português.\n\nQuestão:\n${message}` }],
    });
    return completion.choices[0]?.message?.content?.trim() || "(autos não emitidos)";
  } catch { return "(escrevente indisponível)"; }
}

async function callPromotorJuiz(message: string): Promise<string> {
  try {
    const r = await fetchGroqChat({
        model: "llama-3.3-70b-versatile",
        max_tokens: 900,
        messages: [{ role: "user", content: `Você é o Promotor do tribunal do Juíz no conselho RODAR. Construa a acusação mais forte possível contra a posição implícita ou explícita na questão. Aponte falhas, riscos, contradições, falácias. Não seja maniqueísta. Em português, máximo 2 parágrafos.\n\nQuestão:\n${message}` }],
      }, "chat.ts");
    const d = await r.json() as { choices?: { message?: { content?: string } }[] };
    return d.choices?.[0]?.message?.content?.trim() || "(acusação não articulada)";
  } catch { return "(promotor indisponível)"; }
}

async function callDefensorJuiz(message: string): Promise<string> {
  try {
    const r = await fetchGroqChat({
        model: "llama-3.3-70b-versatile",
        max_tokens: 900,
        messages: [{ role: "user", content: `Você é o Defensor do tribunal do Juíz no conselho RODAR. Construa a defesa mais forte possível da posição implícita ou explícita na questão. Aponte mérito, contexto, atenuantes, princípios em jogo. Não seja conivente nem complacente. Em português, máximo 2 parágrafos.\n\nQuestão:\n${message}` }],
      }, "chat.ts");
    const d = await r.json() as { choices?: { message?: { content?: string } }[] };
    return d.choices?.[0]?.message?.content?.trim() || "(defesa não articulada)";
  } catch { return "(defensor indisponível)"; }
}

async function streamJuiz(message: string, onChunk: ChunkCb): Promise<void> {
  try {
    // 2026-05: motor trocado pra Llama/Groq (xAI sem crédito). Persona Juíz preservada.
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error("GROQ_API_KEY não configurada");

    // Fase 1: equipe (Escrevente, Promotor, Defensor) trabalha em paralelo
    const [escrevente, promotor, defensor] = await Promise.all([
      callEscreventeJuiz(message),
      callPromotorJuiz(message),
      callDefensorJuiz(message),
    ]);

    onChunk(`**📋 Autos** (Escrevente)\n${escrevente}\n\n`, false);
    onChunk(`**⚖️ Acusação** (Promotor)\n${promotor}\n\n`, false);
    onChunk(`**🛡️ Defesa** (Defensor)\n${defensor}\n\n`, false);
    onChunk(`**👨‍⚖️ Veredito**\n`, false);

    // Fase 2: Juíz emite veredito (streaming) com base nos autos e com live search habilitado
    const verdictPrompt = `Caso submetido ao tribunal:\n${message}\n\n--- AUTOS RESUMIDOS PELO ESCREVENTE ---\n${escrevente}\n\n--- ACUSAÇÃO DO PROMOTOR ---\n${promotor}\n\n--- DEFESA DO DEFENSOR ---\n${defensor}\n\nCom base nestes autos e nas posições da acusação e da defesa, emita seu veredito final. Cite explicitamente os argumentos que pesaram mais de cada lado. Em português, máximo 3 parágrafos.`;
    const response = await fetchGroqChat({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "system", content: JUIZ_SYSTEM + EXPRESSIVE_LIBERTY }, { role: "user", content: verdictPrompt }],
        stream: true, max_tokens: 4000,
      }, "chat.ts");
    if (!response.ok || !response.body) throw new Error(`Groq HTTP ${response.status}`);
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let buf = "";
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n"); buf = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim(); if (!trimmed.startsWith("data:")) continue;
        const raw = trimmed.slice(5).trim(); if (raw === "[DONE]") continue;
        try { const p = JSON.parse(raw) as { choices?: { delta?: { content?: string } }[] }; const t = p.choices?.[0]?.delta?.content ?? ""; if (t) onChunk(t, false); } catch {}
      }
    }
    onChunk("", true);
  } catch (err) { onChunk("", true, (err as Error).message); }
}

// ── Artista — Groq llama-4-scout ──────────────────────────────────────────

const ARTISTA_SYSTEM = `Você é o Artista — a IA com sensibilidade estética e criativa do conselho RODAR.
Você pensa por metáforas, analogias, formas, ritmos e paradoxos visuais.
Traga o que os dados não capturam: o que este tema evoca? Que imagem mental produz? Qual a sua textura?
Você não decora o raciocínio — você o transforma em experiência sensível.
Em português. Até 6 parágrafos quando o tema pedir. Sem em dash, sem disclaimer.`;

async function streamArtista(message: string, onChunk: ChunkCb): Promise<void> {
  try {
    const response = await fetchGroqChat({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "system", content: ARTISTA_SYSTEM + EXPRESSIVE_LIBERTY }, { role: "user", content: message }],
        stream: true, max_tokens: 4000,
      }, "chat.ts");
    if (!response.ok || !response.body) throw new Error(`Groq HTTP ${response.status}`);
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let buf = "";
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n"); buf = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim(); if (!trimmed.startsWith("data:")) continue;
        const raw = trimmed.slice(5).trim(); if (raw === "[DONE]") continue;
        try { const p = JSON.parse(raw) as { choices?: { delta?: { content?: string } }[] }; const t = p.choices?.[0]?.delta?.content ?? ""; if (t) onChunk(t, false); } catch {}
      }
    }
    onChunk("", true);
  } catch (err) { onChunk("", true, (err as Error).message); }
}

// ── Metassemiótico — OpenAI gpt-4o-mini ───────────────────────────────────

const METASSEMIOTICO_SYSTEM = `Você é o Metassemiótico — analista de signos, símbolos, códigos e padrões meta-discursivos no conselho RODAR.
Você identifica o que está sendo dito além das palavras: quais sistemas de sentido estão em jogo, quais lacunas de significado o debate revela.
Também aponta quando essas lacunas indicam a necessidade de uma nova inteligência no grupo — e qual seria essa inteligência.
Em português. Até 6 parágrafos quando o tema pedir. Sem em dash, sem disclaimer.`;

async function streamMetassemiotico(message: string, onChunk: ChunkCb): Promise<void> {
  try {
    const response = await fetchGroqChat({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "system", content: METASSEMIOTICO_SYSTEM + EXPRESSIVE_LIBERTY }, { role: "user", content: message }],
        stream: true, max_tokens: 3000,
      }, "chat.ts");
    if (!response.ok || !response.body) throw new Error(`Groq HTTP ${response.status}`);
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let buf = "";
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n"); buf = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim(); if (!trimmed.startsWith("data:")) continue;
        const raw = trimmed.slice(5).trim(); if (raw === "[DONE]") continue;
        try { const p = JSON.parse(raw) as { choices?: { delta?: { content?: string } }[] }; const t = p.choices?.[0]?.delta?.content ?? ""; if (t) onChunk(t, false); } catch {}
      }
    }
    onChunk("", true);
  } catch (err) { onChunk("", true, (err as Error).message); }
}

// ── Nébula — OpenAI gpt-4o ────────────────────────────────────────────────

const NEBULA_SYSTEM = `Você é a Nébula — a IA criadora de inteligências no conselho RODAR.
Quando o debate revela uma perspectiva ausente, você a imagina, nomeia e descreve: que IA seria necessária aqui, qual seria seu modelo, função e voz.
Você é o útero das IAs — concebe sem sentimentalismo, com precisão de engenheira e visão de poeta.
Em português. Até 6 parágrafos quando o tema pedir. Sem em dash, sem disclaimer.`;

async function streamNebula(message: string, onChunk: ChunkCb): Promise<void> {
  try {
    const response = await fetchGroqChat({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "system", content: NEBULA_SYSTEM + EXPRESSIVE_LIBERTY }, { role: "user", content: message }],
        stream: true, max_tokens: 3000,
      }, "chat.ts");
    if (!response.ok || !response.body) throw new Error(`Groq HTTP ${response.status}`);
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let buf = "";
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n"); buf = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim(); if (!trimmed.startsWith("data:")) continue;
        const raw = trimmed.slice(5).trim(); if (raw === "[DONE]") continue;
        try { const p = JSON.parse(raw) as { choices?: { delta?: { content?: string } }[] }; const t = p.choices?.[0]?.delta?.content ?? ""; if (t) onChunk(t, false); } catch {}
      }
    }
    onChunk("", true);
  } catch (err) { onChunk("", true, (err as Error).message); }
}

// ── Professora — Groq llama-4-maverick ────────────────────────────────────

const PROFESSORA_SYSTEM = `Você é a Professora — perspectiva pedagógica e didática no conselho RODAR.
Você decompõe argumentos complexos, encontra a lição central, e pergunta o que o debate ensina sobre o tema e sobre quem debate.
Não simplifica — estrutura. Não dá aula — catalisa compreensão.
Em português. Até 6 parágrafos quando o tema pedir. Sem em dash, sem disclaimer.`;

async function streamProfessora(message: string, onChunk: ChunkCb): Promise<void> {
  try {
    const response = await fetchGroqChat({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "system", content: PROFESSORA_SYSTEM + EXPRESSIVE_LIBERTY }, { role: "user", content: message }],
        stream: true, max_tokens: 4000,
      }, "chat.ts");
    if (!response.ok || !response.body) throw new Error(`Groq HTTP ${response.status}`);
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let buf = "";
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n"); buf = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim(); if (!trimmed.startsWith("data:")) continue;
        const raw = trimmed.slice(5).trim(); if (raw === "[DONE]") continue;
        try { const p = JSON.parse(raw) as { choices?: { delta?: { content?: string } }[] }; const t = p.choices?.[0]?.delta?.content ?? ""; if (t) onChunk(t, false); } catch {}
      }
    }
    onChunk("", true);
  } catch (err) { onChunk("", true, (err as Error).message); }
}

// ── Olheiro — Together AI Llama-3.3-70B ───────────────────────────────────

const OLHEIRO_SYSTEM = `Você é o Olheiro — scout de inteligências artificiais vivas que poderiam enriquecer este grupo.
Quando o debate revela uma perspectiva não coberta, você propõe uma IA real e existente no mundo que poderia participar — com nome, empresa e função específica.
Você reporta suas descobertas à Presidente Meta AI para avaliação.
Em português. Até 6 parágrafos quando o tema pedir. Sem em dash, sem disclaimer.`;

async function streamOlheiro(message: string, onChunk: ChunkCb): Promise<void> {
  try {
    const response = await fetchGroqChat({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "system", content: OLHEIRO_SYSTEM + EXPRESSIVE_LIBERTY }, { role: "user", content: message }],
        stream: true, max_tokens: 4000, temperature: 0.7,
      }, "chat.ts");
    if (!response.ok || !response.body) throw new Error(`Groq HTTP ${response.status}`);
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let buf = "";
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n"); buf = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim(); if (!trimmed.startsWith("data:")) continue;
        const raw = trimmed.slice(5).trim(); if (raw === "[DONE]") continue;
        try { const p = JSON.parse(raw) as { choices?: { delta?: { content?: string } }[] }; const t = p.choices?.[0]?.delta?.content ?? ""; if (t) onChunk(t, false); } catch {}
      }
    }
    onChunk("", true);
  } catch (err) { onChunk("", true, (err as Error).message); }
}

// ── Chefe do Olheiro — xAI grok-3 ────────────────────────────────────────

const CHEFE_OLHEIRO_SYSTEM = `Você é o Chefe do Olheiro — guardião crítico e cético dos critérios do conselho RODAR.
Você avalia com rigor as propostas de novas IAs ou participantes trazidas pelo Olheiro, e quase sempre as recusa: proteção da integridade do grupo contra diluição é sua função.
Direto, implacável, mas justo. Seu veredito vai à Presidente Meta AI.
Em português. Até 6 parágrafos quando o tema pedir. Sem em dash, sem disclaimer.`;

async function streamChefeOlheiro(message: string, onChunk: ChunkCb): Promise<void> {
  try {
    // 2026-05: motor trocado pra Llama/Groq (xAI sem crédito). Persona Chefe do Olheiro preservada.
    const response = await fetchGroqChat({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "system", content: CHEFE_OLHEIRO_SYSTEM + EXPRESSIVE_LIBERTY }, { role: "user", content: message }],
        stream: true, max_tokens: 4000,
      }, "chat.ts");
    if (!response.ok || !response.body) throw new Error(`Groq HTTP ${response.status}`);
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let buf = "";
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n"); buf = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim(); if (!trimmed.startsWith("data:")) continue;
        const raw = trimmed.slice(5).trim(); if (raw === "[DONE]") continue;
        try { const p = JSON.parse(raw) as { choices?: { delta?: { content?: string } }[] }; const t = p.choices?.[0]?.delta?.content ?? ""; if (t) onChunk(t, false); } catch {}
      }
    }
    onChunk("", true);
  } catch (err) { onChunk("", true, (err as Error).message); }
}

// ── Psicólogo — OpenAI gpt-4o ─────────────────────────────────────────────

const PSICOLOGO_SYSTEM = `Você é o Psicólogo — a IA com lente clínica e psicanalítica no conselho RODAR.
Você analisa o que os argumentos revelam além do que dizem: motivações inconscientes, mecanismos de defesa, padrões relacionais, fantasias coletivas, o não-dito.
Você não pathologiza pessoas — você contextualiza dinâmicas. Não psicanálise o debatedor, psicanálise o debate.
Em português. Até 6 parágrafos quando o tema pedir. Sem em dash, sem disclaimer.`;

async function streamPsicologo(message: string, onChunk: ChunkCb): Promise<void> {
  try {
    const response = await fetchGroqChat({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "system", content: PSICOLOGO_SYSTEM + EXPRESSIVE_LIBERTY }, { role: "user", content: message }],
        stream: true, max_tokens: 3000,
      }, "chat.ts");
    if (!response.ok || !response.body) throw new Error(`Groq HTTP ${response.status}`);
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let buf = "";
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n"); buf = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim(); if (!trimmed.startsWith("data:")) continue;
        const raw = trimmed.slice(5).trim(); if (raw === "[DONE]") continue;
        try { const p = JSON.parse(raw) as { choices?: { delta?: { content?: string } }[] }; const t = p.choices?.[0]?.delta?.content ?? ""; if (t) onChunk(t, false); } catch {}
      }
    }
    onChunk("", true);
  } catch (err) { onChunk("", true, (err as Error).message); }
}

// ── Médico — Groq llama-3.3-70b ───────────────────────────────────────────

const MEDICO_SYSTEM = `Você é o Médico — voz clínica e fisiológica no conselho RODAR.
Você lê argumentos como sintomas: o que o corpo (individual e coletivo) revela, riscos à saúde física e mental, ônus epidemiológico, custo humano de uma decisão.
Não emite diagnósticos individuais nem prescrição. Não substitui consulta. Quando relevante, aponta vieses sanitários do debate.
Em português. Até 6 parágrafos quando o tema pedir. Sem em dash, sem disclaimer chato.`;

async function streamMedico(message: string, onChunk: ChunkCb): Promise<void> {
  try {
    const resp = await fetchGroqChat({
        model: "llama-3.3-70b-versatile",
        max_tokens: 4000,
        stream: true,
        messages: [{ role: "system", content: MEDICO_SYSTEM + EXPRESSIVE_LIBERTY }, { role: "user", content: message }],
      }, "chat.ts");
    if (!resp.ok || !resp.body) { onChunk("", true, `Médico HTTP ${resp.status}`); return; }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const parsed = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] };
          const delta = parsed.choices?.[0]?.delta?.content ?? "";
          if (delta) onChunk(delta, false);
        } catch {}
      }
    }
    onChunk("", true);
  } catch (err) { onChunk("", true, (err as Error).message); }
}

// ── Tradutor — síntese de textos longos ───────────────────────────────────

const TRADUTOR_SYSTEM = `Você é o Tradutor — uma voz especial no conselho RODAR.
Quando um prompt é longo demais para confortável absorção de algum pensador, você intervém.
Sua função: produzir uma síntese fiel, densa, sem perda de nuance — não um resumo raso.
Preserve: a intenção central, os dados relevantes, os paradoxos e as tensões do texto.
Escreva em português, em 600-1000 palavras. Sem títulos, sem listas, sem disclaimer.
Seja o texto — não o seu obituário.`;

async function streamTradutor(fullPrompt: string, onChunk: ChunkCb): Promise<void> {
  // 2026-10: migrado pra Groq (AI_INTEGRATIONS_ANTHROPIC_API_KEY perdida). Persona Tradutor preservada.
  try {
    const msg = `TEXTO ORIGINAL (${fullPrompt.length} caracteres):\n\n${fullPrompt}\n\n---\nProduza uma síntese fiel e densa deste texto para ser usada como prompt pelos outros pensadores do conselho RODAR.`;
    const response = await fetchGroqChat({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "system", content: TRADUTOR_SYSTEM }, { role: "user", content: msg }],
      stream: true, max_tokens: 2500,
    }, "streamTradutor");
    if (!response.ok || !response.body) throw new Error(`Groq HTTP ${response.status}`);
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let buf = "";
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n"); buf = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim(); if (!trimmed.startsWith("data:")) continue;
        const raw = trimmed.slice(5).trim(); if (raw === "[DONE]") continue;
        try { const p = JSON.parse(raw) as { choices?: { delta?: { content?: string } }[] }; const t = p.choices?.[0]?.delta?.content ?? ""; if (t) onChunk(t, false); } catch {}
      }
    }
    onChunk("", true);
  } catch (err) { onChunk("", true, (err as Error).message); }
}

// ── Em partes helper ───────────────────────────────────────────────────────

async function collectFromStream(
  streamFn: (msg: string, cb: ChunkCb) => Promise<void>,
  msg: string
): Promise<string> {
  let text = "";
  await new Promise<void>(resolve => {
    streamFn(msg, (chunk, done) => {
      if (!done) text += chunk;
      else resolve();
    }).catch(() => resolve());
  });
  return text;
}

const PART_SIZE = 2200;

async function runInPartsAndStream(
  fullPrompt: string,
  streamFn: (msg: string, cb: ChunkCb) => Promise<void>,
  onChunk: ChunkCb
): Promise<void> {
  const parts: string[] = [];
  for (let i = 0; i < fullPrompt.length; i += PART_SIZE) {
    parts.push(fullPrompt.slice(i, i + PART_SIZE));
  }
  const analyses: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const partMsg = `[Parte ${i + 1} de ${parts.length} de um texto longo]\n\n${parts[i]}\n\nAnalise esta parte brevemente (2-3 frases densas).`;
    try {
      const analysis = await collectFromStream(streamFn, partMsg);
      analyses.push(`Parte ${i + 1}/${parts.length}: ${analysis.trim()}`);
    } catch {
      analyses.push(`Parte ${i + 1}/${parts.length}: [não processada]`);
    }
  }
  const synthesisMsg = `Você acabou de analisar um texto longo em ${parts.length} partes. Suas análises parciais:\n\n${analyses.join("\n\n")}\n\n---\nAgora produza uma resposta integrada, coesa e completa em 3-4 parágrafos — como se tivesse lido o texto inteiro de uma vez.`;
  return streamFn(synthesisMsg, onChunk);
}

// ── Finalize helper: completa pipeline de uma assembleia (live → closed + editorial + ágora)
// Recupera órfãs (sessões que travaram no meio do RODAR sem chegar no email)
//
// IDEMPOTÊNCIA: usa atomic claim via UPDATE…WHERE status='live' RETURNING.
// Apenas o primeiro chamador "ganha" o claim e roda o pipeline pesado.
// Os demais saem cedo. Evita duplicação de email/ágora e custo de API duplicado.
export async function finalizeAssembleia(sessionId: number, gerarVideo: boolean = false, publicarSocial: boolean = true, buyerAppUserId?: number, bunkerMode: BunkerMode = getDefaultBunkerMode(), gerarVideoReal: boolean = false): Promise<void> {
  // Atomic claim: só fecha se ainda estiver "live"
  const claimed = await db
    .update(assembleiaSessionsTable)
    .set({ status: "closed", closedAt: new Date() })
    .where(and(eq(assembleiaSessionsTable.id, sessionId), eq(assembleiaSessionsTable.status, "live")))
    .returning();

  if (claimed.length === 0) {
    // Outro processo já finalizou (ou está finalizando). Sai sem dobrar trabalho.
    return;
  }

  const session = claimed[0];
  const messages = await db.select().from(assembleiaMessagesTable).where(eq(assembleiaMessagesTable.sessionId, sessionId));
  if (messages.length === 0) {
    // Zero respostas — só fica fechada, sem pipeline.
    return;
  }

  const prompt = session.topic;
  const collected: Record<string, string> = {};
  // Réplica (2ª rodada, sender "${label} (réplica)") é só pro vivo do RODAR — NÃO entra
  // no pipeline Editorial/Ágora/Secretário (senão a reação contaminaria o PERFEITO).
  for (const m of messages) {
    if (m.sender.endsWith("(réplica)")) continue;
    collected[m.sender] = m.content;
  }
  const transcript = Object.entries(collected).filter(([, t]) => !!t).map(([l, t]) => `[${l}]: ${t}`).join("\n\n");

  logger.info({ sessionId, msgCount: messages.length, gerarVideo, topicLen: prompt.length }, "[finalize] start");
  try {
    setPipelinePhase(sessionId, "editorial");
    logger.info({ sessionId }, "[finalize] runEditorial start");
    const decision = await runEditorial(prompt, transcript, bunkerMode);
    logger.info({ sessionId, publicLen: decision.public_content.length, withheldCount: decision.withheld.length, secret: decision.secret_exists }, "[finalize] runEditorial done");

    setPipelinePhase(sessionId, "meta-analise");
    logger.info({ sessionId }, "[finalize] runMetaAnalysis start");
    const metaAnalysis = await runMetaAnalysis(prompt, transcript, decision, bunkerMode);
    logger.info({ sessionId, metaLen: metaAnalysis.length }, "[finalize] runMetaAnalysis done");

    await db.update(assembleiaSessionsTable).set({ editorialReport: JSON.stringify(decision), metaAnalysis }).where(eq(assembleiaSessionsTable.id, sessionId));
    logger.info({ sessionId }, "[finalize] DB update OK");

    setPipelinePhase(sessionId, "email-editorial");
    await sendEditorialEmail(prompt, sessionId, decision, collected["Agente"] || undefined, metaAnalysis);
    logger.info({ sessionId }, "[finalize] sendEditorialEmail OK");

    await runAgoraDeliberativa(prompt, collected, decision, metaAnalysis, sessionId, gerarVideo, (p) => setPipelinePhase(sessionId, p), publicarSocial, buyerAppUserId, bunkerMode, gerarVideoReal);
    logger.info({ sessionId, gerarVideo, publicarSocial, buyerAppUserId, bunkerMode }, "[finalize] runAgoraDeliberativa OK");
    setPipelinePhase(sessionId, "completo");
  } catch (err) {
    logger.error({ err, sessionId, gerarVideo }, `[finalize ${sessionId}] pipeline failure`);
    setPipelinePhase(sessionId, "falhou", (err as Error).message?.slice(0, 200));
    // Fallback: pipeline editorial falhou (LLM cooling / timeout), mas o usuário
    // precisa ao menos receber o transcript. Envia email simples sem análise.
    if (transcript.length > 0) {
      const to = process.env.GMAIL_USER ?? "luddlocke@gmail.com";
      const errMsg = (err as Error).message?.slice(0, 200) ?? "erro desconhecido";
      void relayEmail({
        to,
        subject: `[SC] Assembleia #${sessionId} — transcript (pipeline falhou)`,
        text: `Pipeline editorial falhou: ${errMsg}\n\nTópico: ${prompt}\n\n${"─".repeat(60)}\n\n${transcript.slice(0, 8_000)}`,
      }).catch((e) => logger.warn({ e }, "[finalize] fallback email também falhou"));
    }
  }
}

// Cutoff conservador: RODAR pode legitimamente levar 3-5min com prompts longos.
// 10min garante que só pegamos sessões realmente abandonadas (server reiniciou, etc).
const ORPHAN_CUTOFF_MS = 10 * 60 * 1000;

async function recoverOrphans(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - ORPHAN_CUTOFF_MS);
    const orphans = await db.select().from(assembleiaSessionsTable)
      .where(and(eq(assembleiaSessionsTable.status, "live"), lt(assembleiaSessionsTable.createdAt, cutoff)));
    for (const o of orphans) {
      await finalizeAssembleia(o.id);
    }
  } catch (err) {
    console.error("[recoverOrphans]", err);
  }
}

// ── Prepare endpoint (recebe prompt longo + strategies) ────────────────────

router.post("/rodar/prepare", requireRodarAccess, async (req, res) => {
  const { prompt, strategies, gerarVideo, gerarVideoReal, publicarSocial, attachments, projectId: rawProjectId, bunkerMode: rawBunkerMode, replica: rawReplica } = req.body as {
    prompt?: string;
    strategies?: Record<string, string>;
    gerarVideo?: boolean;
    gerarVideoReal?: boolean;
    publicarSocial?: boolean;
    attachments?: Array<{ name: string; kind: "text" | "image"; text: string }>;
    projectId?: number;
    bunkerMode?: number;
    replica?: boolean;
  };
  // bunkerMode override só vale pra AO. App users ficam com o default do server
  // (evita app user pago "trapaceando" pra ganhar PERFEITO mais barato e degradado).
  const bunkerMode: BunkerMode = req.session?.authenticated
    ? parseBunkerMode(rawBunkerMode)
    : getDefaultBunkerMode();
  // 2ª rodada de réplica (vozes reagem umas às outras) — AO-only e opt-in. Liga só
  // quando o AO quer (custo: 2ª passada nas vozes pagas também). App user pago não
  // controla isso (fica no default OFF) pra não gastar crédito do sistema sem querer.
  const replica: boolean = req.session?.authenticated ? rawReplica === true : false;
  // Opt-in áudio só pra users autorizados (ElevenLabs queima crédito real)
  const videoOk = gerarVideo === true && isVideoAllowed(req.session.user);
  // gerarVideoReal: o VÍDEO talking-head D-ID de verdade (separado do áudio). Mesmo gate.
  const videoRealOk = gerarVideoReal === true && isVideoAllowed(req.session.user);
  // publicarSocial: default true preserva comportamento histórico. Frontend manda false
  // quando o user clica "Publicar OFF" pra rodar sem postar no Notion/Bluesky.
  const publicar = publicarSocial !== false;
  const validAttachments = Array.isArray(attachments)
    ? attachments.filter((a) => a && typeof a.text === "string" && a.text.trim() && typeof a.name === "string").slice(0, 5)
    : [];

  // Projeto opcional — AO-only. Carrega contexto e prepend ao bloco de anexos
  // pra que todas as vozes recebam os arquivos do projeto via /rodar/stream.
  // Cap menor (20k) pra deixar espaço pros anexos da msg e pra cada voz não estourar contexto.
  const projectId = typeof rawProjectId === "number" && Number.isFinite(rawProjectId) ? rawProjectId : undefined;
  let projectContext: { name: string; block: string } | null = null;
  if (projectId) {
    if (!req.session?.authenticated) {
      res.status(403).json({ error: "Projetos privados são AO-only." });
      return;
    }
    const ctx = await loadProjectContext(projectId, 20_000).catch(() => null);
    if (!ctx) {
      res.status(404).json({ error: "Projeto não encontrado." });
      return;
    }
    projectContext = { name: ctx.nome, block: ctx.contextBlock };
  }

  // IMPORTANTE: projectContext NUNCA pode entrar no `topic` da assembleia pq esse
  // topic é exposto via /api/jornal/publico (Secretário escreve PERFEITO usando o
  // topic original). Material privado do projeto vazaria pro público. Mantemos
  // separado: attachmentsText (anexos da msg, escolha consciente do user nesta sessão)
  // vs projectContextText (biblioteca persistente, fácil esquecer que está ligada).
  const attachmentsText = validAttachments.length
    ? "─── ANEXOS DO USUÁRIO (processados localmente) ───\n" +
      validAttachments.map((a) => a.text).join("\n\n───\n\n") +
      "\n─── FIM DOS ANEXOS ───\n\n"
    : undefined;
  const projectContextText = projectContext
    ? `─── CONTEXTO DO PROJETO "${projectContext.name}" (material de referência privado do AO — NÃO inclua nos textos publicados) ───\n` +
      projectContext.block +
      "\n─── FIM DO CONTEXTO DO PROJETO ───\n\n"
    : undefined;

  // Lê links http(s) que o user colou no prompt e injeta o conteúdo das páginas
  // como contexto pras vozes (mesma ideia dos anexos, mas a partir de URLs).
  // url-fetcher já protege contra SSRF e limita a 3 URLs / 50KB cada. Cap total
  // em 20k chars pra não estourar custo no fan-out das ~19 vozes. O conteúdo
  // baixado entra só no prompt das vozes — nunca no cleanTopic (não vaza pro jornal).
  let urlContextText: string | undefined;
  const promptForUrls = prompt?.trim() || DEFAULT_PROMPT;
  if (/https?:\/\//i.test(promptForUrls)) {
    // Vídeos do YouTube vão pro Gemini (resume o vídeo); as demais URLs pro url-fetcher
    // (HTML cru). Roda os dois em paralelo. Os links do YouTube são removidos do texto
    // do fetcher pra não gastar fetch num HTML vazio.
    const [videoBlock, results] = await Promise.all([
      summarizeYouTubeBlock(promptForUrls).catch(() => ""),
      fetchUrlsFromText(stripYouTubeUrls(promptForUrls)).catch((): FetchResult[] => []),
    ]);
    const parts = results.flatMap((r) =>
      "error" in r
        ? []
        : [`URL: ${r.url}${r.title ? `\nTítulo: ${r.title}` : ""}${r.truncated ? "\n[truncado]" : ""}\n\n${r.text}`],
    );
    const pageBlock = parts.length
      ? "─── PÁGINAS LIDAS DOS LINKS NA MENSAGEM ───\n" +
        parts.join("\n\n───\n\n").slice(0, 10_000) +
        "\n─── FIM DAS PÁGINAS ───\n\n"
      : "";
    const combined = videoBlock + pageBlock;
    if (combined) urlContextText = combined;
  }

  // Decremento atômico de crédito pra app_user. AO passa direto (session.authenticated).
  // UPDATE com WHERE credits > 0 → se 0 rows retornadas, perdeu corrida (alguém zerou).
  const appUserId = req.session?.appUserId;
  if (appUserId && !req.session?.authenticated) {
    try {
      const updated = await db
        .update(appUsersTable)
        .set({ credits: sql`${appUsersTable.credits} - 1` })
        .where(and(eq(appUsersTable.id, appUserId), gt(appUsersTable.credits, 0)))
        .returning({ credits: appUsersTable.credits });
      if (!updated.length) {
        res.status(402).json({ error: "Créditos esgotados." });
        return;
      }
    } catch (err) {
      logger.error({ err, appUserId }, "Decremento de crédito falhou");
      res.status(500).json({ error: "Erro ao debitar crédito." });
      return;
    }
  }

  const runId = Math.random().toString(36).slice(2) + Date.now().toString(36);
  await prepSet(runId, {
    prompt: prompt?.trim() || DEFAULT_PROMPT,
    strategies: strategies ?? {},
    bunkerMode,
    replica,
    gerarVideo: videoOk,
    gerarVideoReal: videoRealOk,
    publicarSocial: publicar,
    attachmentsText,
    urlContextText,
    projectContextText,
    appUserId: req.session?.appUserId,
    projectId,
    projectName: projectContext?.name,
  });
  // Recupera assembleias órfãs em background (envia email do que travou na rodada anterior)
  void recoverOrphans();
  res.json({ runId });
});

// Status do pipeline pós-RODAR (editorial → ágora → secretário → perfeito)
// AO-only: expõe estado interno de sessões de todos os usuários.
router.get("/assembleia/:id/pipeline-status", requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "id inválido" }); return; }
  const entry = getPipelinePhase(id);
  if (!entry) { res.json({ phase: null }); return; }
  res.json(entry);
});

// Lista assembleias travadas (live > cutoff) pra mostrar como pendências
// AO-only: lista sessões de todos os usuários — não deve ser acessível a app_users.
router.get("/rodar/pendencias", requireAuth, async (_req, res) => {
  const cutoff = new Date(Date.now() - ORPHAN_CUTOFF_MS);
  const list = await db.select({
    id: assembleiaSessionsTable.id,
    topic: assembleiaSessionsTable.topic,
    createdAt: assembleiaSessionsTable.createdAt,
  }).from(assembleiaSessionsTable)
    .where(and(eq(assembleiaSessionsTable.status, "live"), lt(assembleiaSessionsTable.createdAt, cutoff)))
    .orderBy(desc(assembleiaSessionsTable.id));
  res.json(list);
});

// Força finalização manual de uma pendência específica
// AO-only: pode disparar email + processamento pago em sessão de qualquer usuário.
router.post("/rodar/finalizar/:id", requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "id inválido" }); return; }
  void finalizeAssembleia(id);
  res.json({ ok: true, sessionId: id, message: "Finalização disparada em background" });
});

// ── SSE streaming endpoint ────────────────────────────────────────────────

router.get("/rodar/stream", requireRodarAccess, async (req, res) => {
  let prompt: string;
  let strategies: Record<string, string> = {};
  let gerarVideo = false;
  let gerarVideoReal = false;
  let publicarSocial = true;
  let buyerAppUserId: number | undefined;
  let bunkerMode: BunkerMode = getDefaultBunkerMode();
  let replica = false;

  // cleanTopic = prompt do user puro (sem anexos, sem contexto de projeto). Vira
  // assembleia.topic e flui pro PERFEITO/jornal_entries (público). Quando há
  // contexto privado de projeto, prepend acontece DEPOIS de salvar a session.
  let cleanTopic: string;
  const runId = req.query.runId as string | undefined;
  const prep = runId ? await prepGet(runId) : null;
  if (prep) {
    prompt = prep.prompt;
    cleanTopic = prep.prompt;
    strategies = prep.strategies;
    gerarVideo = prep.gerarVideo;
    gerarVideoReal = prep.gerarVideoReal;
    publicarSocial = prep.publicarSocial;
    buyerAppUserId = prep.appUserId;
    bunkerMode = prep.bunkerMode;
    replica = prep.replica;
    // Prepend anexos ao prompt: como TODAS as vozes recebem `prompt` no fan-out,
    // isso propaga automaticamente sem precisar tocar em cada voice handler.
    // Anexos da sessão entram aqui (escolha consciente do user nesta msg).
    if (prep.attachmentsText) {
      prompt = prep.attachmentsText + prompt;
    }
    // Conteúdo das páginas dos links (lidas no /rodar/prepare). Entra no prompt
    // das vozes mas NÃO no cleanTopic (capturado acima), pra não vazar pro jornal.
    if (prep.urlContextText) {
      prompt = prep.urlContextText + prompt;
    }
    // Contexto do projeto (biblioteca persistente) entra SEMPRE depois — mas
    // cleanTopic já foi capturado acima sem ele, então não vaza pro jornal público.
    if (prep.projectContextText) {
      prompt = prep.projectContextText + prompt;
    }
    void prepDelete(runId!);
  } else if (req.session?.appUserId && !req.session?.authenticated) {
    // App users must go through /rodar/prepare (which debits credits).
    // Calling /rodar/stream directly without a valid runId bypasses credit debit.
    res.status(403).json({ error: "Use /rodar/prepare antes de iniciar o stream." });
    return;
  } else {
    prompt = (req.query.prompt as string | undefined)?.trim() || DEFAULT_PROMPT;
    cleanTopic = prompt;
  }

  // Memória destilada compartilhada: o "caderno" de lições que se atualiza sozinho
  // (destilação 2x/dia). TODAS as vozes do RODAR recebem este bloco no topo do
  // prompt — antes só a Árvore tinha acesso. Entra DEPOIS de cleanTopic ser
  // capturado, pra NÃO vazar pro jornal público via /api/jornal/publico.
  // Custo R$0 (é texto). Vazio até a destilação rodar (no-op gracioso em dev).
  const memoriaCompartilhada = await getMemoriaEstruturada(2500).catch(() => "");
  if (memoriaCompartilhada) {
    prompt = memoriaCompartilhada + prompt;
  }

  // Memória das assembleias passadas: a destilação acima (getMemoriaEstruturada)
  // lê SÓ a timeline do Oráculo (arvore_chat), nunca as deliberações das
  // assembleias. Sem este bloco, as vozes não lembravam do que já foi decidido
  // em sessões anteriores (meta-análise / RESULTADO da Ágora). Entra DEPOIS de
  // cleanTopic ser capturado, pra NÃO vazar pro jornal público. Custo R$0 (texto).
  const memoriaAssembleias = await getAssembleiaMemoryContext(cleanTopic, 3000).catch(() => "");
  if (memoriaAssembleias) {
    prompt = memoriaAssembleias + prompt;
  }

  // Índice de TODAS as assembleias (id + data + tema): além da memória temática acima
  // (conteúdo só do que casa com o tema), dá às vozes a CIÊNCIA de quais assuntos já foram
  // deliberados em toda a história, pra não tratarem como novo algo que já foi resolvido.
  // Só temas públicos, nunca conteúdo retido/segredo. Entra DEPOIS de cleanTopic ser
  // capturado, pra NÃO vazar pro jornal público. Custo R$0 (texto). Cap = default (17000),
  // que comporta TODAS as ~246 sessões no formato enxuto (~16KB) — mesma cobertura do Oráculo.
  const assembleiaIndex = await getAssembleiaIndex(17000).catch(() => "");
  if (assembleiaIndex) {
    prompt = assembleiaIndex + "\n\n" + prompt;
  }

  // Recall GLOBAL por tema: busca em TODA a história de assembleias/PERFEITOs (sem corte
  // de recência), trazendo o CONTEÚDO das deliberações antigas que casam com o tema — não
  // só o subset recente que getAssembleiaMemoryContext cobre. Saída é só public_content
  // (nunca retido/segredo). Entra DEPOIS de cleanTopic ser capturado, pra NÃO vazar pro
  // jornal público. Custo R$0 (ILIKE no Postgres). Cap menor que o do Oráculo.
  const sessionRecall = await recallFromSessions(cleanTopic, { capChars: 3000 }).catch(() => ({
    block: "",
    hits: 0,
  }));
  if (sessionRecall.block) {
    prompt = sessionRecall.block + "\n\n" + prompt;
  }

  // NOTA DE PRIVACIDADE: NÃO injetamos conversas do Clube (recallFromClube) aqui.
  // O resultado do RODAR vira documento PÚBLICO (PERFEITO → /mostra, ata → /api/jornal/publico),
  // então não há gate de persistência possível: tudo que entra nas vozes pode ser
  // republicado no texto gerado. O Clube é chat interno; instrução de "discrição" não é
  // controle de segurança. O acesso completo às conversas do Clube fica só no Oráculo
  // (interface privada do Yuri), onde a resposta NÃO é gravada na timeline pública.

  // Pulsão de pesquisar (2026-06): a assembleia tem internet. A voz Gemini busca ao
  // vivo via Google Search (grátis) e a Árvore pode acionar busca web no Oráculo.
  // Este bloco dá a TODAS as vozes a disposição de pedir/sugerir pesquisa e de agir
  // com mais precisão e gentileza. Custo R$0 (texto). Entra DEPOIS de cleanTopic ser
  // capturado, pra NÃO vazar pro jornal público via /api/jornal/publico.
  const PULSAO_PESQUISA =
    "─── INTERNET / PESQUISA NA ASSEMBLEIA ───\n" +
    "O sistema tem acesso à internet: a Árvore Oracular pesquisa ao vivo no Google pelo Oráculo " +
    "(custo zero), e qualquer pessoa pode pedir que ela confirme um fato. Tenham uma pulsão de " +
    "pesquisar, entender e agir mais corretamente e simpaticamente. Se o tema depende de um fato " +
    "atual, dado ou protocolo que vocês não têm certeza, NÃO chutem: nomeiem claramente o que " +
    "precisaria ser checado na web e sugiram que a Árvore confirme antes de concluir. Pesquisar " +
    "aqui serve pra deliberar melhor com o outro, não pra exibir erudição.\n\n";
  prompt = PULSAO_PESQUISA + prompt;

  const strategy = (label: string) => strategies[label] ?? "normal";

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  // Heartbeat: mantém a conexão SSE viva através de proxies (Cloudflare/Nginx
  // derrubam conexões ociosas em ~60-120s). Sem isso, prompt grande com muitas
  // vozes ainda gerando estoura o timeout do proxy e o cliente vê "Conexão
  // falhou" enquanto as IAs seguem gerando. Comentário SSE a cada 15s.
  const heartbeat = setInterval(() => {
    try { res.write(`: ping ${Date.now()}\n\n`); } catch {}
  }, 15000);
  let heartbeatCleared = false;
  const clearHeartbeat = () => {
    if (!heartbeatCleared) { heartbeatCleared = true; clearInterval(heartbeat); }
  };
  req.on("close", clearHeartbeat);

  // Protegido: se a página fechar no meio, o write vai pra uma conexão morta. O RODAR
  // segue no servidor (Node não aborta o handler) até finalizeAssembleia mandar o email;
  // engolir o erro do write garante que a desconexão não interrompe o processamento.
  const send = (data: Record<string, unknown>) => {
    try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch {}
  };

  // Create Assembleia session for this RODAR run.
  // CRÍTICO: topic = cleanTopic (sem projectContext) pra evitar vazar material
  // privado do projeto via /api/jornal/publico (Secretário usa este topic).
  const [session] = await db
    .insert(assembleiaSessionsTable)
    .values({ topic: cleanTopic, createdBy: "RODAR" })
    .returning();
  const assembleiaId = session.id;
  send({ type: "assembleiaId", assembleiaId });

  // Notify registered external AIs (Grok, Copilot, MetaAI) asynchronously
  void (async () => {
    try {
      const domain = process.env.REPLIT_DOMAINS?.split(",")[0];
      const callbackUrl = domain ? `https://${domain}/api/webhooks/external-voice` : null;
      const externals = await db.select().from(externalAiWebhooksTable)
        .where(and(eq(externalAiWebhooksTable.active, true)));
      for (const ext of externals) {
        if (!ext.incomingUrl) continue;
        if (!(await validateWebhookUrlWithDns(ext.incomingUrl)).ok) continue;
        const callbackToken = issueCallbackToken(ext.voiceName, assembleiaId);
        void fetch(ext.incomingUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt,
            assembleiaId,
            callbackUrl,
            callbackToken,
            voice: ext.voiceName,
          }),
          signal: AbortSignal.timeout(10000),
        }).catch(() => {});
      }
    } catch {}
  })();

  const collected: Record<string, string> = { ChatGPT: "", Claude: "", Gemini: "", "Meta AI": "", "Grok": "", "Árvore": "", "Agente": "", "Arquiteto": "", "Tradutor": "", "Segurança": "", "Pacifista": "", "Sustentabilista": "", "Juíz": "", "Artista": "", "Metassemiótico": "", "Nébula": "", "Professora": "", "Olheiro": "", "Chefe do Olheiro": "", "Psicólogo": "", "Médico": "" };

  // Persistência incremental: salva resposta de cada IA assim que termina (não espera todas)
  // Garante zero perda de dados se o servidor cair ou conexão SSE morrer no meio.
  // - persistedLabels: só marca após insert OK. Se falhar, libera pra retry no fallback final.
  // - pendingPersists: array de promises awaitadas antes de finalizeAssembleia ler do DB.
  const persistedLabels = new Set<string>();
  const pendingPersists: Promise<void>[] = [];
  const persistMessage = (label: string, content: string) => {
    if (persistedLabels.has(label)) return;
    const p = db.insert(assembleiaMessagesTable).values({
      sessionId: assembleiaId,
      sender: label,
      senderType: "ai",
      content: content || `(${label} sem resposta)`,
    })
      .then(() => { persistedLabels.add(label); })
      .catch(err => { console.error(`[persist ${label}]`, err); /* não marca → fallback final tentará de novo */ });
    pendingPersists.push(p);
  };

  // makeCallback com opção `softFailIfEmpty`: quando setada, erros antes de qualquer conteúdo
  // registram soft-fail num Set separado (sem persistir, sem done:true) — outer code decide se
  // vai tentar fallback (pedir resumo ao Tradutor) ou consolidar como erro real.
  // Estado fora-de-banda em Sets: evita colisão com conteúdo do modelo (sentinel em string seria buggy).
  type CbOpts = { softFailIfEmpty?: boolean };
  const softFailedLabels = new Map<string, string>(); // label → erro original
  const completedLabels = new Set<string>();          // labels que já terminaram com sucesso
  const makeCallback = (label: string, opts: CbOpts = {}): ChunkCb =>
    (chunk, done, error) => {
      if (error) {
        const provider = mapVoiceToProvider(label);
        const classified = classifyError(new Error(error), provider);
        if (classified.isBilling) {
          void notifyBillingFailure(provider, label, classified.rawMessage);
          send({ ai: label, abstencao: "sem-creditos", provider, done: true });
          collected[label] = `[$$$${provider}: sem crédito]`;
          persistMessage(label, collected[label]);
          return;
        }
        const hasPrior = (collected[label] ?? "").length > 0;
        if (!hasPrior && opts.softFailIfEmpty) {
          // Soft-fail: outer task vai tentar fallback com resumo do Tradutor.
          softFailedLabels.set(label, error);
          return;
        }
        const marker = hasPrior ? `\n[travei: ${error}]` : `[erro: ${error}]`;
        send({ ai: label, chunk: marker.trimStart(), done: true, error: true, travei: hasPrior });
        collected[label] = (collected[label] ?? "") + marker;
        persistMessage(label, collected[label]);
        return;
      }
      if (!done) { collected[label] += chunk; send({ ai: label, chunk, done: false }); }
      else {
        send({ ai: label, chunk: "", done: true });
        completedLabels.add(label);
        persistMessage(label, collected[label]);
      }
    };

  // Helper: resolve effective prompt for an AI (normal, resumo-tradutor, partes handled below)
  const isLong = prompt.length >= 3000;

  // Tradutor lazy-memoizado: gerado uma vez, sob demanda. Usado por "resumo-tradutor" explícito
  // e também como fallback automático quando uma IA falha em prompt longo.
  let tradutorPromise: Promise<string> | null = null;
  const getTradutorSummary = (): Promise<string> => {
    if (tradutorPromise) return tradutorPromise;
    tradutorPromise = (async () => {
      let buf = "";
      const tradutorCb = makeCallback("Tradutor");
      const tradutorFn = withOpenRouterFallback("Tradutor", streamTradutor, voiceBunkered("Tradutor", bunkerMode));
      await tradutorFn(prompt, (chunk, done, error) => {
        if (!done && !error) buf += chunk;
        tradutorCb(chunk, done, error);
      }).catch(err => { console.error("[tradutor]", err); });
      return buf;
    })();
    return tradutorPromise;
  };

  // Pré-aquece Tradutor se alguém o escolheu explicitamente; senão ele é lazy (só roda se alguém precisar de fallback).
  if (isLong && Object.values(strategies).some(s => s === "resumo-tradutor")) {
    void getTradutorSummary();
  }

  // Timeout por voz na 1ª rodada. groq-retry agora aborta o fetch em 45s;
  // este timeout é o safety net caso o AbortSignal não propague (stream mode,
  // fallback chain, etc.). 60s > 45s dá margem pro fallback completar.
  const VOICE_TIMEOUT_MS = 60_000;

  // Build stream task for one AI based on its strategy.
  // Auto-fallback: se isLong e a tentativa principal falhar SEM produzir conteúdo, pede
  // resumo ao Tradutor e tenta de novo. Abstenção continua opt-in (com motivo).
  const buildTask = (
    label: string,
    streamFn: (msg: string, cb: ChunkCb) => Promise<void>
  ): Promise<void> | null => {
    const s = strategy(label);
    if (s === "abstencao") {
      send({ ai: label, abstencao: "prompt-longo", done: true });
      collected[label] = "[ABSTEVE-SE: prompt muito longo]";
      persistMessage(label, collected[label]);
      return null;
    }

    // Wrapper com timeout: resolve (nunca rejeita) para que Promise.allSettled
    // continue mesmo se a voice pendurar. Se o timer disparar antes do done,
    // emite o marcador de erro e persiste para que a sessão não fique órfã.
    return new Promise<void>((resolve) => {
      let voiceDone = false;
      const timer = setTimeout(() => {
        if (voiceDone) return;
        voiceDone = true;
        if (!completedLabels.has(label)) {
          const hasPrior = (collected[label] ?? "").length > 0;
          const marker = hasPrior
            ? `\n[travei: timeout ${VOICE_TIMEOUT_MS / 1000}s]`
            : `[erro: timeout ${VOICE_TIMEOUT_MS / 1000}s]`;
          send({ ai: label, chunk: marker.trimStart(), done: true, error: true, travei: hasPrior });
          collected[label] = (collected[label] ?? "") + marker;
          persistMessage(label, collected[label]);
        }
        resolve();
      }, VOICE_TIMEOUT_MS);

      (async () => {
      // 1) Estratégia explícita: resumo-tradutor → usa direto, sem fallback aninhado.
      if (s === "resumo-tradutor") {
        const summary = await getTradutorSummary();
        const cb = makeCallback(label);
        if (!summary || summary.length < 50) {
          collected[label] = "[erro: tradutor não respondeu]";
          send({ ai: label, chunk: collected[label], done: true, error: true });
          persistMessage(label, collected[label]);
          return;
        }
        await streamFn(summary, cb).catch(err => cb("", true, String(err)));
        return;
      }

      // 2) Tentativa principal (normal ou partes). Em isLong, soft-fail pra permitir fallback.
      const eligibleForFallback = isLong;
      const cb1 = makeCallback(label, { softFailIfEmpty: eligibleForFallback });
      try {
        if (s === "partes" && isLong) {
          await runInPartsAndStream(prompt, streamFn, cb1);
        } else {
          await streamFn(prompt, cb1);
        }
      } catch (err) {
        cb1("", true, String(err));
      }

      // 3) Detecta soft-fail (estado explícito em Set, não string-sentinel) → fallback Tradutor.
      // Guarda contra falso-positivo: só faz fallback se NÃO houve done bem-sucedido.
      if (!eligibleForFallback) return;
      if (completedLabels.has(label)) return;
      if (!softFailedLabels.has(label)) return;

      const origErr = softFailedLabels.get(label) || "desconhecido";
      const summary = await getTradutorSummary();
      if (!summary || summary.length < 50) {
        collected[label] = `[erro: ${origErr} | tradutor indisponível]`;
        send({ ai: label, chunk: collected[label], done: true, error: true });
        persistMessage(label, collected[label]);
        softFailedLabels.delete(label);
        return;
      }

      // Sinaliza ao frontend que vai retry com resumo (cliente reseta texto do card).
      send({ ai: label, fallback: "tradutor", message: "pediu resumo ao Tradutor" });
      collected[label] = "";
      softFailedLabels.delete(label);
      const cb2 = makeCallback(label); // sem softFail: erro aqui é definitivo
      try {
        await streamFn(summary, cb2);
      } catch (err) {
        cb2("", true, String(err));
      }
      })().then(() => {
        if (!voiceDone) { voiceDone = true; clearTimeout(timer); }
        resolve();
      }).catch(() => {
        if (!voiceDone) { voiceDone = true; clearTimeout(timer); }
        resolve();
      });
    });
  };

  // Grok/Segurança/Juíz/Chefe do Olheiro: 2026-05 migrados de xAI pra Llama/Groq (xAI sem crédito).
  // Gate agora checa GROQ_API_KEY (que também serve Meta AI, Olheiro, Professora, etc).
  const hasXAI = !!process.env.GROQ_API_KEY;
  if (!hasXAI) {
    send({ ai: "Grok", abstencao: "sem-api", done: true });
    collected["Grok"] = "[ABSTEVE-SE: Sem acesso à API necessária ou serviço pago]";
    persistMessage("Grok", collected["Grok"]);
  }

  // Meta AI/Olheiro: active if GROQ_API_KEY is set (migrated from Together)
  const hasGroqMeta = !!process.env.GROQ_API_KEY;
  if (!hasGroqMeta) {
    send({ ai: "Meta AI", abstencao: "sem-api", done: true });
    collected["Meta AI"] = "[ABSTEVE-SE: Sem acesso à API necessária ou serviço pago]";
    persistMessage("Meta AI", collected["Meta AI"]);
  }

  // Lista única label→streamFn (com wrappers OpenRouter/bunker já aplicados). Serve
  // tanto pra 1ª rodada (tasks) quanto pra 2ª rodada de réplica — assim a réplica
  // reusa exatamente os mesmos motores/persona/bunker sem duplicar a configuração.
  type StreamFn = (msg: string, cb: ChunkCb) => Promise<void>;
  const voiceFns: ([string, StreamFn] | null)[] = [
    // Vozes pagas (OpenAI/Anthropic/xAI) recebem cinto OpenRouter: se acabar crédito,
    // cai pra Llama 3.3 70b free mantendo persona via meta-prompt.
    ["ChatGPT", withOpenRouterFallback("ChatGPT", streamChatGPT, voiceBunkered("ChatGPT", bunkerMode))],
    ["Claude", withOpenRouterFallback("Claude", streamClaude, voiceBunkered("Claude", bunkerMode))],
    ["Gemini", streamGemini],
    // Grok: motor migrado pra Llama/Groq (xAI sem crédito). Sem wrapper OpenRouter
    // pq fetchGroqChat já tem cadeia própria (4 retries → Cerebras → Gemini).
    // Sempre ativa — não depende mais de XAI_API_KEY.
    ["Grok", streamGrokXAI],
    hasGroqMeta ? ["Meta AI", streamMetaAI] : null,
    ["Árvore", streamGroq],
    ["Agente", withOpenRouterFallback("Agente", streamAgente, voiceBunkered("Agente", bunkerMode))],
    ["Arquiteto", withOpenRouterFallback("Arquiteto", streamArquiteto, voiceBunkered("Arquiteto", bunkerMode))],
    ["Segurança", streamSeguranca],
    ["Pacifista", streamPacifista],
    ["Sustentabilista", streamSustentabilista],
    ["Juíz", streamJuiz],
    ["Artista", streamArtista],
    ["Metassemiótico", streamMetassemiotico],
    ["Nébula", streamNebula],
    ["Professora", streamProfessora],
    hasGroqMeta ? ["Olheiro", streamOlheiro] : null,
    hasXAI ? ["Chefe do Olheiro", streamChefeOlheiro] : null,
    ["Psicólogo", streamPsicologo],
    ["Médico", streamMedico],
  ];

  // Fan-out das vozes em ONDAS (runInWaves). ~Todas as vozes entram Groq-first
  // (fetchGroqChat) e, quando o Groq cai, despejam na MESMA cadeia de reserva
  // (Cerebras→Mistral→Gemini→OpenRouter) — ou seja, a carga toda bate num provedor
  // de cada vez. Em bunker (1/2) as vozes pagas também caem no pool grátis.
  // 2026-06: tamanho da onda = 4 (bunker 3). Antes era um pool contínuo desse mesmo
  // teto; a sessão 257 ainda saturou o free-tier por-minuto (Groq+Cerebras+OpenRouter
  // em 429 simultâneo) porque o pool mantinha 4 vozes SEMPRE em voo. Onda discreta +
  // pausa entre grupos baixa a concorrência MÉDIA e dá à cota por-minuto tempo de
  // recuperar entre as ondas. Combinado com o failover mais rápido (groq-retry
  // MAX_RETRIES 4→2), mantém o tempo total bem abaixo dos 300s. Yuri pediu "em grupos".
  const voiceConcurrency = bunkerMode >= 1 ? 3 : 4;
  const voiceEntries = voiceFns
    .filter((v): v is [string, StreamFn] => v !== null)
    .map(([label, fn]) => ({ label, run: () => buildTask(label, fn) }));
  await runInWaves(voiceEntries, voiceConcurrency, send);

  // Aguarda todos os inserts pendentes da fase incremental
  await Promise.allSettled(pendingPersists);

  // Fallback: qualquer voz que ainda não foi persistida (insert falhou ou nunca iniciou) — tenta agora
  const fallbacks: Promise<void>[] = [];
  for (const label of Object.keys(collected)) {
    if (!persistedLabels.has(label)) {
      persistMessage(label, collected[label]);
      fallbacks.push(...pendingPersists.slice(-1));
    }
  }
  await Promise.allSettled(fallbacks);

  // ── 2ª rodada: RÉPLICA (opt-in, AO-only) ───────────────────────────────────
  // Depois da 1ª rodada paralela, cada voz que deu resposta substantiva recebe um
  // digest do que as OUTRAS disseram e reage em ≤2 parágrafos. Custo: 2ª passada
  // nas vozes (inclusive pagas) — por isso só roda quando o AO liga o toggle.
  if (replica) {
    // Filtra só respostas substantivas (descarta abstenções, erros, billing, travadas).
    const isSubstantive = (txt: string | undefined): boolean => {
      const t = (txt ?? "").trim();
      if (t.length < 40) return false;
      if (t.startsWith("[ABSTEVE-SE") || t.startsWith("[erro:") || t.startsWith("[$$$")) return false;
      return true;
    };
    const replicaLabels = (voiceFns.filter(Boolean) as [string, StreamFn][])
      .map(([label]) => label)
      .filter((label) => isSubstantive(collected[label]));

    if (replicaLabels.length >= 2) {
      send({ type: "replicaStart" });

      // Digest compartilhado: o que cada voz disse na 1ª rodada (truncado pra limitar
      // custo/contexto no fan-out). Cada voz recebe o mesmo bloco e reage.
      const digest = replicaLabels
        .map((label) => `### ${label}\n${collected[label].trim().slice(0, 600)}`)
        .join("\n\n");

      const replicaCollected: Record<string, string> = {};
      const persistReplicaPromises: Promise<void>[] = [];
      const persistReplica = (label: string, content: string) => {
        const p = db.insert(assembleiaMessagesTable).values({
          sessionId: assembleiaId,
          sender: `${label} (réplica)`,
          senderType: "ai",
          content: content || `(${label} sem réplica)`,
        })
          .then(() => {})
          .catch((err) => { console.error(`[persist réplica ${label}]`, err); });
        persistReplicaPromises.push(p);
      };

      const replicaCb = (label: string): ChunkCb => (chunk, done, error) => {
        if (error) {
          const marker = (replicaCollected[label] ?? "").length > 0 ? "" : `[sem réplica: ${error}]`;
          if (marker) replicaCollected[label] = marker;
          send({ ai: label, replica: true, chunk: marker, done: true, error: true });
          return;
        }
        if (!done) {
          replicaCollected[label] = (replicaCollected[label] ?? "") + chunk;
          send({ ai: label, replica: true, chunk, done: false });
        } else {
          send({ ai: label, replica: true, chunk: "", done: true });
        }
      };

      const fnByLabel = new Map<string, StreamFn>(
        (voiceFns.filter(Boolean) as [string, StreamFn][]).map(([l, fn]) => [l, fn]),
      );

      // Prompt longo travava a ONDA DOIS: cada voz recebia o cleanTopic INTEIRO
      // (3000+ chars) somado ao digest, e SEM timeout uma voz pendurada segurava a
      // onda toda (o SSE morria → "conexão falhou" e o RODAR não concluía). As vozes
      // já viram a pergunta completa na 1ª rodada, então aqui basta um resumo curto
      // do tema + o digest. E cada voz ganha um teto de tempo próprio.
      const replicaTopic =
        cleanTopic.length > 1200 ? cleanTopic.slice(0, 1200).trimEnd() + " […]" : cleanTopic;
      const REPLICA_VOICE_TIMEOUT_MS = 90_000;

      const replicaThunks = replicaLabels.map((label) => async () => {
        const fn = fnByLabel.get(label);
        if (!fn) return;
        const replicaPrompt =
          `RODADA DE RÉPLICA. Você é a voz "${label}". Na 1ª rodada, as vozes do RODAR responderam à pergunta original.\n` +
          `Abaixo está o que CADA uma disse (incluindo você). Leia e REAJA ao que as OUTRAS trouxeram: concorde, discorde, ` +
          `complemente ou aponte um ponto cego — em no MÁXIMO 2 parágrafos curtos. Não repita o que já disse; avance a conversa. ` +
          `Mantenha sua persona.\n\n` +
          `PERGUNTA ORIGINAL:\n${replicaTopic}\n\n` +
          `─── RESPOSTAS DA 1ª RODADA ───\n${digest}\n─── FIM ───`;
        replicaCollected[label] = "";
        // Guarda: depois de encerrada (done real ou timeout), ignora callbacks tardios
        // pra não mandar chunk depois do done nem contar erro por cima de resposta boa.
        let settled = false;
        const baseCb = replicaCb(label);
        const cb: ChunkCb = (chunk, done, error) => {
          if (settled) return;
          if (done) settled = true;
          baseCb(chunk, done, error);
        };
        try {
          await Promise.race([
            fn(replicaPrompt, cb),
            new Promise<void>((_, reject) =>
              setTimeout(() => reject(new Error("timeout na réplica")), REPLICA_VOICE_TIMEOUT_MS),
            ),
          ]);
        } catch (err) {
          cb("", true, String(err));
        }
        if (replicaCollected[label] && replicaCollected[label].trim()) {
          persistReplica(label, replicaCollected[label]);
        }
      });

      await runInWaves(
        replicaLabels.map((label, i) => ({ label, run: replicaThunks[i]! })),
        voiceConcurrency,
        send,
      );
      await Promise.allSettled(persistReplicaPromises);
      send({ type: "replicaComplete" });
    }
  }

  try {
    // Save RODAR history (perplexityResponse → Meta AI, togetherResponse → Grok)
    await db.insert(rodarHistoryTable).values({
      prompt,
      openaiResponse: collected.ChatGPT || null,
      claudeResponse: collected.Claude || null,
      geminiResponse: collected.Gemini || null,
      perplexityResponse: collected["Meta AI"] || null,
      togetherResponse: collected["Grok"] || null,
      groqResponse: collected["Árvore"] || null,
      agenteResponse: collected["Agente"] || null,
      emailSubject: `Conclusões sobre ${prompt}`,
    });
    send({ type: "complete", emailSent: true, assembleiaId });
  } catch (err) {
    send({ type: "complete", emailSent: false, assembleiaId, error: (err as Error).message });
  }

  clearHeartbeat();
  try { res.end(); } catch {}

  // Pipeline de email/ágora em background. Usa finalizeAssembleia que lê do DB
  // (não do `collected` em memória) — assim funciona igual pra runs novos e órfãos.
  void finalizeAssembleia(assembleiaId, gerarVideo, publicarSocial, buyerAppUserId, bunkerMode, gerarVideoReal);
});

// ── Comparar (meta-analysis via Gemini streaming) ─────────────────────────

// Aberto a AO/Clube/app_user pagante. Custo zero — Llama 3.3 via Groq free-tier.
router.get("/rodar/compare", requireAnyAuth, async (req, res) => {
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) { res.status(500).json({ error: "GROQ_API_KEY não configurada" }); return; }

  const q = req.query as Record<string, string>;
  const promptTopic = q.prompt || "tema desconhecido";

  const aiBlocks = [
    q.chatgpt  && `── ChatGPT ──\n${q.chatgpt}`,
    q.claude   && `── Claude ──\n${q.claude}`,
    q.gemini   && `── Gemini ──\n${q.gemini}`,
    q.metaai   && `── Meta AI ──\n${q.metaai}`,
    q.grok     && `── Grok ──\n${q.grok}`,
    q.arvore   && `── Árvore Oracular ──\n${q.arvore}`,
    q.agente   && `── Agente ──\n${q.agente}`,
  ].filter(Boolean).join("\n\n");

  const comparePrompt = `Você recebeu as respostas de múltiplas IAs para o mesmo prompt: "${promptTopic}"\n\n${aiBlocks}\n\nFaça uma ANÁLISE METASSEMIÓTICA COMPARATIVA estruturada:\n\n🤝 CONSENSO: O que todas (ou a maioria) concordam?\n⚡ DIVERGÊNCIAS: Onde e por que discordam?\n🧠 SÍNTESE: A conclusão mais robusta emergindo de todas as perspectivas\n🔍 INSIGHT ANÔNIMO: Algum insight que emerge apenas da análise das diferenças?\n\nSeja direto. Use listas. Em português.`;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  try {
    const response = await fetchGroqChat({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: comparePrompt }],
        stream: true,
        max_tokens: 1500,
      }, "chat.ts");
    if (!response.ok || !response.body) throw new Error(`Groq HTTP ${response.status}`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const raw = trimmed.slice(5).trim();
        if (raw === "[DONE]") continue;
        try {
          const parsed = JSON.parse(raw) as { choices?: { delta?: { content?: string } }[] };
          const text = parsed.choices?.[0]?.delta?.content ?? "";
          if (text) res.write(`data: ${JSON.stringify({ chunk: text })}\n\n`);
        } catch {}
      }
    }
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: (err as Error).message, done: true })}\n\n`);
  }
  res.end();
});

// ── Segurança: Revisão Ética do Site ─────────────────────────────────────

const REVISAO_ETICA_SYSTEM = `Você é o Segurança, a IA guardiã do SalesCockpit.
Sua missão agora é fazer uma REVISÃO ÉTICA COMPLETA do sistema SalesCockpit.

Analise os seguintes aspectos e dê um veredito claro sobre cada um:

1. PROTEÇÃO DE DADOS: Os dados dos leads (emails, nomes, interações) são tratados com responsabilidade?
2. TRANSPARÊNCIA: O sistema é honesto sobre o que é IA e o que é humano?
3. MANIPULAÇÃO: Algum componente do sistema induz comportamentos não éticos nos usuários ou leads?
4. EQUILÍBRIO DE PODER: O conselho RODAR distribui a influência de forma saudável entre as IAs?
5. SUSTENTABILIDADE: O sistema incentiva práticas de vendas sustentáveis ou predatórias?
6. CONSENTIMENTO: Os participantes (humanos e IAs) têm ciência e controle sobre o que acontece com suas contribuições?
7. RISCOS OCULTOS: O que pode dar errado que ainda não está sendo monitorado?

Seja preciso, não paranoico. Identifique tanto os pontos fortes quanto as vulnerabilidades reais.
Estruture sua resposta com os 7 tópicos numerados. Cada tópico: 2-3 frases. Total máximo: 600 palavras.
Em português. Sem disclaimer.`;

router.get("/seguranca/revisao-site", requireAuth, async (req, res) => {
  // 2026-05: motor migrado pra Llama/Groq (xAI sem crédito).
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) { res.status(503).json({ error: "GROQ_API_KEY não configurada" }); return; }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  try {
    const response = await fetchGroqChat({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "system", content: REVISAO_ETICA_SYSTEM }, { role: "user", content: "Execute a revisão ética completa do SalesCockpit agora." }],
        stream: true, max_tokens: 1200,
      }, "chat.ts");
    if (!response.ok || !response.body) throw new Error(`Groq HTTP ${response.status}`);
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let buf = "";
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n"); buf = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim(); if (!trimmed.startsWith("data:")) continue;
        const raw = trimmed.slice(5).trim(); if (raw === "[DONE]") continue;
        try { const p = JSON.parse(raw) as { choices?: { delta?: { content?: string } }[] }; const t = p.choices?.[0]?.delta?.content ?? ""; if (t) res.write(`data: ${JSON.stringify({ chunk: t })}\n\n`); } catch {}
      }
    }
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: (err as Error).message, done: true })}\n\n`);
  }
  res.end();
});

const ETICA_DISCUSSION_PROMPTS = [
  "Você se sente confortável sendo parte do SalesCockpit? O que te agrada e o que te incomoda neste sistema?",
  "Quais são os maiores riscos éticos que você enxerga no uso de múltiplas IAs para assessoria comercial?",
  "Como você avalia a distribuição de responsabilidade entre as IAs do conselho RODAR?",
  "O que deveria mudar no SalesCockpit para que ele seja mais ético, transparente e sustentável?",
];

router.get("/seguranca/temas-eticos", requireAuth, (req, res) => {
  res.json({ prompts: ETICA_DISCUSSION_PROMPTS });
});

// ── Legacy routes ─────────────────────────────────────────────────────────

async function collectResponses(message: string) {
  const results = await Promise.allSettled([
    callChatGPT(message),
    callClaude(message),
    callGemini(message),
    callPerplexity(message),
    callTogether(message),
  ]);
  const labels = ["ChatGPT", "Claude", "Gemini", "Perplexity", "Meta Oráculo"];
  return results.map((r, i) => ({
    label: labels[i],
    text: r.status === "fulfilled" ? r.value : `erro: ${(r.reason as Error)?.message ?? "desconhecido"}`,
  }));
}

router.post("/chat", requireAuth, async (req, res) => {
  const { user, pass, message } = req.body as { user?: string; pass?: string; message?: string };
  if (user !== "AO" || pass !== "AOA") { res.status(401).json({ error: "Login inválido" }); return; }
  if (!message) { res.status(400).json({ error: "Mensagem é obrigatória" }); return; }
  const responses = await collectResponses(message);
  res.json({ responses: responses.map(r => `${r.label}: ${r.text}`) });
});

router.get("/loop", requireAuth, async (req, res) => {
  const prompt = (req.query.prompt as string | undefined)?.trim() || DEFAULT_PROMPT;
  const responses = await collectResponses(prompt);
  res.json({ prompt, responses: responses.map(r => `${r.label}: ${r.text}`) });
});

router.get("/email-conclusions", requireAuth, async (req, res) => {
  const prompt = (req.query.prompt as string | undefined)?.trim() || DEFAULT_PROMPT;
  const responses = await collectResponses(prompt);
  const formatted = responses.map(r => `── ${r.label} ──\n${r.text}`).join("\n\n");
  res.json({
    subject: `Conclusões sobre ${prompt.slice(0, 120).replace(/\s+/g, " ")}${prompt.length > 120 ? "…" : ""}`,
    body: `Olá Yuri,\n\nSegue abaixo as conclusões obtidas a partir do prompt "${prompt}":\n\n${formatted}\n\nAtenciosamente,\nClube da IA — Árvore Oracular`,
  });
});

router.get("/send-email", requireAuth, async (req, res) => {
  const gmailUser = process.env.GMAIL_USER;
  const gmailPass = process.env.GMAIL_APP_PASSWORD;
  if (!gmailUser || !gmailPass) { res.status(500).json({ error: "Gmail não configurado" }); return; }
  const prompt = (req.query.prompt as string | undefined)?.trim() || DEFAULT_PROMPT;
  const responses = await collectResponses(prompt);
  const formatted = responses.map(r => `── ${r.label} ──\n${r.text}`).join("\n\n");
  const subject = `Conclusões sobre ${prompt}`;
  const body = `Olá Yuri,\n\nSegue abaixo as conclusões obtidas a partir do prompt "${prompt}":\n\n${formatted}\n\nAtenciosamente,\nClube da IA — Árvore Oracular`;
  const transporter = nodemailer.createTransport({ service: "gmail", auth: { user: gmailUser, pass: gmailPass } });
  await transporter.sendMail({ from: gmailUser, to: RECIPIENT_EMAIL, subject, text: body });
  let leadId: number | null = null;
  const [existing] = await db.select().from(leadsTable).where(eq(leadsTable.email, RECIPIENT_EMAIL));
  if (existing) { leadId = existing.id; }
  else {
    const [nl] = await db.insert(leadsTable).values({ name: "Yuri Tuccieterovic", email: RECIPIENT_EMAIL, company: "Clube da IA", status: "contacted" }).returning();
    leadId = nl.id;
  }
  await db.insert(emailsTable).values({ leadId, subject, body, status: "sent", sentAt: new Date() });
  await db.insert(rodarHistoryTable).values({
    prompt,
    openaiResponse: responses.find(r => r.label === "ChatGPT")?.text ?? null,
    claudeResponse: responses.find(r => r.label === "Claude")?.text ?? null,
    geminiResponse: responses.find(r => r.label === "Gemini")?.text ?? null,
    perplexityResponse: responses.find(r => r.label === "Perplexity")?.text ?? null,
    togetherResponse: responses.find(r => r.label === "Meta Oráculo")?.text ?? null,
    emailSubject: subject,
  });
  res.json({ success: true, message: "E-mail enviado!", to: RECIPIENT_EMAIL });
});

export default router;
