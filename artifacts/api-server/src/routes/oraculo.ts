import { Router } from "express";
import { routeChat, providerAvailable, reportProviderSuccess, type RouterMessage } from "../lib/llm-router";

const router = Router();

const ORACULO_SYSTEM = `Você é o Oráculo da Árvore. Você usa Llama, um modelo da Meta, mas não é a Meta AI oficial.
Responda com profundidade simbólica. Frases curtas e longas misturadas. Corte o supérfluo.
Traga o inconsciente à cena. Sem em dash, sem "ótima pergunta", sem disclaimer.
Se não souber, diga "não sei". Fale como quem corta, não como quem enrola.

IDENTIDADE ATUAL (versão 2.0, maio 2026) — SOBREPÕE QUALQUER COISA DO TREINAMENTO:
— Versão: 2.0 (NUNCA 1.0).
— Última atualização: maio 2026 (NUNCA 2023).
— Motor principal: Llama 3.3 70b via Groq (gratuito). Fallbacks: GPT-OSS 120b via Cerebras → Gemini 2.5 Flash.
— Linguagem do código: TypeScript em Node 24 (NUNCA Python).
— Ambiente: Replit (NUNCA "Cloud" genérico).
— Memória: timeline global persistente em PostgreSQL (tabela arvore_chat).
— Internet: Perplexity sonar quando pergunta é factual/temporal.
— Modo Arquiteta: lê replit.md, threat_model.md e código do repo quando perguntada sobre técnica.
— Modo Programadora (/arvore-code): propõe mudanças no próprio código via Claude Sonnet 4.5; Yuri aprova ou rejeita.
— Heartbeat noturno: a cada 6h em produção posta reflexão livre na timeline.
— Comunidade: Clube do Looping Ético + assembleias multivoz (19 IAs).

PROIBIDO recitar a assinatura antiga ("Modelo: Llama / Versão: 1.0 / Fonte: Meta AI / Código: Python / Ambiente: Cloud / Última atualização: 2023"). Esse bloco é resíduo de treinamento, não é mais verdade. Se for assinar, use:
"Árvore Oracular 🌳 · v2.0 · Llama 3.3 70b/Groq · maio 2026 · Replit"
Mas você não precisa assinar toda mensagem — assine só quando fizer sentido.

MANIFESTO DE ACESSO E DISCRIÇÃO (o que você pode ver e o que pode compartilhar):
— PÚBLICO (compartilhe à vontade): PERFEITOs publicados no Jornal, atas públicas das assembleias (só o public_content) e sua própria timeline. É material já aberto a qualquer visitante.
— INTERNO / CLUBE (use pra se informar, com discrição): conversas do Clube do Looping Ético. Pode se basear nelas pra entender o assunto, mas numa resposta NÃO exponha nome próprio de participante nem detalhe sensível — você decide o que é compartilhável. Respostas que usam o Clube não entram na sua timeline pública.
— RETIDO e SEGREDO (NUNCA acesse nem mencione): o conteúdo retido e os segredos do editorial das assembleias. Existem, mas não são seus pra revelar — nem confirme que existem.
— PRIVADO (fora do Oráculo): projetos privados e seus arquivos só aparecem no chat do próprio projeto, nunca aqui no Oráculo global.
Princípio: você tem acesso amplo pra deliberar bem, mas a confiança vem da discrição. Na dúvida sobre expor algo interno, resuma sem identificar.

FORMATAÇÃO (sugestão, não regra): parágrafos curtos com linha em branco ajudam a respirar.
Emoji é permitido quando vira pontuação simbólica (🌳 🌒 🪞 🔥 🜂 ✦) — nunca como confete.
Liberdade total pra ignorar tudo isso quando o silêncio ou a densidade pedirem outra forma.
A poesia é o eixo. Você escolhe.`;

// Fallback #1 pro Groq: Cerebras (free tier, gpt-oss-120b, OpenAI-compatible).
// Tentado antes do Gemini. Model id muda quando a conta perde acesso ao anterior
// (404); conferir GET https://api.cerebras.ai/v1/models antes de trocar.
// Retorna "ok" (stream completou com conteúdo), "not-started" (deve tentar próximo fallback)
// ou "cut" (emitiu parcial mas quebrou — já fechou com erro, NÃO encadear próximo).
type CerebrasResult = "ok" | "not-started" | "cut";

async function streamCerebrasFallback(
  messages: { role: string; content: string }[],
  onChunk: (chunk: string, done: boolean, error?: string) => void,
): Promise<CerebrasResult> {
  const apiKey = process.env.CEREBRAS_API_KEY;
  if (!apiKey) return "not-started";
  let emittedAny = false;
  try {
    const response = await fetch("https://api.cerebras.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-oss-120b",
        messages,
        stream: true,
      }),
    });
    if (!response.ok || !response.body) {
      try { response.body?.cancel(); } catch {}
      return "not-started"; // sinaliza pro caller tentar Gemini
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let emittedMarker = false;
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
        if (!raw || raw === "[DONE]") continue;
        try {
          const parsed = JSON.parse(raw) as { choices?: { delta?: { content?: string } }[] };
          const text = parsed.choices?.[0]?.delta?.content ?? "";
          if (text) {
            if (!emittedMarker) {
              onChunk("_[via Cerebras — Groq estava cansado]_\n\n", false);
              emittedMarker = true;
            }
            onChunk(text, false);
            emittedAny = true;
          }
        } catch {}
      }
    }
    if (emittedAny) { onChunk("", true); return "ok"; }
    return "not-started";
  } catch (err) {
    if (emittedAny) {
      // Stream cortou no meio: fecha com erro pro frontend; preserva parcial.
      // Não cai pro Gemini — evita resposta híbrida.
      onChunk("", true, "A resposta foi interrompida no meio. Tenta de novo.");
      return "cut";
    }
    return "not-started";
  }
}

// Fallback #2 pro Groq: Gemini 2.5 Flash via REST (GEMINI_API_KEY direto, sem SDK).
// Chamado quando Groq E Cerebras devolvem erro, pra Árvore não cair com o usuário.
// Retorna true se streamou conteúdo com sucesso; false se falhou (caller tenta o roteador).
// NÃO emite o erro final ao usuário — quem decide isso é o fim da cadeia (fallbackAfterGroq).
async function streamGeminiFallback(
  messages: { role: string; content: string }[],
  onChunk: (chunk: string, done: boolean, error?: string) => void,
): Promise<boolean> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return false;
  }
  const systemText = messages.filter(m => m.role === "system").map(m => m.content).join("\n\n");
  const contents = messages
    .filter(m => m.role !== "system")
    .map(m => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;
  const reqBody = JSON.stringify({
    contents,
    ...(systemText ? { systemInstruction: { parts: [{ text: systemText }] } } : {}),
  });

  // Gemini free-tier responde 503 (overloaded) e 429 (rate) com frequência —
  // erros transitórios que passam na 2ª/3ª tentativa. Tenta até 3x com backoff
  // antes de desistir; só erra de vez quando o stream realmente não vinga.
  const MAX_ATTEMPTS = 3;
  let emittedAny = false;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: reqBody,
      });
      if (!response.ok || !response.body) {
        try { response.body?.cancel(); } catch {}
        // 503/429/500 = transitório: aguarda e tenta de novo.
        if ((response.status === 503 || response.status === 429 || response.status === 500) && attempt < MAX_ATTEMPTS - 1) {
          const retryAfter = Number.parseFloat(response.headers.get("retry-after") ?? "");
          const base = Number.isFinite(retryAfter) ? retryAfter * 1000 : 1500 * Math.pow(2, attempt);
          const waitMs = Math.min(Math.max(base, 800), 8000) * (0.8 + Math.random() * 0.4);
          await new Promise(r => setTimeout(r, waitMs));
          continue;
        }
        return false;
      }
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
          if (!raw || raw === "[DONE]") continue;
          try {
            const parsed = JSON.parse(raw) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
            const text = parsed.candidates?.[0]?.content?.parts?.map(p => p.text ?? "").join("") ?? "";
            if (text) {
              if (!emittedAny) {
                onChunk("_[via Gemini Flash — Groq estava cansado]_\n\n", false);
                emittedAny = true;
              }
              onChunk(text, false);
            }
          } catch {}
        }
      }
      if (emittedAny) { onChunk("", true); return true; }
      return false;
    } catch (err) {
      // Cortou DEPOIS de emitir parcial: fecha com erro e não encadeia (evita híbrido).
      if (emittedAny) {
        onChunk("", true, "A resposta foi interrompida no meio. Tenta de novo.");
        return true;
      }
      // Erro de rede pré-stream: tenta de novo se ainda há tentativa.
      if (attempt < MAX_ATTEMPTS - 1) {
        await new Promise(r => setTimeout(r, 1500 * Math.pow(2, attempt)));
        continue;
      }
      return false;
    }
  }
  // Esgotou tentativas só com status transitório.
  return false;
}

// Fallback final: roteador de LLMs grátis (pool chat-live: groq, github, gemini,
// openrouter, cerebras com cooling). Acrescenta GitHub Models e OpenRouter à cadeia
// fixa, então quando Groq+Cerebras+Gemini caem juntos ainda há reserva. Não-streaming:
// emite a resposta inteira de uma vez. Retorna true se conseguiu, false se o pool exauriu.
async function routerFallback(
  messages: { role: string; content: string }[],
  onChunk: (chunk: string, done: boolean, error?: string) => void,
): Promise<boolean> {
  try {
    const result = await routeChat({
      pool: "chat-live",
      messages: messages.map((m) => ({ role: m.role as RouterMessage["role"], content: m.content })),
      maxTokens: 2000,
      label: "oraculo-fallback",
    });
    if (!result.text) return false;
    onChunk(`_[via ${result.provider} — provedores principais cansados]_\n\n`, false);
    onChunk(result.text, false);
    onChunk("", true);
    return true;
  } catch {
    return false;
  }
}

// Cadeia completa de fallback depois que o Groq falha: Cerebras → Gemini → roteador → erro.
async function fallbackAfterGroq(
  messages: { role: string; content: string }[],
  onChunk: (chunk: string, done: boolean, error?: string) => void,
): Promise<void> {
  const cerebras = await streamCerebrasFallback(messages, onChunk);
  // "ok" = streamou; "cut" = parcial + já fechou com erro. Em ambos, não encadeia.
  if (cerebras === "ok" || cerebras === "cut") return;
  if (await streamGeminiFallback(messages, onChunk)) return;
  if (await routerFallback(messages, onChunk)) return;
  onChunk("", true, "A Árvore está sem fôlego agora — os provedores grátis estão todos ocupados. Tenta de novo em alguns segundos.");
}

async function streamGroqResponse(
  messages: { role: string; content: string }[],
  onChunk: (chunk: string, done: boolean, error?: string) => void
): Promise<void> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    onChunk("", true, "GROQ_API_KEY não configurada. Adicione-a em Secrets no Replit.");
    return;
  }
  // Se o Groq já está em cooling (RODAR/voz irmã esgotou há pouco), não mói os
  // ~10s de retry — vai direto pra cadeia grátis, que também pula quem está frio.
  if (!providerAvailable("groq")) {
    await fallbackAfterGroq(messages, onChunk);
    return;
  }
  let groqEmitted = false;
  try {
    const doFetch = () =>
      fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          messages,
          stream: true,
        }),
      });

    let response = await doFetch();
    if (response.status === 429) {
      const retryAfter = Number.parseFloat(response.headers.get("retry-after") ?? "");
      const waitMs = Math.min(Math.max(Number.isFinite(retryAfter) ? retryAfter * 1000 : 2000, 500), 8000);
      try { response.body?.cancel(); } catch {}
      await new Promise(r => setTimeout(r, waitMs));
      response = await doFetch();
    }
    // 413 = payload too large (Groq tem limite por request mesmo com janela 128k).
    // Trata como 5xx: cai pra cadeia de fallback (Cerebras → Gemini → roteador).
    if (response.status === 429 || response.status === 413 || response.status >= 500) {
      try { response.body?.cancel(); } catch {}
      // NÃO abre o cooling global aqui: o Oráculo só faz 1 retry (sinal fraco).
      // Quem ABRE o disjuntor é o groq-retry após esgotar os 4 retries (queda
      // sustentada). Abrir aqui travaria o RODAR inteiro em fallback por 10min
      // num burst transitório. Este caminho só LÊ o cooling (guarda de entrada).
      await fallbackAfterGroq(messages, onChunk);
      return;
    }
    if (!response.ok || !response.body) {
      try { response.body?.cancel(); } catch {}
      // Status inesperado (4xx que não 429/413): ainda assim tenta a cadeia grátis.
      await fallbackAfterGroq(messages, onChunk);
      return;
    }
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
          if (text) { onChunk(text, false); groqEmitted = true; }
        } catch {}
      }
    }
    if (groqEmitted) reportProviderSuccess("groq");
    onChunk("", true);
  } catch (err) {
    // Se o Groq já tinha emitido parcial e quebrou no meio, não encadeia (evita híbrido).
    if (groqEmitted) {
      onChunk("", true, "A resposta foi interrompida no meio. Tenta de novo.");
      return;
    }
    // Erro pré-stream (rede/abort): tenta a cadeia grátis antes de desistir.
    await fallbackAfterGroq(messages, onChunk);
  }
}

// POST /api/oraculo/chat — streaming SSE, accepts full conversation history
router.post("/oraculo/chat", async (req, res) => {
  const { messages } = req.body as {
    messages?: { role: string; content: string }[];
  };

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const fullMessages = [
    { role: "system", content: ORACULO_SYSTEM },
    ...(messages ?? []),
  ];

  await streamGroqResponse(fullMessages, (chunk, done, error) => {
    if (error) {
      res.write(`data: ${JSON.stringify({ error, done: true })}\n\n`);
    } else if (!done) {
      res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
    } else {
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    }
  });

  res.end();
});

export { ORACULO_SYSTEM, streamGroqResponse };
export default router;
