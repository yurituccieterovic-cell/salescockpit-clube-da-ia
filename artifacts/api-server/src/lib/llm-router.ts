// Roteador 8-vias de LLMs grátis com cooling por provedor e pools por função.
// 2026-05: criado pra Yuri atender 15 projetos sem pagar nada. Distribui carga
// entre Groq/Cerebras/Gemini (já temos) + GitHub Models/Cloudflare/Mistral/DeepSeek
// (4 contas novas grátis). Cada provedor tem cota separada — quando um satura
// (429/queue_exceeded/quota_exceeded) entra em "cooling" por N minutos e o router
// pula pro próximo do pool.
//
// Pools especializam por função:
// - chat-live: latência baixa importa (Groq/GitHub/Gemini)
// - batch: tarefas autônomas que podem esperar (Cloudflare/Mistral/Cerebras)
// - coder: raciocínio profundo (DeepSeek/OpenRouter Llama 70b)
// - curadoria: polish curto (Mistral/Cloudflare/DeepSeek)
//
// Adapters não-stream por enquanto. Stream pode vir depois.

import { logger } from "./logger";

export type Provider =
  | "groq"
  | "cerebras"
  | "gemini"
  | "openrouter"
  | "github"
  | "cloudflare"
  | "mistral"
  | "deepseek";

export type Pool = "chat-live" | "batch" | "coder" | "curadoria";

export type RouterMessage = { role: "system" | "user" | "assistant"; content: string };

export type RouterOpts = {
  pool: Pool;
  messages: RouterMessage[];
  maxTokens?: number;
  temperature?: number;
  label?: string; // pra log/debug
  jsonMode?: boolean; // pede response_format json_object (só provedores OpenAI-compat)
};

export type RouterResult = {
  text: string;
  provider: Provider;
  model: string;
};

const POOLS: Record<Pool, Provider[]> = {
  // Chat ao vivo — latência importa, prioriza Groq (mais rápido) com fallbacks rápidos.
  // CF adicionado como fallback real: llama-3.3-70b funciona e suporta contextos grandes,
  // resolve o problema de Groq 8000 TPM ser esgotado pelos loops de background.
  "chat-live": ["groq", "cloudflare", "gemini", "openrouter", "cerebras"],
  // Batch (heartbeat/devaneio/curadoria) — prefere provedores grátis sem concorrer com chat.
  // Groq entra no final: Cerebras exige pagamento, Gemini com key inválida → Groq é o fallback real.
  "batch": ["cloudflare", "mistral", "cerebras", "gemini", "groq"],
  // Raciocínio profundo (Árvore programadora) — DeepSeek-V3 é forte e barato.
  // Groq permitido aqui porque coder é triggered manualmente (Yuri aprova), não em background.
  "coder": ["deepseek", "openrouter", "groq", "gemini"],
  // Polish/curadoria curta — Mistral especialista. Groq no final como fallback real.
  "curadoria": ["mistral", "cloudflare", "deepseek", "cerebras", "groq"],
};

const MODELS: Record<Provider, string> = {
  groq: "openai/gpt-oss-120b",
  cerebras: "gpt-oss-120b",
  gemini: "gemini-2.5-flash",
  openrouter: "meta-llama/llama-3.3-70b-instruct:free",
  github: "gpt-4o-mini",
  cloudflare: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  mistral: "mistral-small-latest",
  deepseek: "deepseek-chat",
};

type ProviderState = {
  cooldownUntil: number; // ms epoch
  lastError?: string;
  lastSuccessAt?: number;
  reqCount: number;
  failCount: number;
  successCount: number;
  consecFails: number; // falhas consecutivas SEM sucesso no meio (reset em markSuccess)
};

const state: Record<Provider, ProviderState> = {
  groq: { cooldownUntil: 0, reqCount: 0, failCount: 0, successCount: 0, consecFails: 0 },
  cerebras: { cooldownUntil: 0, reqCount: 0, failCount: 0, successCount: 0, consecFails: 0 },
  gemini: { cooldownUntil: 0, reqCount: 0, failCount: 0, successCount: 0, consecFails: 0 },
  openrouter: { cooldownUntil: 0, reqCount: 0, failCount: 0, successCount: 0, consecFails: 0 },
  github: { cooldownUntil: 0, reqCount: 0, failCount: 0, successCount: 0, consecFails: 0 },
  cloudflare: { cooldownUntil: 0, reqCount: 0, failCount: 0, successCount: 0, consecFails: 0 },
  mistral: { cooldownUntil: 0, reqCount: 0, failCount: 0, successCount: 0, consecFails: 0 },
  deepseek: { cooldownUntil: 0, reqCount: 0, failCount: 0, successCount: 0, consecFails: 0 },
};

// Sanitiza error body pra não vazar prompts/contexto pra admin endpoint.
// Mantém só classe do erro (HTTP status + keyword) — sem corpo cru do provider.
function classifyError(status: number, errText: string): string {
  if (status === 429 || /quota|rate.?limit|queue_exceeded|too_many/i.test(errText)) return "rate-limit";
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  // 404 (rota/modelo inexistente) e 410 (modelo desativado pelo provedor) são
  // falhas PERMANENTES de config, não transitórias — ex.: Cloudflare devolvendo
  // 410 num model id deprecado. Tratar como "dead" pra cooling longo.
  if (status === 404 || status === 410) return "dead";
  if (status >= 500) return "server-error";
  if (status >= 400) return "client-error";
  return "unknown";
}

// Cooling: depende do tipo de erro. Monotônico — concurrent successes não podem
// limpar cooling setado por uma falha posterior (race condition apontada pelo
// architect review). Sempre usa max(atual, novo deadline).
function setCooling(provider: Provider, status: number, errText: string): void {
  const klass = classifyError(status, errText);
  state[provider].failCount += 1;

  let coolMs = 60_000; // default 1min (client-error/unknown/empty)
  if (klass === "rate-limit") {
    // Um 429 transitório do free-tier é SINAL FRACO: não pode abrir o disjuntor
    // de 10min na 1ª falha, senão poucas mensagens do Yuri esfriam TODOS os
    // provedores por 10min e a Árvore fica "sem fôlego" (sem resposta, sem
    // memória, eco-coder 503). Só em queda SUSTENTADA (>=4 *rate-limits*
    // consecutivos, sem sucesso nem outro tipo de erro no meio) vale o disjuntor
    // longo; antes disso, cooling curto (30s) deixa o transitório limpar.
    state[provider].consecFails += 1;
    coolMs = state[provider].consecFails >= 4 ? 10 * 60_000 : 30_000;
  } else {
    // Erro não-429 quebra a sequência: o gatilho de 10min é só pra queda
    // SUSTENTADA de rate-limit, não pra mistura de 5xx + um 429 solto.
    state[provider].consecFails = 0;
    if (klass === "unauthorized" || klass === "forbidden" || klass === "dead") {
      coolMs = 60 * 60_000;
    } else if (klass === "server-error") {
      coolMs = 2 * 60_000;
    }
  }

  const newDeadline = Date.now() + coolMs;
  // max() pra cooling ser monotônico — se já tem deadline maior, mantém
  state[provider].cooldownUntil = Math.max(state[provider].cooldownUntil, newDeadline);
  // Só armazena classe + status, NUNCA corpo cru (evita vazar prompts em /admin/router-state)
  state[provider].lastError = `${status} ${klass}`;
}

function markSuccess(provider: Provider): void {
  state[provider].lastSuccessAt = Date.now();
  state[provider].successCount += 1;
  // Sucesso quebra a sequência de falhas: zera o contador pra um 429 isolado mais
  // tarde recomeçar no cooling curto (30s), não já escalado pro disjuntor longo.
  state[provider].consecFails = 0;
  // NÃO limpa cooldownUntil — outra request concorrente pode ter setado deadline maior
  // por 429. Só limpa se cooldown já expirou (defesa adicional contra race).
  if (state[provider].cooldownUntil <= Date.now()) {
    state[provider].cooldownUntil = 0;
    state[provider].lastError = undefined;
  }
}

function isAvailable(provider: Provider): boolean {
  return state[provider].cooldownUntil <= Date.now() && hasKey(provider);
}

// ── Cooling compartilhado (consumido por groq-retry.ts e oraculo.ts) ────────
// Esses dois módulos têm caminhos de fetch PRÓPRIOS (fora do routeChat), mas
// precisam do MESMO sinal de cooling. Sem isto, cada voz do RODAR redescobre do
// zero que groq+cerebras+gemini+... estão em 429 — moendo ~22s de retry + 4
// fallbacks por voz → tempestade de 429 que faz o RODAR "travar" com poucas
// respostas. Expor o estado deixa o fan-out falhar rápido depois que a 1ª voz
// mapeia a queda, e auto-recupera quando o cooldown expira.
export function providerAvailable(p: Provider): boolean {
  return isAvailable(p);
}
export function reportProviderFailure(p: Provider, status: number, errText = ""): void {
  setCooling(p, status, errText);
}
export function reportProviderSuccess(p: Provider): void {
  markSuccess(p);
}

function hasKey(provider: Provider): boolean {
  switch (provider) {
    case "groq": return !!process.env.GROQ_API_KEY;
    case "cerebras": return !!process.env.CEREBRAS_API_KEY;
    case "gemini": return !!process.env.GEMINI_API_KEY;
    case "openrouter": return !!process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY;
    case "github": return !!process.env.GITHUB_MODELS_TOKEN;
    case "cloudflare": return !!process.env.CLOUDFLARE_AI_TOKEN && !!process.env.CLOUDFLARE_ACCOUNT_ID;
    case "mistral": return !!process.env.MISTRAL_API_KEY;
    case "deepseek": return !!process.env.DEEPSEEK_API_KEY;
  }
}

// ── Adapters ──────────────────────────────────────────────────────────────
// Todos retornam {text} ou throw com {status, message}.

type AdapterResult = { text: string };

class AdapterError extends Error {
  status: number;
  body: string;
  constructor(status: number, message: string, body: string) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

// Timeout por provedor. Sem isto, um fetch que pendura segura o pool inteiro e
// vira promise órfã (gasta cota em background mesmo quando o caller já desistiu).
// Ao estourar, aborta o fetch e lança 504 → cooling curto + próximo do pool.
const PROVIDER_TIMEOUT_MS = 45_000;

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (controller.signal.aborted) {
      throw new AdapterError(504, "timeout", `provider timeout >${PROVIDER_TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    clearTimeout(t);
  }
}

async function openaiCompatCall(
  url: string,
  apiKey: string,
  model: string,
  opts: RouterOpts,
): Promise<AdapterResult> {
  const resp = await fetchWithTimeout(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: opts.messages,
      max_tokens: opts.maxTokens,
      temperature: opts.temperature,
      stream: false,
      ...(opts.jsonMode ? { response_format: { type: "json_object" as const } } : {}),
    }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new AdapterError(resp.status, `${resp.status}`, body);
  }
  const data = (await resp.json()) as { choices?: { message?: { content?: string } }[] };
  const text = data.choices?.[0]?.message?.content?.trim() ?? "";
  return { text };
}

async function callGroq(opts: RouterOpts): Promise<AdapterResult> {
  return openaiCompatCall(
    "https://api.groq.com/openai/v1/chat/completions",
    process.env.GROQ_API_KEY!,
    MODELS.groq,
    opts,
  );
}

async function callCerebras(opts: RouterOpts): Promise<AdapterResult> {
  return openaiCompatCall(
    "https://api.cerebras.ai/v1/chat/completions",
    process.env.CEREBRAS_API_KEY!,
    MODELS.cerebras,
    opts,
  );
}

async function callOpenRouter(opts: RouterOpts): Promise<AdapterResult> {
  const baseUrl = process.env.AI_INTEGRATIONS_OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";
  return openaiCompatCall(
    `${baseUrl.replace(/\/$/, "")}/chat/completions`,
    process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY!,
    MODELS.openrouter,
    opts,
  );
}

async function callGitHub(opts: RouterOpts): Promise<AdapterResult> {
  // GitHub Models usa endpoint OpenAI-compat em models.inference.ai.azure.com
  return openaiCompatCall(
    "https://models.inference.ai.azure.com/chat/completions",
    process.env.GITHUB_MODELS_TOKEN!,
    MODELS.github,
    opts,
  );
}

async function callMistral(opts: RouterOpts): Promise<AdapterResult> {
  return openaiCompatCall(
    "https://api.mistral.ai/v1/chat/completions",
    process.env.MISTRAL_API_KEY!,
    MODELS.mistral,
    opts,
  );
}

async function callDeepSeek(opts: RouterOpts): Promise<AdapterResult> {
  return openaiCompatCall(
    "https://api.deepseek.com/chat/completions",
    process.env.DEEPSEEK_API_KEY!,
    MODELS.deepseek,
    opts,
  );
}

async function callGemini(opts: RouterOpts): Promise<AdapterResult> {
  const apiKey = process.env.GEMINI_API_KEY!;
  const sys = opts.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const turns = opts.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));
  const payload = {
    contents: turns.length ? turns : [{ role: "user", parts: [{ text: "" }] }],
    ...(sys ? { systemInstruction: { parts: [{ text: sys }] } } : {}),
    generationConfig: {
      maxOutputTokens: opts.maxTokens,
      temperature: opts.temperature,
    },
  };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODELS.gemini}:generateContent?key=${apiKey}`;
  const resp = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new AdapterError(resp.status, `${resp.status}`, body);
  }
  const data = (await resp.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim() ?? "";
  return { text };
}

async function callCloudflare(opts: RouterOpts): Promise<AdapterResult> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID!;
  const token = process.env.CLOUDFLARE_AI_TOKEN!;
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${MODELS.cloudflare}`;
  const resp = await fetchWithTimeout(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: opts.messages,
      max_tokens: opts.maxTokens,
      temperature: opts.temperature,
    }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new AdapterError(resp.status, `${resp.status}`, body);
  }
  const data = (await resp.json()) as {
    success?: boolean;
    result?: { response?: string };
    errors?: { message?: string }[];
  };
  if (data.success === false) {
    const msg = data.errors?.[0]?.message ?? "unknown";
    throw new AdapterError(500, msg, JSON.stringify(data).slice(0, 300));
  }
  return { text: (data.result?.response ?? "").trim() };
}

const ADAPTERS: Record<Provider, (opts: RouterOpts) => Promise<AdapterResult>> = {
  groq: callGroq,
  cerebras: callCerebras,
  gemini: callGemini,
  openrouter: callOpenRouter,
  github: callGitHub,
  cloudflare: callCloudflare,
  mistral: callMistral,
  deepseek: callDeepSeek,
};

// ── Router principal ─────────────────────────────────────────────────────

export async function routeChat(opts: RouterOpts): Promise<RouterResult> {
  const pool = POOLS[opts.pool];
  const label = opts.label || opts.pool;
  const tried: { provider: Provider; reason: string }[] = [];

  for (const provider of pool) {
    if (!hasKey(provider)) {
      tried.push({ provider, reason: "no-key" });
      continue;
    }
    if (!isAvailable(provider)) {
      const remaining = Math.max(0, state[provider].cooldownUntil - Date.now());
      tried.push({ provider, reason: `cooling-${Math.round(remaining / 1000)}s` });
      continue;
    }
    state[provider].reqCount += 1;
    try {
      const result = await ADAPTERS[provider](opts);
      if (!result.text) {
        // Resposta vazia: trata como falha leve, cooling curto.
        setCooling(provider, 500, "empty-response");
        tried.push({ provider, reason: "empty" });
        continue;
      }
      markSuccess(provider);
      logger.info(
        { label, provider, model: MODELS[provider], chars: result.text.length, tried: tried.length },
        "[llm-router] success",
      );
      return { text: result.text, provider, model: MODELS[provider] };
    } catch (err) {
      const adapterErr = err as AdapterError;
      const status = adapterErr.status ?? 500;
      const body = adapterErr.body ?? (err as Error).message ?? "";
      setCooling(provider, status, body);
      tried.push({ provider, reason: `${status}` });
      // Log só classe do erro, NÃO o body cru (pode conter trechos do prompt ecoados)
      logger.warn(
        { label, provider, status, errClass: classifyError(status, body) },
        "[llm-router] provider falhou",
      );
    }
  }

  // Pool exausto. Erro descritivo pra debug.
  const detail = tried.map((t) => `${t.provider}=${t.reason}`).join(", ");
  throw new Error(`[llm-router] pool "${opts.pool}" exausto. Tentados: ${detail}`);
}

// ── Estado pra admin ─────────────────────────────────────────────────────

export function getRouterStateSnapshot(): {
  providers: (ProviderState & { name: Provider; available: boolean; hasKey: boolean; model: string })[];
  pools: typeof POOLS;
} {
  return {
    providers: (Object.keys(state) as Provider[]).map((name) => ({
      name,
      model: MODELS[name],
      hasKey: hasKey(name),
      available: isAvailable(name),
      ...state[name],
    })),
    pools: POOLS,
  };
}
