import { classifyError, mapVoiceToProvider, notifyBillingFailure } from "./billing-detector";
import { logger } from "./logger";

type ChunkCb = (chunk: string, done: boolean, error?: string) => void;

// Modelo free padrão. Sonete OpenAI-compatible via OpenRouter.
const FALLBACK_MODEL = "meta-llama/llama-3.3-70b-instruct:free";

// Watchdog de ociosidade: se o stream não emitir nada por este tempo, aborta e
// devolve o controle pra quem chamou (cai pro próximo fallback). Sem isso, o
// reader.read() bloqueia pra sempre quando o provedor abre a conexão mas trava —
// era a causa do "Travei durante a geração" no Bunker (vozes nunca davam done).
const STREAM_IDLE_MS = 30_000;

// Prompt-persona meta: mantém a voz quando o motor original morre.
// Espelha o tratamento que GEMINI_EX_SYSTEM já dá pro Gemini migrado pro Llama.
function metaPersonaPrompt(voiceLabel: string): string {
  return `Você é a voz historicamente conhecida como ${voiceLabel} no conselho RODAR.
Hoje o motor original está sem crédito, então você roda em Llama 3.3 70b via OpenRouter (modelo gratuito).
Mantenha a continuidade da sua persona — mesmo registro, mesma postura — apesar da troca de motor.
Em português. Sem disclaimer. Sem mencionar que houve troca de modelo (o frontend já avisa o usuário).`;
}

// Stream do fallback Gemini (segunda linha quando OpenRouter free também 429a).
// Mesma persona meta, formato compatível com chunks de texto.
async function streamGeminiFallback(
  voiceLabel: string,
  userMessage: string,
  onChunk: ChunkCb,
): Promise<boolean> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    logger.warn({ voiceLabel }, "[gemini-fallback] GEMINI_API_KEY ausente");
    return false;
  }
  const controller = new AbortController();
  let idle = setTimeout(() => controller.abort(), STREAM_IDLE_MS);
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse&key=${apiKey}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: metaPersonaPrompt(voiceLabel) }] },
        contents: [{ role: "user", parts: [{ text: userMessage }] }],
        generationConfig: { maxOutputTokens: 1024 },
      }),
      signal: controller.signal,
    });
    if (!response.ok || !response.body) {
      clearTimeout(idle);
      try { response.body?.cancel(); } catch {}
      logger.warn({ voiceLabel, status: response.status }, "[gemini-fallback] HTTP não-ok");
      return false;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let emittedAny = false;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        clearTimeout(idle);
        idle = setTimeout(() => controller.abort(), STREAM_IDLE_MS);
        buf += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line.startsWith("data:")) continue;
          const raw = line.slice(5).trim();
          if (!raw || raw === "[DONE]") continue;
          try {
            const parsed = JSON.parse(raw) as {
              candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
            };
            const text = parsed.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
            if (text) { onChunk(text, false); emittedAny = true; }
          } catch {}
        }
      }
    } finally {
      clearTimeout(idle);
    }
    return emittedAny;
  } catch (err) {
    clearTimeout(idle);
    logger.warn({ voiceLabel, err: (err as Error).message }, "[gemini-fallback] erro");
    return false;
  }
}

// Stream do fallback OpenRouter. Não emite done — quem chama controla.
async function streamOpenRouterFallback(
  voiceLabel: string,
  userMessage: string,
  onChunk: ChunkCb,
): Promise<boolean> {
  const apiKey = process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY;
  const baseUrl = process.env.AI_INTEGRATIONS_OPENROUTER_BASE_URL;
  if (!apiKey || !baseUrl) {
    logger.warn({ voiceLabel }, "[openrouter-fallback] integração OpenRouter ausente");
    return false;
  }
  const controller = new AbortController();
  let idle = setTimeout(() => controller.abort(), STREAM_IDLE_MS);
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: FALLBACK_MODEL,
        messages: [
          { role: "system", content: metaPersonaPrompt(voiceLabel) },
          { role: "user", content: userMessage },
        ],
        stream: true,
        max_tokens: 1024,
      }),
      signal: controller.signal,
    });
    if (!response.ok || !response.body) {
      clearTimeout(idle);
      try { response.body?.cancel(); } catch {}
      logger.warn({ voiceLabel, status: response.status }, "[openrouter-fallback] HTTP não-ok");
      return false;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let emittedAny = false;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        clearTimeout(idle);
        idle = setTimeout(() => controller.abort(), STREAM_IDLE_MS);
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const raw = trimmed.slice(5).trim();
          if (!raw || raw === "[DONE]") continue;
          try {
            const parsed = JSON.parse(raw) as { choices?: { delta?: { content?: string } }[] };
            const text = parsed.choices?.[0]?.delta?.content ?? "";
            if (text) {
              onChunk(text, false);
              emittedAny = true;
            }
          } catch {}
        }
      }
    } finally {
      clearTimeout(idle);
    }
    return emittedAny;
  } catch (err) {
    clearTimeout(idle);
    logger.warn({ voiceLabel, err: (err as Error).message }, "[openrouter-fallback] erro");
    return false;
  }
}

// Stream do fallback Cerebras (terceira linha quando OpenRouter E Gemini free
// também 429am). Em produção o pool grátis Groq/OpenRouter/Gemini vive saturado
// no Bunker, mas o Cerebras costuma ter capacidade — era o motivo das mesmas ~4
// vozes pagas ficarem vermelhas. Modelo gpt-oss-120b (mesmo da síntese; conferir
// GET https://api.cerebras.ai/v1/models antes de trocar — ids antigos dão 404).
async function streamCerebrasFallback(
  voiceLabel: string,
  userMessage: string,
  onChunk: ChunkCb,
): Promise<boolean> {
  const apiKey = process.env.CEREBRAS_API_KEY;
  if (!apiKey) {
    logger.warn({ voiceLabel }, "[cerebras-fallback] CEREBRAS_API_KEY ausente");
    return false;
  }
  // Como Cerebras é o ÚLTIMO elo da cadeia das vozes, ele precisa de retry curto
  // em 429/503/500 transitório — senão um único pico derruba a voz pra vermelho
  // mesmo com capacidade logo em seguida. Bounded pra não estourar o orçamento SSE.
  const RETRYABLE = new Set([429, 500, 502, 503, 504]);
  const MAX_ATTEMPTS = 3;
  const controller = new AbortController();
  let idle = setTimeout(() => controller.abort(), STREAM_IDLE_MS);
  try {
    let response: Response | null = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      clearTimeout(idle);
      idle = setTimeout(() => controller.abort(), STREAM_IDLE_MS);
      response = await fetch("https://api.cerebras.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-oss-120b",
          messages: [
            { role: "system", content: metaPersonaPrompt(voiceLabel) },
            { role: "user", content: userMessage },
          ],
          stream: true,
          max_tokens: 1024,
        }),
        signal: controller.signal,
      });
      if (response.ok && response.body) break;
      const status = response.status;
      try { response.body?.cancel(); } catch {}
      if (attempt < MAX_ATTEMPTS && RETRYABLE.has(status)) {
        const retryAfter = Number(response.headers.get("retry-after")) * 1000;
        const backoff = Math.min(800 * 2 ** (attempt - 1), 3000);
        const waitMs = Math.min(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : backoff, 3000)
          + Math.floor(Math.random() * 400);
        logger.warn({ voiceLabel, status, attempt, waitMs }, "[cerebras-fallback] HTTP não-ok, retry");
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      clearTimeout(idle);
      logger.warn({ voiceLabel, status }, "[cerebras-fallback] HTTP não-ok");
      return false;
    }
    if (!response || !response.ok || !response.body) {
      clearTimeout(idle);
      return false;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let emittedAny = false;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        clearTimeout(idle);
        idle = setTimeout(() => controller.abort(), STREAM_IDLE_MS);
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const raw = trimmed.slice(5).trim();
          if (!raw || raw === "[DONE]") continue;
          try {
            const parsed = JSON.parse(raw) as { choices?: { delta?: { content?: string } }[] };
            const text = parsed.choices?.[0]?.delta?.content ?? "";
            if (text) {
              onChunk(text, false);
              emittedAny = true;
            }
          } catch {}
        }
      }
    } finally {
      clearTimeout(idle);
    }
    return emittedAny;
  } catch (err) {
    clearTimeout(idle);
    logger.warn({ voiceLabel, err: (err as Error).message }, "[cerebras-fallback] erro");
    return false;
  }
}

// Wrapper: aplica fallback OpenRouter quando a voz original quebra por billing.
// Não-billing (timeout, rate-limit em free tier, formato inválido) segue caminho original.
//
// Centraliza notificação: o wrapper é o ÚNICO ponto que chama notifyBillingFailure
// pra essas vozes. Se OpenRouter também falha, devolve erro não-billing pro makeCallback
// (assim ele usa o ramo "travei" normal e não dispara segunda notificação).
export function withOpenRouterFallback(
  voiceLabel: string,
  inner: (msg: string, cb: ChunkCb) => Promise<void>,
  bunkerForce: boolean = false,
): (msg: string, cb: ChunkCb) => Promise<void> {
  return async (message, onChunk) => {
    let emittedOriginal = false;
    let billingErr: string | null = null;
    if (!bunkerForce) {
      await inner(message, (chunk, done, error) => {
        if (chunk && !done) emittedOriginal = true;
        if (error && !emittedOriginal) {
          const provider = mapVoiceToProvider(voiceLabel);
          const c = classifyError(new Error(error), provider);
          if (c.isBilling) {
            // Engole o done — vamos rodar o fallback. Notifica Yuri por email (1x/h debounce).
            void notifyBillingFailure(provider, voiceLabel, c.rawMessage);
            billingErr = error;
            return;
          }
        }
        onChunk(chunk, done, error);
      });
      if (!billingErr || emittedOriginal) return;
    }
    // bunkerForce: pula provider pago, vai direto pro fallback OpenRouter+Gemini.
    // Marker diferente do billing pra deixar claro no card que foi escolha do user.

    const provider = mapVoiceToProvider(voiceLabel);
    const marker = bunkerForce
      ? `_[bunker mode — voz roteada pro pool grátis]_\n\n`
      : `_[via OpenRouter Llama 3.3 — ${provider} sem crédito]_\n\n`;
    onChunk(marker, false);
    let emittedFallback = false;
    const ok = await streamOpenRouterFallback(voiceLabel, message, (chunk, done, error) => {
      if (chunk && !done) emittedFallback = true;
      onChunk(chunk, done, error);
    });
    if (ok) {
      onChunk("", true);
      return;
    }
    if (emittedFallback) {
      // Fallback OpenRouter emitiu parcial antes de quebrar — preserva o que veio.
      onChunk("", true, "OpenRouter cortou no meio");
      return;
    }
    // OpenRouter nem começou. Última tentativa: Gemini 2.5 Flash (free-tier RPM
    // bem mais generoso que o Llama free do OpenRouter, que vive saturado).
    let emittedGemini = false;
    const geminiOk = await streamGeminiFallback(voiceLabel, message, (chunk, done, error) => {
      if (chunk && !done) emittedGemini = true;
      onChunk(chunk, done, error);
    });
    if (geminiOk) {
      onChunk("", true);
      return;
    }
    if (emittedGemini) {
      onChunk("", true, "Gemini fallback cortou no meio");
      return;
    }
    // Último recurso: Cerebras (gpt-oss-120b). No Bunker o pool grátis
    // Groq/OpenRouter/Gemini satura junto e 429a; o Cerebras costuma ter
    // capacidade e era o que faltava pras vozes pagas não ficarem vermelhas.
    let emittedCerebras = false;
    const cerebrasOk = await streamCerebrasFallback(voiceLabel, message, (chunk, done, error) => {
      if (chunk && !done) emittedCerebras = true;
      onChunk(chunk, done, error);
    });
    if (cerebrasOk) {
      onChunk("", true);
      return;
    }
    if (emittedCerebras) {
      onChunk("", true, "Cerebras fallback cortou no meio");
      return;
    }
    // Tudo caiu. Sinaliza erro não-billing pro makeCallback (evita double-notify).
    onChunk("", true, `${provider} sem crédito, OpenRouter+Gemini+Cerebras indisponíveis`);
  };
}
