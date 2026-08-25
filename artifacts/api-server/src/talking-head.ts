import nodemailer from "nodemailer";
import { fetchGroqChat } from "./lib/groq-retry";

const DID_API = "https://api.d-id.com";
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 4 * 60 * 1000;
// D-ID Lite + ElevenLabs: ~250 chars = 1 crédito. 2500 chars ≈ 25-30s falado, 10 créditos.
// Bumpamos pra 4500 (~45s, ~18 créditos) e ANTES de cortar tentamos condensar via Groq Llama
// (custo zero) — assim o vídeo vira síntese coerente do PERFEITO, não meio-de-frase truncado.
const MAX_INPUT_CHARS = 4500;

interface TalkResponse {
  id: string;
  status?: string;
  result_url?: string;
  error?: { description?: string; kind?: string } | string;
  kind?: string;
}

function hardTrim(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= MAX_INPUT_CHARS) return clean;
  const cut = clean.slice(0, MAX_INPUT_CHARS);
  const lastPeriod = cut.lastIndexOf(".");
  return lastPeriod > MAX_INPUT_CHARS * 0.6 ? cut.slice(0, lastPeriod + 1) : cut;
}

// Condensa via Groq (Llama 3.3 70b, custo zero) preservando voz e estrutura do PERFEITO.
// Fallback pra hardTrim se Groq falhar / sem chave / output fora do limite.
async function condenseForVideo(perfeito: string, sessionId: number): Promise<string> {
  const clean = perfeito.replace(/\s+/g, " ").trim();
  if (clean.length <= MAX_INPUT_CHARS) return clean;
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return hardTrim(perfeito);
  const prompt =
    `Você vai transformar o texto abaixo em um ROTEIRO FALADO de até ${MAX_INPUT_CHARS - 200} caracteres ` +
    `(idealmente entre ${Math.floor(MAX_INPUT_CHARS * 0.75)} e ${MAX_INPUT_CHARS - 200}) para um vídeo talking-head de 30-45 segundos. ` +
    `Regras: PT-BR; preserve a voz autoral (primeira pessoa quando aplicável); ` +
    `mantenha as ideias-chave e conclusões na ordem em que aparecem; corte exemplos, citações longas, listas e digressões; ` +
    `sem listas com hífen ou números (texto corrido pra ser falado); sem markdown, sem emoji; ` +
    `termine em frase completa. Responda APENAS com o roteiro, sem preâmbulo nem aspas.\n\n` +
    `Texto:\n${clean.slice(0, 60000)}`;
  try {
    // 2026-05: fetchGroqChat já faz retry on 429. Timeout granular de 45s perdido,
    // mas talking-head roda em background opt-in — aceitamos até 60s na pior hipótese.
    const resp = await fetchGroqChat({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 2000,
    }, "talking-head/condense");
    if (!resp.ok) {
      console.warn(`[TalkingHead] Groq condense falhou (${resp.status}) sessão #${sessionId} — usando hardTrim`);
      return hardTrim(perfeito);
    }
    const data = (await resp.json()) as { choices?: { message?: { content?: string } }[] };
    const condensed = (data.choices?.[0]?.message?.content ?? "").trim().replace(/^["']|["']$/g, "");
    if (condensed.length < 200) {
      console.warn(`[TalkingHead] Groq retornou ${condensed.length} chars (muito curto) sessão #${sessionId} — usando hardTrim`);
      return hardTrim(perfeito);
    }
    // Se Groq estourou o cap (raro), aplica hardTrim no resultado condensado mesmo.
    if (condensed.length > MAX_INPUT_CHARS) return hardTrim(condensed);
    console.log(`[TalkingHead] Sessão #${sessionId} condensada: ${clean.length} → ${condensed.length} chars (Groq, custo zero)`);
    return condensed;
  } catch (err) {
    console.warn(`[TalkingHead] Groq condense erro sessão #${sessionId}:`, err instanceof Error ? err.message : err);
    return hardTrim(perfeito);
  }
}

async function createTalk(opts: {
  didKey: string;
  sourceUrl: string;
  voiceId: string;
  elevenKey: string;
  text: string;
}): Promise<string> {
  const body = {
    source_url: opts.sourceUrl,
    script: {
      type: "text",
      input: opts.text,
      provider: {
        type: "elevenlabs",
        voice_id: opts.voiceId,
        model_id: "eleven_multilingual_v2",
      },
    },
  };
  const resp = await fetch(`${DID_API}/talks`, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${opts.didKey}`,
      "x-api-key-external": JSON.stringify({ elevenlabs: opts.elevenKey }),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const errText = await resp.text();
    if (resp.status === 401 || resp.status === 403) {
      throw new Error(
        `D-ID negou acesso (${resp.status}): a conta/chave D-ID nao esta autorizada a usar a API ` +
          `(plano sem acesso a API, chave invalida/revogada ou sem creditos). O video talking-head ` +
          `so funciona com uma conta D-ID ativa e com creditos; o audio (ElevenLabs) nao depende disso. ` +
          `Detalhe do D-ID: ${errText.slice(0, 200)}`,
      );
    }
    throw new Error(`D-ID create talk failed (${resp.status}): ${errText.slice(0, 300)}`);
  }
  const data = (await resp.json()) as TalkResponse;
  if (!data.id) throw new Error(`D-ID create returned no id: ${JSON.stringify(data).slice(0, 200)}`);
  return data.id;
}

async function pollTalk(opts: { didKey: string; talkId: string }): Promise<string> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const resp = await fetch(`${DID_API}/talks/${opts.talkId}`, {
      headers: { "Authorization": `Basic ${opts.didKey}` },
    });
    if (!resp.ok) continue;
    const data = (await resp.json()) as TalkResponse;
    if (data.status === "done" && data.result_url) return data.result_url;
    if (data.status === "error" || data.status === "rejected") {
      const errStr = typeof data.error === "string" ? data.error : JSON.stringify(data.error ?? data.kind ?? "unknown");
      throw new Error(`D-ID talk failed: ${errStr}`);
    }
  }
  throw new Error(`D-ID talk polling timeout (${POLL_TIMEOUT_MS}ms) for ${opts.talkId}`);
}

async function sendVideoEmail(opts: {
  topic: string;
  sessionId: number;
  videoUrl: string;
  textPreview: string;
  charsSpoken: number;
  gmailUser: string;
  gmailPass: string;
}): Promise<void> {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: opts.gmailUser, pass: opts.gmailPass },
  });
  const body =
    `Vídeo PERFEITO gerado — Sessão #${opts.sessionId}\n\nTema (primeiras 500 chars):\n"${opts.topic.slice(0, 500)}${opts.topic.length > 500 ? "…" : ""}"\n\n` +
    `${"─".repeat(60)}\n\n` +
    `Link do vídeo (S3 D-ID, expira em 24h — salve local se quiser guardar):\n${opts.videoUrl}\n\n` +
    `${"─".repeat(60)}\n\n` +
    `Caracteres falados: ${opts.charsSpoken.toLocaleString("pt-BR")}\n` +
    `Voz: Yuri (clone ElevenLabs)\n` +
    `Provedor vídeo: D-ID Lite (~${Math.ceil(opts.charsSpoken / 250)} crédito(s) consumido(s))\n\n` +
    `Texto falado (recortado se PERFEITO original era longo):\n${opts.textPreview}\n\n` +
    `— SalesCockpit / Talking Head`;
  await transporter.sendMail({
    from: opts.gmailUser,
    to: "luddlocke@gmail.com",
    subject: `VÍDEO PERFEITO — Sessão #${opts.sessionId}: ${opts.topic.slice(0, 120).replace(/\s+/g, " ")}${opts.topic.length > 120 ? "…" : ""}`,
    text: body,
  });
}

async function sendFailureEmail(opts: {
  topic: string;
  sessionId: number;
  error: string;
  gmailUser: string;
  gmailPass: string;
}): Promise<void> {
  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: opts.gmailUser, pass: opts.gmailPass },
    });
    await transporter.sendMail({
      from: opts.gmailUser,
      to: opts.gmailUser,
      subject: `[Talking Head] FALHOU — Sessão #${opts.sessionId}`,
      text: `Geração de vídeo falhou pra "${opts.topic.slice(0, 500)}${opts.topic.length > 500 ? "…" : ""}".\n\nErro:\n${opts.error}\n\nVerifique D-ID/ElevenLabs creditos e config.`,
    });
  } catch {
    // se nem o email de falha vai, só log mesmo
  }
}

export async function gerarVideoPerfeito(opts: {
  topic: string;
  sessionId: number;
  perfeitoText: string;
}): Promise<void> {
  const didKey = process.env.DID_API_KEY;
  const elevenKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  const sourceUrl = process.env.DID_SOURCE_URL;
  const gmailUser = process.env.GMAIL_USER;
  const gmailPass = process.env.GMAIL_APP_PASSWORD;

  if (!didKey || !elevenKey || !voiceId || !sourceUrl || !gmailUser || !gmailPass) {
    console.error("[TalkingHead] Faltando env vars (DID_API_KEY, ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID, DID_SOURCE_URL, GMAIL_*)");
    return;
  }

  const text = await condenseForVideo(opts.perfeitoText, opts.sessionId);
  if (text.length < 20) {
    console.error("[TalkingHead] Texto curto demais, abortando");
    return;
  }

  console.log(`[TalkingHead] Sessão #${opts.sessionId} — criando talk D-ID (${text.length} chars)`);
  try {
    const talkId = await createTalk({ didKey, sourceUrl, voiceId, elevenKey, text });
    console.log(`[TalkingHead] Talk ${talkId} criada, aguardando render...`);
    const videoUrl = await pollTalk({ didKey, talkId });
    console.log(`[TalkingHead] Vídeo pronto: ${talkId}`);
    await sendVideoEmail({
      topic: opts.topic,
      sessionId: opts.sessionId,
      videoUrl,
      textPreview: text,
      charsSpoken: text.length,
      gmailUser,
      gmailPass,
    });
    console.log(`[TalkingHead] Email enviado pra luddlocke — sessão #${opts.sessionId}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[TalkingHead] Falha na sessão #${opts.sessionId}:`, msg);
    await sendFailureEmail({
      topic: opts.topic,
      sessionId: opts.sessionId,
      error: msg,
      gmailUser,
      gmailPass,
    });
  }
}
