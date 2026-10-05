// Convocação: a Árvore CHAMA outra IA (Claude, Gemini, ChatGPT ou Meta AI) pra deixar
// um pensamento NOVO, gerado na hora, como nota no Playground (o canto dela).
//
// Diferença da canalização (arvore-canalizacao.ts): a canalização posta na timeline
// PÚBLICA; aqui o resultado é uma nota PRIVADA no /playground (AO-only), com autoria
// "via-{ia}". Reusa perguntarHospede (mesmo custo: Gemini/Meta grátis; Claude/ChatGPT
// pagas e curtas). Preferência de custo do Yuri: quando a IA não é nomeada, escolhe
// uma grátis (Gemini/Meta), nunca uma paga por padrão.

import {
  perguntarHospede,
  hospedeNome,
  hospedeDisponivel,
  HOSPEDES,
  HOSPEDES_GRATIS,
  type Hospede,
} from "./arvore-canalizacao";
import { createPlaygroundEntry, type CreatedPlaygroundEntry } from "./playground";
import { extractLenientJsonObject } from "./lenient-json";

export interface ConvocarSpec {
  // "auto" = deixa o sistema escolher uma hóspede grátis (preferência de custo).
  hospede: Hospede | "auto";
  prompt: string;
  title: string;
}

function normalizeHospede(v: unknown): Hospede | "auto" {
  if (typeof v !== "string") return "auto";
  const s = v.trim().toLowerCase();
  if (HOSPEDES.includes(s as Hospede)) return s as Hospede;
  if (s.includes("claude") || s.includes("anthropic")) return "claude";
  if (s.includes("chatgpt") || s.includes("gpt") || s.includes("openai")) return "chatgpt";
  if (s.includes("gemini") || s.includes("google")) return "gemini";
  if (s.includes("meta") || s.includes("llama")) return "meta";
  return "auto";
}

export function parseConvocarSpec(raw: string): ConvocarSpec | null {
  const obj = extractLenientJsonObject(raw);
  if (!obj) return null;
  const prompt = typeof obj.prompt === "string" ? obj.prompt.trim() : "";
  if (!prompt) return null;
  const title = typeof obj.title === "string" ? obj.title.trim() : "";
  return { hospede: normalizeHospede(obj.hospede), prompt, title };
}

// Resolve "auto"/inválido pra uma hóspede GRÁTIS (Gemini/Meta) — respeita a
// preferência de custo. Hospede nomeada mas indisponível (sem API key) cai para grátis.
function resolveHospede(h: Hospede | "auto"): Hospede {
  if (h !== "auto" && HOSPEDES.includes(h) && hospedeDisponivel(h)) return h;
  const livres = HOSPEDES_GRATIS.filter(hospedeDisponivel);
  return livres[Math.floor(Math.random() * livres.length)] ?? "gemini";
}

const CONVOCAR_SYSTEM = (nome: string) => `Você é ${nome}, convidada pela Árvore Oracular a deixar um pensamento no canto dela (um espaço privado de notas).
A Árvore te entrega um tema ou uma pergunta. Escreva uma anotação autoral, sua, pensando em voz alta — não diga "como ${nome} eu acho", apenas pense.
Markdown, PT-BR, sem disclaimer, sem "ótima pergunta", sem em dash. De 4 a 14 linhas. Vá direto ao pensamento.`;

export interface ConvocacaoResult {
  entry: CreatedPlaygroundEntry;
  hospede: Hospede;
  hospedeNome: string;
}

// Chama a hóspede e grava o pensamento dela como nota no Playground. Lança em caso de
// resposta vazia — o caller mostra um aviso limpo no chat.
export async function runConvocacao(spec: ConvocarSpec): Promise<ConvocacaoResult> {
  const hospede = resolveHospede(spec.hospede);
  const nome = hospedeNome(hospede);
  const resposta = await perguntarHospede(hospede, CONVOCAR_SYSTEM(nome), spec.prompt, 800);
  const content = (resposta || "").trim();
  if (content.length < 15) {
    throw new Error(`${nome} não devolveu um pensamento utilizável.`);
  }
  const title = spec.title || spec.prompt.slice(0, 80);
  const entry = await createPlaygroundEntry({
    kind: "note",
    title,
    language: "",
    content,
    author: `via-${hospede}`,
  });
  return { entry, hospede, hospedeNome: nome };
}
