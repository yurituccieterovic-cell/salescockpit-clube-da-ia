// 2026-05: helper de retry pra Groq free-tier (HTTP 429 cascateando em rodadas RODAR).
// Cinco+ vozes RODAR rodam Llama 3.3 70b em paralelo → estoura o burst de tokens-por-minuto
// do plano gratuito. Backoff exponencial respeitando Retry-After dá fôlego sem mudar provedor.
//
// 2026-05 (b): adicionado fallback Gemini 2.5 Flash quando Groq esgota retries.
// Free-tier do Gemini (RPM generoso) absorve o spillover quando 6+ vozes Groq batem 429
// simultâneo. Mantém shape OpenAI-compatible (streaming SSE + JSON) pra callers não
// precisarem mudar nada. Sem custo (GEMINI_API_KEY).

import { logger } from "./logger";
import { providerAvailable, reportProviderFailure, reportProviderSuccess, type Provider } from "./llm-router";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
// 2026-05: jitter ±30% pra dessincronizar 15+ vozes RODAR que entravam em
// thundering herd retentando exatamente no mesmo waitMs.
// 2026-06: 4 retries → 2. Em prod (sessão 257) o free-tier estava em ESGOTAMENTO
// SUSTENTADO (429 por-minuto em Groq+Cerebras+OpenRouter ao mesmo tempo), não
// burst transitório. Com 4 retries cada voz da 1ª onda moía ~22s contra um Groq
// que NÃO ia voltar antes de cair pro fallback — e como ~todas as vozes entram
// Groq-first, eram 4-6 vozes grindando 22s em paralelo (é o "travou" que o Yuri
// vê) e o acúmulo empurrava a sessão pro corte de 300s ("não responderam"). Com
// 2 retries (~4,5s) a 1ª voz dispara o cooling do Groq cedo, e as ondas seguintes
// já pulam direto pro provedor que está de pé (Mistral/Gemini), preservando a
// persona (o system message vai junto no fallback). 2 retries ainda absorvem um
// 429 de burst curto de 1-2s.
const MAX_RETRIES = 2;
const BASE_BACKOFF_MS = 1500;
const RETRY_AFTER_CAP_MS = 12000;

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function jitter(ms: number): number {
  // ±30% pra evitar thundering herd quando várias vozes batem 429 no mesmo segundo
  const delta = ms * 0.3;
  return Math.round(ms - delta + Math.random() * delta * 2);
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const secs = Number(header);
  if (Number.isFinite(secs) && secs > 0) return Math.min(secs * 1000, RETRY_AFTER_CAP_MS);
  return null;
}

// ── Gemini fallback ────────────────────────────────────────────────────────
type ChatMessage = { role: string; content: string };
type GroqBody = {
  messages?: ChatMessage[];
  stream?: boolean;
  max_tokens?: number;
  temperature?: number;
};

function toGeminiPayload(body: GroqBody): {
  contents: Array<{ role: string; parts: Array<{ text: string }> }>;
  systemInstruction?: { parts: Array<{ text: string }> };
  generationConfig: { maxOutputTokens?: number; temperature?: number };
} {
  const msgs = body.messages ?? [];
  const sys = msgs.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const turns = msgs
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));
  return {
    contents: turns.length ? turns : [{ role: "user", parts: [{ text: "" }] }],
    systemInstruction: sys ? { parts: [{ text: sys }] } : undefined,
    generationConfig: {
      maxOutputTokens: body.max_tokens,
      temperature: body.temperature,
    },
  };
}

function makeOpenAINonStreamResponse(text: string): Response {
  const json = {
    choices: [{ message: { role: "assistant", content: text }, finish_reason: "stop" }],
    model: "gemini-2.5-flash-fallback",
  };
  return new Response(JSON.stringify(json), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function makeOpenAIStreamResponse(geminiBody: ReadableStream<Uint8Array>): Response {
  // Converte stream Gemini (NDJSON-ish ou SSE event-stream) pra SSE OpenAI-compatible.
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const reader = geminiBody.getReader();

  const out = new ReadableStream<Uint8Array>({
    async start(controller) {
      let buf = "";
      const flushChunk = (text: string) => {
        if (!text) return;
        const obj = { choices: [{ delta: { content: text } }] };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      };
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          // Gemini SSE: linhas começam com "data: {...}". Acumula até newline pra parse seguro.
          let nl;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line || !line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (payload === "[DONE]") continue;
            try {
              const parsed = JSON.parse(payload) as {
                candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
              };
              const text = parsed.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
              flushChunk(text);
            } catch {
              // Linha incompleta ou JSON parcial — ignora, próximo flush pega.
            }
          }
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } catch (err) {
        logger.warn({ err }, "[groq-retry] gemini fallback stream error");
      } finally {
        controller.close();
      }
    },
  });

  return new Response(out, {
    status: 200,
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
  });
}

// ── OpenAI-compat fallbacks (GitHub Models / DeepSeek / Mistral) ──────────
// Todos 3 são OpenAI-compatible — body do Groq passa direto trocando model+url,
// e o SSE de saída é o mesmo shape ({choices:[{delta:{content}}]}) que os
// readers downstream em chat.ts já consomem. Stream funciona sem transformação.
// Cota separada de Groq/Cerebras/Gemini — quando os 3 saturam juntos (raro mas
// aconteceu na sessão #212), esses entram como mais 3 colchões.

type OpenAICompatProvider = {
  name: Provider;
  url: string;
  apiKey: string | undefined;
  model: string;
};

async function openaiCompatFallback(
  body: GroqBody,
  provider: OpenAICompatProvider,
  label: string,
): Promise<Response | null> {
  if (!provider.apiKey) return null;
  const compatBody = { ...(body as object), model: provider.model };
  try {
    const resp = await fetch(provider.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${provider.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(compatBody),
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      logger.warn({ label, provider: provider.name, status: resp.status, err: errText.slice(0, 200) }, "[groq-retry] fallback HTTP não-OK");
      reportProviderFailure(provider.name, resp.status, errText);
      return null;
    }
    logger.info({ label, provider: provider.name, stream: body.stream === true }, "[groq-retry] usando fallback");
    reportProviderSuccess(provider.name);
    return resp;
  } catch (err) {
    logger.warn({ label, provider: provider.name, err }, "[groq-retry] fallback exception");
    return null;
  }
}

// 2026-05: GitHub Models (token sem permissão `models` → 401) e DeepSeek (saldo
// zerado → 402) removidos da cascata. Estavam mortos em prod e cada um custava
// ~3s de espera (HTTP round-trip) antes de cair pro próximo, somando ~6-9s de
// atraso que estourava o timeout do browser ("failed to fetch"/"Travei"). Quando
// o token GitHub ganhar a permissão `models` ou o DeepSeek tiver saldo, dá pra
// re-adicionar via openaiCompatFallback (helper preservado).

async function mistralFallback(body: GroqBody, label: string): Promise<Response | null> {
  return openaiCompatFallback(body, {
    name: "mistral",
    url: "https://api.mistral.ai/v1/chat/completions",
    apiKey: process.env.MISTRAL_API_KEY,
    model: "mistral-small-latest",
  }, label);
}

// 2026-06: OpenRouter (Llama 3.3 70b :free) como último colchão grátis. Cota
// SEPARADA de Groq/Cerebras/Mistral/Gemini — quando esses 4 saturam juntos (dia
// de pico: cota DIÁRIA de Cerebras/Gemini estourada + Groq martelado), criar
// assembleia/ágora e as vozes RODAR caíam direto em 429 cru ("Árvore sem fôlego").
// O Oráculo já tinha esse degrau via routeChat; chat.ts/agora-deliberativa não.
// OpenAI-compatible, então o body do Groq passa direto trocando só o model.
async function openrouterFallback(body: GroqBody, label: string): Promise<Response | null> {
  const baseUrl = (process.env.AI_INTEGRATIONS_OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/$/, "");
  return openaiCompatFallback(body, {
    name: "openrouter",
    url: `${baseUrl}/chat/completions`,
    apiKey: process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY,
    model: "meta-llama/llama-3.3-70b-instruct:free",
  }, label);
}

// ── Cerebras fallback ──────────────────────────────────────────────────────
// Cerebras free-tier tem cota SEPARADA do Google/Groq — quando ambos saturam ao
// mesmo tempo (acontece em prod 2026-05), Cerebras ainda responde. OpenAI-
// compatible, então o body do Groq passa direto trocando só o model. Tentado
// ANTES do Gemini. Model id: a conta perde acesso de tempos em tempos (qwen-3-235b
// → llama-3.3-70b → gpt-oss-120b dão 404 quando saem); conferir em
// GET https://api.cerebras.ai/v1/models antes de trocar.
async function cerebrasFallback(body: GroqBody, label: string): Promise<Response | null> {
  const apiKey = process.env.CEREBRAS_API_KEY;
  if (!apiKey) return null;
  const cerebrasBody = { ...(body as object), model: "gpt-oss-120b" };
  try {
    const resp = await fetch("https://api.cerebras.ai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(cerebrasBody),
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      logger.warn({ label, status: resp.status, err: errText.slice(0, 300) }, "[groq-retry] cerebras fallback HTTP não-OK");
      reportProviderFailure("cerebras", resp.status, errText);
      return null;
    }
    logger.info({ label, stream: body.stream === true }, "[groq-retry] usando cerebras fallback");
    reportProviderSuccess("cerebras");
    return resp;
  } catch (err) {
    logger.warn({ label, err }, "[groq-retry] cerebras fallback exception");
    return null;
  }
}

async function geminiFallback(body: GroqBody, label: string): Promise<Response | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    logger.warn({ label }, "[groq-retry] GEMINI_API_KEY ausente, sem fallback");
    return null;
  }
  const payload = toGeminiPayload(body);
  const wantStream = body.stream === true;
  const endpoint = wantStream ? "streamGenerateContent?alt=sse&" : "generateContent?";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:${endpoint}key=${apiKey}`;
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      logger.warn({ label, status: resp.status, err: errText.slice(0, 300) }, "[groq-retry] gemini fallback HTTP não-OK");
      reportProviderFailure("gemini", resp.status, errText);
      return null;
    }
    reportProviderSuccess("gemini");
    if (wantStream && resp.body) {
      logger.info({ label }, "[groq-retry] usando gemini fallback (stream)");
      return makeOpenAIStreamResponse(resp.body);
    }
    const data = (await resp.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    logger.info({ label, len: text.length }, "[groq-retry] usando gemini fallback (json)");
    return makeOpenAINonStreamResponse(text);
  } catch (err) {
    logger.warn({ label, err }, "[groq-retry] gemini fallback exception");
    return null;
  }
}

// Cadeia de fallback grátis (cotas separadas): Cerebras → Mistral → Gemini →
// OpenRouter. Cada elo PULA o provedor que está em cooling (já falhou há pouco
// em outra voz do mesmo RODAR), evitando refazer o round-trip que vai dar 429 de
// novo. Quando a 1ª voz mapeia a queda geral, as vozes seguintes caem aqui e
// retornam null quase instantâneo → o fan-out falha rápido em vez de travar.
async function runFreeFallbackChain(body: GroqBody, label: string): Promise<Response | null> {
  if (providerAvailable("cerebras")) {
    logger.warn({ label }, "[groq-retry] tentando cerebras fallback");
    const cb = await cerebrasFallback(body, label);
    if (cb) return cb;
  }
  if (providerAvailable("mistral")) {
    logger.warn({ label }, "[groq-retry] tentando mistral fallback");
    const ms = await mistralFallback(body, label);
    if (ms) return ms;
  }
  if (providerAvailable("gemini")) {
    logger.warn({ label }, "[groq-retry] tentando gemini fallback");
    const fb = await geminiFallback(body, label);
    if (fb) return fb;
  }
  if (providerAvailable("openrouter")) {
    logger.warn({ label }, "[groq-retry] tentando openrouter fallback");
    const or = await openrouterFallback(body, label);
    if (or) return or;
  }
  return null;
}

function exhaustedResponse(): Response {
  return new Response(JSON.stringify({ error: { message: "Groq 429 (retries exhausted), Cerebras+Mistral+Gemini+OpenRouter fallback indisponíveis" } }), {
    status: 429,
    headers: { "Content-Type": "application/json" },
  });
}

export async function fetchGroqChat(body: unknown, label = "groq"): Promise<Response> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY não configurada");

  // Guarda de entrada: se o Groq já está em cooling (uma voz irmã esgotou os
  // retries há pouco), não mói outros ~22s de 429 — vai direto pro fallback.
  // Sem isto, num RODAR de ~21 vozes cada onda redescobre a queda do zero.
  if (!providerAvailable("groq")) {
    logger.warn({ label }, "[groq-retry] groq em cooling, pulando direto pro fallback");
    const fb = await runFreeFallbackChain(body as GroqBody, label);
    return fb ?? exhaustedResponse();
  }

  const init: RequestInit = {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };

  let attempt = 0;
  while (true) {
    const res = await fetch(GROQ_URL, init);
    if (res.status === 401 || res.status === 403 || res.status === 404) {
      const errText = await res.text().catch(() => "");
      reportProviderFailure("groq", res.status, errText);
      logger.warn(
        { label, status: res.status, err: errText.slice(0, 300) },
        "[groq-retry] groq indisponível/incompatível, indo direto pro gemini",
      );

      const gemini = await geminiFallback(body as GroqBody, label);
      if (gemini) return gemini;

      const fb = await runFreeFallbackChain(body as GroqBody, label);
      return fb ?? exhaustedResponse();
    }
    if (res.status !== 429) {
      if (res.ok) reportProviderSuccess("groq");
      return res;
    }
    if (attempt >= MAX_RETRIES) {
      // Esgotou retries = Groq em queda sustentada (não burst transitório). Marca
      // cooling pra as próximas vozes pularem o grind, e cai na cadeia grátis.
      try { await res.text(); } catch {}
      reportProviderFailure("groq", 429);
      logger.warn({ label }, "[groq-retry] esgotou retries no groq, indo pro fallback");
      const fb = await runFreeFallbackChain(body as GroqBody, label);
      return fb ?? exhaustedResponse();
    }
    const base = parseRetryAfter(res.headers.get("retry-after")) ?? BASE_BACKOFF_MS * Math.pow(2, attempt);
    const wait = jitter(base);
    logger.warn({ label, attempt: attempt + 1, waitMs: wait }, "[groq-retry] HTTP 429, esperando");
    // drena o body pra não vazar conexão
    try { await res.text(); } catch {}
    await sleep(wait);
    attempt++;
  }
}
