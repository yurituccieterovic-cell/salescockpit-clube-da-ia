// BUNKER_MODE: 3-níveis pra rotear vozes pagas → pool grátis.
// Decisão Yuri 2026-05 pós-PERFEITO #121: A Ágora deliberou que o teste 2-modos
// era metodologicamente fraco e pediu 3 níveis (0/1/2).
//
// Modo 0 = padrão. Tudo como está hoje (Opus/Sonnet em síntese, GPT/Sonnet em vozes).
// Modo 1 = híbrido. RODAR vozes pagas (ChatGPT/Claude/Agente/Arquiteto/Tradutor)
//   forçadas pro fallback grátis (OpenRouter Llama → Gemini). Síntese
//   (Editorial/MetaAnalysis/Ágora/Secretário) continua Sonnet.
// Modo 2 = full bunker. Vozes idem Mode 1 + síntese vai pra Cerebras Qwen 3 235B
//   (cota separada, OpenAI-compatible, grátis). Marcado como experimental — a
//   degradação na síntese é exatamente o que a Ágora previu.
//
// Override por run (AO-only) via body `bunkerMode` em /rodar/prepare. Default
// vem do env BUNKER_MODE (server-wide).

import { logger } from "./logger";
import { routeChat, type RouterMessage } from "./llm-router";

export type BunkerMode = 0 | 1 | 2;

// Síntese pode ser longa, mas sem teto a chamada trava pra sempre se o provedor
// não responder — era a causa de "(síntese não disponível)" travando a assembleia
// no Bunker 2. 90s cobre síntese grande; ao estourar, aborta e cai pro fallback.
const SYNTHESIS_TIMEOUT_MS = 90_000;

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

export function parseBunkerMode(raw: unknown): BunkerMode {
  const n = typeof raw === "string" ? parseInt(raw, 10) : typeof raw === "number" ? raw : 0;
  if (n === 1) return 1;
  if (n === 2) return 2;
  return 0;
}

export function getDefaultBunkerMode(): BunkerMode {
  return parseBunkerMode(process.env.BUNKER_MODE);
}

// Vozes RODAR que rodam em provider pago hoje. Em Mode ≥1 elas pulam o paid attempt
// e vão direto pro fallback OpenRouter+Gemini (mantendo persona via meta-prompt).
const PAID_VOICES = new Set(["ChatGPT", "Claude", "Agente", "Arquiteto", "Tradutor", "Metassemiótico", "Nébula", "Psicólogo"]);

export function voiceBunkered(label: string, mode: BunkerMode): boolean {
  return mode >= 1 && PAID_VOICES.has(label);
}

export function synthesisBunkered(mode: BunkerMode): boolean {
  return mode === 2;
}

// Cerebras GPT-OSS 120B — substituto de Sonnet em Mode 2. Cota separada de
// Groq/Google, OpenAI-compatible. Histórico de model id: qwen-3-235b → llama-3.3-70b
// → gpt-oss-120b. Cada troca foi porque a conta perdeu acesso ao anterior (404
// "model not found / no access"), derrubando o bunker silenciosamente. Conferir
// modelos disponíveis em GET https://api.cerebras.ai/v1/models antes de trocar.
// Síntese degradada vs Opus mas operacional e a custo zero.
export async function cerebrasComplete(opts: {
  system?: string;
  user: string;
  maxTokens?: number;
  label?: string;
}): Promise<string> {
  const apiKey = process.env.CEREBRAS_API_KEY;
  if (!apiKey) throw new Error("CEREBRAS_API_KEY ausente — BUNKER_MODE=2 indisponível");
  const messages: Array<{ role: "system" | "user"; content: string }> = [];
  if (opts.system) messages.push({ role: "system", content: opts.system });
  messages.push({ role: "user", content: opts.user });
  try {
    const resp = await fetchWithTimeout("https://api.cerebras.ai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-oss-120b",
        messages,
        max_tokens: opts.maxTokens ?? 4000,
      }),
    }, SYNTHESIS_TIMEOUT_MS);
    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      throw new Error(`Cerebras HTTP ${resp.status}: ${errText.slice(0, 300)}`);
    }
    const data = (await resp.json()) as { choices?: { message?: { content?: string } }[] };
    const out = data.choices?.[0]?.message?.content ?? "";
    if (!out) throw new Error("Cerebras retornou texto vazio");
    logger.info({ label: opts.label, len: out.length }, "[bunker] cerebras synthesis OK");
    return out;
  } catch (cerebrasErr) {
    logger.warn({ label: opts.label, err: String(cerebrasErr) }, "[bunker] Cerebras falhou — fallback cascata grátis");
    return await synthesisFallback(opts);
  }
}

// Fallback de síntese quando Cerebras falha (Mode 2). Antes ia direto pro Gemini
// sozinho — quando o Gemini estava com quota 429, a síntese voltava vazia e a
// assembleia "travava". Agora roteia pela cascata grátis (cloudflare → mistral →
// cerebras → gemini), então um único provedor fora não derruba o pipeline.
// Cada adapter do roteador já tem timeout próprio; este Promise.race é um teto
// geral pra cascata inteira não passar de SYNTHESIS_TIMEOUT_MS somando tentativas.
async function synthesisFallback(opts: {
  system?: string;
  user: string;
  maxTokens?: number;
  label?: string;
}): Promise<string> {
  const messages: RouterMessage[] = [];
  if (opts.system) messages.push({ role: "system", content: opts.system });
  messages.push({ role: "user", content: opts.user });
  const result = await Promise.race([
    routeChat({
      pool: "chat-live",
      messages,
      maxTokens: opts.maxTokens ?? 4000,
      label: `bunker-fallback/${opts.label ?? "síntese"}`,
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("synthesisFallback timeout")), SYNTHESIS_TIMEOUT_MS),
    ),
  ]);
  logger.info(
    { label: opts.label, provider: result.provider, len: result.text.length },
    "[bunker] fallback síntese OK",
  );
  return result.text;
}
