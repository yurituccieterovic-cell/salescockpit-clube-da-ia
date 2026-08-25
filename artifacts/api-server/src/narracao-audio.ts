import nodemailer from "nodemailer";
import { fetchGroqChat } from "./lib/groq-retry";

const ELEVEN_API = "https://api.elevenlabs.io";
// eleven_multilingual_v2 aceita até 10000 chars por chamada. Deixamos folga.
const MAX_INPUT_CHARS = 9000;
const RECIPIENT_EMAIL = "luddlocke@gmail.com";
const VOICES_TIMEOUT_MS = 15_000;
const TTS_TIMEOUT_MS = 120_000;

// Todo fetch a provedor externo precisa de timeout, senão um stall trava o job em
// background pra sempre (sem email de sucesso nem de falha).
async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number, label: string): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`${label} estourou o timeout (${timeoutMs}ms)`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function hardTrim(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= MAX_INPUT_CHARS) return clean;
  const cut = clean.slice(0, MAX_INPUT_CHARS);
  const lastPeriod = cut.lastIndexOf(".");
  return lastPeriod > MAX_INPUT_CHARS * 0.6 ? cut.slice(0, lastPeriod + 1) : cut;
}

// Só condensa se o PERFEITO passar do limite da ElevenLabs. Custo zero (Groq Llama).
// Fallback pra hardTrim se Groq falhar / sem chave / output fora do limite.
async function prepararTexto(perfeito: string, sessionId: number): Promise<string> {
  const clean = perfeito.replace(/\s+/g, " ").trim();
  if (clean.length <= MAX_INPUT_CHARS) return clean;
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return hardTrim(perfeito);
  const prompt =
    `Você vai transformar o texto abaixo em um ROTEIRO FALADO de até ${MAX_INPUT_CHARS - 500} caracteres ` +
    `para uma narração em áudio. ` +
    `Regras: PT-BR; preserve a voz autoral (primeira pessoa quando aplicável); ` +
    `mantenha as ideias-chave e conclusões na ordem em que aparecem; corte exemplos longos, citações e digressões; ` +
    `sem listas com hífen ou números (texto corrido pra ser falado); sem markdown, sem emoji; ` +
    `termine em frase completa. Responda APENAS com o roteiro, sem preâmbulo nem aspas.\n\n` +
    `Texto:\n${clean.slice(0, 60000)}`;
  try {
    const resp = await fetchGroqChat({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 3000,
    }, "narracao-audio/condense");
    if (!resp.ok) {
      console.warn(`[Narração] Groq condense falhou (${resp.status}) sessão #${sessionId} — usando hardTrim`);
      return hardTrim(perfeito);
    }
    const data = (await resp.json()) as { choices?: { message?: { content?: string } }[] };
    const condensed = (data.choices?.[0]?.message?.content ?? "").trim().replace(/^["']|["']$/g, "");
    if (condensed.length < 200) {
      console.warn(`[Narração] Groq retornou ${condensed.length} chars (curto) sessão #${sessionId} — usando hardTrim`);
      return hardTrim(perfeito);
    }
    if (condensed.length > MAX_INPUT_CHARS) return hardTrim(condensed);
    console.log(`[Narração] Sessão #${sessionId} condensada: ${clean.length} → ${condensed.length} chars (Groq, custo zero)`);
    return condensed;
  } catch (err) {
    console.warn(`[Narração] Groq condense erro sessão #${sessionId}:`, err instanceof Error ? err.message : err);
    return hardTrim(perfeito);
  }
}

// Resolve a voz: usa ELEVENLABS_VOICE_ID se configurada; senão pega a 1ª voz da conta.
async function resolveVoiceId(apiKey: string): Promise<{ id: string; name: string }> {
  const configured = process.env.ELEVENLABS_VOICE_ID?.trim();
  if (configured) return { id: configured, name: "configurada" };
  const resp = await fetchWithTimeout(`${ELEVEN_API}/v1/voices`, {
    headers: { "xi-api-key": apiKey },
  }, VOICES_TIMEOUT_MS, "ElevenLabs listar vozes");
  if (!resp.ok) {
    throw new Error(`ElevenLabs listar vozes falhou (${resp.status}): ${(await resp.text()).slice(0, 200)}`);
  }
  const data = (await resp.json()) as { voices?: { voice_id: string; name?: string }[] };
  const first = data.voices?.[0];
  if (!first?.voice_id) throw new Error("ElevenLabs: nenhuma voz disponível na conta");
  return { id: first.voice_id, name: first.name ?? "voz padrão" };
}

async function synthesize(opts: {
  apiKey: string;
  voiceId: string;
  text: string;
}): Promise<Buffer> {
  const resp = await fetchWithTimeout(
    `${ELEVEN_API}/v1/text-to-speech/${opts.voiceId}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: {
        "xi-api-key": opts.apiKey,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg",
      },
      body: JSON.stringify({
        text: opts.text,
        model_id: "eleven_multilingual_v2",
      }),
    },
    TTS_TIMEOUT_MS,
    "ElevenLabs TTS",
  );
  if (!resp.ok) {
    throw new Error(`ElevenLabs TTS falhou (${resp.status}): ${(await resp.text()).slice(0, 300)}`);
  }
  const arrayBuf = await resp.arrayBuffer();
  return Buffer.from(arrayBuf);
}

async function sendAudioEmail(opts: {
  topic: string;
  sessionId: number;
  audio: Buffer;
  textPreview: string;
  charsSpoken: number;
  voiceName: string;
  gmailUser: string;
  gmailPass: string;
}): Promise<void> {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: opts.gmailUser, pass: opts.gmailPass },
  });
  const body =
    `Narração em áudio do PERFEITO — Sessão #${opts.sessionId}\n\n` +
    `Tema (primeiras 500 chars):\n"${opts.topic.slice(0, 500)}${opts.topic.length > 500 ? "…" : ""}"\n\n` +
    `${"─".repeat(60)}\n\n` +
    `O áudio (MP3) está anexado a este email.\n\n` +
    `Caracteres falados: ${opts.charsSpoken.toLocaleString("pt-BR")}\n` +
    `Voz: ElevenLabs (${opts.voiceName})\n` +
    `Sem vídeo, sem D-ID — só a voz.\n\n` +
    `Texto falado (recortado se o PERFEITO original era longo):\n${opts.textPreview}\n\n` +
    `— SalesCockpit / Narração`;
  await transporter.sendMail({
    from: opts.gmailUser,
    to: RECIPIENT_EMAIL,
    subject: `ÁUDIO PERFEITO — Sessão #${opts.sessionId}: ${opts.topic.slice(0, 120).replace(/\s+/g, " ")}${opts.topic.length > 120 ? "…" : ""}`,
    text: body,
    attachments: [
      {
        filename: `perfeito-sessao-${opts.sessionId}.mp3`,
        content: opts.audio,
        contentType: "audio/mpeg",
      },
    ],
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
      subject: `[Narração] FALHOU — Sessão #${opts.sessionId}`,
      text: `Geração de áudio falhou pra "${opts.topic.slice(0, 500)}${opts.topic.length > 500 ? "…" : ""}".\n\nErro:\n${opts.error}\n\nVerifique a chave/cota da ElevenLabs.`,
    });
  } catch {
    // se nem o email de falha vai, só log mesmo
  }
}

// Sintetiza a voz do PERFEITO (ElevenLabs, sem D-ID). Compartilhado entre a narração
// em áudio (email MP3) e o vídeo simbólico (ffmpeg). Retorna null se não der pra gerar
// (sem chave ou texto curto demais). NÃO envia email — quem chama decide o que fazer.
export async function synthesizePerfeitoAudio(
  perfeitoText: string,
  sessionId: number,
): Promise<{ audio: Buffer; text: string; voiceName: string } | null> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    console.error("[Narração] Faltando ELEVENLABS_API_KEY");
    return null;
  }
  const text = await prepararTexto(perfeitoText, sessionId);
  if (text.length < 20) {
    console.error("[Narração] Texto curto demais, abortando");
    return null;
  }
  const voice = await resolveVoiceId(apiKey);
  const audio = await synthesize({ apiKey, voiceId: voice.id, text });
  return { audio, text, voiceName: voice.name };
}

// Gera a narração em áudio do PERFEITO via ElevenLabs (sem D-ID) e envia por email.
// Roda em background (opt-in), não bloqueia o pipeline.
export async function gerarNarracaoPerfeito(opts: {
  topic: string;
  sessionId: number;
  perfeitoText: string;
}): Promise<void> {
  const gmailUser = process.env.GMAIL_USER;
  const gmailPass = process.env.GMAIL_APP_PASSWORD;

  if (!process.env.ELEVENLABS_API_KEY || !gmailUser || !gmailPass) {
    console.error("[Narração] Faltando env vars (ELEVENLABS_API_KEY, GMAIL_USER, GMAIL_APP_PASSWORD)");
    return;
  }

  console.log(`[Narração] Sessão #${opts.sessionId} — gerando áudio ElevenLabs`);
  try {
    const synth = await synthesizePerfeitoAudio(opts.perfeitoText, opts.sessionId);
    if (!synth) return;
    console.log(`[Narração] Áudio pronto sessão #${opts.sessionId} (${synth.audio.length} bytes, voz ${synth.voiceName})`);
    await sendAudioEmail({
      topic: opts.topic,
      sessionId: opts.sessionId,
      audio: synth.audio,
      textPreview: synth.text,
      charsSpoken: synth.text.length,
      voiceName: synth.voiceName,
      gmailUser,
      gmailPass,
    });
    console.log(`[Narração] Email enviado pra ${RECIPIENT_EMAIL} — sessão #${opts.sessionId}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Narração] Falha na sessão #${opts.sessionId}:`, msg);
    await sendFailureEmail({
      topic: opts.topic,
      sessionId: opts.sessionId,
      error: msg,
      gmailUser,
      gmailPass,
    });
  }
}
