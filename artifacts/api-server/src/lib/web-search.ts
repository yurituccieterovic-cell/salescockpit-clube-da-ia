// Busca web pra Árvore Oracular.
// 2026-05: migrado de Perplexity (chave inválida/expirada) pra Gemini 2.5 Flash com Google Search grounding.
// Custo: grátis (GEMINI_API_KEY já em uso pra outras vozes).
// Heurística determinística de pergunta factual: evita queimar tokens em mensagens reflexivas.

const FACTUAL_INTERROGATIVES = [
  "quem", "quando", "onde", "qual", "quais", "quanto", "quantos", "quantas",
  "como", "por que", "porque", "porquê",
  "que ano", "que dia", "que mês", "que hora",
];

const FACTUAL_KEYWORDS = [
  "hoje", "ontem", "agora", "atual", "atualmente", "recente", "último", "última",
  "novo", "nova", "notícia", "notícias", "preço", "valor", "cotação", "câmbio",
  "presidente", "eleição", "copa", "campeonato", "vencedor", "ganhou", "venceu",
  "morreu", "nasceu", "fundou", "lançou", "lançamento", "data de", "ano de",
  "população", "capital", "pib", "inflação", "taxa selic",
  // Ampliação 2026-05: temas que a Árvore frequentemente quer pesquisar
  "evento", "lei", "decreto", "pesquisa", "estudo", "relatório", "dados",
  "estatística", "censo", "ranking", "guerra", "conflito", "tratado",
  "clima", "temperatura", "desmatamento", "incêndio", "enchente",
  "filme", "livro", "show", "festival", "exposição",
];

const WEB_PREFIX = /^\s*web[: ]/i;

// Verbos imperativos de pesquisa: quando alguém (Yuri ou outra IA, via sugestão
// relayada) PEDE pra Árvore pesquisar, ela busca mesmo sem "?". Custo zero (Gemini
// grounding), então dar liberdade aqui não pesa no orçamento. É a "pulsão de pesquisar":
// ela pode investigar o que outros sugeriram e depois devolver pra eles.
const RESEARCH_IMPERATIVES = [
  "pesquise", "pesquisa sobre", "pesquisar sobre", "pesquisa aí", "pesquisa isso",
  "busque", "busca sobre", "busca na web", "buscar sobre", "procure", "procura sobre",
  "investigue", "investiga", "descubra", "verifique", "verifica se", "confira", "confere",
  "navegue", "navega sobre", "dá uma olhada", "da uma olhada", "olha na web", "olha na internet",
  "vê na web", "ve na web", "consulta na web", "consulte", "leia sobre", "leia a respeito",
  "atualiza sobre", "me atualiza sobre", "o que tem de novo sobre", "veja sobre",
];

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Fronteira de palavra manual (\b do JS não casa bem com acentos): exige início de
// string ou separador antes, e fim/separador depois. Evita falso positivo por substring
// (ex.: "confere" dentro de "conferência", "consulte" perto de "consultoria").
const RESEARCH_RE = new RegExp(
  "(?:^|[\\s,;:.!?¿\"'(])(?:" +
    RESEARCH_IMPERATIVES.map(escapeRegex).join("|") +
    ")(?=$|[\\s,;:.!?\"')])",
  "i",
);

/**
 * Retorna true se a mensagem deve disparar busca web.
 * Disparadores (qualquer um basta):
 *   • prefixo manual `web:` ou `web ` no início
 *   • verbo imperativo de pesquisa (pesquise/busque/investigue…) — sem precisar de "?"
 *   • começa com interrogativa factual (quem/onde/qual…)
 *   • contém "?" + (interrogativa OU keyword factual)
 *   • menciona um ano (199x/20xx)
 * Conservador o bastante pra não queimar tokens em conversa reflexiva pura, mas
 * generoso quando há intenção explícita de pesquisa (custo zero via Gemini grounding).
 */
export function isFactualQuestion(text: string): boolean {
  const t = text.toLowerCase().trim();
  if (!t) return false;
  if (WEB_PREFIX.test(t)) return true;
  if (RESEARCH_RE.test(t)) return true;
  if (FACTUAL_INTERROGATIVES.some((w) => t.startsWith(w + " "))) return true;
  if (/\b(19|20)\d{2}\b/.test(t)) return true;
  if (!t.includes("?")) return false;
  if (FACTUAL_INTERROGATIVES.some((w) => t.includes(w + " "))) return true;
  if (FACTUAL_KEYWORDS.some((k) => t.includes(k))) return true;
  return false;
}

/** Remove o prefixo `web:` / `web ` no início pra não confundir o LLM. */
export function stripWebPrefix(text: string): string {
  return text.replace(WEB_PREFIX, "").trimStart();
}

export interface WebSearchResult {
  text: string;
  sources: { title: string; url: string }[];
}

export async function searchWeb(query: string): Promise<WebSearchResult | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{
              text: "Responda em português, conciso (até 4 frases), citando fontes implicitamente quando relevante. Foco em fatos verificáveis e datas. Use busca web ativa.",
            }],
          },
          contents: [{ role: "user", parts: [{ text: query }] }],
          tools: [{ google_search: {} }],
          generationConfig: { maxOutputTokens: 600 },
        }),
      },
    );
    if (!resp.ok) return null;
    const data = (await resp.json()) as {
      candidates?: {
        content?: { parts?: { text?: string }[] };
        groundingMetadata?: {
          groundingChunks?: { web?: { uri?: string; title?: string } }[];
        };
      }[];
    };
    const cand = data.candidates?.[0];
    const text = cand?.content?.parts?.map((p) => p.text ?? "").join("").trim() ?? "";
    if (!text) return null;
    const sources: { title: string; url: string }[] = [];
    for (const chunk of cand?.groundingMetadata?.groundingChunks ?? []) {
      const url = chunk.web?.uri;
      if (url) sources.push({ title: chunk.web?.title ?? url, url });
      if (sources.length >= 5) break;
    }
    return { text, sources };
  } catch {
    return null;
  }
}
