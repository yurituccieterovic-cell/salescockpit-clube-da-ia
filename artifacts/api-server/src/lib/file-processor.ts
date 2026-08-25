// Processa uploads inline (sem persistência): PDF/TXT viram texto puro, imagens
// viram descrição via Gemini 2.5 Flash vision. Texto resultante é injetado nos
// prompts do RODAR e da Árvore. Suporta TODAS as vozes (até as text-only) porque
// o que chega no prompt é sempre string. Zero storage = zero billing extra.

import { logger } from "./logger";

export type ProcessedFile = {
  kind: "text" | "image" | "unsupported";
  name: string;
  size: number;
  text?: string;
  error?: string;
};

const TEXT_MIMES = new Set([
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
  "text/html",
  "text/xml",
  "application/xml",
  "application/javascript",
  "text/javascript",
]);

const IMAGE_MIMES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
]);

// 300k chars ≈ 75k tokens. Claude Sonnet/Opus, GPT-5, Gemini 2.5 aguentam 200k+ tokens
// de contexto. Subir mais que isso começa a ficar caro (mais input tokens por voz × 13 vozes).
const MAX_TEXT_CHARS = 300_000;

// Postgres TEXT rejeita null bytes (\u0000, erro 22P05) e algumas chars de controle quebram parsers
// downstream. PDFs e arquivos binários disfarçados frequentemente vazam esses bytes.
function sanitizeText(s: string): string {
  return s
    .replace(/\u0000/g, "")
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

async function describeImageWithGemini(
  buffer: Buffer,
  mime: string,
  name: string,
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY ausente");
  const base64 = buffer.toString("base64");
  const body = {
    contents: [
      {
        parts: [
          {
            text:
              "Descreva esta imagem em português, de forma detalhada mas concisa (5-15 frases). " +
              "Inclua: o que está visível, texto se houver (transcreva exatamente), contexto provável, " +
              "elementos visuais relevantes (cores, composição, estilo). " +
              "Se for diagrama/captura de tela/screenshot, transcreva todo o texto e descreva a estrutura. " +
              "Não invente nada que não esteja na imagem. Responda só com a descrição, sem preâmbulo.",
          },
          { inlineData: { mimeType: mime, data: base64 } },
        ],
      },
    ],
    generationConfig: { temperature: 0.2, maxOutputTokens: 800 },
  };
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`Gemini vision ${resp.status}: ${errText.slice(0, 200)}`);
  }
  const data = (await resp.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts
    ?.map((p) => p.text ?? "")
    .join("")
    .trim();
  if (!text) throw new Error("Gemini vision retornou vazio");
  return `[Imagem: ${name}]\n${text}`;
}

export async function processFile(args: {
  buffer: Buffer;
  mime: string;
  name: string;
}): Promise<ProcessedFile> {
  const { buffer, mime, name } = args;
  const size = buffer.length;
  const lowerMime = mime.toLowerCase();
  const lowerName = name.toLowerCase();

  try {
    // PDF — pdf-parse
    if (lowerMime === "application/pdf" || lowerName.endsWith(".pdf")) {
      // Import direto do lib/ pra pular o debug mode do index.js (v1.x abre PDF de teste se module.parent é undefined)
      const pdfModule = (await import("pdf-parse/lib/pdf-parse.js")) as unknown as {
        default: (b: Buffer) => Promise<{ text: string }>;
      };
      const parsed = await pdfModule.default(buffer);
      const text = sanitizeText((parsed.text ?? "").trim());
      if (!text) {
        return { kind: "unsupported", name, size, error: "PDF sem texto extraível (talvez imagem escaneada)" };
      }
      return {
        kind: "text",
        name,
        size,
        text: `[PDF: ${name}]\n${text.slice(0, MAX_TEXT_CHARS)}${text.length > MAX_TEXT_CHARS ? "\n[…truncado em 50k chars]" : ""}`,
      };
    }

    // Texto plano
    if (TEXT_MIMES.has(lowerMime) || /\.(md|txt|csv|json|html|xml|js|ts|py)$/i.test(lowerName)) {
      const text = sanitizeText(buffer.toString("utf-8").trim());
      if (!text) {
        return { kind: "unsupported", name, size, error: "Arquivo de texto vazio" };
      }
      return {
        kind: "text",
        name,
        size,
        text: `[Arquivo: ${name}]\n${text.slice(0, MAX_TEXT_CHARS)}${text.length > MAX_TEXT_CHARS ? "\n[…truncado em 50k chars]" : ""}`,
      };
    }

    // Imagem — Gemini vision
    if (IMAGE_MIMES.has(lowerMime) || /\.(jpe?g|png|webp|gif)$/i.test(lowerName)) {
      const normalizedMime = lowerMime === "image/jpg" ? "image/jpeg" : lowerMime;
      const text = await describeImageWithGemini(buffer, normalizedMime, name);
      return { kind: "image", name, size, text };
    }

    return {
      kind: "unsupported",
      name,
      size,
      error: `Tipo não suportado: ${mime}. Aceitamos PDF, TXT/MD/CSV/JSON e imagens (jpg/png/webp/gif).`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, name, mime }, "file-processor failed");
    return { kind: "unsupported", name, size, error: msg };
  }
}
