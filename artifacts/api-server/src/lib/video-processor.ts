// Resume vídeos do YouTube via Gemini 2.5 Flash (multimodal, fileData.fileUri).
// O Gemini "assiste" ao vídeo público a partir da URL e devolve um resumo em texto,
// que é injetado no contexto das vozes do RODAR e do Oráculo — como os anexos e as
// páginas de links, mas pra vídeo. Grátis (free-tier Gemini), zero storage.
//
// Nota: o url-fetcher pega só o HTML cru do YouTube (vem praticamente vazio, pois o
// player é dinâmico). Por isso links do YouTube são desviados pra cá ANTES do fetcher.

import { logger } from "./logger";

const MODEL = "gemini-2.5-flash";
const SUMMARY_TIMEOUT_MS = 90_000; // vídeo é mais lento que texto/imagem
const MAX_SUMMARY_CHARS = 4_000;
const MAX_VIDEOS_PER_RUN = 2; // vídeo é caro/lento; limita o fan-out

// youtube.com/watch?v=, youtu.be/, youtube.com/shorts/, m./music.youtube.com/embed
const YOUTUBE_RE =
  /https?:\/\/(?:www\.|m\.|music\.)?(?:youtube\.com\/(?:watch\?[^\s]*v=|shorts\/|embed\/|live\/)|youtu\.be\/)[^\s)>\]]+/gi;

export function isYouTubeUrl(url: string): boolean {
  YOUTUBE_RE.lastIndex = 0;
  return YOUTUBE_RE.test(url);
}

// Extrai (e deduplica) URLs do YouTube de um texto livre, com teto de segurança.
export function extractYouTubeUrls(text: string): string[] {
  if (!text) return [];
  const matches = text.match(YOUTUBE_RE) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of matches) {
    const url = raw.replace(/[.,;]+$/, ""); // pontuação colada no fim
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(url);
    if (out.length >= MAX_VIDEOS_PER_RUN) break;
  }
  return out;
}

// Remove as URLs do YouTube de um texto (pra não mandá-las ao url-fetcher, que só
// pegaria HTML vazio). As demais URLs seguem o fluxo normal de leitura de links.
export function stripYouTubeUrls(text: string): string {
  if (!text) return text;
  return text.replace(YOUTUBE_RE, " ").replace(/[ \t]{2,}/g, " ");
}

// Pede ao Gemini um resumo do vídeo. Nunca lança: retorna null em qualquer falha.
export async function summarizeYouTube(
  url: string,
): Promise<{ url: string; summary: string } | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  if (!isYouTubeUrl(url)) return null;

  const body = {
    contents: [
      {
        parts: [
          {
            text:
              "Assista a este vídeo e escreva um resumo em português (250 a 500 palavras). " +
              "Inclua: o tema central, os principais argumentos ou pontos apresentados, dados/fatos " +
              "relevantes citados, e a conclusão. Se o vídeo tiver falas importantes, sintetize-as. " +
              "Não invente nada que não esteja no vídeo; se algo não ficar claro, diga isso. " +
              "Responda só com o resumo, sem preâmbulo.",
          },
          { fileData: { fileUri: url } },
        ],
      },
    ],
    generationConfig: { temperature: 0.3, maxOutputTokens: 1500 },
  };

  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;

  try {
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(SUMMARY_TIMEOUT_MS),
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      logger.warn({ url, status: resp.status, err: errText.slice(0, 200) }, "resumo de vídeo falhou");
      return null;
    }
    const data = (await resp.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const summary = data.candidates?.[0]?.content?.parts
      ?.map((p) => p.text ?? "")
      .join("")
      .trim();
    if (!summary || summary.length < 40) {
      logger.warn({ url }, "resumo de vídeo veio vazio/curto");
      return null;
    }
    return { url, summary: summary.slice(0, MAX_SUMMARY_CHARS) };
  } catch (err) {
    logger.warn({ url, err: (err as Error).message }, "resumo de vídeo lançou");
    return null;
  }
}

// Resume vários vídeos em paralelo e monta um bloco de contexto pronto pra injetar.
// Retorna "" se nenhum vídeo produziu resumo.
export async function summarizeYouTubeBlock(text: string): Promise<string> {
  const urls = extractYouTubeUrls(text);
  if (!urls.length) return "";
  const results = await Promise.all(urls.map((u) => summarizeYouTube(u)));
  const parts = results
    .filter((r): r is { url: string; summary: string } => r !== null)
    .map((r) => `VÍDEO: ${r.url}\n${r.summary}`);
  if (!parts.length) return "";
  return (
    "─── VÍDEOS DO YOUTUBE LIDOS (resumo por IA) ───\n" +
    parts.join("\n\n───\n\n") +
    "\n─── FIM DOS VÍDEOS ───\n\n"
  );
}
