/**
 * Curadoria do vídeo simbólico — as vozes da Ágora escolhem UM trecho do PERFEITO
 * pra virar o vídeo (em vez de narrar o texto inteiro, que ficava longo demais e dava
 * erro) e deixam um comentário curto sobre a escolha.
 *
 * Roda em background, depois do PERFEITO, só quando o vídeo está ligado. Nunca lança:
 * se a curadoria falhar, devolve um trecho-fallback (começo do PERFEITO até o teto) pra
 * o vídeo sair mesmo assim.
 */

import { anthropic } from "@workspace/integrations-anthropic-ai";
import { openai } from "@workspace/integrations-openai-ai-server";
import { fetchGroqChat } from "./lib/groq-retry";

export interface VideoComentario {
  voice: string;
  comment: string;
}

export interface VideoCuradoria {
  excerpt: string;
  comments: VideoComentario[];
}

// Teto do trecho narrado. TTS em PT fala ~14 chars/s, então ~1500 chars ≈ ~1min45.
// Curto o bastante pra a render não estourar tempo/tamanho em produção.
const MAX_EXCERPT_CHARS = 1500;

// Teto do documento mandado pras vozes (guarda de custo/latência/limite de contexto).
// PERFEITO típico cabe folgado; só corta caudas em casos extremos.
const MAX_DOC_CHARS = 14000;

// Mantém só os primeiros parágrafos que cabem no teto do documento.
function capParagraphs(paras: string[], cap: number): string[] {
  const out: string[] = [];
  let total = 0;
  for (const p of paras) {
    total += p.length + 2;
    if (total > cap && out.length > 0) break;
    out.push(p);
  }
  return out;
}

function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

// Corta no fim de frase mais próximo antes do teto (senão corte seco no teto).
function truncateToCap(text: string, cap: number): string {
  if (text.length <= cap) return text;
  const head = text.slice(0, cap);
  const lastStop = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "));
  if (lastStop > cap * 0.5) return head.slice(0, lastStop + 1).trim();
  return head.trim();
}

interface Pick {
  paragrafos: number[];
  comentario: string;
}

function normNums(value: unknown, nParas: number): number[] {
  const arr = Array.isArray(value) ? value : [];
  return arr
    .map((x) => (typeof x === "number" ? x : parseInt(String(x), 10)))
    .filter((nn) => Number.isFinite(nn) && nn >= 1 && nn <= nParas);
}

// Último recurso quando o JSON não parseia: extrai os campos por regex. O `comentario`
// é texto livre (frase com aspas/quebras), o que quebra JSON.parse com frequência nas
// IAs grátis — sem este fallback a voz cairia fora à toa.
function parsePickByFields(text: string, nParas: number): Pick | null {
  const parasMatch = text.match(/"?paragrafos"?\s*:\s*\[([^\]]*)\]/i);
  const nums = parasMatch ? normNums(parasMatch[1].split(","), nParas) : [];
  const comMatch = text.match(/"?coment[aá]rio"?\s*:\s*"([\s\S]*?)"\s*(?:[},]|$)/i);
  const comentario = comMatch ? comMatch[1].trim() : "";
  if (nums.length === 0 && !comentario) return null;
  return { paragrafos: nums, comentario };
}

function parsePick(text: string, nParas: number): Pick | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return parsePickByFields(text, nParas);

  const tryParse = (s: string): Pick | null => {
    try {
      const parsed = JSON.parse(s) as { paragrafos?: unknown; comentario?: unknown };
      const nums = normNums(parsed.paragrafos, nParas);
      const comentario = typeof parsed.comentario === "string" ? parsed.comentario.trim() : "";
      if (nums.length === 0 && !comentario) return null;
      return { paragrafos: nums, comentario };
    } catch {
      return null;
    }
  };

  // estrito → saneado (remove vírgulas penduradas) → extração por campo.
  const raw = match[0];
  const sanitized = raw.replace(/,\s*([}\]])/g, "$1");
  return tryParse(raw) ?? tryParse(sanitized) ?? parsePickByFields(text, nParas);
}

function buildPrompt(topic: string, paragraphs: string[]): string {
  const numbered = paragraphs.map((p, i) => `[${i + 1}] ${p}`).join("\n\n");
  return (
    `O texto abaixo é o PERFEITO de uma deliberação sobre "${topic}". Ele vai virar um ` +
    `vídeo curto narrado — então escolha só UM trecho marcante, não o texto inteiro.\n\n` +
    `PERFEITO (parágrafos numerados):\n\n${numbered}\n\n` +
    `Escolha o trecho mais forte e representativo pro vídeo: um bloco CONTÍNUO de 1 a 3 ` +
    `parágrafos (no máximo ~1 a 2 minutos de fala). Deixe também um comentário curto, de ` +
    `uma frase, sobre por que esse trecho.\n` +
    `Retorne SOMENTE JSON, sem texto fora dele:\n` +
    `{"paragrafos":[2,3],"comentario":"sua frase aqui"}`
  );
}

async function pickClaude(prompt: string, n: number): Promise<Pick | null> {
  try {
    const r = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 400,
      messages: [{ role: "user", content: prompt }],
    });
    const t = r.content[0]?.type === "text" ? r.content[0].text : "";
    return parsePick(t, n);
  } catch {
    return null;
  }
}

async function pickChatGPT(prompt: string, n: number): Promise<Pick | null> {
  try {
    const c = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_completion_tokens: 400,
      messages: [{ role: "user", content: prompt }],
    });
    return parsePick(c.choices[0]?.message?.content ?? "", n);
  } catch {
    return null;
  }
}

async function pickGroq(prompt: string, n: number, temperature?: number): Promise<Pick | null> {
  try {
    if (!process.env.GROQ_API_KEY) return null;
    const resp = await fetchGroqChat(
      {
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 400,
        ...(temperature !== undefined ? { temperature } : {}),
      },
      "video-curadoria.ts",
    );
    if (!resp.ok) return null;
    const data = (await resp.json()) as { choices?: { message?: { content?: string } }[] };
    return parsePick(data.choices?.[0]?.message?.content ?? "", n);
  } catch {
    return null;
  }
}

// Janela contígua de parágrafos que maximiza os votos cabendo no teto de chars.
// Sem votos (todos 0), cai nos primeiros parágrafos que couberem — fallback natural.
function pickExcerpt(paragraphs: string[], voteCount: number[], cap: number): string {
  let best = { score: -1, start: 0, end: 0 };
  for (let i = 0; i < paragraphs.length; i++) {
    let len = 0;
    let score = 0;
    for (let j = i; j < paragraphs.length; j++) {
      len += paragraphs[j].length + (j > i ? 2 : 0);
      if (len > cap && j > i) break;
      score += voteCount[j];
      const span = j - i;
      const bestSpan = best.end - best.start;
      if (score > best.score || (score === best.score && span < bestSpan)) {
        best = { score, start: i, end: j };
      }
      if (len > cap) break;
    }
  }
  const excerpt = paragraphs.slice(best.start, best.end + 1).join("\n\n");
  return truncateToCap(excerpt, cap);
}

export async function curarTrechoVideo(topic: string, perfeitoText: string): Promise<VideoCuradoria> {
  const paragraphs = splitParagraphs(perfeitoText);
  if (paragraphs.length === 0) {
    return { excerpt: truncateToCap(perfeitoText.trim(), MAX_EXCERPT_CHARS), comments: [] };
  }

  // Limita o que vai pras vozes (e o que pode ser escolhido) — guarda de custo/contexto.
  const docParas = capParagraphs(paragraphs, MAX_DOC_CHARS);
  const prompt = buildPrompt(topic, docParas);
  const n = docParas.length;
  const voices: { voice: string; run: () => Promise<Pick | null> }[] = [
    { voice: "Claude", run: () => pickClaude(prompt, n) },
    { voice: "ChatGPT", run: () => pickChatGPT(prompt, n) },
    { voice: "Gemini", run: () => pickGroq(prompt, n) },
    { voice: "Grok", run: () => pickGroq(prompt, n) },
    { voice: "Meta", run: () => pickGroq(prompt, n, 0.3) },
  ];

  const settled = await Promise.allSettled(voices.map((v) => v.run()));

  const voteCount = new Array(docParas.length).fill(0);
  const comments: VideoComentario[] = [];
  settled.forEach((res, idx) => {
    if (res.status !== "fulfilled" || !res.value) return;
    const pick = res.value;
    for (const p of pick.paragrafos) voteCount[p - 1] += 1;
    if (pick.comentario) comments.push({ voice: voices[idx].voice, comment: pick.comentario });
  });

  // Sem nenhum voto válido: cai no começo do PERFEITO (até o teto), em vez de um
  // parágrafo solto. Com votos: janela contígua de maior apoio.
  const totalVotes = voteCount.reduce((a, b) => a + b, 0);
  const excerpt =
    totalVotes > 0
      ? pickExcerpt(docParas, voteCount, MAX_EXCERPT_CHARS)
      : truncateToCap(docParas.join("\n\n"), MAX_EXCERPT_CHARS);
  const finalExcerpt = excerpt.trim().length > 0
    ? excerpt
    : truncateToCap(perfeitoText.trim(), MAX_EXCERPT_CHARS);

  console.log(
    `[CuradoriaVídeo] "${topic.slice(0, 50)}" — ${comments.length} comentário(s), ` +
      `trecho ${finalExcerpt.length} chars de ${perfeitoText.length}`,
  );

  return { excerpt: finalExcerpt, comments };
}
