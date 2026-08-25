// Síntese de fala (text-to-speech).
//
// Dia a dia: OpenAI TTS — boa qualidade e bem barato (escolha do Yuri: misturar,
// caro só em momentos especiais). ElevenLabs (premium) continua reservado pro
// vídeo talking-head; aqui é só a voz que fala as respostas e lê a Ágora.
//
// Regra do projeto: todo fetch a provedor externo precisa de timeout, senão trava.

const OPENAI_TTS_URL = "https://api.openai.com/v1/audio/speech";

// Limite de entrada da API da OpenAI é 4096 chars; cortamos antes pra não estourar
// e pra limitar custo/abuso por requisição.
const MAX_TTS_CHARS = 4000;

// Voz neutra (sem gênero marcado) como padrão.
export const DEFAULT_TTS_VOICE = "alloy";
const ALLOWED_VOICES = new Set([
  "alloy", "ash", "ballad", "coral", "echo", "fable",
  "nova", "onyx", "sage", "shimmer", "verse",
]);

export interface TtsResult {
  audio: Buffer;
  contentType: string;
}

export async function synthesizeSpeech(
  text: string,
  voice: string = DEFAULT_TTS_VOICE,
): Promise<TtsResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY ausente");

  const clean = (text || "").trim().slice(0, MAX_TTS_CHARS);
  if (!clean) throw new Error("texto vazio");

  const safeVoice = ALLOWED_VOICES.has(voice) ? voice : DEFAULT_TTS_VOICE;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(OPENAI_TTS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini-tts",
        voice: safeVoice,
        input: clean,
        response_format: "mp3",
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`OpenAI TTS ${res.status}: ${detail.slice(0, 200)}`);
    }
    const arrayBuf = await res.arrayBuffer();
    return { audio: Buffer.from(arrayBuf), contentType: "audio/mpeg" };
  } finally {
    clearTimeout(timeout);
  }
}
